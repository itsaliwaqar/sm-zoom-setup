import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import { resolveShortLink } from "../lib/shortlinks";

const app = new Hono<AppEnv>();

app.get("/:code", async (c) => {
  const db = getDb(c.env.DB);
  const row = await resolveShortLink(db, c.req.param("code"));
  if (!row) return c.text("Not found", 404);
  c.header("Cache-Control", "no-store");
  return c.redirect(row.targetUrl, 302);
});

export default app;
