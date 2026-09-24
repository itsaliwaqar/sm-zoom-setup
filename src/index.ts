import { Hono } from "hono";
import type { AppEnv, Bindings } from "./env";
import { processDueJobs, processAttendanceSync } from "./scheduled";
import { refreshAccessToken } from "./lib/zoom";
import { getDb } from "./db/client";
import { withCredentials } from "./lib/credentials";

import auth from "./routes/auth";
import users from "./routes/users";
import settings from "./routes/settings";
import series from "./routes/series";
import templates from "./routes/templates";
import zoomCreate from "./routes/zoomCreate";
import zoomSchedule from "./routes/zoomSchedule";
import zoomEvents from "./routes/zoomEvents";
import upcoming from "./routes/upcoming";
import registrationRoutes from "./routes/registrationRoutes";
import registerWebhook from "./routes/registerWebhook";
import ghlFields from "./routes/ghlFields";
import shortLinksAdmin from "./routes/shortLinksAdmin";
import shortLinkRedirect from "./routes/shortLinkRedirect";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));

// Public: login/setup/session endpoints for the admin UI.
app.route("/auth", auth);

// Admin API - each of these routers guards itself (see requireAuth/requireAdminRole in each
// file: a logged-in session OR the shared X-API-Key both work, except user management which is
// session-only). Mounted at distinct sub-paths so their internal "*" middleware can never match a
// sibling route (e.g. /api/upcoming, which is intentionally public).
app.route("/api/users", users);
app.route("/api/settings", settings);
app.route("/api/series", series);
app.route("/api/templates", templates);
app.route("/api/zoom/create", zoomCreate);
app.route("/api/zoom/schedule", zoomSchedule);
app.route("/api/zoom-events", zoomEvents);
app.route("/api/registration-routes", registrationRoutes);
app.route("/api/short-links", shortLinksAdmin);
app.route("/api/ghl/custom-fields", ghlFields);

// Public: date/time lookup (join links only included when a valid X-API-Key is sent)
app.route("/api/upcoming", upcoming);

// Public: webhook receiver for ClickFunnels / GHL workflows / Zapier
app.route("/webhooks/register", registerWebhook);

// Public: short link redirect
app.route("/s", shortLinkRedirect);

// Any uncaught error (e.g. a misconfigured Zoom/GHL/Sheets/SendBlue/Hyros credential, or a
// downstream API rejecting a request) becomes a JSON error instead of Hono's plain-text default,
// consistent with every other error response in this app.
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "internal error" }, 500);
});

// Fallback: serve static assets (admin UI, etc.) for any path the Worker didn't handle.
// Required because run_worker_first=true sends every request through this Worker first.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    if (event.cron === "*/30 * * * *") {
      ctx.waitUntil(withCredentials(getDb(env.DB), env).then(refreshAccessToken));
      return;
    }
    ctx.waitUntil(processDueJobs(env));
    ctx.waitUntil(processAttendanceSync(env));
  },
};
