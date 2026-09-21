import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

export type ZoomEventRow = typeof schema.zoomEvents.$inferSelect;

// "Upcoming" = soonest future, non-cancelled event of `type`, optionally scoped to a series.
export async function resolveUpcomingEvent(
  db: Db,
  type: "webinar" | "meeting",
  seriesId?: string | null
): Promise<ZoomEventRow | undefined> {
  const conditions = [
    eq(schema.zoomEvents.type, type),
    eq(schema.zoomEvents.status, "scheduled"),
    gt(schema.zoomEvents.startTimeUtc, new Date()),
  ];
  if (seriesId) conditions.push(eq(schema.zoomEvents.seriesId, seriesId));

  return db
    .select()
    .from(schema.zoomEvents)
    .where(and(...conditions))
    .orderBy(asc(schema.zoomEvents.startTimeUtc))
    .limit(1)
    .get();
}

export async function resolveSpecificEvent(db: Db, zoomEventId: string): Promise<ZoomEventRow | undefined> {
  return db.select().from(schema.zoomEvents).where(eq(schema.zoomEvents.id, zoomEventId)).get();
}

export async function resolveEvent(
  db: Db,
  opts: { type: "webinar" | "meeting"; mode: "upcoming" | "specific"; seriesId?: string | null; zoomEventId?: string | null }
): Promise<ZoomEventRow | undefined> {
  if (opts.mode === "specific") {
    if (!opts.zoomEventId) return undefined;
    return resolveSpecificEvent(db, opts.zoomEventId);
  }
  return resolveUpcomingEvent(db, opts.type, opts.seriesId);
}
