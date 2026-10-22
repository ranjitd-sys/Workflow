/** Read a server-side environment variable from process.env or Astro's import.meta.env. */
export function env(key: string): string | undefined {
  return process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
}
