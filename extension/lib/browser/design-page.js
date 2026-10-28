// Kural's Design Mode, inside a web page in Kural's browser (lib/browser/design.js puts it there; Adithya, 28 Oct 2026: like
// Cursor's Design Mode). It runs in Kural's own isolated world ("kural-design"), so the page's scripts can't see or call it,
// and draws in a closed shadow root on the page's <html>. It talks to Kural through one function, __kuralDesignSend, that
// only exists in this world (Runtime.addBinding): the page can't send Kural a fake note.
//
// What you do here: point at things (outline, Arrow Up/Down to the parent/child), click (a note), Shift+click (more elements
// in the same note), Option/Alt+click (straight into the chat box), drag (an area), Draw/Ellipse/Rectangle/Arrow (markup,
// Cmd/Ctrl+Z undoes), double-click text (edit it in place), Edit CSS properties (live), Batch (notes as numbered pins, then
// Send (n)), Return (send to the AI at once), Cmd/Ctrl+L (into the chat box), Esc (back out one step at a time).
// Kural asks it: describe(ids), node(id) (the element itself, for its framework component), capture(on) (hide everything but
// the markup while the picture is taken), noteDone(result), pending(n), busy(on) (the chat's AI is clicking in this page).
// Plain DOM calls and the CSSOM only: a page's Content Security Policy doesn't stop them (constructed stylesheets, el.style).
(() => {
  if (window.top !== window || globalThis.__kuralDesign) return;
  const BINDING = "__kuralDesignSend";
  const post = (m) => { const f = globalThis[BINDING]; if (typeof f === "function") { try { f(JSON.stringify(m)); } catch { /* not connected */ } } };
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const MOD = MAC ? "⌘" : "Ctrl+", SHIFT = MAC ? "⇧" : "Shift+";
  const isMod = (e) => (MAC ? e.metaKey : e.ctrlKey);
  const SVGNS = "http://www.w3.org/2000/svg";

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.layer { position: fixed; inset: 0; pointer-events: none; }
.hl, .sel, .area { position: fixed; border-radius: 3px; pointer-events: none; }
.hl { border: 2px solid #8b6cef; background: rgba(139,108,239,.10); display: none; }
.hl .lbl { position: absolute; left: -2px; top: -22px; background: #8b6cef; color: #fff; font: 11px/20px ui-monospace, Menlo, Consolas, monospace;
  padding: 0 6px; border-radius: 4px 4px 4px 0; white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
.hl.below .lbl { top: auto; bottom: -22px; border-radius: 0 4px 4px 4px; }
.sel { border: 2px solid #8b6cef; }
.sel .n { position: absolute; right: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; background: #8b6cef; color: #fff; font: 600 10px/18px sans-serif; text-align: center; }
.area { border: 2px dashed #8b6cef; background: rgba(139,108,239,.08); display: none; }
.markup { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
.bar { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); max-width: calc(100vw - 16px); display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 9px;
  background: #1e1e1e; border: 1px solid #3a3a3a; box-shadow: 0 8px 24px rgba(0,0,0,.35); pointer-events: auto; color: #ddd; font-size: 12px; white-space: nowrap; }
.bar button { height: 26px; min-width: 28px; padding: 0 7px; border-radius: 6px; border: 0; background: none; color: #ccc; display: inline-flex; align-items: center;
  gap: 5px; cursor: pointer; font: 12px inherit; }
.bar button:hover { background: rgba(255,255,255,.08); }
.bar button.on { background: rgba(139,108,239,.25); color: #fff; }
.bar svg { width: 15px; height: 15px; }
.bar .words { color: #a9a9a9; padding: 0 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.bar button, .batch { flex-shrink: 0; }
@media (max-width: 720px) { .bar .words { display: none; } }   /* (a narrow tab: the tools first) */
.bar .vr { width: 1px; height: 16px; background: #3a3a3a; margin: 0 3px; }
.bar .primary { background: #8b6cef; color: #fff; font-weight: 600; }
.bar .primary:hover { background: #7c5ce6; }
.bar .textbar { color: #e8d9a8; }
.batch { display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; color: #bbb; cursor: pointer; }
.sw { width: 26px; height: 15px; border-radius: 8px; background: #444; position: relative; }
.sw::after { content: ""; position: absolute; left: 2px; top: 2px; width: 11px; height: 11px; border-radius: 50%; background: #ddd; transition: left .15s; }
.batch.on .sw { background: #8b6cef; }
.batch.on .sw::after { left: 13px; }
.hide { display: none !important; }
.note { position: fixed; width: 380px; background: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 10px; box-shadow: 0 14px 40px rgba(0,0,0,.45);
  pointer-events: auto; color: #ddd; display: none; }
.note.show { display: block; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px 0; }
.chip { display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 4px; background: #2d2d30; color: #d7d7d7;
  font: 11px ui-monospace, Menlo, Consolas, monospace; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
textarea { display: block; width: 100%; min-height: 54px; max-height: 160px; resize: none; border: 0; outline: 0; background: none; color: #eee;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 8px 10px; }
textarea::placeholder { color: #888; }
.edits { padding: 0 10px 4px; font: 11px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #c7b8ff; white-space: pre-wrap; word-break: break-word; }
.row { display: flex; align-items: center; gap: 6px; padding: 6px 8px 8px; border-top: 1px solid #2f2f2f; }
.nb { height: 24px; border-radius: 5px; border: 0; background: #2d2d30; color: #ddd; font: 12px sans-serif; padding: 0 8px; display: inline-flex;
  align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
.nb:hover { background: #37373b; }
.nb.primary { background: #8b6cef; color: #fff; margin-left: auto; }
.nb .k { font: 10px ui-monospace, Menlo, monospace; opacity: .75; }
.status { padding: 0 10px 6px; font-size: 11px; color: #f0a35e; }
.panel { position: fixed; width: 300px; background: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 10px; box-shadow: 0 14px 40px rgba(0,0,0,.45);
  pointer-events: auto; display: none; flex-direction: column; overflow: hidden; color: #ddd; }
.panel.show { display: flex; }
.panel .top { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #2f2f2f; font-weight: 600; color: #eee; font-size: 13px; }
.panel .top button { margin-left: auto; border: 0; background: none; color: #bbb; cursor: pointer; font-size: 14px; }
.panel input.filter { margin: 8px 10px 4px; height: 26px; border-radius: 5px; border: 1px solid #3a3a3a; background: #252526; color: #ddd; padding: 0 8px; font: 12px sans-serif; }
.props { overflow: auto; padding: 2px 10px 10px; }
.prop { display: grid; grid-template-columns: 130px 1fr; gap: 6px; align-items: center; height: 26px; font: 12px ui-monospace, Menlo, Consolas, monospace; }
.prop .k { color: #9cdcfe; overflow: hidden; text-overflow: ellipsis; }
.prop input { height: 22px; border-radius: 4px; border: 1px solid transparent; background: #252526; color: #ce9178; padding: 0 6px; font: 12px ui-monospace, Menlo, monospace; }
.prop input:focus { border-color: #8b6cef; outline: 0; }
.prop.changed .k::after { content: " *"; color: #f0a35e; }
.pin { position: fixed; width: 22px; height: 22px; border-radius: 50% 50% 50% 0; background: #8b6cef; color: #fff; font: 700 11px/22px sans-serif; text-align: center;
  transform: translate(-50%, -100%) rotate(-45deg); box-shadow: 0 2px 6px rgba(0,0,0,.35); }
.pin span { display: inline-block; transform: rotate(45deg); }
.list { position: fixed; width: 300px; background: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 10px; box-shadow: 0 14px 40px rgba(0,0,0,.45);
  pointer-events: auto; display: none; padding: 6px; color: #ddd; max-height: 50vh; overflow: auto; }
.list.show { display: block; }
.list .it { display: flex; gap: 8px; align-items: flex-start; padding: 6px; border-radius: 6px; font-size: 12px; }
.list .it:hover { background: #2a2a2a; }
.list .num { width: 18px; height: 18px; border-radius: 50%; background: #8b6cef; color: #fff; font: 600 10px/18px sans-serif; text-align: center; flex: none; }
.list .t { flex: 1; }
.list .t small { display: block; color: #8a8a8a; font: 11px ui-monospace, Menlo, monospace; }
.list button { border: 0; background: none; color: #bbb; cursor: pointer; }
.flash { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); background: #1e1e1e; color: #eee; border: 1px solid #3c3c3c; border-radius: 8px;
  padding: 6px 12px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.35); opacity: 0; transition: opacity .2s; pointer-events: none; white-space: nowrap; }
.flash.show { opacity: 1; }
.paused { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); background: #1e1e1e; color: #ddd; border: 1px solid #3a3a3a; border-radius: 9px;
  padding: 6px 12px; font-size: 12px; display: none; }
.paused.show { display: block; }
`;

  // ---------- small DOM helpers (our own shadow tree only) ----------
  const h = (tag, cls, ...kids) => { const n = document.createElement(tag); if (cls) n.className = cls; for (const k of kids) if (k != null) n.append(k); return n; };
  const svg = (paths) => {   // a 16x16 icon from path data
    const s = document.createElementNS(SVGNS, "svg"); s.setAttribute("viewBox", "0 0 16 16"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.4"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    for (const d of paths) { const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); s.append(p); }
    return s;
  };
  const ICONS = {
    select: ["M3 2l9 5-4 1.2L6.6 12z", "M8.4 8.6L12 12.4"], draw: ["M11.2 2.8l2 2L6 12l-3 1 1-3z"], ellipse: ["M8 3.5c3.6 0 5.5 2 5.5 4.5S11.6 12.5 8 12.5 2.5 10.5 2.5 8 4.4 3.5 8 3.5z"],
    rect: ["M3 4h10v8H3z"], arrow: ["M3 13L13 3", "M7 3h6v6"], close: ["M4 4l8 8", "M12 4l-8 8"], send: ["M2.5 8L13.5 3 10 13.5 8 9z", "M8 9l5.5-6"],
    list: ["M5 4h8", "M5 8h8", "M5 12h8", "M2.5 4h.5", "M2.5 8h.5", "M2.5 12h.5"], mic: ["M8 2.5a2 2 0 0 1 2 2V8a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2z", "M4.5 7.5a3.5 3.5 0 0 0 7 0", "M8 11v2.5"],
    css: ["M4 3L2 8l2 5", "M12 3l2 5-2 5", "M9.5 3l-3 10"],
  };
  const button = (cls, title, icon, label, onclick) => {
    const b = h("button", cls); b.type = "button"; if (title) b.title = title; if (icon) b.append(svg(ICONS[icon])); if (label) b.append(label);
    b.addEventListener("click", (e) => { e.stopPropagation(); onclick(e); }); return b;
  };

  // ---------- state ----------
  const S = { on: false, busy: false, tool: "select", hover: null, sel: [], area: null, noteOpen: false, sending: false, batch: false,
    strokes: [], drag: null, editing: null, textEdits: [], css: [], saved: [], pending: 0, cursor: null };
  const ids = new Map(), idOf = new WeakMap();
  let nextId = 1;
  const keep = (el) => { let id = idOf.get(el); if (!id) { id = nextId++; idOf.set(el, id); ids.set(id, el); } return id; };
  let host = null, root = null, ui = null;

  // ---------- building the layer (once per page) ----------
  function build() {
    host = document.createElement("kural-design");
    host.style.setProperty("all", "initial");
    for (const [k, v] of [["position", "fixed"], ["inset", "0"], ["z-index", "2147483647"], ["pointer-events", "none"], ["display", "block"]]) host.style.setProperty(k, v, "important");
    root = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet];
    const layer = h("div", "layer");
    ui = {
      layer, markup: document.createElementNS(SVGNS, "svg"), hl: h("div", "hl", h("span", "lbl")), sels: h("div"), pins: h("div"), area: h("div", "area"),
      bar: h("div", "bar"), note: h("div", "note"), panel: h("div", "panel"), list: h("div", "list"), flash: h("div", "flash"), paused: h("div", "paused"),
    };
    ui.markup.setAttribute("class", "markup");
    ui.paused.textContent = "Kural's AI is using this page: Design Mode waits until its answer ends";
    // the toolbar
    ui.tools = {};
    for (const [t, title] of [["select", "Select elements"], ["draw", "Draw"], ["ellipse", "Ellipse"], ["rect", "Rectangle"], ["arrow", "Arrow"]]) {
      ui.tools[t] = button("", title, t, null, () => setTool(t)); ui.bar.append(ui.tools[t]);
    }
    ui.words = h("span", "words");
    ui.textbar = button("textbar hide", "Send your text edits to the AI", null, "", () => sendText());
    ui.sendAll = button("primary hide", "Send every saved note together", "send", "Send", () => sendAll());
    ui.listBtn = button("hide", "Saved notes", "list", null, () => toggleList());
    ui.batch = h("span", "batch", h("span", "sw"), "Batch"); ui.batch.title = "Batch edits: collect notes as pins, then send them together";
    ui.batch.addEventListener("click", (e) => { e.stopPropagation(); setBatch(!S.batch, true); });
    ui.bar.append(h("span", "vr"), ui.words, ui.textbar, ui.sendAll, ui.listBtn, h("span", "vr"), ui.batch,
      button("", `Exit Design Mode (Esc, ${MOD}${SHIFT}D)`, "close", null, () => post({ type: "exit" })));
    // the note
    ui.chips = h("div", "chips");
    ui.text = h("textarea"); ui.text.placeholder = "Describe the change…"; ui.text.rows = 2;
    ui.edits = h("div", "edits"); ui.status = h("div", "status");
    ui.cssBtn = button("nb", "Change this element's CSS on the page", "css", "Edit CSS properties", () => openPanel());
    ui.dictate = button("nb hide", "Say the rest: the note goes to the chat box and Kural's voice input starts there", "mic", "Dictate", () => submit("dictate"));
    ui.toChat = button("nb", `Put it in the chat box (${MOD}L)`, null, h("span", "k", `${MOD}L`), () => submit("chat"));
    ui.sendBtn = button("nb primary", "Send it to the AI (Return)", null, "", () => submit(S.batch ? "save" : "send"));
    ui.note.append(ui.chips, ui.text, ui.edits, ui.status, h("div", "row", ui.cssBtn, ui.dictate, ui.toChat, ui.sendBtn));
    ui.text.addEventListener("input", renderEdits);
    ui.text.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(S.batch ? "save" : "send"); }
      else if (e.key === "Escape") { e.preventDefault(); if (ui.panel.classList.contains("show")) closePanel(); else closeNote(); }
      else if (isMod(e) && e.key.toLowerCase() === "l") { e.preventDefault(); submit("chat"); }
    });
    for (const k of ["keyup", "keypress", "input", "beforeinput", "paste", "copy", "cut"]) ui.text.addEventListener(k, (e) => e.stopPropagation());
    // the CSS panel
    ui.filter = h("input", "filter"); ui.filter.placeholder = "Filter properties";
    ui.props = h("div", "props");
    const close = h("button"); close.type = "button"; close.textContent = "✕"; close.title = "Close"; close.addEventListener("click", (e) => { e.stopPropagation(); closePanel(); });
    ui.panel.append(h("div", "top", "CSS properties", close), ui.filter, ui.props);
    ui.filter.addEventListener("input", () => { const q = ui.filter.value.toLowerCase(); for (const r of ui.props.children) r.classList.toggle("hide", !r.dataset.p.includes(q)); });
    ui.filter.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); closePanel(); } });
    layer.append(ui.markup, ui.area, ui.sels, ui.pins, ui.hl, ui.bar, ui.note, ui.panel, ui.list, ui.flash, ui.paused);
    root.append(layer);
    // What happens in Design Mode's own toolbar, note and panels stays there: it doesn't bubble out to the page's handlers
    // (a page's "click outside closes the menu" would fire, its counters count). Our buttons already had it at their target.
    for (const t of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu", "auxclick", "wheel", "keydown", "keyup", "keypress", "input", "focusin", "focusout"])
      layer.addEventListener(t, (e) => e.stopPropagation());
  }

  // ---------- on and off ----------
  const EVENTS = ["mousemove", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "pointerdown", "pointerup", "keydown"];
  function start(opts = {}) {
    if (S.on) return true;
    // (A page that's loading: Kural's script runs before the page has its <html> and <body>. Then once they're there.)
    if (!document.documentElement || !document.body) { document.addEventListener("DOMContentLoaded", () => start(opts), { once: true }); return true; }
    if (!host) build();
    if (!host.isConnected) document.documentElement.append(host);
    S.on = true; S.busy = false;
    setBatch(!!opts.batch, false);
    S.pending = Number(opts.pending) || 0;
    setTool("select");
    for (const t of EVENTS) window.addEventListener(t, onEvent, true);
    window.addEventListener("scroll", reposition, true); window.addEventListener("resize", reposition);
    cursor(true);
    renderBar();
    return true;
  }
  function stop() {
    if (!S.on) return true;
    S.on = false;
    endEdit(false);
    for (const t of EVENTS) window.removeEventListener(t, onEvent, true);
    window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition);
    cursor(false);
    closeNote(); clearSel(); hideHl(); S.strokes = []; drawMarkup(); S.saved = []; drawPins();
    if (host) host.remove();
    return true;
  }
  // The chat's AI is clicking in this page: Design Mode steps aside (its clicks must reach the page), and comes back after.
  function setBusy(on) {
    if (!S.on || S.busy === !!on) return true;
    S.busy = !!on;
    for (const t of EVENTS) window[on ? "removeEventListener" : "addEventListener"](t, onEvent, true);
    cursor(!on);
    ui.layer.classList.toggle("hide", false);
    for (const n of [ui.bar, ui.note, ui.panel, ui.list, ui.hl, ui.sels, ui.area, ui.pins, ui.markup]) n.classList.toggle("hide", !!on);
    ui.paused.classList.toggle("show", !!on);
    return true;
  }
  let cursorSheet = null;
  function cursor(on) {   // (a crosshair over the page while selecting)
    try {
      if (!cursorSheet) { cursorSheet = new CSSStyleSheet(); cursorSheet.replaceSync("*, *::before, *::after { cursor: crosshair !important; }"); }
      const list = document.adoptedStyleSheets.filter((x) => x !== cursorSheet);
      document.adoptedStyleSheets = on ? [...list, cursorSheet] : list;
    } catch { /* an old engine: no crosshair */ }
  }

  // ---------- the toolbar ----------
  function setTool(t) {
    S.tool = t;
    for (const [k, b] of Object.entries(ui.tools)) b.classList.toggle("on", k === t);
    renderBar();
    if (t !== "select") hideHl();
  }
  function setBatch(on, fromYou) {
    S.batch = !!on;
    ui.batch.classList.toggle("on", S.batch);
    ui.sendBtn.textContent = S.batch ? "Save ↵" : "Send ↵";
    if (fromYou) { post({ type: "batch", on: S.batch }); flash(S.batch ? "Batch edits on: Return saves a note as a pin; Send sends them all" : "Batch edits off: Return sends each note at once"); }
    renderBar();
  }
  function renderBar() {
    if (!ui) return;
    ui.words.textContent = S.editing ? "Editing text · Return keeps it · Esc puts it back"
      : S.tool === "select" ? `Click an element · drag an area · Esc to exit`
        : `${{ draw: "Draw", ellipse: "Ellipse", rect: "Rectangle", arrow: "Arrow" }[S.tool]}: drag on the page · ${MOD}Z undoes`;
    const te = S.textEdits.length;
    ui.textbar.classList.toggle("hide", !te);
    ui.textbar.textContent = `${te} text edit${te === 1 ? "" : "s"} · Send`;
    const n = S.pending;
    ui.sendAll.classList.toggle("hide", !n);
    ui.listBtn.classList.toggle("hide", !n);
    ui.sendAll.lastChild.textContent = ` Send (${n})`;
    if (!n) ui.list.classList.remove("show");
  }

  // ---------- pointing ----------
  const mine = (e) => e.target === host;
  const pageEl = (n) => (n && n.nodeType === 1 && n !== host && n !== document.documentElement && n !== document.body ? n : null);
  const label = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
  const sizeOf = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; };
  const place = (n, r) => { n.style.left = `${r.x}px`; n.style.top = `${r.y}px`; n.style.width = `${r.w}px`; n.style.height = `${r.h}px`; };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  function showHl(el) {
    S.hover = el;
    if (!el || S.tool !== "select") return hideHl();
    const r = rectOf(el);
    place(ui.hl, r); ui.hl.style.display = "block";
    ui.hl.classList.toggle("below", r.y < 26);
    ui.hl.firstChild.textContent = `${label(el)}  ${sizeOf(el)}`;
  }
  function hideHl() { if (ui) ui.hl.style.display = "none"; }
  function drawSel() {
    ui.sels.replaceChildren();
    S.sel.forEach((el, i) => {
      if (!el.isConnected) return;
      const d = h("div", "sel"); place(d, rectOf(el));
      if (S.sel.length > 1) { const n = h("span", "n"); n.textContent = String(i + 1); d.append(n); }
      ui.sels.append(d);
    });
  }
  function clearSel() { S.sel = []; S.area = null; if (ui) { ui.area.style.display = "none"; drawSel(); } }
  let raf = 0;
  function reposition() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!S.on) return;
      drawSel(); drawPins();
      if (S.hover && S.hover.isConnected) showHl(S.hover); else hideHl();
      if (S.noteOpen) placeNote();
    });
  }

  // ---------- the note ----------
  function openNote() {
    S.noteOpen = true;
    ui.chips.replaceChildren();
    if (S.area) ui.chips.append(h("span", "chip", `area ${Math.round(S.area.w)}×${Math.round(S.area.h)}`));
    for (const el of S.sel) ui.chips.append(h("span", "chip", `<${label(el)}>`));
    if (S.strokes.length) ui.chips.append(h("span", "chip", `${S.strokes.length} mark${S.strokes.length === 1 ? "" : "s"}`));
    ui.cssBtn.classList.toggle("hide", S.sel.length !== 1);
    ui.status.textContent = "";
    renderEdits();
    ui.note.classList.add("show");
    placeNote();
    ui.text.focus({ preventScroll: true });
  }
  function placeNote() {
    const W = innerWidth, H = innerHeight, w = Math.min(380, W - 16), hgt = ui.note.offsetHeight || 170;
    ui.note.style.width = `${w}px`;
    const r = S.area || (S.sel.length ? rectOf(S.sel[S.sel.length - 1]) : { x: 40, y: 60, w: 0, h: 0 });
    let x = Math.min(Math.max(8, r.x), W - w - 8), y = r.y + r.h + 10;
    if (y + hgt > H - 8) y = r.y - hgt - 10;
    if (y < 48) y = Math.max(48, Math.min(H - hgt - 8, r.y + 10));
    if (ui.panel.classList.contains("show")) {   // (never under the CSS panel)
      const pl = parseFloat(ui.panel.style.left) || 0, pw = ui.panel.offsetWidth;
      if (x < pl + pw && x + w > pl) { if (pl >= w + 14) x = Math.min(x, pl - w - 8); else { ui.note.style.width = `${Math.max(240, pl - 14)}px`; x = 6; } }
    }
    ui.note.style.left = `${x}px`; ui.note.style.top = `${y}px`;
  }
  function closeNote() {
    if (!ui) return;
    S.noteOpen = false; S.sending = false; ui.note.classList.remove("show"); closePanel(); ui.text.value = ""; S.css = []; renderEdits();
  }
  function renderEdits() {
    ui.edits.textContent = S.css.map((e) => `${e.prop}: ${e.from} → ${e.to}`).join("\n");
    ui.dictate.classList.toggle("hide", !(ui.text.value.trim() || S.css.length));
    if (S.noteOpen) placeNote();
  }
  // What the note holds, for Kural. mode: send | save (Batch) | chat (the chat box) | dictate (the chat box + voice input).
  function submit(mode) {
    if (S.sending) return;
    if (!S.sel.length && !S.area) return;
    const text = ui.text.value.trim();
    if ((mode === "send" || mode === "save") && !text && !S.css.length) { flash("Say what to change first (or change a CSS property)"); ui.text.focus(); return; }
    S.sending = true;
    ui.status.textContent = mode === "save" ? "Saving…" : "Taking a picture…";
    post({ type: "note", mode, ids: S.sel.map(keep), area: S.area, text, css: S.css.slice(), markup: S.strokes.length, markupBox: strokesBox(),
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1 });
  }
  // Kural took the note (or couldn't): ok → everything clears; a saved one becomes a pin.
  function noteDone(r = {}) {
    S.sending = false;
    if (!r.ok) { ui.status.textContent = r.message || "That didn't work. Try again."; return true; }
    if (r.mode === "save") { S.saved.push({ ids: S.sel.slice(), area: S.area, text: ui.text.value.trim() }); S.pending = Number(r.pending) || S.saved.length; }
    closeNote(); clearSel(); S.strokes = []; drawMarkup(); drawPins(); renderBar();
    if (r.mode === "chat" || r.mode === "dictate") flash(r.mode === "dictate" ? "In the chat box: speak now" : "In the chat box: add more, then press Send");
    else if (r.mode === "save") flash(`Saved as note ${S.saved.length}. Send (${S.pending}) sends them all`);
    return true;
  }

  // ---------- CSS panel ----------
  const PROPS = ["color", "background-color", "font-size", "font-weight", "font-family", "line-height", "padding", "margin", "border",
    "border-radius", "width", "height", "display", "position", "gap", "justify-content", "align-items", "opacity", "box-shadow", "text-align"];
  function openPanel() {
    const el = S.sel[0]; if (!el) return;
    const cs = getComputedStyle(el);
    ui.props.replaceChildren();
    for (const p of PROPS) {
      const from = cs.getPropertyValue(p);
      const row = h("div", "prop"); row.dataset.p = p;
      const inp = h("input"); inp.value = from; inp.spellcheck = false;
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); inp.blur(); } if (e.key === "Escape") { e.preventDefault(); closePanel(); } });
      inp.addEventListener("change", () => {
        el.style.setProperty(p, inp.value);
        S.css = S.css.filter((x) => x.prop !== p);
        if (inp.value !== from) S.css.push({ prop: p, from, to: inp.value });
        row.classList.toggle("changed", inp.value !== from);
        renderEdits(); drawSel();
      });
      row.append(h("span", "k", p), inp); ui.props.append(row);
    }
    ui.filter.value = "";
    ui.panel.style.maxHeight = `${Math.min(360, innerHeight - 60)}px`;
    ui.panel.classList.add("show");
    const nb = ui.note.getBoundingClientRect(), pw = ui.panel.offsetWidth, ph = ui.panel.offsetHeight;
    let x = nb.right + 8;
    if (x + pw > innerWidth - 6) { x = nb.left - pw - 8; if (x < 6) x = innerWidth - pw - 6; }
    ui.panel.style.left = `${Math.max(6, x)}px`;
    ui.panel.style.top = `${Math.max(48, Math.min(nb.top, innerHeight - ph - 8))}px`;
    placeNote();
    ui.filter.focus({ preventScroll: true });
  }
  function closePanel() { if (ui) { ui.panel.classList.remove("show"); if (S.noteOpen) { ui.note.style.width = ""; placeNote(); } } }

  // ---------- markup ----------
  function drawMarkup(extra) {
    if (!ui) return;
    ui.markup.replaceChildren();
    const defs = document.createElementNS(SVGNS, "defs"), mk = document.createElementNS(SVGNS, "marker");
    for (const [k, v] of [["id", "kd-ah"], ["viewBox", "0 0 10 10"], ["refX", "8"], ["refY", "5"], ["markerWidth", "6"], ["markerHeight", "6"], ["orient", "auto-start-reverse"]]) mk.setAttribute(k, v);
    const tip = document.createElementNS(SVGNS, "path"); tip.setAttribute("d", "M0,0 L10,5 L0,10 z"); tip.setAttribute("fill", "#f14c4c");
    mk.append(tip); defs.append(mk); ui.markup.append(defs);
    for (const s of extra ? [...S.strokes, extra] : S.strokes) ui.markup.append(shape(s));
  }
  const norm = (s) => ({ x: Math.min(s.a.x, s.b.x), y: Math.min(s.a.y, s.b.y), w: Math.abs(s.b.x - s.a.x), h: Math.abs(s.b.y - s.a.y) });
  function shape(s) {
    let n; const set = (o) => { for (const [k, v] of Object.entries(o)) n.setAttribute(k, v); };
    if (s.type === "draw") { n = document.createElementNS(SVGNS, "path"); set({ d: s.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") }); }
    else if (s.type === "rect") { n = document.createElementNS(SVGNS, "rect"); const r = norm(s); set({ x: r.x, y: r.y, width: r.w, height: r.h, rx: 3 }); }
    else if (s.type === "ellipse") { n = document.createElementNS(SVGNS, "ellipse"); const r = norm(s); set({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 }); }
    else { n = document.createElementNS(SVGNS, "line"); set({ x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, "marker-end": "url(#kd-ah)" }); }
    set({ fill: "none", stroke: "#f14c4c", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" });
    return n;
  }
  function strokesBox() {
    const pts = S.strokes.flatMap((s) => s.pts || [s.a, s.b]);
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: Math.min(...xs) - 12, y: Math.min(...ys) - 12, w: Math.max(...xs) - Math.min(...xs) + 24, h: Math.max(...ys) - Math.min(...ys) + 24 };
  }

  // ---------- text in place ----------
  const textual = (el) => el && !el.children.length && el.textContent.trim() && !/^(INPUT|TEXTAREA|SELECT|IMG|SVG|VIDEO|CANVAS|IFRAME)$/i.test(el.tagName);
  function startEdit(el) {
    closeNote(); clearSel(); hideHl();
    S.editing = { el, old: el.textContent, ce: el.getAttribute("contenteditable") };
    el.setAttribute("contenteditable", "true");
    el.style.setProperty("outline", "2px dashed #f0a35e"); el.style.setProperty("outline-offset", "2px");
    el.focus({ preventScroll: true });
    const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    renderBar();
  }
  function endEdit(save) {
    const ed = S.editing; if (!ed) return;
    S.editing = null;
    if (ed.ce === null) ed.el.removeAttribute("contenteditable"); else ed.el.setAttribute("contenteditable", ed.ce);
    ed.el.style.removeProperty("outline"); ed.el.style.removeProperty("outline-offset");
    const now = ed.el.textContent;
    if (save && now !== ed.old) {
      const was = S.textEdits.find((t) => t.el === ed.el);
      if (was) was.to = now; else S.textEdits.push({ el: ed.el, from: ed.old, to: now });
      flash("Text edit kept. The toolbar's Send sends your text edits");
    } else if (!save) ed.el.textContent = ed.old;
    try { getSelection().removeAllRanges(); } catch { /* none */ }
    renderBar();
  }
  function sendText() {
    if (!S.textEdits.length) return;
    const edits = S.textEdits.splice(0).filter((t) => t.el.isConnected);
    renderBar();
    if (!edits.length) return;
    post({ type: "note", mode: "send", ids: edits.map((t) => keep(t.el)), area: null, text: "", css: [], markup: 0, markupBox: null,
      textEdits: edits.map((t) => ({ id: keep(t.el), from: t.from.slice(0, 2000), to: t.to.slice(0, 2000) })), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1 });
  }

  // ---------- batch ----------
  function drawPins() {
    if (!ui) return;
    ui.pins.replaceChildren();
    S.saved.forEach((p, i) => {
      const el = p.ids.find((x) => x.isConnected);
      const at = p.area || (el ? rectOf(el) : null); if (!at) return;
      const d = h("div", "pin", h("span", null, String(i + 1))); d.style.left = `${at.x + 12}px`; d.style.top = `${at.y + 6}px`;
      ui.pins.append(d);
    });
  }
  function toggleList() {
    if (ui.list.classList.contains("show")) { ui.list.classList.remove("show"); return; }
    ui.list.replaceChildren();
    S.saved.forEach((p, i) => {
      const t = h("span", "t", p.text || "(no words)", h("small", null, [p.area ? "area" : "", ...p.ids.map((el) => `<${label(el)}>`)].filter(Boolean).join(" ")));
      const x = h("button"); x.type = "button"; x.textContent = "✕"; x.title = "Remove this note";
      x.addEventListener("click", (e) => { e.stopPropagation(); S.saved.splice(i, 1); S.pending = Math.max(0, S.pending - 1); post({ type: "unpend", index: i }); drawPins(); renderBar(); ui.list.classList.remove("show"); if (S.saved.length) toggleList(); });
      ui.list.append(h("div", "it", h("span", "num", String(i + 1)), t, x));
    });
    const b = ui.bar.getBoundingClientRect();
    ui.list.style.left = `${Math.max(8, Math.min(b.right - 300, innerWidth - 308))}px`; ui.list.style.top = `${b.bottom + 6}px`;
    ui.list.classList.add("show");
  }
  function sendAll() {
    const edits = S.textEdits.splice(0).filter((t) => t.el.isConnected);
    post({ type: "sendAll", textEdits: edits.map((t) => ({ id: keep(t.el), from: t.from.slice(0, 2000), to: t.to.slice(0, 2000) })) });
  }
  function setPending(n) { S.pending = Number(n) || 0; if (!S.pending) S.saved = []; drawPins(); renderBar(); return true; }

  // ---------- events on the page (capture phase: before the page's own handlers; our own UI's events pass) ----------
  const local = (e) => ({ x: e.clientX, y: e.clientY });
  function block(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  function onEvent(e) {
    if (!S.on || S.busy) return;
    if (e.type === "keydown") return onKey(e);
    if (mine(e)) return;   // the toolbar, the note, the panel
    if (S.editing) {   // (clicks inside the text being edited move the caret; a click elsewhere keeps the edit)
      if (S.editing.el.contains(e.target)) { if (e.type === "click" || e.type === "dblclick") e.stopImmediatePropagation(); return; }
      if (e.type === "mousedown") { block(e); endEdit(true); return; }
    }
    const t = e.type;
    if (t === "mousemove") {
      if (S.drag) { block(e); return dragMove(e); }
      if (S.tool === "select" && !S.noteOpen) showHl(pageEl(e.target));
      return;
    }
    if (e.button !== undefined && e.button !== 0 && t !== "contextmenu") { if (t === "pointerdown" || t === "pointerup") e.stopImmediatePropagation(); else block(e); return; }
    if (t === "mousedown") {
      block(e);
      S.drag = { start: local(e), moved: false, pts: [local(e)], target: pageEl(e.target), alt: e.altKey, shift: e.shiftKey };
      return;
    }
    if (t === "mouseup") { block(e); return dragEnd(e); }
    if (t === "dblclick") {
      block(e);
      const el = pageEl(e.target);
      if (S.tool === "select" && textual(el)) startEdit(el); else if (S.tool === "select") flash("Double-click a piece of text to edit it");
      return;
    }
    // pointerdown/up: only kept from the page (cancelling pointerdown would also cancel the mousedown/up that follow it);
    // click, auxclick, contextmenu: cancelled too, so links and buttons don't act while Design Mode is on.
    if (t === "pointerdown" || t === "pointerup") { e.stopImmediatePropagation(); return; }
    block(e);
  }
  function dragMove(e) {
    const d = S.drag; let p = local(e);
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 5) return;
    d.moved = true; hideHl();
    if (S.tool === "select") {
      let a = { ...d.start };
      if (e.shiftKey) { if (Math.abs(p.x - a.x) >= Math.abs(p.y - a.y)) p = { x: p.x, y: a.y + Math.sign(p.y - a.y || 1) * 40 }; else p = { x: a.x + Math.sign(p.x - a.x || 1) * 40, y: p.y }; }   // (one axis)
      if (e.altKey) a = { x: 2 * d.start.x - p.x, y: 2 * d.start.y - p.y };   // (from the centre)
      d.rect = norm({ a, b: p }); place(ui.area, d.rect); ui.area.style.display = "block";
    } else if (S.tool === "draw") { d.pts.push(p); drawMarkup({ type: "draw", pts: d.pts }); }
    else { let b = p; if (e.shiftKey && S.tool !== "arrow") { const s = Math.max(Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y)); b = { x: d.start.x + Math.sign(p.x - d.start.x || 1) * s, y: d.start.y + Math.sign(p.y - d.start.y || 1) * s }; }
      d.shape = { type: S.tool, a: d.start, b }; drawMarkup(d.shape); }
  }
  function dragEnd(e) {
    const d = S.drag; if (!d) return; S.drag = null;
    if (S.tool !== "select") {
      if (d.moved) S.strokes.push(S.tool === "draw" ? { type: "draw", pts: d.pts } : d.shape);
      drawMarkup();
      if (d.moved && !S.noteOpen) { if (!S.area && !S.sel.length) S.area = strokesBox(); openNote(); } else if (S.noteOpen) openNote();
      return;
    }
    if (d.moved && d.rect) {
      if (d.rect.w < 6 || d.rect.h < 6) { ui.area.style.display = "none"; return; }
      if (!S.noteOpen) S.sel = [];
      S.area = d.rect; drawSel(); openNote(); return;
    }
    const el = d.target; if (!el) return;
    if (e.altKey || d.alt) {   // Option/Alt+click: into the chat box, or into the open note
      if (S.noteOpen) { if (!S.sel.includes(el)) S.sel.push(el); drawSel(); openNote(); }
      else post({ type: "note", mode: "chat", ids: [keep(el)], area: null, text: "", css: [], markup: 0, markupBox: null, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1, quick: true });
      return;
    }
    if (e.shiftKey || d.shift) { if (!S.sel.includes(el)) S.sel.push(el); S.area = S.area || null; drawSel(); openNote(); return; }
    S.sel = [el]; S.area = null; ui.area.style.display = "none"; drawSel(); openNote();
  }
  function onKey(e) {
    if (mine(e)) return;   // (typing in the note or the panel: their own handlers)
    const k = e.key, mod = isMod(e);
    if (mod && e.shiftKey && k.toLowerCase() === "d") { block(e); post({ type: "exit" }); return; }
    if (S.editing) {
      if (k === "Enter" && !e.shiftKey) { block(e); endEdit(true); }
      else if (k === "Escape") { block(e); endEdit(false); }
      else e.stopImmediatePropagation();   // (typing: the page's own shortcuts stay quiet)
      return;
    }
    if (mod && k.toLowerCase() === "z") { block(e); if (S.strokes.pop()) { drawMarkup(); flash("Undid the last mark"); } return; }
    if (mod && k.toLowerCase() === "l" && (S.sel.length || S.area)) { block(e); if (!S.noteOpen) openNote(); submit("chat"); return; }
    if (k === "Escape") {
      block(e);
      if (S.drag) { S.drag = null; drawMarkup(); ui.area.style.display = "none"; return; }
      if (ui.panel.classList.contains("show")) { closePanel(); return; }
      if (ui.list.classList.contains("show")) { ui.list.classList.remove("show"); return; }
      if (S.noteOpen) { closeNote(); return; }
      if (S.sel.length || S.area) { clearSel(); return; }
      if (S.strokes.length) { S.strokes = []; drawMarkup(); return; }
      if (S.tool !== "select") { setTool("select"); return; }
      post({ type: "exit" });
      return;
    }
    if ((k === "ArrowUp" || k === "ArrowDown") && S.hover && !S.noteOpen && S.tool === "select") {
      block(e);
      const next = k === "ArrowUp" ? pageEl(S.hover.parentElement) : pageEl(S.hover.firstElementChild);
      if (next) showHl(next);
      return;
    }
    if (k === "Enter" && S.hover && !S.noteOpen && S.tool === "select") { block(e); S.sel = [S.hover]; drawSel(); openNote(); }
  }

  let flashT = 0;
  function flash(t) { if (!ui) return; ui.flash.textContent = t; ui.flash.classList.add("show"); clearTimeout(flashT); flashT = setTimeout(() => ui.flash.classList.remove("show"), 2400); }

  // ---------- what Kural asks ----------
  // An element, described for the AI (its framework component is read by Kural in the page's own world: node(id)).
  const STYLES = ["color", "background-color", "font-size", "font-family", "display", "position"];
  function selectorOf(el) {
    const parts = [];
    for (let n = el, depth = 0; n && n.nodeType === 1 && n !== document.documentElement && depth < 7; n = n.parentElement, depth++) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift(`#${n.id}`); break; }
      let part = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) part += cls.map((c) => `.${c}`).join("");
      const p = n.parentElement;
      if (p) { const same = [...p.children].filter((x) => x.tagName === n.tagName); if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`; }
      parts.unshift(part);
    }
    return parts.join(" > ");
  }
  function describe(list) {
    return (Array.isArray(list) ? list : []).map((id) => {
      const el = ids.get(Number(id));
      if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const attrs = [...el.attributes].filter((a) => !["class", "id", "style", "contenteditable"].includes(a.name)).slice(0, 12)
        .map((a) => `${a.name}="${String(a.value).slice(0, 120)}"`).join(" ");
      const open = el.outerHTML.slice(0, 400);
      return {
        id: Number(id), tag: el.tagName.toLowerCase(), short: label(el), elId: el.id || "", classes: [...el.classList].slice(0, 12), attrs,
        selector: selectorOf(el), text: String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
        rect: { x: r.left, y: r.top, w: r.width, h: r.height }, pos: [Math.round(r.left + scrollX), Math.round(r.top + scrollY)],
        size: [Math.round(r.width), Math.round(r.height)], styles: Object.fromEntries(STYLES.map((p) => [p, cs.getPropertyValue(p)])),
        html: open.length < el.outerHTML.length ? `${open}…` : open,
      };
    }).filter(Boolean);
  }
  // While Kural takes the picture: only the page and your markup (no outline, note, toolbar or pins). Resolves once painted.
  function capture(on) {
    for (const n of [ui.hl, ui.sels, ui.area, ui.pins, ui.bar, ui.note, ui.panel, ui.list, ui.flash]) n.classList.toggle("hide", !!on);
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
  }

  // What's going on, for Kural's tests (the shadow root is closed): plain values only.
  function state() {
    return { on: S.on, busy: S.busy, tool: S.tool, noteOpen: S.noteOpen, sending: S.sending, sel: S.sel.length, area: !!S.area, strokes: S.strokes.length,
      hover: S.hover ? label(S.hover) : null, editing: !!S.editing, textEdits: S.textEdits.length, pending: S.pending, batch: S.batch,
      panel: !!(ui && ui.panel.classList.contains("show")), status: ui ? ui.status.textContent : "", attached: !!(host && host.isConnected) };
  }

  globalThis.__kuralDesign = { start, stop, busy: setBusy, capture, describe, noteDone, pending: setPending, batch: (on) => { setBatch(on, false); return true; },
    node: (id) => ids.get(Number(id)) || null, on: () => S.on, flash: (t) => { flash(String(t || "")); return true; },
    state, sendText: () => { sendText(); return true; }, sendAll: () => { sendAll(); return true; }, tool: (t) => { setTool(t); return true; } };
})();
