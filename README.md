# sm-zoom-setup

A Cloudflare Worker that automates the Zoom webinar/meeting workflow:

- Create Zoom webinars/meetings via API now, or on a schedule: one-off, or **recurring with a rolling window** (e.g. "every Sunday and Wednesday at 2pm ET, always with 2 weeks of meetings on the books" — every 15 minutes the worker fills in whatever occurrences are missing within the window, self-healing and duplicate-free).
- `GET /api/upcoming` — look up the next (or a specific) webinar/meeting's date & time in UTC/Eastern.
- `POST /webhooks/register/:slug` — a public webhook you paste into ClickFunnels, a GHL workflow, or Zapier. It registers the contact in Zoom, then per registration route (configurable from the admin UI, no code needed, all optional): syncs a GHL contact (date/time, join link, short join link, registrant ID, plus any extra tags/dynamic field mappings) and enrolls it in a workflow, inserts a row into a Google Sheet, upserts a SendBlue contact, tags a Hyros lead, and/or forwards the original payload plus the computed Zoom data to another webhook URL — each independently best-effort, so one failing never blocks the registration itself. GHL sync itself can be turned off entirely per route if you only want Zoom + the other integrations.
- Short links (`/s/:code`), including an "evergreen" link per series that automatically repoints to whichever webinar is currently upcoming.
- Post-event attendance sync: ~30 minutes after each event ends, pulls Zoom's attendee report and tags each contact in GHL as attended or no-show (plus a "Minutes Attended" custom field).
- A modern admin UI at `/admin/` (login-based, with admin/member user roles, a Settings tab, in-app API docs, and a Scopes tab listing every Zoom/GHL permission needed) for managing all of the above without hand-writing API calls.
- The Zoom access token is refreshed proactively every 30 minutes (it expires hourly) via a second Cron Trigger.
- A curated Zoom settings form (video/audio/registration/security/recording/webinar-specific) when creating templates or webinars/meetings, with a raw-JSON "advanced" override for anything not covered.

See `.claude`-generated plan for full architecture background if needed. Below is everything required to set this up from zero.

All credentials (Zoom, GHL, and optionally Google Sheets/SendBlue/Hyros for the extra registration-route integrations) can be entered from **Settings > Credentials** in the admin UI instead of `wrangler secret put` — see that tab for exactly which fields are configured vs. still missing, and the **Scopes** tab for what permissions each one needs.

## 1. Create the Zoom Server-to-Server OAuth app

