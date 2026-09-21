import { Hono } from "hono";
import type { AppEnv, Bindings } from "./env";
import { processDueJobs, processAttendanceSync } from "./scheduled";

import series from "./routes/series";
import templates from "./routes/templates";
import zoomCreate from "./routes/zoomCreate";
import zoomSchedule from "./routes/zoomSchedule";
import zoomEvents from "./routes/zoomEvents";
import upcoming from "./routes/upcoming";
import registrationRoutes from "./routes/registrationRoutes";
import registerWebhook from "./routes/registerWebhook";
import shortLinksAdmin from "./routes/shortLinksAdmin";
import shortLinkRedirect from "./routes/shortLinkRedirect";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));

// Admin API - each of these routers guards itself with X-API-Key (see requireAdminKey in each file).
// They are mounted at distinct sub-paths so their internal "*" middleware can never match a sibling
// route (e.g. /api/upcoming, which is intentionally public) - see note in that route's file.
app.route("/api/series", series);
app.route("/api/templates", templates);
app.route("/api/zoom/create", zoomCreate);
app.route("/api/zoom/schedule", zoomSchedule);
app.route("/api/zoom-events", zoomEvents);
app.route("/api/registration-routes", registrationRoutes);
app.route("/api/short-links", shortLinksAdmin);

// Public: date/time lookup (join links only included when a valid X-API-Key is sent)
app.route("/api/upcoming", upcoming);

// Public: webhook receiver for ClickFunnels / GHL workflows / Zapier
app.route("/webhooks/register", registerWebhook);

// Public: short link redirect
app.route("/s", shortLinkRedirect);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(processDueJobs(env));
    ctx.waitUntil(processAttendanceSync(env));
  },
};
