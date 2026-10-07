// "Search & Ask" side bar page: two tabs. Talks to lib/search/index.js.
//   Search: find and replace in the project, like VS Code's own Search view (which Kural hides): Match Case, Whole
//           Word, Regular Expression, Preserve Case, files to include/exclude, open editors only, exclude settings and
//           ignore files, search as you type, history (Up/Down), results as a list or a tree, replace one / a file /
//           all, Replace Preview, dismiss, keyboard, right-click Copy, F4 for the next result.
//   Ask:    ask where something is in your own words; Kural's model lists the exact places.
(function () {
  const vscode = acquireVsCodeApi();
  const R = window.KuralReplace;   // (media/search-replace.js: the same replace rules as the extension)
  const app = document.getElementById("app");
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);
  const isMac = navigator.platform.toUpperCase().includes("MAC");

  const saved = vscode.getState() || {};
  const F0 = { pattern: "", replace: "", isRegex: false, matchCase: false, wholeWord: false, preserveCase: false, include: "", exclude: "",
    onlyOpen: false, useIgnore: true, showReplace: false, showDetails: false };
  const S = {
    tab: saved.tab || "text",
    // Ask
    q: saved.q || "", running: null, result: saved.q && saved.result && saved.result.kind === "ask" ? saved.result : null, collapsed: new Set(), progress: [], model: "sonnet",
    // Search
    f: { ...F0, ...(saved.f || {}) }, tree: saved.tree, cfg: { onType: true, debounce: 300, collapse: "auto", viewMode: "list", lineNumbers: false, folders: 1, history: {} },
    files: new Map(),     // path -> { path, label, matches }
    searching: null,      // the running search's number
    done: null,           // { total, files, limited, error, ms } of the last search
    open: new Set(), closed: new Set(),   // folders/files you opened or closed yourself
    sel: null,            // the selected row's key
    hist: { find: -1, replace: -1 },
  };
  const keep = () => vscode.setState({ tab: S.tab, q: S.q, result: S.result, f: S.f, tree: S.tree });

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
  const base = (p) => p.split("/").pop();
  const dir = (p) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : ""; };
  // Icons: Codicons (VS Code's icon set, media/codicons). Never emoji.
  const icon = (name) => el("i", { class: `codicon codicon-${name}`, "aria-hidden": "true" });
  const keyName = (k) => isMac ? k.replace("Ctrl+", "⌘").replace("Alt+", "⌥").replace("Shift+", "⇧") : k;

  // ---------- tabs ----------
  const tabText = el("button", { class: "tabbtn", onclick: () => setTab("text") }, icon("search"), " Search");
  const tabAsk = el("button", { class: "tabbtn", onclick: () => setTab("ask") }, icon("sparkle"), " Ask");
  const textPane = el("div", { class: "pane" });
  const askPane = el("div", { class: "pane" });
  app.append(el("div", { class: "tabs", role: "tablist" }, tabText, tabAsk), textPane, askPane);
  function setTab(t) {
    S.tab = t; keep();
    tabText.classList.toggle("on", t === "text"); tabAsk.classList.toggle("on", t === "ask");
    textPane.classList.toggle("hidden", t !== "text"); askPane.classList.toggle("hidden", t !== "ask");
    (t === "text" ? findIn : input).focus();
    ui();
  }

  // ==================================================================================================
  // Search
  // ==================================================================================================
  const toggle = (name, iconName, title, onChange) => {
    const b = el("button", { class: "opt", title, "aria-pressed": "false", onclick: () => { S.f[name] = !S.f[name]; onChange ? onChange() : changed(true); } }, icon(iconName));
    b.dataset.opt = name;
    return b;
  };
  const findIn = el("textarea", { class: "q", rows: 1, spellcheck: "false", placeholder: "Search", "aria-label": "Search" });
  const replaceIn = el("textarea", { class: "q", rows: 1, spellcheck: "false", placeholder: "Replace", "aria-label": "Replace" });
  const includeIn = el("input", { class: "q", spellcheck: "false", placeholder: "e.g. *.ts, src/**/include", "aria-label": "Files to include" });
  const excludeIn = el("input", { class: "q", spellcheck: "false", placeholder: "e.g. *.ts, src/**/exclude", "aria-label": "Files to exclude" });
  const optCase = toggle("matchCase", "case-sensitive", `Match Case (${keyName("Alt+C")})`);
  const optWord = toggle("wholeWord", "whole-word", `Match Whole Word (${keyName("Alt+W")})`);
  const optRegex = toggle("isRegex", "regex", `Use Regular Expression (${keyName("Alt+R")})`);
  const optPreserve = toggle("preserveCase", "preserve-case", `Preserve Case (${keyName("Alt+P")})`, () => { renderRows(); post({ type: "replaceText", replace: S.f.replace }); renderFind(); });
  const optOpen = toggle("onlyOpen", "book", "Search only in Open Editors");
  const optIgnore = toggle("useIgnore", "exclude", "Use Exclude Settings and Ignore Files");
  const replaceAllBtn = el("button", { class: "opt big", title: `Replace All (${keyName("Ctrl+Alt+Enter")})`, onclick: () => replaceAll() }, icon("replace-all"));
  const replaceToggle = el("button", { class: "twist", title: "Toggle Replace", onclick: () => { S.f.showReplace = !S.f.showReplace; keep(); renderFind(); renderRows(); if (S.f.showReplace) replaceIn.focus(); } });
  const detailsBtn = el("button", { class: "opt dots", title: "Toggle Search Details", onclick: () => { S.f.showDetails = !S.f.showDetails; keep(); renderFind(); if (S.f.showDetails) includeIn.focus(); } }, icon("ellipsis"));
  const replaceRow = el("div", { class: "box" }, replaceIn, el("div", { class: "opts" }, optPreserve), replaceAllBtn);
  const details = el("div", { class: "details" },
    el("label", { class: "lbl" }, "files to include"), el("div", { class: "box" }, includeIn, el("div", { class: "opts" }, optOpen)),
    el("label", { class: "lbl" }, "files to exclude"), el("div", { class: "box" }, excludeIn, el("div", { class: "opts" }, optIgnore)));
  const msg = el("div", { class: "msg" });
  const results = el("div", { class: "rlist", tabindex: "0", role: "tree", "aria-label": "Search results" });
  const spacer = el("div", { class: "spacer" });
  const rowsEl = el("div", { class: "rows" });
  spacer.append(rowsEl); results.append(spacer);
  textPane.append(
    el("div", { class: "find" }, replaceToggle, el("div", { class: "fields" },
      el("div", { class: "box" }, findIn, el("div", { class: "opts" }, optCase, optWord, optRegex)), replaceRow)),
    el("div", { class: "detbar" }, detailsBtn), details, msg, results);

  function grow(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }
  function renderFind() {
    replaceToggle.replaceChildren(icon(S.f.showReplace ? "chevron-down" : "chevron-right"));
    replaceRow.classList.toggle("hidden", !S.f.showReplace);
    details.classList.toggle("hidden", !S.f.showDetails);
    detailsBtn.classList.toggle("on", S.f.showDetails && !!(S.f.include || S.f.exclude || S.f.onlyOpen || !S.f.useIgnore));
    for (const b of [optCase, optWord, optRegex, optPreserve, optOpen, optIgnore]) {
      const on = !!S.f[b.dataset.opt];
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    }
    replaceAllBtn.disabled = !count().total;
  }

  // ---------- running a search ----------
  let seq = 0, typeTimer = null;
  const query = () => ({ pattern: S.f.pattern, isRegex: S.f.isRegex, matchCase: S.f.matchCase, wholeWord: S.f.wholeWord, preserveCase: S.f.preserveCase,
    include: S.f.include, exclude: S.f.exclude, onlyOpen: S.f.onlyOpen, useIgnore: S.f.useIgnore });
  // Something in the search changed: search now (a toggle, Enter) or after a pause (typing, VS Code's search.searchOnType).
  function changed(now) {
    keep(); renderFind();
    clearTimeout(typeTimer);
    if (now) find(); else if (S.cfg.onType) typeTimer = setTimeout(find, S.cfg.debounce);
  }
  function find(keepView) {
    clearTimeout(typeTimer);
    const id = ++seq;
    if (!S.f.pattern) { S.searching = null; S.done = null; S.files.clear(); post({ type: "clearFind" }); renderAll(); return; }
    S.searching = id; S.pending = new Map();
    if (!keepView) { S.open.clear(); S.closed.clear(); S.sel = null; results.scrollTop = 0; }
    post({ type: "find", q: query(), id });
    renderMsg();
  }

  function addFile(f) {
    let k = 0;
    for (const m of f.matches) m.k = `${f.path}\u0000${k++}`;
    S.files.set(f.path, f);
  }

  // ---------- rows: a flat list of what's showing (folders, files, matches), drawn only where you look ----------
  let rows = [];
  const fileTotal = (f) => f.matches.length;
  function count() { let total = 0; for (const f of S.files.values()) total += fileTotal(f); return { total, files: S.files.size }; }
  function collapsedByDefault(n) { return S.cfg.collapse === "alwaysCollapse" || (S.cfg.collapse === "auto" && n > 10); }
  function isClosed(key, n) { return S.closed.has(key) ? true : S.open.has(key) ? false : collapsedByDefault(n); }
  const treeMode = () => S.tree === undefined ? S.cfg.viewMode === "tree" : !!S.tree;

  function buildRows() {
    rows = [];
    const files = [...S.files.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const pushFile = (f, depth) => {
      const key = `f:${f.path}`, closed = isClosed(key, fileTotal(f));
      rows.push({ kind: "file", key, f, depth, closed });
      if (!closed) for (const m of f.matches) rows.push({ kind: "match", key: m.k, f, m, depth: depth + 1 });
    };
    if (!treeMode()) { for (const f of files) pushFile(f, 0); return; }
    // Tree: folders, single-child chains shown as one ("src/lib/search"), like VS Code's compact folders.
    const root = { dirs: new Map(), files: [], name: "", full: "" };
    for (const f of files) {
      let node = root;
      for (const part of f.label.split("/").slice(0, -1)) {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [], name: part, full: node.full ? `${node.full}/${part}` : part });
        node = node.dirs.get(part);
      }
      node.files.push(f);
    }
    const totalIn = (n) => n.files.reduce((s, f) => s + fileTotal(f), 0) + [...n.dirs.values()].reduce((s, d) => s + totalIn(d), 0);
    const walk = (node, depth) => {
      for (const d0 of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        let d = d0, name = d0.name;
        while (!d.files.length && d.dirs.size === 1) { d = [...d.dirs.values()][0]; name += `/${d.name}`; }
        const key = `d:${d.full}`, closed = S.closed.has(key);
        rows.push({ kind: "dir", key, name, full: d.full, depth, closed, n: totalIn(d), node: d });
        if (!closed) walk(d, depth + 1);
      }
      for (const f of node.files) pushFile(f, depth);
    };
    walk(root, 0);
  }

  let H = 22;   // one row's height (measured once the page has its font size)
  function measure() {
    const probe = el("div", { class: "row" }, "x");
    rowsEl.append(probe); H = probe.offsetHeight || 22; probe.remove();
  }

  function renderRows() {
    buildRows();
    if (S.sel && !rows.some((r) => r.key === S.sel)) S.sel = null;
    spacer.style.height = rows.length * H + "px";
    const first = Math.max(0, Math.floor(results.scrollTop / H) - 8);
    const last = Math.min(rows.length, first + Math.ceil((results.clientHeight || 600) / H) + 16);
    rowsEl.style.transform = `translateY(${first * H}px)`;
    rowsEl.replaceChildren(...rows.slice(first, last).map(rowEl));
  }
  results.addEventListener("scroll", () => requestAnimationFrame(renderRows));
  new ResizeObserver(() => renderRows()).observe(results);

  const act = (name, title, f) => el("button", { class: "act", title, onclick: (e) => { e.stopPropagation(); f(); } }, icon(name));
  const ctx = (o) => JSON.stringify({ preventDefaultContextMenuItems: true, ...o });

  function rowEl(r) {
    const pad = 6 + r.depth * 12;
    const sel = r.key === S.sel ? " sel" : "";
    if (r.kind === "dir") {
      return el("div", { class: "row dir" + sel, style: `padding-left:${pad}px`, role: "treeitem", "aria-expanded": String(!r.closed), onclick: () => { select(r.key); toggleOpen(r); },
        "data-vscode-context": ctx({ webviewSection: "dir", row: "dir", label: r.full }) },
        el("span", { class: "twisty" }, icon(r.closed ? "chevron-right" : "chevron-down")), icon("folder"), el("span", { class: "fname" }, r.name),
        el("span", { class: "grow" }), el("span", { class: "acts" }, act("close", "Dismiss", () => dismiss(r))), el("span", { class: "badge" }, r.n));
    }
    if (r.kind === "file") {
      const f = r.f;
      return el("div", { class: "row file" + sel, style: `padding-left:${pad}px`, role: "treeitem", "aria-expanded": String(!r.closed), title: f.label, onclick: () => { select(r.key); toggleOpen(r); },
        "data-vscode-context": ctx({ webviewSection: "file", row: "file", path: f.path, label: f.label }) },
        el("span", { class: "twisty" }, icon(r.closed ? "chevron-right" : "chevron-down")), icon("file"),
        el("span", { class: "fname" }, base(f.label)), treeMode() ? null : el("span", { class: "fdir" }, dir(f.label)), el("span", { class: "grow" }),
        el("span", { class: "acts" }, S.f.showReplace ? act("replace-all", "Replace All in this file", () => replaceItems([f], false)) : null, act("close", "Dismiss", () => dismiss(r))),
        el("span", { class: "badge" }, f.matches.length));
    }
    const m = r.m, t = m.text;
    // Show the match with some text around it (a long line: from a little before the match).
    const indent = Math.min(m.col, t.length - t.trimStart().length);
    const start = m.col - indent > 40 ? m.col - 26 : indent;
    const end = m.endLine > m.line ? t.length : m.endCol;
    const before = t.slice(start, m.col), hit = t.slice(m.col, end), after = t.slice(end, end + 200);
    const shown = S.f.showReplace
      ? [el("del", {}, hit), el("ins", {}, R.previewOf(m.match, query(), S.f.replace).replace(/\n/g, "⏎"))]
      : [el("mark", {}, hit)];
    return el("div", { class: "row match" + sel, style: `padding-left:${pad + 18}px`, role: "treeitem", title: `${r.f.label}:${m.line}`,
      onclick: () => { select(r.key); openMatch(r, true); }, ondblclick: () => openMatch(r, false),
      "data-vscode-context": ctx({ webviewSection: "match", row: "match", path: r.f.path, label: r.f.label, text: t.trim(), line: m.line }) },
      S.cfg.lineNumbers ? el("span", { class: "ln" }, m.line) : null,
      el("span", { class: "txt" }, start > indent ? "…" : "", before, shown, after),
      el("span", { class: "acts" }, S.f.showReplace ? act("replace", `Replace (${keyName("Ctrl+Shift+1")})`, () => replaceItems([{ ...r.f, matches: [m] }], false)) : null,
        act("close", "Dismiss", () => dismiss(r))));
  }

  function toggleOpen(r) {
    const closed = r.kind === "dir" ? S.closed.has(r.key) : isClosed(r.key, fileTotal(r.f));
    if (closed) { S.closed.delete(r.key); S.open.add(r.key); } else { S.open.delete(r.key); S.closed.add(r.key); }
    renderRows(); ui();
  }
  function select(key) { S.sel = key; renderRows(); }
  function openMatch(r, keepFocus) {
    const m = r.m;
    // With Replace open, a click shows the Replace Preview (the file with your replacements beside it), like VS Code.
    if (S.f.showReplace) post({ type: "preview", file: { path: r.f.path, matches: r.f.matches.map(strip) }, match: strip(m), replace: S.f.replace });
    else post({ type: "open", path: r.f.path, line: m.line, col: m.col, endLine: m.endLine, endCol: m.endCol, preview: keepFocus, keepFocus });
  }
  const strip = (m) => ({ line: m.line, col: m.col, match: m.match });

  function dismiss(r) {
    if (r.kind === "match") {
      r.f.matches = r.f.matches.filter((x) => x !== r.m);
      if (!r.f.matches.length) S.files.delete(r.f.path);
    } else if (r.kind === "file") S.files.delete(r.f.path);
    else for (const f of [...S.files.values()]) if (f.label === r.full || f.label.startsWith(r.full + "/")) S.files.delete(f.path);
    const i = rows.findIndex((x) => x.key === r.key);
    renderRows();
    if (i >= 0 && rows.length) S.sel = rows[Math.min(i, rows.length - 1)].key;
    renderAll();
  }

  // ---------- replacing ----------
  function replaceItems(files, confirm) {
    const items = files.map((f) => ({ path: f.path, matches: f.matches.map(strip) })).filter((f) => f.matches.length);
    if (items.length) post({ type: "replace", items, replace: S.f.replace, confirm });
  }
  function replaceAll() { if (count().total) replaceItems([...S.files.values()], true); }

  // ---------- the message line ----------
  function renderMsg() {
    msg.replaceChildren();
    const link = (text, f) => el("a", { onclick: f }, text);
    if (S.searching) { msg.append(el("div", { class: "bar" }), el("span", { class: "muted" }, "Searching…")); return; }
    const d = S.done;
    if (!d) return;
    if (d.error) { msg.append(el("span", { class: "err" }, d.error)); return; }
    const { total, files } = count();
    if (!total) {
      if (d.total) msg.append(el("span", { class: "muted" }, "All results dismissed."));
      else msg.append(el("span", {}, "No results found. Review your exclude settings and check your ignore files. "), link("Open Settings", () => post({ type: "settings" })));
      return;
    }
    msg.append(el("span", {}, `${total} ${total === 1 ? "result" : "results"} in ${files} ${files === 1 ? "file" : "files"}`),
      el("span", { class: "muted" }, " · "), link("Open in editor", () => post({ type: "searchEditor", q: query() })));
    if (d.limited) msg.append(el("div", { class: "warn" }, "Only some of the matches are shown. Be more specific to narrow down the results."));
  }

  function renderAll() { renderFind(); renderMsg(); renderRows(); ui(); }

  // What the view's title bar shows (refresh, clear, collapse/expand, tree/list) and the number on the icon.
  function ui() {
    const fileKeys = [...S.files.values()].map((f) => [`f:${f.path}`, fileTotal(f)]);
    const allClosed = fileKeys.length > 0 && fileKeys.every(([k, n]) => isClosed(k, n));
    post({ type: "ui", tab: S.tab, results: count().total, tree: treeMode(), collapsed: allClosed });
  }

  // ---------- keys ----------
  function history(kind, input, dir) {
    const list = (S.cfg.history[kind] || []);
    if (!list.length) return false;
    let i = S.hist[kind] + dir;
    if (i < -1) i = -1;
    if (i >= list.length) i = list.length - 1;
    S.hist[kind] = i;
    input.value = i < 0 ? "" : list[i];
    input.dispatchEvent(new Event("input"));
    return true;
  }
  function remember(kind, text) {
    if (!text) return;
    const list = (S.cfg.history[kind] || []).filter((x) => x !== text);
    list.unshift(text);
    S.cfg.history[kind] = list.slice(0, 50);
    S.hist[kind] = -1;
    post({ type: "history", history: S.cfg.history });
  }
  function optionKeys(e) {
    // Alt+C / W / R / P (VS Code's keys; on a Mac also ⌘⌥): case, word, regex, preserve case.
    if (!(e.altKey && !e.shiftKey && (!e.ctrlKey || isMac))) return false;
    const map = { KeyC: "matchCase", KeyW: "wholeWord", KeyR: "isRegex", KeyP: "preserveCase" };
    const name = map[e.code];
    if (!name) return false;
    e.preventDefault();
    S.f[name] = !S.f[name];
    if (name === "preserveCase") { renderRows(); renderFind(); keep(); } else changed(true);
    return true;
  }
  function inputKeys(kind, t) {
    t.addEventListener("keydown", (e) => {
      if (optionKeys(e)) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === "Enter" && mod && e.altKey) { e.preventDefault(); replaceAll(); return; }
      // Ctrl+Enter: a new line in the search (searches across lines), like VS Code.
      if (e.key === "Enter" && mod && t.tagName === "TEXTAREA") { e.preventDefault(); document.execCommand("insertText", false, "\n"); return; }
      if (e.key === "Enter") { e.preventDefault(); remember(kind === "include" || kind === "exclude" ? "find" : kind, kind === "replace" ? S.f.replace : S.f.pattern); find(); return; }
      if (e.key === "Escape") { if (S.searching) post({ type: "stopFind" }); return; }
      if ((kind === "find" || kind === "replace") && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const before = t.value.slice(0, t.selectionStart), afterT = t.value.slice(t.selectionEnd);
        if (e.key === "ArrowUp" && !before.includes("\n") && history(kind, t, 1)) e.preventDefault();
        else if (e.key === "ArrowDown" && !afterT.includes("\n") && history(kind, t, -1)) e.preventDefault();
      }
    });
  }
  inputKeys("find", findIn); inputKeys("replace", replaceIn); inputKeys("include", includeIn); inputKeys("exclude", excludeIn);
  // (An emptied box clears the results at once, also with search-as-you-type off: no results under an empty box.)
  findIn.addEventListener("input", () => { grow(findIn); S.f.pattern = findIn.value; changed(!S.f.pattern); });
  replaceIn.addEventListener("input", () => { grow(replaceIn); S.f.replace = replaceIn.value; keep(); renderRows(); post({ type: "replaceText", replace: S.f.replace }); });
  includeIn.addEventListener("input", () => { S.f.include = includeIn.value; changed(false); });
  excludeIn.addEventListener("input", () => { S.f.exclude = excludeIn.value; changed(false); });
  textPane.addEventListener("keydown", (e) => { if (e.target === results) return; optionKeys(e); });

  // The results: arrows move, Right/Left open/close, Enter opens, Space opens keeping the focus here, Delete dismisses.
  results.addEventListener("keydown", (e) => {
    if (optionKeys(e)) return;
    const i = Math.max(0, rows.findIndex((r) => r.key === S.sel));
    const r = rows[i];
    const to = (j) => { if (!rows.length) return; j = Math.max(0, Math.min(rows.length - 1, j)); S.sel = rows[j].key; reveal(j); renderRows(); };
    if (e.key === "ArrowDown") { e.preventDefault(); to(S.sel ? i + 1 : 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); to(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); to(0); }
    else if (e.key === "End") { e.preventDefault(); to(rows.length - 1); }
    else if (e.key === "PageDown") { e.preventDefault(); to(i + Math.floor(results.clientHeight / H)); }
    else if (e.key === "PageUp") { e.preventDefault(); to(i - Math.floor(results.clientHeight / H)); }
    else if (!r) return;
    else if (e.key === "ArrowRight") { e.preventDefault(); if (r.kind !== "match" && r.closed) toggleOpen(r); else to(i + 1); }
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (r.kind !== "match" && !r.closed) toggleOpen(r);
      else { for (let j = i - 1; j >= 0; j--) if (rows[j].depth < r.depth) { to(j); break; } }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (r.kind === "match") openMatch(r, e.key === " "); else toggleOpen(r);
    } else if (e.key === "Delete" || (isMac && e.key === "Backspace" && e.metaKey)) { e.preventDefault(); dismiss(r); }
    else if (e.key === "1" && e.shiftKey && (isMac ? e.metaKey : e.ctrlKey) && S.f.showReplace && r.kind !== "dir") {
      e.preventDefault(); replaceItems([r.kind === "match" ? { ...r.f, matches: [r.m] } : r.f], false);
    }
  });
  function reveal(j) {
    const top = j * H;
    if (top < results.scrollTop) results.scrollTop = top;
    else if (top + H > results.scrollTop + results.clientHeight) results.scrollTop = top + H - results.clientHeight;
  }
  // F4 / Shift+F4 from anywhere: the next / previous match, opened in the editor.
  function step(dirn) {
    const idx = rows.map((r, j) => [r, j]).filter(([r]) => r.kind === "match");
    if (!idx.length) {
      // (all collapsed: open them so there's a next one)
      for (const f of S.files.values()) { S.closed.delete(`f:${f.path}`); S.open.add(`f:${f.path}`); }
      renderRows();
      if (!rows.some((r) => r.kind === "match")) return;
      return step(dirn);
    }
    const cur = rows.findIndex((r) => r.key === S.sel);
    let pick = dirn > 0 ? idx.find(([, j]) => j > cur) : [...idx].reverse().find(([, j]) => j < cur);
    if (!pick) pick = dirn > 0 ? idx[0] : idx[idx.length - 1];
    S.sel = pick[0].key; reveal(pick[1]); renderRows();
    openMatch(pick[0], true);
  }

  // ---------- the title bar's buttons, and the right-click menu ----------
  function cmd(m) {
    switch (m.what) {
      case "refresh": find(true); break;
      case "clear":
        S.f.pattern = ""; S.f.replace = ""; findIn.value = ""; replaceIn.value = ""; grow(findIn); grow(replaceIn);
        S.files.clear(); S.done = null; S.searching = null; post({ type: "clearFind" }); keep(); renderAll(); findIn.focus(); break;
      case "collapseAll": for (const r of rows) if (r.kind !== "match") { S.open.delete(r.key); S.closed.add(r.key); } for (const f of S.files.values()) { S.open.delete(`f:${f.path}`); S.closed.add(`f:${f.path}`); } renderRows(); ui(); break;
      case "expandAll": S.closed.clear(); for (const f of S.files.values()) S.open.add(`f:${f.path}`); renderRows(); ui(); break;
      case "tree": S.tree = true; keep(); renderRows(); ui(); break;
      case "list": S.tree = false; keep(); renderRows(); ui(); break;
      case "openEditor": post({ type: "searchEditor", q: query() }); break;
      case "next": step(1); break;
      case "prev": step(-1); break;
      case "copyAll": {
        const out = [];
        for (const f of [...S.files.values()].sort((a, b) => a.label.localeCompare(b.label))) {
          out.push(f.label);
          for (const x of f.matches) out.push(`  ${x.line},${x.col + 1}: ${x.text.trim()}`);
          out.push("");
        }
        post({ type: "copy", text: out.join("\n") });
        break;
      }
      case "dismiss": {
        const r = rows.find((x) => (m.row.row === "match" ? x.kind === "match" && x.f.path === m.row.path && x.m.line === m.row.line : x.kind === m.row.row && (x.kind === "dir" ? x.full === m.row.label : x.f.path === m.row.path)));
        if (r) dismiss(r);
        break;
      }
    }
  }

  // ==================================================================================================
  // Ask (unchanged in what it does)
  // ==================================================================================================
  const input = el("textarea", { class: "q", rows: 1, spellcheck: "false" });
  const goBtn = el("button", { class: "go", onclick: () => (S.running ? post({ type: "cancel" }) : run()) });
  const status = el("div", { class: "status" });
  const askResults = el("div", { class: "results" });
  askPane.append(el("div", { class: "top" }, el("div", { class: "box" }, input, goBtn)), status, askResults);

  function renderTop() {
    input.placeholder = "Ask where something is…  e.g. where are the user's settings saved?";
    goBtn.replaceChildren(icon(S.running ? "debug-stop" : "arrow-up"));
    goBtn.title = S.running ? "Stop" : "Ask (Enter)";
  }

  let askSeq = 0;
  function run() {
    S.q = input.value.trim();
    keep();
    if (!S.q) { S.result = null; renderResults(); return; }
    const id = `a${++askSeq}`;
    S.running = id; S.progress = [];
    post({ type: "ask", q: S.q, id });
    renderTop(); renderStatus();
  }

  function renderStatus() {
    status.replaceChildren();
    if (S.running) {
      status.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
        el("span", {}, S.progress.length ? S.progress[S.progress.length - 1] : "Looking…")));
    } else if (S.result && S.result.error) status.append(el("div", { class: "err" }, S.result.error));
    else if (S.result && S.result.answer) {
      // `code` in the answer shows as code
      status.append(el("div", { class: "answer" }, S.result.answer.split(/(`[^`]+`)/).map((p) => /^`[^`]+`$/.test(p) ? el("code", {}, p.slice(1, -1)) : p)));
    }
  }

  function renderResults() {
    askResults.replaceChildren();
    renderStatus();
    const r = S.result;
    if (!r || r.error) {
      if (!r && !S.running) askResults.append(el("div", { class: "hint" },
        "Ask in your own words. Kural searches your project and lists the exact places.", el("br"), el("br"), el("span", { class: "dim" }, "Example: where is the user logged in?")));
      return;
    }
    const byFile = new Map();
    for (const p of r.results) { if (!byFile.has(p.file)) byFile.set(p.file, []); byFile.get(p.file).push(p); }
    if (!byFile.size) askResults.append(el("div", { class: "hint" }, "No matching place found."));
    for (const [file, matches] of byFile) {
      const closed = S.collapsed.has(file);
      askResults.append(el("div", { class: "file", onclick: () => { closed ? S.collapsed.delete(file) : S.collapsed.add(file); renderResults(); } },
        el("span", { class: "twisty" }, icon(closed ? "chevron-right" : "chevron-down")),
        el("span", { class: "fname" }, base(file)), el("span", { class: "fdir" }, dir(file)),
        el("span", { class: "badge" }, matches.length)));
      if (closed) continue;
      for (const m of matches) {
        const open = (preview) => post({ type: "open", file, line: m.line, preview });
        const t = m.text || "";
        askResults.append(el("div", { class: "match", title: `${file}:${m.line}`, onclick: () => open(true), ondblclick: () => open(false) },
          el("span", { class: "ln" }, m.line), el("span", { class: "txt" }, t.trimStart()),
          m.why ? el("div", { class: "why" }, m.why) : null));
      }
    }
    if (r.ms) askResults.append(el("div", { class: "meta" }, `${r.model ? `${r.model} · ` : ""}${(r.ms / 1000).toFixed(1)} s`));
  }

  input.value = S.q;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
    if (e.key === "Escape" && S.running) post({ type: "cancel" });
  });
  // Emptying the question clears the answer below it (it belonged to the old question), and stops one still running.
  input.addEventListener("input", () => {
    grow(input);
    if (input.value.trim() || (!S.result && !S.running)) return;
    if (S.running) post({ type: "cancel" });
    S.q = ""; S.running = null; S.result = null; S.collapsed.clear();
    keep(); renderTop(); renderResults();
  });

  // ==================================================================================================
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    switch (m.type) {
      case "config": {
        const firstTime = !S.cfgSeen; S.cfgSeen = true;
        S.cfg = { ...S.cfg, ...m }; S.model = m.model;
        renderAll();
        if (firstTime && S.f.pattern) find();   // (the last search again, after a restart)
        return;
      }
      case "fontScale": setFs(m.value); measure(); renderRows(); return;
      case "focus": {
        setTab(m.tab || "text");
        if (m.tab === "ask") { if (m.text) input.value = m.text; input.focus(); input.select(); return; }
        if (m.replace) { S.f.showReplace = true; }
        if (m.include !== undefined && m.include) { S.f.include = m.include; includeIn.value = m.include; S.f.showDetails = true; }
        if (m.text) { S.f.pattern = m.text; findIn.value = m.text; grow(findIn); }
        keep(); renderFind();
        (m.replace && S.f.pattern ? replaceIn : findIn).focus();
        if (!m.replace || !S.f.pattern) findIn.select();
        if (m.text || m.include) find();
        return;
      }
      case "cmd": cmd(m); return;
      // ---- Search ----
      case "textFiles":
        if (m.id !== S.searching) return;
        // (The first results replace the old ones only now, so the list doesn't flash empty while you type.)
        if (S.pending) { S.files.clear(); S.pending = null; }
        for (const f of m.files) addFile(f);
        renderRows(); renderFind(); return;
      case "textDone":
        if (m.id !== S.searching) return;
        if (S.pending) { S.files.clear(); S.pending = null; }
        S.searching = null; S.done = m;
        if (m.total && S.f.pattern) remember("find", S.f.pattern);
        renderAll(); return;
      case "textFile":
        if (m.id !== seq || S.searching) return;
        if (m.file.matches.length) addFile(m.file); else S.files.delete(m.file.path);
        renderAll(); return;
      case "replaced": remember("replace", S.f.replace); find(true); return;
    }
    // ---- Ask ----
    if (m.id !== S.running) return;
    if (m.type === "progress") { S.progress.push(m.text); renderStatus(); return; }
    S.running = null;
    if (m.type === "askResult") S.result = { kind: "ask", answer: m.answer, results: m.results, ms: m.ms, model: m.model };
    else if (m.type === "error") S.result = { error: m.message };
    else if (m.type === "done") S.result = S.result && !S.result.error ? S.result : null;
    S.collapsed.clear();
    keep(); renderTop(); renderResults();
  });

  // ---------- start ----------
  findIn.value = S.f.pattern; replaceIn.value = S.f.replace; includeIn.value = S.f.include; excludeIn.value = S.f.exclude;
  measure();
  renderTop(); renderResults(); renderAll();
  setTab(S.tab);
  requestAnimationFrame(() => { grow(findIn); grow(replaceIn); });
  post({ type: "ready" });
})();
