import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { requireAuth } from "../lib/auth";
import { filterAttendees, getGroupedAttendees, runFlow, type ActionSummary, type FlowAction } from "../lib/attendeeFlows";
import { parseJson } from "../lib/tokens";

const app = new Hono<AppEnv>();
app.use("*", requireAuth);

type FlowBody = {
  name: string;
  enabled?: boolean;
  seriesId?: string | null;
  autoRun?: boolean;
  minMinutes?: number;
  excludeEmails?: string[];
  actions: FlowAction[];
};

function validateActions(actions: unknown): string | null {
  if (!Array.isArray(actions)) return "actions must be an array";
  for (const a of actions as FlowAction[]) {
    if (a.type === "ghl" && !a.tags?.length && !a.workflowId) return "GHL action needs at least a tag or a workflow ID";
    if (a.type === "hyros" && !a.tags?.length) return "Hyros action needs at least one tag";
    if (a.type === "sheets" && (!a.spreadsheetId || !a.sheetName || !a.columns?.length)) return "Google Sheets action needs a spreadsheet ID, sheet name and at least one column";
    if (a.type === "webhook" && (!a.url || !["bulk", "individual"].includes(a.mode))) return "Webhook action needs a URL and a mode (bulk or individual)";
    if (!["ghl", "hyros", "sheets", "webhook"].includes(a.type)) return `unknown action type: ${(a as { type: string }).type}`;
  }
  return null;
}

function columnsFrom(body: Partial<FlowBody>): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.seriesId !== undefined) update.seriesId = body.seriesId || null;
  if (body.autoRun !== undefined) update.autoRun = body.autoRun;
  if (body.minMinutes !== undefined) update.minMinutes = Math.max(0, Number(body.minMinutes) || 0);
  if (body.excludeEmails !== undefined) update.excludeEmailsJson = JSON.stringify(body.excludeEmails);
  if (body.actions !== undefined) update.actionsJson = JSON.stringify(body.actions);
  return update;
}

app.get("/", async (c) => {
  const db = getDb(c.env.DB);
  return c.json(await db.select().from(schema.attendeeFlows).orderBy(desc(schema.attendeeFlows.createdAt)).all());
});

app.post("/", async (c) => {
  const body = await c.req.json<FlowBody>();
  if (!body.name) return c.json({ error: "name is required" }, 400);
  const invalid = validateActions(body.actions);
  if (invalid) return c.json({ error: invalid }, 400);
  if (body.actions.length === 0) return c.json({ error: "add at least one action" }, 400);

  const db = getDb(c.env.DB);
  const id = crypto.randomUUID();
  await db.insert(schema.attendeeFlows).values({ id, actionsJson: "[]", ...columnsFrom(body), name: body.name });
  return c.json(await db.select().from(schema.attendeeFlows).where(eq(schema.attendeeFlows.id, id)).get(), 201);
});

// Recent runs across all flows, newest first, with the flow name and event topic joined in.
app.get("/runs", async (c) => {
  const db = getDb(c.env.DB);
  const runs = await db.select().from(schema.attendeeFlowRuns).orderBy(desc(schema.attendeeFlowRuns.startedAt)).limit(50).all();
  const flowIds = [...new Set(runs.map((r) => r.flowId))];
  const eventIds = [...new Set(runs.map((r) => r.zoomEventId))];
  const [flows, events] = await Promise.all([
    flowIds.length ? db.select().from(schema.attendeeFlows).where(inArray(schema.attendeeFlows.id, flowIds)).all() : [],
    eventIds.length ? db.select().from(schema.zoomEvents).where(inArray(schema.zoomEvents.id, eventIds)).all() : [],
  ]);
  const flowName = new Map(flows.map((f) => [f.id, f.name]));
  const eventInfo = new Map(events.map((e) => [e.id, { topic: e.topic, startTimeUtc: e.startTimeUtc }]));
  return c.json(runs.map((r) => ({ ...r, flowName: flowName.get(r.flowId) ?? "(deleted flow)", event: eventInfo.get(r.zoomEventId) ?? null })));
});

