// Chats side by side in the side panel (columns), and dragging a chat tab: the page's drop zones
// (media/chat-columns.js dropZone) and what Kural does with a drop, the Split button, closing and restoring
// (lib/chat/index.js). The drag itself was checked with a real mouse on X11: see CLAUDE.md "Panes".
const assert = require("assert");
const fs = require("fs"), path = require("path"), Module = require("module");
const originalLoad = Module._load;
const vscode = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (_, d) => d }) },
  window: {}, env: { appRoot: "/unused" }, commands: { executeCommand: () => {} },
  Uri: { file: (f) => ({ scheme: "file", fsPath: f, path: f }), joinPath: (u, ...p) => ({ path: [u.path || "", ...p].join("/") }) } };
Module._load = function (name, ...args) { return name === "vscode" ? vscode : originalLoad.call(this, name, ...args); };
const { ChatView } = require("../extension/lib/chat");
const { dropZone, fits, stacks, MIN_WIDTH } = require("../extension/media/chat-columns.js");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// ---------- the page: where a drop goes ----------
const row = (...widths) => { let x = 0; return widths.map((w, i) => { const b = { col: i, x, y: 0, w, h: 800 }; x += w; return b; }); };

check("a tab dropped on its own chat does nothing; on a side, it splits only when there's room", () => {
  const one = row(1200);
  assert.strictEqual(dropZone(one, 600, 300, 0, true, false), null);
  const left = dropZone(one, 30, 300, 0, true, false), right = dropZone(one, 1150, 300, 0, true, false);
  assert.deepStrictEqual([left.col, left.side, left.label], [0, "before", "Split left"]);
  assert.deepStrictEqual([right.side, right.label, right.box.x, right.box.w], ["after", "Split right", 600, 600]);
  assert.strictEqual(dropZone(one, 30, 300, 0, false, false), null, "no room: the edge is its own chat too");
  assert.strictEqual(dropZone(one, -5, 300, 0, true, false), null, "outside the page: not a zone (dragend handles it)");
});

check("onto another column: shows it there; a column's title onto the first column: back among the tabs", () => {
  const two = row(700, 700);
  const show = dropZone(two, 1050, 300, 0, false, false);
  assert.deepStrictEqual([show.col, show.side, show.label], [1, "center", "Show it here"]);
  const back = dropZone(two, 350, 300, 1, false, false);
  assert.deepStrictEqual([back.col, back.side, back.label], [0, "center", "Back to the tabs"]);
  assert.strictEqual(dropZone(two, 1050, 300, 1, true, false), null, "a column onto itself");
});

check("moving a column: only to a place where it would really move (no room needed)", () => {
  const three = row(500, 500, 500);
  assert.strictEqual(dropZone(three, 480, 300, 1, false, false), null, "right after the column before it: same place");
  assert.strictEqual(dropZone(three, 1020, 300, 1, false, false), null, "right before the column after it: same place");
  const first = dropZone(three, 20, 300, 1, false, false);
  assert.deepStrictEqual([first.col, first.side, first.label], [0, "before", "Move it here"]);
  const last = dropZone(three, 1480, 300, 1, false, false);
  assert.deepStrictEqual([last.col, last.side], [2, "after"]);
});

check("stacked columns: the zones are above and below", () => {
  const boxes = [{ col: 0, x: 0, y: 0, w: 400, h: 400 }, { col: 1, x: 0, y: 400, w: 400, h: 400 }];
  const up = dropZone(boxes, 200, 10, 1, false, true);
  assert.deepStrictEqual([up.col, up.side, up.box.h, up.box.y], [0, "before", 200, 0]);
  assert.strictEqual(dropZone(boxes, 200, 390, 1, false, true), null, "below the first = where it is");
});

check("room for one more column, and when they stack", () => {
  assert.strictEqual(fits(2 * MIN_WIDTH, 1), true); assert.strictEqual(fits(2 * MIN_WIDTH - 1, 1), false);
  assert.strictEqual(fits(5000, 4), false, "at most four");
  assert.strictEqual(stacks(400, 1), false); assert.strictEqual(stacks(470, 2), true); assert.strictEqual(stacks(700, 2), false);
});

