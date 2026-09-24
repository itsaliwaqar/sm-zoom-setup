import type { Db } from "../db/client";
import type { Bindings } from "../env";
import { getSetting, setSetting, type SettingKey } from "./settings";

// Credentials editable from the Settings tab (no redeploy needed - they override the deployed
// Worker secrets of the same purpose the moment they're saved). Deploy-time secrets remain the
// fallback, so a worker that was set up via `wrangler secret put` keeps working unchanged.
export const CREDENTIAL_FIELDS = [
  { key: "zoom_account_id", envVar: "ZOOM_ACCOUNT_ID", label: "Zoom Account ID", secret: false },
  { key: "zoom_client_id", envVar: "ZOOM_CLIENT_ID", label: "Zoom Client ID", secret: false },
  { key: "zoom_client_secret", envVar: "ZOOM_CLIENT_SECRET", label: "Zoom Client Secret", secret: true },
  { key: "ghl_private_token", envVar: "GHL_PRIVATE_TOKEN", label: "GHL Private Integration Token", secret: true },
  { key: "ghl_default_location_id", envVar: "GHL_DEFAULT_LOCATION_ID", label: "GHL Default Location ID", secret: false },
] as const satisfies readonly { key: SettingKey; envVar: keyof Bindings; label: string; secret: boolean }[];

export type CredentialFieldKey = (typeof CREDENTIAL_FIELDS)[number]["key"];

export type CredentialStatus = {
  key: CredentialFieldKey;
  label: string;
  secret: boolean;
  source: "db" | "env" | "unset";
  value: string | null; // full value for non-secret fields; null for secret fields (masked instead)
  masked: string | null; // last 4 chars, only for secret fields that are configured
};

export async function getCredentialStatuses(db: Db, env: Bindings): Promise<CredentialStatus[]> {
  const statuses: CredentialStatus[] = [];
  for (const f of CREDENTIAL_FIELDS) {
    const dbValue = await getSetting(db, f.key);
    const envValue = env[f.envVar] as string | undefined;
    const effective = dbValue || envValue;
    const source: CredentialStatus["source"] = dbValue ? "db" : envValue ? "env" : "unset";
    statuses.push({
      key: f.key,
      label: f.label,
      secret: f.secret,
      source,
      value: !f.secret && effective ? effective : null,
      masked: f.secret && effective ? `••••${effective.slice(-4)}` : null,
    });
  }
  return statuses;
}

export async function setCredential(db: Db, key: CredentialFieldKey, value: string): Promise<void> {
  await setSetting(db, key, value);
}

// Returns a Bindings-shaped object with any DB-stored credential overriding the deployed secret.
// Pass this (instead of the raw request env) into zoom.ts/ghl.ts calls so a value saved in
// Settings takes effect on the very next request, without a redeploy.
export async function withCredentials(db: Db, env: Bindings): Promise<Bindings> {
  const overrides: Partial<Bindings> = {};
  for (const f of CREDENTIAL_FIELDS) {
    const stored = await getSetting(db, f.key);
    if (stored) (overrides as Record<string, string>)[f.envVar] = stored;
  }
  return { ...env, ...overrides };
}
