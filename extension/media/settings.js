// Kural Settings page (an editor tab). Talks to lib/settings-page.js. It is a short overview (one card per AI, moods, what
// Kural learns, links) and, one step in, a page per AI (its connectors, when to switch away from it); the connector
// catalog is one step further. One webview, one view at a time, always with a way back: V.view = main | ai | catalog | manual.
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

  // Where you are. ai: the AI whose page (or catalog) it is; added: "Added Notion." shown once on that AI's page;
  // confirm: the connector whose remove is waiting for a second click; hint: what to do after Sign in (Claude).
  const V = { view: "main", ai: null, added: "", error: "", confirm: null, hint: null, drawn: "" };
  const stage = el("div", { class: "stage" });
  const cardOf = (id) => ((S && S.cards) || []).find((c) => c.id === id);
  function go(view, ai) {
    V.view = view; if (ai) V.ai = ai;
    V.added = ""; V.error = "";
    V.confirm = null; V.hint = null; S && (S.cardsWaiting = false);
    render(true);
    if (window.scrollTo) window.scrollTo(0, 0);
    if (view === "ai" && connOf(V.ai).supported) post({ type: "connectors", id: V.ai });
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

  function connectorRow(id, x) {
    const K = connOf(id), sure = V.confirm === x.name;
    return el("div", { class: "srv-row" },
      el("span", { class: "dot " + (x.ok ? "ok" : "warn") }), el("strong", { class: "ell", title: x.target }, x.name), el("span", { class: "grow" }),
      el("span", { class: "muted small", title: x.why || x.status }, x.ok ? "Connected" : x.needsAuth ? "Needs sign-in" : /fail/i.test(x.status) ? "Failed" : x.status),
      x.managed ? el("span", { class: "muted small", title: "Added on claude.ai: change it there" }, "on claude.ai")
        : [x.needsAuth ? el("button", { class: "btn", onclick: () => { V.hint = id === "claude" ? x.name : null; post({ type: "signIn", id, name: x.name }); render(); } }, "Sign in") : null,
          sure ? [el("button", { class: "btn danger", disabled: K.busy, onclick: () => { V.confirm = null; post({ type: "removeConnector", id, name: x.name, reqId: Date.now() }); } }, "Remove?"),
            el("button", { class: "pill-btn", "aria-label": "Keep it", title: "Keep it", onclick: () => { V.confirm = null; render(); } }, icon("close"))]
            : el("button", { class: "pill-btn", title: `Remove ${x.name}`, "aria-label": `Remove ${x.name}`, disabled: K.busy, onclick: () => { V.confirm = x.name; render(); } }, icon("trash"))]);
  }
  function connectorsSection(c) {
    const id = c.id, K = connOf(id), kids = [];
    if (!K.supported) return section("Connectors", null, el("p", { class: "muted" }, "Kural can't add connectors to Google Gemini yet."));
    if (V.added) kids.push(el("div", { class: "ok-note small" }, icon("check"), " ", V.added));
    if (V.error) kids.push(el("div", { class: "err small" }, icon("warning"), " ", V.error));
    if (K.loading && !(K.servers || []).length) kids.push(el("div", { class: "muted small" }, icon("loading", "spin"), id === "claude" ? " checking each connector…" : " loading…"));
    else if (K.error) kids.push(el("div", { class: "err small" }, icon("warning"), " Couldn't list them: ", K.error));
    else if (K.servers && !K.servers.length) kids.push(el("div", { class: "muted small" }, "No connectors yet."));
    for (const x of K.servers || []) {
      kids.push(connectorRow(id, x));
      if (V.hint === x.name) kids.push(el("div", { class: "muted small hint" }, `A terminal opened. Type /mcp, pick ${x.name}, then Authenticate.`));
    }
    kids.push(el("div", { class: "muted small" }, id === "claude" ? "Claude starts again with a new connector; your chats continue." : "New ChatGPT chats use a new connector."));
    if (id === "claude") kids.push(el("div", { class: "row wrap quiet-opts" },
      el("label", { class: "check small" }, el("input", { type: "checkbox", checked: S.fullSetup, onchange: (e) => post({ type: "fullSetup", on: e.target.checked }) }), "Use my Claude Code setup (plugins, skills)"),
      el("span", { class: "grow" }),
      el("button", { class: "btn quiet", title: "Start Claude again with your setup: same conversations", onclick: () => post({ type: "reloadSetup" }) }, icon("refresh"), " Reload")));
    return section("Connectors", el("button", { class: "btn primary", disabled: K.busy, onclick: () => openCatalog(id) }, icon("add"), " Add connector"), kids);
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

  // ---------- Add connector: a catalog you search ----------
  const CAT = { ai: null, q: "", reqId: 0, items: [], note: "", loading: false, expanded: null, adding: null, errors: {}, fields: {}, timer: 0, folder: null, root: null };
  function buildCatalog() {
    if (CAT.root) return;
    CAT.title = el("h1", {}, "Add a connector");
    CAT.back = back("", () => go("ai", CAT.ai));
    CAT.search = el("input", { class: "in search", type: "search", placeholder: "Search connectors", spellcheck: "false", autocomplete: "off", "aria-label": "Search connectors" });
    CAT.search.addEventListener("input", () => { clearTimeout(CAT.timer); CAT.timer = setTimeout(() => runSearch(CAT.search.value), 300); });
    CAT.list = el("div", { class: "cat-list" });
    CAT.root = el("div", { class: "sub" }, CAT.back, CAT.title, CAT.search, CAT.list,
      el("div", { class: "cat-foot" }, el("button", { class: "linkbtn", onclick: () => openManual() }, "Add one by hand (command or web address)")));
  }
  function openCatalog(ai) {
    buildCatalog();
    Object.assign(CAT, { ai, q: "", items: [], note: "", loading: false, expanded: null, adding: null, errors: {}, fields: {}, folder: null });
    clearTimeout(CAT.timer);
    CAT.search.value = "";
    CAT.back.replaceChildren(icon("chevron-left"), " ", (cardOf(ai) || { name: "Back" }).name);
    go("catalog", ai);
    runSearch("");
    if (CAT.search.focus) CAT.search.focus();
  }
  function runSearch(q) {
    CAT.q = q.trim(); CAT.reqId = Date.now() + Math.random(); CAT.loading = !!CAT.q;
    post({ type: "catalogSearch", id: CAT.ai, query: CAT.q, reqId: CAT.reqId });
    renderCatalogList();
  }
  // Already there: a connector with this address or package (Claude shows the address with "(HTTP)" after it).
  function isAdded(item) {
    const norm = (u) => String(u || "").trim().replace(/\s+\((?:HTTP|SSE)\)$/i, "").replace(/\/+$/, "").toLowerCase();
    const url = norm(item.url), pkg = (item.package || "").toLowerCase();
    // (the address as a whole, or the package as a whole word, with or without @version: "notion" is not "notion-helper")
    return (connOf(CAT.ai).servers || []).some((s) => (url && norm(s.target) === url)
      || (pkg && String(s.target).toLowerCase().split(/\s+/).some((w) => w === pkg || w.startsWith(pkg + "@"))));
  }
  function fieldsFor(item) {
    if (CAT.fields[item.id]) return CAT.fields[item.id];
    const F = CAT.fields[item.id] = {};
    for (const i of item.inputs || []) {
      F[i.key] = el("input", { class: "in grow", type: i.secret ? "password" : "text", spellcheck: "false", autocomplete: "off", placeholder: i.placeholder || "", "aria-label": i.label });
      F[i.key].addEventListener("keydown", (e) => { if (e.key === "Enter") submitItem(item); });
    }
    return F;
  }
  function startAdd(item) {
    if (CAT.adding) return;
    // (Directory items are never added in one click: you see what will run first.)
    if (((item.inputs || []).length || item.from === "registry") && CAT.expanded !== item.id) {
      CAT.expanded = item.id; renderCatalogList(true);
      const first = Object.values(fieldsFor(item))[0]; if (first && first.focus) first.focus();
    } else submitItem(item);
  }
  function submitItem(item) {
    if (CAT.adding) return;
    const F = fieldsFor(item), values = {};
    for (const i of item.inputs || []) {
      values[i.key] = F[i.key].value.trim();
      if (!values[i.key]) { CAT.errors[item.id] = `Fill in ${i.label}.`; renderCatalogList(true); return; }
    }
    CAT.adding = item.id; CAT.errors[item.id] = "";
    post({ type: "addCatalog", id: CAT.ai, item: item.id, values, reqId: Date.now() });
    renderCatalogList(true);
  }
  function fieldsBox(item) {
    const F = fieldsFor(item);
    return el("div", { class: "cat-fields" },
      item.from === "registry" ? el("div", { class: "muted small" }, "From the public MCP directory, not checked by Kural.") : null,
      item.from === "registry" && item.shows ? el("code", { class: "cat-cmd" }, item.shows) : null,
      (item.inputs || []).map((i) => el("label", { class: "field" }, el("span", { class: "flabel" }, i.label),
        el("div", { class: "row" }, F[i.key],
          i.folder ? el("button", { class: "btn", onclick: () => { CAT.folder = { item: item.id, key: i.key, reqId: Date.now() }; post({ type: "pickFolder", reqId: CAT.folder.reqId }); } }, icon("folder"), " Browse") : null),
        i.link ? el("button", { class: "linkbtn small", onclick: () => post({ type: "openLink", url: i.link.url }) }, i.link.label) : null)),
      el("div", { class: "row" },
        el("button", { class: "btn primary", disabled: !!CAT.adding, onclick: () => submitItem(item) }, CAT.adding === item.id ? [icon("loading", "spin"), " Adding…"] : "Add"),
        el("button", { class: "btn quiet", disabled: !!CAT.adding, onclick: () => { CAT.expanded = null; renderCatalogList(true); } }, "Cancel")));
  }
  function catRow(item) {
    const open = CAT.expanded === item.id, busy = CAT.adding === item.id;
    return el("div", { class: "cat-row" + (open ? " open" : "") },
      el("div", { class: "cat-main" },
        el("div", { class: "cat-text" }, el("strong", {}, item.name), el("div", { class: "muted small desc" }, item.description),
          item.unsupported ? el("div", { class: "muted small" }, item.unsupported) : null),
        isAdded(item) ? el("span", { class: "muted small nowrap" }, icon("check"), " Added")
          : item.unsupported || open ? null
          : busy ? icon("loading", "spin")
          : el("button", { class: "btn", disabled: !!CAT.adding, onclick: () => startAdd(item) }, "Add")),
      open ? fieldsBox(item) : null,
      CAT.errors[item.id] ? el("div", { class: "err small" }, icon("warning"), " ", CAT.errors[item.id]) : null);
  }
  // The list only: the search box is never redrawn, so typing in it is safe. A field being typed in keeps its row (waits).
  function renderCatalogList(force) {
    if (!CAT.list) return;
    const a = document.activeElement;
    if (!force && a && a !== CAT.search && /^(input|textarea)$/i.test(a.tagName || a.tag || "") && Object.values(CAT.fields).some((F) => Object.values(F).includes(a))) { CAT.waiting = true; return; }
    CAT.waiting = false;
    const kids = [];
    kids.push(el("div", { class: "cat-head muted small" }, CAT.q ? "Results" : "Popular", CAT.loading ? [" ", icon("loading", "spin")] : null));
    if (!CAT.items.length && !CAT.loading) kids.push(el("p", { class: "muted" }, CAT.q ? "Nothing found. Try another word, or add one by hand below." : "Loading…"));
    for (const item of CAT.items) kids.push(catRow(item));
    if (CAT.note) kids.push(el("div", { class: "muted small" }, icon("info"), " ", CAT.note));
    CAT.list.replaceChildren(...kids);
  }

  // "Add one by hand": for power users; the old form.
  const MAN = { error: "", reqId: 0, busy: false };
  function buildManual() {
    if (MAN.root) return;
    MAN.name = el("input", { class: "in", placeholder: "name, e.g. github", spellcheck: "false", "aria-label": "Name" });
    MAN.kind = el("select", { class: "in", "aria-label": "Kind" }, el("option", { value: "command" }, "Command"), el("option", { value: "url" }, "Web address"));
    MAN.value = el("input", { class: "in grow", placeholder: "npx -y @modelcontextprotocol/server-github", spellcheck: "false", "aria-label": "Command or address" });
    MAN.kind.addEventListener("change", () => { MAN.value.placeholder = MAN.kind.value === "url" ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-github"; });
    MAN.err = el("div", { class: "err small" });
    MAN.go = el("button", { class: "btn primary", onclick: () => {
      MAN.reqId = Date.now(); MAN.error = ""; MAN.busy = true; manualDraw();
      post({ type: "addConnector", id: V.ai, reqId: MAN.reqId, connector: { name: MAN.name.value, kind: MAN.kind.value, value: MAN.value.value } });
    } }, "Add");
    MAN.root = el("div", { class: "sub" }, back("Add a connector", () => go("catalog")), el("h1", {}, "Add one by hand"),
      el("p", { class: "muted" }, "For a connector that isn't in the list. Give it a short name, then the command that starts it or its web address."),
      el("div", { class: "add-conn" }, MAN.name, MAN.kind, MAN.value), MAN.err, el("div", { class: "row" }, MAN.go));
  }
  function manualDraw() {
    MAN.err.replaceChildren(...(MAN.error ? [icon("warning"), " ", MAN.error] : []));
    MAN.go.disabled = MAN.busy;
  }
  function openManual() { buildManual(); MAN.error = ""; MAN.busy = false; manualDraw(); go("manual"); }

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

  // From the chat's "Add your own mood…": the Moods section, with a new mood's form open.
  function showMoods() {
    if (!S) return;
    go("main");
    if (!M.form) openMoodForm(null);
    moodsBox.scrollIntoView({ block: "start" });
    post({ type: "shown" });
  }

  // From the chat's model menu (the gear beside an AI's name): that AI's page. "usage" (the AI Usage panel's link): the
  // chat's AI page at its switch-point section.
  let shownSection = null;   // (the host keeps sending the section until the page says "shown": go once)
  function showSection(section) {
    if (!S) return;
    if (section === "moods") return showMoods();
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
    return !!a && /^(input|textarea|select)$/i.test(a.tagName || a.tag || "") && a.type !== "checkbox" && a !== CAT.search;
  };
  function mainView() {
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
        el("button", { class: "btn", disabled: S.refreshing, title: "Ask each AI for its usage now (Claude: one tiny request)", onclick: () => post({ type: "refresh" }) },
          icon("refresh", S.refreshing ? "spin" : ""), " Refresh usage")),
      el("div", { class: "cards" }, S.cards.map(card)),
      moodsBox,
      learnSection(),
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
  }
  function render(force) {
    if (!S) return;
    renderMoods(false);
    if (V.view === "catalog") {
      if (V.drawn !== "catalog") { stage.replaceChildren(CAT.root); V.drawn = "catalog"; }
      return renderCatalogList(!!force);
    }
    if (V.view === "manual") {
      if (V.drawn !== "manual") { stage.replaceChildren(MAN.root); V.drawn = "manual"; }
      return;
    }
    if (!force && typingNow()) { S.cardsWaiting = true; return; }
    S.cardsWaiting = false;
    stage.replaceChildren(V.view === "ai" ? aiView() : mainView());
    V.drawn = V.view;
  }
  app.replaceChildren(stage);
  // (A redraw that waited while you typed happens when you leave the field.)
  window.addEventListener("focusout", () => setTimeout(() => { if (S && S.cardsWaiting) render(); if (CAT.waiting) renderCatalogList(); }, 0));

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
    if (m.type === "show") { shownSection = m.section; showSection(m.section); }
    if (m.type === "catalogResults" && m.id === CAT.ai && m.reqId === CAT.reqId) {
      Object.assign(CAT, { items: m.items || [], note: m.note || "", loading: false });
      renderCatalogList();
    }
    if (m.type === "catalogDone" && m.id === CAT.ai) {
      CAT.adding = null;
      const item = CAT.items.find((x) => x.id === m.item);
      if (m.error) { CAT.errors[m.item] = m.error; renderCatalogList(true); }
      else { go("ai", m.id); V.added = `Added ${item ? item.name : "the connector"}.${item && item.signIn ? " Sign in to finish." : ""}`; render(true); }
    }
    if (m.type === "folder" && CAT.folder && CAT.folder.reqId === m.reqId) {
      const f = CAT.folder; CAT.folder = null;
      const F = CAT.fields[f.item];
      if (m.path && F && F[f.key]) F[f.key].value = m.path;
    }
    if (m.type === "connectorDone") {
      if (V.view === "manual" && m.reqId === MAN.reqId) {
        MAN.busy = false; MAN.error = m.error || "";
        if (!m.error) { MAN.name.value = ""; MAN.value.value = ""; go("ai", V.ai); V.added = "Added."; render(true); } else manualDraw();
      } else if (m.error && V.view === "ai") { V.added = ""; V.error = m.error; render(true); }
    }
  });
  setInterval(() => { if (S) render(); }, 30000);   // ("resets in", "updated … ago")
  post({ type: "ready" });
})();
