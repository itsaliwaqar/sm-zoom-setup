"use strict";

/* ================= Dashboard ================= */
async function tabDashboard(section) {
  section.appendChild(pageHeader("Dashboard", "An overview of your Zoom automation workspace."));

  const grid = el("div", { class: "grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6" });
  section.appendChild(grid);
  const upcomingHost = el("div", {});
  section.appendChild(upcomingHost);

  function statCard(label, value, iconName) {
    return card([
      el("div", { class: "p-5 flex items-center gap-4" }, [
        el("div", { class: "w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0", html: icon(iconName, "w-5 h-5") }),
        el("div", {}, [
          el("p", { class: "text-2xl font-semibold text-slate-900 dark:text-white", text: String(value) }),
          el("p", { class: "text-sm text-slate-500 dark:text-slate-400", text: label }),
        ]),
      ]),
    ]);
  }

  const [series, events, routes] = await Promise.all([
    api("/api/series"),
    api("/api/zoom-events"),
    api("/api/registration-routes"),
  ]);

  grid.appendChild(statCard("Series", series.length, "layers"));
  grid.appendChild(statCard("Zoom events", events.length, "video"));
  grid.appendChild(statCard("Registration routes", routes.length, "route"));

  const upcoming = events
    .filter((e) => e.status === "scheduled" && new Date(e.startTimeUtc) > new Date())
    .sort((a, b) => new Date(a.startTimeUtc) - new Date(b.startTimeUtc))[0];

  upcomingHost.appendChild(
    card([
      el("div", { class: "p-5" }, [
        el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3", text: "Next upcoming event" }),
        upcoming
          ? el("div", { class: "flex items-center justify-between flex-wrap gap-3" }, [
              el("div", {}, [
                el("p", { class: "font-medium text-slate-900 dark:text-white", text: upcoming.topic }),
                el("p", { class: "text-sm text-slate-500 dark:text-slate-400", text: `${upcoming.type} - ${new Date(upcoming.startTimeUtc).toUTCString()}` }),
              ]),
              badge(upcoming.status, "green"),
            ])
          : el("p", { class: "text-sm text-slate-400", text: "No upcoming events scheduled yet." }),
      ]),
    ])
  );
}

