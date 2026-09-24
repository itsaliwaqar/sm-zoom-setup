"use strict";

/* ---------- tiny DOM helper ---------- */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child === undefined || child === null || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/* ---------- theme ---------- */
function applyTheme(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("zoomops-theme", theme);
  } catch {}
}
function getTheme() {
  try {
    return localStorage.getItem("zoomops-theme") || "dark";
  } catch {
    return "dark";
  }
}
applyTheme(getTheme());

/* ---------- API helper (cookie-session based) ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

/* ---------- shared UI building blocks ---------- */
const CARD = "rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm";
const INPUT =
  "w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm " +
  "text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500";

function card(children, extraCls = "") {
  return el("div", { class: `${CARD} ${extraCls}` }, children);
}
function pageHeader(title, subtitle, actions) {
  return el("div", { class: "flex items-start justify-between gap-4 mb-6" }, [
    el("div", {}, [
      el("h1", { class: "text-xl font-semibold text-slate-900 dark:text-white", text: title }),
      subtitle ? el("p", { class: "text-sm text-slate-500 dark:text-slate-400 mt-1", text: subtitle }) : null,
    ]),
    actions ? el("div", { class: "flex gap-2 shrink-0" }, actions) : null,
  ]);
}
function field(labelText, inputEl) {
  return el("label", { class: "flex flex-col gap-1.5 text-sm" }, [
    el("span", { class: "font-medium text-slate-700 dark:text-slate-300", text: labelText }),
    inputEl,
  ]);
}
function input(attrs = {}) {
  return el("input", { class: INPUT, ...attrs });
}
function select(options, attrs = {}) {
  return el(
    "select",
    { class: INPUT, ...attrs },
    options.map((o) => el("option", { value: o.value ?? o, text: o.label ?? o }))
  );
}
function textarea(attrs = {}) {
  return el("textarea", { class: `${INPUT} font-mono text-xs min-h-[110px]`, ...attrs });
}
function btn(text, opts = {}) {
  const variants = {
    primary: "bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm",
    secondary:
      "bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700",
    danger: "bg-red-600 hover:bg-red-500 text-white",
    ghost: "text-slate-500 hover:text-slate-800 dark:hover:text-slate-100",
  };
  const iconHtml = opts.icon ? icon(opts.icon, "w-4 h-4") : "";
  const b = el("button", {
    type: opts.type || "button",
    class: `inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
      variants[opts.variant || "primary"]
    } ${opts.cls || ""}`,
    onclick: opts.onClick,
  });
  if (iconHtml) b.innerHTML = iconHtml;
  const label = document.createElement("span");
  label.textContent = text;
  b.appendChild(label);
  return b;
}
function iconBtn(name, opts = {}) {
  return el("button", {
    type: "button",
    title: opts.title || "",
    class: `inline-flex items-center justify-center rounded-lg p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition ${
      opts.cls || ""
    }`,
    onclick: opts.onClick,
    html: icon(name, "w-4 h-4"),
  });
}
function badge(text, color = "slate") {
  const colors = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400",
  };
  return el("span", { class: `inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[color]}`, text });
}
function banner(container, message, kind) {
  const existing = container.querySelector("[data-banner]");
  if (existing) existing.remove();
  if (!message) return;
  const styles = {
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900",
    err: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900",
  };
  const node = el(
    "div",
    { "data-banner": "", class: `flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm mb-4 fade-in ${styles[kind]}` },
    [el("span", { html: icon(kind === "ok" ? "checkCircle" : "alertCircle", "w-4 h-4 shrink-0") }), el("span", { text: message })]
  );
  container.prepend(node);
}
function copyButton(text) {
  return iconBtn("copy", {
    title: "Copy",
    onClick: (e) => {
      navigator.clipboard.writeText(text).catch(() => {});
      const original = e.currentTarget.innerHTML;
      e.currentTarget.innerHTML = icon("checkCircle", "w-4 h-4");
      setTimeout(() => (e.currentTarget.innerHTML = original), 1200);
    },
  });
}
function codeValue(text) {
  return el("code", { class: "text-xs bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 break-all", text });
}
function table(headers, rows) {
  const t = el("table", { class: "w-full text-sm" });
  t.appendChild(
    el(
      "thead",
      {},
      el(
        "tr",
        { class: "text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-800" },
        headers.map((h) => el("th", { class: "py-2.5 px-3 font-medium", text: h }))
      )
    )
  );
  const tbody = el("tbody", {});
  if (rows.length === 0) {
    tbody.appendChild(
      el(
        "tr",
        {},
        el("td", { colspan: headers.length, class: "py-8 text-center text-slate-400 dark:text-slate-500 text-sm", text: "Nothing here yet" })
      )
    );
  }
  for (const r of rows) {
    tbody.appendChild(el("tr", { class: "border-b border-slate-100 dark:border-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800/40" }, r));
  }
  t.appendChild(tbody);
  return el("div", { class: "overflow-x-auto" }, t);
}
function td(content) {
  return el("td", { class: "py-2.5 px-3 align-top" }, content);
}

/* ---------- auth screens ---------- */
function authShell(title, subtitle, formEl) {
  const root = document.getElementById("root");
  root.innerHTML = "";
  root.appendChild(
    el("div", { class: "min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4" }, [
      el("div", { class: "w-full max-w-sm" }, [
        el("div", { class: "flex items-center gap-2.5 justify-center mb-8" }, [
          el("div", { class: "w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center", html: icon("video", "w-5 h-5") }),
          el("span", { class: "text-lg font-semibold text-slate-900 dark:text-white", text: "Zoom Ops" }),
        ]),
        card([
          el("div", { class: "p-6" }, [
            el("h1", { class: "text-lg font-semibold text-slate-900 dark:text-white mb-1", text: title }),
            el("p", { class: "text-sm text-slate-500 dark:text-slate-400 mb-5", text: subtitle }),
            formEl,
          ]),
        ]),
      ]),
    ])
  );
  return root;
}

