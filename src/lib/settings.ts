import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

export type SettingKey =
  | "ghl_attended_tag"
  | "ghl_no_show_tag"
  | "zoom_account_id"
  | "zoom_client_id"
  | "zoom_client_secret"
  | "ghl_private_token"
  | "ghl_default_location_id"
  | "google_service_account_json"
  | "sendblue_api_key_id"
  | "sendblue_api_secret_key"
  | "hyros_api_key";

export async function getSetting(db: Db, key: SettingKey): Promise<string | undefined> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row?.value;
}

export async function setSetting(db: Db, key: SettingKey, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}
