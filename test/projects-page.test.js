// The Projects tab's page (extension/media/projects.js) on a small fake DOM, no browser: the host's model in, what it
// draws and what it posts back out. The "Folders" look (Adithya, 25 Oct 2026, design A of docs/mockups/projects-bar/
// projects-bar-v3a.html, then Pinned / Open / Recent headings back): one list, a folder per project with its chats under
// it, no cards or tiles; the
// hover buttons (red cross on an open project, red bin on a Recent one), chats with their marks, folding by the folder
// icon (and what a folded row shows), Show more, the search box opened from the title bar, empty messages, and that the
// page never uses innerHTML.
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };

class El {
  constructor(tag) {
    Object.assign(this, { tag, nodeType: tag === "#text" ? 3 : 1, kids: [], attrs: {}, on: {}, value: "", disabled: false, text: undefined });
    this.style = { vars: {}, setProperty(k, v) { this.vars[k] = v; } };
    this._cls = new Set();
  }
  get className() { return [...this._cls].join(" "); } set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { const c = this._cls; return { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
  fire(t, ev = {}) { for (const f of this.on[t] || []) f({ preventDefault() {}, stopPropagation() {}, ...ev }); }
  append(...ks) { for (const k of ks) this.kids.push(k); }
  replaceChildren(...ks) { this.kids = []; this.append(...ks); }
  focus() {}
  get textContent() { return this.text !== undefined ? this.text : this.kids.map((k) => k.textContent).join(""); }
}
const all = (n, pred, out = []) => { for (const k of n.kids || []) { if (k instanceof El) { if (pred(k)) out.push(k); all(k, pred, out); } } return out; };
const byClass = (n, c) => all(n, (k) => k._cls.has(c));
const one = (n, c) => byClass(n, c)[0];

function load() {
  const posted = [], state = { v: null }, app = new El("div"), listeners = {}, timers = [];
  const document = {
    getElementById: () => app, createElement: (t) => new El(t), createTextNode: (s) => { const t = new El("#text"); t.text = String(s); return t; },
    documentElement: { dataset: { fs: "1" }, style: { setProperty() {} } }, activeElement: null,
  };
  const ctx = {
    document, console,
    window: { addEventListener: (t, f) => { listeners[t] = f; } },
    // (Copied out as plain data: objects made inside the sandbox aren't deepStrictEqual to the test's.)
    acquireVsCodeApi: () => ({ postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))), getState: () => state.v, setState: (v) => { state.v = JSON.parse(JSON.stringify(v)); } }),
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension/media/projects.js"), "utf8"), ctx);
  const send = (m) => listeners.message({ data: m });
  const runTimers = () => { while (timers.length) timers.shift()(); };
  const [find, list] = app.kids;
  return { app, posted, state, send, runTimers, list, input: all(find, (k) => k.tag === "input")[0] };
}

const chat = (id, title, state = "idle", o = {}) => ({ id, title, state, ask: "", doneAt: 0, onScreen: false, label: "", ...o });
const proj = (key, name, o = {}) => ({ key, name, letter: name[0].toUpperCase(), color: "#4b6f9c", path: `/p/${name}`, workspaceFile: null, shortPath: `~/p/${name}`,
  branch: "main", open: true, here: false, windowId: `w-${name}`, pinned: false, unseen: 0, attention: 0, chats: [], ...o });
const model = (sections, o = {}) => ({ type: "model", sections, badge: 0, query: "", folded: [], ...o });
// (the list holds section headings, project rows and chat rows, in order; no cards)
const kinds = (p) => all(p.list, (r) => ["new-chat", "sec", "row", "chat-row", "more", "empty"].some((c) => r._cls.has(c)))
  .map((r) => r._cls.has("new-chat") ? "new" : r._cls.has("sec") ? `sec:${r.textContent.trim()}` : r._cls.has("row") ? `row:${one(r, "nmt").textContent}`
    : r._cls.has("chat-row") ? `chat:${one(r, "ct").textContent}` : r._cls.has("more") ? `more:${r.textContent}` : "empty");
