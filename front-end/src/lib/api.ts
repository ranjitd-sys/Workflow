export type Message = { role: 'user' | 'assistant'; content: string };

export interface ChatOptions {
  messages: Message[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

const API_URL = (import.meta.env.PUBLIC_API_URL as string | undefined)?.replace(/\/$/, '');

export async function sendMessage({ messages, signal, onToken, onDone, onError }: ChatOptions) {
  if (!API_URL) {
    const reply = `You said: "${messages[messages.length - 1]?.content ?? ''}". (mock response — set PUBLIC_API_URL to connect a backend)`;
    for (const ch of reply) {
      if (signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 12));
      onToken(ch);
    }
    onDone();
    return;
  }
  try {
    const res = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            onDone();
            return;
          }
          try {
            const j = JSON.parse(payload);
            onToken(j.content ?? j.token ?? j.delta ?? payload);
          } catch {
            onToken(payload);
          }
        } else {
          onToken(trimmed);
        }
      }
    }
    onDone();
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    onError(e as Error);
  }
}
