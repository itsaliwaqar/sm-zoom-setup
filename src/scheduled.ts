import { and, eq, isNull, lte } from "drizzle-orm";
import { getDb } from "./db/client";
import * as schema from "./db/schema";
import type { Bindings } from "./env";
import { nextRecurrence, type RecurrenceRule } from "./lib/time";
import { createAndStoreZoomEvent } from "./lib/eventCreation";
import { processEventAttendance } from "./lib/attendance";
import type { ZoomCreatePayload } from "./lib/zoom";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_RETRIES = 5;
// Wait this long past an event's scheduled end before pulling Zoom's attendee report, so the
// report has time to finish generating and any last-minute overrun is still captured.
const ATTENDANCE_SYNC_BUFFER_MINUTES = 30;

export async function processDueJobs(env: Bindings): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date();

  const dueJobs = await db
    .select()
    .from(schema.scheduledJobs)
    .where(and(eq(schema.scheduledJobs.status, "pending"), lte(schema.scheduledJobs.runAtUtc, now)))
    .all();

  for (const job of dueJobs) {
    try {
      const [series, template] = await Promise.all([
        db.select().from(schema.series).where(eq(schema.series.id, job.seriesId)).get(),
        db.select().from(schema.templates).where(eq(schema.templates.id, job.templateId)).get(),
      ]);
      if (!series || !template) {
        throw new Error(`series or template missing for job ${job.id}`);
      }

      let eventStart: Date;
      if (job.mode === "once") {
        const stored = JSON.parse(job.recurrenceRuleJson ?? "{}") as { eventStartTimeUtc: string };
        eventStart = new Date(stored.eventStartTimeUtc);
      } else {
        // Recurring: the target occurrence is exactly `leadTimeDays` after this job's run time.
        eventStart = new Date(job.runAtUtc.getTime() + job.leadTimeDays * DAY_MS);
      }

      const payload: ZoomCreatePayload = {
        ...(JSON.parse(template.zoomPayloadJson) as ZoomCreatePayload),
        start_time: eventStart.toISOString(),
      };

      await createAndStoreZoomEvent(db, env, {
        type: series.type,
        hostEmail: template.hostEmail,
        payload,
        series,
      });

      if (job.mode === "once") {
        await db.update(schema.scheduledJobs).set({ status: "completed" }).where(eq(schema.scheduledJobs.id, job.id));
      } else {
        const rule = JSON.parse(job.recurrenceRuleJson ?? "{}") as RecurrenceRule;
        const nextOccurrence = nextRecurrence(rule, eventStart);
        const nextRunAt = new Date(nextOccurrence.getTime() - job.leadTimeDays * DAY_MS);
        await db
          .update(schema.scheduledJobs)
          .set({ runAtUtc: nextRunAt, retryCount: 0, lastError: null })
          .where(eq(schema.scheduledJobs.id, job.id));
      }
    } catch (err) {
      const retryCount = job.retryCount + 1;
      const lastError = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.scheduledJobs)
        .set({
          retryCount,
          lastError,
          status: retryCount >= MAX_RETRIES ? "failed" : "pending",
          // Back off ~15 min (one cron tick) before retrying; the trigger interval already spaces retries out.
        })
        .where(eq(schema.scheduledJobs.id, job.id));
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
