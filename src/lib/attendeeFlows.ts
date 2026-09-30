import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import * as schema from "../db/schema";
import { getParticipantsReport, type ZoomParticipant } from "./zoom";
import { addTags, enrollInWorkflow, upsertContact } from "./ghl";
import { tagLead as hyrosTagLead } from "./hyros";
import { appendRows } from "./googleSheets";
import { forward as forwardWebhook } from "./outboundWebhook";
import { withCredentials } from "./credentials";
import { formatEastern } from "./time";
import { parseJson } from "./tokens";

type EventRow = typeof schema.zoomEvents.$inferSelect;
type FlowRow = typeof schema.attendeeFlows.$inferSelect;

/* ---------- attendee grouping ---------- */

// One person, after collapsing every join/leave row Zoom reported for them.
export type GroupedAttendee = {
  email: string; // "" when Zoom had no email for this participant (grouped by name instead)
  name: string;
  firstName: string;
  lastName: string;
  namesFromRegistration: boolean; // true = first/last name came from our registrants table, not the Zoom display name
  joinCount: number; // how many join/leave sessions Zoom recorded for this person
  firstJoinTime: string; // UTC ISO - earliest join across all sessions
  lastLeaveTime: string; // UTC ISO - latest leave across all sessions
  firstJoinTimeEastern: string;
  lastLeaveTimeEastern: string;
  attendedMinutes: number; // time actually present - overlapping sessions (2 devices) counted once
  zoomRegistrantId: string;
};

// Total length of the union of [start, end) intervals, so a person on two devices at once isn't
// double-counted the way summing Zoom's per-session `duration` would.
function unionMs(intervals: [number, number][]): number {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of sorted) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