function renderSetup() {
  const msgHost = el("div", {});
  const form = el(
    "form",
    { class: "flex flex-col gap-4" },
    [
      msgHost,
      field("Email", input({ name: "email", type: "email", required: true, placeholder: "you@company.com" })),
      field("Password", input({ name: "password", type: "password", required: true, placeholder: "At least 8 characters" })),
      btn("Create admin account", { type: "submit", cls: "w-full justify-center mt-1", icon: "checkCircle" }),
    ]
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    try {
      await api("/auth/setup", { method: "POST", body: JSON.stringify(fd) });
      boot();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });
  authShell("Set up Zoom Ops", "Create the first administrator account for this workspace.", form);
}

function renderLogin() {
  const msgHost = el("div", {});
  const form = el(
    "form",
    { class: "flex flex-col gap-4" },
    [
      msgHost,
      field("Email", input({ name: "email", type: "email", required: true, placeholder: "you@company.com" })),
      field("Password", input({ name: "password", type: "password", required: true })),
      btn("Sign in", { type: "submit", cls: "w-full justify-center mt-1" }),
    ]
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify(fd) });
      boot();
    } catch (err) {
      banner(msgHost, err.message, "err");
    }
  });
  authShell("Sign in", "Welcome back - sign in to manage your Zoom automations.", form);
}

/* ---------- app shell ---------- */
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "series", label: "Series", icon: "layers" },
  { id: "templates", label: "Templates", icon: "fileText" },
  { id: "events", label: "Zoom Events", icon: "video" },
  { id: "schedule", label: "Scheduled Jobs", icon: "clock" },
  { id: "routes", label: "Registration Routes", icon: "route" },
  { id: "registrants", label: "Registrants", icon: "users" },
  { id: "links", label: "Short Links", icon: "link" },
  { id: "docs", label: "API Docs", icon: "list" },
  { id: "settings", label: "Settings", icon: "sliders" },
  { id: "users", label: "Users", icon: "user", adminOnly: true },
];

function renderApp(user) {
  const root = document.getElementById("root");
  root.innerHTML = "";

  let activeTab = "dashboard";
  const contentHost = el("div", { class: "flex-1 overflow-y-auto p-6 md:p-8" });

  const navButtons = {};
  const sidebarNav = el(
    "nav",
    { class: "flex-1 overflow-y-auto px-3 py-2 space-y-0.5" },
    NAV.filter((n) => !n.adminOnly || user.role === "admin").map((n) => {
      const b = el(
        "button",
        {
          class:
            "sidebar-link w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white",
          onclick: () => setActive(n.id),
        },
        [el("span", { html: icon(n.icon, "w-4.5 h-4.5 shrink-0") }), el("span", { text: n.label })]
      );
      navButtons[n.id] = b;
      return b;
    })
  );

  function setActive(id) {
    activeTab = id;
    for (const [key, b] of Object.entries(navButtons)) {
      const isActive = key === id;
      b.className = `sidebar-link w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
        isActive
          ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400"
          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white"
      }`;
    }
    contentHost.innerHTML = "";
    const section = el("div", { class: "fade-in max-w-5xl" });
    contentHost.appendChild(section);
    (TABS[id] || TABS.dashboard)(section, user).catch((err) => banner(section, err.message, "err"));
  }

  const themeBtn = iconBtn(getTheme() === "dark" ? "sun" : "moon", {
    title: "Toggle theme",
    onClick: () => {
      const next = getTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      themeBtn.innerHTML = icon(next === "dark" ? "sun" : "moon", "w-4 h-4");
    },
  });

  const initials = user.email.slice(0, 2).toUpperCase();
  const sidebar = el("aside", { class: "w-64 shrink-0 h-screen sticky top-0 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900" }, [
    el("div", { class: "flex items-center gap-2.5 px-4 py-4 border-b border-slate-200 dark:border-slate-800" }, [
      el("div", { class: "w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center", html: icon("video", "w-4.5 h-4.5") }),
      el("span", { class: "text-base font-semibold text-slate-900 dark:text-white", text: "Zoom Ops" }),
    ]),
    sidebarNav,
    el("div", { class: "border-t border-slate-200 dark:border-slate-800 p-3" }, [
      el("div", { class: "flex items-center gap-2.5 rounded-lg px-2 py-2" }, [
        el("div", { class: "w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center shrink-0", text: initials }),
        el("div", { class: "min-w-0 flex-1" }, [
          el("p", { class: "text-sm font-medium text-slate-800 dark:text-slate-100 truncate", text: user.email }),
          badge(user.role, user.role === "admin" ? "indigo" : "slate"),
        ]),
        themeBtn,
        iconBtn("logOut", {
          title: "Log out",
          onClick: async () => {
            await api("/auth/logout", { method: "POST" }).catch(() => {});
            boot();
          },
        }),
      ]),
    ]),
  ]);

  root.appendChild(el("div", { class: "flex min-h-screen" }, [sidebar, contentHost]));
  setActive(activeTab);
}

/* ---------- boot sequence ---------- */
async function boot() {
  try {
    const status = await api("/auth/setup-status");
    if (status.needsSetup) return renderSetup();
  } catch {
    /* fall through to login */
  }
  try {
    const me = await api("/auth/me");
    return renderApp(me);
  } catch {
    return renderLogin();
  }
}

boot();
