// The Projects tab's page (lib/projects/index.js): every project with a Kural window, the pinned ones and the recent ones,
// and under a project each of its chats with what it is doing. The look (Adithya, 25 Oct 2026: design A "Folders" of
// docs/mockups/projects-bar/projects-bar-v3a.html, like ChatGPT's project list; then the Pinned / Open / Recent headings
// back, so you can tell them apart): a folder per project with its chats under it, no cards, letter tiles or second lines;
// a chat's news is a mark at its end (spinner, orange dot, blue dot). It only draws what the host sends ({type: "model"},
// {type: "find"}, {type: "rename"}) and posts clicks: open, openChat, pin, close, removeRecent, search, fold, renameChat,
// moveChat (a chat dragged onto another project), historyFold, openHistory (a saved chat of the project's History). The right-click menus are package.json's "webview/context", fed
// by each row's data-vscode-context. The host knows what a click means (the page sends keys and ids only).
// Nothing is built from HTML text: everything is made with el().
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.lineno})` }));
  const post = (m) => vscode.postMessage(m);

  const saved = vscode.getState() || {};
  const SHOWN = 5;              // chats a project shows before "Show N more"
  const HIST_SHOWN = 10, HIST_STEP = 20;   // History rows shown first, and added by each "Show N more"
  const S = {
    model: null,              // { sections, badge, query, folded } from the host
    folded: new Set(),        // project keys you folded (the host keeps them)
    more: new Set(),          // projects whose every chat you asked to see (this page only)
    hist: new Map(),          // project key -> History rows shown (this page only)
    q: saved.q || "",
    findOpen: !!saved.q,      // the search box (the title bar's search button opens it)
    renaming: null,           // {key, chatId}: that chat's title is a box
    drag: null,               // {key, chatId}: the chat being dragged
    later: false,             // the host sent news while you renamed or dragged: drawn once you're done
  };
  // The right-click menu's context (package.json "webview/context"); VS Code's Cut/Copy/Paste are left out.
  const menu = (o) => JSON.stringify({ preventDefaultContextMenuItems: true, ...o });
  const busy = (c) => c.state === "run" || c.state === "ask";

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
  const icon = (name, extra) => el("i", { class: `codicon codicon-${name}${extra ? " " + extra : ""}`, "aria-hidden": "true" });

  // ---------- the search box (never redrawn; hidden until the title bar's search button or a query opens it) ----------
  const input = el("input", { class: "q", type: "text", spellcheck: "false", placeholder: "Find a project or chat", "aria-label": "Find a project or chat" });
  input.value = S.q;
  const closeBtn = el("button", { class: "tbtn x", type: "button", title: "Close", "aria-label": "Close the search",
    onclick: () => closeFind() }, icon("close"));
  const find = el("div", { class: "find" }, el("div", { class: "box" }, icon("search"), input, closeBtn));
  const list = el("div", { class: "plist", role: "tree", "aria-label": "Projects" });
  app.append(find, list);
  const showFind = () => { find.className = S.findOpen ? "find" : "find hidden"; };
  showFind();

  let typing = null;
  const search = () => { S.q = input.value; vscode.setState({ q: S.q }); post({ type: "search", q: S.q }); };
  // Closing clears what was typed, so the whole list comes back.
  function closeFind() {
    clearTimeout(typing);
    if (input.value) { input.value = ""; search(); }
    S.findOpen = false; showFind();
  }
  input.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(search, 120); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFind(); });

  // ---------- pieces ----------
  const query = () => String((S.model && S.model.query) || "").trim();
  // The text with what you searched for marked (any case), as text nodes and <mark>s.
  function marked(text) {
    const q = query().toLowerCase();
    if (!q) return text;
    const out = [], low = text.toLowerCase();
    let at = 0, i;
    while ((i = low.indexOf(q, at)) !== -1) {
      if (i > at) out.push(text.slice(at, i));
      out.push(el("mark", {}, text.slice(i, i + q.length)));
      at = i + q.length;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  }
  // working: spinner; waiting for you: orange dot; finished, not seen: blue dot; else nothing
  function stateMark(state) {
    if (state === "run") return icon("loading", "spin");
    if (state === "ask") return el("span", { class: "needs", title: "Waiting for you" });
    if (state === "done") return el("span", { class: "dot-new", title: "New answer" });
    return null;
  }
  // A button on a row: it never opens the row.
  function rowButton(cls, title, name, fn) {
    return el("button", { class: `tbtn ${cls}`, type: "button", title, "aria-label": title,
      onclick: (e) => { e.stopPropagation(); fn(); } }, icon(name));
  }

  // A chat dragged onto a project: its row, its chats or its History (the whole group) takes it. Another project only;
  // one without a window only when it is a folder (the host decides the rest). Only the project's own row was a target
  // before, and a drop on its chats did nothing (Adithya, 27 Oct 2026: "drag and drop doesn't work").
  function dropTarget(node, p) {
    const takes = () => S.drag && (p.open || !p.workspaceFile) && p.key !== S.drag.key;
    node.addEventListener("dragover", (e) => {
      if (!takes()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      node.classList.add("drop");
    });
    node.addEventListener("dragleave", (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove("drop"); });
    node.addEventListener("drop", (e) => {
      node.classList.remove("drop");
      if (!takes()) return;
      e.preventDefault();
      post({ type: "moveChat", key: S.drag.key, chatId: S.drag.chatId, to: p.key });
    });
    return node;
  }

  // A project's color: one of eight (pc0..pc7 in projects.css), the same one every time for the same project.
  const PALETTE = 8;
  const hue = (key) => { let h = 0; for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % PALETTE; };

  function projectRow(p, showing) {
    const folded = S.folded.has(p.key) && !query(), chats = p.chats || [];
    const row = el("div", { class: `row pc${hue(p.key)}${p.here ? " cur" : ""}${p.open ? "" : " recent"}`, role: "treeitem", tabindex: "0",
      title: [p.shortPath || p.path || "", p.news && p.news.text].filter(Boolean).join("\n"),
      "data-key": p.key, "aria-expanded": String(!folded),
      "data-vscode-context": menu({ webviewSection: "project", key: p.key, projectOpen: !!p.open, projectPinned: !!p.pinned }),
      onclick: () => post({ type: "open", key: p.key }),
      onkeydown: (e) => { if (e.key === "Enter") post({ type: "open", key: p.key }); } });
    // The folder: open while it is unfolded (its chats and History show). It is the fold button (an arrow under the pointer).
    const folder = icon(showing ? "folder-opened" : "folder");
    const fic = el("button", { class: `fic${folded ? " folded" : ""}`, type: "button", tabindex: "-1", "aria-label": folded ? "Unfold" : "Fold",
      onclick: (e) => { e.stopPropagation(); fold(p.key, !folded); } }, folder, icon(folded ? "chevron-right" : "chevron-down", "arrow"));
    const end = el("div", { class: "end" });
    // (A folded project carries what its chats would show.)
    if (folded) for (const st of ["run", "ask", "done"]) if (chats.some((c) => c.state === st)) end.append(stateMark(st));
    end.append(rowButton(`pin${p.pinned ? " on" : ""}`, p.pinned ? "Unpin" : "Pin", p.pinned ? "pinned" : "pin", () => post({ type: "pin", key: p.key })));
    // (Open: the red cross; Recent and not pinned: the red bin.)
    if (p.open) end.append(rowButton("red close-p", p.here ? "Close this project (and this window)" : "Close project", "close", () => post({ type: "close", key: p.key })));
    else if (!p.pinned) end.append(rowButton("red bin-p", "Remove from Recent", "trash", () => post({ type: "removeRecent", key: p.key })));
    row.append(fic, el("span", { class: "nmt" }, marked(p.name)), end);
    return row;
  }

  // (The row writes only the title; its tooltip adds the label, a waiting chat's question too, and why a working or waiting
  // chat can't be dragged.) A chat of a project with a window can be renamed (F2, or the menu) and dragged to another one.
  let renameInput = null;
  function chatRow(p, c) {
    const state = c.state || "idle", movable = p.open && !busy(c);
    const tip = [c.title, c.label, p.open && busy(c) ? "It can't be moved while it's working or waiting for you." : ""].filter(Boolean).join("\n");
    const editing = S.renaming && S.renaming.key === p.key && S.renaming.chatId === c.id;
    return el("div", { class: `chat-row ${state}${c.onScreen ? " cur-chat" : ""}`, role: "treeitem", tabindex: "0", title: editing ? null : tip,
      "data-chat": c.id, draggable: movable && !editing ? "true" : null,
      "data-vscode-context": menu({ webviewSection: "chat", key: p.key, chatId: c.id, projectOpen: !!p.open }),
      onclick: () => post({ type: "openChat", key: p.key, chatId: c.id }),
      onkeydown: (e) => {
        if (e.key === "Enter") post({ type: "openChat", key: p.key, chatId: c.id });
        else if (e.key === "F2" && p.open) { e.preventDefault(); rename(p.key, c.id); }
      },
      ondragstart: (e) => {
        S.drag = { key: p.key, chatId: c.id };
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.title); }
      },
      ondragend: () => { S.drag = null; S.later = false; draw(); },
      oncontextmenu: (e) => chatMenu(e, p, c.id, { open: true, busy: busy(c) }) },
    editing ? renameBox(p, c) : el("span", { class: "ct" }, marked(c.title)), el("span", { class: "st" }, stateMark(state)));
  }
  // The title as a box, like the Explorer's rename: Enter or leaving it saves, Escape cancels. The new title shows at once.
  function renameBox(p, c) {
    const box = el("input", { class: "rename", type: "text", spellcheck: "false", "aria-label": "Chat name" });
    box.value = c.title;
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const title = String(box.value || "").replace(/\s+/g, " ").trim();
      if (save && title && title !== c.title) { post({ type: "renameChat", key: p.key, chatId: c.id, title }); c.title = title; }
      S.renaming = null; S.later = false;
      draw();
    };
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    box.addEventListener("blur", () => finish(true));
    box.addEventListener("click", (e) => e.stopPropagation());
    renameInput = box;
    return box;
  }
  // Rename (F2 or the menu): the project unfolds and the chat comes out from behind "Show N more" first.
  function rename(key, chatId) {
    const p = ((S.model && S.model.sections) || []).flatMap((s) => s.projects || []).find((x) => x.key === key);
    if (!p || !p.open || !(p.chats || []).some((c) => c.id === chatId)) return;
    if (S.folded.has(key)) fold(key, false);
    if ((p.chats || []).findIndex((c) => c.id === chatId) >= SHOWN) S.more.add(key);
    S.renaming = { key, chatId };
    draw();
  }

  // ---------- the right-click menu of a chat (open, or in a project's History) ----------
  // Kural draws it (VS Code's menus can't list the open projects by name): Rename, Fork ›, Move to ›, Delete. Fork and Move
  // open the list of open projects under their row (below); a chat can be forked into its own project too, moved only to
  // another one. Escape, a click elsewhere or scrolling the projects closes it.
  let menuEl = null;
  function closeChatMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    if (S.later && !S.renaming && !S.drag) { S.later = false; draw(); }   // (what the host sent while it was open)
  }
  function openProjects() { return ((S.model && S.model.sections) || []).flatMap((x) => x.projects || []).filter((x) => x.open); }
  // The menu inside the page (the page can't draw outside itself): at (x, y), or kept where it is, moved in from the edges.
  function placeMenu(x, y) {
    const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    const left = x !== undefined ? x : parseFloat(menuEl.style.left) || 4, top = y !== undefined ? y : parseFloat(menuEl.style.top) || 4;
    menuEl.style.left = Math.max(4, Math.min(left, window.innerWidth - w - 4)) + "px";
    menuEl.style.top = Math.max(4, Math.min(top, window.innerHeight - h - 4)) + "px";
  }
  function chatMenu(e, p, chatId, { open, busy: working }) {
    e.preventDefault(); e.stopPropagation();   // (VS Code's own menu stays shut: the frame looks at defaultPrevented)
    closeChatMenu();
    const item = (label, fn, opts = {}) => el("div", { class: `cm-item${opts.red ? " red" : ""}${opts.off ? " off" : ""}`, role: "menuitem", tabindex: "-1",
      title: opts.title || null, onclick: (ev) => { ev.stopPropagation(); if (opts.off) return; closeChatMenu(); fn(); } },
    el("span", { class: "cm-label" }, label), opts.key ? el("span", { class: "cm-key" }, opts.key) : null);
    const target = (t, send) => el("div", { class: "cm-item", role: "menuitem", tabindex: "-1", title: t.shortPath || t.path || "",
      onclick: (ev) => { ev.stopPropagation(); closeChatMenu(); send(t.key); } },
    el("span", { class: "cm-label" }, t.name), t.here ? el("span", { class: "cm-key" }, "this window") : null);
    // Fork to and Move to open their projects in the menu itself, under the row, like a folder opening (Adithya, 27 Oct
    // 2026: the page can't draw outside itself, and a list beside the menu didn't fit the side bar). On hover after a
    // moment (passing over the row on the way to Delete opens nothing) or at once on a click; a click never closes it.
    // One is open at a time: when the one above closes, the menu moves down by as much, so the row under the pointer stays.
    let shown = null;
    const expand = (s) => {
      if (!menuEl || shown === s) return;
      const y0 = s.head.getBoundingClientRect().top;
      if (shown) shown.set(false);
      s.set(true); shown = s;
      const shift = y0 - s.head.getBoundingClientRect().top;
      if (shift) menuEl.style.top = (parseFloat(menuEl.style.top) || 0) + shift + "px";
      placeMenu();
    };
    const sub = (label, targets, send, why) => {
      const head = el("div", { class: `cm-item cm-sub${targets.length ? "" : " off"}`, role: "menuitem", "aria-expanded": "false", tabindex: "-1",
        title: targets.length ? null : why }, el("span", { class: "cm-label" }, label), icon("chevron-right", "cm-arrow"));
      if (!targets.length) return [head];
      const list = el("div", { class: "cm-list", role: "group", "aria-label": label }, targets.map((t) => target(t, send)));
      const s = { head, set: (on) => { for (const n of [head, list]) n.classList[on ? "add" : "remove"]("open"); head.setAttribute("aria-expanded", String(on)); } };
      let waiting = false;
      head.addEventListener("mouseenter", () => { waiting = true; setTimeout(() => { if (waiting) expand(s); }, 150); });
      head.addEventListener("mouseleave", () => { waiting = false; });
      head.addEventListener("click", (ev) => { ev.stopPropagation(); waiting = false; expand(s); });
      return [head, list];
    };
    const all = openProjects();
    const moveTo = all.filter((t) => t.key !== p.key);
    const items = [
      open && p.open ? item("Rename", () => rename(p.key, chatId), { key: "F2" }) : item("Open", () => post({ type: "openHistory", key: p.key, chatId })),
      ...sub("Fork to", working ? [] : all, (to) => post({ type: "forkChat", key: p.key, chatId, to }),
        working ? "It can't be forked while it's working or waiting for you." : "No project is open."),
      ...sub("Move to", working ? [] : moveTo, (to) => post({ type: "moveChat", key: p.key, chatId, to }),
        working ? "It can't be moved while it's working or waiting for you." : "No other project is open: open one first."),
      el("div", { class: "cm-sep", role: "separator" }),
      item("Delete", () => post({ type: "deleteChat", key: p.key, chatId }), { red: true })];
    menuEl = el("div", { class: "cm-menu", role: "menu" }, items);
    document.body.append(menuEl);
    placeMenu(e.clientX, e.clientY);
  }
  window.addEventListener("mousedown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeChatMenu(); }, true);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChatMenu(); });
  window.addEventListener("blur", closeChatMenu);
  list.addEventListener("scroll", closeChatMenu);

  // ---------- a project's History (every saved chat of it, folded until you open it) ----------
  function historyRow(p, h) {
    return el("div", { class: "chat-row hist", role: "treeitem", tabindex: "0", title: [h.title, h.ago].filter(Boolean).join("\n"),
      "data-chat": h.id, draggable: "true",
      "data-vscode-context": menu({ webviewSection: "history", key: p.key, chatId: h.id, projectOpen: !!p.open }),
      onclick: () => post({ type: "openHistory", key: p.key, chatId: h.id }),
      onkeydown: (e) => { if (e.key === "Enter") post({ type: "openHistory", key: p.key, chatId: h.id }); },
      ondragstart: (e) => {
        S.drag = { key: p.key, chatId: h.id };
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", h.title); }
      },
      ondragend: () => { S.drag = null; S.later = false; draw(); },
      oncontextmenu: (e) => chatMenu(e, p, h.id, { open: false, busy: false }) },
    el("span", { class: "ct" }, marked(h.title)), el("span", { class: "when" }, h.ago || ""));
  }
  function historyNodes(p) {
    const h = p.history || { open: false, items: [], total: 0 }, searching = !!query();
    const open = h.open || (searching && h.items.length > 0);
    if (searching && !h.items.length) return [];
    const head = el("div", { class: "hist-head", role: "button", tabindex: "0", "aria-expanded": String(open),
      onclick: () => historyFold(p.key, !open), onkeydown: (e) => { if (e.key === "Enter") historyFold(p.key, !open); } },
    icon(open ? "chevron-down" : "chevron-right"), el("span", { class: "hl" }, "History"), open && h.loaded ? el("span", { class: "hn" }, String(h.total)) : null,
    // (Clear all: under the pointer, in place of the count; the host asks before it deletes anything.)
    open && h.loaded && h.total > 0 && !searching ? el("button", { class: "clear-all", type: "button", title: `Delete every saved chat of ${p.name}`,
      onclick: (e) => { e.stopPropagation(); post({ type: "clearHistory", key: p.key }); } }, "Clear all") : null);
    if (!open) return [head];
    if (!h.loaded) return [head, el("div", { class: "hist-note" }, "Loading...")];
    if (!h.items.length) return [head, el("div", { class: "hist-note" }, "No earlier chats.")];
    const shown = Math.min(h.items.length, S.hist.get(p.key) || HIST_SHOWN), rows = h.items.slice(0, shown).map((x) => historyRow(p, x));
    if (shown < h.items.length) {
      const n = Math.min(HIST_STEP, h.items.length - shown);
      const more = () => { S.hist.set(p.key, shown + HIST_STEP); draw(); };
      rows.push(el("div", { class: "more hist-more", role: "button", tabindex: "0", onclick: more, onkeydown: (e) => { if (e.key === "Enter") more(); } }, `Show ${n} more`));
    }
    return [head, ...rows];
  }
  function historyFold(key, open) {
    post({ type: "historyFold", key, open });
    // (Drawn at once as open; the host sends the items.)
    const p = ((S.model && S.model.sections) || []).flatMap((x) => x.projects || []).find((x) => x.key === key);
    if (p) { p.history = { loaded: false, total: 0, items: [], ...p.history, open }; draw(); }
  }

  // The first five chats (the host puts waiting, finished and working ones first), plus the one on screen; the rest
  // behind "Show N more". A search shows every chat that matched.
  function chatRows(p) {
    const chats = p.chats || [];
    if (query() || chats.length <= SHOWN) return chats.map((c) => chatRow(p, c));
    const toggle = (label) => el("div", { class: "more", role: "button", tabindex: "0",
      onclick: () => more(p.key), onkeydown: (e) => { if (e.key === "Enter") more(p.key); } }, label);
    if (S.more.has(p.key)) return [...chats.map((c) => chatRow(p, c)), toggle("Show less")];
    const shown = chats.filter((c, i) => i < SHOWN || c.onScreen);
    return [...shown.map((c) => chatRow(p, c)), toggle(`Show ${chats.length - shown.length} more`)];
  }

  function fold(key, on) {
    if (on) S.folded.add(key); else S.folded.delete(key);
    post({ type: "fold", key, folded: on });
    draw();
  }
  function more(key) {
    if (S.more.has(key)) S.more.delete(key); else S.more.add(key);
    draw();
  }

  // ---------- the list ----------
  function draw() {
    const searching = !!query();
    const rows = [];
    renameInput = null;
    // Pinned, Open and Recent in the host's order, each under its heading.
    const sections = ((S.model && S.model.sections) || []).filter((s) => s.projects && s.projects.length);
    for (const s of sections) {
      rows.push(el("div", { class: "sec", role: "presentation" }, s.title));
      for (const p of s.projects) {
        const unfolded = searching || !S.folded.has(p.key), showing = (p.chats || []).length > 0 && unfolded;
        rows.push(dropTarget(el("div", { class: `grp${unfolded ? " with-chats" : ""}`, role: "group" }, projectRow(p, unfolded), showing ? chatRows(p) : null, unfolded ? historyNodes(p) : null), p));
      }
    }
    if (!sections.length && S.model) {
      rows.push(el("div", { class: "empty" }, searching ? `Nothing matches "${query()}".` : "No projects yet. Use + above to open a folder, clone a repository or start a new project."));
    }
    list.replaceChildren(...rows);
    if (renameInput) { renameInput.focus(); if (renameInput.select) renameInput.select(); }
  }

  window.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "find") { S.findOpen = true; showFind(); input.focus(); }
    else if (m.type === "rename") rename(m.key, m.chatId);
    else if (m.type === "model") {
      S.model = m;
      S.folded = new Set(m.folded || []);
      // (What the host searched for; the box is left alone while you type.)
      if (typeof m.query === "string" && m.query !== input.value && document.activeElement !== input) { input.value = m.query; S.q = m.query; }
      if (input.value && !S.findOpen) { S.findOpen = true; showFind(); }
      // (Not while you rename or drag: a redraw would take the box or the dragged row away.)
      // (Not while the right-click menu is open either: a running chat's news comes often and would close it.)
      if (S.renaming || S.drag || menuEl) S.later = true; else draw();
    }
  });
  post({ type: "ready", q: S.q });
})();