const rowOf = (p, name) => all(p.list, (r) => r._cls.has("row") && one(r, "nmt").textContent === name)[0];
const chatOf = (p, title) => all(p.list, (r) => r._cls.has("chat-row") && one(r, "ct").textContent === title)[0];
const findBox = (p) => p.app.kids[0];

const SECTIONS = () => [
  { id: "pinned", title: "Pinned", projects: [proj("k", "kural", { pinned: true, here: true, branch: "parallel-agents", chats: [chat("1", "Refactor notify", "idle", { onScreen: true, label: "on screen" }), chat("2", "Tests for the gate")] })] },
  { id: "open", title: "Open", projects: [proj("w", "weld-sim", { unseen: 1, branch: "arc-model", news: { kind: "ask", text: "Waiting for you: Allow npm run build?" }, chats: [chat("6", "Fix broken links", "ask", { label: "Allow npm run build?" }),
    chat("5", "Fix the login", "done", { label: "Done · 5 min ago" }), chat("4", "Tune the arc model", "run", { label: "Working" }), chat("3", "Mesh import")] })] },
  { id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, branch: "", windowId: null, shortPath: "~/dotfiles" }), proj("o", "old", { open: false, pinned: true, branch: "" })] },
];
const many = (n, o = {}) => Array.from({ length: n }, (_, i) => chat(`c${i}`, `Chat ${i}`, "idle", o[i] || {}));