/* ================= Series ================= */
async function tabSeries(section) {
  section.appendChild(pageHeader("Series", "Group related recurring webinars/meetings so “upcoming” lookups are unambiguous."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const form = el("form", { class: "grid sm:grid-cols-3 gap-3 items-end" }, [
    field("Slug", input({ name: "slug", required: true, placeholder: "tuesday-sales-webinar" })),
    field("Name", input({ name: "name", required: true, placeholder: "Tuesday Sales Webinar" })),
    field("Type", select([{ value: "webinar", label: "Webinar" }, { value: "meeting", label: "Meeting" }], { name: "type" })),
    btn("Create series", { type: "submit", icon: "plus", cls: "sm:col-span-3 justify-center sm:w-fit" }),
  ]);
  section.appendChild(card([el("div", { class: "p-5" }, form)], "mb-6"));

  const tableHost = el("div", {});
  section.appendChild(card([tableHost]));

  async function load() {
    const rows = await api("/api/series");
    tableHost.innerHTML = "";
    tableHost.appendChild(
      table(
        ["Slug", "Name", "Type", "Evergreen link", "ID"],
        rows.map((r) => [
          td(el("span", { class: "font-medium", text: r.slug })),
          td(r.name),
          td(badge(r.type, r.type === "webinar" ? "indigo" : "slate")),
          td(r.evergreenShortCode ? el("div", { class: "flex items-center gap-1" }, [codeValue(`${location.origin}/s/${r.evergreenShortCode}`), copyButton(`${location.origin}/s/${r.evergreenShortCode}`)]) : el("span", { class: "text-slate-400", text: "-" })),
          td(el("div", { class: "flex items-center gap-1" }, [codeValue(r.id), copyButton(r.id)])),
        ])
      )
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/series", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      banner(msgHost, "Series created.", "ok");
      form.reset();
      load();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  await load();
}

/* ================= Templates ================= */
async function tabTemplates(section) {
  section.appendChild(pageHeader("Templates", "A reusable Zoom create-payload (topic, duration, settings) tied to a series."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const seriesRows = await api("/api/series");
  const seriesOptions = seriesRows.map((s) => ({ value: s.id, label: `${s.name} (${s.slug})` }));

  const form = el("form", { class: "grid sm:grid-cols-2 gap-3" }, [
    field("Series", select(seriesOptions.length ? seriesOptions : [{ value: "", label: "Create a series first" }], { name: "seriesId" })),
    field("Template name", input({ name: "name", required: true })),
    field("Host email", input({ name: "hostEmail", type: "email", required: true })),
    el("div", { class: "sm:col-span-2" }, field("Zoom payload (JSON)", textarea({ name: "zoomPayload", text: JSON.stringify({ topic: "Weekly Sales Webinar", duration: 60, settings: { approval_type: 0, registrants_email_notification: true } }, null, 2) }))),
    btn("Create template", { type: "submit", icon: "plus", cls: "sm:col-span-2 justify-center sm:w-fit" }),
  ]);
  section.appendChild(card([el("div", { class: "p-5" }, form)], "mb-6"));

  const tableHost = el("div", {});
  section.appendChild(card([tableHost]));

  async function load() {
    const rows = await api("/api/templates");
    tableHost.innerHTML = "";
    tableHost.appendChild(
      table(
        ["Name", "Host", "Series ID", "ID"],
        rows.map((r) => [td(el("span", { class: "font-medium", text: r.name })), td(r.hostEmail), td(codeValue(r.seriesId)), td(el("div", { class: "flex items-center gap-1" }, [codeValue(r.id), copyButton(r.id)]))])
      )
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(form));
      body.zoomPayload = JSON.parse(body.zoomPayload);
      await api("/api/templates", { method: "POST", body: JSON.stringify(body) });
      banner(msgHost, "Template created.", "ok");
      load();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  await load();
}

/* ================= Zoom Events & Attendance ================= */
async function tabEvents(section) {
  section.appendChild(pageHeader("Zoom Events", "Create a webinar/meeting right now, and track post-event attendance."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const form = el("form", { class: "grid sm:grid-cols-2 gap-3" }, [
    field("Type", select([{ value: "webinar", label: "Webinar" }, { value: "meeting", label: "Meeting" }], { name: "type" })),
    field("Template ID", input({ name: "templateId", placeholder: "optional" })),
    field("Series ID", input({ name: "seriesId", placeholder: "optional" })),
    field("Start time (UTC ISO)", input({ name: "startTime", required: true, placeholder: "2026-01-14T19:00:00Z" })),
    field("Host email (override)", input({ name: "hostEmail", placeholder: "optional if template supplies it" })),
    btn("Create in Zoom now", { type: "submit", icon: "plus", cls: "sm:col-span-2 justify-center sm:w-fit" }),
  ]);
  section.appendChild(card([el("div", { class: "p-5" }, form)], "mb-6"));

  const tableHost = el("div", {});
  section.appendChild(card([tableHost]));

  async function load() {
    const rows = await api("/api/zoom-events");
    tableHost.innerHTML = "";
    tableHost.appendChild(
      table(
        ["Topic", "Type", "Start (UTC)", "Status", "Attendance", "Links", ""],
        rows.map((r) => {
          const syncBtn = btn(r.attendanceSyncedAt ? "Re-sync" : "Sync now", {
            variant: "secondary",
            icon: "refresh",
            onClick: async (e) => {
              e.target.closest("button").disabled = true;
              try {
                await api(`/api/zoom-events/${r.id}/sync-attendance`, { method: "POST" });
                banner(msgHost, `Attendance synced for "${r.topic}".`, "ok");
                load();
              } catch (err) {
                banner(msgHost, err.message, "err");
              }
            },
          });
          return [
            td(el("span", { class: "font-medium", text: r.topic })),
            td(badge(r.type, r.type === "webinar" ? "indigo" : "slate")),
            td(new Date(r.startTimeUtc).toUTCString()),
            td(badge(r.status, r.status === "scheduled" ? "amber" : r.status === "occurred" ? "green" : "red")),
            td(r.attendanceSyncedAt ? el("span", { class: "text-emerald-600 dark:text-emerald-400 text-xs", text: `synced ${new Date(r.attendanceSyncedAt).toLocaleString()}` }) : el("span", { class: "text-slate-400 text-xs", text: "not yet" })),
            td(r.shortJoinUrl ? el("div", { class: "flex items-center gap-1" }, [codeValue(r.shortJoinUrl), copyButton(r.shortJoinUrl)]) : "-"),
            td(syncBtn),
          ];
        })
      )
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = Object.fromEntries(new FormData(form));
      Object.keys(fd).forEach((k) => { if (!fd[k]) delete fd[k]; });
      await api("/api/zoom/create", { method: "POST", body: JSON.stringify(fd) });
      banner(msgHost, "Event created in Zoom.", "ok");
      form.reset();
      load();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  await load();
}

/* ================= Scheduled Jobs ================= */
async function tabSchedule(section) {
  section.appendChild(pageHeader("Scheduled Jobs", "Recurring auto-creation, or a one-off future create - processed every 15 minutes."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const modeSelect = select([{ value: "recurring", label: "Recurring" }, { value: "once", label: "One-off" }], { name: "mode" });
  const recurringFields = el("div", { class: "grid sm:grid-cols-4 gap-3 sm:col-span-2" }, [
    field("Day of week (0=Sun)", input({ name: "dayOfWeek", type: "number", min: 0, max: 6, value: 2 })),
    field("Time (HH:MM)", input({ name: "time", value: "19:00" })),
    field("Timezone", input({ name: "tz", value: "America/New_York" })),
    field("Lead time (days)", input({ name: "leadTimeDays", type: "number", value: 7 })),
  ]);
  const onceFields = el("div", { class: "grid sm:grid-cols-2 gap-3 sm:col-span-2 hidden" }, [
    field("Event start time (UTC ISO)", input({ name: "eventStartTime", placeholder: "2026-02-03T19:00:00Z" })),
    field("Create at (UTC ISO, optional)", input({ name: "createAt", placeholder: "defaults to now" })),
  ]);
  modeSelect.addEventListener("change", () => {
    recurringFields.classList.toggle("hidden", modeSelect.value !== "recurring");
    onceFields.classList.toggle("hidden", modeSelect.value !== "once");
  });

  const form = el("form", { class: "grid sm:grid-cols-2 gap-3" }, [
    field("Mode", modeSelect),
    el("div", {}),
    field("Series ID", input({ name: "seriesId", required: true })),
    field("Template ID", input({ name: "templateId", required: true })),
    recurringFields,
    onceFields,
    btn("Schedule job", { type: "submit", icon: "plus", cls: "sm:col-span-2 justify-center sm:w-fit" }),
  ]);
  section.appendChild(card([el("div", { class: "p-5" }, form)], "mb-6"));

  const tableHost = el("div", {});
  section.appendChild(card([tableHost]));

  async function load() {
    const rows = await api("/api/zoom/schedule");
    tableHost.innerHTML = "";
    tableHost.appendChild(
      table(
        ["Mode", "Status", "Next run (UTC)", "Series", "Error", ""],
        rows.map((r) => [
          td(r.mode),
          td(badge(r.status, r.status === "pending" ? "amber" : r.status === "completed" ? "green" : "red")),
          td(new Date(r.runAtUtc).toUTCString()),
          td(codeValue(r.seriesId)),
          td(r.lastError ? el("span", { class: "text-red-600 dark:text-red-400 text-xs", text: r.lastError }) : "-"),
          td(
            iconBtn("trash", {
              title: "Delete",
              onClick: async () => {
                await api(`/api/zoom/schedule/${r.id}`, { method: "DELETE" });
                load();
              },
            })
          ),
        ])
      )
    );
  }

  modeSelect.dispatchEvent(new Event("change"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = { mode: fd.mode, seriesId: fd.seriesId, templateId: fd.templateId };
    if (fd.mode === "recurring") {
      body.recurrenceRule = { dayOfWeek: Number(fd.dayOfWeek), time: fd.time, tz: fd.tz };
      body.leadTimeDays = Number(fd.leadTimeDays || 0);
    } else {
      body.eventStartTime = fd.eventStartTime;
      if (fd.createAt) body.createAt = fd.createAt;
    }
    try {
      await api("/api/zoom/schedule", { method: "POST", body: JSON.stringify(body) });
      banner(msgHost, "Job scheduled.", "ok");
      load();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  await load();
}

/* ================= Registration Routes ================= */
async function tabRoutes(section) {
  section.appendChild(pageHeader("Registration Routes", "A stable webhook URL to paste into ClickFunnels, a GHL workflow, or Zapier."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const form = el("form", { class: "grid sm:grid-cols-2 gap-3" }, [
    field("Type", select([{ value: "webinar", label: "Webinar" }, { value: "meeting", label: "Meeting" }], { name: "type" })),
    field("Selection mode", select([{ value: "upcoming", label: "Upcoming (by series)" }, { value: "specific", label: "Specific event" }], { name: "selectionMode" })),
    field("Series ID (upcoming mode)", input({ name: "seriesId" })),
    field("Specific Zoom event ID", input({ name: "specificZoomEventId" })),
    field("GHL workflow ID", input({ name: "ghlWorkflowId", required: true })),
    field("GHL location ID (optional override)", input({ name: "ghlLocationId" })),
    btn("Create route", { type: "submit", icon: "plus", cls: "sm:col-span-2 justify-center sm:w-fit" }),
  ]);
  section.appendChild(card([el("div", { class: "p-5" }, form)], "mb-6"));

  const tableHost = el("div", {});
  section.appendChild(card([tableHost]));

  async function load() {
    const rows = await api("/api/registration-routes");
    tableHost.innerHTML = "";
    tableHost.appendChild(
      table(
        ["Type", "Mode", "Enabled", "Webhook URL"],
        rows.map((r) => [td(badge(r.type, r.type === "webinar" ? "indigo" : "slate")), td(r.selectionMode), td(badge(r.enabled ? "yes" : "no", r.enabled ? "green" : "red")), td(el("div", { class: "flex items-center gap-1" }, [codeValue(r.webhookUrl), copyButton(r.webhookUrl)]))]
      )
    ));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    Object.keys(fd).forEach((k) => { if (!fd[k]) delete fd[k]; });
    try {
      const created = await api("/api/registration-routes", { method: "POST", body: JSON.stringify(fd) });
      banner(msgHost, `Created. Webhook URL: ${created.webhookUrl}`, "ok");
      form.reset();
      load();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  await load();
}

/* ================= Registrants ================= */
async function tabRegistrants(section) {
  section.appendChild(pageHeader("Registrants", "Look up who registered for a specific Zoom event and whether they showed up."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const form = el("form", { class: "flex flex-wrap items-end gap-3" }, [
    field("Zoom Event ID", input({ name: "zoomEventId", required: true, cls: "min-w-[280px]" })),
    btn("Load registrants", { type: "submit", icon: "users" }),
  ]);
  section.appendChild(card([el("div", { class: "p-5" }, form)], "mb-6"));

  const tableHost = el("div", {});
  section.appendChild(card([tableHost]));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    try {
      const eventData = await api(`/api/zoom-events/${fd.zoomEventId}`);
      tableHost.innerHTML = "";
      tableHost.appendChild(
        table(
          ["Email", "Name", "Attendance", "Minutes", "GHL Contact"],
          eventData.registrants.map((r) => [
            td(r.email),
            td([r.firstName, r.lastName].filter(Boolean).join(" ") || "-"),
            td(badge(r.attendanceStatus, r.attendanceStatus === "attended" ? "green" : r.attendanceStatus === "no_show" ? "red" : "amber")),
            td(r.attendedMinutes ?? "-"),
            td(r.ghlContactId ? codeValue(r.ghlContactId) : "-"),
          ])
        )
      );
      banner(msgHost, `Loaded ${eventData.registrants.length} registrant(s) for "${eventData.topic}".`, "ok");
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });
}

/* ================= Short Links ================= */
async function tabLinks(section) {
  section.appendChild(pageHeader("Short Links", "General-purpose link shortener, also used for join links and evergreen series links."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const createForm = el("form", { class: "flex flex-wrap items-end gap-3" }, [
    field("Target URL", input({ name: "targetUrl", required: true, cls: "min-w-[320px]" })),
    btn("Create short link", { type: "submit", icon: "plus" }),
  ]);
  const repointForm = el("form", { class: "flex flex-wrap items-end gap-3" }, [
    field("Short code", input({ name: "code", required: true })),
    field("New target URL", input({ name: "targetUrl", required: true, cls: "min-w-[280px]" })),
    btn("Repoint", { type: "submit", variant: "secondary", icon: "refresh" }),
  ]);

  section.appendChild(
    card([
      el("div", { class: "p-5 flex flex-col gap-5" }, [
        el("div", {}, [el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2", text: "Create" }), createForm]),
        el("hr", { class: "border-slate-200 dark:border-slate-800" }),
        el("div", {}, [el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2", text: "Repoint an existing link" }), repointForm]),
      ]),
    ])
  );

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const created = await api("/api/short-links", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(createForm))) });
      banner(msgHost, `Created: ${created.shortUrl} -> ${created.targetUrl}`, "ok");
      createForm.reset();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });
  repointForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(repointForm));
    try {
      const updated = await api(`/api/short-links/${fd.code}`, { method: "PATCH", body: JSON.stringify({ targetUrl: fd.targetUrl }) });
      banner(msgHost, `Repointed ${updated.shortUrl} -> ${updated.targetUrl}`, "ok");
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });
}

/* ================= API Docs ================= */
const API_ENDPOINTS = [
  {
    group: "Series & Templates",
    items: [
      { method: "POST", path: "/api/series", auth: "session-or-key", desc: "Create a series.", body: { slug: "tuesday-sales-webinar", name: "Tuesday Sales Webinar", type: "webinar" } },
      { method: "GET", path: "/api/series", auth: "session-or-key", desc: "List all series." },
      { method: "POST", path: "/api/templates", auth: "session-or-key", desc: "Create a reusable Zoom create-payload.", body: { seriesId: "...", name: "default", hostEmail: "host@company.com", zoomPayload: { topic: "Weekly Sales Webinar", duration: 60 } } },
      { method: "GET", path: "/api/templates", auth: "session-or-key", desc: "List all templates." },
    ],
  },
  {
    group: "Zoom Events",
    items: [
      { method: "POST", path: "/api/zoom/create", auth: "session-or-key", desc: "Create a webinar/meeting in Zoom right now.", body: { type: "webinar", seriesId: "...", templateId: "...", startTime: "2026-01-14T19:00:00Z" } },
      { method: "POST", path: "/api/zoom/schedule", auth: "session-or-key", desc: "Schedule recurring or one-off creation.", body: { mode: "recurring", seriesId: "...", templateId: "...", recurrenceRule: { dayOfWeek: 2, time: "19:00", tz: "America/New_York" }, leadTimeDays: 7 } },
      { method: "GET", path: "/api/zoom/schedule", auth: "session-or-key", desc: "List scheduled jobs." },
      { method: "DELETE", path: "/api/zoom/schedule/:id", auth: "session-or-key", desc: "Cancel a scheduled job." },
      { method: "GET", path: "/api/zoom-events", auth: "session-or-key", desc: "List all created Zoom events." },
      { method: "GET", path: "/api/zoom-events/:id", auth: "session-or-key", desc: "Get one event, including its registrants." },
      { method: "POST", path: "/api/zoom-events/:id/sync-attendance", auth: "session-or-key", desc: "Manually (re-)pull the Zoom attendee report and re-tag registrants in GHL." },
      { method: "GET", path: "/api/upcoming", auth: "public", desc: "Look up the upcoming (or a specific) event's date/time. Query: type, mode, seriesId, zoomEventId. Join links only included with a valid X-API-Key." },
    ],
  },
  {
    group: "Registration",
    items: [
      { method: "POST", path: "/api/registration-routes", auth: "session-or-key", desc: "Create a saved webhook config.", body: { type: "webinar", selectionMode: "upcoming", seriesId: "...", ghlWorkflowId: "..." } },
      { method: "GET", path: "/api/registration-routes", auth: "session-or-key", desc: "List registration routes." },
      { method: "POST", path: "/webhooks/register/:slug", auth: "public", desc: "Register a contact into the upcoming/specific event, sync to GHL, and enroll in the workflow.", body: { email: "jane@example.com", firstName: "Jane", lastName: "Doe" } },
    ],
  },
  {
    group: "Short Links",
    items: [
      { method: "POST", path: "/api/short-links", auth: "session-or-key", desc: "Create a short link.", body: { targetUrl: "https://zoom.us/j/12345" } },
      { method: "PATCH", path: "/api/short-links/:code", auth: "session-or-key", desc: "Repoint an existing short link.", body: { targetUrl: "https://zoom.us/j/99999" } },
      { method: "GET", path: "/s/:code", auth: "public", desc: "Redirects to the short link's target URL." },
    ],
  },
  {
    group: "Settings & Users",
    items: [
      { method: "GET", path: "/api/settings", auth: "session-or-key", desc: "Read GHL tag names and provider connection flags." },
      { method: "PATCH", path: "/api/settings", auth: "session-or-key", desc: "Update GHL tag names.", body: { ghlAttendedTag: "Webinar Attended", ghlNoShowTag: "Webinar No-Show" } },
      { method: "GET", path: "/api/settings/status", auth: "session-or-key", desc: "Live Zoom/GHL connectivity check." },
      { method: "GET", path: "/api/settings/api-key", auth: "admin-only", desc: "Reveal the shared X-API-Key value." },
      { method: "GET", path: "/api/users", auth: "admin-only", desc: "List user accounts." },
      { method: "POST", path: "/api/users", auth: "admin-only", desc: "Create a user account.", body: { email: "teammate@company.com", role: "member" } },
    ],
  },
];

function authBadge(auth) {
  const map = { public: ["Public", "green"], "session-or-key": ["Session or API key", "indigo"], "admin-only": ["Admin only", "amber"] };
  const [text, color] = map[auth] || ["Session", "slate"];
  return badge(text, color);
}

async function tabDocs(section) {
  section.appendChild(pageHeader("API Documentation", "Every endpoint this worker exposes. Admin endpoints accept either your login session or the shared API key (Settings tab)."));

  for (const group of API_ENDPOINTS) {
    const groupCard = card([
      el("div", { class: "p-5" }, [
        el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3", text: group.group }),
        el(
          "div",
          { class: "divide-y divide-slate-100 dark:divide-slate-800" },
          group.items.map((it) => {
            const methodColors = { GET: "text-emerald-600 dark:text-emerald-400", POST: "text-indigo-600 dark:text-indigo-400", PATCH: "text-amber-600 dark:text-amber-400", DELETE: "text-red-600 dark:text-red-400" };
            const curlParts = [`curl -X ${it.method} '${location.origin}${it.path}'`];
            if (it.auth === "session-or-key" || it.auth === "admin-only") curlParts.push(`-H 'X-API-Key: YOUR_API_KEY'`);
            if (it.body) curlParts.push(`-H 'Content-Type: application/json'`, `-d '${JSON.stringify(it.body)}'`);
            const curl = curlParts.join(" \\\n  ");
            return el("div", { class: "py-3" }, [
              el("div", { class: "flex items-center gap-2 flex-wrap" }, [
                el("span", { class: `font-mono text-xs font-bold ${methodColors[it.method]}`, text: it.method }),
                el("code", { class: "font-mono text-sm text-slate-800 dark:text-slate-200", text: it.path }),
                authBadge(it.auth),
              ]),
              el("p", { class: "text-sm text-slate-500 dark:text-slate-400 mt-1", text: it.desc }),
              el("pre", { class: "code-block mt-2", text: curl }),
            ]);
          })
        ),
      ]),
    ]);
    section.appendChild(el("div", { class: "mb-4" }, [groupCard]));
  }
}

/* ================= Scopes ================= */
const ZOOM_SCOPES = [
  { scope: "meeting:write:meeting:admin", purpose: "Create meetings" },
  { scope: "meeting:read:meeting:admin", purpose: "Read meeting details" },
  { scope: "webinar:write:webinar:admin", purpose: "Create webinars" },
  { scope: "webinar:read:webinar:admin", purpose: "Read webinar details" },
  { scope: "meeting:write:registrant:admin", purpose: "Register attendees (meeting)" },
  { scope: "meeting:read:registrant:admin", purpose: "Read meeting registrants" },
  { scope: "webinar:write:registrant:admin", purpose: "Register attendees (webinar)" },
  { scope: "webinar:read:registrant:admin", purpose: "Read webinar registrants" },
  { scope: "user:read:user:admin", purpose: "Resolve the host account by email" },
  { scope: "report:read:list_meeting_participants:admin", purpose: "Post-event attendance report (meetings)" },
  { scope: "report:read:list_webinar_participants:admin", purpose: "Post-event attendance report (webinars)" },
];
const GHL_SCOPES = [
  { scope: "Contacts - Read & Write", purpose: "Create/update contacts, add tags (attended/no-show)" },
  { scope: "Custom Fields - Read & Write", purpose: "Auto-create the 5 contact fields this app writes to" },
  { scope: "Workflows - Read", purpose: "Look up workflow IDs to enroll contacts into" },
];

async function tabScopes(section) {
  section.appendChild(pageHeader("Required Scopes", "Exact permissions this app needs from Zoom and GoHighLevel. Zoom's scope picker is searchable — search each term below."));

  function scopesCard(title, rows, scopeLabel) {
    return card([
      el("div", { class: "p-5" }, [
        el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3", text: title }),
        table(
          [scopeLabel, "Used for"],
          rows.map((r) => [td(el("div", { class: "flex items-center gap-1" }, [el("code", { class: "font-mono text-xs text-indigo-600 dark:text-indigo-400", text: r.scope }), copyButton(r.scope)])), td(el("span", { class: "text-slate-600 dark:text-slate-400 text-sm", text: r.purpose }))])
        ),
      ]),
    ]);
  }

  section.appendChild(el("div", { class: "mb-4" }, [scopesCard("Zoom — Server-to-Server OAuth app scopes", ZOOM_SCOPES, "Scope")]));
  section.appendChild(
    card([
      el("div", { class: "p-5" }, [
        el("p", { class: "text-sm text-slate-500 dark:text-slate-400", text: "Create the app at marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth. The host account used for webinar creation also needs a Webinar license." }),
      ]),
    ], "mb-6")
  );

  section.appendChild(el("div", { class: "mb-4" }, [scopesCard("GoHighLevel — Private Integration permissions", GHL_SCOPES, "Permission")]));
  section.appendChild(
    card([
      el("div", { class: "p-5" }, [
        el("p", { class: "text-sm text-slate-500 dark:text-slate-400", text: "Create the integration in your GHL sub-account under Settings → Private Integrations. Paste the resulting token and your Location ID into the Settings tab." }),
      ]),
    ])
  );
}

function sourceBadge(source) {
  if (source === "db") return badge("saved here", "green");
  if (source === "env") return badge("from deploy secret", "slate");
  return badge("not set", "red");
}

async function buildCredentialsCard(msgHost, onSaved) {
  const rows = await api("/api/settings/credentials");
  const form = el("form", { class: "grid sm:grid-cols-2 gap-4" });

  for (const r of rows) {
    const inputEl = input({
      name: r.formKey,
      type: r.secret ? "password" : "text",
      placeholder: r.secret ? (r.masked ? `Currently ${r.masked} - leave blank to keep` : "Not set") : r.value || "Not set",
      value: r.secret ? "" : r.value || "",
    });
    form.appendChild(
      el("div", { class: "flex flex-col gap-1.5" }, [
        el("div", { class: "flex items-center justify-between" }, [
          el("span", { class: "text-sm font-medium text-slate-700 dark:text-slate-300", text: r.label }),
          sourceBadge(r.source),
        ]),
        inputEl,
      ])
    );
  }

  form.appendChild(btn("Save credentials", { type: "submit", icon: "checkCircle", cls: "sm:col-span-2 justify-center sm:w-fit" }));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    Object.keys(fd).forEach((k) => { if (!fd[k]) delete fd[k]; }); // blank = don't change
    if (Object.keys(fd).length === 0) return;
    try {
      await api("/api/settings/credentials", { method: "PATCH", body: JSON.stringify(fd) });
      banner(msgHost, "Credentials saved - takes effect immediately, no redeploy needed.", "ok");
      onSaved();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  return card(
    [
      el("div", { class: "p-5" }, [
        el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1", text: "Zoom & GHL credentials" }),
        el("p", { class: "text-sm text-slate-500 dark:text-slate-400 mb-4", text: "Paste the values from your Zoom Server-to-Server app and GHL Private Integration - see the Scopes tab for what to create. Leave a field blank to keep its current value." }),
        form,
      ]),
    ],
    "mb-6"
  );
}

async function renderCredentialsCard(section, msgHost) {
  let current = el("div", {});
  section.appendChild(current);
  const refresh = async () => {
    const node = await buildCredentialsCard(msgHost, refresh);
    current.replaceWith(node);
    current = node;
  };
  await refresh();
}

/* ================= Settings ================= */
async function tabSettings(section, user) {
  section.appendChild(pageHeader("Settings", "GHL tag names, provider connection health, and API access."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const current = await api("/api/settings");

  if (user.role === "admin") {
    await renderCredentialsCard(section, msgHost);
  }

  const tagForm = el("form", { class: "grid sm:grid-cols-2 gap-3" }, [
    field("Attended tag", input({ name: "ghlAttendedTag", value: current.ghlAttendedTag })),
    field("No-show tag", input({ name: "ghlNoShowTag", value: current.ghlNoShowTag })),
    btn("Save tag names", { type: "submit", cls: "sm:col-span-2 justify-center sm:w-fit" }),
  ]);
  section.appendChild(
    card([el("div", { class: "p-5" }, [el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3", text: "GHL attendance tags" }), tagForm])], "mb-6")
  );

  tagForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(tagForm))) });
      banner(msgHost, "Saved.", "ok");
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  const statusHost = el("div", { class: "flex flex-col gap-3" });
  const checkBtn = btn("Test connection", { variant: "secondary", icon: "refresh", onClick: () => loadStatus() });
  section.appendChild(
    card([
      el("div", { class: "p-5" }, [
        el("div", { class: "flex items-center justify-between mb-3" }, [el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300", text: "Connection status" }), checkBtn]),
        statusHost,
      ]),
    ], "mb-6")
  );

  function statusRow(name, result) {
    const ok = result && result.ok;
    return el("div", { class: "flex items-center gap-2.5 text-sm" }, [
      el("span", { class: `status-dot ${ok ? "bg-emerald-500" : "bg-red-500"}` }),
      el("span", { class: "font-medium text-slate-800 dark:text-slate-100 w-16", text: name }),
      el("span", { class: "text-slate-500 dark:text-slate-400", text: ok ? "Connected" : result?.error || "Not configured" }),
    ]);
  }

  async function loadStatus() {
    statusHost.innerHTML = "";
    statusHost.appendChild(el("p", { class: "text-sm text-slate-400", text: "Checking..." }));
    try {
      const s = await api("/api/settings/status");
      statusHost.innerHTML = "";
      statusHost.appendChild(statusRow("Zoom", s.zoom));
      statusHost.appendChild(statusRow("GHL", s.ghl));
    } catch (err) {
      statusHost.innerHTML = "";
      banner(statusHost, err.message, "err");
    }
  }
  await loadStatus();

  if (user.role === "admin") {
    const revealBtn = btn("Reveal API key", { variant: "secondary", icon: "eye" });
    const keyHost = el("div", { class: "mt-3" });
    revealBtn.addEventListener("click", async () => {
      try {
        const { apiKey } = await api("/api/settings/api-key");
        keyHost.innerHTML = "";
        keyHost.appendChild(el("div", { class: "flex items-center gap-1" }, [codeValue(apiKey), copyButton(apiKey)]));
      } catch (err) {
        banner(section, err.message, "err");
      }
    });
    section.appendChild(
      card([
        el("div", { class: "p-5" }, [
          el("h2", { class: "text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1", text: "API key" }),
          el("p", { class: "text-sm text-slate-500 dark:text-slate-400 mb-3", text: "Used by scripts/Zapier via the X-API-Key header. To rotate it, run 'wrangler secret put ADMIN_API_KEY'." }),
          revealBtn,
          keyHost,
        ]),
      ])
    );
  }
}

/* ================= Users ================= */
async function tabUsers(section) {
  section.appendChild(pageHeader("Users", "Manage who can log into this admin panel."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const form = el("form", { class: "grid sm:grid-cols-3 gap-3 items-end" }, [
    field("Email", input({ name: "email", type: "email", required: true })),
    field("Role", select([{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }], { name: "role" })),
    field("Password (optional)", input({ name: "password", type: "password", placeholder: "auto-generated if blank" })),
    btn("Add user", { type: "submit", icon: "plus", cls: "sm:col-span-3 justify-center sm:w-fit" }),
  ]);
  section.appendChild(card([el("div", { class: "p-5" }, form)], "mb-6"));

  const tableHost = el("div", {});
  section.appendChild(card([tableHost]));

  async function load() {
    const rows = await api("/api/users");
    tableHost.innerHTML = "";
    tableHost.appendChild(
      table(
        ["Email", "Role", "Created", "Last login", ""],
        rows.map((r) => {
          const roleSelect = select([{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }], { name: "role" });
          roleSelect.value = r.role;
          roleSelect.className += " !w-auto text-xs py-1";
          roleSelect.addEventListener("change", async () => {
            try {
              await api(`/api/users/${r.id}`, { method: "PATCH", body: JSON.stringify({ role: roleSelect.value }) });
              banner(msgHost, `Updated ${r.email}.`, "ok");
            } catch (err) {
              banner(msgHost, err.message, "err");
              load();
            }
          });
          return [
            td(r.email),
            td(roleSelect),
            td(new Date(r.createdAt).toLocaleDateString()),
            td(r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : "never"),
            td(
              iconBtn("trash", {
                title: "Delete user",
                onClick: async () => {
                  try {
                    await api(`/api/users/${r.id}`, { method: "DELETE" });
                    load();
                  } catch (err) {
                    banner(msgHost, err.message, "err");
                  }
                },
              })
            ),
          ];
        })
      )
    );
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (!fd.password) delete fd.password;
    try {
      const created = await api("/api/users", { method: "POST", body: JSON.stringify(fd) });
      banner(msgHost, created.generatedPassword ? `User created. Temporary password: ${created.generatedPassword} (share this securely - it won't be shown again).` : "User created.", "ok");
      form.reset();
      load();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });

  await load();
}

const TABS = {
  dashboard: tabDashboard,
  series: tabSeries,
  templates: tabTemplates,
  events: tabEvents,
  schedule: tabSchedule,
  routes: tabRoutes,
  registrants: tabRegistrants,
  links: tabLinks,
  docs: tabDocs,
  scopes: tabScopes,
  settings: tabSettings,
  users: tabUsers,
};
