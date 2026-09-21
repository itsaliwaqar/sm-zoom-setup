import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import type { ZoomCreatePayload, ZoomEventType } from "../lib/zoom";
import { createAndStoreZoomEvent } from "../lib/eventCreation";
import { shortLinkUrl } from "../lib/shortlinks";
import { getBaseUrl } from "../lib/baseUrl";
import { requireAdminKey } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAdminKey);

type CreateBody = {
  type: ZoomEventType;
  seriesId?: string;
  templateId?: string;
  startTime: string; // ISO 8601 UTC
  hostEmail?: string;
  zoomPayload?: Partial<ZoomCreatePayload>;
};

app.post("/", async (c) => {
  const body = await c.req.json<CreateBody>();
  if (!body.type || !body.startTime) {
    return c.json({ error: "type and startTime are required" }, 400);
  }

  const db = getDb(c.env.DB);

  let basePayload: ZoomCreatePayload = { topic: "Untitled", duration: 60, start_time: body.startTime };
  let hostEmail = body.hostEmail;
  let series: typeof schema.series.$inferSelect | undefined;

  if (body.templateId) {
    const template = await db.select().from(schema.templates).where(eq(schema.templates.id, body.templateId)).get();
    if (!template) return c.json({ error: "template not found" }, 404);
    basePayload = { ...JSON.parse(template.zoomPayloadJson), start_time: body.startTime };
    hostEmail = hostEmail ?? template.hostEmail;
  }

  if (body.seriesId) {
    series = await db.select().from(schema.series).where(eq(schema.series.id, body.seriesId)).get();
    if (!series) return c.json({ error: "series not found" }, 404);
  }

  if (!hostEmail) return c.json({ error: "hostEmail is required (directly or via templateId)" }, 400);

  const payload: ZoomCreatePayload = { ...basePayload, ...body.zoomPayload, start_time: body.startTime };

  const created = await createAndStoreZoomEvent(db, c.env, { type: body.type, hostEmail, payload, series });

  return c.json(
    { ...created, shortJoinUrl: created?.shortJoinCode ? shortLinkUrl(getBaseUrl(c), created.shortJoinCode) : null },
    201
  );
});

export default app;
