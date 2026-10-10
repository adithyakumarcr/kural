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
    if (c.id === "local") acts.push(el("button", { class: "btn", onclick: () => post({ type: "findModels" }) }, icon("search"), " Find & download models…"));
    return el("section", { class: "card " + (c.state === "off" ? "dim" : ""), id: "ai-" + c.id }, head, body, aiSettings(c), el("div", { class: "acts" }, acts));
  }

  // ---------- each AI's own settings (the gear beside its name in the chat's model menu opens them) ----------
  // When to switch away from it (its Session and Weekly limits), and its connectors. The inputs and the add form are made
  // once per AI and kept, so the page's redraws (every 30 s, every usage report) don't take them from under your fingers.
  const CTL = {};
  function ctl(id) {
    if (CTL[id]) return CTL[id];
    const C = CTL[id] = { open: false };
    const point = (which) => el("input", { class: "in threshold", type: "number", min: "1", max: "99", step: "1", "aria-label": `${which} switch point (% used)`,
      onchange: (e) => { const t = e.target; if (t.reportValidity() && t.value !== "") post({ type: "usageSwitch", ai: id, which, value: Number(t.value) }); } });
    C.session = point("session"); C.weekly = point("weekly");
    // (A redraw that waited while you typed happens when you leave the field.)
    for (const f of [C.session, C.weekly]) f.addEventListener("blur", () => setTimeout(() => { if (S && S.cardsWaiting) render(); }, 0));
    C.name = el("input", { class: "in", placeholder: "name, e.g. github", spellcheck: "false" });
    const later = () => setTimeout(() => { if (S && S.cardsWaiting) render(); }, 0);
    C.kind = el("select", { class: "in" }, el("option", { value: "command" }, "Command"), el("option", { value: "url" }, "Web address"));
    C.value = el("input", { class: "in grow", placeholder: "npx -y @modelcontextprotocol/server-github", spellcheck: "false" });
    for (const f of [C.name, C.value, C.kind]) f.addEventListener("blur", later);
    C.kind.addEventListener("change", () => { C.value.placeholder = C.kind.value === "url" ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-github"; });
    C.details = el("details", { class: "conn" });
    C.details.addEventListener("toggle", () => { C.open = C.details.open; if (C.open) post({ type: "connectors", id }); });
    C.body = el("div", { class: "conn-body" });
    C.details.append(el("summary", {}, icon("plug"), " Connectors"), C.body);
    C.error = ""; C.reqId = 0;
    return C;
  }
  function addConnector(id) {
    const C = ctl(id);
    C.reqId = Date.now(); C.error = "";
    post({ type: "addConnector", id, reqId: C.reqId, connector: { name: C.name.value, kind: C.kind.value, value: C.value.value } });
  }
  function aiSettings(c) {
    if (c.id === "local") return el("div", { class: "muted small" }, "Your own model can't use connectors yet, and has no usage limits.");
    if (c.state === "off") return null;
    const C = ctl(c.id), guard = S.usageSwitch || {}, lim = (guard.limits || {})[c.id] || { session: guard.threshold, weekly: guard.threshold };
    if (document.activeElement !== C.session) C.session.value = lim.session;
    if (document.activeElement !== C.weekly) C.weekly.value = lim.weekly;
    // Gemini's limits are weekly only.
    const points = el("div", { class: "points" + (guard.enabled ? "" : " off") },
      el("div", { class: "flabel" }, "Move the chat to another AI when"),
      c.id === "agy" ? null : el("label", { class: "row" }, "the Session limit is", C.session, "% used"),
      el("label", { class: "row" }, c.id === "agy" ? "a Weekly limit is" : "or a Weekly limit is", C.weekly, "% used"),
      guard.enabled ? null : el("div", { class: "muted small" }, "Off: turn on \"Switch AI near a limit\" under AI Usage below."));
    const K = (S.connectors || {})[c.id] || { supported: false };
    C.details.open = C.open;
    const kids = [];
    if (!K.supported) kids.push(el("p", { class: "muted small" }, "Kural can't add connectors to Google Gemini yet."));
    else {
      if (c.id === "claude") kids.push(el("div", { class: "row wrap" },
        el("label", { class: "check small" }, el("input", { type: "checkbox", checked: S.fullSetup, onchange: (e) => post({ type: "fullSetup", on: e.target.checked }) }),
          "Use my Claude Code setup (connectors, plugins, skills)"),
        el("span", { class: "grow" }),
        el("button", { class: "btn quiet", title: "Start Claude again with your setup: same conversations", onclick: () => post({ type: "reloadSetup" }) }, icon("refresh"), " Reload")));
      if (K.loading && !(K.servers || []).length) kids.push(el("div", { class: "muted small" }, icon("loading", "spin"), c.id === "claude" ? " checking each connector…" : " loading…"));
      else if (K.error) kids.push(el("div", { class: "err small" }, icon("warning"), " Couldn't list them: ", K.error));
      else if (K.servers && !K.servers.length) kids.push(el("div", { class: "muted small" }, "No connectors yet."));
      for (const x of K.servers || []) kids.push(el("div", { class: "srv-row" },
        el("span", { class: "dot " + (x.ok ? "ok" : "warn") }), el("strong", {}, x.name),
        el("span", { class: "muted small ell", title: x.target }, x.target), el("span", { class: "grow" }),
        el("span", { class: "muted small", title: x.why || "" }, x.status),
        x.managed ? el("span", { class: "muted small", title: "Added on claude.ai: change it there" }, "on claude.ai")
          : el("button", { class: "pill-btn", title: `Remove ${x.name}`, "aria-label": `Remove ${x.name}`, disabled: K.busy,
            onclick: () => post({ type: "removeConnector", id: c.id, name: x.name, reqId: Date.now() }) }, icon("trash"))));
      kids.push(el("div", { class: "add-conn" }, C.name, C.kind, C.value,
        el("button", { class: "btn", disabled: K.busy, onclick: () => addConnector(c.id) }, icon(K.busy ? "loading" : "add", K.busy ? "spin" : ""), " Add")));
      if (C.error) kids.push(el("div", { class: "err small" }, icon("warning"), " ", C.error));
      kids.push(el("div", { class: "muted small" }, c.id === "claude"
        ? "Added for you (all projects), like `claude mcp add -s user`. Claude starts again with it; your chats continue."
        : "Added to ChatGPT (Codex)'s settings, like `codex mcp add`. New ChatGPT chats use it."));
    }
    C.body.replaceChildren(...kids);
    return el("div", { class: "ai-settings" }, points, C.details);
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
  // A built-in mood: × removes it from the chat's menu; a removed one has Restore. The last mood left can't be removed
  // (with all four removed and none of your own, Default comes back: prompts.js shownMoods).
  function builtInMoods(D) {
    const hidden = new Set(D.hidden || []);
    if (D.builtIn.every((m) => hidden.has(m.id)) && !D.mine.length) hidden.delete("default");
    const last = D.builtIn.filter((m) => !hidden.has(m.id)).length + D.mine.length <= 1;
    return el("div", { class: "builtin" }, D.builtIn.map((m) => hidden.has(m.id)
      ? el("span", { class: "pill off", title: `${m.label} isn't in the chat's model menu` }, m.label, " · removed",
        el("button", { class: "pill-btn", title: `Put ${m.label} back in the chat's model menu`, onclick: () => post({ type: "hideMood", id: m.id, hidden: false }) }, icon("discard"), " Restore"))
      : el("span", { class: "pill", title: m.hint }, m.label, el("span", { class: "muted" }, ` · ${m.hint}`),
        el("button", { class: "pill-btn", disabled: last, "aria-label": `Remove ${m.label}`,
          title: last ? "The chat needs at least one mood" : `Remove ${m.label} from the chat's model menu`,
          onclick: () => post({ type: "hideMood", id: m.id, hidden: true }) }, icon("close")))));
  }
  function renderMoods(force) {
    const D = S.moods;
    const key = JSON.stringify([D.mine, D.hidden]) + (M.confirm || "");
    if (!force && key === M.drawn) return;
    M.drawn = key;
    // Where a chat goes when its mood is deleted: the first mood left in the menu.
    const hidden = new Set(D.hidden || []), first = (D.builtIn.find((m) => !hidden.has(m.id)) || D.mine[0] || { label: "Default" }).label;
    const mine = D.mine.map((m) => el("div", { class: "mood-item" },
      el("div", { class: "row" }, el("strong", {}, m.label), m.hint ? el("span", { class: "muted" }, m.hint) : null, el("span", { class: "grow" }),
        el("button", { class: "btn", onclick: () => openMoodForm(m) }, icon("edit"), " Edit"),
        M.confirm === m.id
          ? el("button", { class: "btn danger", onclick: () => { M.confirm = null; post({ type: "deleteMood", id: m.id }); } }, "Delete it?")
          : el("button", { class: "btn quiet", title: `Delete this mood (chats using it go to ${m.label === first ? "the next mood" : first})`, onclick: () => { M.confirm = m.id; renderMoods(true); } }, icon("trash"))),
      el("div", { class: "muted small clamp2" }, m.instructions)));
    moodsBox.replaceChildren(...[   // (replaceChildren writes a null as the word "null": left out)
      el("div", { class: "sechead" }, el("h2", {}, "Moods"), el("span", { class: "grow" }),
        M.form ? null : el("button", { class: "btn", onclick: () => openMoodForm(null) }, icon("add"), " Add a mood")),
      el("p", { class: "muted" }, "How the chat's AI works with you. Pick one in the chat's model menu, under Mood. Your own moods show there next to the built-in ones; remove a built-in one you don't use with its ×. A new chat starts with the first mood in the menu."),
      builtInMoods(D),
      D.mine.length ? el("div", { class: "mood-list" }, mine) : (M.form ? null : el("p", { class: "muted small" }, "No moods of your own yet.")),
      M.form ? moodForm() : null].filter(Boolean));
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "moodSaved" && M.form && M.form.reqId === m.reqId) {
      M.form.busy = false;
      if (m.error) { M.form.error = m.error; renderMoods(true); } else { M.form = null; renderMoods(true); }
    }
    if (m.type === "show") { shownSection = m.section; showSection(m.section); }
    if (m.type === "connectorDone" && CTL[m.id]) {
      const C = CTL[m.id];
      if (m.error) C.error = m.error;
      else { C.error = ""; if (m.reqId === C.reqId) { C.name.value = ""; C.value.value = ""; } }
      if (S) render();
    }
  });
  // From the chat's "Add your own mood…": the Moods section, with a new mood's form open.
  function showMoods() {
    if (!S) return;
    if (!M.form) openMoodForm(null);
    moodsBox.scrollIntoView({ block: "start" });
    post({ type: "shown" });
  }

  // From the chat's model menu (the gear beside an AI's name): that AI's card, with its connectors open.
  let shownSection = null;   // (the host keeps sending the section until the page says "shown": scroll once)
  function showSection(section) {
    if (!S) return;
    if (section === "moods") return showMoods();
    if (section === "usage") return showUsage();
    const card = document.getElementById("ai-" + section);
    if (!card) return;
    if (((S.connectors || {})[section] || {}).supported) { const C = ctl(section); C.open = true; C.details.open = true; post({ type: "connectors", id: section }); }
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    post({ type: "shown" });
  }

  // Layout: the page's header carries the version and updates (one line, always in sight); then your AIs, two cards
  // to a row; then the moods; then the rest of Kural as a compact grid of links.
  const top = el("div"), more = el("div"), usageBox = el("section", { class: "usage-settings", id: "usage" });
  const switchOn = el("input", { type: "checkbox", onchange: () => post({ type: "usageSwitch", enabled: switchOn.checked }) });
  usageBox.append(el("div", { class: "sechead" }, el("h2", {}, "AI Usage")),
    el("div", { class: "usage-controls" }, el("label", { class: "check" }, switchOn, "Switch AI near a limit")),
    el("p", { class: "muted small" }, "When an AI's Session or Weekly limit reaches the point you set on its card above, the same chat carries on with another AI that's set up, with everything said so far. A command or agent that's running finishes first."));
  app.replaceChildren(top, usageBox, moodsBox, more);
  function showUsage() { usageBox.scrollIntoView({ behavior: "smooth", block: "start" }); switchOn.focus({ preventScroll: true }); post({ type: "shown" }); }
  function render() {
    renderMoods(false);
    const guard = S.usageSwitch || { enabled: false, threshold: 70 };
    switchOn.checked = guard.enabled;
    more.replaceChildren(
      el("div", { class: "sechead" }, el("h2", {}, "More")),
      el("div", { class: "links" },
        link("rocket", "Get started", "set up an AI, step by step", "getStarted"),
        link("dashboard", "AI Usage panel", "every limit, at the bottom", "usagePanel"),
        link("organization", "Profiles", "personal and work: separate Claude and ChatGPT accounts", "profiles"),
        link("symbol-keyword", "Tab Completion", "engine, speed, model", "tab"),
        link("git-compare", "Model Router", "what reads your requests, which AIs Auto uses", "router"),
        link("search", "Find & download models", "models on this computer, with Ollama", "findModels"),
        link("export", "Export settings", "your preferences to a file, for another computer", "exportSettings"),
        link("desktop-download", "Import settings", "from a file you exported", "importSettings"),
        link("settings", "All settings", "Kural's, in VS Code's settings", "allSettings"),
        link("list-unordered", "Kural's log", "every request, with timings", "log"),
        link("bug", "Crash reports", "what went wrong when Kural closed unexpectedly", "crashes"),
        link("book", "Kural guide", "what every feature does", "guide"),
        link("lightbulb", "Ask for a feature", "on GitHub", "feature")));
    // Typing in an AI's settings (a switch point, a connector): leave the cards as they are until you're done. Redrawing
    // them moved the field, which took your cursor away and saved a half-typed number ("8" of "85").
    const typing = Object.values(CTL).some((C) => [C.session, C.weekly, C.name, C.kind, C.value].includes(document.activeElement));
    if (typing) { S.cardsWaiting = true; return; }
    S.cardsWaiting = false;
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
    if (S.section && S.section !== shownSection) { shownSection = S.section; showSection(S.section); }
    if (!S.section) shownSection = null;   // (opened by "Add your own mood…" or a gear before the page was ready)
  });
  setInterval(() => { if (S) render(); }, 30000);   // ("resets in", "updated … ago")
  post({ type: "ready" });
})();
