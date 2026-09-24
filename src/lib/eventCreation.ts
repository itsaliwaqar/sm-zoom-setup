import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Bindings } from "../env";
import * as schema from "../db/schema";
import { createZoomEvent, type ZoomCreatePayload, type ZoomEventType } from "./zoom";
import { createShortLink, repointShortLink } from "./shortlinks";
import { withCredentials } from "./credentials";

export async function createAndStoreZoomEvent(
  db: Db,
  env: Bindings,
  opts: {
    type: ZoomEventType;
    hostEmail: string;
    payload: ZoomCreatePayload;
    series?: typeof schema.series.$inferSelect;
  }
) {
  const zoomEnv = await withCredentials(db, env);
  const zoomResult = await createZoomEvent(zoomEnv, opts.type, opts.hostEmail, opts.payload);

  let shortCode: string;
  if (opts.series) {
    if (opts.series.evergreenShortCode) {
      await repointShortLink(db, opts.series.evergreenShortCode, zoomResult.join_url);
      shortCode = opts.series.evergreenShortCode;
    } else {
      shortCode = await createShortLink(db, zoomResult.join_url, "evergreen", { seriesId: opts.series.id });
      await db.update(schema.series).set({ evergreenShortCode: shortCode }).where(eq(schema.series.id, opts.series.id));
    }
  } else {
    shortCode = await createShortLink(db, zoomResult.join_url, "manual");
  }

  const eventId = crypto.randomUUID();
  await db.insert(schema.zoomEvents).values({
    id: eventId,
    seriesId: opts.series?.id,
    type: opts.type,
    zoomId: String(zoomResult.id),
    zoomUuid: zoomResult.uuid,
    hostEmail: opts.hostEmail,
    topic: zoomResult.topic ?? opts.payload.topic,
    startTimeUtc: new Date(opts.payload.start_time),
    startTimeIanaTz: opts.payload.timezone ?? "UTC",
    durationMinutes: opts.payload.duration ?? 60,
    joinUrl: zoomResult.join_url,
    shortJoinCode: shortCode,
    rawResponseJson: JSON.stringify(zoomResult),
  });

  return db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, eventId)).get();
}
