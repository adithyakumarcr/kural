// Ask & Search panel UI (left sidebar). Talks to lib/search.js.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  // Text size follows the code editor's font (set by Kural; see lib/ui.js).
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);

  const saved = vscode.getState() || {};
  const S = { mode: saved.mode || "ask", q: saved.q || "", opts: saved.opts || { matchCase: false, regex: false, word: false },
    running: null, result: saved.result || null, collapsed: new Set(), progress: [], model: "sonnet" };
  const keep = () => vscode.setState({ mode: S.mode, q: S.q, opts: S.opts, result: S.result });

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

  // ---------- layout ----------
  const input = el("textarea", { class: "q", rows: 1, spellcheck: "false" });
  const modeAsk = el("button", { onclick: () => setMode("ask") }, "Ask");
  const modeSearch = el("button", { onclick: () => setMode("search") }, "Search");
  const opt = (key, label, title) => el("button", { class: "opt", title, onclick: () => { S.opts[key] = !S.opts[key]; renderOpts(); keep(); if (S.mode === "search") run(); } }, label);
  const optCase = opt("matchCase", "Aa", "Match case"), optWord = opt("word", "ab", "Whole word"), optRegex = opt("regex", ".*", "Regular expression");
  const opts = el("span", { class: "opts" }, optCase, optWord, optRegex);
  const goBtn = el("button", { class: "go", onclick: () => (S.running ? post({ type: "cancel" }) : run()) });
  const status = el("div", { class: "status" });
  const results = el("div", { class: "results" });
  app.append(el("div", { class: "top" },
    el("div", { class: "seg" }, modeAsk, modeSearch),
    el("div", { class: "box" }, input, opts, goBtn)), status, results);

  function setMode(m) { S.mode = m; S.result = null; renderTop(); renderResults(); keep(); input.focus(); if (m === "search" && S.q) run(); }
  function renderOpts() { optCase.classList.toggle("on", S.opts.matchCase); optWord.classList.toggle("on", S.opts.word); optRegex.classList.toggle("on", S.opts.regex); }
  function renderTop() {
    modeAsk.classList.toggle("on", S.mode === "ask"); modeSearch.classList.toggle("on", S.mode === "search");
    opts.classList.toggle("hidden", S.mode !== "search");
    input.placeholder = S.mode === "ask" ? "Ask where something is…  e.g. variable for operator box pause?" : "Search text in files";
    goBtn.textContent = S.running ? "■" : S.mode === "ask" ? "↑" : "⌕";
    goBtn.title = S.running ? "Stop" : S.mode === "ask" ? "Ask Claude (Enter)" : "Search (Enter)";
    renderOpts();
  }

  // ---------- running ----------
  let seq = 0, typingTimer = null;
  function run() {
    S.q = input.value.trim();
    keep();
    if (!S.q) { S.result = null; renderResults(); return; }
    const id = ++seq;
    S.running = id; S.progress = [];
    if (S.mode === "ask") post({ type: "ask", q: S.q, id }); else post({ type: "search", q: S.q, opts: S.opts, id });
    renderTop(); renderStatus();
  }

  function renderStatus() {
    status.replaceChildren();
    if (S.running && S.mode === "ask") {
      status.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
        el("span", {}, S.progress.length ? S.progress[S.progress.length - 1] : "Claude is looking…")));
    } else if (S.result && S.result.error) status.append(el("div", { class: "err" }, S.result.error));
    else if (S.result && S.result.kind === "search") {
      const n = S.result.files.length;
      status.append(el("div", { class: "count" }, S.result.total ? `${S.result.total}${S.result.limited ? "+" : ""} results in ${n} file${n === 1 ? "" : "s"}` : "No results"));
    } else if (S.result && S.result.kind === "ask" && S.result.answer) {
      // `code` in the answer shows as code
      status.append(el("div", { class: "answer" }, S.result.answer.split(/(`[^`]+`)/).map((p) => /^`[^`]+`$/.test(p) ? el("code", {}, p.slice(1, -1)) : p)));
    }
  }

  function hl(text, ranges) {
    // Show the match with some text around it, highlighted.
    const out = [];
    const r0 = ranges && ranges[0];
    const indent = text.length - text.trimStart().length;
    let start = indent, cut = false;
    if (r0 && r0[0] - indent > 40) { start = r0[0] - 30; cut = true; }   // long line: show text near the match
    const t = text.slice(start);
    let pos = 0;
    for (const [a, b] of ranges || []) {
      const s = a - start, e = b - start;
      if (s < pos || s < 0) continue;
      out.push(t.slice(pos, s), el("mark", {}, t.slice(s, e)));
      pos = e;
    }
    out.push(t.slice(pos));
    return [cut ? "…" : "", ...out];
  }

  function renderResults() {
    results.replaceChildren();
    renderStatus();
    const r = S.result;
    if (!r || r.error) {
      if (!r && !S.running) results.append(el("div", { class: "hint" }, S.mode === "ask"
        ? ["Ask in your own words. Claude searches your project and lists the exact places.", el("br"), el("br"), el("span", { class: "dim" }, "Example: where is the variable for operator box pause?")]
        : "Type to search text in your project. Aa = match case, ab = whole word, .* = regex."));
      return;
    }
    let groups;
    if (r.kind === "ask") {
      const byFile = new Map();
      for (const p of r.results) { if (!byFile.has(p.file)) byFile.set(p.file, []); byFile.get(p.file).push(p); }
      groups = [...byFile].map(([file, matches]) => ({ file, matches }));
      if (!groups.length) results.append(el("div", { class: "hint" }, "Claude didn't find a matching place."));
    } else groups = r.files;
    for (const g of groups) {
      const closed = S.collapsed.has(g.file);
      results.append(el("div", { class: "file", onclick: () => { closed ? S.collapsed.delete(g.file) : S.collapsed.add(g.file); renderResults(); } },
        el("span", { class: "twisty" }, closed ? "▸" : "▾"),
        el("span", { class: "fname" }, base(g.file)), el("span", { class: "fdir" }, dir(g.file)),
        el("span", { class: "badge" }, g.matches.length)));
      if (closed) continue;
      for (const m of g.matches) {
        const open = (preview) => post({ type: "open", file: g.file, line: m.line, col: m.ranges && m.ranges[0] ? m.ranges[0][0] : 0, len: m.ranges && m.ranges[0] ? m.ranges[0][1] - m.ranges[0][0] : 0, preview });
        results.append(el("div", { class: "match", title: `${g.file}:${m.line}`, onclick: () => open(true), ondblclick: () => open(false) },
          el("span", { class: "ln" }, m.line),
          el("span", { class: "txt" }, hl(m.text, m.ranges)),
          m.why ? el("div", { class: "why" }, m.why) : null));
      }
    }
    if (r.ms) results.append(el("div", { class: "meta" }, `${r.kind === "ask" ? "Claude" : "Search"} · ${(r.ms / 1000).toFixed(1)} s`));
  }

  // ---------- input ----------
  input.value = S.q;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
    if (e.key === "Escape" && S.running) post({ type: "cancel" });
  });
  input.addEventListener("input", () => {
    input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px";
    if (S.mode === "search") { clearTimeout(typingTimer); typingTimer = setTimeout(run, 250); }   // search as you type
  });

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (m.type === "config") { S.model = m.model; return; }
    if (m.type === "fontScale") { setFs(m.value); return; }
    if (m.type === "focus") { if (m.text) { input.value = m.text; } input.focus(); input.select(); return; }
    if (m.id !== S.running) return;
    if (m.type === "progress") { S.progress.push(m.text); renderStatus(); return; }
    S.running = null;
    if (m.type === "askResult") S.result = { kind: "ask", answer: m.answer, results: m.results, ms: m.ms };
    else if (m.type === "searchResult") S.result = { kind: "search", files: m.files, total: m.total, limited: m.limited, ms: m.ms };
    else if (m.type === "error") S.result = { error: m.message };
    else if (m.type === "done") S.result = S.result && !S.result.error ? S.result : null;
    S.collapsed.clear();
    keep(); renderTop(); renderResults();
  });

  renderTop(); renderResults();
  post({ type: "ready" });
})();
