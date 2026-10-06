// Kural Settings page (an editor tab): one card per AI, then Kural itself. Talks to lib/settings-page.js.
(function () {
  const vscode = acquireVsCodeApi();
  document.documentElement.style.setProperty("--fs", document.documentElement.dataset.fs || 1);
  const app = document.getElementById("app");
  const post = (m) => vscode.postMessage(m);
  let S = null;

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  // Icons: Codicons. Never emoji.
  const icon = (name, cls) => el("i", { class: `codicon codicon-${name}${cls ? " " + cls : ""}`, "aria-hidden": "true" });
  const btn = (label, type, extra = {}, cls = "") => el("button", { class: "btn " + cls, onclick: () => post({ type, ...extra }) }, label);

  // "42 min", "2 h 10 min", "3 days 4 h"
  function until(t) {
    const m = Math.max(0, Math.round((t - Date.now()) / 60000));
    if (m < 60) return m + " min";
    if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return h + " h" + (r ? " " + r + " min" : ""); }
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d + " day" + (d > 1 ? "s" : "") + (h ? " " + h + " h" : "");
  }
  function ago(t) {
    if (!t) return "";
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(t).toLocaleDateString();
  }
  const tok = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n || 0);
  const ICONS = { claude: "sparkle", agy: "globe", codex: "hubot", local: "server-environment" };
  const STATE = { on: ["Logged in", "ok"], set: ["Set up", "ok"], out: ["Not logged in", "warn"], off: ["Not set up", "off"] };

  function card(c) {
    const [label, cls] = c.id === "local" && c.state === "on" ? ["Set up", "ok"] : STATE[c.state];
    const head = el("div", { class: "head" }, icon(ICONS[c.id] || "account"), el("h3", {}, c.name),
      S.chatAI === c.id && c.state !== "off" ? el("span", { class: "tag" }, "the chat uses it") : null, el("span", { class: "grow" }), el("span", { class: "pill " + cls }, label));
    const body = [];
    if (c.state === "on" || c.state === "set") {
      if (c.who) body.push(el("div", { class: "who" }, icon("account"), " ", c.who));
      if (c.email) body.push(el("div", { class: "muted small" }, c.email));
      if (c.plan) body.push(el("div", { class: "muted" }, c.plan));
      if (c.note) body.push(el("div", { class: "muted small" }, c.note));
    } else body.push(el("p", { class: "muted" }, c.what));
    // Usage: each limit in words, with a bar.
    if (c.windows.length) {
      for (const w of c.windows) {
        const lvl = w.used >= 95 ? "bad" : w.used >= 80 ? "warn" : "";
        const reset = w.reset ? "started again" : w.resetsAt ? "resets in " + until(w.resetsAt) : "";
        const bar = el("div", { class: "bar " + lvl }, el("span", { style: `width:${Math.min(100, w.used)}%` }));
        body.push(el("div", { class: "lim" }, el("div", { class: "row" }, el("span", {}, el("strong", {}, w.name), " ", el("span", { class: "pct " + lvl }, w.used + "% used")), el("span", { class: "muted" }, reset)), bar));
      }
    } else if (c.tokens) body.push(el("div", { class: "lim muted" }, "Today: " + tok(c.tokens.input) + " tokens in, " + tok(c.tokens.output) + " out"));
    if (c.at) body.push(el("div", { class: "muted small" }, "Usage updated " + ago(c.at)));
    // Buttons for what you can do with it now.
    const acts = [];
    if (c.id === "local") acts.push(btn(c.state === "on" ? "Change" : "Set up", "setUp", { id: "local" }, c.state === "on" ? "" : "primary"));
    else if (c.state === "off") acts.push(btn("Set up", "setUp", { id: c.id }, "primary"));
    else if (c.state === "out") acts.push(btn("Log in", "logIn", { id: c.id }, "primary"));
    else if (c.state === "on") {
      if (c.page) acts.push(el("button", { class: "btn", onclick: () => post({ type: "usagePage", id: c.id }) }, icon("link-external"), " Usage page"));
      acts.push(btn("Switch account", "switch", { id: c.id }), btn("Log out", "logOut", { id: c.id }, "quiet"));
    } else acts.push(btn("Open Get started", "setUp", { id: c.id }));
    return el("section", { class: "card " + (c.state === "off" ? "dim" : "") }, head, body, el("div", { class: "acts" }, acts));
  }

  function link(iconName, label, hint, type) {
    return el("button", { class: "link", onclick: () => post({ type }) }, icon(iconName), el("span", { class: "lt" }, el("span", {}, label), hint ? el("span", { class: "muted small" }, hint) : null));
  }

  // Layout: the page's header carries the version and updates (one line, always in sight); then your AIs, two cards
  // to a row; then the rest of Kural as a compact grid of links.
  function render() {
    app.replaceChildren(
      el("header", {},
        el("div", { class: "title" }, el("h1", {}, "Kural Settings"),
          el("div", { class: "muted" }, S.loading ? [icon("loading", "spin"), " checking who's logged in…"] : "Your AI accounts, their usage, and Kural itself.")),
        el("span", { class: "grow" }),
        el("div", { class: "update" },
          el("div", { class: "row" }, el("span", { class: "muted" }, S.version),
            el("button", { class: "btn primary", disabled: S.checking, onclick: () => post({ type: "updates" }) }, icon(S.checking ? "loading" : "sync", S.checking ? "spin" : ""), " Check for updates")),
          el("label", { class: "check small" }, el("input", { type: "checkbox", checked: S.autoUpdates, onchange: (e) => post({ type: "autoUpdates", value: e.target.checked }) }), "Look for updates once a day"))),
      el("div", { class: "sechead" }, el("h2", {}, "Your AI"), el("span", { class: "grow" }),
        el("button", { class: "btn", disabled: S.refreshing, title: "Ask each AI for its usage now (Claude: one tiny request)", onclick: () => post({ type: "refresh" }) },
          icon("refresh", S.refreshing ? "spin" : ""), " Refresh usage")),
      el("div", { class: "cards" }, S.cards.map(card)),
      el("div", { class: "sechead" }, el("h2", {}, "More")),
      el("div", { class: "links" },
        link("rocket", "Get started", "set up an AI, step by step", "getStarted"),
        link("dashboard", "AI Usage panel", "every limit, at the bottom", "usagePanel"),
        link("symbol-keyword", "Tab Completion", "engine, speed, model", "tab"),
        link("settings", "All settings", "Kural's, in VS Code's settings", "allSettings"),
        link("list-unordered", "Kural's log", "every request, with timings", "log"),
        link("book", "Kural guide", "what every feature does", "guide"),
        link("lightbulb", "Ask for a feature", "on GitHub", "feature")));
  }

  window.addEventListener("message", (e) => { if (e.data.type === "state") { S = e.data; render(); } });
  setInterval(() => { if (S) render(); }, 30000);   // ("resets in", "updated … ago")
  post({ type: "ready" });
})();