// ---------- Kural: what a drop does ----------
function fixture(ids = ["a", "b", "c"]) {
  const chat = Object.create(ChatView.prototype);
  const page = { posted: [], postMessage(m) { this.posted.push(m); }, asWebviewUri: (u) => u, cspSource: "csp", options: {} };
  let n = 0;
  Object.assign(chat, {
    tabs: ids.map((id) => ({ id, title: `Chat ${id}`, status: "idle", messages: [{ role: "user" }] })),
    panes: [], runtime: new Map(), routingJobs: new Map(), opened: [], saved: 0,
    sideChats: { stopAll() {} }, archive: { save() {} }, card: () => ({}),
    summary: (t) => ({ id: t.id, title: t.title, status: t.status }), viewTab: (t) => ({ id: t.id, title: t.title, messages: [] }),
    save() { chat.saved++; }, warm() {}, postHistory() {}, endDevice() {}, clearNotice() {},
    openSplit(id) { chat.opened.push(id || "new"); },
    newTab() { const t = { id: `new${++n}`, title: "New chat", status: "idle", messages: [] }; chat.tabs.push(t); chat.postTabs(); return t; },
    adoptSplit(panel, id) { const p = { id: "ed", kind: "editor", panel, activeId: id, ready: true, queue: [], webview: { postMessage() {} } }; chat.panes.push(p); return p; },
    context: { workspaceState: { update: (k, v) => { chat.stored = v; } } },
  });
  const main = { id: "main", kind: "side", webview: page, view: { visible: true }, ready: true, queue: [], activeId: "a" };
  main.layout = [main];
  chat.panes.push(main);
  return { chat, main, page };
}
const lastOf = (page, type) => page.posted.filter((m) => m.type === type).pop();
const colsOf = (page) => lastOf(page, "cols").cols.map((c) => c.col);
// What each pane would show now (tabsFor): its tab list and the flags.
const bar = (chat, p) => { const t = chat.tabsFor(p); return { tabs: t.tabs.map((x) => x.id), single: t.single, column: t.column, active: t.activeId }; };

check("a tab dropped on a side of the panel: a column of its own; the tabs show another chat", () => {
  const { chat, main, page } = fixture();
  chat.dropTab(main, { id: "a", side: "after", to: 0 });
  const col = main.layout[1];
  assert.ok(col && col.col === 1 && col.single && col.activeId === "a" && chat.panes.includes(col));
  assert.deepStrictEqual(colsOf(page), [0, 1]);
  assert.notStrictEqual(main.activeId, "a");
  assert.deepStrictEqual(bar(chat, main).tabs, ["b", "c"], "the tab bar leaves it out");
  assert.deepStrictEqual(bar(chat, col), { tabs: ["a"], single: true, column: true, active: "a" });
  chat.dropTab(main, { id: "b", side: "before", to: 0 });
  assert.deepStrictEqual(colsOf(page), [2, 0, 1], "before the first column");
});

check("a column's messages carry its number, and wait until its chat is ready", () => {
  const { chat, main, page } = fixture();
  chat.dropTab(main, { id: "b", side: "after", to: 0 });
  const col = main.layout[1];
  chat.postTo(col, { type: "flash", text: "hi" });
  assert.strictEqual(page.posted.some((m) => m.type === "flash"), false);
  col.ready = true; chat.postTo(col, { type: "focus" });
  assert.deepStrictEqual(page.posted.at(-1), { type: "focus", col: 1 });
});

check("onto a column: it shows that chat, and the column's own chat goes back among the tabs", () => {
  const { chat, main } = fixture();
  chat.dropTab(main, { id: "b", side: "after", to: 0 });
  const col = main.layout[1];
  chat.dropTab(main, { id: "c", side: "center", to: 1 });
  assert.strictEqual(col.activeId, "c");
  assert.ok(bar(chat, main).tabs.includes("b") && !bar(chat, main).tabs.includes("c"));
});

