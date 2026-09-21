import type { Context, Next } from "hono";
import type { AppEnv } from "../env";

// Guards /api/* admin routes. Public webhook/redirect routes never use this.
export async function requireAdminKey(c: Context<AppEnv>, next: Next) {
  const provided = c.req.header("X-API-Key");
  if (!provided || provided !== c.env.ADMIN_API_KEY) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}

// Best-effort check used by public endpoints that reveal more when a valid key is sent.
export function hasValidAdminKey(c: Context<AppEnv>): boolean {
  const provided = c.req.header("X-API-Key");
  return Boolean(provided && provided === c.env.ADMIN_API_KEY);
}
