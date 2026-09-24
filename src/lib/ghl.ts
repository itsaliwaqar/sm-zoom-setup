import { and, eq } from "drizzle-orm";
import type { Bindings } from "../env";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { getSetting } from "./settings";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export type GhlCustomFieldKey =
  | "webinar_date_eastern"
  | "join_link"
  | "short_join_link"
  | "registrant_id"
  | "attended_minutes";

// Display name for each auto-created GHL custom field. Change here if the user wants different labels.
export const GHL_FIELD_DEFINITIONS: Record<GhlCustomFieldKey, { name: string; dataType: "TEXT" | "NUMBER" }> = {
  webinar_date_eastern: { name: "Webinar Date/Time (ET)", dataType: "TEXT" },
  join_link: { name: "Join Link", dataType: "TEXT" },
  short_join_link: { name: "Short Join Link", dataType: "TEXT" },
  registrant_id: { name: "Zoom Registrant ID", dataType: "TEXT" },
  attended_minutes: { name: "Minutes Attended", dataType: "NUMBER" },
};

// Applied to a contact after the event, based on whether they showed up. Editable live from the
// Settings tab (stored in the `settings` table); falls back to the env var, then a hardcoded default.
export async function attendedTag(db: Db, env: Bindings): Promise<string> {
  return (await getSetting(db, "ghl_attended_tag")) || env.GHL_ATTENDED_TAG || "Webinar Attended";
}
export async function noShowTag(db: Db, env: Bindings): Promise<string> {
  return (await getSetting(db, "ghl_no_show_tag")) || env.GHL_NO_SHOW_TAG || "Webinar No-Show";
}

async function ghlFetch(env: Bindings, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GHL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GHL_PRIVATE_TOKEN}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function ghlJson<T>(env: Bindings, path: string, init: RequestInit = {}): Promise<T> {
  const res = await ghlFetch(env, path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GHL API ${init.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : ({} as T);
}

async function listCustomFields(env: Bindings, locationId: string) {
  const data = await ghlJson<{ customFields: { id: string; name: string }[] }>(
    env,
    `/locations/${locationId}/customFields`
  );
  return data.customFields ?? [];
}

async function createCustomField(env: Bindings, locationId: string, name: string, dataType: "TEXT" | "NUMBER") {
  const data = await ghlJson<{ customField: { id: string } }>(env, `/locations/${locationId}/customFields`, {
    method: "POST",
    body: JSON.stringify({ name, dataType, model: "contact" }),
  });
  return data.customField.id;
}

// Returns { webinar_date_eastern: "<ghl field id>", ... }, creating any missing fields in GHL first.
export async function ensureCustomFields(
  db: Db,
  env: Bindings,
  locationId: string
): Promise<Record<GhlCustomFieldKey, string>> {
  const keys = Object.keys(GHL_FIELD_DEFINITIONS) as GhlCustomFieldKey[];
  const result = {} as Record<GhlCustomFieldKey, string>;
  const missing: GhlCustomFieldKey[] = [];

  for (const key of keys) {
    const cached = await db
      .select()
      .from(schema.ghlCustomFields)
      .where(and(eq(schema.ghlCustomFields.locationId, locationId), eq(schema.ghlCustomFields.fieldKey, key)))
      .get();
    if (cached) {
      result[key] = cached.ghlFieldId;
    } else {
      missing.push(key);
    }
  }

  if (missing.length === 0) return result;

  const existingRemote = await listCustomFields(env, locationId);

  for (const key of missing) {
    const def = GHL_FIELD_DEFINITIONS[key];
    const existing = existingRemote.find((f) => f.name === def.name);
    const fieldId = existing ? existing.id : await createCustomField(env, locationId, def.name, def.dataType);
    result[key] = fieldId;
    await db
      .insert(schema.ghlCustomFields)
      .values({ locationId, fieldKey: key, ghlFieldId: fieldId })
      .onConflictDoNothing();
  }

  return result;
}

export type UpsertContactInput = {
  locationId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  customFields: { id: string; value: string }[];
};

export async function upsertContact(env: Bindings, input: UpsertContactInput): Promise<{ id: string }> {
  const data = await ghlJson<{ contact: { id: string } }>(env, `/contacts/upsert`, {
    method: "POST",
    body: JSON.stringify({
      locationId: input.locationId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      customFields: input.customFields,
    }),
  });
  return data.contact;
}

export async function enrollInWorkflow(env: Bindings, contactId: string, workflowId: string): Promise<void> {
  await ghlJson(env, `/contacts/${contactId}/workflow/${workflowId}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function addTags(env: Bindings, contactId: string, tags: string[]): Promise<void> {
  await ghlJson(env, `/contacts/${contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}
