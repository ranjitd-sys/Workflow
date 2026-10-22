export type User = { id: string; name: string; email: string };

const USERS_KEY = 'chat_users';
const SESSION_KEY = 'chat_user';

function loadUsers(): Record<string, { name: string; email: string; password: string }> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveUsers(users: Record<string, { name: string; email: string; password: string }>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function signOut() {
  if (typeof window !== 'undefined') localStorage.removeItem(SESSION_KEY);
}

export async function signIn(email: string, password: string): Promise<User> {
  email = email.trim().toLowerCase();
  if (!email || !password) throw new Error('Email and password are required');
  await new Promise((r) => setTimeout(r, 300));

  const users = loadUsers();
  const existing = users[email];
  if (!existing || existing.password !== password) {
    throw new Error('Invalid email or password');
  }
  const user: User = { id: email, name: existing.name, email };
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

export async function signUp(name: string, email: string, password: string): Promise<User> {
  name = name.trim();
  email = email.trim().toLowerCase();
  if (!name || !email || !password) throw new Error('All fields are required');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  await new Promise((r) => setTimeout(r, 300));

  const users = loadUsers();
  if (users[email]) throw new Error('An account with this email already exists');
  users[email] = { name, email, password };
  saveUsers(users);

  const user: User = { id: email, name, email };
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}