// Preview: the grouped attendee list for an event, without running any action. Pass ?flowId= to
// also apply that flow's filters (minimum minutes, excluded emails).
app.get("/attendees/:eventId", async (c) => {
  const db = getDb(c.env.DB);
  const event = await db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, c.req.param("eventId"))).get();
  if (!event) return c.json({ error: "event not found" }, 404);
  let attendees = await getGroupedAttendees(db, c.env, event);
  const flowId = c.req.query("flowId");
  if (flowId) {
    const flow = await db.select().from(schema.attendeeFlows).where(eq(schema.attendeeFlows.id, flowId)).get();
    if (!flow) return c.json({ error: "flow not found" }, 404);
    attendees = filterAttendees(flow, attendees);
  }
  return c.json({ event: { id: event.id, topic: event.topic, startTimeUtc: event.startTimeUtc }, attendeeCount: attendees.length, attendees });
});

app.patch("/:id", async (c) => {
  const body = await c.req.json<Partial<FlowBody>>();
  if (body.actions !== undefined) {
    const invalid = validateActions(body.actions);
    if (invalid) return c.json({ error: invalid }, 400);
  }
  const db = getDb(c.env.DB);
  const update = columnsFrom(body);
  if (Object.keys(update).length) await db.update(schema.attendeeFlows).set(update).where(eq(schema.attendeeFlows.id, c.req.param("id")));
  const row = await db.select().from(schema.attendeeFlows).where(eq(schema.attendeeFlows.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(schema.attendeeFlowRuns).where(eq(schema.attendeeFlowRuns.flowId, c.req.param("id")));
  await db.delete(schema.attendeeFlows).where(eq(schema.attendeeFlows.id, c.req.param("id")));
  return c.json({ ok: true });
});

// Resume a partial/failed run: re-runs the same flow+event but skips attendees who already
// succeeded in each action across ALL prior runs for this (flow, event) pair — not just the
// immediate parent — so successive resumes correctly accumulate the skip list rather than
// replaying already-processed batches.
app.post("/runs/:runId/resume", async (c) => {
  const db = getDb(c.env.DB);
  const priorRun = await db.select().from(schema.attendeeFlowRuns).where(eq(schema.attendeeFlowRuns.id, c.req.param("runId"))).get();
  if (!priorRun) return c.json({ error: "run not found" }, 404);
  const [flow, event, allRuns] = await Promise.all([
    db.select().from(schema.attendeeFlows).where(eq(schema.attendeeFlows.id, priorRun.flowId)).get(),
    db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, priorRun.zoomEventId)).get(),
    db.select({ summaryJson: schema.attendeeFlowRuns.summaryJson })
      .from(schema.attendeeFlowRuns)
      .where(and(
        eq(schema.attendeeFlowRuns.flowId, priorRun.flowId),
        eq(schema.attendeeFlowRuns.zoomEventId, priorRun.zoomEventId),
      )).all(),
  ]);
  if (!flow) return c.json({ error: "flow not found" }, 404);
  if (!event) return c.json({ error: "event not found" }, 404);

  // Merge succeeded emails from every run for this (flow, event) pair, per action type.
  const cumulativeByType = new Map<string, Set<string>>();
  for (const run of allRuns) {
    for (const s of parseJson<ActionSummary[]>(run.summaryJson) ?? []) {
      if (!cumulativeByType.has(s.type)) cumulativeByType.set(s.type, new Set());
      for (const email of s.succeededEmails ?? []) cumulativeByType.get(s.type)!.add(email);
    }
  }
  const priorSummaries: ActionSummary[] = [...cumulativeByType.entries()].map(([type, emails]) => ({
    type: type as ActionSummary["type"],
    succeeded: emails.size, failed: 0, skipped: 0, errors: [], succeededEmails: [...emails],
  }));

  return c.json(await runFlow(db, c.env, flow, event, "manual", { priorSummaries }));
});

// Manually run a flow against any (past) event - works even if the flow is disabled or already
// ran for that event, so it doubles as "re-run".
app.post("/:id/run", async (c) => {
  const body = await c.req.json<{ zoomEventId: string }>();
  if (!body.zoomEventId) return c.json({ error: "zoomEventId is required" }, 400);
  const db = getDb(c.env.DB);
  const [flow, event] = await Promise.all([
    db.select().from(schema.attendeeFlows).where(eq(schema.attendeeFlows.id, c.req.param("id"))).get(),
    db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, body.zoomEventId)).get(),
  ]);
  if (!flow) return c.json({ error: "flow not found" }, 404);
  if (!event) return c.json({ error: "event not found" }, 404);
  return c.json(await runFlow(db, c.env, flow, event, "manual"));
});

export default app;
