import { useState } from 'react';
import { signUp, type User } from '../../lib/auth';

interface Props {
  onSuccess: (user: User) => void;
  onSwitch: () => void;
}

export default function Signup({ onSuccess, onSwitch }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await signUp(name, email, password);
      onSuccess(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <svg viewBox="0 0 32 32" className="w-10 h-10 mx-auto mb-3">
            <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="none" stroke="#171717" strokeWidth="2" />
            <text x="16" y="21" textAnchor="middle" fontSize="14" fill="#171717">✦</text>
          </svg>
          <h1 className="text-2xl font-bold text-neutral-900">Create account</h1>
          <p className="text-neutral-500 text-sm mt-1">Get started for free</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="Your name"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="At least 6 characters"
              required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="text-center text-sm text-neutral-500 mt-6">
          Already have an account?{' '}
          <button onClick={onSwitch} className="text-neutral-900 font-medium hover:underline">
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
