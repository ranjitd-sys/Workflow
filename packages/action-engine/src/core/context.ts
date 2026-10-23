export const DEFAULT_MAX_MESSAGE_CHARS = 4_000;
export const DEFAULT_MAX_HISTORY_MESSAGES = 10;
export const DEFAULT_MAX_HISTORY_CHARS = 6_000;

export interface PreparedContext {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  messageTruncated: boolean;
  historyTruncated: boolean;
}

interface TruncateResult {
  text: string;
  truncated: boolean;
}

function truncate(value: string, maxChars: number): TruncateResult {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: `${value.slice(0, maxChars)}…`, truncated: true };
}

export interface ContextLimits {
  maxMessageChars?: number;
  maxHistoryMessages?: number;
  maxHistoryChars?: number;
}

export function prepareContext(
  message: string,
  history: readonly { role: 'user' | 'assistant'; content: string }[] = [],
  limits: ContextLimits = {},
): PreparedContext {
  const maxMessageChars = limits.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
  const maxHistoryMessages = limits.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
  const maxHistoryChars = limits.maxHistoryChars ?? DEFAULT_MAX_HISTORY_CHARS;

  const boundedMessage = truncate(message.trim(), maxMessageChars);

  const allHistory = history.filter((entry) => entry.content.trim().length > 0);
  const usable = allHistory.slice(-Math.max(0, maxHistoryMessages));

  const selected: { role: 'user' | 'assistant'; content: string }[] = [];
  let chars = 0;

  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const entry = usable[index];
    if (!entry) continue;

    if (selected.length > 0 && chars + entry.content.length > maxHistoryChars) {
      break;
    }

    selected.unshift({ role: entry.role, content: entry.content.trim() });
    chars += entry.content.length;
  }

  return {
    message: boundedMessage.text,
    history: selected,
    messageTruncated: boundedMessage.truncated,
    historyTruncated: selected.length < allHistory.length,
  };
}

export function toEvidenceText(
  message: string,
  history: readonly { role: 'user' | 'assistant'; content: string }[],
): string {
  return [...history.map((entry) => entry.content), message].join('\n');
}
