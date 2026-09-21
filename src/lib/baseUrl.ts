import type { Context } from "hono";
import type { AppEnv } from "../env";

export function getBaseUrl(c: Context<AppEnv>): string {
  return c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin;
}
