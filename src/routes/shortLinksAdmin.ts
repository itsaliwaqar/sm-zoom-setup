import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import { createShortLink, repointShortLink, resolveShortLink, shortLinkUrl } from "../lib/shortlinks";
import { getBaseUrl } from "../lib/baseUrl";
import { requireAdminKey } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAdminKey);

app.post("/", async (c) => {
  const body = await c.req.json<{ targetUrl: string }>();
  if (!body.targetUrl) return c.json({ error: "targetUrl is required" }, 400);
  const db = getDb(c.env.DB);
  const code = await createShortLink(db, body.targetUrl, "manual");
  return c.json({ code, shortUrl: shortLinkUrl(getBaseUrl(c), code), targetUrl: body.targetUrl }, 201);
});

app.patch("/:code", async (c) => {
  const body = await c.req.json<{ targetUrl: string }>();
  if (!body.targetUrl) return c.json({ error: "targetUrl is required" }, 400);
  const db = getDb(c.env.DB);
  const existing = await resolveShortLink(db, c.req.param("code"));
  if (!existing) return c.json({ error: "not found" }, 404);
  await repointShortLink(db, c.req.param("code"), body.targetUrl);
  return c.json({ code: c.req.param("code"), shortUrl: shortLinkUrl(getBaseUrl(c), c.req.param("code")), targetUrl: body.targetUrl });
});

app.get("/:code", async (c) => {
  const db = getDb(c.env.DB);
  const row = await resolveShortLink(db, c.req.param("code"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ...row, shortUrl: shortLinkUrl(getBaseUrl(c), row.code) });
});

export default app;
