import type { Bindings } from "../env";

const SESSION_PREFIX = "session:";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type SessionData = {
  userId: string;
  email: string;
  role: "admin" | "member";
};

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(env: Bindings, data: SessionData): Promise<string> {
  const token = randomToken();
  await env.CACHE_KV.put(`${SESSION_PREFIX}${token}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function getSession(env: Bindings, token: string | undefined): Promise<SessionData | null> {
  if (!token) return null;
  const raw = await env.CACHE_KV.get(`${SESSION_PREFIX}${token}`);
  return raw ? (JSON.parse(raw) as SessionData) : null;
}

export async function deleteSession(env: Bindings, token: string | undefined): Promise<void> {
  if (!token) return;
  await env.CACHE_KV.delete(`${SESSION_PREFIX}${token}`);
}

// Simple per-email lockout: 5 failed attempts locks that email out for 15 minutes.
const FAIL_PREFIX = "loginfail:";
const MAX_FAILURES = 5;
const LOCKOUT_TTL_SECONDS = 15 * 60;

export async function recordLoginFailure(env: Bindings, email: string): Promise<void> {
  const key = `${FAIL_PREFIX}${email.toLowerCase()}`;
  const current = Number((await env.CACHE_KV.get(key)) ?? "0") + 1;
  await env.CACHE_KV.put(key, String(current), { expirationTtl: LOCKOUT_TTL_SECONDS });
}

export async function clearLoginFailures(env: Bindings, email: string): Promise<void> {
  await env.CACHE_KV.delete(`${FAIL_PREFIX}${email.toLowerCase()}`);
}

export async function isLockedOut(env: Bindings, email: string): Promise<boolean> {
  const current = Number((await env.CACHE_KV.get(`${FAIL_PREFIX}${email.toLowerCase()}`)) ?? "0");
  return current >= MAX_FAILURES;
}