1. Go to the [Zoom App Marketplace](https://marketplace.zoom.us/) → **Develop** → **Build App** → **Server-to-Server OAuth**.
2. Once created, copy the **Account ID**, **Client ID**, and **Client Secret** shown on the app's Credentials tab.
3. On the **Scopes** tab, add these (search each by name in the scope picker — Zoom occasionally renames scopes, so verify the closest match if a name below isn't found verbatim):
   - `meeting:write:meeting:admin` / `meeting:read:meeting:admin`
   - `meeting:write:registrant:admin` / `meeting:read:registrant:admin`
   - `webinar:write:webinar:admin` / `webinar:read:webinar:admin`
   - `webinar:write:registrant:admin` / `webinar:read:registrant:admin`
   - `user:read:user:admin` (lets the Worker resolve a host by email)
   - `report:read:webinar:admin` / `report:read:meeting:admin` (or the closest current granular equivalent, e.g. `report:read:list_meeting_participants:admin` — needed for the post-event attendance report; search "report" and "participant" in the scope picker if these exact names aren't found)
4. Activate the app.
5. Make sure the host account(s) you'll use (`hostEmail` in templates) have a **Zoom license that supports Webinars** if you're creating webinars — meetings work on any licensed user.

## 2. Create the GHL Private Integration

1. In the GHL sub-account (or agency) → **Settings** → **Private Integrations** → **Create new integration**.
2. Grant these scopes:
   - `contacts.readonly`, `contacts.write`
   - `locations/customFields.readonly`, `locations/customFields.write`
   - `workflows.readonly` (to look up workflow IDs — find them in the workflow's URL or via the GHL API)
   - `contacts/tags` write access is included under `contacts.write` (used to tag attended/no-show)
3. Copy the generated token and the **Location ID** you'll use by default.
4. The five contact custom fields (`Webinar Date/Time (ET)`, `Join Link`, `Short Join Link`, `Zoom Registrant ID`, `Minutes Attended`) are created automatically the first time they're needed — you don't need to pre-create them.

## 3. Provision Cloudflare resources

```bash
npx wrangler d1 create zoom_setup_db
# copy the returned database_id into wrangler.toml under [[d1_databases]]

npx wrangler kv namespace create CACHE_KV
# copy the returned id into wrangler.toml under [[kv_namespaces]]
```

Apply the schema:

```bash
npm run db:migrate:remote
```

## 4. Set secrets

```bash
npx wrangler secret put ADMIN_API_KEY          # any long random string — for scripted/Zapier access to /api/*
npx wrangler secret put ZOOM_ACCOUNT_ID
npx wrangler secret put ZOOM_CLIENT_ID
npx wrangler secret put ZOOM_CLIENT_SECRET
npx wrangler secret put GHL_PRIVATE_TOKEN
npx wrangler secret put GHL_DEFAULT_LOCATION_ID
```

Optionally set these in `wrangler.toml` under `[vars]`:
- `PUBLIC_BASE_URL` — once you know your deployed URL (used to build short link and webhook URLs); otherwise it's inferred from the incoming request.
- `GHL_ATTENDED_TAG` / `GHL_NO_SHOW_TAG` — override the default tag names (`Webinar Attended` / `Webinar No-Show`) applied after each event.

## 5. Local dev

```bash
npm install
npm run db:migrate:local
npm run dev
```

Then open `http://localhost:8787/admin/` — the first visit shows a **Create your admin account** screen (this only happens once, while no users exist yet). After that, everyone signs in with email/password. Admins can invite teammates from the Users tab; the shared `ADMIN_API_KEY` is only needed for scripted access (Zapier, curl, etc.) and can be copied from the Settings tab.

## 6. Deploy

```bash
npm run deploy
```

---

## Concepts

- **Series** — a named track of recurring/related events, e.g. `tuesday-sales-webinar`. "Upcoming" lookups and registration routes resolve against a series so you can run multiple concurrent webinar funnels without ambiguity.
- **Template** — a saved Zoom create-payload (topic, duration, `settings{...}` — the full Zoom API body) tied to a series and host email. Reused for both immediate and scheduled creation.
- **Scheduled job** — either `recurring` (auto-creates the next occurrence N days ahead of a weekly cadence) or `once` (creates a specific webinar/meeting at a future run time). Processed by a Cron Trigger every 15 minutes.
- **Registration route** — a saved webhook config (`/webhooks/register/:slug`) that ties together: which series/event to register into, which GHL workflow to enroll the contact in, and how to map incoming payload fields to name/email/phone.

## API reference

All `/api/*` routes accept either a logged-in session cookie (what the admin UI uses) or header `X-API-Key: <ADMIN_API_KEY>` (for scripts/Zapier), except `/api/users` and `/api/settings/api-key`, which require a logged-in **admin** session — the shared key can't manage accounts. This is also documented interactively in the admin UI's API Docs tab.

### Series
```
POST /api/series           { slug, name, type: "webinar"|"meeting" }
GET  /api/series
GET  /api/series/:id
```

### Templates
```
POST /api/templates        { seriesId, name, hostEmail, zoomPayload: {...} }
GET  /api/templates
GET  /api/templates/:id
```
`zoomPayload` is passed straight through to Zoom's create-meeting/create-webinar API (minus `start_time`, which you supply separately) — so any Zoom setting is available, e.g.:
```json
{
  "topic": "Weekly Sales Webinar",
  "agenda": "...",
  "duration": 60,
  "timezone": "America/New_York",
  "settings": {
    "approval_type": 0,
    "registrants_email_notification": true,
    "practice_session": true,
    "hd_video": true
  }
}
```

### Create a webinar/meeting now
```
POST /api/zoom/create
{
  "type": "webinar",
  "seriesId": "...",       // optional — enables the series' evergreen short link
  "templateId": "...",     // optional — merged as the base payload
  "startTime": "2026-01-14T19:00:00Z",
  "hostEmail": "host@company.com",   // optional if templateId supplies it
  "zoomPayload": { ... }   // optional overrides merged over the template
}
```

### Schedule creation
```
POST /api/zoom/schedule
# Recurring:
{ "mode": "recurring", "seriesId": "...", "templateId": "...",
  "recurrenceRule": { "dayOfWeek": 2, "time": "19:00", "tz": "America/New_York" },
  "leadTimeDays": 7 }

# One-off:
{ "mode": "once", "seriesId": "...", "templateId": "...",
  "eventStartTime": "2026-02-03T19:00:00Z", "createAt": "2026-01-27T00:00:00Z" }

GET    /api/zoom/schedule
DELETE /api/zoom/schedule/:id
```

### Zoom events & attendance
```
GET  /api/zoom-events              # all created webinars/meetings
GET  /api/zoom-events/:id          # one event, including its registrants + attendanceStatus
POST /api/zoom-events/:id/sync-attendance   # manually (re-)pull the Zoom attendee report now
```
Attendance is normally synced automatically: ~30 minutes after an event's `startTime + duration` passes, the Cron Trigger pulls Zoom's attendee report (`/report/webinars/.../participants` or `/report/meetings/.../participants`), sets each registrant's `attendanceStatus` to `attended` or `no_show` (any time present counts as attended), writes their total minutes present to the GHL "Minutes Attended" custom field, and tags the GHL contact with `GHL_ATTENDED_TAG` or `GHL_NO_SHOW_TAG` (defaults: `Webinar Attended` / `Webinar No-Show`). Use `sync-attendance` to trigger it immediately instead of waiting, or to re-run it (safe to call repeatedly).

### Upcoming lookup (public; join links require the API key)
```
GET /api/upcoming?type=webinar&mode=upcoming&seriesId=...
GET /api/upcoming?type=webinar&mode=specific&zoomEventId=...
```
Without `X-API-Key`: `{ topic, startTimeUtc, startTimeEastern }`.
With `X-API-Key`: adds `joinUrl`, `shortJoinUrl`, `zoomId`.

### Registration routes
```
POST /api/registration-routes
{
  "type": "webinar", "selectionMode": "upcoming", "seriesId": "...",
  "ghlWorkflowId": "...", "ghlLocationId": "...",   // optional, defaults to GHL_DEFAULT_LOCATION_ID
  "fieldMapping": { "email": "Email", "firstName": "First Name" }  // optional, overrides default key sniffing
}
# → returns { ..., webhookUrl: "https://.../webhooks/register/<slug>" }

GET/PATCH/DELETE /api/registration-routes/:id
```

### Public registration webhook
Paste the returned `webhookUrl` into ClickFunnels' webhook action, a GHL workflow's "Webhook" step, or a Zapier "Webhooks by Zapier" action. Send the contact as JSON — the endpoint auto-detects common key names (`email`/`Email`, `firstName`/`first_name`/`First Name`, etc.) or uses the route's `fieldMapping` if set.

```
POST /webhooks/register/:slug
{ "email": "jane@example.com", "firstName": "Jane", "lastName": "Doe", "phone": "+15551234567" }
```

Query params can override the saved route per-call: `?type=meeting&mode=specific&zoomEventId=...&workflowId=...&locationId=...`.

Response: `{ registrantId, zoomRegistrantId, zoomEventId, joinUrl, shortJoinUrl, ghlContactId }`.

### Short links
```
POST  /api/short-links          { targetUrl }
PATCH /api/short-links/:code    { targetUrl }
GET   /s/:code                  (public 302 redirect)
```

## Testing the full flow

1. `POST /api/series` to create a series.
2. `POST /api/templates` with a real Zoom payload and a host email that exists on your Zoom account.
3. `POST /api/zoom/create` to create a webinar right now — confirm it shows up in the Zoom dashboard.
4. `GET /api/upcoming?type=webinar&mode=upcoming&seriesId=<id>` — confirm the UTC/Eastern time is correct.
5. `POST /api/registration-routes` with a real GHL workflow ID — copy the returned `webhookUrl`.
6. `POST` a sample contact to that `webhookUrl` — confirm: a registrant appears in Zoom, a contact appears/updates in GHL with the four custom fields populated, and the contact is enrolled in the workflow.
7. `GET /s/<shortJoinCode>` — confirm it redirects to the Zoom join link.
8. To test the cron path without waiting 15 minutes, run `wrangler dev --test-scheduled` and hit `http://localhost:8787/__scheduled` (wrangler's local scheduled-event trigger) after creating a recurring job with `createAt`/`runAt` in the past.
9. After the webinar/meeting actually happens (and a registrant did or didn't join), call `POST /api/zoom-events/<id>/sync-attendance` — confirm the registrant's `attendanceStatus` updates and the GHL contact gets tagged `Webinar Attended`/`Webinar No-Show` with `Minutes Attended` set.
