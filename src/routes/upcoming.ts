import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { resolveEvent } from "../lib/events";
import { formatEastern, formatEasternIso, formatEasternParts } from "../lib/time";
import { hasValidAdminKey } from "../lib/auth";
import { getBaseUrl } from "../lib/baseUrl";
import { shortLinkUrl } from "../lib/shortlinks";

const app = new Hono<AppEnv>();

// Public, unauthenticated (safe: no join link is included below), and read-only, so this is
// cached at Cloudflare's edge for a short window - it's meant to be hit from landing-page
// scripts on every page view, and the "upcoming" answer rarely changes more than once every
// several minutes. Caching keeps it fast and cheap to call at any volume without touching D1
// on every request. Admin-key requests (which include the raw join link) always bypass the
// cache and are computed fresh.
const PUBLIC_CACHE_SECONDS = 30;

app.get("/", async (c) => {
  const isAdmin = hasValidAdminKey(c);
  const cache = caches.default;

  if (!isAdmin) {
    const cached = await cache.match(c.req.raw);
    if (cached) return cached;
  }

  const type = c.req.query("type") as "webinar" | "meeting" | undefined;
  const mode = (c.req.query("mode") as "upcoming" | "specific" | undefined) ?? "upcoming";
  let seriesId = c.req.query("seriesId");
  const seriesSlug = c.req.query("seriesSlug");
  const zoomEventId = c.req.query("zoomEventId");

  if (!type || (type !== "webinar" && type !== "meeting")) {
    return c.json({ error: "type must be 'webinar' or 'meeting'" }, 400);
  }
  if (mode === "specific" && !zoomEventId) {
    return c.json({ error: "zoomEventId is required when mode=specific" }, 400);
  }

  const db = getDb(c.env.DB);

  if (!seriesId && seriesSlug) {
    const series = await db.select().from(schema.series).where(eq(schema.series.slug, seriesSlug)).get();
    if (!series) return c.json({ error: `no series found with slug "${seriesSlug}"` }, 404);
    seriesId = series.id;
  }

  const event = await resolveEvent(db, { type, mode, seriesId, zoomEventId });
  if (!event) {
    return c.json({ error: "no matching upcoming event found" }, 404);
  }

  const parts = formatEasternParts(event.startTimeUtc, event.durationMinutes);
  const base = {
    id: event.id,
    type: event.type,
    topic: event.topic,
    durationMinutes: event.durationMinutes,
    startTimeUtc: event.startTimeUtc.toISOString(),
    startTimeEastern: formatEastern(event.startTimeUtc),
    startTimeEasternIso: formatEasternIso(event.startTimeUtc),
    seriesId: event.seriesId,
    // Precomputed for landing-page embeds (e.g. a ClickFunnels header script) - already resolved
    // to Eastern server-side, so the page never needs to do its own timezone math.
    dateLabel: parts.dateLabel,
    timeLabel: parts.timeLabel,
    calDate: parts.calDate,
    calTime: parts.calTime,
    calEndTime: parts.calEndTime,
    // The short join link is meant to be public-facing (it's the whole point of the evergreen
    // link) - unlike the raw Zoom join_url/zoomId below, which stay admin-only.
    shortJoinUrl: event.shortJoinCode ? shortLinkUrl(getBaseUrl(c), event.shortJoinCode) : null,
  };

  if (isAdmin) {
    return c.json({ ...base, joinUrl: event.joinUrl, zoomId: event.zoomId });
  }

  const response = c.json(base);
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Cache-Control", `public, max-age=${PUBLIC_CACHE_SECONDS}`);
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
});

export default app;