check("a column's title: onto the first column → back among the tabs; to a side → the column moves", () => {
  const { chat, main, page } = fixture();
  chat.dropTab(main, { id: "b", side: "after", to: 0 });
  chat.dropTab(main, { id: "c", side: "after", to: 1 });
  assert.deepStrictEqual(colsOf(page), [0, 1, 2]);
  chat.dropTab(main, { id: "c", from: 2, side: "before", to: 0 });
  assert.deepStrictEqual(colsOf(page), [2, 0, 1]);
  chat.dropTab(main, { id: "b", from: 1, side: "center", to: 0 });
  assert.deepStrictEqual(colsOf(page), [2, 0]);
  assert.strictEqual(main.activeId, "b");
  assert.ok(!chat.panes.some((p) => p.col === 1));
  chat.dropTab(main, { id: "a", from: 2, side: "center", to: 0 });
  assert.deepStrictEqual(colsOf(page), [2, 0], "a stale drop (column 2 shows c, not a) changes nothing");
});

check("dropped outside the panel: opened beside the code, and a column showing it closes", () => {
  const { chat, main, page } = fixture();
  chat.dropTab(main, { id: "a", side: "outside" });
  assert.deepStrictEqual(chat.opened, ["a"]);
  chat.dropTab(main, { id: "b", side: "after", to: 0 });
  chat.dropTab(main, { id: "b", from: 1, side: "outside" });
  chat.adoptDragged({}, "b");   // (what opening it in the editor area does)
  assert.deepStrictEqual(colsOf(page), [0]);
  assert.ok(chat.panes.some((p) => p.kind === "editor" && p.activeId === "b") && !chat.panes.some((p) => p.col));
});

check("closing a chat that has a column closes the column; its × puts the chat back among the tabs", () => {
  const { chat, main, page } = fixture();
  chat.dropTab(main, { id: "b", side: "after", to: 0 });
  chat.focusPane = main.layout[1];
  chat.closeTab("b");
  assert.deepStrictEqual(colsOf(page), [0]);
  assert.strictEqual(chat.focusPane, main);
  chat.dropTab(main, { id: "c", side: "after", to: 0 });
  chat.closeColumn(main.layout[1]);
  assert.ok(bar(chat, main).tabs.includes("c"));
});

check("Split: a new chat in a column when the panel is wide enough, else beside the code", () => {
  const { chat, main, page } = fixture();
  chat.splitChat(main, true);
  const col = main.layout[1];
  assert.ok(col && /^new/.test(col.activeId) && chat.focusPane === col);
  assert.ok(col.queue.some((m) => m.type === "focus"), "its box gets the keyboard once it's ready");
  chat.splitChat(col, true);
  assert.deepStrictEqual(colsOf(page), [0, 1, 2], "from a column too");
  chat.splitChat(main, false);
  assert.deepStrictEqual(chat.opened, ["new"]);
  chat.splitChat(main, true); chat.splitChat(main, true);
  assert.strictEqual(main.layout.length, 4, "at most four");
  assert.deepStrictEqual(chat.opened, ["new", "new"]);
});

check("showing a chat that has a column: that column, not the chat twice", () => {
  const { chat, main } = fixture();
  chat.dropTab(main, { id: "b", side: "after", to: 0 });
  const col = main.layout[1];
  chat.activate("b", main);
  assert.notStrictEqual(main.activeId, "b");
  assert.strictEqual(chat.focusPane, col);
});

check("the layout is saved with the tabs and comes back (chats still open, not in the editor area)", () => {
  const { chat, main } = fixture(["a", "b", "c", "d"]);
  chat.dropTab(main, { id: "b", side: "before", to: 0 });
  chat.dropTab(main, { id: "c", side: "after", to: 0 });
  main.layout[0].size = 1.5;
  chat.saveNow();
  assert.deepStrictEqual(chat.stored.cols, [{ id: "b", size: 1.5 }, { main: true, size: 1 }, { id: "c", size: 1 }]);
  const again = fixture(["a", "b", "c", "d"]);
  again.main.activeId = "b";
  again.chat.restoreCols(again.main, [...chat.stored.cols, { id: "gone" }, { id: "a" }]);
  const order = again.main.layout.map((p) => p.col ? p.activeId : "main");
  assert.deepStrictEqual(order, ["b", "main", "c", "a"]);
  assert.strictEqual(again.main.layout[0].size, 1.5);
  assert.ok(!["a", "b", "c"].includes(again.main.activeId), "the panel's own chat isn't one of the columns'");
});

