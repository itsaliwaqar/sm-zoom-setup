import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import type { ZoomCreatePayload } from "../lib/zoom";
import { requireAdminKey } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAdminKey);

app.post("/", async (c) => {
  const body = await c.req.json<{
    seriesId: string;
    name: string;
    hostEmail: string;
    zoomPayload: ZoomCreatePayload;
  }>();
  if (!body.seriesId || !body.name || !body.hostEmail || !body.zoomPayload) {
    return c.json({ error: "seriesId, name, hostEmail, and zoomPayload are required" }, 400);
  }
  const db = getDb(c.env.DB);
  const series = await db.select().from(schema.series).where(eq(schema.series.id, body.seriesId)).get();
  if (!series) return c.json({ error: "series not found" }, 404);

  const id = crypto.randomUUID();
  await db.insert(schema.templates).values({
    id,
    seriesId: body.seriesId,
    name: body.name,
    hostEmail: body.hostEmail,
    zoomPayloadJson: JSON.stringify(body.zoomPayload),
  });
  const created = await db.select().from(schema.templates).where(eq(schema.templates.id, id)).get();
  return c.json(created, 201);
});

app.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const all = await db.select().from(schema.templates).all();
  return c.json(all);
});

app.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const row = await db.select().from(schema.templates).where(eq(schema.templates.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
