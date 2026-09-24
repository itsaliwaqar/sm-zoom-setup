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
/* ================= Zoom settings form (shared by Templates + Zoom Events) ================= */
const ZOOM_FIELD_GROUPS = [
  {
    title: "Basics",
    fields: [
      { path: "topic", label: "Topic", type: "text", appliesTo: ["meeting", "webinar"] },
      { path: "agenda", label: "Agenda", type: "textarea", appliesTo: ["meeting", "webinar"] },
      { path: "duration", label: "Duration (minutes)", type: "number", appliesTo: ["meeting", "webinar"], default: 60 },
      { path: "timezone", label: "Timezone", type: "text", appliesTo: ["meeting", "webinar"], default: "America/New_York" },
      { path: "password", label: "Passcode (blank = auto-generated)", type: "text", appliesTo: ["meeting", "webinar"] },
    ],
  },
  {
    title: "Video",
    fields: [
      { path: "settings.host_video", label: "Host video on by default", type: "boolean", appliesTo: ["meeting", "webinar"] },
      { path: "settings.panelists_video", label: "Panelists video on by default", type: "boolean", appliesTo: ["webinar"] },
      { path: "settings.hd_video", label: "HD video", type: "boolean", appliesTo: ["webinar"] },
    ],
  },
  {
    title: "Audio",
    fields: [{ path: "settings.audio", label: "Audio options", type: "select", options: ["both", "telephony", "voip"], appliesTo: ["meeting", "webinar"] }],
  },
  {
    title: "Registration & Approval",
    fields: [
      { path: "settings.approval_type", label: "Approval", type: "select", options: [{ value: 0, label: "Automatically approve" }, { value: 1, label: "Manually approve" }, { value: 2, label: "No registration required" }], appliesTo: ["meeting", "webinar"] },
      { path: "settings.registrants_email_notification", label: "Email registrants on registration", type: "boolean", appliesTo: ["meeting", "webinar"] },
      { path: "settings.registrants_confirmation_email", label: "Send registrant confirmation email", type: "boolean", appliesTo: ["meeting", "webinar"] },
      { path: "settings.close_registration", label: "Close registration after event starts", type: "boolean", appliesTo: ["webinar"] },
      { path: "settings.contact_name", label: "Registration contact name", type: "text", appliesTo: ["webinar"] },
      { path: "settings.contact_email", label: "Registration contact email", type: "text", appliesTo: ["webinar"] },
    ],
  },
  {
    title: "Security",
    fields: [
      { path: "settings.waiting_room", label: "Waiting room", type: "boolean", appliesTo: ["meeting"] },
      { path: "settings.join_before_host", label: "Allow join before host", type: "boolean", appliesTo: ["meeting"] },
      { path: "settings.mute_upon_entry", label: "Mute participants on entry", type: "boolean", appliesTo: ["meeting", "webinar"] },
      { path: "settings.meeting_authentication", label: "Require authenticated users", type: "boolean", appliesTo: ["meeting", "webinar"] },
    ],
  },
  {
    title: "Recording",
    fields: [{ path: "settings.auto_recording", label: "Auto recording", type: "select", options: ["none", "local", "cloud"], appliesTo: ["meeting", "webinar"] }],
  },
  {
    title: "Webinar options",
    fields: [
      { path: "settings.practice_session", label: "Enable practice session", type: "boolean", appliesTo: ["webinar"] },
      { path: "settings.allow_multiple_devices", label: "Allow attendees on multiple devices", type: "boolean", appliesTo: ["webinar"] },
      { path: "settings.question_and_answer.enable", label: "Enable Q&A", type: "boolean", appliesTo: ["webinar"] },
    ],
  },
  {
    title: "Hosts",
    fields: [{ path: "settings.alternative_hosts", label: "Alternative hosts (comma-separated emails)", type: "text", appliesTo: ["meeting", "webinar"] }],
  },
];

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] ?? {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function deepMerge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

// getType() is called live (not just once) so the form reacts when the caller's type/series
// picker changes - call the returned `refresh()` from that picker's change handler.
function buildZoomSettingsForm(getType, initialPayload = {}) {
  const controls = []; // {path, appliesTo, wrapper, getValue}
  const groupNodes = [];

  for (const group of ZOOM_FIELD_GROUPS) {
    const grid = el("div", { class: "grid sm:grid-cols-2 gap-x-4 gap-y-3" });
    for (const f of group.fields) {
      const current = getPath(initialPayload, f.path) ?? f.default;
      let controlEl, getValue, wrapperCls = "flex flex-col gap-1.5";

      if (f.type === "boolean") {
        const checkbox = el("input", { type: "checkbox", class: "rounded border-slate-300 dark:border-slate-600" });
        checkbox.checked = Boolean(current);
        controlEl = el("label", { class: "flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 py-2 cursor-pointer" }, [checkbox, el("span", { text: f.label })]);
        getValue = () => checkbox.checked;
        wrapperCls = "";
      } else if (f.type === "select") {
        const opts = f.options.map((o) => (typeof o === "object" ? o : { value: o, label: o }));
        const sel = select(opts, {});
        if (current !== undefined) sel.value = String(current);
        controlEl = el("div", { class: "flex flex-col gap-1.5" }, [el("span", { class: "text-sm font-medium text-slate-700 dark:text-slate-300", text: f.label }), sel]);
        getValue = () => {
          const raw = sel.value;
          const match = opts.find((o) => String(o.value) === raw);
          return match && typeof match.value === "number" ? match.value : raw;
        };
      } else if (f.type === "textarea") {
        const ta = textarea({});
        ta.value = current ?? "";
        controlEl = el("div", { class: "flex flex-col gap-1.5" }, [el("span", { class: "text-sm font-medium text-slate-700 dark:text-slate-300", text: f.label }), ta]);
        getValue = () => ta.value || undefined;
      } else {
        const inp = input({ type: f.type === "number" ? "number" : "text" });
        inp.value = current ?? "";
        controlEl = el("div", { class: "flex flex-col gap-1.5" }, [el("span", { class: "text-sm font-medium text-slate-700 dark:text-slate-300", text: f.label }), inp]);
        getValue = () => (inp.value === "" ? undefined : f.type === "number" ? Number(inp.value) : inp.value);
      }

      const wrapper = el("div", { class: wrapperCls }, [controlEl]);
      grid.appendChild(wrapper);
      controls.push({ path: f.path, appliesTo: f.appliesTo, wrapper, getValue });
    }
    const groupNode = el("div", {}, [el("h3", { class: "text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2", text: group.title }), grid]);
    groupNodes.push(groupNode);
  }

  const advancedTextarea = textarea({ placeholder: '{\n  "settings": { "some_setting": true }\n}' });
  const advanced = el("details", { class: "rounded-lg border border-slate-200 dark:border-slate-800 p-3" }, [
    el("summary", { class: "text-sm font-medium text-slate-600 dark:text-slate-300 cursor-pointer", text: "Advanced (raw JSON override)" }),
    el("p", { class: "text-xs text-slate-400 mt-2 mb-2", text: "Merged on top of the settings above - use for anything not listed here." }),
    advancedTextarea,
  ]);

  const container = el("div", { class: "flex flex-col gap-5" }, [...groupNodes, advanced]);

  function refresh() {
    const type = getType();
    for (const c of controls) c.wrapper.classList.toggle("hidden", !c.appliesTo.includes(type));
  }
  refresh();

  function getPayload() {
    const type = getType();
    let result = {};
    for (const c of controls) {
      if (!c.appliesTo.includes(type)) continue;
      const value = c.getValue();
      if (value === undefined || value === "") continue;
      setPath(result, c.path, value);
    }
    if (advancedTextarea.value.trim()) {
      try {
        result = deepMerge(result, JSON.parse(advancedTextarea.value));
      } catch {
        throw new Error("Advanced JSON override is not valid JSON");
      }
    }
    return result;
  }

  return { container, getPayload, refresh };
}

async function tabTemplates(section) {
  section.appendChild(pageHeader("Templates", "A reusable Zoom create-payload (topic, duration, settings) tied to a series."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const seriesRows = await api("/api/series");
  const seriesOptions = seriesRows.map((s) => ({ value: s.id, label: `${s.name} (${s.slug})` }));
  const seriesById = Object.fromEntries(seriesRows.map((s) => [s.id, s]));

  const seriesSelect = select(seriesOptions.length ? seriesOptions : [{ value: "", label: "Create a series first" }], { name: "seriesId" });
  const zoomForm = buildZoomSettingsForm(() => seriesById[seriesSelect.value]?.type || "webinar", { topic: "Weekly Sales Webinar" });
  seriesSelect.addEventListener("change", () => zoomForm.refresh());

  const form = el("form", { class: "flex flex-col gap-5" }, [
    el("div", { class: "grid sm:grid-cols-2 gap-3" }, [
      field("Series", seriesSelect),
      field("Template name", input({ name: "name", required: true })),
      field("Host email", input({ name: "hostEmail", type: "email", required: true })),
    ]),
    zoomForm.container,
    btn("Create template", { type: "submit", icon: "plus", cls: "justify-center sm:w-fit" }),
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
      const body = { seriesId: seriesSelect.value, name: form.elements.name.value, hostEmail: form.elements.hostEmail.value, zoomPayload: zoomForm.getPayload() };
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

  const typeSelect = select([{ value: "webinar", label: "Webinar" }, { value: "meeting", label: "Meeting" }], { name: "type" });
  const templateIdInput = input({ name: "templateId", placeholder: "optional" });
  const zoomForm = buildZoomSettingsForm(() => typeSelect.value, {});
  typeSelect.addEventListener("change", () => zoomForm.refresh());

  const zoomDetails = el("details", {}, [
    el("summary", { class: "text-sm font-medium text-slate-600 dark:text-slate-300 cursor-pointer mb-1", text: "Zoom settings" }),
    el("p", { class: "text-xs text-slate-400 mb-3", text: "Leave collapsed with a Template ID set to use the template's settings unchanged. Expand to override." }),
    zoomForm.container,
  ]);

  const form = el("form", { class: "flex flex-col gap-5" }, [
    el("div", { class: "grid sm:grid-cols-2 gap-3" }, [
      field("Type", typeSelect),
      field("Template ID", templateIdInput),
      field("Series ID", input({ name: "seriesId", placeholder: "optional" })),
      field("Start time (UTC ISO)", input({ name: "startTime", required: true, placeholder: "2026-01-14T19:00:00Z" })),
      field("Host email (override)", input({ name: "hostEmail", placeholder: "optional if template supplies it" })),
    ]),
    zoomDetails,
    btn("Create in Zoom now", { type: "submit", icon: "plus", cls: "justify-center sm:w-fit" }),
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
      if (!templateIdInput.value || zoomDetails.open) {
        fd.zoomPayload = zoomForm.getPayload();
      }
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
/* ================= Shared value-mapping UI (GHL fields / Sheets columns / SendBlue vars) ================= */
const TOKEN_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "phone", label: "Phone" },
  { value: "webinarTopic", label: "Webinar topic" },
  { value: "webinarDateEastern", label: "Webinar date (Eastern)" },
  { value: "webinarDateUtc", label: "Webinar date (UTC)" },
  { value: "joinUrl", label: "Join link" },
  { value: "shortJoinUrl", label: "Short join link" },
  { value: "zoomRegistrantId", label: "Zoom registrant ID" },
  { value: "routeSlug", label: "Route slug" },
];

function buildValueSourceControl(initial = {}) {
  const sourceSelect = select([{ value: "token", label: "Computed value" }, { value: "static", label: "Static text" }], {});
  sourceSelect.value = initial.source || "token";
  const tokenSelect = select(TOKEN_OPTIONS, {});
  if (initial.token) tokenSelect.value = initial.token;
  const staticInput = input({ placeholder: "Static value", value: initial.staticValue || "" });

  function sync() {
    tokenSelect.classList.toggle("hidden", sourceSelect.value !== "token");
    staticInput.classList.toggle("hidden", sourceSelect.value !== "static");
  }
  sourceSelect.addEventListener("change", sync);
  sync();

  return {
    container: el("div", { class: "flex gap-2 flex-1 min-w-0" }, [sourceSelect, tokenSelect, staticInput]),
    getValue: () => (sourceSelect.value === "token" ? { source: "token", token: tokenSelect.value } : { source: "static", staticValue: staticInput.value }),
  };
}

// leftBuilder(initial) -> {container, getValue()} for the row's left-hand control (a field
// dropdown, or a free-text header/label input, depending on the integration).
function buildMappingList(leftBuilder, initialRows = [], addLabel = "Add row") {
  const rowsHost = el("div", { class: "flex flex-col gap-2" });
  const rows = [];

  function addRow(initial = {}) {
    const left = leftBuilder(initial);
    const valueSource = buildValueSourceControl(initial);
    const entry = { left, valueSource };
    const rowWrap = el("div", { class: "flex items-center gap-2" }, [
      left.container,
      valueSource.container,
      iconBtn("trash", { title: "Remove", onClick: () => { rowWrap.remove(); rows.splice(rows.indexOf(entry), 1); } }),
    ]);
    rows.push(entry);
    rowsHost.appendChild(rowWrap);
  }
  for (const r of initialRows) addRow(r);

  return {
    container: el("div", { class: "flex flex-col gap-2" }, [rowsHost, btn(addLabel, { variant: "secondary", icon: "plus", onClick: () => addRow() })]),
    getRows: () => rows.map((r) => ({ ...r.left.getValue(), ...r.valueSource.getValue() })),
  };
}

function tagsInput(placeholder, initial = []) {
  return input({ placeholder, value: (initial || []).join(", ") });
}
function parseTags(inputEl) {
  return inputEl.value.split(",").map((t) => t.trim()).filter(Boolean);
}

async function tabRoutes(section) {
  section.appendChild(pageHeader("Registration Routes", "A stable webhook URL to paste into ClickFunnels, a GHL workflow, or Zapier - plus what happens after someone registers."));

  const msgHost = el("div", {});
  section.appendChild(msgHost);

  const baseFields = el("div", { class: "grid sm:grid-cols-2 gap-3" }, [
    field("Type", select([{ value: "webinar", label: "Webinar" }, { value: "meeting", label: "Meeting" }], { name: "type" })),
    field("Selection mode", select([{ value: "upcoming", label: "Upcoming (by series)" }, { value: "specific", label: "Specific event" }], { name: "selectionMode" })),
    field("Series ID (upcoming mode)", input({ name: "seriesId" })),
    field("Specific Zoom event ID", input({ name: "specificZoomEventId" })),
    field("GHL workflow ID", input({ name: "ghlWorkflowId", required: true })),
    field("GHL location ID (optional override)", input({ name: "ghlLocationId" })),
  ]);

  // --- GHL tags & dynamic field mapping ---
  let ghlFieldOptions = [];
  try {
    ghlFieldOptions = (await api("/api/ghl/custom-fields")).map((f) => ({ value: f.id, label: f.name }));
  } catch {
    /* GHL not configured yet - field mapping dropdown will just be empty until it is */
  }
  const ghlTagsEl = tagsInput("e.g. webinar-optin, source-clickfunnels");
  const ghlFieldsMapper = buildMappingList(
    (initial) => {
      const sel = select(ghlFieldOptions.length ? ghlFieldOptions : [{ value: "", label: "No GHL fields found - configure GHL in Settings" }], {});
      if (initial.fieldId) sel.value = initial.fieldId;
      return { container: sel, getValue: () => ({ fieldId: sel.value }) };
    },
    [],
    "Add field mapping"
  );
  const ghlSection = el("details", { class: "rounded-lg border border-slate-200 dark:border-slate-800 p-4" }, [
    el("summary", { class: "text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer", text: "GHL tags & extra fields" }),
    el("div", { class: "mt-3 flex flex-col gap-3" }, [field("Tags to apply at registration (comma-separated)", ghlTagsEl), field("Extra field mappings (in addition to the 4 built-in fields)", ghlFieldsMapper.container)]),
  ]);

  // --- Google Sheets ---
  const sheetsEnabled = el("input", { type: "checkbox", class: "rounded border-slate-300" });
  const sheetsIdInput = input({ placeholder: "Spreadsheet ID (from its URL)" });
  const sheetsNameInput = input({ placeholder: "Sheet/tab name, e.g. Registrants" });
  const sheetsMapper = buildMappingList((initial) => { const inp = input({ placeholder: "Column header", value: initial.header || "" }); return { container: inp, getValue: () => ({ header: inp.value }) }; }, [], "Add column");
  const sheetsSection = el("details", { class: "rounded-lg border border-slate-200 dark:border-slate-800 p-4" }, [
    el("summary", { class: "text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer", text: "Google Sheets" }),
    el("div", { class: "mt-3 flex flex-col gap-3" }, [
      el("label", { class: "flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300" }, [sheetsEnabled, el("span", { text: "Add a row to a Google Sheet on registration" })]),
      el("div", { class: "grid sm:grid-cols-2 gap-3" }, [field("Spreadsheet ID", sheetsIdInput), field("Sheet name", sheetsNameInput)]),
      field("Columns (in order)", sheetsMapper.container),
      el("p", { class: "text-xs text-slate-400", text: "Share the spreadsheet with your Google service account's email as an Editor (Settings > Credentials)." }),
    ]),
  ]);

  // --- SendBlue ---
  const sendblueEnabled = el("input", { type: "checkbox", class: "rounded border-slate-300" });
  const sendblueTagsEl = tagsInput("e.g. webinar, hot-lead");
  const sendblueMapper = buildMappingList((initial) => { const inp = input({ placeholder: "Variable label", value: initial.label || "" }); return { container: inp, getValue: () => ({ label: inp.value }) }; }, [], "Add custom variable");
  const sendblueSection = el("details", { class: "rounded-lg border border-slate-200 dark:border-slate-800 p-4" }, [
    el("summary", { class: "text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer", text: "SendBlue" }),
    el("div", { class: "mt-3 flex flex-col gap-3" }, [
      el("label", { class: "flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300" }, [sendblueEnabled, el("span", { text: "Add/update the registrant as a SendBlue contact (requires a phone number)" })]),
      field("Tags (comma-separated)", sendblueTagsEl),
      field("Custom variables", sendblueMapper.container),
    ]),
  ]);

  // --- Hyros ---
  const hyrosEnabled = el("input", { type: "checkbox", class: "rounded border-slate-300" });
  const hyrosTagsEl = tagsInput("e.g. webinar-registered");
  const hyrosSection = el("details", { class: "rounded-lg border border-slate-200 dark:border-slate-800 p-4" }, [
    el("summary", { class: "text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer", text: "Hyros" }),
    el("div", { class: "mt-3 flex flex-col gap-3" }, [
      el("label", { class: "flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300" }, [hyrosEnabled, el("span", { text: "Tag the lead in Hyros on registration" })]),
      field("Tags (comma-separated)", hyrosTagsEl),
    ]),
  ]);

  const form = el("form", { class: "flex flex-col gap-4" }, [
    baseFields,
    ghlSection,
    sheetsSection,
    sendblueSection,
    hyrosSection,
    btn("Create route", { type: "submit", icon: "plus", cls: "justify-center sm:w-fit" }),
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
    fd.ghlTags = parseTags(ghlTagsEl);
    fd.ghlOutputFields = ghlFieldsMapper.getRows().filter((r) => r.fieldId);
    fd.sheetsConfig = { enabled: sheetsEnabled.checked, spreadsheetId: sheetsIdInput.value, sheetName: sheetsNameInput.value, columns: sheetsMapper.getRows().filter((r) => r.header) };
    fd.sendblueConfig = { enabled: sendblueEnabled.checked, tags: parseTags(sendblueTagsEl), customVariables: sendblueMapper.getRows().filter((r) => r.label) };
    fd.hyrosConfig = { enabled: hyrosEnabled.checked, tags: parseTags(hyrosTagsEl) };
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
    const placeholder = r.secret ? (r.masked ? `Currently ${r.masked} - leave blank to keep` : "Not set") : r.value || "Not set";
    const inputEl = r.multiline
      ? textarea({ name: r.formKey, placeholder })
      : input({ name: r.formKey, type: r.secret ? "password" : "text", placeholder, value: r.secret ? "" : r.value || "" });
    form.appendChild(
      el("div", { class: `flex flex-col gap-1.5 ${r.multiline ? "sm:col-span-2" : ""}` }, [
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
