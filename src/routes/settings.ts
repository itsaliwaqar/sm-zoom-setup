import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import { getSetting, setSetting } from "../lib/settings";
import { attendedTag, noShowTag } from "../lib/ghl";
import { clearAccessTokenCache, getAccessToken } from "../lib/zoom";
import { getCredentialStatuses, resolveCredentialKey, withCredentials } from "../lib/credentials";
import { requireAdminRole, requireAuth } from "../lib/auth";
import { getBaseUrl } from "../lib/baseUrl";

const app = new Hono<AppEnv>();

app.get("/", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const [attended, noShow, hyrosAttended, hyrosNoShow, bufferMinutes, effEnv] = await Promise.all([
    attendedTag(db, c.env),
    noShowTag(db, c.env),
    getSetting(db, "hyros_attended_tag").then((v) => v || "Webinar Attended"),
    getSetting(db, "hyros_no_show_tag").then((v) => v || "Webinar No-Show"),
    getSetting(db, "attendance_sync_buffer_minutes").then((v) => (v ? Number(v) : 10)),
    withCredentials(db, c.env),
  ]);
  return c.json({
    ghlAttendedTag: attended,
    ghlNoShowTag: noShow,
    hyrosAttendedTag: hyrosAttended,
    hyrosNoShowTag: hyrosNoShow,
    attendanceSyncBufferMinutes: bufferMinutes,
    publicBaseUrl: getBaseUrl(c),
    zoomConfigured: Boolean(effEnv.ZOOM_ACCOUNT_ID && effEnv.ZOOM_CLIENT_ID && effEnv.ZOOM_CLIENT_SECRET),
    ghlConfigured: Boolean(effEnv.GHL_PRIVATE_TOKEN && effEnv.GHL_DEFAULT_LOCATION_ID),
  });
});

app.patch("/", requireAuth, async (c) => {
  const body = await c.req.json<{
    ghlAttendedTag?: string;
    ghlNoShowTag?: string;
    hyrosAttendedTag?: string;
    hyrosNoShowTag?: string;
    attendanceSyncBufferMinutes?: number;
  }>();
  const db = getDb(c.env.DB);
  if (body.ghlAttendedTag) await setSetting(db, "ghl_attended_tag", body.ghlAttendedTag);
  if (body.ghlNoShowTag) await setSetting(db, "ghl_no_show_tag", body.ghlNoShowTag);
  if (body.hyrosAttendedTag) await setSetting(db, "hyros_attended_tag", body.hyrosAttendedTag);
  if (body.hyrosNoShowTag) await setSetting(db, "hyros_no_show_tag", body.hyrosNoShowTag);
  if (body.attendanceSyncBufferMinutes !== undefined) await setSetting(db, "attendance_sync_buffer_minutes", String(body.attendanceSyncBufferMinutes));
  return c.json({ ok: true });
});

app.get("/status", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const effEnv = await withCredentials(db, c.env);

  const zoom = await getAccessToken(effEnv)
    .then(() => ({ ok: true as const }))
    .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));

  const ghl = await fetch(`https://services.leadconnectorhq.com/locations/${effEnv.GHL_DEFAULT_LOCATION_ID}/customFields`, {
    headers: { Authorization: `Bearer ${effEnv.GHL_PRIVATE_TOKEN}`, Version: "2021-07-28" },
  })
    .then((res) => (res.ok ? { ok: true as const } : { ok: false as const, error: `HTTP ${res.status}` }))
    .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));

  return c.json({ zoom, ghl, checkedAt: new Date().toISOString() });
});

app.get("/api-key", requireAdminRole, async (c) => {
  return c.json({ apiKey: c.env.ADMIN_API_KEY });
});

// Zoom/GHL credentials, editable without a redeploy. Admin-only: these are the actual bearer
// credentials for two external systems, a step above what the shared API key should be able to read.
app.get("/credentials", requireAdminRole, async (c) => {
  const db = getDb(c.env.DB);
  return c.json(await getCredentialStatuses(db, c.env));
});

app.patch("/credentials", requireAdminRole, async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const db = getDb(c.env.DB);

  let updatedCount = 0;
  let touchedZoom = false;
  for (const [formKey, value] of Object.entries(body)) {
    if (!value) continue; // blank means "don't change this field"
    const key = resolveCredentialKey(formKey);
    if (!key) continue;
    await setSetting(db, key, value);
    updatedCount++;
    if (key.startsWith("zoom_")) touchedZoom = true;
  }
  if (updatedCount === 0) {
    return c.json({ error: "no recognized credential fields were provided" }, 400);
  }
  if (touchedZoom) await clearAccessTokenCache(c.env);

  return c.json(await getCredentialStatuses(db, c.env));
});

export default app;
