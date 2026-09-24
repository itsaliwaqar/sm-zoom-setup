import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import { listCustomFields } from "../lib/ghl";
import { withCredentials } from "../lib/credentials";
import { requireAuth } from "../lib/auth";

const app = new Hono<AppEnv>();
app.use("*", requireAuth);

// Live list of GHL custom fields, used to populate the field-mapping dropdown in the
// Registration Routes UI.
app.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const effEnv = await withCredentials(db, c.env);
  const locationId = c.req.query("locationId") || effEnv.GHL_DEFAULT_LOCATION_ID;
  if (!locationId) return c.json({ error: "no GHL location configured" }, 400);

  const fields = await listCustomFields(effEnv, locationId);
  return c.json(fields.map((f) => ({ id: f.id, name: f.name })));
});

export default app;
