import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { processEventAttendance } from "../lib/attendance";
import { requireAuth } from "../lib/auth";
import { shortLinkUrl } from "../lib/shortlinks";
import { getBaseUrl } from "../lib/baseUrl";

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

// Manually (re-)pull the Zoom attendee report and re-tag registrants in GHL. Safe to call
// repeatedly - the cron job (`processAttendanceSync`) does this automatically ~30 min after
// each event ends, but this is here for testing or if you want it sooner.
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

export default app;
