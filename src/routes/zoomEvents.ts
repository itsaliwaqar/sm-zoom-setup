import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { processEventAttendance } from "../lib/attendance";
import { requireAuth } from "../lib/auth";
import { shortLinkUrl } from "../lib/shortlinks";
import { getBaseUrl } from "../lib/baseUrl";
import { withCredentials } from "../lib/credentials";
import { deleteZoomEvent, updateZoomEvent, type ZoomCreatePayload } from "../lib/zoom";

const app = new Hono<AppEnv>();
app.use("*", requireAuth);

app.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(schema.zoomEvents).orderBy(desc(schema.zoomEvents.startTimeUtc)).all();
  const base = getBaseUrl(c);
  return c.json(rows.map((r) => ({ ...r, shortJoinUrl: r.shortJoinCode ? shortLinkUrl(base, r.shortJoinCode) : null })));
});

app.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const event = await db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, c.req.param("id"))).get();
  if (!event) return c.json({ error: "not found" }, 404);
  const registrants = await db
    .select()
    .from(schema.registrants)
    .where(eq(schema.registrants.zoomEventId, event.id))
    .all();
  return c.json({ ...event, registrants });
});

// Updates the event in Zoom (partial payload, same shape as create) and mirrors the change locally.
app.patch("/:id", async (c) => {
  const body = await c.req.json<{ zoomPayload: Partial<ZoomCreatePayload> }>();
  if (!body.zoomPayload) return c.json({ error: "zoomPayload is required" }, 400);

  const db = getDb(c.env.DB);
  const event = await db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, c.req.param("id"))).get();
  if (!event) return c.json({ error: "not found" }, 404);

  const effEnv = await withCredentials(db, c.env);
  await updateZoomEvent(effEnv, event.type, event.zoomId, body.zoomPayload);

  const priorRaw = event.rawResponseJson ? (JSON.parse(event.rawResponseJson) as Record<string, unknown>) : {};
  const priorSettings = (priorRaw.settings as Record<string, unknown>) ?? {};
  const mergedRaw = {
    ...priorRaw,
    ...body.zoomPayload,
    settings: { ...priorSettings, ...(body.zoomPayload.settings ?? {}) },
  };

  const update: Record<string, unknown> = { rawResponseJson: JSON.stringify(mergedRaw) };
  if (body.zoomPayload.topic) update.topic = body.zoomPayload.topic;
  if (body.zoomPayload.duration) update.durationMinutes = body.zoomPayload.duration;
  if (body.zoomPayload.start_time) update.startTimeUtc = new Date(body.zoomPayload.start_time);
  if (body.zoomPayload.timezone) update.startTimeIanaTz = body.zoomPayload.timezone;

  await db.update(schema.zoomEvents).set(update).where(eq(schema.zoomEvents.id, event.id));
  const updated = await db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, event.id)).get();
  return c.json(updated);
});

// Removes the event from Zoom (irreversible there) but keeps the local record - marked
// `cancelled` - so registrant/attendance history and CSV export still work.
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const event = await db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, c.req.param("id"))).get();
  if (!event) return c.json({ error: "not found" }, 404);

  const effEnv = await withCredentials(db, c.env);
  await deleteZoomEvent(effEnv, event.type, event.zoomId);
  await db.update(schema.zoomEvents).set({ status: "cancelled" }).where(eq(schema.zoomEvents.id, event.id));
  return c.json({ ok: true });
});

// Manually (re-)pull the Zoom attendee report and re-tag registrants in GHL/Hyros/webhook. Safe
// to call repeatedly - the cron job (`processAttendanceSync`) does this automatically a few
// minutes after each event ends, but this is here for testing or if you want it sooner.
app.post("/:id/sync-attendance", async (c) => {
  const db = getDb(c.env.DB);
  const event = await db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, c.req.param("id"))).get();
  if (!event) return c.json({ error: "not found" }, 404);

  await processEventAttendance(db, c.env, event);

  const registrants = await db
    .select()
    .from(schema.registrants)
    .where(eq(schema.registrants.zoomEventId, event.id))
    .all();
  return c.json({ ok: true, registrants });
});

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get("/:id/export.csv", async (c) => {
  const db = getDb(c.env.DB);
  const event = await db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, c.req.param("id"))).get();
  if (!event) return c.json({ error: "not found" }, 404);
  const registrants = await db
    .select()
    .from(schema.registrants)
    .where(eq(schema.registrants.zoomEventId, event.id))
    .all();

  const headers = ["email", "firstName", "lastName", "attendanceStatus", "attendedMinutes", "zoomRegistrantId", "ghlContactId", "joinUrl", "createdAt"];
  const lines = [headers.join(",")];
  for (const r of registrants) {
    lines.push(
      [r.email, r.firstName, r.lastName, r.attendanceStatus, r.attendedMinutes, r.zoomRegistrantId, r.ghlContactId, r.joinUrl, r.createdAt.toISOString()]
        .map(csvEscape)
        .join(",")
    );
  }

  const filename = `${event.topic.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-registrants.csv`;
  return c.body(lines.join("\n"), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
});

export default app;
