import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import { resolveEvent } from "../lib/events";
import { formatEastern } from "../lib/time";
import { hasValidAdminKey } from "../lib/auth";
import { getBaseUrl } from "../lib/baseUrl";
import { shortLinkUrl } from "../lib/shortlinks";

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const type = c.req.query("type") as "webinar" | "meeting" | undefined;
  const mode = (c.req.query("mode") as "upcoming" | "specific" | undefined) ?? "upcoming";
  const seriesId = c.req.query("seriesId");
  const zoomEventId = c.req.query("zoomEventId");

  if (!type || (type !== "webinar" && type !== "meeting")) {
    return c.json({ error: "type must be 'webinar' or 'meeting'" }, 400);
  }
  if (mode === "specific" && !zoomEventId) {
    return c.json({ error: "zoomEventId is required when mode=specific" }, 400);
  }

  const db = getDb(c.env.DB);
  const event = await resolveEvent(db, { type, mode, seriesId, zoomEventId });
  if (!event) {
    return c.json({ error: "no matching upcoming event found" }, 404);
  }

  const base = {
    id: event.id,
    type: event.type,
    topic: event.topic,
    startTimeUtc: event.startTimeUtc.toISOString(),
    startTimeEastern: formatEastern(event.startTimeUtc),
    seriesId: event.seriesId,
  };

  if (!hasValidAdminKey(c)) return c.json(base);

  return c.json({
    ...base,
    joinUrl: event.joinUrl,
    shortJoinUrl: event.shortJoinCode ? shortLinkUrl(getBaseUrl(c), event.shortJoinCode) : null,
    zoomId: event.zoomId,
  });
});

export default app;
