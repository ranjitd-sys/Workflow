import { LlmProviderError } from '../errors';
import type { StructuredGenerationRequest, StructuredLlmProvider } from './types';

export interface OpenAiCompatibleProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  /** Use constrained decoding for the JSON schema. Defaults to true. */
  strict?: boolean;
  /** Number of retries for 429/5xx responses. Defaults to 2. */
  maxRetries?: number;
  /** Base delay for exponential backoff. Defaults to 500ms. */
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelayMs(response: Response | undefined, attempt: number, baseMs: number): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, Math.min(date - Date.now(), MAX_RETRY_DELAY_MS));
    }
  }
  return Math.min(baseMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

/**
 * Minimal adapter for OpenAI-compatible structured-output endpoints using the
 * native fetch API. No SDK dependency is required.
 */
export class OpenAiCompatibleProvider implements StructuredLlmProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly strict: boolean;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleProviderOptions) {
    if (!options.apiKey) {
      throw new LlmProviderError('An LLM API key is required to call the provider.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.temperature = options.temperature ?? 0;
    this.strict = options.strict ?? true;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<unknown> {
    const body = {
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName,
          strict: this.strict,
          schema: request.jsonSchema,
        },
      },
    };

    let response: Response;
    try {
      response = await this.fetchWithRetry(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new LlmProviderError('Failed to reach the LLM provider.', { cause: error });
    }

    if (!response.ok) {
      throw new LlmProviderError(
        `LLM provider returned HTTP ${response.status} ${response.statusText}.`,
      );
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new LlmProviderError('LLM provider returned an unexpected response payload.');
    }

    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new LlmProviderError('LLM provider response did not contain any choices.');
    }

    const firstChoice: unknown = choices[0];
    if (!isRecord(firstChoice)) {
      throw new LlmProviderError('LLM provider returned a malformed choice.');
    }

    const message = firstChoice.message;
    if (!isRecord(message)) {
      throw new LlmProviderError('LLM provider response did not contain a message.');
    }

    const content = message.content;
    if (typeof content !== 'string') {
      throw new LlmProviderError('LLM provider response did not contain message content.');
    }

    try {
      return JSON.parse(content) as unknown;
    } catch (error) {
      throw new LlmProviderError('LLM provider returned content that is not valid JSON.', {
        cause: error,
      });
    }
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, init);

        if (!isRetryableStatus(response.status) || attempt === this.maxRetries) {
          return response;
        }

        await sleep(retryDelayMs(response, attempt, this.retryBaseDelayMs), init.signal ?? undefined);
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;

        lastError = error;
        if (attempt === this.maxRetries) break;

        await sleep(
          Math.min(this.retryBaseDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS),
          init.signal ?? undefined,
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new LlmProviderError('LLM provider request failed after retries.');
  }
}
