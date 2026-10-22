import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendMessage, type Message } from '../../lib/api';

const SUGGESTIONS = [
  {
    icon: '💡',
    title: 'Explain a concept',
    prompt: 'Explain quantum computing in simple terms',
  },
  {
    icon: '✍️',
    title: 'Write something',
    prompt: 'Write a professional email to my team',
  },
  {
    icon: '🔍',
    title: 'Analyze data',
    prompt: 'Help me analyze this dataset',
  },
];

function HexLogo() {
  return (
    <div className="w-16 h-16 mx-auto mb-6">
      <svg viewBox="0 0 64 64" className="w-full h-full">
        <polygon
          points="32,4 56,18 56,46 32,60 8,46 8,18"
          fill="#f5f5f5"
        />
        <polygon
          points="32,8 52,20 52,44 32,56 12,44 12,20"
          fill="none"
          stroke="#171717"
          strokeWidth="2.5"
        />
        <text
          x="32"
          y="38"
          textAnchor="middle"
          fontSize="22"
          fill="#171717"
          fontWeight="bold"
        >
          ✦
        </text>
      </svg>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-neutral-900 text-white rounded-br-md'
            : 'bg-white border border-neutral-200 text-neutral-800 rounded-bl-md shadow-sm'
        }`}
      >
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  user: { id: string; name: string; email: string };
  onSignOut: () => void;
}

export default function Chat({ user, onSignOut }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    const userMsg: Message = { role: 'user', content: msg };
    const next = [...messages, userMsg];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    await sendMessage({
      messages: next,
      signal: ctrl.signal,
      onToken: (t) =>
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, content: last.content + t };
          return copy;
        }),
      onDone: () => setLoading(false),
      onError: (e) => {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { role: 'assistant', content: `Error: ${e.message}` };
          return copy;
        });
        setLoading(false);
      },
    });
    setLoading(false);
  };

  const stop = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="w-7 h-7">
            <polygon
              points="16,2 28,9 28,23 16,30 4,23 4,9"
              fill="none"
              stroke="#171717"
              strokeWidth="2"
            />
            <text x="16" y="21" textAnchor="middle" fontSize="14" fill="#171717">
              ✦
            </text>
          </svg>
          <span className="font-semibold text-neutral-900 text-lg">Chat</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500 hidden sm:inline">{user.email}</span>
          <button
            onClick={onSignOut}
            className="text-sm text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
          >
            Sign out
          </button>
          <div className="w-8 h-8 rounded-full bg-neutral-900 flex items-center justify-center text-white text-sm font-medium">
            {user.name.charAt(0).toUpperCase()}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center h-full px-4 pb-8">
            <HexLogo />
            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 text-center mb-2">
              How can I help you today?
            </h1>
            <p className="text-neutral-500 text-center max-w-md mb-10 text-sm sm:text-base">
              Ask me anything — I can help with writing, analysis, coding,
              explanations, and much more.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  onClick={() => send(s.prompt)}
                  className="flex flex-col items-start gap-2 p-4 rounded-xl bg-neutral-50 border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-100 hover:shadow-sm transition-all duration-200 text-left group"
                >
                  <span className="text-2xl">{s.icon}</span>
                  <span className="font-medium text-neutral-700 text-sm group-hover:text-neutral-900">
                    {s.title}
                  </span>
                  <span className="text-xs text-neutral-400 line-clamp-2">{s.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} />
            ))}
            {loading && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div className="bg-white border border-neutral-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-neutral-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="px-4 pb-4 pt-2 border-t border-neutral-100">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="max-w-3xl mx-auto flex items-center gap-2"
        >
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 pr-12 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent shadow-sm"
              placeholder="Type a message..."
              disabled={loading}
            />
            {input.trim() && !loading && (
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center hover:bg-neutral-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
          {loading && (
            <button
              type="button"
              onClick={stop}
              className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-600 flex items-center justify-center hover:bg-neutral-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
