import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import * as schema from "../db/schema";
import { getParticipantsReport } from "./zoom";
import { addTags, attendedTag, ensureCustomFields, noShowTag, upsertContact } from "./ghl";
import { tagLead as hyrosTagLead } from "./hyros";
import { forward as forwardWebhook } from "./outboundWebhook";
import { withCredentials } from "./credentials";
import { getSetting } from "./settings";
import { formatEastern } from "./time";
import { parseJson, resolveTokens, type HyrosConfig, type OutboundWebhookConfig } from "./tokens";

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

// Pulls the Zoom attendee report for one event, marks each registrant attended/no-show, and
// (per the registrant's own registration route config) tags + updates GHL, tags the Hyros lead,
// and forwards the result to an outbound webhook. Idempotent - safe to re-run for the same event.
// Each channel is independently try/caught so one failing never blocks the others.
export async function processEventAttendance(db: Db, env: Bindings, event: EventRow): Promise<void> {
  const effEnv = await withCredentials(db, env);
  const participants = await getParticipantsReport(effEnv, event.type, event.zoomId);
  const durationsByEmail = aggregateDurationsByEmail(participants);

  const eventRegistrants = await db
    .select()
    .from(schema.registrants)
    .where(eq(schema.registrants.zoomEventId, event.id))
    .all();

  const [ghlAttendedTagName, ghlNoShowTagName, hyrosAttendedTagName, hyrosNoShowTagName] = await Promise.all([
    attendedTag(db, env),
    noShowTag(db, env),
    getSetting(db, "hyros_attended_tag").then((v) => v || "Webinar Attended"),
    getSetting(db, "hyros_no_show_tag").then((v) => v || "Webinar No-Show"),
  ]);

  for (const registrant of eventRegistrants) {
    const seconds = durationsByEmail.get(registrant.email.toLowerCase()) ?? 0;
    const attended = seconds > 0;
    const attendedMinutes = Math.round(seconds / 60);

    await db
      .update(schema.registrants)
      .set({ attendanceStatus: attended ? "attended" : "no_show", attendedMinutes })
      .where(eq(schema.registrants.id, registrant.id));

    const route = await db
      .select()
      .from(schema.registrationRoutes)
      .where(eq(schema.registrationRoutes.id, registrant.registrationRouteId))
      .get();

    if (registrant.ghlContactId) {
      try {
        const locationId = route?.ghlLocationId || effEnv.GHL_DEFAULT_LOCATION_ID;
        const fieldIds = await ensureCustomFields(db, effEnv, locationId);
        await upsertContact(effEnv, {
          locationId,
          email: registrant.email,
          customFields: [{ id: fieldIds.attended_minutes, value: String(attendedMinutes) }],
        });
        await addTags(effEnv, registrant.ghlContactId, [attended ? ghlAttendedTagName : ghlNoShowTagName]);
      } catch (err) {
        console.error(`attendance GHL sync failed for registrant ${registrant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const hyrosConfig = parseJson<HyrosConfig>(route?.hyrosConfigJson);
    if (hyrosConfig?.enabled) {
      try {
        await hyrosTagLead(effEnv, { email: registrant.email, tags: [attended ? hyrosAttendedTagName : hyrosNoShowTagName], source: hyrosConfig.source });
      } catch (err) {
        console.error(`attendance Hyros sync failed for registrant ${registrant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const outboundWebhookConfig = parseJson<OutboundWebhookConfig>(route?.outboundWebhookConfigJson);
    if (outboundWebhookConfig?.enabled && outboundWebhookConfig.url) {
      try {
        const tokens = resolveTokens({
          email: registrant.email,
          firstName: registrant.firstName,
          lastName: registrant.lastName,
          webinarTopic: event.topic,
          webinarDateEastern: formatEastern(event.startTimeUtc),
          webinarDateUtc: event.startTimeUtc.toISOString(),
          joinUrl: registrant.joinUrl ?? "",
          shortJoinUrl: "",
          zoomRegistrantId: registrant.zoomRegistrantId ?? "",
          routeSlug: route?.slug ?? "",
          attendanceStatus: attended ? "attended" : "no_show",
          attendedMinutes,
        });
        await forwardWebhook(outboundWebhookConfig.url, {
          event: "attendance",
          registrant: { email: registrant.email, firstName: registrant.firstName, lastName: registrant.lastName },
          attendance: { status: tokens.attendanceStatus, attendedMinutes },
          zoom: { eventId: event.id, topic: event.topic, startTimeEastern: tokens.webinarDateEastern, startTimeUtc: tokens.webinarDateUtc },
        });
      } catch (err) {
        console.error(`attendance webhook forward failed for registrant ${registrant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  await db
    .update(schema.zoomEvents)
    .set({ attendanceSyncedAt: new Date(), status: "occurred" })
    .where(eq(schema.zoomEvents.id, event.id));
}
