import { and, eq, isNull, lte } from "drizzle-orm";
import { getDb, type Db } from "./db/client";
import * as schema from "./db/schema";
import type { Bindings } from "./env";
import { generateOccurrences, type RecurrenceRule } from "./lib/time";
import { createAndStoreZoomEvent } from "./lib/eventCreation";
import { processEventAttendance } from "./lib/attendance";
import type { ZoomCreatePayload } from "./lib/zoom";

const MINUTE_MS = 60 * 1000;
const MAX_RETRIES = 5;
// Wait this long past an event's scheduled end before pulling Zoom's attendee report, so the
// report has time to finish generating and any last-minute overrun is still captured.
const ATTENDANCE_SYNC_BUFFER_MINUTES = 30;

type ScheduledJobRow = typeof schema.scheduledJobs.$inferSelect;

async function markJobFailure(db: Db, job: ScheduledJobRow, err: unknown): Promise<void> {
  const retryCount = job.retryCount + 1;
  const lastError = err instanceof Error ? err.message : String(err);
  await db
    .update(schema.scheduledJobs)
    .set({
      retryCount,
      lastError,
      // Recurring jobs never move to "failed" - a bad tick just retries on the next one, since
      // giving up would silently stop refilling the rolling window.
      status: job.mode === "once" && retryCount >= MAX_RETRIES ? "failed" : "pending",
    })
    .where(eq(schema.scheduledJobs.id, job.id));
}

export async function processDueJobs(env: Bindings): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date();

  const onceJobs = await db
    .select()
    .from(schema.scheduledJobs)
    .where(and(eq(schema.scheduledJobs.mode, "once"), eq(schema.scheduledJobs.status, "pending"), lte(schema.scheduledJobs.runAtUtc, now)))
    .all();

  for (const job of onceJobs) {
    try {
      const [series, template] = await Promise.all([
        db.select().from(schema.series).where(eq(schema.series.id, job.seriesId)).get(),
        db.select().from(schema.templates).where(eq(schema.templates.id, job.templateId)).get(),
      ]);
      if (!series || !template) throw new Error(`series or template missing for job ${job.id}`);

      const stored = JSON.parse(job.recurrenceRuleJson ?? "{}") as { eventStartTimeUtc: string };
      const eventStart = new Date(stored.eventStartTimeUtc);
      const payload: ZoomCreatePayload = {
        ...(JSON.parse(template.zoomPayloadJson) as ZoomCreatePayload),
        start_time: eventStart.toISOString(),
      };
      await createAndStoreZoomEvent(db, env, { type: series.type, hostEmail: template.hostEmail, payload, series });
      await db.update(schema.scheduledJobs).set({ status: "completed" }).where(eq(schema.scheduledJobs.id, job.id));
    } catch (err) {
      await markJobFailure(db, job, err);
    }
  }

  // Recurring jobs always reconcile (not gated on runAtUtc) - each tick fills in whatever
  // occurrences are missing within the configured rolling window, so the window self-heals
  // regardless of how long since the last successful tick.
  const recurringJobs = await db
    .select()
    .from(schema.scheduledJobs)
    .where(and(eq(schema.scheduledJobs.mode, "recurring"), eq(schema.scheduledJobs.status, "pending")))
    .all();

  for (const job of recurringJobs) {
    try {
      const [series, template] = await Promise.all([
        db.select().from(schema.series).where(eq(schema.series.id, job.seriesId)).get(),
        db.select().from(schema.templates).where(eq(schema.templates.id, job.templateId)).get(),
      ]);
      if (!series || !template) throw new Error(`series or template missing for job ${job.id}`);

      const rule = JSON.parse(job.recurrenceRuleJson ?? "{}") as RecurrenceRule;
      const occurrences = generateOccurrences(rule, now, job.horizonDays);

      for (const occurrence of occurrences) {
        const existing = await db
          .select()
          .from(schema.zoomEvents)
          .where(and(eq(schema.zoomEvents.seriesId, job.seriesId), eq(schema.zoomEvents.startTimeUtc, occurrence)))
          .get();
        if (existing) continue;

        const payload: ZoomCreatePayload = {
          ...(JSON.parse(template.zoomPayloadJson) as ZoomCreatePayload),
          start_time: occurrence.toISOString(),
        };
        await createAndStoreZoomEvent(db, env, { type: series.type, hostEmail: template.hostEmail, payload, series });
      }

      await db
        .update(schema.scheduledJobs)
        .set({ runAtUtc: now, retryCount: 0, lastError: null })
        .where(eq(schema.scheduledJobs.id, job.id));
    } catch (err) {
      await markJobFailure(db, job, err);
    }
  }
}

// Finds events whose end time (start + duration + buffer) has passed but whose attendee report
// hasn't been pulled yet, fetches it from Zoom, and tags/updates the registrants' GHL contacts.
export async function processAttendanceSync(env: Bindings): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date();

  const candidates = await db
    .select()
    .from(schema.zoomEvents)
    .where(and(eq(schema.zoomEvents.status, "scheduled"), isNull(schema.zoomEvents.attendanceSyncedAt)))
    .all();

  for (const event of candidates) {
    const endTime = event.startTimeUtc.getTime() + event.durationMinutes * MINUTE_MS;
    if (endTime + ATTENDANCE_SYNC_BUFFER_MINUTES * MINUTE_MS > now.getTime()) continue;

    try {
      await processEventAttendance(db, env, event);
    } catch (err) {
      // Leave attendanceSyncedAt null so this event is retried on the next cron tick.
      console.error(`attendance sync failed for zoom_event ${event.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
