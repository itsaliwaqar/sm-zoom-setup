import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { nextRecurrence, type RecurrenceRule } from "../lib/time";
import { requireAuth } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;

type ScheduleBody =
  | {
      mode: "recurring";
      seriesId: string;
      templateId: string;
      recurrenceRule: RecurrenceRule;
      leadTimeDays?: number;
    }
  | {
      mode: "once";
      seriesId: string;
      templateId: string;
      eventStartTime: string; // ISO 8601 UTC - when the webinar/meeting itself happens
      createAt?: string; // ISO 8601 UTC - when the worker should call Zoom to create it; default: now
    };

app.post("/", async (c) => {
  const body = await c.req.json<ScheduleBody>();
  if (!body.mode || !body.seriesId || !body.templateId) {
    return c.json({ error: "mode, seriesId, and templateId are required" }, 400);
  }

  const db = getDb(c.env.DB);
  const [series, template] = await Promise.all([
    db.select().from(schema.series).where(eq(schema.series.id, body.seriesId)).get(),
    db.select().from(schema.templates).where(eq(schema.templates.id, body.templateId)).get(),
  ]);
  if (!series) return c.json({ error: "series not found" }, 404);
  if (!template) return c.json({ error: "template not found" }, 404);

  const id = crypto.randomUUID();

  if (body.mode === "recurring") {
    if (!body.recurrenceRule) return c.json({ error: "recurrenceRule is required for mode=recurring" }, 400);
    const leadTimeDays = body.leadTimeDays ?? 0;
    const nextEventStart = nextRecurrence(body.recurrenceRule, new Date());
    let runAtUtc = new Date(nextEventStart.getTime() - leadTimeDays * DAY_MS);
    // If the lead-time window for the very next occurrence has already passed, create it ASAP.
    if (runAtUtc.getTime() <= Date.now()) runAtUtc = new Date();

    await db.insert(schema.scheduledJobs).values({
      id,
      mode: "recurring",
      seriesId: body.seriesId,
      templateId: body.templateId,
      recurrenceRuleJson: JSON.stringify(body.recurrenceRule),
      leadTimeDays,
      runAtUtc,
    });
  } else {
    if (!body.eventStartTime) return c.json({ error: "eventStartTime is required for mode=once" }, 400);
    const runAtUtc = body.createAt ? new Date(body.createAt) : new Date();

    await db.insert(schema.scheduledJobs).values({
      id,
      mode: "once",
      seriesId: body.seriesId,
      templateId: body.templateId,
      recurrenceRuleJson: JSON.stringify({ eventStartTimeUtc: body.eventStartTime }),
      leadTimeDays: 0,
      runAtUtc,
    });
  }

  const created = await db.select().from(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, id)).get();
  return c.json(created, 201);
});

app.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const all = await db.select().from(schema.scheduledJobs).all();
  return c.json(all);
});

app.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(schema.scheduledJobs).where(eq(schema.scheduledJobs.id, c.req.param("id")));
  return c.json({ ok: true });
});

export default app;
