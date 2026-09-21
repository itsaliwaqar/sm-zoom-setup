import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { requireAdminKey } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAdminKey);

app.post("/", async (c) => {
  const body = await c.req.json<{ slug: string; name: string; type: "webinar" | "meeting" }>();
  if (!body.slug || !body.name || !body.type) {
    return c.json({ error: "slug, name, and type are required" }, 400);
  }
  const db = getDb(c.env.DB);
  const existing = await db.select().from(schema.series).where(eq(schema.series.slug, body.slug)).get();
  if (existing) return c.json({ error: "a series with this slug already exists" }, 409);

  const id = crypto.randomUUID();
  await db.insert(schema.series).values({ id, slug: body.slug, name: body.name, type: body.type });
  const created = await db.select().from(schema.series).where(eq(schema.series.id, id)).get();
  return c.json(created, 201);
});

app.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const all = await db.select().from(schema.series).all();
  return c.json(all);
});

app.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const row = await db.select().from(schema.series).where(eq(schema.series.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
