import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { resolveEvent } from "../lib/events";
import { addZoomRegistrant } from "../lib/zoom";
import { createShortLink, shortLinkUrl } from "../lib/shortlinks";
import { extractContact } from "../lib/extractContact";
import { addTags, ensureCustomFields, enrollInWorkflow, upsertContact } from "../lib/ghl";
import { appendRow } from "../lib/googleSheets";
import { upsertContact as sendblueUpsertContact } from "../lib/sendblue";
import { tagLead as hyrosTagLead } from "../lib/hyros";
import { forward as forwardWebhook } from "../lib/outboundWebhook";
import { formatEastern } from "../lib/time";
import { getBaseUrl } from "../lib/baseUrl";
import { withCredentials } from "../lib/credentials";
import {
  renderMapping,
  resolveTokens,
  parseJson,
  type GhlOutputField,
  type SheetsConfig,
  type SendblueConfig,
  type HyrosConfig,
  type OutboundWebhookConfig,
} from "../lib/tokens";

const app = new Hono<AppEnv>();

app.get("/:slug", async (c) => {
  const db = getDb(c.env.DB);
  const route = await db
    .select()
    .from(schema.registrationRoutes)
    .where(eq(schema.registrationRoutes.slug, c.req.param("slug")))
    .get();
  if (!route || !route.enabled) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

app.post("/:slug", async (c) => {
  const db = getDb(c.env.DB);
  const route = await db
    .select()
    .from(schema.registrationRoutes)
    .where(eq(schema.registrationRoutes.slug, c.req.param("slug")))
    .get();
  if (!route || !route.enabled) return c.json({ error: "not found" }, 404);

  const type = (c.req.query("type") as "webinar" | "meeting" | null) ?? route.type;
  const mode = (c.req.query("mode") as "upcoming" | "specific" | null) ?? route.selectionMode;
  const zoomEventId = c.req.query("zoomEventId") ?? route.specificZoomEventId ?? undefined;
  const workflowId = c.req.query("workflowId") ?? route.ghlWorkflowId;
  const locationId = c.req.query("locationId") ?? route.ghlLocationId;

  const event = await resolveEvent(db, { type, mode, seriesId: route.seriesId, zoomEventId });
  if (!event) return c.json({ error: "no matching upcoming webinar/meeting found for this route" }, 422);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be JSON" }, 400);
  }

  const mapping = route.fieldMappingJson ? JSON.parse(route.fieldMappingJson) : undefined;
  const { email, firstName, lastName, phone } = extractContact(body, mapping);
  if (!email) return c.json({ error: "could not find an email address in the request body" }, 400);

  // --- Critical path: Zoom registration + baseline GHL contact/workflow. A failure here fails
  // the whole request - everything below is best-effort and collected as `warnings` instead. ---
  const effEnv = await withCredentials(db, c.env);
  const zoomRegistrant = await addZoomRegistrant(effEnv, type, event.zoomId, {
    email,
    first_name: firstName || email.split("@")[0],
    last_name: lastName,
  });

  const registrantId = crypto.randomUUID();
  await db.insert(schema.registrants).values({
    id: registrantId,
    registrationRouteId: route.id,
    zoomEventId: event.id,
    email,
    firstName,
    lastName,
    zoomRegistrantId: String(zoomRegistrant.registrant_id),
    joinUrl: zoomRegistrant.join_url,
  });

  const shortCode = await createShortLink(db, zoomRegistrant.join_url, "registrant", { registrantId });
  const baseUrl = getBaseUrl(c);
  const shortJoinUrl = shortLinkUrl(baseUrl, shortCode);

  const tokens = resolveTokens({
    email,
    firstName,
    lastName,
    phone,
    webinarTopic: event.topic,
    webinarDateEastern: formatEastern(event.startTimeUtc),
    webinarDateUtc: event.startTimeUtc.toISOString(),
    joinUrl: zoomRegistrant.join_url,
    shortJoinUrl,
    zoomRegistrantId: String(zoomRegistrant.registrant_id),
    routeSlug: route.slug,
  });

  // GHL sync is optional per route (registrationRoutes.ghlEnabled). When enabled it stays part of
  // the critical path (same as before) - a failure here still fails the whole request.
  let ghlContactId: string | undefined;
  if (route.ghlEnabled && route.ghlWorkflowId && locationId) {
    const ghlOutputFields = parseJson<GhlOutputField[]>(route.ghlOutputFieldsJson) ?? [];
    const fieldIds = await ensureCustomFields(db, effEnv, locationId);
    const contact = await upsertContact(effEnv, {
      locationId,
      email,
      firstName,
      lastName,
      phone,
      customFields: [
        { id: fieldIds.webinar_date_eastern, value: tokens.webinarDateEastern },
        { id: fieldIds.join_link, value: tokens.joinUrl },
        { id: fieldIds.short_join_link, value: tokens.shortJoinUrl },
        { id: fieldIds.registrant_id, value: tokens.zoomRegistrantId },
        ...ghlOutputFields.map((f) => ({ id: f.fieldId, value: renderMapping(f, tokens) })),
      ],
    });
    await enrollInWorkflow(effEnv, contact.id, workflowId || route.ghlWorkflowId);
    ghlContactId = contact.id;
  }

  await db
    .update(schema.registrants)
    .set({ shortJoinCode: shortCode, ghlContactId: ghlContactId ?? null })
    .where(eq(schema.registrants.id, registrantId));

  // --- Best-effort extras: each isolated so one failing never breaks the registration itself. ---
  const warnings: string[] = [];
  const asWarning = (label: string, err: unknown) => warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);

  const ghlTags = parseJson<string[]>(route.ghlTagsJson);
  if (ghlContactId && ghlTags && ghlTags.length > 0) {
    try {
      await addTags(effEnv, ghlContactId, ghlTags);
    } catch (err) {
      asWarning("GHL tags", err);
    }
  }

  const sheetsConfig = parseJson<SheetsConfig>(route.sheetsConfigJson);
  if (sheetsConfig?.enabled && sheetsConfig.spreadsheetId && sheetsConfig.sheetName) {
    try {
      await appendRow(effEnv, {
        spreadsheetId: sheetsConfig.spreadsheetId,
        sheetName: sheetsConfig.sheetName,
        values: sheetsConfig.columns.map((col) => renderMapping(col, tokens)),
      });
    } catch (err) {
      asWarning("Google Sheets", err);
    }
  }

  const sendblueConfig = parseJson<SendblueConfig>(route.sendblueConfigJson);
  if (sendblueConfig?.enabled) {
    if (phone) {
      try {
        await sendblueUpsertContact(effEnv, {
          number: phone,
          firstName: firstName ?? undefined,
          lastName: lastName ?? undefined,
          tags: sendblueConfig.tags,
          customVariables: Object.fromEntries(sendblueConfig.customVariables.map((cv) => [cv.label, renderMapping(cv, tokens)])),
        });
      } catch (err) {
        asWarning("SendBlue", err);
      }
    } else {
      warnings.push("SendBlue: skipped - registrant has no phone number");
    }
  }

  const hyrosConfig = parseJson<HyrosConfig>(route.hyrosConfigJson);
  if (hyrosConfig?.enabled) {
    try {
      await hyrosTagLead(effEnv, { email, tags: hyrosConfig.tags, source: hyrosConfig.source });
    } catch (err) {
      asWarning("Hyros", err);
    }
  }

  const outboundWebhookConfig = parseJson<OutboundWebhookConfig>(route.outboundWebhookConfigJson);
  if (outboundWebhookConfig?.enabled && outboundWebhookConfig.url) {
    try {
      await forwardWebhook(outboundWebhookConfig.url, {
        ...body,
        zoom: {
          eventId: event.id,
          topic: event.topic,
          startTimeEastern: tokens.webinarDateEastern,
          startTimeUtc: tokens.webinarDateUtc,
          joinUrl: tokens.joinUrl,
          shortJoinUrl: tokens.shortJoinUrl,
          registrantId: tokens.zoomRegistrantId,
        },
        registrant: { email, firstName, lastName, phone },
      });
    } catch (err) {
      asWarning("Outbound webhook", err);
    }
  }

  return c.json(
    {
      registrantId,
      zoomRegistrantId: zoomRegistrant.registrant_id,
      zoomEventId: event.id,
      joinUrl: zoomRegistrant.join_url,
      shortJoinUrl,
      ghlContactId: ghlContactId ?? null,
      webinar: {
        topic: event.topic,
        type: event.type,
        startTimeUtc: event.startTimeUtc.toISOString(),
        startTimeEastern: tokens.webinarDateEastern,
        durationMinutes: event.durationMinutes,
        timezone: event.startTimeIanaTz,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    },
    201
  );
});

export default app;
