import { useState, useEffect } from 'react';
import { getUser, signOut, type User } from '../../lib/auth';
import Login from './Login';
import Signup from './Signup';
import Chat from '../chat/Chat';

export default function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(getUser());
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return mode === 'login' ? (
      <Login onSuccess={setUser} onSwitch={() => setMode('signup')} />
    ) : (
      <Signup onSuccess={setUser} onSwitch={() => setMode('login')} />
    );
  }

  return (
    <Chat
      user={user}
      onSignOut={() => {
        signOut();
        setUser(null);
        setMode('login');
      }}
    />
  );
}
