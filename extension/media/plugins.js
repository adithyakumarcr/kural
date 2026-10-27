// The Plugins tab's page (lib/plugins/index.js): the plugins of the AI your chat uses, laid out like VS Code's
// Extensions: Installed, then what you can add (Claude: Anthropic's directory and your marketplaces; Codex: your
// marketplaces), then the marketplaces. Gemini has no catalog: Installed, and "Add a plugin" from a folder or a Git
// address. The search box filters all of it. Rows are drawn only where you look (Claude's directory has 3,500 plugins).
// Click a plugin for its page (details tab); Install, Turn off / on and Remove are on the row.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);

  const saved = vscode.getState() || {};
  const S = {
    st: null,                 // the host's state (see Plugins.state)
    available: {},            // ai -> { version, items }
    q: saved.q || "",
    closed: new Set(saved.closed || []),   // sections you closed ("installed", "available", "markets", "add")
    sel: saved.sel || null,   // the selected plugin's id
  };
  const keep = () => vscode.setState({ q: S.q, closed: [...S.closed], sel: S.sel });

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
  // Icons: Codicons (VS Code's icon set, media/codicons). Never emoji.
  const icon = (name) => el("i", { class: `codicon codicon-${name}`, "aria-hidden": "true" });

  // ---------- the top: whose plugins, search ----------
  // (Refresh is the title bar's button: VS Code's own in the Extensions side bar, rebrand.py.)
  const aiSel = el("select", { class: "ai", "aria-label": "Whose plugins", onchange: () => post({ type: "pick", ai: aiSel.value }) });
  const input = el("input", { class: "q", type: "text", spellcheck: "false", "aria-label": "Search plugins" });
  input.value = S.q;
  const msg = el("div", { class: "msg" });
  const list = el("div", { class: "rlist", tabindex: "0", role: "list", "aria-label": "Plugins" });
  const spacer = el("div", { class: "spacer" }), rowsEl = el("div", { class: "rows" });
  spacer.append(rowsEl); list.append(spacer);
  app.append(el("div", { class: "top" }, el("label", { class: "for" }, "Plugins for"), aiSel),
    el("div", { class: "find" }, el("div", { class: "box" }, icon("search"), input)), msg, list);

  let typing = null;
  input.addEventListener("input", () => { S.q = input.value; keep(); clearTimeout(typing); typing = setTimeout(() => { list.scrollTop = 0; build(); }, 60); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); list.focus(); }
    if (e.key === "Escape" && input.value) { input.value = ""; S.q = ""; keep(); build(); }
  });

  // ---------- the rows ----------
  // Heights in px at font scale 1 (rows are drawn only where you look, so every row's height is known). A plugin has three
  // lines, like VS Code's Extensions: its name and version; what it does; where it is installed and its buttons (Adithya,
  // 27 Oct 2026: with two, "This project, only me" was cut off and the buttons squeezed the description).
  const H = { head: 24, plugin: 66, slim: 46, market: 26, hint: 40, action: 36 };
  // A plugin you can add has no third line: its Install is a hover icon at the end of the name's line (Adithya, 27 Oct 2026).
  const slim = (p) => !p.installed && !(p.marketplace && marketName(p.marketplace));
  const hOf = (r) => H[r.type === "plugin" && slim(r.p) ? "slim" : r.type];
  const fs = () => Number(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 1;
  let rows = [], tops = [], total = 0;

  const words = () => S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (p) => `${p.name} ${p.description} ${p.marketplace} ${p.author}`.toLowerCase();
  // Best first: the name itself, a name that starts with it, a name that has it, then the rest (each by name).
  function ranked(items, w) {
    if (!w.length) return items;
    const q = w.join(" ");
    const rank = (p) => { const n = p.name.toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; };
    return items.filter((p) => { const h = hay(p); return w.every((x) => h.includes(x)); })
      .map((p) => ({ p, r: rank(p) })).sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name)).map((x) => x.p);
  }
  function section(key, title, count, sub) {
    rows.push({ type: "head", key, title, count, sub });
    return !S.closed.has(key);
  }
  function build() {
    rows = [];
    const st = S.st;
    if (st && st.ai && !st.notSetUp) {
      const w = words(), can = st.can || {};
      const installed = ranked(st.installed, w);
      if (section("installed", "Installed", installed.length)) {
        for (const p of installed) rows.push({ type: "plugin", p });
        if (!installed.length) rows.push({ type: "hint", text: w.length ? "No installed plugin matches." : st.loading ? "Reading…" : "No plugins yet." });
      }
      if (can.available) {
        const av = S.available[st.ai], items = av && av.version === st.version ? av.items : [];
        const found = ranked(items, w);
        const sub = st.ai === "claude" ? "Anthropic's directory and your marketplaces" : "From your marketplaces";
        if (section("available", "Available", found.length, sub)) {
          for (const p of found) rows.push({ type: "plugin", p });
          if (!found.length) rows.push({ type: "hint", text: st.loading && !items.length ? "Reading…" : w.length ? "Nothing matches. Try other words, or add a marketplace below."
            : st.ai === "codex" ? "Add a marketplace below to find plugins, for example obra/superpowers-marketplace." : "Nothing to add." });
        }
      }
      if (can.folder || can.git) {
        if (section("add", "Add a plugin", 0)) {
          rows.push({ type: "action", buttons: [can.folder && { label: "From a Folder…", icon: "folder-opened", m: { type: "addFolder" } }, can.git && { label: "From a Git Address…", icon: "repo-clone", m: { type: "addGit" } }].filter(Boolean), busy: st.busy.add });
          rows.push({ type: "hint", text: "Gemini has no plugin catalog: add one from a folder or a Git address. Antigravity checks it first." });
        }
      }
      if (can.marketplaces) {
        if (section("markets", "Marketplaces", st.marketplaces.length)) {
          for (const m of st.marketplaces) rows.push({ type: "market", m });
          rows.push({ type: "action", buttons: [{ label: "Add a Marketplace…", icon: "add", m: { type: "addMarket" } }], busy: st.busy["market:+"] });
        }
      }
    }
    tops = []; total = 0;
    const k = fs();
    for (const r of rows) { tops.push(total); total += Math.round(hOf(r) * k); }
    spacer.style.height = total + "px";
    renderMsg();
    draw();
  }

  function renderMsg() {
    const st = S.st;
    const parts = [];
    if (!st) { msg.replaceChildren(); return; }
    if (st.loading) parts.push(el("div", { class: "bar" }));
    if (!st.ai) parts.push(el("div", { class: "note" }, "Models on this computer don't use plugins. Pick an AI above to see its plugins."));
    else if (st.notSetUp) parts.push(el("div", { class: "note" }, `${st.names[st.ai]} isn't set up in Kural yet. `, el("a", { onclick: () => post({ type: "setUp" }) }, "Set it up")));
    else {
      if (st.error) parts.push(el("div", { class: "err" }, st.error));
      if (st.fullSetupOff) parts.push(el("div", { class: "note" }, "Kural starts Claude without your Claude Code setup, so its chats don't use plugins. ",
        el("a", { onclick: () => post({ type: "fullSetup" }) }, "Use my setup")));
    }
    msg.replaceChildren(...parts);
    msg.classList.toggle("empty", !parts.length);
  }

  const busyOf = (p) => S.st && S.st.busy[p.key];
  const btn = (label, m, cls, title) => el("button", { class: `pbtn ${cls || ""}`, title: title || label, onclick: (e) => { e.stopPropagation(); post(m); } }, label);
  function actions(p) {
    const st = S.st, can = st.can || {}, busy = busyOf(p);
    if (busy) return [el("span", { class: "busy" }, busy)];
    if (!p.installed) return p.installable ? [el("button", { class: "icon-btn install", title: `Install ${p.name} for ${st.names[st.ai]}`, "aria-label": `Install ${p.name}`,
      onclick: (e) => { e.stopPropagation(); post({ type: "install", id: p.key }); } }, icon("cloud-download"))] : [];
    if (p.readOnly) return [];
    return [can.toggle && btn(p.enabled ? "Turn Off" : "Turn On", { type: p.enabled ? "disable" : "enable", id: p.key }),
      el("button", { class: "icon-btn", title: `Remove ${p.name}`, "aria-label": `Remove ${p.name}`, onclick: (e) => { e.stopPropagation(); post({ type: "uninstall", id: p.key }); } }, icon("trash"))].filter(Boolean);
  }
  // Claude: a plugin installed only for the open project says so on its row ("All my projects" is the usual: no tag).
  function whereTag(p) {
    if (!p.installed) return null;
    if (p.readOnly) return el("span", { class: "tag", title: "Set up for you by your organisation" }, "Organisation");
    const proj = S.st && S.st.project ? ` (${S.st.project})` : "";
    if (p.scope === "project") return el("span", { class: "tag", title: `Installed for this project${proj}, for everyone who works on it (.claude/settings.json)` }, "This project");
    if (p.scope === "local") return el("span", { class: "tag", title: `Installed for this project${proj}, only for you (.claude/settings.local.json)` }, "This project, only me");
    return null;
  }
  // Where a plugin comes from, on its row: only one of your own marketplaces (nearly all of Claude's come from Anthropic's
  // directory: saying so on every row was noise). The plugin's page always says.
  const marketName = (name) => { const m = S.st && S.st.marketplaces.find((x) => x.name === name); return m && m.removable ? m.label : ""; };
  function rowEl(r, i) {
    const top = tops[i], h = Math.round(hOf(r) * fs());
    let n;
    if (r.type === "head") {
      const open = !S.closed.has(r.key);
      // (What a section holds, "Anthropic's directory and your marketplaces", is its tooltip: on the row it was cut off.)
      n = el("div", { class: "row head", role: "button", "aria-expanded": String(open), title: r.sub || null, onclick: () => { if (open) S.closed.add(r.key); else S.closed.delete(r.key); keep(); build(); } },
        icon(open ? "chevron-down" : "chevron-right"), el("span", { class: "htitle" }, r.title),
        el("span", { class: "grow" }), r.key !== "add" && el("span", { class: "badge" }, String(r.count)));
    } else if (r.type === "plugin") {
      const p = r.p, off = p.installed && !p.enabled;
      const from = p.marketplace ? marketName(p.marketplace) : "";
      n = el("div", { class: `row plugin${S.sel === p.key ? " sel" : ""}${off ? " off" : ""}`, role: "listitem", title: p.description || p.name,
        onclick: () => { S.sel = p.key; keep(); draw(); post({ type: "details", id: p.key }); } },
        el("div", { class: "pmain" },
          el("div", { class: "ptop" }, el("span", { class: "pname" }, p.name), p.version && el("span", { class: "pver" }, p.version), off && el("span", { class: "tag" }, "Off"),
            slim(p) && el("span", { class: "pacts" }, actions(p))),
          el("div", { class: "pdesc" }, p.description || "No description."),
          !slim(p) && el("div", { class: "pline" }, el("span", { class: "pmeta" }, whereTag(p), from && el("span", { class: "pfrom" }, from)), el("span", { class: "pacts" }, actions(p)))));
    } else if (r.type === "market") {
      const m = r.m, busy = S.st.busy[`market:${m.name}`];
      n = el("div", { class: "row market", title: m.source },
        icon(m.removable ? "repo" : "verified"), el("span", { class: "mname" }, m.label), el("span", { class: "msrc" }, m.removable ? m.source : "built in"), el("span", { class: "grow" }),
        busy ? el("span", { class: "busy" }, busy) : m.removable && el("button", { class: "icon-btn", title: `Remove ${m.name}`, "aria-label": `Remove ${m.name}`, onclick: () => post({ type: "removeMarket", name: m.name }) }, icon("trash")));
    } else if (r.type === "action") {
      n = el("div", { class: "row action" }, r.busy ? el("span", { class: "busy" }, r.busy)
        : r.buttons.map((b) => el("button", { class: "pbtn wide", onclick: () => post(b.m) }, icon(b.icon), b.label)));
    } else n = el("div", { class: "row hint" }, r.text);
    n.style.top = top + "px"; n.style.height = h + "px";
    return n;
  }
  // Only the rows on screen (and a few around them).
  function draw() {
    const from = list.scrollTop, to = from + list.clientHeight;
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] + Math.round(hOf(rows[mid]) * fs()) <= from) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = Math.max(0, lo - 5); i < rows.length && tops[i] < to + 200; i++) out.push(rowEl(rows[i], i));
    rowsEl.replaceChildren(...out);
  }
  let drawing = false;
  list.addEventListener("scroll", () => { if (drawing) return; drawing = true; requestAnimationFrame(() => { drawing = false; draw(); }); });
  new ResizeObserver(() => draw()).observe(list);

  // Up / Down move between plugins; Enter opens one's page.
  function move(d) {
    const ps = rows.map((r, i) => r.type === "plugin" ? i : -1).filter((i) => i >= 0);
    if (!ps.length) return;
    const at = ps.findIndex((i) => rows[i].p.key === S.sel);
    const next = ps[Math.max(0, Math.min(ps.length - 1, at < 0 ? 0 : at + d))];
    S.sel = rows[next].p.key; keep();
    const top = tops[next], h = Math.round(hOf(rows[next]) * fs());
    if (top < list.scrollTop) list.scrollTop = top; else if (top + h > list.scrollTop + list.clientHeight) list.scrollTop = top + h - list.clientHeight;
    draw();
  }
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Enter" && S.sel) post({ type: "details", id: S.sel });
    else if (e.key === "Delete" && S.sel) { const r = rows.find((x) => x.type === "plugin" && x.p.key === S.sel); if (r && r.p.installed && !r.p.readOnly) post({ type: "uninstall", id: S.sel }); }
  });

  function renderTop() {
    const st = S.st;
    const opts = [];
    if (!st.ai) opts.push(el("option", { value: "", disabled: true, selected: true }, "Choose an AI"));
    for (const a of st.ais) opts.push(el("option", { value: a.id, selected: a.id === st.ai }, a.id === st.chatAI ? `${a.name} (this chat)` : a.name));
    aiSel.replaceChildren(...opts);
    input.placeholder = !st.ai || st.notSetUp ? "Search plugins" : st.ai === "agy" ? "Search Gemini's plugins" : `Search ${st.ai === "claude" ? "Claude" : "ChatGPT"} plugins`;
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    switch (m.type) {
      case "state": S.st = m; renderTop(); build(); break;
      case "available": S.available[m.ai] = { version: m.version, items: m.items }; build(); break;
      case "fontScale": setFs(m.value); build(); break;
    }
  });
  post({ type: "ready" });
})();