check("a column whose chat closed meanwhile goes when its page says ready", () => {
  const { chat, main, page } = fixture();
  chat.dropTab(main, { id: "b", side: "after", to: 0 });
  const col = main.layout[1];
  chat.tabs = chat.tabs.filter((t) => t.id !== "b");
  chat.handle({ type: "ready" }, col);
  assert.deepStrictEqual(colsOf(page), [0]);
});

check("messages from the page reach the column they're from (attach)", () => {
  const { chat } = fixture();
  chat.context = { extensionUri: { path: "/ext" } };
  chat.resourceRoots = () => [];
  let listener = null;
  const webview = { postMessage() {}, asWebviewUri: (u) => u.path, cspSource: "csp", onDidReceiveMessage: (fn) => { listener = fn; } };
  const pane = chat.attach(webview, "side", null, "a");
  pane.layout = [pane];
  const col = chat.addColumn(pane, "b");
  const got = [];
  chat.onMessage = async (m, p) => { got.push([m.type, p === col ? "col" : p === pane ? "main" : "?"]); };
  listener({ type: "send" }); listener({ type: "send", col: 1 }); listener({ type: "send", col: 9 });
  assert.deepStrictEqual(got, [["send", "main"], ["send", "col"]], "an unknown column's message is dropped");
  assert.match(webview.html, /chat\.js"><\/script><script nonce="[^"]+" src="[^"]*chat-columns\.js"/, "the page shell loads after chat.js");
});

// ---------- the page: its columns (media/chat-columns.js run on a stand-in page) ----------
class El {
  constructor() { this.children = []; this.parent = null; this.style = {}; this.className = ""; this.on = {}; this.dataset = {}; this.textContent = ""; }
  get classList() {
    const set = () => new Set(this.className.split(/\s+/).filter(Boolean)), put = (s) => { this.className = [...s].join(" "); };
    return { add: (...c) => { const s = set(); c.forEach((x) => s.add(x)); put(s); }, remove: (...c) => { const s = set(); c.forEach((x) => s.delete(x)); put(s); },
      toggle: (c, on) => { const s = set(), v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); put(s); return v; }, contains: (c) => set().has(c) };
  }
  append(...kids) { for (const k of kids) { if (k.parent) k.remove(); k.parent = this; this.children.push(k); } }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  replaceChildren(...kids) { for (const k of this.children) k.parent = null; this.children = []; this.append(...kids); }
  addEventListener(type, fn) { (this.on[type] = this.on[type] || []).push(fn); }
  getBoundingClientRect() { return { left: 0, top: 0, x: 0, y: 0, width: 100, height: 100 }; }
}
function page(width = 1381) {
  const app = new El(), body = new El(), win = {}, sent = [], made = [];
  app.clientWidth = width;
  const document = { getElementById: () => app, createElement: () => new El(), body, documentElement: { dataset: {}, style: { setProperty() {} } }, addEventListener() {} };
  const window = { addEventListener: (type, fn) => { win[type] = fn; }, KURAL_CHAT: (el, port) => {
    const chat = { el, port, got: [], onMessage: (m) => chat.got.push(m), close: () => { chat.closed = true; } };
    made.push(chat); port.post({ type: "ready" }); return chat;
  } };
  const src = fs.readFileSync(path.join(__dirname, "..", "extension", "media", "chat-columns.js"), "utf8");
  new Function("acquireVsCodeApi", "document", "window", "ResizeObserver", "setTimeout", "setInterval", "clearInterval", "innerWidth", "innerHeight", src)(
    () => ({ postMessage: (m) => sent.push(m) }), document, window, class { observe() {} }, () => 0, () => 0, () => {}, width, 800);
  const send = (m) => win.message({ data: m });
  const shape = () => app.children.map((k) => k.className === "sash" ? "|" : made.findIndex((c) => c.el === k)).join(" ");
  return { app, sent, made, send, shape };
}
check("the page: columns in Kural's order, one divider between each two (none left over after closing one)", () => {
  const p = page();
  assert.strictEqual(p.shape(), "0");
  assert.deepStrictEqual(p.sent, [{ type: "ready" }]);
  p.send({ type: "cols", cols: [{ col: 0 }, { col: 1 }, { col: 2 }] });
  assert.strictEqual(p.shape(), "0 | 1 | 2");
  assert.deepStrictEqual(p.sent.slice(1), [{ type: "ready", col: 1 }, { type: "ready", col: 2 }]);
  p.send({ type: "cols", cols: [{ col: 0 }, { col: 2 }] });
  assert.strictEqual(p.shape(), "0 | 2", "the closed column's divider went too");
  assert.ok(p.made[1].closed);
  p.send({ type: "cols", cols: [{ col: 2 }, { col: 0 }] });
  assert.strictEqual(p.shape(), "2 | 0");
});
check("the page: a lone column fills it, whatever its saved share; shares are scaled to the number of columns", () => {
  const p = page();
  p.send({ type: "cols", cols: [{ col: 0, size: 0.4 }] });
  assert.strictEqual(p.made[0].el.style.flexGrow, "1");
  p.send({ type: "cols", cols: [{ col: 0, size: 1 }, { col: 1, size: 3 }] });
  assert.deepStrictEqual(p.made.map((c) => c.el.style.flexGrow), ["0.5", "1.5"]);
});
check("the page: each message goes to its column; Split asks for a column only when one fits", () => {
  const p = page(1381);
  p.made[0].port.split();
  assert.deepStrictEqual(p.sent.at(-1), { type: "splitChat", inPanel: false }, "before Kural says it's the side panel: beside the code");
  p.send({ type: "cols", cols: [{ col: 0 }, { col: 4 }] });
  p.send({ type: "full", tabId: "x" }); p.send({ type: "full", tabId: "y", col: 4 }); p.send({ type: "full", col: 9 });
  assert.deepStrictEqual(p.made.map((c) => c.got.map((m) => m.tabId)), [["x"], ["y"]]);
  p.made[1].port.post({ type: "send" });
  assert.deepStrictEqual(p.sent.at(-1), { type: "send", col: 4 });
  assert.strictEqual(p.made[0].port.split(), true);
  assert.deepStrictEqual(p.sent.at(-1), { type: "splitChat", inPanel: true });
  const narrow = page(600);
  narrow.send({ type: "cols", cols: [{ col: 0 }, { col: 1 }] });
  assert.strictEqual(narrow.made[0].port.split(), false, "two already and no room: it says so instead of leaving full width");
});

