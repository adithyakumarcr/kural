// Kural Settings page (an editor tab). Talks to lib/settings-page.js. It is a short overview (a card per AI you use and
// "Add agent" for the others, preferences, shortcuts, what Kural learns, links, Advanced) and, one step in, a page per AI
// (where its connectors are, when to switch away from it, its account). One view at a time, always with a way back:
// V.view = main | ai. (Connectors themselves are in the side bar: lib/connectors.)
(function () {
  const vscode = acquireVsCodeApi();
  document.documentElement.style.setProperty("--fs", document.documentElement.dataset.fs || 1);
  const app = document.getElementById("app");
  const post = (m) => vscode.postMessage(m);
  let S = null;
  const SHORTCUTS_INFO = "A name that stands for a text you write once. Type / in the chat box (at the start or after a space) and pick it; Kural sends its text to the AI with your message. Works with every AI.";
  const MOODS_INFO = "How the chat's AI works with you. Pick one in the chat's model menu, under Preference. Your own show there next to the built-in ones; remove a built-in one you don't use with its ×. A new chat starts with the first one in the menu.";

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

  // Where you are. ai: the AI whose page (or catalog) it is; added: "Added Notion." shown once on that AI's page;
  // confirm: the connector whose remove is waiting for a second click; hint: what to do after Sign in (Claude).
  // addOpen: the "Add agent" list is open; advanced: the Advanced section is unfolded.
  const V = { view: "main", ai: null, drawn: "", addOpen: false, advanced: false };
  const stage = el("div", { class: "stage" });
  const cardOf = (id) => ((S && S.cards) || []).find((c) => c.id === id);
  function go(view, ai) {
    V.view = view; if (ai) V.ai = ai;
    S && (S.cardsWaiting = false);
    render(true);
    if (window.scrollTo) window.scrollTo(0, 0);
  }
  const connOf = (id) => (S && S.connectors && S.connectors[id]) || { supported: false };
  const back = (label, to) => el("button", { class: "back", onclick: to }, icon("chevron-left"), " ", label);

  // ---------- the overview: one card per AI ----------
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
    usageBars(c, body);
    // The one main thing first (Settings, or what's needed to get going), the account actions quiet after it.
    const acts = [], settings = () => el("button", { class: "btn primary", onclick: () => go("ai", c.id) }, icon("settings-gear"), " Settings");
    if (c.id === "local") acts.push(c.state === "on" ? settings() : btn("Set up", "setUp", { id: "local" }, "primary"));
    else if (c.state === "off") acts.push(btn("Set up", "setUp", { id: c.id }, "primary"));
    else if (c.state === "out") acts.push(btn("Log in", "logIn", { id: c.id }, "primary"));
    else {
      acts.push(settings());
      if (c.state === "set") acts.push(btn("Open Get started", "setUp", { id: c.id }, "quiet"));
      // (Usage page, Switch account, Log out: at the end of the AI's own page. The overview stays short.)
    }
    return el("section", { class: "card " + (c.state === "off" ? "dim" : ""), id: "ai-" + c.id }, head, body, el("div", { class: "acts" }, acts));
  }
  // Usage: each limit in words, with a bar.
  function usageBars(c, body) {
    if (c.windows.length) {
      for (const w of c.windows) {
        const lvl = w.used >= 95 ? "bad" : w.used >= 80 ? "warn" : "";
        const reset = w.reset ? "started again" : w.resetsAt ? "resets in " + until(w.resetsAt) : "";
        const bar = el("div", { class: "bar " + lvl }, el("span", { style: `width:${Math.min(100, w.used)}%` }));
        body.push(el("div", { class: "lim" }, el("div", { class: "row" }, el("span", {}, el("strong", {}, w.name), " ", el("span", { class: "pct " + lvl }, w.used + "% used")), el("span", { class: "muted" }, reset)), bar));
      }
    } else if (c.tokens) body.push(el("div", { class: "lim muted" }, "Today: " + tok(c.tokens.input) + " tokens in, " + tok(c.tokens.output) + " out"));
    if (c.at) body.push(el("div", { class: "muted small" }, "Usage updated " + ago(c.at)));
  }

  // ---------- one AI's page (the chat's gear beside its name lands here) ----------
  // The switch points are made once per AI and kept, so the page's redraws (every 30 s, every usage report) don't take them
  // from under your fingers.
  const CTL = {};
  function ctl(id) {
    if (CTL[id]) return CTL[id];
    const C = CTL[id] = {};
    const point = (which) => el("input", { class: "in threshold", type: "number", min: "1", max: "99", step: "1", "aria-label": `${which} switch point (% used)`,
      onchange: (e) => { const t = e.target; if (t.reportValidity() && t.value !== "") post({ type: "usageSwitch", ai: id, which, value: Number(t.value) }); } });
    C.session = point("session"); C.weekly = point("weekly");
    return C;
  }
  const switchOn = el("input", { type: "checkbox", onchange: () => post({ type: "usageSwitch", enabled: switchOn.checked }) });
  const ctxIn = el("input", { class: "in threshold wide", type: "number", min: "16384", step: "4096", "aria-label": "Context length in tokens",
    onchange: (e) => { const t = e.target; if (t.reportValidity() && t.value !== "") post({ type: "localContext", value: Number(t.value) }); } });

  const section = (title, ...kids) => el("section", { class: "sec" }, el("div", { class: "sechead" }, el("h2", {}, title), el("span", { class: "grow" }), kids.shift()), kids);

  // Connectors live in the side bar now (Extensions | Plugins | Connectors; Adithya, 22 Oct 2026): a pointer there, and
  // Claude's own setup switch (plugins, skills) stays here.
  function connectorsSection(c) {
    const id = c.id;
    if (!connOf(id).supported) return section("Connectors", null, el("p", { class: "muted" }, "Kural can't manage Google Gemini's connectors yet."));
    return [section("Connectors", el("button", { class: "btn primary", onclick: () => post({ type: "showConnectors", id }) }, icon("plug"), " Open Connectors"),
        el("p", { class: "muted small" }, "Add, sign in to, turn off and remove connectors in the side bar: Extensions, then its Connectors tab.")),
      id === "claude" ? section("Claude Code setup", null, el("div", { class: "row wrap quiet-opts" },
        el("label", { class: "check small" }, el("input", { type: "checkbox", checked: S.fullSetup, onchange: (e) => post({ type: "fullSetup", on: e.target.checked }) }), "Use my Claude Code setup (plugins, skills)"),
        el("span", { class: "grow" }),
        el("button", { class: "btn quiet", title: "Start Claude again with your setup: same conversations", onclick: () => post({ type: "reloadSetup" }) }, icon("refresh"), " Reload"))) : null];
  }
  function switchSection(c) {
    const C = ctl(c.id), guard = S.usageSwitch || {}, lim = (guard.limits || {})[c.id] || { session: guard.threshold, weekly: guard.threshold };
    if (document.activeElement !== C.session) C.session.value = lim.session;
    if (document.activeElement !== C.weekly) C.weekly.value = lim.weekly;
    switchOn.checked = !!guard.enabled;
    return el("section", { class: "sec", id: "switch" }, el("div", { class: "sechead" }, el("h2", {}, "Switch to another AI near a limit")),
      el("label", { class: "check" }, switchOn, "Carry on with another AI when a limit is close"),
      el("p", { class: "muted small" }, "The same chat carries on with another AI that's set up, with everything said so far. A command or agent that's running finishes first."),
      el("div", { class: "points" + (guard.enabled ? "" : " off") },
        el("div", { class: "muted small" }, "Switch when this much is used:"),
        c.id === "agy" ? null : el("label", { class: "row" }, el("span", { class: "pl" }, "Session limit"), C.session, "%"),
        el("label", { class: "row" }, el("span", { class: "pl" }, "Weekly limit"), C.weekly, "%")));
  }
  function localSections(c) {
    if (document.activeElement !== ctxIn) ctxIn.value = S.localContext || 32768;
    return [section("Model", c.state === "on" ? btn("Change", "setUp", { id: "local" }, "quiet") : null,
        el("p", { class: "muted" }, c.state === "on" ? [c.who, " · on this computer."] : "No model set up yet."),
        el("button", { class: "btn", onclick: () => post({ type: "findModels" }) }, icon("search"), " Find & download models…")),
      el("section", { class: "sec" }, el("div", { class: "sechead" }, el("h2", {}, "Context length")),
        el("label", { class: "row" }, ctxIn, "tokens the model can look at in a chat"),
        el("p", { class: "muted small" }, "32,768 works well; more needs more memory. Your own model works offline, and has no connectors or usage limits."))];
  }
  function aiView() {
    const c = cardOf(V.ai);
    if (!c) return el("div", { class: "sub" }, back("Kural Settings", () => go("main")), el("p", { class: "muted" }, "Loading…"));
    const sub = [c.who, c.plan].filter(Boolean).join(" · ");
    return el("div", { class: "sub" }, back("Kural Settings", () => go("main")),
      el("div", { class: "subhead" }, icon(ICONS[c.id] || "account"), el("h1", {}, c.name), sub ? el("span", { class: "muted" }, sub) : null),
      c.id === "local" ? localSections(c) : [connectorsSection(c), switchSection(c), accountSection(c)]);
  }
  // The account, last on the AI's page: its usage page, switch to another account, log out.
  function accountSection(c) {
    if (c.state !== "on") return null;
    return el("section", { class: "sec" }, el("div", { class: "sechead" }, el("h2", {}, "Account")),
      el("div", { class: "acts" },
        c.page ? el("button", { class: "btn quiet", onclick: () => post({ type: "usagePage", id: c.id }) }, icon("link-external"), " Usage page") : null,
        btn("Switch account", "switch", { id: c.id }, "quiet"), btn("Log out", "logOut", { id: c.id }, "quiet")));
  }

  function link(iconName, label, hint, type) {
    return el("button", { class: "link", onclick: () => post({ type }) }, icon(iconName), el("span", { class: "lt" }, el("span", {}, label), hint ? el("span", { class: "muted small" }, hint) : null));
  }

  // ---------- What Kural learns ----------
  const L = { confirm: null };
  function learnRow(which, title, what, d) {
    const sure = L.confirm === which;
    return el("div", { class: "learn-row" },
      el("div", { class: "learn-text" }, el("label", { class: "check" }, el("input", { type: "checkbox", checked: d.on, onchange: (e) => post({ type: "learn", which, on: e.target.checked }) }), el("strong", {}, title)),
        el("div", { class: "muted small" }, what)),
      sure ? el("span", { class: "row" }, el("button", { class: "btn danger", onclick: () => { L.confirm = null; post({ type: "forget", which }); render(); } }, "Delete?"),
          el("button", { class: "btn quiet", onclick: () => { L.confirm = null; render(); } }, "Keep"))
        : el("button", { class: "btn quiet", disabled: !d.has, title: d.has ? "" : "Nothing learned yet", onclick: () => { L.confirm = which; render(); } }, "Delete what it learned"));
  }
  function learnSection() {
    const d = S.learn;
    if (!d) return null;
    return el("section", { class: "sec", id: "learn" }, el("div", { class: "sechead" }, el("h2", {}, "What Kural learns")),
      learnRow("tab", "Tab Completion learns from your work", "What you asked the chat, suggestions you accepted and terminal commands in this workspace. Stays on this computer.", d.tab),
      learnRow("router", "Auto learns which models you prefer", "From what you do after its answers: picking another model, undoing a change, carrying on. Stays on this computer.", d.router));
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
        el("h3", {}, F.id ? "Change this preference" : "Add a preference"),
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
          title: last ? "The chat needs at least one preference" : `Remove ${m.label} from the chat's model menu`,
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
          : el("button", { class: "btn quiet", title: `Delete this preference (chats using it go to ${m.label === first ? "the next one" : first})`, onclick: () => { M.confirm = m.id; renderMoods(true); } }, icon("trash"))),
      el("div", { class: "muted small clamp2" }, m.instructions)));
    moodsBox.replaceChildren(...[   // (replaceChildren writes a null as the word "null": left out)
      el("div", { class: "sechead" }, el("h2", {}, "Preferences"),
        el("span", { class: "muted info-tip", tabindex: "0", "aria-label": MOODS_INFO, title: MOODS_INFO }, icon("info")), el("span", { class: "grow" }),
        M.form ? null : el("button", { class: "btn", onclick: () => openMoodForm(null) }, icon("add"), " Add a preference")),
      builtInMoods(D),
      D.mine.length ? el("div", { class: "mood-list" }, mine) : (M.form ? null : el("p", { class: "muted small" }, "No preferences of your own yet.")),
      M.form ? moodForm() : null].filter(Boolean));
  }

  // From the chat's "Add your own mood…": the Moods section, with a new mood's form open.
  function showMoods() {
    if (!S) return;
    go("main");
    if (!M.form) openMoodForm(null);
    moodsBox.scrollIntoView({ block: "start" });
    post({ type: "shown" });
  }

  // ---------- Shortcuts ----------
  // Your shortcuts (issue #107): "/pr-summary" in the chat box stands for a text you write here once. Drawn on its own
  // like the moods (renderShortcuts), so a redraw never takes the form away while you type.
  const shortcutsBox = el("section", { class: "moods-sec", id: "shortcuts" });
  let K = { form: null, confirm: null, drawn: "" };   // form: { old, fields: { name, text }, count, error, busy, reqId }
  const SHORTCUT_EXAMPLES = [
    { name: "pr-summary", text: "Write a summary of this pull request: what changed and why, in a few bullet points, then how to test it." },
    { name: "test", text: "Test it: run the tests that cover what changed, fix what fails, and tell me what passed and what failed." },
    { name: "explain", text: "Explain this step by step, in plain words, as if I'm new to this code." },
  ];
  function openShortcutForm(x) {
    const L = S.shortcuts.limits;
    const name = el("input", { class: "in", spellcheck: "false", maxlength: L.name, placeholder: "e.g. pr-summary" });
    const text = el("textarea", { class: "in", spellcheck: "true", rows: "7", maxlength: L.text, placeholder: "e.g. Write a summary of this pull request: what changed and why, then how to test it." });
    name.value = x ? x.name : ""; text.value = x ? x.text : "";
    const count = el("span", { class: "muted small count" });
    const counted = () => { count.textContent = `${text.value.length} / ${L.text}`; };
    text.addEventListener("input", counted); counted();
    K.form = { old: x ? x.name : null, fields: { name, text }, count, error: "", busy: false };
    renderShortcuts(true);
    name.focus();
  }
  function saveShortcut() {
    const F = K.form; if (!F || F.busy) return;
    F.busy = true; F.error = ""; F.reqId = Date.now();
    post({ type: "saveShortcut", reqId: F.reqId, old: F.old, name: F.fields.name.value, text: F.fields.text.value });
    renderShortcuts(true);
  }
  function shortcutForm() {
    const F = K.form, X = F.fields;
    const row = (label, input, note) => el("label", { class: "field" }, el("span", { class: "flabel" }, label, note ? el("span", { class: "muted small" }, " ", note) : null), input);
    const example = (x) => { X.name.value = x.name; X.text.value = x.text; X.text.dispatchEvent(new Event("input")); X.text.focus(); };
    return el("div", { class: "mood-form" },
      el("div", { class: "mood-form-main" },
        el("h3", {}, F.old ? "Change this shortcut" : "Add a shortcut"),
        row("Name", X.name, "(you type it after /: lowercase letters, digits and -)"),
        row("What it stands for", X.text, "(sent to the AI with your message)"),
        el("div", { class: "row" }, F.count, el("span", { class: "grow" }),
          F.error ? el("span", { class: "err" }, icon("warning"), " ", F.error) : null),
        el("div", { class: "row" },
          el("button", { class: "btn primary", disabled: F.busy, onclick: saveShortcut }, F.busy ? "Saving…" : "Save"),
          el("button", { class: "btn", onclick: () => { K.form = null; renderShortcuts(true); } }, "Cancel"))),
      el("aside", { class: "mood-tips" },
        el("h4", {}, icon("lightbulb"), " How it works"),
        el("ul", {},
          el("li", {}, el("strong", {}, "Type / in the chat box"), " ", el("span", { class: "muted" }, "at the start or after a space, then pick it: it goes in as a chip.")),
          el("li", {}, el("strong", {}, "Mix it with your words."), " ", el("span", { class: "muted" }, "\"hi! please do /pr-summary\": the AI gets your message and what the shortcut stands for.")),
          el("li", {}, el("strong", {}, "Every AI."), " ", el("span", { class: "muted" }, "Claude, Gemini, ChatGPT and your own model. Yours wins over a Claude skill with the same name."))),
        el("h4", {}, "Start from an example"),
        el("div", { class: "examples" }, SHORTCUT_EXAMPLES.map((x) => el("button", { class: "btn", title: x.text, onclick: () => example(x) }, `/${x.name}`)))));
  }
  function renderShortcuts(force) {
    const D = S.shortcuts;
    if (!D) return;
    const key = JSON.stringify(D.mine) + (K.confirm || "");
    if (!force && key === K.drawn) return;
    K.drawn = key;
    const mine = D.mine.map((x) => el("div", { class: "mood-item" },
      el("div", { class: "row" }, el("strong", { class: "mono" }, `/${x.name}`), el("span", { class: "grow" }),
        el("button", { class: "btn", onclick: () => openShortcutForm(x) }, icon("edit"), " Edit"),
        K.confirm === x.name
          ? el("button", { class: "btn danger", onclick: () => { K.confirm = null; post({ type: "deleteShortcut", name: x.name }); } }, "Delete it?")
          : el("button", { class: "btn quiet", title: "Delete this shortcut", onclick: () => { K.confirm = x.name; renderShortcuts(true); } }, icon("trash"))),
      el("div", { class: "muted small clamp2" }, x.text)));
    shortcutsBox.replaceChildren(...[
      el("div", { class: "sechead" }, el("h2", {}, "Shortcuts"),
        el("span", { class: "muted info-tip", tabindex: "0", "aria-label": SHORTCUTS_INFO, title: SHORTCUTS_INFO }, icon("info")), el("span", { class: "grow" }),
        K.form ? null : el("button", { class: "btn", onclick: () => openShortcutForm(null) }, icon("add"), " Add a shortcut")),
      D.mine.length ? el("div", { class: "mood-list" }, mine) : (K.form ? null : el("p", { class: "muted small" }, "No shortcuts yet. Make one for a prompt you type often, like /pr-summary.")),
      K.form ? shortcutForm() : null].filter(Boolean));
  }
  // From the chat's "Make a shortcut…": the Shortcuts section, with a new shortcut's form open.
  function showShortcuts() {
    if (!S) return;
    go("main");
    if (!K.form) openShortcutForm(null);
    shortcutsBox.scrollIntoView({ block: "start" });
    post({ type: "shown" });
  }

  // From the chat's model menu (the gear beside an AI's name): that AI's page. "usage" (the AI Usage panel's link): the
  // chat's AI page at its switch-point section.
  let shownSection = null;   // (the host keeps sending the section until the page says "shown": go once)
  function showSection(section) {
    if (!S) return;
    if (section === "moods") return showMoods();
    if (section === "shortcuts") return showShortcuts();
    if (section === "usage") {
      go("ai", S.chatAI && S.chatAI !== "local" && cardOf(S.chatAI) ? S.chatAI : "claude");
      const sw = document.getElementById("switch"); if (sw) sw.scrollIntoView({ block: "start" });
      return post({ type: "shown" });
    }
    if (!cardOf(section)) return;
    go("ai", section);
    post({ type: "shown" });
  }

  // ---------- drawing ----------
  // Typing in a field of the AI's page (a switch point, the context length): leave the page as it is until you're done.
  // Redrawing it moved the field, which took your cursor away and saved a half-typed number ("8" of "85").
  const typingNow = () => {
    const a = document.activeElement;
    return !!a && /^(input|textarea|select)$/i.test(a.tagName || a.tag || "") && a.type !== "checkbox";
  };
  function mainView() {
    // Only the AIs you use get a card; the rest are one "Add agent" button.
    const shown = S.cards.filter((c) => c.state !== "off"), rest = S.cards.filter((c) => c.state === "off");
    return el("div", { class: "main" },
      el("header", {},
        el("div", { class: "title" }, el("h1", {}, "Kural Settings"),
          el("div", { class: "muted" }, S.loading ? [icon("loading", "spin"), " checking who's logged in…"] : "Your AI accounts, their usage, and Kural itself.")),
        el("span", { class: "grow" }),
        el("div", { class: "update" },
          el("div", { class: "row" }, el("span", { class: "muted" }, S.version),
            el("button", { class: "btn primary", disabled: S.checking, onclick: () => post({ type: "updates" }) }, icon(S.checking ? "loading" : "sync", S.checking ? "spin" : ""), " Check for updates")),
          el("label", { class: "check small" }, el("input", { type: "checkbox", checked: S.autoUpdates, onchange: (e) => post({ type: "autoUpdates", value: e.target.checked }) }), "Look for updates once a day"))),
      el("div", { class: "sechead" }, el("h2", {}, "Your AI"), el("span", { class: "grow" }),
        shown.some((c) => c.windows.length || c.tokens) ? el("button", { class: "btn quiet", disabled: S.refreshing, title: "Ask each AI for its usage now (Claude: one tiny request)", onclick: () => post({ type: "refresh" }) },
          icon("refresh", S.refreshing ? "spin" : ""), " Refresh usage") : null,
        addAgent(rest)),
      shown.length ? el("div", { class: "cards" }, shown.map(card))
        : el("p", { class: "muted" }, "No AI is set up yet. Add one: Claude, Google Gemini, ChatGPT or a model on this computer."),
      moodsBox,
      shortcutsBox,
      learnSection(),
      el("div", { class: "sechead" }, el("h2", {}, "More")),
      el("div", { class: "links" },
        link("rocket", "Get started", "set up an AI, step by step", "getStarted"),
        link("megaphone", "What's new", "the release notes of this version", "whatsNew"),
        link("organization", "Profiles", "personal and work: separate Claude and ChatGPT accounts", "profiles"),
        link("export", "Export settings", "your preferences to a file, for another computer", "exportSettings"),
        link("desktop-download", "Import settings", "from a file you exported", "importSettings"),
        link("book", "Kural guide", "what every feature does", "guide"),
        link("lightbulb", "Ask for a feature", "on GitHub", "feature")),
      // Advanced: folded until you open it (kept open across the page's redraws).
      el("details", { class: "advanced", open: V.advanced, ontoggle: (e) => { V.advanced = e.target.open; } },
        el("summary", {}, el("h2", {}, "Advanced")),
        el("div", { class: "links" },
          link("settings", "All settings", "Kural's, in VS Code's settings", "allSettings"),
          link("list-unordered", "Kural's log", "every request, with timings", "log"),
          link("bug", "Crash reports", "what went wrong when Kural closed unexpectedly", "crashes"),
          link("trash", "Remove Kural's data", "before uninstalling: keys, logins, chats and settings", "removeData"))));
  }
  // "Add agent": the AIs that aren't set up yet, in a short list under the button (they took a big card each before:
  // Adithya, 22 Oct 2026). Each opens Get started at that AI.
  function addAgent(rest) {
    if (!rest.length) return null;
    const list = V.addOpen ? el("div", { class: "add-menu", role: "menu" },
      rest.map((c) => el("button", { class: "add-item", role: "menuitem", onclick: () => { V.addOpen = false; post({ type: "setUp", id: c.id }); render(true); } },
        icon(ICONS[c.id] || "account"), el("span", { class: "lt" }, el("span", {}, c.name), el("span", { class: "muted small" }, c.what)))),
      el("button", { class: "add-item foot", role: "menuitem", onclick: () => { V.addOpen = false; post({ type: "getStarted" }); render(true); } },
        icon("rocket"), el("span", {}, "Get started, step by step"))) : null;
    return el("div", { class: "add-wrap" },
      el("button", { class: "btn primary", "aria-expanded": String(!!V.addOpen), onclick: () => { V.addOpen = !V.addOpen; render(true); } },
        icon("add"), " Add agent", icon("chevron-down")), list);
  }
  function render(force) {
    if (!S) return;
    renderMoods(false);
    renderShortcuts(false);
    if (!force && typingNow()) { S.cardsWaiting = true; return; }
    S.cardsWaiting = false;
    stage.replaceChildren(V.view === "ai" ? aiView() : mainView());
    V.drawn = V.view;
  }
  app.replaceChildren(stage);
  // (The "Add agent" list closes on a click elsewhere or Escape.)
  const closeAdd = () => { if (V.addOpen) { V.addOpen = false; render(true); } };
  window.addEventListener("click", (e) => { if (!(e.target.closest && e.target.closest(".add-wrap"))) closeAdd(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAdd(); });
  // (A redraw that waited while you typed happens when you leave the field.)
  window.addEventListener("focusout", () => setTimeout(() => { if (S && S.cardsWaiting) render(); }, 0));

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "state") {
      S = m; render();
      if (S.section && S.section !== shownSection) { shownSection = S.section; showSection(S.section); }
      if (!S.section) shownSection = null;   // (opened by "Add your own mood…" or a gear before the page was ready)
      return;
    }
    if (m.type === "moodSaved" && M.form && M.form.reqId === m.reqId) {
      M.form.busy = false;
      if (m.error) { M.form.error = m.error; renderMoods(true); } else { M.form = null; renderMoods(true); }
    }
    if (m.type === "shortcutSaved" && K.form && K.form.reqId === m.reqId) {
      K.form.busy = false;
      if (m.error) K.form.error = m.error; else K.form = null;
      renderShortcuts(true);
    }
    if (m.type === "show") { shownSection = m.section; showSection(m.section); }
  });
  setInterval(() => { if (S) render(); }, 30000);   // ("resets in", "updated … ago")
  post({ type: "ready" });
})();
