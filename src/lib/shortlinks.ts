import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/l/I

export function generateShortCode(length = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function createShortLink(
  db: DrizzleD1Database<typeof schema>,
  targetUrl: string,
  kind: "evergreen" | "registrant" | "manual",
  opts: { seriesId?: string; registrantId?: string } = {}
) {
  let code = generateShortCode();
  // Extremely unlikely to collide, but guard anyway since `code` is the primary key.
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db.select().from(schema.shortLinks).where(eq(schema.shortLinks.code, code)).get();
    if (!existing) break;
    code = generateShortCode();
  }
  await db.insert(schema.shortLinks).values({
    code,
    targetUrl,
    kind,
    seriesId: opts.seriesId ?? null,
    registrantId: opts.registrantId ?? null,
  });
  return code;
}

export async function repointShortLink(db: DrizzleD1Database<typeof schema>, code: string, newTargetUrl: string) {
  await db
    .update(schema.shortLinks)
    .set({ targetUrl: newTargetUrl, updatedAt: new Date() })
    .where(eq(schema.shortLinks.code, code));
}

export async function resolveShortLink(db: DrizzleD1Database<typeof schema>, code: string) {
  return db.select().from(schema.shortLinks).where(eq(schema.shortLinks.code, code)).get();
}

export function shortLinkUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, "")}/s/${code}`;
}
