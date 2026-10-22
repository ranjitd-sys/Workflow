import { describe, expect, it, vi } from 'vitest';
import { LlmProviderError } from '../src/errors';
import { OpenAiCompatibleProvider } from '../src/providers/openai';

const baseRequest = {
  system: 'system rules',
  user: 'chat content',
  schemaName: 'ChatIntentResult',
  jsonSchema: { type: 'object' },
};

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function parseBody(init: RequestInit): {
  model: string;
  messages: { role: string; content: string }[];
  response_format: {
    type: string;
    json_schema: { name: string; strict: boolean; schema: unknown };
  };
} {
  return JSON.parse(init.body as string) as ReturnType<typeof parseBody>;
}

describe('OpenAiCompatibleProvider', () => {
  it('sends a strict structured-output request and parses the content', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    );

    const provider = new OpenAiCompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1/',
      model: 'test-model',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.generateStructured(baseRequest);
    expect(result).toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/v1/chat/completions');

    const body = parseBody(init);
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'chat content' },
    ]);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('ChatIntentResult');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('can disable strict structured outputs for best-effort models', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    );

    const provider = new OpenAiCompatibleProvider({
      apiKey: 'test-key',
      strict: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.generateStructured(baseRequest);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(parseBody(init).response_format.json_schema.strict).toBe(false);
  });

  it('retries a 429 response and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));

    const provider = new OpenAiCompatibleProvider({
      apiKey: 'test-key',
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.generateStructured(baseRequest);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws on a non-2xx response when retries are exhausted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 500));
    const provider = new OpenAiCompatibleProvider({
      apiKey: 'test-key',
      maxRetries: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateStructured(baseRequest)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });

  it('throws when the model content is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: 'not json' } }] }),
    );
    const provider = new OpenAiCompatibleProvider({
      apiKey: 'test-key',
      maxRetries: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateStructured(baseRequest)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });
});
