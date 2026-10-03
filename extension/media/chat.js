// The Kural chat panel UI. A small web page inside the editor that talks to
// lib/chat.js through postMessage. No outside libraries, so it works offline.
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  // Text size follows the code editor's font (set by Kural; see lib/ui.js).
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  // Tell Kural when the chat has the keyboard, so its shortcuts (Ctrl+M, Ctrl+P, …) apply only here.
  window.addEventListener("focus", () => vscode.postMessage({ type: "focusChanged", focused: true }));
  window.addEventListener("blur", () => vscode.postMessage({ type: "focusChanged", focused: false }));
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.filename}:${e.lineno})` }));

  const S = {
    tabs: [], activeId: null, tab: null,
    models: [], efforts: [], modes: [], teamSizes: [2, 3, 4, 5], version: "",
    activeFile: null, includeActive: true, attachments: [], setups: {},
    files: [], popup: null, menu: null,
    history: [], showHistory: false, historyQuery: "", historyScope: "all", hereName: "", confirmDelete: null, renaming: null,
  };

  // ---------- helpers ----------
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const base = (p) => (p || "").split("/").pop();
  const dir = (p) => { const i = (p || "").lastIndexOf("/"); return i > 0 ? p.slice(0, i) : ""; };
  const post = (m) => vscode.postMessage(m);
  // "Sonnet", or for a model on this computer (Ollama) "qwen3-coder:30b · local".
  const modelLabel = (id) => /^ollama:/.test(id || "") ? `${id.slice(7)} · local` : (S.models.find((m) => m.id === id) || { label: id || "?" }).label;
  const gb = (bytes) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  const FRIENDS = ["Rachel", "Ross", "Monica", "Chandler", "Joey", "Phoebe"];
  const roleLabel = (id) => (S.roles.find((r) => r.id === id) || { label: id }).label;
  const moodLabel = (id) => (S.moods.find((m) => m.id === id) || { label: "" }).label;
  const effortLabel = (id) => (S.efforts.find((e) => e.id === id) || { label: "Medium" }).label;
  const modeLabel = (id) => (S.modes.find((m) => m.id === id) || { label: "Agent" }).label;
  const pillLabel = (c) => c.kind === "selection" ? `${base(c.path)} (L${c.startLine}-${c.endLine})` : base(c.path);
  // Show ⌘ instead of Ctrl on a Mac.
  const MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
  // "Ctrl+" is ⌘ on a Mac; "Control+" means the Control key everywhere (⌃ on a Mac).
  const keys = (k) => MAC ? k.replace(/Control\+/g, "⌃").replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥") : k.replace(/Control\+/g, "Ctrl+");

  // Small line icons (inline SVG, colored by the theme).
  const ICON = {
    clock: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
    pin: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path d="M9.8 2.2l4 4-2.1.7-2.4 2.4.3 3-1.3 1.3-2.4-2.4-3.2 3.2M5.3 8.6L2.9 6.2l1.3-1.3 3 .3 2.4-2.4z"/></svg>',
    trash: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  };
  const icon = (name) => el("span", { class: "ic", html: ICON[name] });

  function ago(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); if (d < 7) return `${d} d ago`;
    return new Date(t).toLocaleDateString();
  }

  // ---------- tiny markdown (with tables) ----------
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, (_, c) => {
        const m = c.match(/^([\w./-]+\.[A-Za-z0-9]+)(?::(\d+)(?:-(\d+))?)?$/);
        return m ? `<code class="ref" data-path="${m[1]}" data-line="${m[2] || ""}">${c}</code>` : `<code>${c}</code>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="link">$1</span>');
  }

  // "| a | b |" → ["a", "b"]   (a "|" inside `code` doesn't split)
  function cells(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    const out = []; let cur = "", code = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "`") code = !code;
      if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (ch === "|" && !code) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const isRow = (line) => /^\s*\|.*\|\s*$/.test(line) || (line.includes("|") && line.trim().split("|").length > 2);

  function table(head, aligns, rows) {
    const al = (i) => aligns[i] ? { style: `text-align:${aligns[i]}` } : {};
    return el("div", { class: "table-wrap" }, el("table", {},
      el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { ...al(i), html: inline(h) })))),
      el("tbody", {}, rows.map((r) => el("tr", {}, head.map((_, i) => el("td", { ...al(i), html: inline(r[i] || "") })))))));
  }

  function markdown(src, finished) {
    const out = [], lines = src.split("\n");
    let para = [], list = null;
    const flushPara = () => { if (para.length) { out.push(el("p", { html: inline(para.join(" ")) })); para = []; } };
    const flushList = () => { if (list) { out.push(list); list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```(.*)$/);
      if (fence) {
        flushPara(); flushList();
        const code = []; let closed = false;
        for (i++; i < lines.length; i++) { if (/^\s*```\s*$/.test(lines[i])) { closed = true; break; } code.push(lines[i]); }
        out.push(codeCard(fence[1].trim(), code.join("\n"), closed || finished));
        continue;
      }
      // Table: a header row, then a |---|---| row, then data rows.
      if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        flushPara(); flushList();
        const head = cells(line);
        const aligns = cells(lines[i + 1]).map((c) => /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : "");
        const rows = [];
        for (i += 2; i < lines.length && isRow(lines[i]) && lines[i].trim(); i++) rows.push(cells(lines[i]));
        i--;
        out.push(table(head, aligns, rows));
        continue;
      }
      // Some answers squeeze a whole table onto one line: "| a | b || --- | --- || 1 | 2 |". Unsqueeze it.
      if (/\|\s*\|\s*:?-{2,}/.test(line) && (line.match(/\|\|/g) || []).length >= 2) {
        const rowsText = line.replace(/\|\s*\|/g, "|\n|").split("\n");
        if (rowsText.length > 2 && isSep(rowsText[1])) { lines.splice(i, 1, ...rowsText); i--; continue; }
      }
      const h = line.match(/^(#{1,4})\s+(.*)$/), li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
      if (h) { flushPara(); flushList(); out.push(el(`h${Math.min(6, h[1].length + 2)}`, { html: inline(h[2]) })); }
      else if (li) { flushPara(); if (!list) list = el(/^\s*\d/.test(line) ? "ol" : "ul"); list.append(el("li", { html: inline(li[1]) })); }
      else if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); out.push(el("hr")); }
      else if (!line.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
    return out;
  }

  function codeCard(info, code, done) {
    const lang = (info.split(/\s+/)[0] || "").replace(/^path=.*/, "");
    const pm = info.match(/path=(\S+)/), file = pm ? pm[1] : null;
    const btn = (label, title, onclick, cls) => el("button", { class: `cb ${cls || ""}`, title, onclick, disabled: !done }, label);
    return el("div", { class: "code" },
      el("div", { class: "code-head" },
        file ? el("span", { class: "code-file", title: "Open file", onclick: () => post({ type: "openFile", path: file }) }, file)
          : el("span", { class: "code-lang" }, lang || "code"),
        el("span", { class: "spacer" }),
        btn("Copy", "Copy to clipboard", () => post({ type: "copy", code })),
        btn("Insert", "Insert at the cursor", () => post({ type: "insert", code })),
        btn("Apply", file ? `Apply to ${file} and review` : "Apply to the open file and review", () => post({ type: "apply", code, path: file }), "primary")),
      el("pre", {}, el("code", {}, code)));
  }

  // ---------- layout ----------
  const tabsEl = el("div", { class: "tabs" });
  const historyBtn = el("button", { class: "icon-btn", title: "All chats (history)", onclick: () => toggleHistory() }, icon("clock"));
  // "+" and the clock stay put; only the tabs scroll (mouse wheel scrolls them sideways).
  const newTabBtn = el("button", { class: "tab-new", title: keys("New chat (Ctrl+Alt+N)"), onclick: () => { S.focusNext = true; closeHistory(); post({ type: "newTab" }); } }, icon("plus"));
  const tabBar = el("div", { class: "tabbar" }, tabsEl, newTabBtn, historyBtn);
  tabsEl.addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  const listEl = el("div", { class: "list" });
  const historyEl = el("div", { class: "history hidden" });
  const localEl = el("div", { class: "history local hidden" });   // "Local models": search, download, use
  const chipsEl = el("div", { class: "chips" });
  const input = el("div", { class: "input", contenteditable: "plaintext-only", role: "textbox", "aria-multiline": "true", "data-placeholder": "" });
  const popupEl = el("div", { class: "popup hidden" });
  const menuEl = el("div", { class: "menu hidden" });
  const modeBtn = el("button", { class: "pick", title: "Mode", onclick: (e) => openMenu("mode", e.currentTarget) });
  const modelBtn = el("button", { class: "pick", title: "Model, intensity and agent team", onclick: (e) => openMenu("model", e.currentTarget) });
  const sendBtn = el("button", { class: "send", onclick: () => sendOrStop() });
  const attachBtn = el("button", { class: "attach", title: "Add files or link a Jira ticket. You can also paste a screenshot.", onclick: () => openMenu("add", attachBtn) }, icon("plus"));
  const composer = el("div", { class: "composer" }, popupEl, chipsEl, input,
    el("div", { class: "foot" }, attachBtn, modeBtn, modelBtn, el("span", { class: "spacer" }),
      sendBtn));   // (type @ to mention a project file; + attaches anything)
  // A chat from another workspace: read it here; to go on, open its folder or continue it here.
  const visitBar = el("div", { class: "visit hidden" });
  const body = el("div", { class: "body" }, listEl, historyEl, localEl);
  app.replaceChildren(tabBar, body, visitBar, composer, menuEl);

  // ---------- tabs ----------
  const lastClick = { id: null, at: 0 };
  function renderTabs() {
    tabsEl.replaceChildren(
      ...S.tabs.map((t) => {
        if (S.renaming === t.id) {
          const box = el("input", { class: "tab-rename", value: t.title, maxlength: "60",
            onkeydown: (e) => {
              if (e.key === "Enter") { e.preventDefault(); finishRename(t.id, box.value); }
              if (e.key === "Escape") { e.preventDefault(); S.renaming = null; renderTabs(); input.focus(); }
            },
            onblur: () => finishRename(t.id, box.value) });
          setTimeout(() => { box.focus(); box.select(); }, 0);
          return el("div", { class: "tab active renaming" }, box);
        }
        return el("div", {
          class: `tab ${t.id === S.activeId ? "active" : ""} ${t.status} ${t.unread ? "unread" : ""}`,
          title: `${t.title}\n${modelLabel(t.model)} · ${effortLabel(t.effort)} · ${modeLabel(t.mode)}${t.team ? ` · ${t.team} agents` : ""}\nDouble-click to rename`,
          // Two clicks on the same tab within 450 ms = rename. (Detected by hand: switching tabs
          // redraws the tab strip, so the browser's own double-click event never arrives.)
          onclick: () => {
            const now = Date.now(), again = lastClick.id === t.id && now - lastClick.at < 450;
            lastClick.id = t.id; lastClick.at = now;
            if (again) { S.renaming = t.id; renderTabs(); return; }
            closeHistory();
            if (t.id !== S.activeId) { S.focusNext = true; post({ type: "switchTab", id: t.id }); }
          },
          onauxclick: (e) => { if (e.button === 1) post({ type: "closeTab", id: t.id }); },
        },
        el("span", { class: "dot" }),
        el("span", { class: "tab-title" }, t.title),
        el("button", { class: "tab-x", title: "Close (stays in history)", onclick: (e) => { e.stopPropagation(); post({ type: "closeTab", id: t.id }); } }, "×"));
      }));
    const a = tabsEl.querySelector(".tab.active");
    if (a) a.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function finishRename(id, value) {
    if (S.renaming !== id) return;
    S.renaming = null;
    if (value && value.trim()) post({ type: "renameTab", id, title: value });
    renderTabs();
  }

  // ---------- history (clock) ----------
  function toggleHistory() { S.showHistory ? closeHistory() : openHistory(); }
  function openHistory() { if (S.showLocal) closeLocal(); S.showHistory = true; post({ type: "history" }); renderHistory(); historyBtn.classList.add("on"); }
  function closeHistory() { S.confirmDelete = null; S.showHistory = false; historyEl.classList.add("hidden"); listEl.classList.remove("hidden"); historyBtn.classList.remove("on"); }

  // All chats from every workspace. Pinned ones first; then newest first.
  function renderHistory() {
    if (!S.showHistory) return;
    listEl.classList.add("hidden");
    historyEl.classList.remove("hidden");
    const q = S.historyQuery.toLowerCase();
    const items = S.history.filter((h) => (S.historyScope === "all" || h.here) && (!q || `${h.title} ${h.preview} ${h.ws}`.toLowerCase().includes(q)));
    const search = el("input", { class: "h-search", placeholder: "Search chats…", value: S.historyQuery,
      oninput: (e) => { S.historyQuery = e.target.value; const pos = e.target.selectionStart; renderHistory(); const s = historyEl.querySelector(".h-search"); s.focus(); s.setSelectionRange(pos, pos); },
      onkeydown: (e) => { if (e.key === "Escape") closeHistory(); } });
    const scope = el("div", { class: "seg h-scope" }, ...[["all", "All workspaces"], ["here", "This workspace"]].map(([v, label]) =>
      el("button", { class: S.historyScope === v ? "on" : "", onclick: () => { S.historyScope = v; renderHistory(); } }, label)));
    const pinned = items.filter((h) => h.pinned), rest = items.filter((h) => !h.pinned);
    const group = (label, list) => list.length ? [el("div", { class: "h-group" }, label), ...list.map(historyItem)] : [];
    historyEl.replaceChildren(
      el("div", { class: "h-head" }, el("span", { class: "h-title" }, "All chats"), el("span", { class: "h-count" }, S.history.length ? String(S.history.length) : ""),
        el("span", { class: "spacer" }), el("button", { class: "cb", onclick: () => closeHistory() }, "Back")),
      search, scope,
      items.length ? el("div", { class: "h-list" }, ...group("Pinned", pinned), ...group(pinned.length ? "Chats" : "", rest))
        : el("div", { class: "h-empty" }, S.history.length ? "No chats match." : "Your chats show up here, from every workspace."));
  }

  function historyItem(h) {
    const confirming = S.confirmDelete === h.id;
    return el("div", { class: `h-item ${h.open ? "open" : ""} ${h.pinned ? "pinned" : ""}`, onclick: () => { closeHistory(); S.focusNext = true; post({ type: "reopen", id: h.id }); } },
      el("div", { class: "h-row" },
        el("span", { class: "h-name" }, h.title),
        el("span", { class: "spacer" }),
        el("button", { class: `icon-btn small h-pin ${h.pinned ? "on" : ""}`, title: h.pinned ? "Unpin" : "Pin to the top",
          onclick: (e) => { e.stopPropagation(); post({ type: "pin", id: h.id, value: !h.pinned }); } }, icon("pin")),
        confirming
          ? el("button", { class: "cb danger", title: "Delete this chat for good", onclick: (e) => { e.stopPropagation(); S.confirmDelete = null; post({ type: "forget", id: h.id }); } }, "Delete?")
          : el("button", { class: "icon-btn small", title: "Delete", onclick: (e) => { e.stopPropagation(); S.confirmDelete = h.id; renderHistory(); } }, icon("trash"))),
      el("div", { class: "h-meta" }, ...(h.open ? [el("span", { class: "h-badge" }, "open"), " "] : []),
        ...(h.here ? [] : [el("span", { class: "h-ws", title: "From another workspace" }, h.ws), " · "]),
        `${ago(h.when)} · ${modelLabel(h.model)} · ${h.count} message${h.count === 1 ? "" : "s"}`),
      h.preview && h.preview !== h.title ? el("div", { class: "h-preview" }, h.preview) : null);
  }

  // ---------- messages ----------

  function renderAll() {
    listEl.replaceChildren();
    const t = S.tab;
    if (!t || !t.messages.length) {
      // Home: the name, what it is, one line, three hints. The rest is in the menus.
      const hint = (k, text) => el("span", { class: "hint" }, el("kbd", {}, keys(k)), text);
      listEl.append(el("div", { class: "empty" },
        el("div", { class: "logo" }, "{K}"),
        el("div", { class: "brand" }, "Kural"),
        el("div", { class: "brand-sub" }, "AI-powered code editor"),
        el("div", { class: "tagline" }, "Few words. Working code."),
        el("div", { class: "hints" }, hint("@", "mention a file"), hint("+", "attach"), hint("Ctrl+K", "edit in place")),
        S.version ? el("div", { class: "version" }, `v${S.version}`) : null));
    } else {
      t.messages.forEach((m, i) => listEl.append(messageNode(m, i)));
    }
    listEl.scrollTop = listEl.scrollHeight;
    renderFoot();
  }

  function rerender(i) {
    const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 120;
    const old = listEl.querySelector(`[data-i="${i}"]`);
    const node = messageNode(S.tab.messages[i], i);
    if (old) old.replaceWith(node); else listEl.append(node);
    if (nearBottom) listEl.scrollTop = listEl.scrollHeight;
  }

  // Pills in sent messages open the file when clicked; pills you're still typing don't.
  function pillNode(ctx, openable = true) {
    return el("span", { class: `pill ${ctx.kind}`, contenteditable: "false", "data-ctx": JSON.stringify(ctx),
      title: openable ? `Open ${ctx.path}` : ctx.path,
      onclick: openable ? () => post({ type: "openFile", path: ctx.path, line: ctx.startLine, endLine: ctx.endLine }) : null },
      el("span", { class: "pill-icon" }, ctx.kind === "selection" ? "{ }" : "@"), pillLabel(ctx));
  }

  function messageNode(m, i) {
    if (m.role === "user") {
      return el("div", { class: "msg user", "data-i": i },
        (m.contexts || []).length || (m.mode && m.mode !== "agent") ? el("div", { class: "ctx-line" },
          m.mode && m.mode !== "agent" ? el("span", { class: `mode-tag ${m.mode}` }, modeLabel(m.mode)) : null,
          (m.contexts || []).map((c) => el("span", { class: "ctx" }, "▤ ", c.name || base(c.path)))) : null,
        el("div", { class: "bubble" }, (m.segments || []).map((s) => s.t === "text" ? s.v : pillNode(s.ctx)),
          (m.attachments || []).length ? el("div", { class: "att-row" }, m.attachments.map((a) =>
            el("span", { class: "chip att sent", title: `Open ${a.path}`, onclick: () => post({ type: "openFile", path: a.path }) },
              el("span", { class: "att-icon" }, KIND_ICON[a.kind] || "📎"), el("span", { class: "att-name" }, a.name)))) : null));
    }
    const out = el("div", { class: "answer" });
    const last = i === S.tab.messages.length - 1;
    if (m.team) out.append(el("div", { class: "team-note" }, m.teamStyle === "discuss" ? `Discussion between ${m.team} agents` : `Team of ${m.team} agents`));
    for (const b of m.blocks || []) {
      if (b.k === "text") out.append(...markdown(b.text, !m.running));
      else if (b.k === "tool") out.append(toolNode(b));
      else if (b.k === "perm") out.append(permNode(b));
      else if (b.k === "agent") out.append(agentNode(b));
      else if (b.k === "question") out.append(questionNode(b));
      else if (b.k === "think") out.append(thinkNode(b, m.running && !b.done));
    }
    const waiting = (m.blocks || []).some((b) => (b.k === "perm" || b.k === "question") && b.state === "pending");
    const asking = (m.blocks || []).some((b) => b.k === "question" && b.state === "pending");
    if (m.running && waiting) out.append(el("div", { class: "working" }, el("span", { class: "wait-dot" }), asking ? "Waiting for your answer above" : "Waiting for your OK above"));
    else if (m.running && (m.waitingFor || []).length) out.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
      el("span", {}, `Waiting for ${listNames(m.waitingFor)} to finish — the answer comes when everyone has reported`),
      // Agents that take too long (or got stuck): stop them and get the answer from what's there.
      el("button", { class: "cb", title: "Stop the agents still working and have the lead answer with what it has", onclick: () => post({ type: "finishTeam", tabId: S.tab.id }) }, "Finish now")));
    else if (m.running) out.append(el("div", { class: "working" }, el("span", { class: "dots" }, el("span"), el("span"), el("span")),
      el("span", { class: "elapsed", "data-t0": m.t0 }, workingText(m.t0))));
    if (m.note) out.append(el("div", { class: "note" }, m.note));
    if (m.error === "stopped") out.append(el("div", { class: "note" }, "Stopped."));
    else if (m.error === "login") out.append(el("div", { class: "note warn" }, "You're not logged in to Claude. ", el("button", { class: "cb primary", onclick: () => post({ type: "login" }) }, "Log in")));
    else if (m.error === "missing") out.append(el("div", { class: "note warn" }, "Claude Code isn't installed yet."));
    else if (m.error) out.append(el("div", { class: "note warn" }, m.error, " ", el("button", { class: "cb", onclick: () => post({ type: "showLog" }) }, "Open log")));
    if (m.planReady) out.append(el("div", { class: "plan-bar" },
      m.planBuilt ? el("span", { class: "row-state" }, "✓ Building it") : [
        el("span", { class: "plan-q" }, "Happy with this plan?"),
        el("span", { class: "spacer" }),
        el("button", { class: "cb primary solid big", disabled: S.tab.status !== "idle", onclick: () => post({ type: "buildPlan", tabId: S.tab.id, msgIndex: i }) }, "Build it")]));
    if (m.changes && m.changes.length) out.append(changesNode(m, i));
    if (!m.running && m.ms && last) out.append(el("div", { class: "meta" }, `${(m.ms / 1000).toFixed(1)} s`));
    return el("div", { class: "msg assistant", "data-i": i }, out);
  }

  const listNames = (n) => n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0];
  function workingText(t0) {
    const s = Math.round((Date.now() - (t0 || Date.now())) / 1000);
    return s < 2 ? "Thinking…" : `Thinking… ${s}s`;
  }
  setInterval(() => {
    for (const e of listEl.querySelectorAll(".elapsed")) {
      e.textContent = workingText(+e.dataset.t0);
      const s = (Date.now() - +e.dataset.t0) / 1000;
      if (s > 45 && !e.parentNode.querySelector(".slow")) e.parentNode.append(el("span", { class: "slow" }, " Taking a while. ", el("button", { class: "cb", onclick: () => post({ type: "showLog" }) }, "See log")));
    }
  }, 1000);

  const TOOL_VERB = { Read: "Read", Grep: "Searched", Glob: "Listed", Edit: "Edited", Write: "Wrote", NotebookEdit: "Edited", Bash: "Command", WebSearch: "Searched web", WebFetch: "Web page" };
  // "mcp__claude_ai_Notion__notion-search" -> "Notion · notion-search"
  function prettyTool(name) {
    const m = /^mcp__(.+?)__(.+)$/.exec(name || "");
    return m ? `${m[1].replace(/^claude[._ ]ai[_ ]/i, "").replace(/_/g, " ")} · ${m[2]}` : name;
  }
  function toolNode(b) {
    // Team messages: "Ross → Rachel: what's the number?" as a small chat bubble.
    if (b.name === "mcp__team__post") {
      const [who, ...rest] = b.detail.split(": ");
      return el("div", { class: "team-msg" }, el("span", { class: "team-who" }, who), " ", rest.join(": "));
    }
    if (b.name === "mcp__team__read") return el("div", { class: "tool team-wait" }, b.detail);
    const file = ["Read", "Edit", "Write", "NotebookEdit"].includes(b.name) ? b.detail.split("  (")[0] : null;
    return el("div", { class: `tool ${b.name}` },
      el("span", { class: "tool-name" }, TOOL_VERB[b.name] || prettyTool(b.name)), " ",
      file ? el("span", { class: "tool-file", onclick: () => post({ type: "openFile", path: file }) }, b.detail)
        : b.name === "Bash" ? el("code", {}, b.detail) : el("span", {}, b.detail));
  }

  // Claude's thinking (short summaries). Open while it thinks; afterwards one line you can click to open.
  function thinkNode(b, live) {
    const secs = b.ms ? Math.max(1, Math.round(b.ms / 1000)) : 0;
    const node = el("div", { class: `think${live || b._open ? " open" : ""}${live ? " live" : ""}` });
    node.append(
      el("div", { class: "think-head", onclick: () => { b._open = !node.classList.contains("open"); node.classList.toggle("open", b._open); } },
        el("span", { class: "think-caret" }), live ? "Thinking…" : secs ? `Thought for ${secs} s` : "Thought"),
      el("div", { class: "think-body" }, b.text));
    if (live) requestAnimationFrame(() => { const body = node.querySelector(".think-body"); if (body) body.scrollTop = body.scrollHeight; });
    return node;
  }

  function agentNode(b) {
    const label = { running: "working", done: "done", failed: "failed", stopped: "stopped" }[b.state] || b.state;
    return el("div", { class: `agent ${b.state}`, "data-agent": b.id },
      el("div", { class: "agent-head" },
        el("span", { class: "agent-n" }, b.name || `Agent ${b.n}`),
        b.role ? el("span", { class: "agent-role" }, b.role) : null,
        el("span", { class: "agent-title" }, b.title),
        el("span", { class: "spacer" }),
        b.state === "running" && b.activity ? el("span", { class: "agent-activity", title: b.activity }, b.activity) : null,
        b.state !== "running" && b.why ? el("span", { class: "agent-activity", title: b.why }, b.why) : null,
        b.state === "running" ? el("span", { class: "dots small" }, el("span"), el("span"), el("span")) : null,
        el("span", { class: "agent-state" }, label)),
      b.steps.length ? el("div", { class: "agent-steps" }, ...agentSteps(b)) : null);
  }
  // What the agent wrote (always), and its last 5 other steps: thinking and tools.
  // (Messages between agents are shown in the answer itself; older chats kept them in the cards.)
  function agentSteps(b) {
    const keep = (s) => s.k === "say" || s.name === "mcp__team__post";
    const recent = new Set(b.steps.filter((s) => !keep(s)).slice(-5));
    const shown = b.steps.filter((s) => keep(s) || recent.has(s));
    const hidden = b.steps.length - shown.length;
    return [hidden ? el("div", { class: "tool more" }, `+${hidden} earlier steps`) : null, ...shown.map((s) =>
      s.k === "say" ? clampNode("agent-say", s.text) :
      s.k === "think" ? clampNode("agent-think", s.text) : toolNode(s))];
  }
  // Long text shows a few lines; click to see all of it.
  function clampNode(cls, text) {
    const node = el("div", { class: `${cls} clamp`, title: "Click to show all" }, text);
    node.onclick = () => node.classList.toggle("clamp");
    return node;
  }

  // Claude's multiple-choice question. Your picks live on the block (b._sel, b._other) so a
  // redraw while you're choosing doesn't lose them.
  function questionNode(b) {
    const qs = b.questions || [];
    const card = el("div", { class: `question ${b.state}` });
    const who = b.agent ? el("span", { class: "perm-agent" }, b.agent) : null;
    if (b.state !== "pending") {
      card.append(el("div", { class: "q-title" }, who, b.state === "answered" ? "You answered" : "Skipped"));
      for (const q of qs) card.append(el("div", { class: "q-done" }, el("span", { class: "q-muted" }, q.question), " ",
        el("b", {}, b.answers && b.answers[q.question] ? b.answers[q.question] : "—")));
      return card;
    }
    b._sel = b._sel || qs.map(() => []);
    b._other = b._other || qs.map(() => "");
    const submit = el("button", { class: "cb primary solid", onclick: () => send() }, "Submit");
    const ready = () => qs.every((q, i) => b._sel[i].length || b._other[i].trim());
    const refresh = () => { submit.disabled = !ready(); };
    const answerOf = (q, i) => [...b._sel[i], ...(b._other[i].trim() ? [b._other[i].trim()] : [])].join(", ");
    const send = () => {
      if (!ready()) return;
      const answers = {};
      qs.forEach((q, i) => { answers[q.question] = answerOf(q, i); });
      post({ type: "answer", tabId: S.tab.id, pid: b.pid, answers });
    };
    card.append(el("div", { class: "q-title" }, who, qs.length > 1 ? "Claude has a few questions" : "Claude asks"));
    qs.forEach((q, i) => {
      const multi = !!q.multiSelect;
      const box = el("div", { class: "q-block" },
        q.header ? el("span", { class: "q-chip" }, q.header) : null,
        el("div", { class: "q-text" }, q.question),
        multi ? el("div", { class: "q-muted small" }, "Pick one or more") : null);
      const rows = [];
      const paint = () => rows.forEach(([row, label]) => row.classList.toggle("on", b._sel[i].includes(label)));
      for (const o of q.options || []) {
        const row = el("button", { class: `q-opt ${multi ? "multi" : ""}`, onclick: () => {
          const sel = b._sel[i];
          if (multi) { const k = sel.indexOf(o.label); if (k >= 0) sel.splice(k, 1); else sel.push(o.label); }
          else { b._sel[i] = sel[0] === o.label ? [] : [o.label]; b._other[i] = ""; other.value = ""; }
          paint(); refresh();
        } }, el("span", { class: "q-mark" }), el("span", { class: "q-opt-text" }, el("span", { class: "q-label" }, o.label),
          o.description ? el("span", { class: "q-desc" }, o.description) : null));
        rows.push([row, o.label]);
        box.append(row);
      }
      const other = el("input", { class: "q-other", placeholder: "Other…", value: b._other[i], oninput: () => {
        b._other[i] = other.value;
        if (!multi && other.value.trim()) { b._sel[i] = []; paint(); }
        refresh();
      }, onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } } });
      box.append(other);
      paint();
      card.append(box);
    });
    card.append(el("div", { class: "perm-row" }, submit,
      el("button", { class: "cb", onclick: () => post({ type: "answer", tabId: S.tab.id, pid: b.pid, answers: null }) }, "Skip")));
    refresh();
    return card;
  }

  function permNode(b) {
    const what = b.tool === "Bash" ? "Run this command?" : b.tool === "WebFetch" ? "Open this web page?" : `Use ${prettyTool(b.tool)}?`;
    const card = el("div", { class: `perm ${b.state}` }, el("div", { class: "perm-q" }, b.agent ? el("span", { class: "perm-agent" }, typeof b.agent === "number" ? `Agent ${b.agent}` : b.agent) : null, what), el("pre", {}, b.detail));
    if (b.state === "pending") {
      const always = el("input", { type: "checkbox", id: `al-${b.pid}` });
      card.append(el("div", { class: "perm-row" },
        el("button", { class: "cb primary solid", onclick: () => post({ type: "permission", pid: b.pid, allow: true, always: always.checked }) }, "Run"),
        el("button", { class: "cb", onclick: () => post({ type: "permission", pid: b.pid, allow: false }) }, "Skip"),
        el("label", { class: "always", for: `al-${b.pid}` }, always, " Allow all commands in this chat")));
    } else card.append(el("div", { class: "perm-state" }, b.state === "allowed" ? "✓ Allowed" : "✕ Skipped"));
    return card;
  }

  function changesNode(m, i) {
    const pending = m.changes.filter((c) => c.state === "pending").length;
    const act = (action, id) => post({ type: "change", msgIndex: i, id, action });
    return el("div", { class: "card" },
      el("div", { class: "card-head" }, `${m.changes.length} file${m.changes.length === 1 ? "" : "s"} changed`),
      m.changes.map((c) => el("div", { class: `row ${c.state}` },
        el("span", { class: "row-file", title: c.rel, onclick: () => act("review", c.id) }, base(c.rel), el("span", { class: "row-dir" }, dir(c.rel))),
        el("span", { class: "add" }, `+${c.added}`), el("span", { class: "del" }, `−${c.removed}`),
        c.state === "pending" ? el("span", { class: "row-btns" },
          el("button", { class: "cb", onclick: () => act("review", c.id) }, "Review"),
          el("button", { class: "cb", onclick: () => act("undo", c.id) }, "Undo"),
          el("button", { class: "cb primary", onclick: () => act("keep", c.id) }, "Keep"))
          : el("span", { class: "row-state" }, c.state === "kept" ? "✓ Kept" : "↶ Undone"))),
      pending > 1 ? el("div", { class: "card-foot" },
        el("button", { class: "cb", onclick: () => act("undo", "*") }, "Undo all"),
        el("button", { class: "cb primary", onclick: () => act("keep", "*") }, "Keep all")) : null);
  }

  // ---------- composer ----------
  function renderChips() {
    chipsEl.replaceChildren();
    const tk = S.tab && S.tab.ticket;
    if (tk) chipsEl.append(el("span", { class: "chip ticket", title: `${tk.key}: ${tk.summary}${tk.status ? ` (${tk.status})` : ""}\nLinked to this chat: Claude knows about it in every message.${tk.url ? "\nClick to open it in Jira." : ""}`,
      onclick: () => tk.url && post({ type: "openUrl", url: tk.url }) },
      "🎫 ", el("b", {}, tk.key), el("span", { class: "chip-dim ticket-chip-sum" }, ` · ${tk.summary}`),
      el("button", { class: "chip-x", title: "Unlink this ticket", onclick: (e) => { e.stopPropagation(); post({ type: "linkTicket", tabId: S.tab.id, ticket: null }); } }, "×")));
    if (S.activeFile && S.includeActive)
      chipsEl.append(el("span", { class: "chip", title: `${S.activeFile.path} is sent with your message` }, "▤ ", S.activeFile.name, el("span", { class: "chip-dim" }, " · current file"),
        el("button", { class: "chip-x", title: "Don't send this file", onclick: () => { S.includeActive = false; renderChips(); } }, "×")));
    else if (S.activeFile)
      chipsEl.append(el("button", { class: "chip ghost", onclick: () => { S.includeActive = true; renderChips(); } }, "+ ", S.activeFile.name));
    for (const a of S.attachments) chipsEl.append(attachChip(a, () => { S.attachments = S.attachments.filter((x) => x.id !== a.id); renderChips(); }));
  }
  const KIND_ICON = { image: "🖼", pdf: "📄", text: "▤", folder: "📁", file: "📎" };
  function attachChip(a, remove) {
    return el("span", { class: `chip att ${a.kind}`, title: a.path || a.name },
      a.thumb ? el("img", { class: "att-thumb", src: a.thumb, alt: "" }) : el("span", { class: "att-icon" }, KIND_ICON[a.kind] || "📎"),
      el("span", { class: "att-name" }, a.name),
      remove ? el("button", { class: "chip-x", title: "Remove", onclick: remove }, "×") : null);
  }

  function renderFoot() {
    const t = S.tab;
    if (!t) return;
    const v = t.visiting;
    composer.classList.toggle("hidden", !!v);
    visitBar.classList.toggle("hidden", !v);
    if (v) visitBar.replaceChildren(
      el("div", { class: "visit-text" }, "This chat is from the workspace ", el("b", {}, v.name), ". Claude keeps each conversation with its own folder."),
      el("div", { class: "visit-actions" },
        v.canOpen ? el("button", { class: "cb", title: "Open that folder in a new window and carry on there", onclick: () => post({ type: "openWorkspace", id: t.id }) }, "Open its folder") : null,
        el("button", { class: "cb primary", title: "Start a new chat here that knows this conversation", onclick: () => { S.focusNext = true; post({ type: "continueHere", id: t.id }); } }, "Continue here")));
    const running = t.status !== "idle";
    modeBtn.replaceChildren(el("span", { class: `mode-dot m-${t.mode}` }), modeLabel(t.mode), el("span", { class: "chev" }, "▾"));
    const team = t.teamSize ? ` · ${t.teamStyle === "discuss" ? "discussion" : `${t.teamSize} agents`}` : "";
    const mood = t.mood && t.mood !== "default" ? ` · ${moodLabel(t.mood)}` : "";
    modelBtn.replaceChildren(`${t.modelName || modelLabel(t.model)} · ${t.effort === "medium" ? "Med" : effortLabel(t.effort)}${mood}${team}`, el("span", { class: "chev" }, "▾"));
    sendBtn.replaceChildren(running ? "■" : "↑");
    sendBtn.title = running ? "Stop (Esc)" : "Send (Enter)";
    sendBtn.classList.toggle("stop", running);
    input.dataset.placeholder = {
      agent: "Ask Claude to change something…  @ to mention a file",
      auto: "Ask Claude to change something (runs commands without asking)…",
      plan: "Describe what you want; Claude plans it first…",
      ask: "Ask about your code…  @ to mention a file",
    }[t.mode] || "";
  }

  // Your message as pieces: text and pills.
  function readInput() {
    const segs = [];
    const push = (v) => { if (!v) return; const l = segs[segs.length - 1]; if (l && l.t === "text") l.v += v; else segs.push({ t: "text", v }); };
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) push(n.data);
        else if (n.classList && n.classList.contains("pill")) segs.push({ t: "pill", ctx: JSON.parse(n.dataset.ctx) });
        else if (n.nodeName === "BR") push("\n");
        else { if (n.nodeName === "DIV" && segs.length) push("\n"); walk(n); }
      }
    };
    walk(input);
    return segs;
  }

  function isEmptyInput() { return !readInput().some((s) => s.t === "pill" || s.v.trim()); }

  function sendOrStop() {
    const t = S.tab;
    if (!t) return;
    if (t.status !== "idle") { post({ type: "stop", tabId: t.id }); return; }
    if (isEmptyInput() && !S.attachments.length) return;
    const segments = readInput();
    const contexts = segments.filter((s) => s.t === "pill").map((s) => s.ctx);
    if (S.activeFile && S.includeActive) contexts.unshift({ kind: "current", path: S.activeFile.path, name: S.activeFile.name });
    post({ type: "send", tabId: t.id, segments, contexts, attachments: S.attachments.map((a) => a.id) });
    S.attachments = []; renderChips();
    input.replaceChildren();
    closePopup(); closeHistory();
  }

  // --- caret ---
  let savedRange = null;
  function saveRange() {
    const sel = window.getSelection();
    if (sel.rangeCount && input.contains(sel.getRangeAt(0).startContainer)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  document.addEventListener("selectionchange", saveRange);
  function caretRange() {
    if (savedRange && input.contains(savedRange.startContainer)) return savedRange;
    const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); return r;
  }
  function insertNodes(nodes, range) {
    input.focus();
    const r = range || caretRange();
    r.deleteContents();
    const frag = document.createDocumentFragment();
    let lastNode = null;
    for (const n of nodes) { frag.append(n); lastNode = n; }
    r.insertNode(frag);
    const sel = window.getSelection(), after = document.createRange();
    after.setStartAfter(lastNode); after.collapse(true);
    sel.removeAllRanges(); sel.addRange(after);
    saveRange();
  }
  const insertPill = (ctx, range) => insertNodes([pillNode(ctx, false), document.createTextNode(" ")], range);

  // --- @ mentions ---

  function checkMention() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return closePopup();
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== 3 || !input.contains(node)) return closePopup();
    const before = node.data.slice(0, r.startOffset);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) return closePopup();
    if (!S.files.length) post({ type: "files" });
    S.popup = { node, start: r.startOffset - m[1].length - 1, end: r.startOffset, query: m[1], index: 0, items: [] };
    renderPopup();
  }

  function score(path, q) {
    if (!q) return 1;
    const p = path.toLowerCase(), b = base(p), ql = q.toLowerCase();
    if (b.startsWith(ql)) return 100 - b.length / 100;
    if (b.includes(ql)) return 80 - b.length / 100;
    if (p.includes(ql)) return 60 - p.length / 1000;
    let j = 0; for (const ch of p) if (ch === ql[j]) j++;           // letters in order ("mnpy" → main.py)
    return j === ql.length ? 20 - p.length / 1000 : 0;
  }

  function renderPopup() {
    const P = S.popup;
    if (!P) return;
    P.items = S.files.map((f) => [score(f, P.query), f]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 12).map((x) => x[1]);
    P.index = Math.min(P.index, Math.max(0, P.items.length - 1));
    popupEl.classList.remove("hidden");
    const rows = P.items.length
      ? P.items.map((f, i) => el("div", { class: `pop-item ${i === P.index ? "sel" : ""}`, onmousedown: (e) => { e.preventDefault(); P.index = i; pickMention(); } },
        el("span", { class: "pop-name" }, base(f)), el("span", { class: "pop-dir" }, dir(f))))
      : [el("div", { class: "pop-empty" }, S.files.length ? "No matching files" : "Loading files…")];
    popupEl.replaceChildren(...rows);
  }

  function pickMention() {
    const P = S.popup;
    if (!P || !P.items.length) return;
    const file = P.items[P.index];
    const r = document.createRange();
    r.setStart(P.node, Math.max(0, P.start)); r.setEnd(P.node, Math.min(P.node.data.length, P.end));
    closePopup();
    insertPill({ kind: "file", path: file }, r);
  }
  function closePopup() { S.popup = null; popupEl.classList.add("hidden"); }

  input.addEventListener("input", () => { checkMention(); });
  input.addEventListener("keydown", (e) => {
    const P = S.popup;
    if (P) {
      if (e.key === "ArrowDown") { e.preventDefault(); P.index = Math.min(P.items.length - 1, P.index + 1); renderPopup(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); P.index = Math.max(0, P.index - 1); renderPopup(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(); return; }
      if (e.key === "Escape") { e.preventDefault(); closePopup(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendOrStop(); }
    else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertText", false, "\n"); }
    else if (e.key === "Escape" && S.tab && S.tab.status !== "idle") post({ type: "stop", tabId: S.tab.id });
  });
  // Pasting code copied from the editor turns it into a "main.py (L3-9)" reference.
  let pasteRange = null;
  input.addEventListener("paste", (e) => {
    // A screenshot or copied file: attach it.
    const files = [...(e.clipboardData.files || [])];
    if (files.length) { e.preventDefault(); attachFiles(files); return; }
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    pasteRange = caretRange().cloneRange();
    post({ type: "paste", text });
  });

  // Files dropped on the chat or pasted: read them here and hand them to Kural.
  function attachFiles(files) {
    for (const f of files) {
      if (f.size > 40 * 1024 * 1024) { post({ type: "log", message: `skipped ${f.name}: too big to drop (use the + button)` }); continue; }
      const r = new FileReader();
      r.onload = () => {
        const name = f.name && f.name !== "image.png" ? f.name : `screenshot-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.png`;
        post({ type: "attachData", tabId: S.tab && S.tab.id, name, data: String(r.result).split(",")[1] || "" });
      };
      r.readAsDataURL(f);
    }
  }
  const dropTarget = document.body;
  // (Drags from the editor's own file explorer reach here when you hold Shift. Files from Finder or another
  // file manager can't: VS Code blocks those from web pages like this chat, so use + or paste instead.)
  dropTarget.addEventListener("dragover", (e) => {
    e.preventDefault();
    const ok = e.dataTransfer.effectAllowed || "all";
    e.dataTransfer.dropEffect = /copy|all/i.test(ok) ? "copy" : /move/i.test(ok) ? "move" : "link";
    composer.classList.add("drop");
  });
  dropTarget.addEventListener("dragleave", (e) => { if (!e.relatedTarget || !document.body.contains(e.relatedTarget)) composer.classList.remove("drop"); });
  dropTarget.addEventListener("drop", (e) => {
    e.preventDefault();
    composer.classList.remove("drop");
    const dt = e.dataTransfer;
    // From VS Code's file explorer: a list of file URIs. From your computer: the files themselves.
    const uriList = dt.getData("application/vnd.code.uri-list") || dt.getData("text/uri-list");
    const uris = uriList ? uriList.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")) : [];
    try { const res = JSON.parse(dt.getData("resourceurls") || "[]"); for (const u of res) if (!uris.includes(u)) uris.push(u); } catch { /* not from the explorer */ }
    if (uris.length) post({ type: "attachUris", tabId: S.tab && S.tab.id, uris });
    else if (dt.files && dt.files.length) attachFiles([...dt.files]);
  });

  // ---------- menus ----------
  function openMenu(kind, anchor) {
    if (S.menu === kind) return closeMenu();
    S.menu = kind;
    const t = S.tab;
    let items;
    menuEl.classList.toggle("wide", kind === "ticket");
    if (kind === "add") {
      const jira = (S.setups[t.id] || {}).jira || { ok: true };
      items = [
        el("div", { class: "mi", onclick: () => { closeMenu(); post({ type: "attachPick" }); } },
          el("span", { class: "mi-icon" }, "📎"), el("span", { class: "mi-label" }, "Add files"), el("span", { class: "mi-hint" }, "images, PDFs, code")),
        el("div", { class: "mi", title: jira.ok ? "" : jira.why, onclick: () => { closeMenu(); S.ticketUI = null; openMenu("ticket", anchor); } },
          el("span", { class: "mi-icon" }, "🎫"), el("span", { class: "mi-label" }, t.ticket ? "Change ticket" : "Link ticket"),
          jira.ok ? el("span", { class: "mi-hint" }, "Jira epic, story, task…") : el("span", { class: "mi-hint warn-tri" }, "⚠ Atlassian not connected"))];
    } else if (kind === "ticket") {
      items = ticketItems(t);
    } else if (kind === "mode") {
      items = [el("div", { class: "mh" }, "Mode", el("span", { class: "mh-key" }, keys("Control+P plan"))), ...S.modes.map((md) =>
        el("div", { class: `mi ${t.mode === md.id ? "on" : ""}`, onclick: () => { post({ type: "setMode", tabId: t.id, mode: md.id }); closeMenu(); } },
          el("span", { class: `mode-dot m-${md.id}` }), el("span", { class: "mi-label" }, md.label), el("span", { class: "mi-hint" }, md.hint)))];
    } else {
      const teamOn = !!t.team;
      const editing = t.mode === "agent" || t.mode === "auto";
      items = [el("div", { class: "mh" }, "Model"), ...S.models.map((m) =>
        el("div", { class: `mi ${t.model === m.id ? "on" : ""}`, onclick: () => { post({ type: "setModel", tabId: t.id, model: m.id }); closeMenu(); } },
          el("span", { class: `check radio${t.model === m.id ? " on" : ""}` }),
          el("span", { class: "mi-label" }, m.label), el("span", { class: "mi-hint" }, m.hint))),
        ...localMenuItems(t),
        el("div", { class: "mh" }, "Intensity", el("span", { class: "mh-key" }, keys("Control+M / H / O"))),
        el("div", { class: "seg" }, S.efforts.map((e) => el("button", { class: t.effort === e.id ? "on" : "", onclick: () => post({ type: "setEffort", tabId: t.id, effort: e.id }) }, e.label))),
        el("div", { class: "mh" }, "Mood"),
        el("div", { class: "seg mood" }, S.moods.map((md) => el("button", { class: t.mood === md.id ? "on" : "", title: md.hint, onclick: () => post({ type: "setMood", tabId: t.id, mood: md.id }) }, md.label))),
        el("div", { class: "sep" }),
        el("div", { class: "mi toggle-row", onclick: () => post({ type: "setTeam", tabId: t.id, team: teamOn ? 0 : (S.teamSizes[1] || 3) }) },
          el("div", { class: "tr-text" },
            el("div", { class: "mi-label" }, "Multiple agents"),
            el("div", { class: "tr-hint" }, teamOn ? teamHint(t) : "Split a task across agents, or let them discuss and decide")),
          el("span", { class: `switch ${teamOn ? "on" : ""}` }, el("span"))),
        teamOn ? el("div", { class: "seg team" }, S.teamStyles.map((st) => el("button", { class: t.teamStyle === st.id ? "on" : "", title: st.hint, onclick: () => post({ type: "setTeamStyle", tabId: t.id, style: st.id }) }, st.label))) : null,
        teamOn ? el("div", { class: "roles" }, el("span", { class: "roles-h" }, "Roles"),
          S.roles.map((r) => el("button", { class: `role ${(t.roles || []).includes(r.id) ? "on" : ""}`, title: r.desc, onclick: () => post({ type: "toggleRole", tabId: t.id, role: r.id }) }, r.label))) : null,
        teamOn && !(t.roles || []).length ? el("div", { class: "seg team" }, S.teamSizes.map((n) => el("button", { class: t.team === n ? "on" : "", onclick: () => post({ type: "setTeam", tabId: t.id, team: n }) }, `${n} agents`))) : null,
        ...setupItems(t)];
    }
    menuEl.replaceChildren(...items.filter(Boolean));
    menuEl.classList.remove("hidden");
    const a = anchor.getBoundingClientRect();
    menuEl.style.left = Math.max(6, Math.min(a.left, window.innerWidth - menuEl.offsetWidth - 6)) + "px";
    menuEl.style.bottom = (window.innerHeight - a.top + 6) + "px";
    openMenu.anchor = anchor;
    if (kind === "ticket" && S.ticketUI) S.ticketUI.input.focus();   // keep typing after the list updates
  }
  // ---------- models on this computer (Ollama) ----------
  // In the model menu: the installed models that can chat (they need tools), and the way to get more.
  function localMenuItems(t) {
    // Ask Ollama again when the menu opens (models come and go); the menu redraws when the answer comes.
    // (At most every few seconds: the redraw itself calls this again.)
    if (!S.localAskedAt || Date.now() - S.localAskedAt > 3000) { S.localAskedAt = Date.now(); post({ type: "localModels" }); }
    const L = S.local;
    const out = [el("div", { class: "mh" }, "On this computer", el("span", { class: "mh-key" }, "Ollama · offline"))];
    if (!L) out.push(el("div", { class: "mi dim" }, el("span", { class: "mi-hint" }, "Looking for Ollama…")));
    else if (!L.status.running) out.push(el("div", { class: "mi", onclick: () => { post({ type: "installOllama" }); closeMenu(); } },
      el("span", { class: "mi-icon" }, "⬇"), el("span", { class: "mi-label" }, "Get Ollama"), el("span", { class: "mi-hint" }, "to run models on this computer")));
    else if (!L.status.ok) out.push(el("div", { class: "mi dim" }, el("span", { class: "mi-hint warn-tri" }, `⚠ Ollama ${L.status.version} is too old for the chat; update to ${L.minVersion} or newer`)));
    else for (const m of L.models.filter((x) => x.chat)) {
      const id = `ollama:${m.name}`;
      out.push(el("div", { class: `mi ${t.model === id ? "on" : ""}`, onclick: () => { post({ type: "setModel", tabId: t.id, model: id }); closeMenu(); } },
        el("span", { class: `check radio${t.model === id ? " on" : ""}` }), el("span", { class: "mi-label" }, m.name), el("span", { class: "mi-hint" }, [m.params, gb(m.size)].filter(Boolean).join(" · "))));
    }
    out.push(el("div", { class: "mi", onclick: () => { closeMenu(); openLocal(); } },
      el("span", { class: "mi-icon" }, "🔍"), el("span", { class: "mi-label" }, "Find & download models…")));
    return out;
  }

  // The "Local models" page (in the chat panel, like History).
  function openLocal() {
    closeHistory(); S.showLocal = true;
    post({ type: "localModels" });
    if (!S.localSearch) post({ type: "localSearch", q: "" });
    renderLocal();
  }
  function closeLocal() { S.showLocal = false; S.confirmDeleteModel = null; localEl.classList.add("hidden"); listEl.classList.remove("hidden"); }

  function renderLocal() {
    if (!S.showLocal) return;
    listEl.classList.add("hidden"); historyEl.classList.add("hidden"); localEl.classList.remove("hidden");
    const L = S.local, R = S.localSearch;
    const t = S.tab;
    const pulls = (L && L.pulls) || {};
    const memory = L ? L.memory : 0;
    const search = el("input", { class: "h-search", placeholder: "Search Ollama's models (ones that can use tools)…", value: S.localQuery || "",
      onkeydown: (e) => { if (e.key === "Enter") { S.localQuery = e.target.value; S.localSearching = true; post({ type: "localSearch", q: e.target.value }); renderLocal(); } else if (e.key === "Escape") closeLocal(); } });
    const kids = [
      el("div", { class: "h-head" }, el("span", { class: "h-title" }, "Models on this computer"), el("span", { class: "spacer" }), el("button", { class: "cb", onclick: () => closeLocal() }, "Back")),
      el("div", { class: "lm-note" }, "They run on your computer with Ollama: private, free, and they work offline. Slower and less capable than Claude; bigger ones need more memory",
        memory ? ` (this computer has ${memory} GB).` : "."),
    ];
    if (!L) kids.push(el("div", { class: "h-empty" }, "Looking for Ollama…"));
    else if (!L.status.running) kids.push(el("div", { class: "lm-warn" }, "Ollama isn't running. ", el("button", { class: "cb primary", onclick: () => post({ type: "installOllama" }) }, "Get Ollama"),
      el("button", { class: "cb", onclick: () => post({ type: "localModels" }) }, "Check again")));
    else if (!L.status.ok) kids.push(el("div", { class: "lm-warn" }, `⚠ Your Ollama is ${L.status.version}. The chat needs ${L.minVersion} or newer: update Ollama.`));
    // Downloads in progress
    for (const [name, p] of Object.entries(pulls)) kids.push(el("div", { class: "lm-pull" },
      el("div", { class: "lm-row" }, el("span", { class: "lm-name" }, name), el("span", { class: "spacer" }), el("span", { class: "h-when" }, `${p.percent || 0}%`)),
      el("div", { class: "bar" }, el("span", { style: `width:${p.percent || 0}%` }))));
    // Installed
    if (L && L.models.length) {
      kids.push(el("div", { class: "h-group" }, "Installed"));
      for (const m of L.models) {
        const id = `ollama:${m.name}`, using = t && t.model === id, confirming = S.confirmDeleteModel === m.name;
        kids.push(el("div", { class: "lm-item" },
          el("div", { class: "lm-row" }, el("span", { class: "lm-name" }, m.name), el("span", { class: "spacer" }),
            m.chat ? el("button", { class: `cb ${using ? "" : "primary"}`, disabled: using ? "" : null, onclick: () => { post({ type: "setModel", tabId: t.id, model: id }); closeLocal(); } }, using ? "In use" : "Use in chat") : null,
            confirming ? el("button", { class: "cb danger", onclick: () => { S.confirmDeleteModel = null; post({ type: "localDelete", name: m.name }); } }, "Delete?")
              : el("button", { class: "icon-btn small show", title: "Delete from this computer", onclick: () => { S.confirmDeleteModel = m.name; renderLocal(); } }, icon("trash"))),
          el("div", { class: "h-meta" }, [m.params, gb(m.size), m.chat ? "can chat" : "can't chat (no tools)"].filter(Boolean).join(" · "))));
      }
    }
    // Search
    kids.push(el("div", { class: "h-group" }, "Get more"), search);
    if (S.localSearching) kids.push(el("div", { class: "h-empty" }, "Searching…"));
    else if (R) {
      if (R.from === "suggested") kids.push(el("div", { class: "lm-note" }, "Couldn't reach ollama.com, so these are Kural's suggestions."));
      if (!R.results.length) kids.push(el("div", { class: "h-empty" }, "No models found."));
      for (const m of R.results) {
        const local = m.sizes.length ? m.sizes : [];
        kids.push(el("div", { class: "lm-item" },
          el("div", { class: "lm-row" }, el("span", { class: "lm-name" }, m.name), el("span", { class: "spacer" }), m.pulls ? el("span", { class: "h-when" }, `${m.pulls} pulls`) : null),
          m.description ? el("div", { class: "lm-desc" }, m.description) : null,
          el("div", { class: "lm-sizes" },
            ...m.capabilities.filter((c) => c !== "cloud").map((c) => el("span", { class: "lm-cap" }, c)),
            ...(local.length ? local.map((z) => {
              const name = `${m.name}:${z.size}`, have = L && L.models.some((x) => x.name === name), busy = !!pulls[name];
              const tooBig = memory && z.memory && z.memory > memory;
              return el("button", { class: `cb lm-size ${tooBig ? "danger" : ""}`, disabled: have || busy ? "" : null,
                title: have ? "Already on this computer" : `Download ${name}${z.memory ? `; needs about ${z.memory} GB of memory` : ""}${tooBig ? ` (this computer has ${memory} GB: too big)` : ""}`,
                onclick: () => post({ type: "localPull", name }) }, have ? `✓ ${z.size}` : `⬇ ${z.size}${z.memory ? ` · ~${z.memory} GB` : ""}`);
            }) : [el("span", { class: "lm-cap" }, "cloud only (not offline)")]))));
      }
    }
    localEl.replaceChildren(...kids.filter(Boolean));
  }

  // "Rachel (Developer) and Ross (Critic) talk it through and agree on a decision."
  function teamHint(t) {
    const roles = t.roles || [];
    const n = roles.length ? Math.max(2, roles.length) : t.team;
    const names = FRIENDS.slice(0, n).map((f, i) => roles[i] ? `${f} (${roleLabel(roles[i])})` : f);
    const list = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(" and ");
    const editing = t.mode === "agent" || t.mode === "auto";
    if (t.teamStyle === "discuss") return `${list} talk it through and agree on a decision (any mode)`;
    return `${list} split the work, run at the same time and message each other${editing ? "" : " (Agent and Auto modes)"}`;
  }

  // "+ → Link ticket": search Jira (through your Atlassian connector) and link one ticket to this chat.
  function ticketItems(t) {
    const jira = (S.setups[t.id] || {}).jira || { ok: true };
    if (!S.ticketUI) {
      S.ticketUI = { query: "", id: 0, searching: false, issues: null, note: "", error: "" };
      S.ticketUI.input = el("input", { class: "ticket-q", placeholder: "Key (PROJ-123) or words, then Enter", spellcheck: "false" });
      S.ticketUI.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ticketSearch(S.ticketUI.input.value); } });
      if (jira.ok) setTimeout(() => { ticketSearch(""); S.ticketUI && S.ticketUI.input.focus(); }, 0);   // start with your recent tickets
    }
    const U = S.ticketUI;
    const out = [el("div", { class: "mh" }, "Link a Jira ticket to this chat")];
    if (!jira.ok) {
      out.push(el("div", { class: "ticket-warn" }, el("span", { class: "warn-tri" }, "⚠ "), jira.why));
      return out;
    }
    out.push(el("div", { class: "ticket-search" }, U.input));
    if (U.searching) out.push(el("div", { class: "ticket-status" }, el("span", { class: "dots small" }, el("span"), el("span"), el("span")),
      " ", U.status || (U.query ? `Searching Jira for “${U.query}”…` : "Getting your recent tickets…")));
    else if (U.error) out.push(el("div", { class: "ticket-warn" }, el("span", { class: "warn-tri" }, "⚠ "), U.error));
    else if (U.issues && !U.issues.length) out.push(el("div", { class: "ticket-status" }, U.note || "No tickets found. Try other words or the ticket's key."));
    for (const i of (!U.searching && U.issues) || []) out.push(el("div", { class: `mi ticket-row${t.ticket && t.ticket.key === i.key ? " on" : ""}`, title: i.summary,
      onclick: () => { post({ type: "linkTicket", tabId: t.id, ticket: i }); closeMenu(); input.focus(); } },
      el("span", { class: "ticket-key" }, i.key), i.type ? el("span", { class: "ticket-type" }, i.type) : null,
      el("span", { class: "ticket-sum" }, i.summary), i.status ? el("span", { class: "mi-hint" }, i.status) : null));
    if (t.ticket) out.push(el("div", { class: "sep" }), el("div", { class: "mi", onclick: () => { post({ type: "linkTicket", tabId: t.id, ticket: null }); closeMenu(); } },
      el("span", { class: "mi-icon" }, "✕"), el("span", { class: "mi-label" }, `Unlink ${t.ticket.key}`)));
    return out;
  }
  function ticketSearch(q) {
    const U = S.ticketUI; if (!U) return;
    U.query = q.trim(); U.id = Date.now(); U.searching = true; U.error = ""; U.note = ""; U.status = "";
    post({ type: "ticketSearch", tabId: S.tab.id, query: U.query, id: U.id });
    if (S.menu === "ticket") openMenu.refresh();
  }

  // What this chat's Claude has from your Claude Code setup (connectors, plugins, skills), with Reload.
  function setupItems(t) {
    const st = S.setups[t.id];
    const head = el("div", { class: "mh" }, "Your Claude Code setup",
      el("button", { class: "mh-btn", title: "Reload connectors, MCP servers, plugins and skills (same conversation)", onclick: (e) => { e.stopPropagation(); post({ type: "reloadSetup", tabId: t.id }); } }, "↻ Reload"));
    if (st && !st.full) return [el("div", { class: "sep" }), head,
      el("div", { class: "setup-row" }, "Fast minimal setup: no connectors or plugins. ",
        el("button", { class: "cb primary", onclick: () => post({ type: "useFullSetup", on: true }) }, "Use my full setup"))];
    if (!st) return [el("div", { class: "sep" }), head, el("div", { class: "setup-row q-muted" }, "Loads with your first message.")];
    // One short line ("10 connectors · 3 need attention · 30 skills"); click it to see each connector.
    const n = st.servers.length, bad = st.servers.filter((x) => x.status !== "connected").length;
    const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
    const summary = [n ? plural(n, "connector") : "no connectors", bad ? `${bad} need${bad === 1 ? "s" : ""} attention` : "",
      st.plugins.length ? plural(st.plugins.length, "plugin") : "", st.skills ? plural(st.skills, "skill") : ""].filter(Boolean).join(" · ");
    const line = el("div", { class: `setup-row setup-sum${S.setupOpen ? " open" : ""}`, title: n ? "Show connectors" : "",
      onclick: (e) => { e.stopPropagation(); if (!n) return; S.setupOpen = !S.setupOpen; openMenu.refresh(); } },
      n ? el("span", { class: "think-caret" }) : null, bad ? el("span", { class: "warn-tri", title: "Some connectors aren't connected" }, "⚠") : null, summary);
    const servers = S.setupOpen && n ? el("div", { class: "setup-row" }, ...st.servers.map((x) =>
      el("span", { class: `srv ${x.status === "connected" ? "ok" : "bad"}`, title: x.status }, x.name))) : null;
    return [el("div", { class: "sep" }), head, line, servers];
  }
  openMenu.refresh = () => { const k = S.menu; S.menu = null; if (k) openMenu(k, openMenu.anchor); };
  function closeMenu() { S.menu = null; menuEl.classList.add("hidden"); }
  // Clicking outside the panel (in the editor) or pressing Esc closes menus and the @ list.
  window.addEventListener("blur", () => { closeMenu(); closePopup(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.menu) { e.preventDefault(); closeMenu(); input.focus(); return; }
    if (e.key === "Escape" && S.showHistory) { e.preventDefault(); closeHistory(); input.focus(); return; }
    // Tab shortcuts work while you're typing in the chat, too.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && (e.key === "n" || e.key === "N")) { e.preventDefault(); S.focusNext = true; post({ type: "newTab" }); }
    else if (mod && e.key === "PageDown") { e.preventDefault(); cycleTab(1); }
    else if (mod && e.key === "PageUp") { e.preventDefault(); cycleTab(-1); }
  });
  function cycleTab(d) {
    const i = S.tabs.findIndex((t) => t.id === S.activeId);
    if (i >= 0 && S.tabs.length > 1) { S.focusNext = true; post({ type: "switchTab", id: S.tabs[(i + d + S.tabs.length) % S.tabs.length].id }); }
  }
  document.addEventListener("mousedown", (e) => {
    if (S.menu && !menuEl.contains(e.target) && !modeBtn.contains(e.target) && !modelBtn.contains(e.target) && !attachBtn.contains(e.target)) closeMenu();
  });
  listEl.addEventListener("click", (e) => {
    const r = e.target.closest && e.target.closest("code.ref");
    if (r) post({ type: "openFile", path: r.dataset.path, line: +r.dataset.line || undefined });
  });

  // ---------- messages from the extension ----------
  const lastAssistant = () => { const m = S.tab && S.tab.messages; return m && m.length && m[m.length - 1].role === "assistant" ? m.length - 1 : -1; };
  let pending = null;
  const scheduleRerender = (i) => { if (pending === null) { pending = i; requestAnimationFrame(() => { const k = pending; pending = null; if (S.tab && S.tab.messages[k]) rerender(k); }); } };
  const findAgent = (id) => { const i = lastAssistant(); return i >= 0 ? [i, S.tab.messages[i].blocks.find((b) => b.k === "agent" && b.id === id)] : [i, null]; };

  window.addEventListener("message", (ev) => {
    const m = ev.data;
    const mine = S.tab && m.tabId === S.tab.id;
    if (m.type === "fontScale") { setFs(m.value); return; }
    switch (m.type) {
      case "config":
        S.models = m.models; S.efforts = m.efforts; S.modes = m.modes; S.teamSizes = m.teamSizes || S.teamSizes; S.version = m.version || "";
        S.moods = m.moods || []; S.roles = m.roles || []; S.teamStyles = m.teamStyles || [];
        renderFoot(); if (S.tab && !S.tab.messages.length) renderAll(); break;
      case "tabs":
        S.tabs = m.tabs; S.activeId = m.activeId;
        if (S.tab) { const s = m.tabs.find((x) => x.id === S.tab.id); if (s) Object.assign(S.tab, { status: s.status, model: s.model, effort: s.effort, mode: s.mode, title: s.title, team: s.team,
          mood: s.mood, roles: s.roles, teamStyle: s.teamStyle, teamSize: s.teamSize, ticket: s.ticket }); }
        renderTabs(); renderFoot(); renderChips(); if (S.menu) openMenu.refresh();
        if (S.tab) { const i = lastAssistant(); if (i >= 0 && S.tab.messages[i].planReady) rerender(i); }
        break;
      case "full": S.tab = m.tab; renderAll(); if (S.menu) closeMenu(); if (S.focusNext) { S.focusNext = false; input.focus(); } break;
      case "history": S.history = m.items; S.hereName = m.here || ""; renderHistory(); break;
      case "localModels": S.local = m; renderLocal(); if (S.menu === "model") openMenu.refresh(); break;
      case "localSearch": S.localSearch = m; S.localSearching = false; renderLocal(); break;
      case "localPull": if (S.local) { S.local.pulls = { ...(S.local.pulls || {}), [m.name]: { percent: m.percent, status: m.status } }; renderLocal(); } break;
      case "ticketStatus": { const U = S.ticketUI; if (U && U.id === m.id && U.searching) { U.status = m.text; if (S.menu === "ticket") openMenu.refresh(); } break; }
      case "ticketResults": {
        const U = S.ticketUI;
        if (!U || U.id !== m.id) break;            // an older search
        U.searching = false; U.issues = m.issues || []; U.note = m.note || ""; U.error = m.error || "";
        if (S.menu === "ticket") openMenu.refresh();
        break;
      }
      case "showHistory": openHistory(); break;
      case "modelName": if (mine) { S.tab.modelName = m.name; renderFoot(); } break;
      case "append": if (mine) { for (const x of m.msgs) S.tab.messages.push(x); renderAll(); } break;
      case "delta": if (mine) {
        const i = lastAssistant(); if (i < 0) break;
        const msg = S.tab.messages[i];
        let b = msg.blocks[msg.blocks.length - 1];
        if (!b || b.k !== "text") { b = { k: "text", text: "" }; msg.blocks.push(b); }
        b.text += m.text; scheduleRerender(i);
      } break;
      case "block": if (mine) { const i = lastAssistant(); if (i >= 0) { S.tab.messages[i].blocks.push(m.block); scheduleRerender(i); } } break;
      case "thinkDelta": if (mine) {
        const i = lastAssistant(); if (i < 0) break;
        const blocks = S.tab.messages[i].blocks, b = blocks[blocks.length - 1];
        if (b && b.k === "think") { b.text += m.text; scheduleRerender(i); }
      } break;
      case "agentActivity": if (mine) { const [i, a] = findAgent(m.agentId); if (a) { a.activity = m.activity; scheduleRerender(i); } } break;
      case "agentStep": if (mine) { const [i, a] = findAgent(m.agentId); if (a) { a.steps.push(m.step); scheduleRerender(i); } } break;
      case "agentState": if (mine) { const [i, a] = findAgent(m.agentId); if (a) { a.state = m.state; if (m.why) a.why = m.why; scheduleRerender(i); } } break;
      case "questionState": if (mine) { const i = lastAssistant(); if (i >= 0) { for (const b of S.tab.messages[i].blocks) if (b.pid === m.pid) { b.state = m.state; b.answers = m.answers; } scheduleRerender(i); } } break;
      case "permState": if (mine) { const i = lastAssistant(); if (i >= 0) { for (const b of S.tab.messages[i].blocks) if (b.pid === m.pid) b.state = m.state; scheduleRerender(i); } } break;
      case "patch": if (mine) { const i = m.index != null ? m.index : lastAssistant(); if (i >= 0) { Object.assign(S.tab.messages[i], m.msg); rerender(i); } renderFoot(); } break;
      case "allowAll": break;
      case "activeFile": S.activeFile = m.file; S.includeActive = true; renderChips(); break;
      case "files": S.files = m.files; if (S.popup) renderPopup(); break;
      case "insertPill": closeHistory(); insertPill(m.ctx); break;
      case "pasted":
        if (m.ctx) insertPill(m.ctx, pasteRange);
        else { input.focus(); if (pasteRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(pasteRange); } document.execCommand("insertText", false, m.text); }
        pasteRange = null; break;
      case "focus": input.focus(); break;
      case "setup": S.setups[m.tabId] = m.setup; if (S.menu === "model") openMenu.refresh(); break;
      case "attached": S.attachments.push(...m.items); renderChips(); input.focus(); break;
      case "userAttachments": if (mine) {
        for (let i = S.tab.messages.length - 1; i >= 0; i--) if (S.tab.messages[i].role === "user") { S.tab.messages[i].attachments = m.attachments; scheduleRerender(i); break; }
      } break;
      case "flash": {   // a shortcut changed the model / intensity / mode: say so briefly
        let f = document.querySelector(".flash");
        if (!f) { f = el("div", { class: "flash" }); document.body.append(f); }
        f.textContent = m.text; f.classList.add("on");
        clearTimeout(S.flashTimer); S.flashTimer = setTimeout(() => f.classList.remove("on"), 1300);
        break;
      }
    }
  });

  renderTabs(); renderAll(); renderChips();
  post({ type: "ready" });
})();
