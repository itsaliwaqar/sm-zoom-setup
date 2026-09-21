import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import * as schema from "../db/schema";
import { getParticipantsReport } from "./zoom";
import { addTags, attendedTag, ensureCustomFields, noShowTag, upsertContact } from "./ghl";

// Sums each attendee's total time present (in seconds) across all of their join/leave sessions.
function aggregateDurationsByEmail(participants: { user_email?: string; duration: number }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const p of participants) {
    if (!p.user_email) continue;
    const key = p.user_email.toLowerCase();
    totals.set(key, (totals.get(key) ?? 0) + p.duration);
  }
  return totals;
}

export type EventRow = typeof schema.zoomEvents.$inferSelect;

// Pulls the Zoom attendee report for one event, marks each registrant attended/no-show,
// and tags + updates the corresponding GHL contact. Idempotent - safe to re-run for the same event.
export async function processEventAttendance(db: Db, env: Bindings, event: EventRow): Promise<void> {
  const participants = await getParticipantsReport(env, event.type, event.zoomId);
  const durationsByEmail = aggregateDurationsByEmail(participants);

  const eventRegistrants = await db
    .select()
    .from(schema.registrants)
    .where(eq(schema.registrants.zoomEventId, event.id))
    .all();

  for (const registrant of eventRegistrants) {
    const seconds = durationsByEmail.get(registrant.email.toLowerCase()) ?? 0;
    const attended = seconds > 0;
    const attendedMinutes = Math.round(seconds / 60);

    await db
      .update(schema.registrants)
      .set({ attendanceStatus: attended ? "attended" : "no_show", attendedMinutes })
      .where(eq(schema.registrants.id, registrant.id));

    if (!registrant.ghlContactId) continue;

    const route = await db
      .select()
      .from(schema.registrationRoutes)
      .where(eq(schema.registrationRoutes.id, registrant.registrationRouteId))
      .get();
    const locationId = route?.ghlLocationId ?? env.GHL_DEFAULT_LOCATION_ID;

    const fieldIds = await ensureCustomFields(db, env, locationId);
    await upsertContact(env, {
      locationId,
      email: registrant.email,
      customFields: [{ id: fieldIds.attended_minutes, value: String(attendedMinutes) }],
    });
    await addTags(env, registrant.ghlContactId, [attended ? attendedTag(env) : noShowTag(env)]);
  }

  await db
    .update(schema.zoomEvents)
    .set({ attendanceSyncedAt: new Date(), status: "occurred" })
    .where(eq(schema.zoomEvents.id, event.id));
}
