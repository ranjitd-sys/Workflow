import { describe, expect, it, vi } from 'vitest';
import { LlmProviderError } from '../src/errors';
import { OpenAiCompatibleProvider } from '../src/providers/openai';

const baseRequest = {
  system: 'system rules',
  user: 'chat content',
  schemaName: 'ChatIntentResult',
  jsonSchema: { type: 'object' },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: {
        type: string;
        json_schema: { name: string; strict: boolean; schema: unknown };
      };
    };

    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'chat content' },
    ]);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('ChatIntentResult');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 500));
    const provider = new OpenAiCompatibleProvider({
      apiKey: 'test-key',
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
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateStructured(baseRequest)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
  });

});
