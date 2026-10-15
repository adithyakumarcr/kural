// The chat page: chats side by side in columns (lib/chat/index.js: each column is a pane of its own). The first column
// has the tab bar; every other one shows one chat with its title above it. When they no longer fit side by side (the
// panel made narrower), they stack. Also dragging a chat tab (or a column's title): onto a side of a column (a new
// column there), onto a column (it shows that chat; onto the first one: back among the tabs), or out of the panel
// (beside the code). "Out of the panel" is known only from where the drag ends: Chromium doesn't let a drag that started
// in one site's frame (this page) be dropped on another's (VS Code's window), so VS Code's editor area never sees the
// drop, and its own drop zones never show. (Checked with a real mouse drag on X11, 15 Oct 2026: dragend says where.)
(function () {
  const MIN_WIDTH = 320;   // a chat narrower than this is cramped (the box's buttons): no new column then
  const MAX_COLS = 4;
  const TAB = "application/x-kural-chat-tab";

  // One more column fits side by side.
  const fits = (width, count) => count < MAX_COLS && width / (count + 1) >= MIN_WIDTH;
  // The columns no longer fit side by side: they stack.
  const stacks = (width, count) => count > 1 && width / count < MIN_WIDTH * 0.75;

  // What happens when a dragged chat is dropped at (x, y). boxes: the columns in order ({ col, x, y, w, h }); from: the
  // column it's dragged from (0: a tab of the first column; else that column's title, so the column moves); room: one
  // more column fits; stacked: the columns are above each other. → { col, side: "before" | "after" | "center", box,
  // label }, or null: nothing would happen there.
  function dropZone(boxes, x, y, from, room, stacked) {
    const i = boxes.findIndex((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
    if (i < 0) return null;
    const c = boxes[i], moving = from !== 0;
    if (moving && c.col === from) return null;
    const len = stacked ? c.h : c.w, at = stacked ? y - c.y : x - c.x, edge = Math.max(40, len * 0.3);
    let side = at < edge ? "before" : at >= len - edge ? "after" : "center";
    if (side !== "center" && !moving && !room) side = "center";
    if (side === "center" && c.col === 0 && !moving) return null;   // (the tab's own chat)
    if (side !== "center" && moving) {
      // Right next to where the column already is: it wouldn't move.
      const now = boxes.findIndex((b) => b.col === from), to = side === "before" ? i : i + 1;
      if (to === now || to === now + 1) return null;
    }
    const box = side === "center" ? { x: c.x, y: c.y, w: c.w, h: c.h }
      : stacked ? { x: c.x, w: c.w, h: c.h / 2, y: side === "before" ? c.y : c.y + c.h / 2 }
        : { y: c.y, h: c.h, w: c.w / 2, x: side === "before" ? c.x : c.x + c.w / 2 };
    const label = side === "center" ? (c.col === 0 ? "Back to the tabs" : "Show it here")
      : moving ? "Move it here" : stacked ? (side === "before" ? "Split up" : "Split down") : side === "before" ? "Split left" : "Split right";
    return { col: c.col, side, box, label };
  }

  if (typeof acquireVsCodeApi === "undefined") { module.exports = { dropZone, fits, stacks, MIN_WIDTH, MAX_COLS }; return; }   // (the test)

  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const cols = new Map();   // col -> { el, chat (media/chat.js), size (its share of the width) }
  let order = [0], activeCol = 0;
  let columns = false;      // this page can have more columns: it's the side panel's (Kural sends "cols"), not an editor's

  // Text size follows the code editor's font (set by Kural; see lib/ui.js).
  const setFs = (v) => { if (v) document.documentElement.style.setProperty("--fs", v); };
  setFs(document.documentElement.dataset.fs);
  // Tell Kural when the chat has the keyboard (and which column), so its shortcuts (Ctrl+M, Ctrl+P, …) apply only there.
  const focused = (yes) => vscode.postMessage(yes && activeCol ? { type: "focusChanged", focused: true, col: activeCol } : { type: "focusChanged", focused: yes });
  window.addEventListener("focus", () => focused(true));
  window.addEventListener("blur", () => focused(false));
  window.addEventListener("error", (e) => vscode.postMessage({ type: "log", message: `${e.message} (${e.filename}:${e.lineno})` }));

  const room = () => columns && fits(app.clientWidth, order.length) && !app.classList.contains("stacked");
  const full = () => order.length > 1 && !room();
  // A column's line to Kural: its messages say which column they're from (the first one's don't, as before).
  function port(col) {
    return {
      post: (m) => vscode.postMessage(col ? { ...m, col } : m),
      active: () => activeCol === col,
      dragStart: (e, what) => dragStart(e, what, col),
      dragEnd: (e) => dragEnd(e),
      // (No room for one more, but already several side by side: say so, rather than opening it in the editor area,
      // which takes a maximized panel out of full width.)
      split: () => full() ? false : (vscode.postMessage({ type: "splitChat", inPanel: room() }), true),
      canSplit: () => room(),
      full: () => full(),
    };
  }

  function mount(col) {
    const el = document.createElement("div");
    el.className = "col";
    el.addEventListener("focusin", () => { if (activeCol !== col) { activeCol = col; focused(true); } });
    cols.set(col, { el, chat: null, size: 1 });
  }
  // Kural's list of columns ([{ col, size }], in order): new ones start their chat, closed ones go.
  function setCols(list) {
    const want = list.map((x) => x.col).filter((c, i, a) => Number.isInteger(c) && a.indexOf(c) === i);
    if (!want.includes(0)) want.unshift(0);
    for (const [col, c] of cols) if (!want.includes(col)) { if (c.chat) c.chat.close(); c.el.remove(); cols.delete(col); if (activeCol === col) activeCol = 0; }
    const fresh = want.filter((col) => !cols.has(col));
    fresh.forEach(mount);
    for (const x of list) if (cols.has(x.col)) cols.get(x.col).size = x.size > 0 ? x.size : 1;
    order = want;
    layout();
    for (const col of fresh) cols.get(col).chat = window.KURAL_CHAT(cols.get(col).el, port(col));
  }
  // The columns in their order with a divider between each two. (Rebuilt only when that changed: moving a column takes
  // the keyboard out of the box you're typing in. A closed column's divider goes too: each divider knows its place.)
  function layout() {
    const kids = [...app.children];
    const same = kids.length === order.length * 2 - 1 && kids.every((k, i) => i % 2 ? k.classList.contains("sash") : k === cols.get(order[i / 2]).el);
    if (!same) app.replaceChildren(...order.flatMap((col, i) => i ? [sash(i), cols.get(col).el] : [cols.get(col).el]));
    grow();
    restack();
  }
  // Each column's share of the width. (Scaled to add up to the number of columns: shares adding up to less than 1 would
  // leave part of the page empty, flexbox's rule.)
  function grow() {
    const total = order.reduce((n, col) => n + cols.get(col).size, 0) || 1;
    for (const col of order) cols.get(col).el.style.flexGrow = String(cols.get(col).size * order.length / total);
  }
  const restack = () => app.classList.toggle("stacked", stacks(app.clientWidth, order.length));
  new ResizeObserver(restack).observe(app);

  // The divider before column i: drag it to give one of the two more room (Kural keeps the sizes).
  function sash(i) {
    const s = document.createElement("div");
    s.className = "sash";
    s.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      s.classList.add("on");
      const a = cols.get(order[i - 1]), b = cols.get(order[i]), down = app.classList.contains("stacked");
      const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
      const len = down ? ra.height + rb.height : ra.width + rb.width, sum = a.size + b.size;
      const min = Math.min(len / 2, down ? 140 : MIN_WIDTH * 0.75);
      const move = (ev) => {
        const at = Math.max(min, Math.min(len - min, down ? ev.clientY - ra.top : ev.clientX - ra.left));
        a.size = sum * at / len; b.size = sum - a.size;
        grow();
      };
      const up = () => {
        s.classList.remove("on");
        s.removeEventListener("pointermove", move); s.removeEventListener("pointerup", up); s.removeEventListener("pointercancel", up);
        vscode.postMessage({ type: "colSizes", sizes: order.map((col) => ({ col, size: cols.get(col).size })) });
      };
      s.addEventListener("pointermove", move); s.addEventListener("pointerup", up); s.addEventListener("pointercancel", up);
    });
    return s;
  }

  // ---------- dragging a chat ----------
  let drag = null;   // { id, title, from, dropped, last: { x, y, at } }
  const zoneEl = document.createElement("div"), hintEl = document.createElement("div");
  zoneEl.className = "drop-zone hidden"; hintEl.className = "drag-hint hidden";
  document.body.append(zoneEl, hintEl);
  let watch = null;

  function dragStart(e, what, from) {
    drag = { id: what.id, title: what.title, from, dropped: false, last: null };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(TAB, what.id);
    e.dataTransfer.setData("text/plain", what.title || "");
    // (After the drag has started: changing the page during dragstart can cancel the drag.)
    setTimeout(() => {
      if (!drag) return;
      document.body.classList.add("chat-dragging");
      hint(false);
      clearInterval(watch);
      watch = setInterval(() => {
        // No event says the drag left this page; dragover stops coming. Last seen at an edge: it's outside.
        const l = drag && drag.last, edge = 24;
        if (l && Date.now() - l.at > 150 && (l.x < edge || l.y < edge || l.x > innerWidth - edge || l.y > innerHeight - edge)) { showZone(null); hint(true); }
      }, 100);
    }, 0);
  }
  function hint(out) {
    hintEl.textContent = out ? "Let go to open it beside the code"
      : room() ? "Drop it on a side to split, or outside this panel to open it beside the code"
        : order.length > 1 ? "Drop it on a chat to show it there, or outside this panel to open it beside the code"
          : "Drop it outside this panel to open it beside the code";
    hintEl.classList.toggle("out", out);
    hintEl.classList.remove("hidden");
  }
  function showZone(z) {
    zoneEl.classList.toggle("hidden", !z);
    if (!z) return;
    Object.assign(zoneEl.style, { left: `${z.box.x}px`, top: `${z.box.y}px`, width: `${z.box.w}px`, height: `${z.box.h}px` });
    zoneEl.textContent = z.label;
  }
  function stopVisuals() {
    clearInterval(watch); watch = null;
    zoneEl.classList.add("hidden"); hintEl.classList.add("hidden");
    document.body.classList.remove("chat-dragging");
  }
  const boxes = () => order.map((col) => { const r = cols.get(col).el.getBoundingClientRect(); return { col, x: r.left, y: r.top, w: r.width, h: r.height }; });
  const zoneAt = (x, y) => dropZone(boxes(), x, y, drag.from, room(), app.classList.contains("stacked"));

  // A dragged chat over this page: the drop zones (before chat.js's own handlers, which take files).
  document.addEventListener("dragover", (e) => {
    if (!drag) return;
    if (!e.dataTransfer.types.includes(TAB)) { drag = null; stopVisuals(); return; }   // (a file now: chat.js)
    e.stopPropagation();
    drag.last = { x: e.clientX, y: e.clientY, at: Date.now() };
    if (hintEl.classList.contains("out")) hint(false);   // (back over this page)
    // (Taken anywhere on this page; the drop does nothing where there's no zone. Only where there's a zone wasn't
    // enough on X11: the drag hears "yes, drop here" one mouse move late, so a quick drop right after reaching a zone
    // didn't happen.)
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    showZone(zoneAt(e.clientX, e.clientY));
  }, true);
  for (const type of ["dragenter", "dragleave"]) document.addEventListener(type, (e) => { if (drag && e.dataTransfer.types.includes(TAB)) e.stopPropagation(); }, true);
  document.addEventListener("drop", (e) => {
    if (!drag || !e.dataTransfer.types.includes(TAB)) return;
    e.preventDefault(); e.stopPropagation();
    const z = zoneAt(e.clientX, e.clientY);
    drag.dropped = true;
    if (z) vscode.postMessage({ type: "dropTab", id: drag.id, from: drag.from, to: z.col, side: z.side });
  }, true);
  function dragEnd(e) {
    const d = drag;
    drag = null;
    stopVisuals();
    if (!d || d.dropped) return;
    // Let go outside this page (in the editor area, usually): beside the code. (Escape out there does the same: the
    // drag's end looks alike.)
    const x = e.clientX, y = e.clientY;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) vscode.postMessage({ type: "dropTab", id: d.id, from: d.from, side: "outside" });
  }

  // Messages from Kural: the list of columns, or for one column (`col`; none: the first).
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "fontScale") { setFs(m.value); return; }
    if (m.type === "cols") { columns = true; setCols(Array.isArray(m.cols) ? m.cols : []); return; }
    const c = cols.get(m.col || 0);
    if (c && c.chat) c.chat.onMessage(m);
  });

  mount(0);
  layout();
  cols.get(0).chat = window.KURAL_CHAT(cols.get(0).el, port(0));
})();
