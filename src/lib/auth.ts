import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { getSession } from "./sessions";

export const SESSION_COOKIE = "session";

// Accepts EITHER a logged-in session cookie OR the shared X-API-Key header (for scripts/Zapier/
// direct API use, documented in the API Docs tab). Sets c.var.session/authType for handlers that
// need to know who's calling (e.g. to block self-delete) - session is null for API-key requests.
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const apiKey = c.req.header("X-API-Key");
  if (apiKey && apiKey === c.env.ADMIN_API_KEY) {
    c.set("session", null);
    c.set("authType", "apiKey");
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  const session = await getSession(c.env, token);
  if (session) {
    c.set("session", session);
    c.set("authType", "session");
    return next();
  }

  return c.json({ error: "unauthorized" }, 401);
}

// Stricter guard for user/settings-secret management: a logged-in admin only - the shared API
// key does NOT satisfy this, so scripted access can never create/delete user accounts.
export async function requireAdminRole(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  const session = await getSession(c.env, token);
  if (!session || session.role !== "admin") {
    return c.json({ error: "admin access required" }, 403);
  }
  c.set("session", session);
  c.set("authType", "session");
  return next();
}

// Requires a logged-in session (any role) - used for self-service actions like changing your own
// password, which shouldn't be doable via the shared API key since there's no "self" for a key.
export async function requireSession(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  const session = await getSession(c.env, token);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  c.set("authType", "session");
  return next();
}

// Populates c.var.session if a valid session cookie is present, but never blocks the request.
// Used by /auth/me and similar endpoints that need to know who (if anyone) is logged in.
export async function optionalSession(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  c.set("session", await getSession(c.env, token));
  await next();
}

// Best-effort check used by public endpoints that reveal more when a valid key is sent
// (e.g. GET /api/upcoming including join links).
export function hasValidAdminKey(c: Context<AppEnv>): boolean {
  const provided = c.req.header("X-API-Key");
  return Boolean(provided && provided === c.env.ADMIN_API_KEY);
}
