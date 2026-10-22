import { LlmProviderError } from '../errors';
import type { StructuredGenerationRequest, StructuredLlmProvider } from './types';

export interface OpenAiCompatibleProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleProviderOptions) {
    if (!options.apiKey) {
      throw new LlmProviderError('An LLM API key is required to call the provider.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.temperature = options.temperature ?? 0;
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
          strict: true,
          schema: request.jsonSchema,
        },
      },
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
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
}
