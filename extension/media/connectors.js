// The Connectors tab's page (lib/connectors/index.js): the connectors of the AI your chat uses (Claude or ChatGPT), each
// with its state, Kural's own on/off, Sign in and Remove; "Add connector" opens a list you search (Popular ones and the
// official MCP directory), and "Add one by hand" takes a command or web address. One view at a time, always with a way
// back: V.view = list | catalog | manual. Same rules as Kural Settings had: a directory item never adds in one click (you
// see what will run first), the search box and the fields are never redrawn under your fingers.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);

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
  const back = (label, to) => el("button", { class: "back", onclick: to }, icon("chevron-left"), " ", label);

  let S = null;   // the host's state (Connectors.state)
  // added: "Added Notion." shown once; error: what went wrong; confirm: the connector whose Remove waits for a second click;
  // hint: what to do after Sign in (Claude).
  const V = { view: "list", added: "", error: "", confirm: null, hint: null };
  const NAME = { claude: "Claude", codex: "ChatGPT" };

  // ---------- the top: whose connectors ----------
  const aiSel = el("select", { class: "ai", "aria-label": "Whose connectors", onchange: () => { go("list"); post({ type: "pick", ai: aiSel.value }); } });
  const top = el("div", { class: "top" }, el("label", { class: "for" }, "Connectors for"), aiSel);
  const stage = el("div", { class: "stage" });
  app.append(top, stage);
  function drawTop() {
    const want = S.ais.map((a) => a.id).join() + "|" + (S.ai || "");
    if (aiSel.dataset.drawn === want) return;
    aiSel.dataset.drawn = want;
    aiSel.replaceChildren(...(S.ai ? [] : [el("option", { value: "", selected: true, disabled: true }, "Pick an AI")]),
      ...S.ais.map((a) => el("option", { value: a.id, selected: a.id === S.ai }, a.name + (a.id === S.chatAI ? " (the chat's)" : ""))));
  }

  function go(view) {
    V.view = view; V.added = ""; V.error = ""; V.confirm = null; V.hint = null;
    render(true);
  }

  // ---------- the list ----------
  function row(x) {
    const sure = V.confirm === x.name, busy = S.busy;
    const state = x.off ? "Off in Kural" : x.ok ? "Connected" : x.needsAuth ? "Needs sign-in" : /fail/i.test(x.status || "") ? "Failed" : x.status;
    const onOff = el("label", { class: "check", title: x.off ? `Turned off: Kural's ${NAME[S.ai]} chats don't use it` : "On: Kural's chats can use it. Untick to turn it off everywhere in Kural" },
      el("input", { type: "checkbox", checked: !x.off, disabled: busy, "aria-label": `${x.name} on`, onchange: (e) => post({ type: "connectorOff", name: x.name, off: !e.target.checked }) }), "On");
    const where = x.managed === "plugin" ? el("span", { class: "muted", title: "Comes with a plugin: turn the plugin off or remove it in the Plugins tab" }, `from ${x.plugin || "a"} plugin`)
      : x.managed ? el("span", { class: "muted", title: "Added on claude.ai: remove it there (Settings → Connectors)" }, "on claude.ai") : null;
    const acts = x.managed ? [] : [
      x.needsAuth ? el("button", { class: "btn", onclick: () => { V.hint = S.ai === "claude" ? x.name : null; post({ type: "signIn", name: x.name }); render(true); } }, "Sign in") : null,
      sure ? [el("button", { class: "btn danger", disabled: busy, onclick: () => { V.confirm = null; post({ type: "removeConnector", name: x.name, reqId: Date.now() }); } }, "Remove?"),
        el("button", { class: "icon-btn", "aria-label": "Keep it", title: "Keep it", onclick: () => { V.confirm = null; render(true); } }, icon("close"))]
        : el("button", { class: "icon-btn", title: `Remove ${x.name}`, "aria-label": `Remove ${x.name}`, disabled: busy, onclick: () => { V.confirm = x.name; render(true); } }, icon("trash"))];
    return el("div", { class: "srv" + (x.off ? " off" : "") },
      el("div", { class: "line" }, el("span", { class: "dot " + (x.off ? "" : x.ok ? "ok" : "warn") }), el("strong", { class: "ell", title: x.target || x.name }, x.name),
        el("span", { class: "grow" }), el("span", { class: "muted small", title: x.why || x.status || "" }, state)),
      el("div", { class: "line sub" }, onOff, where, el("span", { class: "grow" }), acts),
      V.hint === x.name ? el("div", { class: "muted small hint" }, `A terminal opened. Type /mcp, pick ${x.name}, then Authenticate.`) : null);
  }
  function listView() {
    if (!S.ai) return el("div", { class: "pad" }, el("p", { class: "muted" }, "Kural manages connectors for Claude and ChatGPT. Your chat uses another AI (Google Gemini or a model on this computer has none here yet): pick one above."));
    if (S.notSetUp) return el("div", { class: "pad" }, el("p", { class: "muted" }, `${NAME[S.ai]} isn't set up on this computer yet.`),
      el("button", { class: "btn primary", onclick: () => post({ type: "setUp" }) }, "Set up"));
    const kids = [el("button", { class: "btn primary wide", disabled: S.busy, onclick: () => openCatalog() }, icon("add"), " Add connector")];
    if (V.added) kids.push(el("div", { class: "ok-note" }, icon("check"), " ", V.added));
    if (V.error) kids.push(el("div", { class: "err" }, icon("warning"), " ", V.error));
    if (S.loading && !S.servers.length) kids.push(el("div", { class: "muted small" }, icon("loading", "spin"), S.ai === "claude" ? " checking each connector…" : " loading…"));
    else if (S.error) kids.push(el("div", { class: "err" }, icon("warning"), " Couldn't list them: ", S.error));
    else if (S.listed && !S.servers.length) kids.push(el("div", { class: "muted small" }, "No connectors yet. Add one to give the AI your tools: Notion, Linear, GitHub, a database…"));
    const rows = el("div", { class: "srvs" }, S.servers.map(row));
    kids.push(rows);
    kids.push(el("div", { class: "muted small" }, S.ai === "claude" ? "Claude starts again with a new connector; your chats continue." : "New ChatGPT chats use a new connector."));
    if (S.ai === "claude") kids.push(el("div", { class: "opts" },
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: S.fullSetup, onchange: (e) => post({ type: "fullSetup", on: e.target.checked }) }), "Use my Claude Code setup (plugins, skills)"),
      el("button", { class: "btn quiet", title: "Start Claude again with your setup: same conversations", onclick: () => post({ type: "reloadSetup" }) }, icon("refresh"), " Reload")));
    return el("div", { class: "pad" }, kids);
  }

  // ---------- Add connector: a catalog you search ----------
  const CAT = { q: "", reqId: 0, items: [], note: "", loading: false, expanded: null, adding: null, errors: {}, fields: {}, timer: 0, folder: null, root: null };
  function buildCatalog() {
    if (CAT.root) return;
    CAT.search = el("input", { class: "in", type: "search", placeholder: "Search connectors", spellcheck: "false", autocomplete: "off", "aria-label": "Search connectors" });
    CAT.search.addEventListener("input", () => { clearTimeout(CAT.timer); CAT.timer = setTimeout(() => runSearch(CAT.search.value), 300); });
    CAT.list = el("div", { class: "cat-list" });
    CAT.root = el("div", { class: "pad" }, back("Connectors", () => go("list")), el("h3", {}, "Add a connector"), CAT.search, CAT.list,
      el("button", { class: "linkbtn", onclick: () => openManual() }, "Add one by hand (command or web address)"));
  }
  function openCatalog() {
    buildCatalog();
    Object.assign(CAT, { q: "", items: [], note: "", loading: false, expanded: null, adding: null, errors: {}, fields: {}, folder: null });
    clearTimeout(CAT.timer);
    CAT.search.value = "";
    go("catalog");
    runSearch("");
    CAT.search.focus();
  }
  function runSearch(q) {
    CAT.q = q.trim(); CAT.reqId = Date.now() + Math.random(); CAT.loading = !!CAT.q;
    post({ type: "catalogSearch", id: S.ai, query: CAT.q, reqId: CAT.reqId });
    renderCatalogList();
  }
  // Already there: a connector with this address or package (Claude shows the address with "(HTTP)" after it).
  function isAdded(item) {
    const norm = (u) => String(u || "").trim().replace(/\s+\((?:HTTP|SSE)\)$/i, "").replace(/\/+$/, "").toLowerCase();
    const url = norm(item.url), pkg = (item.package || "").toLowerCase();
    return ((S && S.servers) || []).some((s) => (url && norm(s.target) === url)
      || (pkg && String(s.target).toLowerCase().split(/\s+/).some((w) => w === pkg || w.startsWith(pkg + "@"))));
  }
  function fieldsFor(item) {
    if (CAT.fields[item.id]) return CAT.fields[item.id];
    const F = CAT.fields[item.id] = {};
    for (const i of item.inputs || []) {
      F[i.key] = el("input", { class: "in", type: i.secret ? "password" : "text", spellcheck: "false", autocomplete: "off", placeholder: i.placeholder || "", "aria-label": i.label });
      F[i.key].addEventListener("keydown", (e) => { if (e.key === "Enter") submitItem(item); });
    }
    return F;
  }
  function startAdd(item) {
    if (CAT.adding) return;
    // (Directory items are never added in one click: you see what will run first.)
    if (((item.inputs || []).length || item.from === "registry") && CAT.expanded !== item.id) {
      CAT.expanded = item.id; renderCatalogList(true);
      const first = Object.values(fieldsFor(item))[0]; if (first) first.focus();
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
    post({ type: "addCatalog", id: S.ai, item: item.id, values, reqId: Date.now() });
    renderCatalogList(true);
  }
  function fieldsBox(item) {
    const F = fieldsFor(item);
    return el("div", { class: "cat-fields" },
      item.from === "registry" ? el("div", { class: "muted small" }, "From the public MCP directory, not checked by Kural.") : null,
      item.from === "registry" && item.shows ? el("code", { class: "cat-cmd" }, item.shows) : null,
      (item.inputs || []).map((i) => el("label", { class: "field" }, el("span", { class: "flabel" }, i.label),
        el("div", { class: "line" }, F[i.key],
          i.folder ? el("button", { class: "btn", onclick: () => { CAT.folder = { item: item.id, key: i.key, reqId: Date.now() }; post({ type: "pickFolder", reqId: CAT.folder.reqId }); } }, icon("folder"), " Browse") : null),
        i.link ? el("button", { class: "linkbtn small", onclick: () => post({ type: "openLink", url: i.link.url }) }, i.link.label) : null)),
      el("div", { class: "line" },
        el("button", { class: "btn primary", disabled: !!CAT.adding, onclick: () => submitItem(item) }, CAT.adding === item.id ? [icon("loading", "spin"), " Adding…"] : "Add"),
        el("button", { class: "btn quiet", disabled: !!CAT.adding, onclick: () => { CAT.expanded = null; renderCatalogList(true); } }, "Cancel")));
  }
  function catRow(item) {
    const open = CAT.expanded === item.id, busy = CAT.adding === item.id;
    return el("div", { class: "cat-row" + (open ? " open" : "") },
      el("div", { class: "line top-align" },
        el("div", { class: "grow" }, el("strong", {}, item.name), el("div", { class: "muted small desc" }, item.description),
          item.unsupported ? el("div", { class: "muted small" }, item.unsupported) : null),
        isAdded(item) ? el("span", { class: "muted small nowrap" }, icon("check"), " Added")
          : item.unsupported || open ? null
          : busy ? icon("loading", "spin")
          : el("button", { class: "btn", disabled: !!CAT.adding, onclick: () => startAdd(item) }, "Add")),
      open ? fieldsBox(item) : null,
      CAT.errors[item.id] ? el("div", { class: "err" }, icon("warning"), " ", CAT.errors[item.id]) : null);
  }
  // The list only: the search box is never redrawn, so typing in it is safe. A field being typed in keeps its row (waits).
  function renderCatalogList(force) {
    if (!CAT.list) return;
    const a = document.activeElement;
    if (!force && a && a !== CAT.search && /^(input|textarea)$/i.test(a.tagName || "") && Object.values(CAT.fields).some((F) => Object.values(F).includes(a))) { CAT.waiting = true; return; }
    CAT.waiting = false;
    const kids = [el("div", { class: "cat-head muted small" }, CAT.q ? "Results" : "Popular", CAT.loading ? [" ", icon("loading", "spin")] : null)];
    if (!CAT.items.length && !CAT.loading) kids.push(el("p", { class: "muted" }, CAT.q ? "Nothing found. Try another word, or add one by hand below." : "Loading…"));
    for (const item of CAT.items) kids.push(catRow(item));
    if (CAT.note) kids.push(el("div", { class: "muted small" }, icon("info"), " ", CAT.note));
    CAT.list.replaceChildren(...kids);
  }

  // ---------- Add one by hand ----------
  const MAN = { error: "", reqId: 0, busy: false };
  function buildManual() {
    if (MAN.root) return;
    MAN.name = el("input", { class: "in", placeholder: "name, e.g. github", spellcheck: "false", "aria-label": "Name" });
    MAN.kind = el("select", { class: "in", "aria-label": "Kind" }, el("option", { value: "command" }, "Command"), el("option", { value: "url" }, "Web address"));
    MAN.value = el("input", { class: "in", placeholder: "npx -y @modelcontextprotocol/server-github", spellcheck: "false", "aria-label": "Command or address" });
    MAN.kind.addEventListener("change", () => { MAN.value.placeholder = MAN.kind.value === "url" ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-github"; });
    MAN.err = el("div", { class: "err" });
    MAN.go = el("button", { class: "btn primary", onclick: () => {
      MAN.reqId = Date.now(); MAN.error = ""; MAN.busy = true; manualDraw();
      post({ type: "addConnector", reqId: MAN.reqId, connector: { name: MAN.name.value, kind: MAN.kind.value, value: MAN.value.value } });
    } }, "Add");
    MAN.root = el("div", { class: "pad" }, back("Add a connector", () => { go("catalog"); }), el("h3", {}, "Add one by hand"),
      el("p", { class: "muted small" }, "For a connector that isn't in the list. Give it a short name, then the command that starts it or its web address."),
      el("div", { class: "form" }, MAN.name, MAN.kind, MAN.value), MAN.err, el("div", { class: "line" }, MAN.go));
  }
  function manualDraw() {
    MAN.err.replaceChildren(...(MAN.error ? [icon("warning"), " ", MAN.error] : []));
    MAN.go.disabled = MAN.busy;
  }
  function openManual() { buildManual(); MAN.error = ""; MAN.busy = false; manualDraw(); V.view = "manual"; render(true); }

  // ---------- drawing ----------
  let drawn = "";
  function render(force) {
    if (!S) return;
    drawTop();
    if (V.view === "catalog") {
      if (drawn !== "catalog") { stage.replaceChildren(CAT.root); drawn = "catalog"; }
      return renderCatalogList(!!force);
    }
    if (V.view === "manual") {
      if (drawn !== "manual") { stage.replaceChildren(MAN.root); drawn = "manual"; }
      return;
    }
    stage.replaceChildren(listView());
    drawn = "list";
  }
  window.addEventListener("focusout", () => setTimeout(() => { if (CAT.waiting) renderCatalogList(); }, 0));

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "fontScale") { setFs(m.value); return; }
    if (m.type === "state") {
      const aiChanged = S && S.ai !== m.ai;
      S = m;
      if (aiChanged && V.view !== "list") { go("list"); return; }
      render();
      return;
    }
    if (m.type === "catalogResults" && S && m.id === S.ai && m.reqId === CAT.reqId) {
      Object.assign(CAT, { items: m.items || [], note: m.note || "", loading: false });
      renderCatalogList();
    }
    if (m.type === "catalogDone" && S && m.id === S.ai) {
      CAT.adding = null;
      const item = CAT.items.find((x) => x.id === m.item);
      if (m.error) { CAT.errors[m.item] = m.error; renderCatalogList(true); }
      else { go("list"); V.added = `Added ${item ? item.name : "the connector"}.${item && item.signIn ? " Sign in to finish." : ""}`; render(true); }
    }
    if (m.type === "folder" && CAT.folder && CAT.folder.reqId === m.reqId) {
      const f = CAT.folder; CAT.folder = null;
      const F = CAT.fields[f.item];
      if (m.path && F && F[f.key]) F[f.key].value = m.path;
    }
    if (m.type === "connectorDone") {
      if (V.view === "manual" && m.reqId === MAN.reqId) {
        MAN.busy = false; MAN.error = m.error || "";
        if (!m.error) { MAN.name.value = ""; MAN.value.value = ""; go("list"); V.added = "Added."; render(true); } else manualDraw();
      } else if (m.error && V.view === "list") { V.added = ""; V.error = m.error; render(true); }
    }
  });
  post({ type: "ready" });
})();
