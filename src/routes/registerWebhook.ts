import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { resolveEvent } from "../lib/events";
import { addZoomRegistrant } from "../lib/zoom";
import { createShortLink, shortLinkUrl } from "../lib/shortlinks";
import { extractContact } from "../lib/extractContact";
import { ensureCustomFields, enrollInWorkflow, upsertContact } from "../lib/ghl";
import { formatEastern } from "../lib/time";
import { getBaseUrl } from "../lib/baseUrl";

const app = new Hono<AppEnv>();

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

  const zoomRegistrant = await addZoomRegistrant(c.env, type, event.zoomId, {
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

  const fieldIds = await ensureCustomFields(db, c.env, locationId);
  const contact = await upsertContact(c.env, {
    locationId,
    email,
    firstName,
    lastName,
    phone,
    customFields: [
      { id: fieldIds.webinar_date_eastern, value: formatEastern(event.startTimeUtc) },
      { id: fieldIds.join_link, value: zoomRegistrant.join_url },
      { id: fieldIds.short_join_link, value: shortJoinUrl },
      { id: fieldIds.registrant_id, value: String(zoomRegistrant.registrant_id) },
    ],
  });

  await enrollInWorkflow(c.env, contact.id, workflowId);

  await db
    .update(schema.registrants)
    .set({ shortJoinCode: shortCode, ghlContactId: contact.id })
    .where(eq(schema.registrants.id, registrantId));

  return c.json(
    {
      registrantId,
      zoomRegistrantId: zoomRegistrant.registrant_id,
      zoomEventId: event.id,
      joinUrl: zoomRegistrant.join_url,
      shortJoinUrl,
      ghlContactId: contact.id,
    },
    201
  );
});

export default app;
