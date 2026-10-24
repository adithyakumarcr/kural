// The Projects tab's page (extension/media/projects.js) on a small fake DOM, no browser: the host's model in, what it
// draws and what it posts back out. Sections, project rows (this window, branch and path, the purple number, the pin),
// the hover buttons (red cross on an open project, red bin on a Recent one), chats under a project with their marks and
// labels, folding (and what a folded row shows), search, empty messages, and that the page never uses innerHTML.
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };

class El {
  constructor(tag) { Object.assign(this, { tag, nodeType: tag === "#text" ? 3 : 1, kids: [], attrs: {}, on: {}, style: {}, value: "", disabled: false, text: undefined }); this._cls = new Set(); }
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
const kinds = (p) => p.list.kids.map((r) => r._cls.has("sec") ? `sec:${r.textContent.trim()}` : r._cls.has("row") ? `row:${one(r, "nmt").textContent}` : r._cls.has("chat-row") ? `chat:${one(r, "ct").textContent}` : r._cls.has("empty") ? "empty" : "?");
const rowOf = (p, name) => p.list.kids.find((r) => r._cls.has("row") && one(r, "nmt").textContent === name);
const chatOf = (p, title) => p.list.kids.find((r) => r._cls.has("chat-row") && one(r, "ct").textContent === title);

const SECTIONS = () => [
  { id: "pinned", title: "Pinned", projects: [proj("k", "kural", { pinned: true, here: true, branch: "parallel-agents", chats: [chat("1", "Refactor notify", "idle", { onScreen: true, label: "on screen" }), chat("2", "Tests for the gate")] })] },
  { id: "open", title: "Open", projects: [proj("w", "weld-sim", { unseen: 2, branch: "arc-model", chats: [chat("3", "Mesh import"), chat("4", "Tune the arc model", "run", { label: "Working" }),
    chat("5", "Fix the login", "done", { label: "Done · 5 min ago" }), chat("6", "Fix broken links", "ask", { label: "Allow npm run build?" })] })] },
  { id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, branch: "", windowId: null, shortPath: "~/dotfiles" }), proj("o", "old", { open: false, pinned: true, branch: "" })] },
];