// ---------- the page scripts ----------
const media = path.join(__dirname, "..", "extension", "media");
const chatJs = fs.readFileSync(path.join(media, "chat.js"), "utf8"), shell = fs.readFileSync(path.join(media, "chat-columns.js"), "utf8");
const css = fs.readFileSync(path.join(media, "chat.css"), "utf8");
check("one chat per column: chat.js leaves the page to chat-columns.js", () => {
  assert.ok(!/acquireVsCodeApi/.test(chatJs) && /acquireVsCodeApi\(\)/.test(shell), "the VS Code API is taken once, by the shell");
  // Every listener on the whole page goes away with its column: each such call ends with ", on)".
  const calls = [...chatJs.matchAll(/(document|window)\.addEventListener\(/g)].map((m) => {
    let depth = 0, i = m.index + m[0].length - 1, quote = null;
    for (; i < chatJs.length; i++) {
      const ch = chatJs[i];
      if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
      if (ch === "/" && chatJs[i + 1] === "/") i = chatJs.indexOf("\n", i);   // (a comment: "you're" isn't a string)
      else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) break;
    }
    return chatJs.slice(m.index, i + 1);
  });
  assert.strictEqual(calls.length, 6);
  for (const call of calls) assert.match(call, /, on\)$/, call.split("\n")[0]);
  assert.ok(!/document\.body|window\.innerWidth|window\.innerHeight/.test(chatJs), "placed in its column, not the page");
  assert.match(css, /^\.col \{[^}]*contain: layout/m);
  assert.ok(!/100vw/.test(css));
});
check("a dragged tab carries no file address (a drop on the chat attached kural-chat:/… as a file)", () => {
  assert.ok(!/ResourceURLs|kuralchat/.test(chatJs + shell));
  assert.match(shell, /setData\(TAB, what\.id\)/);
});

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