(async () => {
  await check("it says it is ready, with what was typed last time", () => {
    const p = load();
    assert.deepStrictEqual(p.posted, [{ type: "ready", q: "" }]);
  });

  await check("one list in the host's order: a heading per section, each project with its chats under it; no cards, no New chat", () => {
    const p = load();
    const box = p.input;
    p.send(model(SECTIONS()));
    assert.deepStrictEqual(kinds(p), ["sec:Pinned", "row:kural", "chat:Refactor notify", "chat:Tests for the gate", "sec:Open", "row:weld-sim", "chat:Fix broken links",
      "chat:Fix the login", "chat:Tune the arc model", "chat:Mesh import", "sec:Recent", "row:dotfiles", "row:old"]);
    assert.ok(!byClass(p.list, "new-chat").length, "no New chat row: the chat has its own +");
    assert.ok(!byClass(p.list, "proj").length && !byClass(p.list, "sw").length && !byClass(p.list, "badge").length && !byClass(p.list, "sub").length,
      "no cards, letter tiles, number badges or second lines");
    p.send(model(SECTIONS()));
    assert.strictEqual(p.input, box);
    assert.strictEqual(box.attrs.placeholder, "Find a project or chat");
  });

  await check("a project row: an open folder when it has a window, a closed one otherwise; bold here; the path (and news) as tooltip", () => {
    const p = load();
    p.send(model(SECTIONS()));
    const k = rowOf(p, "kural"), w = rowOf(p, "weld-sim"), d = rowOf(p, "dotfiles");
    assert.ok(one(k, "fic").kids[0]._cls.has("codicon-folder-opened"));
    assert.ok(one(d, "fic").kids[0]._cls.has("codicon-folder") && d._cls.has("recent"));
    assert.ok(k._cls.has("cur") && !w._cls.has("cur"));
    assert.ok(!/parallel-agents|~\/p\/kural|this window/.test(k.textContent));
    assert.strictEqual(k.attrs.title, "~/p/kural");
    assert.strictEqual(w.attrs.title, "~/p/weld-sim\nWaiting for you: Allow npm run build?");
    assert.ok(!k.style.vars["--ring"] && !one(k, "sw"), "no project colors in the bar");
  });

  await check("chats: the title, and at the end a spinner (working), an orange dot (waiting), a blue dot (new answer) or nothing", () => {
    const p = load();
    p.send(model(SECTIONS()));
    const mark = (title) => one(chatOf(p, title), "st").kids[0];
    assert.ok(mark("Tune the arc model")._cls.has("codicon-loading") && mark("Tune the arc model")._cls.has("spin"));
    assert.ok(mark("Fix broken links")._cls.has("needs"));
    assert.ok(mark("Fix the login")._cls.has("dot-new"));
    assert.strictEqual(mark("Mesh import"), undefined, "an idle chat has no mark");
    assert.strictEqual(chatOf(p, "Fix broken links").attrs.title, "Fix broken links\nAllow npm run build?\nIt can't be moved while it's working or waiting for you.",
      "the question is in the tooltip, and why it can't be dragged");
    assert.strictEqual(chatOf(p, "Mesh import").attrs.title, "Mesh import");
    assert.ok(chatOf(p, "Fix the login")._cls.has("done") && chatOf(p, "Fix broken links")._cls.has("ask") && chatOf(p, "Tune the arc model")._cls.has("run"));
    assert.ok(chatOf(p, "Refactor notify")._cls.has("cur-chat"));
    assert.ok(!/on screen/.test(chatOf(p, "Refactor notify").textContent));
  });

  await check("clicks post keys and ids only: the row opens the project, a chat opens that chat", () => {
    const p = load(); p.send(model(SECTIONS())); p.posted.length = 0;
    rowOf(p, "weld-sim").fire("click");
    chatOf(p, "Fix the login").fire("click");
    assert.deepStrictEqual(p.posted, [{ type: "open", key: "w" }, { type: "openChat", key: "w", chatId: "5" }]);
    p.posted.length = 0;
    rowOf(p, "weld-sim").fire("keydown", { key: "Enter" });
    rowOf(p, "weld-sim").fire("keydown", { key: "a" });
    assert.deepStrictEqual(p.posted, [{ type: "open", key: "w" }]);
  });

  await check("hover buttons: a red cross on an open project, a red bin on a Recent one that isn't pinned, none on a pinned Recent one", () => {
    const p = load(); p.send(model(SECTIONS()));
    const x = one(rowOf(p, "weld-sim"), "close-p"), bin = one(rowOf(p, "dotfiles"), "bin-p");
    assert.ok(x && x._cls.has("red") && x.attrs.title === "Close project");
    assert.ok(bin && bin._cls.has("red") && bin.attrs.title === "Remove from Recent");
    assert.ok(!one(rowOf(p, "dotfiles"), "close-p") && !one(rowOf(p, "weld-sim"), "bin-p"));
    assert.ok(!one(rowOf(p, "old"), "bin-p") && !one(rowOf(p, "old"), "close-p"));
    assert.strictEqual(one(rowOf(p, "kural"), "close-p").attrs.title, "Close this project (and this window)");
    p.posted.length = 0;
    x.fire("click"); bin.fire("click");
    assert.deepStrictEqual(p.posted, [{ type: "close", key: "w" }, { type: "removeRecent", key: "d" }], "a button never opens the row");
  });

  await check("the pin button is shown on pinned projects, says Pin or Unpin, and posts the key", () => {
    const p = load(); p.send(model(SECTIONS()));
    const on = one(rowOf(p, "kural"), "pin"), off = one(rowOf(p, "weld-sim"), "pin");
    assert.ok(on._cls.has("on") && on.attrs.title === "Unpin" && on.kids[0]._cls.has("codicon-pinned"));
    assert.ok(!off._cls.has("on") && off.attrs.title === "Pin" && off.kids[0]._cls.has("codicon-pin"));
    p.posted.length = 0; off.fire("click");
    assert.deepStrictEqual(p.posted, [{ type: "pin", key: "w" }]);
  });

  await check("fold: the folder icon hides the chats and tells the host; a folded project shows its chats' marks on its own row", () => {
    const p = load(); p.send(model(SECTIONS())); p.posted.length = 0;
    const fic = one(rowOf(p, "weld-sim"), "fic");
    assert.strictEqual(fic.tag, "button");
    assert.ok(!one(rowOf(p, "weld-sim"), "end").kids.some((k) => k._cls.has("needs")));
    fic.fire("click");
    assert.deepStrictEqual(p.posted, [{ type: "fold", key: "w", folded: true }], "the icon doesn't open the project");
    assert.ok(!kinds(p).includes("chat:Mesh import") && kinds(p).includes("chat:Refactor notify"));
    const w = rowOf(p, "weld-sim"), end = one(w, "end");
    assert.ok(end.kids.some((k) => k._cls.has("codicon-loading")) && end.kids.some((k) => k._cls.has("needs")) && end.kids.some((k) => k._cls.has("dot-new")));
    assert.ok(one(w, "fic").kids[0]._cls.has("codicon-folder") && w.attrs["aria-expanded"] === "false", "folded: a closed folder");
    one(w, "fic").fire("click");
    assert.deepStrictEqual(p.posted[1], { type: "fold", key: "w", folded: false });
    assert.ok(kinds(p).includes("chat:Mesh import"));
  });

  await check("the host's folded list is what the page shows; a project without chats has a plain icon, not a button", () => {
    const p = load(); p.send(model(SECTIONS(), { folded: ["k"] }));
    assert.ok(!kinds(p).includes("chat:Refactor notify") && kinds(p).includes("chat:Mesh import"));
    assert.strictEqual(one(rowOf(p, "dotfiles"), "fic").tag, "span");
    assert.ok(one(rowOf(p, "kural"), "fic")._cls.has("folded"));
  });

  await check("Show more: five chats, then \"Show N more\"; a chat on screen past five stays; Show less folds them again", () => {
    const p = load();
    const chats = many(9, { 7: { onScreen: true } });
    p.send(model([{ id: "open", title: "Open", projects: [proj("a", "alpha", { here: true, chats })] }]));
    assert.deepStrictEqual(kinds(p), ["sec:Open", "row:alpha", "chat:Chat 0", "chat:Chat 1", "chat:Chat 2", "chat:Chat 3", "chat:Chat 4", "chat:Chat 7", "more:Show 3 more"]);
    p.posted.length = 0;
    one(p.list, "more").fire("click");
    assert.deepStrictEqual(p.posted, [], "the page alone knows");
    assert.deepStrictEqual(kinds(p).slice(-3), ["chat:Chat 7", "chat:Chat 8", "more:Show less"]);
    one(p.list, "more").fire("click");
    assert.strictEqual(kinds(p).at(-1), "more:Show 3 more");
    p.send(model([{ id: "open", title: "Open", projects: [proj("a", "alpha", { chats: many(6) })] }]));
    assert.deepStrictEqual(kinds(p).slice(-2), ["chat:Chat 4", "more:Show 1 more"]);
    p.send(model([{ id: "open", title: "Open", projects: [proj("a", "alpha", { chats: many(5) })] }]));
    assert.ok(!kinds(p).some((k) => k.startsWith("more:")), "five or fewer: no Show more");
  });

  await check("the search box is hidden until the title bar's search (or a query) opens it; Escape clears and closes it", () => {
    const p = load(); p.send(model(SECTIONS())); p.posted.length = 0;
    assert.ok(findBox(p)._cls.has("hidden"));
    p.send({ type: "find" });
    assert.ok(!findBox(p)._cls.has("hidden"));
    p.input.value = "weld"; p.input.fire("input");
    assert.deepStrictEqual(p.posted, []);
    p.runTimers();
    assert.deepStrictEqual(p.posted, [{ type: "search", q: "weld" }]);
    assert.deepStrictEqual(p.state.v, { q: "weld" });
    p.input.fire("keydown", { key: "Escape" });
    assert.strictEqual(p.input.value, "");
    assert.deepStrictEqual(p.posted[1], { type: "search", q: "" });
    assert.ok(findBox(p)._cls.has("hidden"), "Escape closes the empty box");
    p.send({ type: "find" });
    one(findBox(p), "x").fire("click");
    assert.ok(findBox(p)._cls.has("hidden"), "the box's cross closes it too");
    p.send(model(SECTIONS(), { query: "arc" }));
    assert.strictEqual(p.input.value, "arc");
    assert.ok(!findBox(p)._cls.has("hidden"), "a query keeps it open");
  });

  await check("while searching: every matching chat (no Show more), the match marked in names and titles", () => {
    const p = load();
    p.send(model([{ id: "open", title: "Open", projects: [proj("a", "Login app", { chats: [...many(6), chat("z", "Fix the LOGIN redirect")] })] }], { query: "login" }));
    assert.ok(!kinds(p).some((k) => k.startsWith("more:")));
    const marks = all(p.list, (k) => k.tag === "mark").map((m) => m.textContent);
    assert.deepStrictEqual(marks, ["Login", "LOGIN"]);
    assert.strictEqual(one(chatOf(p, "Fix the LOGIN redirect"), "ct").textContent, "Fix the LOGIN redirect");
  });

  await check("right-click: rows carry their menu's context (no Cut/Copy/Paste); a chat of a closed project gets no chat menu", () => {
    const p = load(); p.send(model(SECTIONS()));
    const ctx = (r) => JSON.parse(r.attrs["data-vscode-context"]);
    assert.deepStrictEqual(ctx(chatOf(p, "Mesh import")), { preventDefaultContextMenuItems: true, webviewSection: "chat", key: "w", chatId: "3", projectOpen: true });
    assert.deepStrictEqual(ctx(rowOf(p, "kural")), { preventDefaultContextMenuItems: true, webviewSection: "project", key: "k", projectOpen: true, projectPinned: true });
    assert.deepStrictEqual(ctx(rowOf(p, "dotfiles")), { preventDefaultContextMenuItems: true, webviewSection: "project", key: "d", projectOpen: false, projectPinned: false });
    p.send(model([{ id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, chats: [chat("9", "Old one", "done")] })] }]));
    assert.strictEqual(ctx(chatOf(p, "Old one")).projectOpen, false);
  });

  await check("rename in place: the host's rename (or F2) turns the title into a box; Enter saves, Escape cancels, leaving the box saves", () => {
    const p = load(); p.send(model(SECTIONS())); p.posted.length = 0;
    p.send({ type: "rename", key: "w", chatId: "3" });
    const box = () => all(p.list, (k) => k.tag === "input" && k._cls.has("rename"))[0];
    assert.strictEqual(box().value, "Mesh import");
    box().value = "Mesh import, finer"; box().fire("keydown", { key: "Enter" });
    assert.deepStrictEqual(p.posted, [{ type: "renameChat", key: "w", chatId: "3", title: "Mesh import, finer" }]);
    assert.ok(!box() && chatOf(p, "Mesh import, finer"), "the new title shows at once");
    chatOf(p, "Fix the login").fire("keydown", { key: "F2" });
    box().value = "nope"; box().fire("keydown", { key: "Escape" });
    assert.strictEqual(p.posted.length, 1, "Escape: nothing sent");
    assert.ok(!box() && chatOf(p, "Fix the login"));
    chatOf(p, "Fix the login").fire("keydown", { key: "F2" });
    box().value = "Login fix"; box().fire("blur");
    assert.deepStrictEqual(p.posted[1], { type: "renameChat", key: "w", chatId: "5", title: "Login fix" });
    p.send({ type: "rename", key: "w", chatId: "3" });
    box().value = "   "; box().fire("keydown", { key: "Enter" });
    assert.strictEqual(p.posted.length, 2, "an empty title isn't sent");
  });

  await check("rename: the host's updates wait while you type, then show", () => {
    const p = load(); p.send(model(SECTIONS()));
    p.send({ type: "rename", key: "w", chatId: "3" });
    const box = all(p.list, (k) => k.tag === "input" && k._cls.has("rename"))[0];
    box.value = "half typed";
    p.send(model(SECTIONS().slice(1)));
    assert.strictEqual(all(p.list, (k) => k.tag === "input" && k._cls.has("rename"))[0], box, "the box stays");
    box.fire("keydown", { key: "Escape" });
    assert.ok(!rowOf(p, "kural"), "the update shows once you're done");
  });

  await check("drag a chat onto another open project: the row lights up, the drop asks the host to move it", () => {
    const p = load(); p.send(model(SECTIONS())); p.posted.length = 0;
    const dt = { setData() {}, effectAllowed: "", dropEffect: "" };
    const src = chatOf(p, "Refactor notify");
    assert.strictEqual(src.attrs.draggable, "true");
    assert.strictEqual(chatOf(p, "Tune the arc model").attrs.draggable, undefined, "a working chat can't be dragged");
    assert.strictEqual(chatOf(p, "Fix broken links").attrs.draggable, undefined, "nor one waiting for you");
    src.fire("dragstart", { dataTransfer: dt });
    let prevented = 0;
    const over = (r) => { r.fire("dragover", { dataTransfer: dt, preventDefault: () => prevented++ }); };
    over(rowOf(p, "kural")); over(rowOf(p, "dotfiles"));
    assert.strictEqual(prevented, 0, "not its own project, not one without a window");
    over(rowOf(p, "weld-sim"));
    assert.strictEqual(prevented, 1);
    assert.ok(rowOf(p, "weld-sim")._cls.has("drop"));
    rowOf(p, "weld-sim").fire("drop", { dataTransfer: dt });
    assert.deepStrictEqual(p.posted, [{ type: "moveChat", key: "k", chatId: "1", to: "w" }]);
    src.fire("dragend");
    assert.ok(!rowOf(p, "weld-sim")._cls.has("drop"));
  });

  await check("dragging: the host's updates wait until the drag ends", () => {
    const p = load(); p.send(model(SECTIONS()));
    const src = chatOf(p, "Refactor notify");
    src.fire("dragstart", { dataTransfer: { setData() {} } });
    p.send(model(SECTIONS().slice(1)));
    assert.ok(rowOf(p, "kural"), "not redrawn under the drag");
    src.fire("dragend");
    assert.ok(!rowOf(p, "kural"));
  });

  await check("no projects: a hint; a search with no match: says so", () => {
    const p = load();
    p.send(model([]));
    assert.deepStrictEqual(kinds(p), ["empty"]);
    assert.match(byClass(p.list, "empty")[0].textContent, /No projects yet/);
    p.send(model([], { query: "zzz" }));
    assert.strictEqual(byClass(p.list, "empty")[0].textContent, 'Nothing matches "zzz".');
    p.send(model([{ id: "open", title: "Open", projects: [] }]));
    assert.deepStrictEqual(kinds(p), ["empty"], "a section with nothing in it isn't drawn");
  });

  await check("the page is made with el() only, no emoji, no style attributes, no inline events", () => {
    const js = fs.readFileSync(path.join(__dirname, "../extension/media/projects.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../extension/media/projects.css"), "utf8");
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(/.test(js));
    assert.ok(!/setAttribute\(\s*["']style|style:\s*["'`]/.test(js));
    assert.ok(!/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(js + css));
    assert.match(css, /body\.vscode-light/);
    assert.match(css, /\.tbtn\.red/);
    assert.ok(!/#8b6cef|#6447d6|139,\s*108,\s*239|100,\s*71,\s*214/i.test(css), "no Kural purple in the bar");
  });

  console.log(fail ? `\n${fail} failed` : "\nall ok");
  process.exit(fail ? 1 : 0);
})();
