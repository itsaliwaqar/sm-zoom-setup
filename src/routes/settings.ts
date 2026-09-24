import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import { getSetting, setSetting } from "../lib/settings";
import { attendedTag, noShowTag } from "../lib/ghl";
import { getAccessToken } from "../lib/zoom";
import { requireAdminRole, requireAuth } from "../lib/auth";
import { getBaseUrl } from "../lib/baseUrl";

const app = new Hono<AppEnv>();

app.get("/", requireAuth, async (c) => {
  const db = getDb(c.env.DB);
  const [attended, noShow] = await Promise.all([attendedTag(db, c.env), noShowTag(db, c.env)]);
  return c.json({
    ghlAttendedTag: attended,
    ghlNoShowTag: noShow,
    publicBaseUrl: getBaseUrl(c),
    zoomConfigured: Boolean(c.env.ZOOM_ACCOUNT_ID && c.env.ZOOM_CLIENT_ID && c.env.ZOOM_CLIENT_SECRET),
    ghlConfigured: Boolean(c.env.GHL_PRIVATE_TOKEN && c.env.GHL_DEFAULT_LOCATION_ID),
  });
});

app.patch("/", requireAuth, async (c) => {
  const body = await c.req.json<{ ghlAttendedTag?: string; ghlNoShowTag?: string }>();
  const db = getDb(c.env.DB);
  if (body.ghlAttendedTag) await setSetting(db, "ghl_attended_tag", body.ghlAttendedTag);
  if (body.ghlNoShowTag) await setSetting(db, "ghl_no_show_tag", body.ghlNoShowTag);
  return c.json({ ok: true });
});

app.get("/status", requireAuth, async (c) => {
  const zoom = await getAccessToken(c.env)
    .then(() => ({ ok: true as const }))
    .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));

  const ghl = await fetch(`https://services.leadconnectorhq.com/locations/${c.env.GHL_DEFAULT_LOCATION_ID}/customFields`, {
    headers: { Authorization: `Bearer ${c.env.GHL_PRIVATE_TOKEN}`, Version: "2021-07-28" },
  })
    .then((res) => (res.ok ? { ok: true as const } : { ok: false as const, error: `HTTP ${res.status}` }))
    .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));

  return c.json({ zoom, ghl, checkedAt: new Date().toISOString() });
});

app.get("/api-key", requireAdminRole, async (c) => {
  return c.json({ apiKey: c.env.ADMIN_API_KEY });
});

export default app;