(async () => {
  await check("it says it is ready, with what was typed last time", () => {
    const p = load();
    assert.deepStrictEqual(p.posted, [{ type: "ready", q: "" }]);
  });

  await check("sections, project rows and chats come in the host's order; the search box is made once", () => {
    const p = load();
    const box = p.input;
    p.send(model(SECTIONS()));
    assert.deepStrictEqual(kinds(p), ["sec:Pinned 1", "row:kural", "chat:Refactor notify", "chat:Tests for the gate", "sec:Open 1", "row:weld-sim", "chat:Mesh import",
      "chat:Tune the arc model", "chat:Fix the login", "chat:Fix broken links", "sec:Recent 2", "row:dotfiles", "row:old"]);
    p.send(model(SECTIONS()));
    assert.strictEqual(p.input, box);
    assert.strictEqual(box.placeholder, undefined);
    assert.strictEqual(box.attrs.placeholder, "Find a project or chat");
  });

  await check("a project row: letter in its color, this window, branch · path, the purple number, Recent shows the path only", () => {
    const p = load();
    p.send(model(SECTIONS()));
    const k = rowOf(p, "kural"), w = rowOf(p, "weld-sim"), d = rowOf(p, "dotfiles");
    assert.strictEqual(one(k, "sw").textContent, "K");
    assert.strictEqual(one(k, "sw").style.background, "#4b6f9c");
    assert.strictEqual(one(k, "sw").style.color, "#fff");
    assert.ok(k._cls.has("cur") && one(k, "here").textContent === "this window");
    assert.strictEqual(one(k, "sub").textContent, "parallel-agents · ~/p/kural");
    assert.ok(!one(w, "here"), "only the window you're in says so");
    assert.strictEqual(one(w, "badge").textContent, "2");
    assert.ok(!one(k, "badge"), "no number on your own project");
    assert.strictEqual(one(d, "sub").textContent, "~/dotfiles");
    assert.ok(d._cls.has("recent"));
    assert.strictEqual(w.attrs.title, "/p/weld-sim");
  });

  await check("a pastel square gets a dark letter", () => {
    const p = load();
    p.send(model([{ id: "open", title: "Open", projects: [proj("a", "alpha", { color: "#edc0c0" })] }]));
    assert.strictEqual(one(rowOf(p, "alpha"), "sw").style.color, "#1e1e1e");
    p.send(model([{ id: "open", title: "Open", projects: [proj("a", "alpha", { color: null })] }]));
    assert.strictEqual(one(rowOf(p, "alpha"), "sw").style.background, undefined, "the stylesheet's purple stays");
  });

  await check("chats: spinner while working, orange dot waiting, purple dot finished, comment icon otherwise, with the host's label", () => {
    const p = load();
    p.send(model(SECTIONS()));
    const mark = (title) => { const r = chatOf(p, title), st = one(r, "st"); return st.kids[0]; };
    assert.ok(mark("Tune the arc model")._cls.has("codicon-loading") && mark("Tune the arc model")._cls.has("spin"));
    assert.ok(mark("Fix broken links")._cls.has("needs"));
    assert.ok(mark("Fix the login")._cls.has("dot-done"));
    assert.ok(mark("Mesh import")._cls.has("codicon-comment-discussion"));
    assert.strictEqual(one(chatOf(p, "Tune the arc model"), "cs").textContent, "Working");
    assert.strictEqual(one(chatOf(p, "Fix broken links"), "cs").textContent, "Allow npm run build?");
    assert.strictEqual(one(chatOf(p, "Fix the login"), "cs").textContent, "Done · 5 min ago");
    assert.ok(chatOf(p, "Fix the login")._cls.has("done") && chatOf(p, "Fix broken links")._cls.has("ask") && chatOf(p, "Tune the arc model")._cls.has("run"));
    assert.ok(chatOf(p, "Refactor notify")._cls.has("cur-chat"));
    assert.strictEqual(one(chatOf(p, "Refactor notify"), "cs").textContent, "on screen");
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

  await check("fold: the arrow hides the chats and tells the host; a folded project shows a spinner and an orange dot on its own row", () => {
    const p = load(); p.send(model(SECTIONS())); p.posted.length = 0;
    const chev = one(rowOf(p, "weld-sim"), "chev");
    assert.ok(!one(rowOf(p, "weld-sim"), "end").kids.some((k) => k._cls.has("needs")));
    chev.fire("click");
    assert.deepStrictEqual(p.posted, [{ type: "fold", key: "w", folded: true }], "the arrow doesn't open the project");
    assert.ok(!kinds(p).includes("chat:Mesh import") && kinds(p).includes("chat:Refactor notify"));
    const end = one(rowOf(p, "weld-sim"), "end");
    assert.ok(end.kids.some((k) => k._cls.has("codicon-loading")) && end.kids.some((k) => k._cls.has("needs")));
    one(rowOf(p, "weld-sim"), "chev").fire("click");
    assert.deepStrictEqual(p.posted[1], { type: "fold", key: "w", folded: false });
    assert.ok(kinds(p).includes("chat:Mesh import"));
  });

  await check("the host's folded list is what the page shows; a project without chats has no arrow", () => {
    const p = load(); p.send(model(SECTIONS(), { folded: ["k"] }));
    assert.ok(!kinds(p).includes("chat:Refactor notify") && kinds(p).includes("chat:Mesh import"));
    assert.ok(one(rowOf(p, "dotfiles"), "chev")._cls.has("none"));
    assert.ok(!one(rowOf(p, "kural"), "chev")._cls.has("none"));
  });

  await check("search: typing waits a moment, then asks the host; Escape clears it; the host's query fills the box", () => {
    const p = load(); p.send(model(SECTIONS())); p.posted.length = 0;
    p.input.value = "weld"; p.input.fire("input");
    assert.deepStrictEqual(p.posted, []);
    p.runTimers();
    assert.deepStrictEqual(p.posted, [{ type: "search", q: "weld" }]);
    assert.deepStrictEqual(p.state.v, { q: "weld" });
    p.input.fire("keydown", { key: "Escape" });
    assert.strictEqual(p.input.value, "");
    assert.deepStrictEqual(p.posted[1], { type: "search", q: "" });
    p.send(model(SECTIONS(), { query: "arc" }));
    assert.strictEqual(p.input.value, "arc");
  });

  await check("no projects: a hint; a search with no match: says so", () => {
    const p = load();
    p.send(model([]));
    assert.deepStrictEqual(kinds(p), ["empty"]);
    assert.match(p.list.kids[0].textContent, /No projects yet/);
    p.send(model([], { query: "zzz" }));
    assert.strictEqual(p.list.kids[0].textContent, 'Nothing matches "zzz".');
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
  });

  console.log(fail ? `\n${fail} failed` : "\nall ok");
  process.exit(fail ? 1 : 0);
})();
