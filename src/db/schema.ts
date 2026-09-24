import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`);

// A named "track" of recurring/related webinars or meetings, e.g. "tuesday-sales-webinar".
// "Upcoming" lookups and registration routes resolve against a series.
export const series = sqliteTable("series", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: ["webinar", "meeting"] }).notNull(),
  evergreenShortCode: text("evergreen_short_code"), // stable marketing link, repointed on each new event
  createdAt: createdAt(),
});

// A reusable Zoom create-payload (topic, agenda, duration, timezone, settings{...}).
export const templates = sqliteTable("templates", {
  id: id(),
  seriesId: text("series_id").notNull().references(() => series.id),
  name: text("name").notNull(),
  hostEmail: text("host_email").notNull(),
  zoomPayloadJson: text("zoom_payload_json").notNull(), // JSON string merged into Zoom create call
  createdAt: createdAt(),
});

// A due job that creates a real Zoom event when its time comes (recurring or one-off).
export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: id(),
  mode: text("mode", { enum: ["recurring", "once"] }).notNull(),
  seriesId: text("series_id").notNull().references(() => series.id),
  templateId: text("template_id").notNull().references(() => templates.id),
  recurrenceRuleJson: text("recurrence_rule_json"), // {dayOfWeek, time, tz} for recurring
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  runAtUtc: integer("run_at_utc", { mode: "timestamp" }).notNull(), // next time processDueJobs should fire this
  status: text("status", { enum: ["pending", "completed", "failed"] }).notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

// A concrete Zoom webinar/meeting that has been created via the Zoom API.
export const zoomEvents = sqliteTable("zoom_events", {
  id: id(),
  seriesId: text("series_id").references(() => series.id),
  type: text("type", { enum: ["webinar", "meeting"] }).notNull(),
  zoomId: text("zoom_id").notNull(),
  zoomUuid: text("zoom_uuid"),
  hostEmail: text("host_email").notNull(),
  topic: text("topic").notNull(),
  startTimeUtc: integer("start_time_utc", { mode: "timestamp" }).notNull(),
  startTimeIanaTz: text("start_time_iana_tz").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  joinUrl: text("join_url").notNull(),
  shortJoinCode: text("short_join_code"),
  status: text("status", { enum: ["scheduled", "occurred", "cancelled"] }).notNull().default("scheduled"),
  rawResponseJson: text("raw_response_json"),
  attendanceSyncedAt: integer("attendance_synced_at", { mode: "timestamp" }), // set once attendee report has been pulled + tagged in GHL
  createdAt: createdAt(),
});

// A saved webhook config: stable slug that ClickFunnels/GHL/Zapier POST contacts to.
export const registrationRoutes = sqliteTable("registration_routes", {
  id: id(),
  slug: text("slug").notNull().unique(),
  type: text("type", { enum: ["webinar", "meeting"] }).notNull(),
  selectionMode: text("selection_mode", { enum: ["upcoming", "specific"] }).notNull(),
  seriesId: text("series_id").references(() => series.id),
  specificZoomEventId: text("specific_zoom_event_id").references(() => zoomEvents.id),
  ghlWorkflowId: text("ghl_workflow_id").notNull(),
  ghlLocationId: text("ghl_location_id").notNull(),
  fieldMappingJson: text("field_mapping_json"), // {email:"email", firstName:"first_name", ...}
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

// A person registered into a zoom_event via a registration_route.
export const registrants = sqliteTable("registrants", {
  id: id(),
  registrationRouteId: text("registration_route_id").notNull().references(() => registrationRoutes.id),
  zoomEventId: text("zoom_event_id").notNull().references(() => zoomEvents.id),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  ghlContactId: text("ghl_contact_id"),
  zoomRegistrantId: text("zoom_registrant_id"),
  joinUrl: text("join_url"),
  shortJoinCode: text("short_join_code"),
  attendanceStatus: text("attendance_status", { enum: ["pending", "attended", "no_show"] }).notNull().default("pending"),
  attendedMinutes: integer("attended_minutes"),
  createdAt: createdAt(),
});

// General-purpose short links: evergreen (series), registrant-personal, or manual.
export const shortLinks = sqliteTable("short_links", {
  code: text("code").primaryKey(),
  targetUrl: text("target_url").notNull(),
  kind: text("kind", { enum: ["evergreen", "registrant", "manual"] }).notNull(),
  seriesId: text("series_id").references(() => series.id),
  registrantId: text("registrant_id").references(() => registrants.id),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

// Cache of GHL custom field IDs per location, so we don't recreate them every call.
export const ghlCustomFields = sqliteTable("ghl_custom_fields", {
  locationId: text("location_id").notNull(),
  fieldKey: text("field_key", {
    enum: ["webinar_date_eastern", "join_link", "short_join_link", "registrant_id", "attended_minutes"],
  }).notNull(),
  ghlFieldId: text("ghl_field_id").notNull(),
  createdAt: createdAt(),
}, (t) => ({
  pk: primaryKey({ columns: [t.locationId, t.fieldKey] }),
}));

// A person who can log into the admin UI.
export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  createdAt: createdAt(),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
});

// Small key/value store for the handful of settings that are worth editing without a redeploy
// (currently just the GHL attendance tag names). Deliberately not a general config store.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