// Groups Zoom's attendee report (one row per join/leave session, so rejoiners appear many times)
// into one record per person: by email when Zoom has one, otherwise by display name.
export function groupParticipants(
  participants: ZoomParticipant[],
  knownNames: Map<string, { firstName: string | null; lastName: string | null }> = new Map()
): GroupedAttendee[] {
  const groups = new Map<string, ZoomParticipant[]>();
  for (const p of participants) {
    const email = p.user_email?.trim().toLowerCase();
    const key = email ? `email:${email}` : `name:${(p.name ?? "").trim().toLowerCase()}`;
    if (key === "name:") continue; // no email and no name - nothing to identify them by
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  const result: GroupedAttendee[] = [];
  for (const [key, sessions] of groups) {
    const email = key.startsWith("email:") ? key.slice("email:".length) : "";
    const intervals = sessions.map((s): [number, number] => {
      const join = new Date(s.join_time).getTime();
      const leave = s.leave_time ? new Date(s.leave_time).getTime() : join + s.duration * 1000;
      return [join, leave];
    });
    const firstJoin = new Date(Math.min(...intervals.map(([s]) => s)));
    const lastLeave = new Date(Math.max(...intervals.map(([, e]) => e)));
    const name = sessions.find((s) => s.name)?.name ?? "";
    const known = email ? knownNames.get(email) : undefined;
    const fromZoom = splitName(name);

    result.push({
      email,
      name,
      firstName: known?.firstName || fromZoom.firstName,
      lastName: known?.lastName || fromZoom.lastName,
      namesFromRegistration: Boolean(known?.firstName || known?.lastName),
      joinCount: sessions.length,
      firstJoinTime: firstJoin.toISOString(),
      lastLeaveTime: lastLeave.toISOString(),
      firstJoinTimeEastern: formatEastern(firstJoin),
      lastLeaveTimeEastern: formatEastern(lastLeave),
      attendedMinutes: Math.round(unionMs(intervals) / 60000),
      zoomRegistrantId: sessions.find((s) => s.registrant_id)?.registrant_id ?? "",
    });
  }
  return result.sort((a, b) => a.firstJoinTime.localeCompare(b.firstJoinTime));
}

// Pulls the report for an event and groups it, preferring the names people registered with
// (from our registrants table) over their Zoom display names.
export async function getGroupedAttendees(db: Db, env: Bindings, event: EventRow): Promise<GroupedAttendee[]> {
  const effEnv = await withCredentials(db, env);
  const participants = await getParticipantsReport(effEnv, event.type, event.zoomId);
  const registrants = await db.select().from(schema.registrants).where(eq(schema.registrants.zoomEventId, event.id)).all();
  const knownNames = new Map(registrants.map((r) => [r.email.toLowerCase(), { firstName: r.firstName, lastName: r.lastName }]));
  return groupParticipants(participants, knownNames);
}

/* ---------- flow config ---------- */

export const ATTENDEE_TOKEN_KEYS = [
  "email",
  "name",
  "firstName",
  "lastName",
  "joinCount",
  "attendedMinutes",
  "firstJoinTimeEastern",
  "lastLeaveTimeEastern",
  "firstJoinTime",
  "lastLeaveTime",
  "zoomRegistrantId",
  "webinarTopic",
  "webinarDateEastern",
  "webinarDateUtc",
] as const;
export type AttendeeTokenKey = (typeof ATTENDEE_TOKEN_KEYS)[number];

export type AttendeeMapping = { source: "token" | "static"; token?: AttendeeTokenKey; staticValue?: string };

export type FlowAction =
  | { type: "ghl"; locationId?: string; tags: string[]; workflowId?: string; fields?: (AttendeeMapping & { fieldId: string; fieldName: string })[] }
  | { type: "hyros"; tags: string[]; source?: string }
  | { type: "sheets"; spreadsheetId: string; sheetName: string; columns: (AttendeeMapping & { header: string })[] }
  | { type: "webhook"; url: string; mode: "bulk" | "individual" };

export type ActionSummary = {
  type: FlowAction["type"];
  succeeded: number;
  failed: number;
  skipped: number; // e.g. attendees with no email, for GHL/Hyros
  errors: string[]; // first few failures, for display
};

const MAX_ERRORS_KEPT = 10;

function webinarInfo(event: EventRow) {
  return {
    id: event.id,
    zoomId: event.zoomId,
    type: event.type,
    topic: event.topic,
    startTimeUtc: event.startTimeUtc.toISOString(),
    startTimeEastern: formatEastern(event.startTimeUtc),
    durationMinutes: event.durationMinutes,
  };
}

function attendeeTokens(a: GroupedAttendee, event: EventRow): Record<AttendeeTokenKey, string> {
  return {
    email: a.email,
    name: a.name,
    firstName: a.firstName,
    lastName: a.lastName,
    joinCount: String(a.joinCount),
    attendedMinutes: String(a.attendedMinutes),
    firstJoinTimeEastern: a.firstJoinTimeEastern,
    lastLeaveTimeEastern: a.lastLeaveTimeEastern,
    firstJoinTime: a.firstJoinTime,
    lastLeaveTime: a.lastLeaveTime,
    zoomRegistrantId: a.zoomRegistrantId,
    webinarTopic: event.topic,
    webinarDateEastern: formatEastern(event.startTimeUtc),
    webinarDateUtc: event.startTimeUtc.toISOString(),
  };
}

function renderAttendeeMapping(m: AttendeeMapping, tokens: Record<AttendeeTokenKey, string>): string {
  if (m.source === "static") return m.staticValue ?? "";
  return m.token && m.token in tokens ? tokens[m.token] : "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function filterAttendees(flow: FlowRow, attendees: GroupedAttendee[]): GroupedAttendee[] {
  const excluded = new Set((parseJson<string[]>(flow.excludeEmailsJson) ?? []).map((e) => e.trim().toLowerCase()));
  return attendees.filter((a) => a.attendedMinutes >= flow.minMinutes && !(a.email && excluded.has(a.email)));
}

/* ---------- actions ---------- */

// Runs `fn` for each attendee, counting successes/failures - one attendee failing never stops the rest.
async function perAttendee(
  summary: ActionSummary,
  attendees: GroupedAttendee[],
  fn: (a: GroupedAttendee) => Promise<void>,
  opts: { requireEmail?: boolean } = {}
): Promise<void> {
  for (const a of attendees) {
    if (opts.requireEmail && !a.email) {
      summary.skipped++;
      continue;
    }
    try {
      await fn(a);
      summary.succeeded++;
    } catch (err) {
      summary.failed++;
      if (summary.errors.length < MAX_ERRORS_KEPT) summary.errors.push(`${a.email || a.name}: ${errorMessage(err)}`);
    }
  }
}

async function runAction(env: Bindings, flow: FlowRow, event: EventRow, action: FlowAction, attendees: GroupedAttendee[]): Promise<ActionSummary> {
  const summary: ActionSummary = { type: action.type, succeeded: 0, failed: 0, skipped: 0, errors: [] };
  try {
    switch (action.type) {
      case "ghl": {
        const locationId = action.locationId || env.GHL_DEFAULT_LOCATION_ID;
        if (!locationId) throw new Error("No GHL location ID (set one on the flow or in Settings > Credentials)");
        await perAttendee(
          summary,
          attendees,
          async (a) => {
            const tokens = attendeeTokens(a, event);
            const customFields = (action.fields ?? [])
              .filter((f) => f.fieldId)
              .map((f) => ({ id: f.fieldId, value: renderAttendeeMapping(f, tokens) }));
            // Names only when they came from registration - a Zoom display name (e.g. "iPhone")
            // must never overwrite an existing contact's real name.
            const names = a.namesFromRegistration ? { firstName: a.firstName || undefined, lastName: a.lastName || undefined } : {};
            const contact = await upsertContact(env, { locationId, email: a.email, ...names, customFields });
            if (action.tags.length) await addTags(env, contact.id, action.tags);
            if (action.workflowId) await enrollInWorkflow(env, contact.id, action.workflowId);
          },
          { requireEmail: true }
        );
        break;
      }
      case "hyros": {
        await perAttendee(summary, attendees, (a) => hyrosTagLead(env, { email: a.email, tags: action.tags, source: action.source }), { requireEmail: true });
        break;
      }
      case "sheets": {
        if (!action.spreadsheetId || !action.sheetName) throw new Error("Spreadsheet ID and sheet name are required");
        const rows = attendees.map((a) => {
          const tokens = attendeeTokens(a, event);
          return action.columns.map((c) => renderAttendeeMapping(c, tokens));
        });
        await appendRows(env, { spreadsheetId: action.spreadsheetId, sheetName: action.sheetName, rows });
        summary.succeeded = rows.length;
        break;
      }
      case "webhook": {
        if (!action.url) throw new Error("Webhook URL is required");
        const flowInfo = { id: flow.id, name: flow.name };
        if (action.mode === "bulk") {
          await forwardWebhook(action.url, { event: "attendees.processed", flow: flowInfo, webinar: webinarInfo(event), attendeeCount: attendees.length, attendees });
          summary.succeeded = attendees.length;
        } else {
          await perAttendee(summary, attendees, (a) => forwardWebhook(action.url, { event: "attendee.processed", flow: flowInfo, webinar: webinarInfo(event), attendee: a }));
        }
        break;
      }
    }
  } catch (err) {
    // A whole-action failure (bad config, bulk call rejected): every attendee not already counted failed.
    summary.failed = attendees.length - summary.succeeded - summary.skipped;
    summary.errors.unshift(errorMessage(err));
  }
  return summary;
}

/* ---------- running a flow ---------- */

export async function runFlow(db: Db, env: Bindings, flow: FlowRow, event: EventRow, trigger: "auto" | "manual") {
  const runId = crypto.randomUUID();
  await db.insert(schema.attendeeFlowRuns).values({ id: runId, flowId: flow.id, zoomEventId: event.id, trigger });

  try {
    const effEnv = await withCredentials(db, env);
    const attendees = filterAttendees(flow, await getGroupedAttendees(db, env, event));
    const actions = parseJson<FlowAction[]>(flow.actionsJson) ?? [];

    const summaries: ActionSummary[] = [];
    for (const action of actions) summaries.push(await runAction(effEnv, flow, event, action, attendees));

    const anyFailed = summaries.some((s) => s.failed > 0);
    const allFailed = summaries.length > 0 && summaries.every((s) => s.failed > 0 && s.succeeded === 0);
    await db
      .update(schema.attendeeFlowRuns)
      .set({
        status: allFailed && attendees.length > 0 ? "failed" : anyFailed ? "partial" : "succeeded",
        attendeeCount: attendees.length,
        summaryJson: JSON.stringify(summaries),
        finishedAt: new Date(),
      })
      .where(eq(schema.attendeeFlowRuns.id, runId));
  } catch (err) {
    // Couldn't even get the attendee report (e.g. Zoom hasn't finished generating it yet).
    await db
      .update(schema.attendeeFlowRuns)
      .set({ status: "failed", error: errorMessage(err), finishedAt: new Date() })
      .where(eq(schema.attendeeFlowRuns.id, runId));
  }

  return db.select().from(schema.attendeeFlowRuns).where(eq(schema.attendeeFlowRuns.id, runId)).get();
}

const MINUTE_MS = 60 * 1000;
const AUTO_RUN_LOOKBACK_MS = 3 * 24 * 60 * MINUTE_MS; // never auto-run for events that ended more than 3 days ago
const MAX_AUTO_ATTEMPTS = 3; // failed auto runs (e.g. Zoom's report not generated yet) retry up to this many times

// Cron entry point: finds one (flow, event) pair that is due - event ended (+ buffer), flow
// created before the event ended, and not already run for that event (failed attempts retry up
// to MAX_AUTO_ATTEMPTS) - and runs it. One per invocation keeps each run inside the Worker's
// per-invocation subrequest limit; the */30 cron picks up the next pair on its following tick.
export async function processDueAttendeeFlows(db: Db, env: Bindings, bufferMinutes: number): Promise<void> {
  const flows = await db
    .select()
    .from(schema.attendeeFlows)
    .where(and(eq(schema.attendeeFlows.enabled, true), eq(schema.attendeeFlows.autoRun, true)))
    .all();
  if (flows.length === 0) return;

  const now = Date.now();
  const events = await db.select().from(schema.zoomEvents).where(ne(schema.zoomEvents.status, "cancelled")).all();

  for (const flow of flows) {
    for (const event of events) {
      if (flow.seriesId && event.seriesId !== flow.seriesId) continue;
      const endMs = event.startTimeUtc.getTime() + event.durationMinutes * MINUTE_MS;
      if (endMs + bufferMinutes * MINUTE_MS > now) continue; // not over yet (or report not ready)
      if (endMs < now - AUTO_RUN_LOOKBACK_MS) continue;
      if (endMs < flow.createdAt.getTime()) continue; // flows only apply to events ending after they were created

      const priorRuns = await db
        .select({ status: schema.attendeeFlowRuns.status })
        .from(schema.attendeeFlowRuns)
        .where(and(eq(schema.attendeeFlowRuns.flowId, flow.id), eq(schema.attendeeFlowRuns.zoomEventId, event.id), eq(schema.attendeeFlowRuns.trigger, "auto")))
        .all();
      if (priorRuns.some((r) => r.status !== "failed") || priorRuns.length >= MAX_AUTO_ATTEMPTS) continue;

      await runFlow(db, env, flow, event, "auto");
      return;
    }
  }
}
