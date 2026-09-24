import type { Bindings } from "../env";

export type HyrosTagInput = {
  email: string;
  tags: string[];
  source?: string;
};

// Creates/updates the lead and applies tags in one call - Hyros dedupes leads by email.
export async function tagLead(env: Bindings, input: HyrosTagInput): Promise<void> {
  if (!env.HYROS_API_KEY) {
    throw new Error("Hyros API key is not configured (Settings > Credentials)");
  }
  const res = await fetch("https://api.hyros.com/v1/leads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.HYROS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      source: input.source ?? "sm-zoom-setup",
      tags: input.tags,
    }),
  });
  if (!res.ok) {
    throw new Error(`Hyros lead tag failed: ${res.status} ${await res.text()}`);
  }
}
