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
      // (Through the style object: the page's rules (CSP) block a style="…" attribute, so a bar's width set that way was
      // ignored and every bar showed full.)
      else if (k === "style") n.style.cssText = v;
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

  // ---------- Moods ----------
  // The chat's moods: the four built-in ones, and yours (add, edit, delete), with what works best and examples to start
  // from. Drawn on its own (renderMoods), not with the rest of the page every 30 s: a redraw would take the form you're
  // typing in away from under your fingers. The form's fields are made once per edit and kept.
  const moodsBox = el("section", { class: "moods-sec", id: "moods" });
  let M = { form: null, confirm: null, drawn: "" };   // form: { id, fields: { name, hint, instructions }, error, busy, reqId }
  const TIPS = [
    ["Who the AI should be, and how it works with you.", "\"Work like a pair programmer sitting next to me.\""],
    ["Concrete behaviors: what to do first, what to always or never do.", "\"Run the tests after every change.\" \"Never add a library without asking.\""],
    ["Tone and length.", "\"Keep answers short.\" \"Explain every technical term.\""],
    ["When to ask you and when to decide.", "\"Ask before a big change; decide small things yourself.\""],
    ["A few sentences.", "Long instructions are followed less closely, and they go with every message."],
  ];
  function openMoodForm(mood) {
    const f = (tag, props) => el(tag, { class: "in", spellcheck: tag === "textarea" ? "true" : "false", ...props });
    const fields = { name: f("input", { maxlength: S.moods.limits.name, placeholder: "e.g. Pair programmer" }),
      hint: f("input", { maxlength: S.moods.limits.hint, placeholder: "e.g. small steps, asks before big changes" }),
      instructions: f("textarea", { rows: "7", maxlength: S.moods.limits.instructions, placeholder: "e.g. Work like a pair programmer sitting next to me. Before changing code, say in a sentence what you're about to do…" }) };
    fields.name.value = mood ? mood.label : ""; fields.hint.value = mood ? mood.hint : ""; fields.instructions.value = mood ? mood.instructions : "";
    const count = el("span", { class: "muted small count" });
    const counted = () => { count.textContent = `${fields.instructions.value.length} / ${S.moods.limits.instructions}`; };
    fields.instructions.addEventListener("input", counted); counted();
    M.form = { id: mood ? mood.id : null, fields, count, error: "", busy: false };
    renderMoods(true);
    fields.name.focus();
  }
  function useExample(x) {
    const F = M.form && M.form.fields; if (!F) return;
    F.name.value = x.name; F.hint.value = x.hint; F.instructions.value = x.instructions;
    F.instructions.dispatchEvent(new Event("input"));
    F.instructions.focus();
  }
  function saveMood() {
    const F = M.form; if (!F || F.busy) return;
    F.busy = true; F.error = ""; F.reqId = Date.now();
    post({ type: "saveMood", reqId: F.reqId, mood: { id: F.id, name: F.fields.name.value, hint: F.fields.hint.value, instructions: F.fields.instructions.value } });
    renderMoods(true);
  }
  function moodForm() {
    const F = M.form, X = F.fields;
    const row = (label, input, note) => el("label", { class: "field" }, el("span", { class: "flabel" }, label, note ? el("span", { class: "muted small" }, " ", note) : null), input);
    return el("div", { class: "mood-form" },
      el("div", { class: "mood-form-main" },
        el("h3", {}, F.id ? "Change this mood" : "Add a mood"),
        row("Name", X.name, "(shown in the model menu)"),
        row("One-line hint", X.hint, "(shown when you point at it)"),
        row("Instructions for the AI", X.instructions),
        el("div", { class: "row" }, F.count, el("span", { class: "grow" }),
          F.error ? el("span", { class: "err" }, icon("warning"), " ", F.error) : null),
        el("div", { class: "row" },
          el("button", { class: "btn primary", disabled: F.busy, onclick: saveMood }, F.busy ? "Saving…" : "Save"),
          el("button", { class: "btn", onclick: () => { M.form = null; renderMoods(true); } }, "Cancel"))),
      el("aside", { class: "mood-tips" },
        el("h4", {}, icon("lightbulb"), " What works best"),
        el("ul", {}, TIPS.map(([what, eg]) => el("li", {}, el("strong", {}, what), " ", el("span", { class: "muted" }, eg)))),
        el("h4", {}, "Start from an example"),
        el("div", { class: "examples" }, S.moods.examples.map((x) => el("button", { class: "btn", title: x.hint, onclick: () => useExample(x) }, x.name)))));
  }
  // force: redraw even if the moods haven't changed (the form opened, closed, or says something new).
  function renderMoods(force) {
    const D = S.moods;
    const key = JSON.stringify(D.mine) + (M.confirm || "");
    if (!force && key === M.drawn) return;
    M.drawn = key;
    const mine = D.mine.map((m) => el("div", { class: "mood-item" },
      el("div", { class: "row" }, el("strong", {}, m.label), m.hint ? el("span", { class: "muted" }, m.hint) : null, el("span", { class: "grow" }),
        el("button", { class: "btn", onclick: () => openMoodForm(m) }, icon("edit"), " Edit"),
        M.confirm === m.id
          ? el("button", { class: "btn danger", onclick: () => { M.confirm = null; post({ type: "deleteMood", id: m.id }); } }, "Delete it?")
          : el("button", { class: "btn quiet", title: "Delete this mood (chats using it go back to Default)", onclick: () => { M.confirm = m.id; renderMoods(true); } }, icon("trash"))),
      el("div", { class: "muted small clamp2" }, m.instructions)));
    moodsBox.replaceChildren(...[   // (replaceChildren writes a null as the word "null": left out)
      el("div", { class: "sechead" }, el("h2", {}, "Moods"), el("span", { class: "grow" }),
        M.form ? null : el("button", { class: "btn", onclick: () => openMoodForm(null) }, icon("add"), " Add a mood")),
      el("p", { class: "muted" }, "How the chat's AI works with you. Pick one in the chat's model menu, under Mood. Your own moods show there next to the four built-in ones."),
      el("div", { class: "builtin" }, D.builtIn.map((m) => el("span", { class: "pill", title: m.hint }, m.label, el("span", { class: "muted" }, ` · ${m.hint}`)))),
      D.mine.length ? el("div", { class: "mood-list" }, mine) : (M.form ? null : el("p", { class: "muted small" }, "No moods of your own yet.")),
      M.form ? moodForm() : null].filter(Boolean));
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "moodSaved" && M.form && M.form.reqId === m.reqId) {
      M.form.busy = false;
      if (m.error) { M.form.error = m.error; renderMoods(true); } else { M.form = null; renderMoods(true); }
    }
    if (m.type === "show" && m.section === "moods") showMoods();
  });
  // From the chat's "Add your own mood…": the Moods section, with a new mood's form open.
  function showMoods() {
    if (!S) return;
    if (!M.form) openMoodForm(null);
    moodsBox.scrollIntoView({ block: "start" });
    post({ type: "shown" });
  }

  // Layout: the page's header carries the version and updates (one line, always in sight); then your AIs, two cards
  // to a row; then the moods; then the rest of Kural as a compact grid of links.
  const top = el("div"), more = el("div");
  app.replaceChildren(top, moodsBox, more);
  function render() {
    renderMoods(false);
    more.replaceChildren(
      el("div", { class: "sechead" }, el("h2", {}, "More")),
      el("div", { class: "links" },
        link("rocket", "Get started", "set up an AI, step by step", "getStarted"),
        link("dashboard", "AI Usage panel", "every limit, at the bottom", "usagePanel"),
        link("symbol-keyword", "Tab Completion", "engine, speed, model", "tab"),
        link("git-compare", "Model Router", "what reads your requests, which AIs Auto uses", "router"),
        link("export", "Export settings", "your preferences to a file, for another computer", "exportSettings"),
        link("desktop-download", "Import settings", "from a file you exported", "importSettings"),
        link("settings", "All settings", "Kural's, in VS Code's settings", "allSettings"),
        link("list-unordered", "Kural's log", "every request, with timings", "log"),
        link("bug", "Crash reports", "what went wrong when Kural closed unexpectedly", "crashes"),
        link("book", "Kural guide", "what every feature does", "guide"),
        link("lightbulb", "Ask for a feature", "on GitHub", "feature")));
    top.replaceChildren(
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
      el("div", { class: "cards" }, S.cards.map(card)));
  }

  window.addEventListener("message", (e) => {
    if (e.data.type !== "state") return;
    S = e.data; render();
    if (S.section === "moods") showMoods();   // (opened by "Add your own mood…" before the page was ready)
  });
  setInterval(() => { if (S) render(); }, 30000);   // ("resets in", "updated … ago")
  post({ type: "ready" });
})();
