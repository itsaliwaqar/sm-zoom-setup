import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { generateShortCode } from "../lib/shortlinks";
import { getBaseUrl } from "../lib/baseUrl";
import { requireAuth } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAuth);

type CreateBody = {
  type: "webinar" | "meeting";
  selectionMode: "upcoming" | "specific";
  seriesId?: string;
  specificZoomEventId?: string;
  ghlWorkflowId: string;
  ghlLocationId?: string;
  fieldMapping?: Record<string, string>;
};

app.post("/", async (c) => {
  const body = await c.req.json<CreateBody>();
  if (!body.type || !body.selectionMode || !body.ghlWorkflowId) {
    return c.json({ error: "type, selectionMode, and ghlWorkflowId are required" }, 400);
  }
  if (body.selectionMode === "upcoming" && !body.seriesId) {
    return c.json({ error: "seriesId is required when selectionMode=upcoming" }, 400);
  }
  if (body.selectionMode === "specific" && !body.specificZoomEventId) {
    return c.json({ error: "specificZoomEventId is required when selectionMode=specific" }, 400);
  }

  const db = getDb(c.env.DB);
  const id = crypto.randomUUID();
  const slug = generateShortCode(10);

  await db.insert(schema.registrationRoutes).values({
    id,
    slug,
    type: body.type,
    selectionMode: body.selectionMode,
    seriesId: body.seriesId,
    specificZoomEventId: body.specificZoomEventId,
    ghlWorkflowId: body.ghlWorkflowId,
    ghlLocationId: body.ghlLocationId ?? c.env.GHL_DEFAULT_LOCATION_ID,
    fieldMappingJson: body.fieldMapping ? JSON.stringify(body.fieldMapping) : null,
  });

  const created = await db.select().from(schema.registrationRoutes).where(eq(schema.registrationRoutes.id, id)).get();
  return c.json({ ...created, webhookUrl: `${getBaseUrl(c)}/webhooks/register/${slug}` }, 201);
});

app.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const all = await db.select().from(schema.registrationRoutes).all();
  const base = getBaseUrl(c);
  return c.json(all.map((r) => ({ ...r, webhookUrl: `${base}/webhooks/register/${r.slug}` })));
});

app.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const row = await db.select().from(schema.registrationRoutes).where(eq(schema.registrationRoutes.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ...row, webhookUrl: `${getBaseUrl(c)}/webhooks/register/${row.slug}` });
});

app.patch("/:id", async (c) => {
  const body = await c.req.json<Partial<CreateBody> & { enabled?: boolean }>();
  const db = getDb(c.env.DB);
  const update: Record<string, unknown> = {};
  if (body.type) update.type = body.type;
  if (body.selectionMode) update.selectionMode = body.selectionMode;
  if (body.seriesId !== undefined) update.seriesId = body.seriesId;
  if (body.specificZoomEventId !== undefined) update.specificZoomEventId = body.specificZoomEventId;
  if (body.ghlWorkflowId) update.ghlWorkflowId = body.ghlWorkflowId;
  if (body.ghlLocationId) update.ghlLocationId = body.ghlLocationId;
  if (body.fieldMapping) update.fieldMappingJson = JSON.stringify(body.fieldMapping);
  if (body.enabled !== undefined) update.enabled = body.enabled;

  await db.update(schema.registrationRoutes).set(update).where(eq(schema.registrationRoutes.id, c.req.param("id")));
  const row = await db.select().from(schema.registrationRoutes).where(eq(schema.registrationRoutes.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(schema.registrationRoutes).where(eq(schema.registrationRoutes.id, c.req.param("id")));
  return c.json({ ok: true });
});

export default app;
