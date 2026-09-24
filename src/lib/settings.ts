import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

export type SettingKey = "ghl_attended_tag" | "ghl_no_show_tag";

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
