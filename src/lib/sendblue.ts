import type { Bindings } from "../env";

const SENDBLUE_API_BASE = "https://api.sendblue.com/api/v2";

export type SendblueUpsertInput = {
  number: string; // E.164 phone number
  firstName?: string;
  lastName?: string;
  tags?: string[];
  customVariables?: Record<string, string>;
};

// Uses POST /contacts with update_if_exists so this upserts by phone number in one call.
export async function upsertContact(env: Bindings, input: SendblueUpsertInput): Promise<void> {
  if (!env.SENDBLUE_API_KEY_ID || !env.SENDBLUE_API_SECRET_KEY) {
    throw new Error("SendBlue API credentials are not configured (Settings > Credentials)");
  }
  const res = await fetch(`${SENDBLUE_API_BASE}/contacts`, {
    method: "POST",
    headers: {
      "sb-api-key-id": env.SENDBLUE_API_KEY_ID,
      "sb-api-secret-key": env.SENDBLUE_API_SECRET_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      number: input.number,
      first_name: input.firstName,
      last_name: input.lastName,
      tags: input.tags ?? [],
      custom_variables: input.customVariables ?? {},
      update_if_exists: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`SendBlue contact upsert failed: ${res.status} ${await res.text()}`);
  }
}
