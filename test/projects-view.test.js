// The Projects tab's host side (lib/projects/index.js) on a stand-in vscode, with a fake status store and a fake model
// (the real ones, lib/projects/status.js and model.js, are tested in their own files; a last check here uses them when
// they are there): what this window publishes, what each click does, the close question's words, a new project's name
// and its folder, requests from other windows, the card and its fallback, the badge and the status bar item.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const Module = require("module");

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

// ---- a stand-in vscode ----
const ran = [], shown = [], items = [], handlers = {}, commands = {}, views = [];
let folders = [], workspaceFile = undefined, windowState = { focused: true }, config = {}, commandList = ["_kural.card"];
let frameAnswer = { enabled: true }, commandsAsked = [];
let warn = async () => undefined, info = async () => undefined, openDialog = async () => undefined, input = async () => undefined, recent = { workspaces: [] };
let pick = async () => undefined;
const Uri = { file: (f) => ({ scheme: "file", fsPath: f, path: f }), joinPath: (u, ...p) => ({ scheme: "file", fsPath: path.join(u.fsPath || "", ...p) }) };
const vscode = {
  workspace: {
    get workspaceFolders() { return folders.length ? folders.map((f) => ({ uri: typeof f === "string" ? Uri.file(f) : f })) : undefined; },
    get workspaceFile() { return workspaceFile; },
    getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d), inspect: () => undefined }),
    onDidChangeWorkspaceFolders: (f) => { handlers.folders = f; return { dispose() {} }; },
    onDidChangeConfiguration: (f) => { handlers.config = f; (handlers.configs = handlers.configs || []).push(f); return { dispose() {} }; },
  },
  window: {
    get state() { return windowState; },
    createStatusBarItem: () => { const i = { shown: false, text: "", show() { this.shown = true; }, hide() { this.shown = false; } }; items.push(i); return i; },
    registerWebviewViewProvider: (id, p) => { handlers.provider = { id, ...p }; return { dispose() {} }; },
    onDidChangeWindowState: (f) => { handlers.focus = f; return { dispose() {} }; },
    showWarningMessage: (...a) => { shown.push(["warn", ...a]); return warn(...a); },
    showInformationMessage: (...a) => { shown.push(["info", ...a]); return info(...a); },
    showErrorMessage: (...a) => { shown.push(["error", ...a]); return Promise.resolve(); },
    showInputBox: (o) => { shown.push(["input", o]); return input(o); },
    showQuickPick: (list, o) => { shown.push(["pick", list, o]); return pick(list, o); },
    showOpenDialog: (o) => { shown.push(["dialog", o]); return openDialog(o); },
  },
  commands: {
    executeCommand: async (...a) => { ran.push(a); if (a[0] === "_workbench.getRecentlyOpened") return recent; if (a[0] === "_kural.card") return handlers.cardAnswer; if (a[0] === "_kural.oneFrame") return frameAnswer; return undefined; },
    registerCommand: (id, f) => { commands[id] = f; return { dispose() {} }; },
    // Like VS Code's extHostCommands: `true` leaves out every command that starts with an underscore.
    getCommands: async (filterUnderscore) => { commandsAsked.push(filterUnderscore); return filterUnderscore ? commandList.filter((c) => c[0] !== "_") : commandList; },
  },
  extensions: { getExtension: () => undefined },
  Uri, StatusBarAlignment: { Left: 1 },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
};
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const { Projects, registerProjects } = require("../extension/lib/projects");

// ---- fakes for the two modules another part of Kural provides ----
class FakeStatus {
  constructor() { this.windowId = "w-me"; this.calls = []; this.windows = []; this.pins = []; this.sent = []; this.published = null; }
  start() { this.calls.push("start"); }
  publish(s) { this.published = s; this.calls.push("publish"); }
  flush() { this.calls.push("flush"); }
  dispose(o) { this.calls.push(["dispose", o]); }
  readAll() { return this.windows; }
  adopt(k) { this.calls.push(["adopt", k]); }
  prune() { this.calls.push("prune"); }
  send(id, r) { this.sent.push([id, r]); }
  onRequest(cb) { this.request = cb; }
  onChange(cb) { this.change = cb; }
  readPins() { return this.pins; }
  setPinned(p, on) { this.calls.push(["pin", p, on]); }
}
const fakeModel = { keyOf: ({ folders: f, workspaceFile: w }) => (w ? `ws:${w}` : `f:${f.join("+")}`), built: { sections: [], badge: 0, needLook: 0 }, args: null,
  buildModel(a) { this.args = a; return JSON.parse(JSON.stringify(this.built)); } };

const chat = (id, title, state = "idle") => ({ id, title, state, ask: "", doneAt: 0, onScreen: false, label: "" });
const proj = (key, name, o = {}) => ({ key, name, letter: name[0].toUpperCase(), color: "#4b6f9c", path: `/p/${name}`, workspaceFile: null, shortPath: `~/p/${name}`, branch: "main",
  open: true, here: false, windowId: `w-${name}`, pinned: false, unseen: 0, attention: 0, chats: [], ...o });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-projects-view-"));
function make(extra = {}, stand = {}) {
  handlers.configs = [];
  ran.length = 0; shown.length = 0; items.length = 0; folders = ["/p/kural"]; workspaceFile = undefined; windowState = { focused: true }; config = {};
  warn = async () => undefined; info = async () => undefined; openDialog = async () => undefined; input = async () => undefined; pick = async () => undefined; recent = { workspaces: [] }; commandList = stand.commands || ["_kural.card"]; frameAnswer = stand.frame || { enabled: true }; commandsAsked = [];
  fakeModel.built = { sections: [], badge: 0, needLook: 0 };
  const status = new FakeStatus(), store = new Map();
  const ch = { chatsNow: [chat("1", "Refactor notify")], showed: [], did: [], movable: true, projectChats() { return this.chatsNow; }, async showChat(id) { this.showed.push(id); },
    rename(id, title) { this.did.push(["rename", id, title]); }, deleteChat(id) { this.did.push(["delete", id]); }, save() { this.did.push(["save"]); },
    moveOut(id) { this.did.push(["moveOut", id]); return this.movable; }, adopt(id, from) { this.did.push(["adopt", id, from]); return true; },
    rehome(id, home, from) { this.did.push(["rehome", id, home, from]); return true; }, forkCopy(id) { this.did.push(["forkCopy", id]); return this.forkId; }, forkId: "f1",
    reopen(id) { this.did.push(["reopen", id]); }, historyCards(fresh) { this.did.push(["cards", !!fresh]); return this.cards || []; }, cards: [] };
  const ctx = { subscriptions: [], globalState: { get: (k) => store.get(k), update: (k, v) => { store.set(k, v); return Promise.resolve(); } },
    extensionUri: Uri.file("/ext"), globalStorageUri: Uri.file(tmp), store };
  const p = new Projects(ctx, { chat: ch, log: () => {}, deps: { statusStore: status, model: fakeModel, ...extra } });
  p.register();
  p.status.calls.length = 0;
  return { p, status, ch, ctx, store };
}
// A window of Kural built from source: the command _kural.oneFrame is there (the patch), and says whether the setting is on.
const makeFrame = async (answer = { enabled: true }, extra = {}) => {
  const t = make(extra);
  commandList = ["_kural.card", "_kural.oneFrame"]; frameAnswer = answer; ran.length = 0;
  await t.p.detectOneFrame();
  return t;
};
const setModel = (t, sections, o = {}) => { fakeModel.built = { sections, badge: 0, needLook: 0, ...o }; t.p.rebuild(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await check("it publishes this window: project key, name, folders, color, focus and the chats", () => {
    const t = make();
    config = { workspaceColor: "#3F7A5A" };
    t.p.publish();
    const s = t.status.published;
    assert.deepStrictEqual({ ...s, chats: undefined }, { key: "f:/p/kural", name: "kural", folders: ["/p/kural"], workspaceFile: null, color: "#3f7a5a", branch: "", focused: true, chats: undefined });
    assert.deepStrictEqual(s.chats, [chat("1", "Refactor notify")]);
    t.p.stop();
  });

  await check("start: the store starts, this project is adopted, old files pruned, the chat's change event and card route are wired, the view and commands exist", () => {
    ran.length = 0; folders = ["/p/kural"];
    const status = new FakeStatus(), ch = { projectChats: () => [], showChat() {} };
    const ctx = { subscriptions: [], globalState: { get() {}, update: async () => {} }, extensionUri: Uri.file("/ext"), globalStorageUri: Uri.file(tmp) };
    const p = new Projects(ctx, { chat: ch, log: () => {}, deps: { statusStore: status, model: fakeModel } });
    p.register();
    assert.ok(status.calls.includes("start") && status.calls.some((c) => Array.isArray(c) && c[0] === "adopt" && c[1] === "f:/p/kural") && status.calls.includes("prune"));
    assert.strictEqual(typeof ch.onChatsChanged, "function");
    assert.strictEqual(typeof ch.cardElsewhere, "function");
    assert.strictEqual(handlers.provider.id, "kural.projects");
    for (const c of ["kural.projects.show", "kural.projects.open", "kural.projects.newProject", "kural.projects.clone", "kural.projects.collapseAll", "kural.projects.find"]) assert.strictEqual(typeof commands[c], "function", c);
    status.calls.length = 0;
    ch.onChatsChanged();
    assert.ok(status.calls.includes("publish"), "a chat changed: this window's file is written again");
    p.stop();
    assert.ok(status.calls.some((c) => Array.isArray(c) && c[0] === "dispose" && c[1].closed === true), "closed on shutdown");
  });

  await check("a window with no folder has no key and adopts nothing", () => {
    folders = []; ran.length = 0;
    const status = new FakeStatus();
    const ctx = { subscriptions: [], globalState: { get() {}, update: async () => {} }, extensionUri: Uri.file("/ext"), globalStorageUri: Uri.file(tmp) };
    const p = new Projects(ctx, { chat: { projectChats: () => [], showChat() {} }, log: () => {}, deps: { statusStore: status, model: fakeModel } });
    p.register();
    assert.strictEqual(status.published.key, null);
    assert.ok(!status.calls.some((c) => Array.isArray(c) && c[0] === "adopt"));
    p.stop();
  });

  await check("a workspace file is the project: its name, its key", () => {
    const t = make();
    workspaceFile = Uri.file("/w/weld.code-workspace");
    assert.strictEqual(t.p.name(), "weld");
    assert.strictEqual(t.p.key(), "ws:/w/weld.code-workspace");
    workspaceFile = { scheme: "untitled", fsPath: "x" };
    assert.strictEqual(t.p.workspaceFile(), null, "an unsaved workspace isn't a project of its own");
    t.p.stop();
  });

  await check("the model is built from the windows, pins, Open Recent (files on this computer only) and the search", async () => {
    const t = make();
    recent = { workspaces: [{ folderUri: Uri.file("/r/a") }, { folderUri: { scheme: "vscode-remote", fsPath: "/x" } }, { workspace: { configPath: Uri.file("/r/b/b.code-workspace") } }] };
    t.status.windows = [{ windowId: "w-me", key: "f:/p/kural" }];
    t.status.pins = [{ path: "/q", workspaceFile: null }];
    t.p.query = "arc";
    await t.p.loadRecent(); t.p.rebuild();
    assert.deepStrictEqual(fakeModel.args.recent, [{ path: "/r/a", workspaceFile: null }, { path: "/r/b", workspaceFile: "/r/b/b.code-workspace" }]);
    assert.deepStrictEqual(fakeModel.args.windows, t.status.windows);
    assert.deepStrictEqual(fakeModel.args.pins, t.status.pins);
    assert.strictEqual(fakeModel.args.query, "arc");
    t.p.stop();
  });

  await check("the badge, the left bar's number, and the status bar item follow the model", () => {
    const t = make();
    const view = { webview: { options: {}, posted: [], postMessage(m) { this.posted.push(m); }, onDidReceiveMessage() {}, asWebviewUri: (u) => u, cspSource: "csp" }, onDidChangeVisibility() {}, onDidDispose() {}, visible: true };
    handlers.provider.resolveWebviewView(view);
    assert.match(view.webview.html, /font-src csp/);
    assert.match(view.webview.html, /nonce-/);
    setModel(t, [{ id: "open", title: "Open", projects: [proj("w", "weld-sim")] }], { badge: 3, needLook: 2 });
    assert.deepStrictEqual(view.badge, { value: 3, tooltip: "3 chats need a look" });
    assert.strictEqual(items[0].text, "$(folder-library) 2 projects need a look");
    assert.ok(items[0].shown && items[0].command === "kural.projects.show");
    const last = view.webview.posted[view.webview.posted.length - 1];
    assert.strictEqual(last.type, "model");
    assert.strictEqual(last.sections[0].projects[0].name, "weld-sim");
    setModel(t, [], { badge: 1, needLook: 1 });
    assert.strictEqual(items[0].text, "$(folder-library) 1 project needs a look");
    assert.strictEqual(view.badge.tooltip, "1 chat needs a look");
    setModel(t, [], { badge: 0, needLook: 0 });
    assert.strictEqual(view.badge, undefined);
    assert.ok(!items[0].shown);
    t.p.stop();
  });

  await check("the model is told this window's id (its 'here'), and the view keeps what the model says", () => {
    const t = make();
    setModel(t, [{ id: "open", title: "Open", projects: [proj("f:/p/kural", "kural", { here: true }), proj("w", "weld-sim")] }]);
    assert.strictEqual(fakeModel.args.here, "w-me");
    const [a, b] = t.p.built.sections[0].projects;
    assert.ok(a.here && !b.here);
    t.p.stop();
  });

  // ---------- clicks ----------
  const openFolder = () => ran.filter((a) => a[0] === "vscode.openFolder").map(([, u, o]) => [u.fsPath, o]);
  await check("a project open in another window: openFolder brings that window forward; a chat of it is shown there too", async () => {
    const t = make();
    setModel(t, [{ id: "open", title: "Open", projects: [proj("w", "weld-sim", { chats: [chat("5", "Fix the login", "done")] })] }]);
    await t.p.onMessage({ type: "open", key: "w" });
    assert.deepStrictEqual(openFolder(), [["/p/weld-sim", { forceNewWindow: true }]]);
    assert.deepStrictEqual(t.status.sent, []);
    await t.p.onMessage({ type: "openChat", key: "w", chatId: "5" });
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "showChat", chatId: "5" }]]);
    t.p.stop();
  });

  await check("a click on a chat of this window just shows it; the row of this window opens nothing", async () => {
    const t = make();
    setModel(t, [{ id: "open", title: "Open", projects: [proj("f:/p/kural", "kural", { here: true, chats: [chat("1", "x")] })] }]);
    await t.p.onMessage({ type: "openChat", key: "f:/p/kural", chatId: "1" });
    await t.p.onMessage({ type: "open", key: "f:/p/kural" });
    assert.deepStrictEqual(t.ch.showed, ["1"]);
    assert.deepStrictEqual(openFolder(), []);
    t.p.stop();
  });

  await check("a project that isn't open opens in this window; a chat working or waiting here is asked about first", async () => {
    const t = make();
    setModel(t, [{ id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, windowId: null })] }]);
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder().pop(), ["/p/dotfiles", { forceReuseWindow: true }], "this window has a folder: still this window");
    assert.ok(!shown.some((s) => s[0] === "warn"), "nothing working: no question");
    folders = [];
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder().pop(), ["/p/dotfiles", { forceReuseWindow: true }], "no folder: this window");
    t.ch.chatsNow = [chat("1", "Fix the login", "run"), chat("2", "Docs", "ask"), chat("3", "Old", "idle")];
    warn = async () => "Open Here";
    await t.p.onMessage({ type: "open", key: "d" });
    const q = shown.filter((s) => s[0] === "warn").pop();
    assert.strictEqual(q[1], "Open dotfiles in this window?");
    assert.ok(q[2].modal && /2 chats are still working/.test(q[2].detail) && /- Fix the login\n- Docs \(waiting for you\)/.test(q[2].detail) && !/Old/.test(q[2].detail));
    assert.deepStrictEqual(q.slice(3), ["Open Here", "Open in New Window"]);
    assert.deepStrictEqual(openFolder().pop(), ["/p/dotfiles", { forceReuseWindow: true }], "Open Here");
    warn = async () => "Open in New Window";
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder().pop(), ["/p/dotfiles", { forceNewWindow: true }], "Open in New Window keeps this window's chats");
    ran.length = 0; warn = async () => undefined;
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder(), [], "question closed: nothing opens");
    t.p.stop();
  });

  // ---------- one frame (Kural built from source) ----------
  await check("one frame: found at start through the command list (without the underscore filter), then asked once", async () => {
    const t = make();
    assert.strictEqual(t.p.oneFrame, false, "VSCodium's build has no _kural.oneFrame");
    assert.ok(!ran.some((a) => a[0] === "_kural.oneFrame"), "not asked when the command isn't there");
    commandList = ["_kural.card", "_kural.oneFrame"]; commandsAsked = []; ran.length = 0;
    await t.p.detectOneFrame();
    assert.strictEqual(t.p.oneFrame, true);
    assert.deepStrictEqual(commandsAsked, [undefined], "getCommands(true) would leave out every command that starts with an underscore");
    assert.deepStrictEqual(ran.filter((a) => a[0] === "_kural.oneFrame"), [["_kural.oneFrame"]]);
    frameAnswer = { enabled: false };
    await t.p.detectOneFrame();
    assert.strictEqual(t.p.oneFrame, false, "the setting is off");
    frameAnswer = undefined;
    await t.p.detectOneFrame();
    assert.strictEqual(t.p.oneFrame, false, "no answer: off");
    t.p.stop();
  });

  await check("one frame: starting the extension looks for it, and the setting changing looks again", async () => {
    const t = make({}, { commands: ["_kural.oneFrame"], frame: { enabled: true } });
    await sleep(5);
    assert.strictEqual(t.p.oneFrame, true, "found while starting");
    frameAnswer = { enabled: false };
    for (const f of handlers.configs) f({ affectsConfiguration: (k) => k === "kural.window.oneFrame" });
    await sleep(5);
    assert.strictEqual(t.p.oneFrame, false, "the setting was turned off");
    t.p.stop();
  });

  await check("one frame: a miss at start-up isn't final: asked again before a project opens (Linux: not 'one project at a time')", async () => {
    const t = make();
    assert.strictEqual(t.p.oneFrame, false, "the workbench hadn't registered the command yet");
    commandList = ["_kural.card", "_kural.oneFrame"]; frameAnswer = { enabled: true }; ran.length = 0;
    setModel(t, [{ id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, windowId: null })] }]);
    t.ch.chatsNow = [chat("1", "Fix the login", "run")];
    warn = async () => "Open Here";
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder(), [["/p/dotfiles", { forceNewWindow: true }]], "a new window, not forceReuseWindow");
    assert.strictEqual(t.p.oneFrame, true);
    t.p.stop();
  });

  await check("one frame: a miss is asked again a few times, and stop() ends it", async () => {
    const t = make();
    await sleep(5); // (the start's own look, and its follow-up, are over)
    commandList = ["_kural.card"]; frameAnswer = { enabled: true };
    t.later = []; t.p.later = (name, ms, fn) => { if (name === "frame") t.later.push([name, ms, fn]); };
    t.p.detectOneFrameLater(2);
    assert.strictEqual(t.later.length, 1);
    commandList = ["_kural.card", "_kural.oneFrame"];
    await t.later[0][2]();
    assert.strictEqual(t.p.oneFrame, true, "found on the second look");
    assert.strictEqual(t.later.length, 1, "found: no more looks");
    t.p.oneFrame = false; t.p.stop();
    t.p.detectOneFrameLater(2);
    assert.strictEqual(t.later.length, 1, "stopped: no look");
  });

  await check("one frame: a project that isn't open opens in a new window, with no question and nothing stopped", async () => {
    const t = await makeFrame();
    t.ch.chatsNow = [chat("1", "Fix the login", "run"), chat("2", "Docs", "ask")];
    warn = async () => "Open Here";
    setModel(t, [{ id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, windowId: null })] }]);
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder(), [["/p/dotfiles", { forceNewWindow: true }]]);
    assert.ok(!shown.some((s) => s[0] === "warn"), "no Open Here / Open in New Window question");
    folders = [];
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder().pop(), ["/p/dotfiles", { forceNewWindow: true }], "no folder in this window: still a new window, which takes its place");
    t.p.stop();
  });

  await check("one frame: Open folder (picked), a workspace file, and New empty project all open in a new window", async () => {
    const t = await makeFrame({ enabled: true }, { findGit: async () => null });
    openDialog = async () => [Uri.file("/picked/one")];
    await commands["kural.projects.open"]();
    assert.deepStrictEqual(openFolder(), [["/picked/one", { forceNewWindow: true }]]);
    ran.length = 0;
    await t.p.openPath("/w/weld.code-workspace");
    assert.deepStrictEqual(openFolder(), [["/w/weld.code-workspace", { forceNewWindow: true }]]);
    ran.length = 0;
    const parent = fs.mkdtempSync(path.join(tmp, "parent-"));
    input = async () => "fresh-one"; openDialog = async () => [Uri.file(parent)];
    await commands["kural.projects.newProject"]();
    assert.deepStrictEqual(openFolder(), [[path.join(parent, "fresh-one"), { forceNewWindow: true }]]);
    assert.ok(!shown.some((s) => s[0] === "warn"));
    t.p.stop();
  });

  await check("one frame: an open project and its chats are brought forward as before, this window's row opens nothing", async () => {
    const t = await makeFrame();
    setModel(t, [{ id: "open", title: "Open", projects: [proj("f:/p/kural", "kural", { here: true, chats: [chat("1", "x")] }), proj("w", "weld-sim", { chats: [chat("5", "Fix the login", "done")] })] }]);
    await t.p.onMessage({ type: "open", key: "w" });
    assert.deepStrictEqual(openFolder(), [["/p/weld-sim", { forceNewWindow: true }]]);
    await t.p.onMessage({ type: "openChat", key: "w", chatId: "5" });
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "showChat", chatId: "5" }]]);
    ran.length = 0;
    await t.p.onMessage({ type: "open", key: "f:/p/kural" });
    await t.p.onMessage({ type: "openChat", key: "f:/p/kural", chatId: "1" });
    assert.deepStrictEqual(openFolder(), []);
    assert.deepStrictEqual(t.ch.showed, ["1"]);
    t.p.stop();
  });

  await check("one frame found but switched off: today's behaviour (this window, with the question)", async () => {
    const t = await makeFrame({ enabled: false });
    assert.strictEqual(t.p.oneFrame, false);
    setModel(t, [{ id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, windowId: null })] }]);
    await t.p.onMessage({ type: "open", key: "d" });
    assert.deepStrictEqual(openFolder().pop(), ["/p/dotfiles", { forceReuseWindow: true }]);
    t.ch.chatsNow = [chat("1", "Fix the login", "run")];
    warn = async () => "Open in New Window";
    await t.p.onMessage({ type: "open", key: "d" });
    assert.ok(shown.some((s) => s[0] === "warn" && s[1] === "Open dotfiles in this window?"));
    assert.deepStrictEqual(openFolder().pop(), ["/p/dotfiles", { forceNewWindow: true }]);
    t.p.stop();
  });

  await check("a workspace file opens as the workspace file", async () => {
    const t = make();
    setModel(t, [{ id: "recent", title: "Recent", projects: [proj("ws", "weld", { open: false, windowId: null, workspaceFile: "/w/weld.code-workspace", path: "/w" })] }]);
    await t.p.onMessage({ type: "open", key: "ws" });
    assert.strictEqual(openFolder().pop()[0], "/w/weld.code-workspace");
    t.p.stop();
  });

  await check("pin and unpin go to the shared pins; fold is kept; Collapse all folds every project", async () => {
    const t = make();
    setModel(t, [{ id: "open", title: "Open", projects: [proj("w", "weld-sim"), proj("k", "kural", { pinned: true, workspaceFile: "/w/k.code-workspace" })] }]);
    await t.p.onMessage({ type: "pin", key: "w" });
    await t.p.onMessage({ type: "pin", key: "k" });
    assert.deepStrictEqual(t.status.calls.filter((c) => c[0] === "pin"), [["pin", { path: "/p/weld-sim", workspaceFile: null }, true], ["pin", { path: "/p/kural", workspaceFile: "/w/k.code-workspace" }, false]]);
    await t.p.onMessage({ type: "fold", key: "w", folded: true });
    assert.deepStrictEqual(t.store.get("kural.projects.folded.v1"), ["w"]);
    await t.p.onMessage({ type: "fold", key: "w", folded: false });
    assert.deepStrictEqual(t.store.get("kural.projects.folded.v1"), []);
    await commands["kural.projects.collapseAll"]();
    assert.deepStrictEqual(t.store.get("kural.projects.folded.v1").sort(), ["k", "w"]);
    t.p.stop();
  });

  await check("the title bar's search shows the Projects view and opens the page's search box (also once the page is ready)", async () => {
    const t = make();
    await commands["kural.projects.find"]();
    assert.ok(ran.some((a) => a[0] === "workbench.view.extension.kural-projects"));
    const view = { webview: { options: {}, posted: [], postMessage(m) { this.posted.push(m); }, onDidReceiveMessage() {}, asWebviewUri: (u) => u, cspSource: "csp" }, onDidChangeVisibility() {}, onDidDispose() {}, visible: true };
    t.p.resolve(view);
    await t.p.onMessage({ type: "ready", q: "" });
    assert.ok(view.webview.posted.some((m) => m.type === "find"), "the page wasn't there yet: it gets it when ready");
    view.webview.posted.length = 0;
    await commands["kural.projects.find"]();
    assert.deepStrictEqual(view.webview.posted.filter((m) => m.type === "find"), [{ type: "find" }]);
    await t.p.onMessage({ type: "ready", q: "" });
    assert.strictEqual(view.webview.posted.filter((m) => m.type === "find").length, 1, "only once");
    t.p.stop();
  });

  // ---- a chat's right-click menu and dragging (rename, delete, move) ----
  const CHATS = () => [{ id: "open", title: "Open", projects: [
    proj("f:/p/kural", "kural", { here: true, windowId: "w-me", chats: [chat("1", "Refactor notify"), chat("2", "Tune the arc", "run")] }),
    proj("w", "weld-sim", { chats: [chat("5", "Fix the login", "done")] }),
    proj("x", "mesh", { chats: [] })] },
  { id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, windowId: null, chats: [chat("9", "Old one", "done")] })] }];

  await check("rename: a chat here is renamed by this window's chat; one in another window by a request to it; empty names and closed projects do nothing", async () => {
    const t = make(); setModel(t, CHATS());
    await t.p.onMessage({ type: "renameChat", key: "f:/p/kural", chatId: "1", title: "Notify refactor" });
    assert.deepStrictEqual(t.ch.did, [["rename", "1", "Notify refactor"]]);
    await t.p.onMessage({ type: "renameChat", key: "w", chatId: "5", title: "Login fix" });
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "renameChat", chatId: "5", title: "Login fix" }]]);
    await t.p.onMessage({ type: "renameChat", key: "w", chatId: "5", title: "   " });
    await t.p.onMessage({ type: "renameChat", key: "d", chatId: "9", title: "x" });
    await t.p.onMessage({ type: "renameChat", key: "w", chatId: "nope", title: "x" });
    assert.strictEqual(t.status.sent.length, 1);
    assert.strictEqual(t.ch.did.length, 1);
    t.p.stop();
  });

  await check("the menu's Rename asks the page to edit the title in place", async () => {
    const t = make(); setModel(t, CHATS());
    const view = { webview: { options: {}, posted: [], postMessage(m) { this.posted.push(m); }, onDidReceiveMessage() {}, asWebviewUri: (u) => u, cspSource: "csp" }, onDidChangeVisibility() {}, onDidDispose() {}, visible: true };
    t.p.resolve(view);
    await commands["kural.projects.renameChat"]({ webviewSection: "chat", key: "w", chatId: "5" });
    assert.deepStrictEqual(view.webview.posted.filter((m) => m.type === "rename"), [{ type: "rename", key: "w", chatId: "5" }]);
    t.p.stop();
  });

  await check("delete: asks first (a working chat is named as stopping); Delete removes it here or asks its window; cancel does nothing", async () => {
    const t = make(); setModel(t, CHATS());
    await commands["kural.projects.deleteChat"]({ webviewSection: "chat", key: "f:/p/kural", chatId: "2" });
    const q = shown.find((x) => x[0] === "warn");
    assert.match(q[1], /Delete "Tune the arc"\?/);
    assert.ok(q[2].modal && /History/.test(q[2].detail) && /working/i.test(q[2].detail));
    assert.deepStrictEqual(t.ch.did, [], "cancelled");
    warn = async () => "Delete";
    await commands["kural.projects.deleteChat"]({ webviewSection: "chat", key: "f:/p/kural", chatId: "1" });
    assert.deepStrictEqual(t.ch.did, [["delete", "1"], ["save"]]);
    await commands["kural.projects.deleteChat"]({ webviewSection: "chat", key: "w", chatId: "5" });
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "deleteChat", chatId: "5" }]]);
    t.p.stop();
  });

  await check("move by dragging: from this window the chat goes out and the other window is asked to take it in; from another window, that window is asked", async () => {
    const t = make(); setModel(t, CHATS());
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "1", to: "w" });
    assert.deepStrictEqual(t.ch.did, [["moveOut", "1"]]);
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "adoptChat", chatId: "1", from: "kural" }]]);
    t.status.sent.length = 0;
    await t.p.onMessage({ type: "moveChat", key: "w", chatId: "5", to: "x" });
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "moveChat", chatId: "5", toWindow: "w-mesh", from: "weld-sim" }]]);
    t.p.stop();
  });

  await check("move: not to its own project, not a working chat; a chat that can't go says so", async () => {
    const t = make(); setModel(t, CHATS());
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "1", to: "f:/p/kural" });
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "2", to: "w" });
    assert.deepStrictEqual(t.ch.did, []);
    assert.deepStrictEqual(t.status.sent, []);
    t.ch.movable = false;
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "1", to: "w" });
    assert.deepStrictEqual(t.status.sent, [], "the chat refused: nothing is sent");
    assert.ok(shown.some((x) => x[0] === "info" && /can't be moved/.test(x[1])));
    t.p.stop();
  });

  await check("Move to...: a list of the other open projects; the pick moves the chat", async () => {
    const t = make(); setModel(t, CHATS());
    pick = async (list) => list.find((i) => i.label === "mesh");
    await commands["kural.projects.moveChat"]({ webviewSection: "chat", key: "f:/p/kural", chatId: "1" });
    const [, list] = shown.find((x) => x[0] === "pick");
    assert.deepStrictEqual(list.map((i) => i.label), ["weld-sim", "mesh", "dotfiles"], "open projects and folders without a window, not its own");
    assert.deepStrictEqual(t.status.sent, [["w-mesh", { type: "adoptChat", chatId: "1", from: "kural" }]]);
    t.p.stop();
  });

  await check("requests from other windows: rename, delete, move out (then the target is asked), adopt", async () => {
    const t = make(); setModel(t, CHATS());
    await t.p.onRequest({ type: "renameChat", chatId: "1", title: "New name" });
    await t.p.onRequest({ type: "deleteChat", chatId: "1" });
    await t.p.onRequest({ type: "moveChat", chatId: "1", toWindow: "w-mesh", from: "kural" });
    await t.p.onRequest({ type: "adoptChat", chatId: "7", from: "weld-sim" });
    assert.deepStrictEqual(t.ch.did, [["rename", "1", "New name"], ["delete", "1"], ["save"], ["moveOut", "1"], ["adopt", "7", "weld-sim"]]);
    assert.deepStrictEqual(t.status.sent, [["w-mesh", { type: "adoptChat", chatId: "1", from: "kural" }]]);
    t.p.stop();
  });

  // ---- History, a move to a project without a window, fork ----
  const WITH_HISTORY = () => { const m = CHATS(); m[0].projects[0].history = { open: true, loaded: true, total: 1, items: [{ id: "h1", title: "Saved one", when: 1, count: 2, ago: "1 h ago" }] }; return m; };
  await check("History: unfolding is remembered and read from disk; folding stops reading; the model gets the cards and the open keys", async () => {
    const t = make(); setModel(t, CHATS());
    assert.strictEqual(fakeModel.args.archive, null, "folded everywhere: no cards are read");
    t.ch.cards = [{ id: "h1" }]; t.ch.did.length = 0;
    await t.p.onMessage({ type: "historyFold", key: "f:/p/kural", open: true });
    assert.deepStrictEqual(t.ch.did, [["cards", true]]);
    assert.deepStrictEqual(fakeModel.args.archive, [{ id: "h1" }]);
    assert.deepStrictEqual(fakeModel.args.historyOpen, ["f:/p/kural"]);
    assert.deepStrictEqual(t.store.get("kural.projects.historyOpen.v1"), ["f:/p/kural"]);
    await t.p.onMessage({ type: "historyFold", key: "f:/p/kural", open: false });
    assert.deepStrictEqual(t.store.get("kural.projects.historyOpen.v1"), []);
    assert.strictEqual(fakeModel.args.archive, null);
    t.p.stop();
  });

  await check("History: a click opens the chat in this window; in another project's window that window is brought forward and asked; a project without a window shows it here", async () => {
    const t = make(); setModel(t, WITH_HISTORY());
    await t.p.onMessage({ type: "openHistory", key: "f:/p/kural", chatId: "h1" });
    assert.deepStrictEqual(t.ch.did, [["reopen", "h1"]]);
    assert.deepStrictEqual(t.ch.showed, ["h1"]);
    ran.length = 0;
    await t.p.onMessage({ type: "openHistory", key: "w", chatId: "h2" });
    assert.ok(ran.some((a) => a[0] === "vscode.openFolder" && a[2].forceNewWindow));
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "showHistory", chatId: "h2" }]]);
    t.ch.did.length = 0; ran.length = 0;
    await t.p.onMessage({ type: "openHistory", key: "d", chatId: "h3" });
    assert.deepStrictEqual(t.ch.did, [["reopen", "h3"]], "read here (visiting), nothing is opened or stopped");
    assert.ok(!ran.some((a) => a[0] === "vscode.openFolder"));
    await t.p.onRequest({ type: "showHistory", chatId: "h4" });
    assert.deepStrictEqual(t.ch.did[1], ["reopen", "h4"]);
    t.p.stop();
  });

  await check("move to a project without a window: a chat of this window goes out and is filed under the target; one of another window is asked to do it", async () => {
    const t = make(); setModel(t, CHATS());
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "1", to: "d" });
    assert.deepStrictEqual(t.ch.did, [["moveOut", "1"], ["rehome", "1", { key: "/p/dotfiles", name: "dotfiles", open: "/p/dotfiles" }, "kural"]]);
    assert.deepStrictEqual(t.status.sent, []);
    await t.p.onMessage({ type: "moveChat", key: "w", chatId: "5", to: "d" });
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "moveChat", chatId: "5", toWindow: null, from: "weld-sim", home: { key: "/p/dotfiles", name: "dotfiles", open: "/p/dotfiles" } }]]);
    t.ch.did.length = 0;
    await t.p.onRequest({ type: "moveChat", chatId: "5", toWindow: null, from: "weld-sim", home: { key: "/p/dotfiles", name: "dotfiles", open: "/p/dotfiles" } });
    assert.deepStrictEqual(t.ch.did[0], ["moveOut", "5"]);
    assert.strictEqual(t.ch.did[1][0], "rehome");
    t.p.stop();
  });

  await check("move: a project that is a workspace file and has no window can't take a chat", async () => {
    const t = make(); const m = CHATS(); m[1].projects[0].workspaceFile = "/w/x.code-workspace"; setModel(t, m);
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "1", to: "d" });
    assert.deepStrictEqual(t.ch.did, []);
    t.p.stop();
  });

  await check("move a History chat: to an open project (this window adopts it, another window is asked) or filed under a project without a window; not into its own project", async () => {
    const t = make(); const m = WITH_HISTORY(); m[0].projects[1].history = { open: true, loaded: true, total: 1, items: [{ id: "h5", title: "Weld old", when: 1, ago: "1 h ago" }] }; setModel(t, m);
    await t.p.onMessage({ type: "moveChat", key: "w", chatId: "h5", to: "f:/p/kural" });
    assert.deepStrictEqual(t.ch.did, [["adopt", "h5", "weld-sim"]], "into this window: adopted at once");
    t.ch.did.length = 0;
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "h1", to: "w" });
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "adoptChat", chatId: "h1", from: "kural" }]]);
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "h1", to: "d" });
    assert.deepStrictEqual(t.ch.did, [["rehome", "h1", { key: "/p/dotfiles", name: "dotfiles", open: "/p/dotfiles" }, "kural"]]);
    t.ch.did.length = 0;
    await t.p.onMessage({ type: "moveChat", key: "f:/p/kural", chatId: "h1", to: "f:/p/kural" });
    assert.deepStrictEqual(t.ch.did, []);
    t.p.stop();
  });

  await check("Fork to...: a list of the open projects (its own too); a chat of this window or a saved chat is copied here and the target's window takes the copy in", async () => {
    const t = make(); setModel(t, WITH_HISTORY());
    pick = async (list) => list.find((i) => i.label === "mesh");
    await commands["kural.projects.forkChat"]({ webviewSection: "chat", key: "f:/p/kural", chatId: "1" });
    const [, list] = shown.find((x) => x[0] === "pick");
    assert.deepStrictEqual(list.map((i) => i.label), ["kural", "weld-sim", "mesh"], "open projects only");
    assert.deepStrictEqual(t.ch.did, [["forkCopy", "1"]]);
    assert.deepStrictEqual(t.status.sent, [["w-mesh", { type: "adoptChat", chatId: "f1", from: "kural" }]]);
    t.ch.did.length = 0; t.status.sent.length = 0;
    pick = async (list) => list.find((i) => i.label === "kural");
    await commands["kural.projects.forkChat"]({ webviewSection: "history", key: "f:/p/kural", chatId: "h1" });
    assert.deepStrictEqual(t.ch.did, [["forkCopy", "h1"], ["adopt", "f1", "kural"]], "into this window: adopted at once");
    t.p.stop();
  });

  await check("fork: a chat that is open in another window is copied by that window (a request); a chat that can't be copied says so", async () => {
    const t = make(); setModel(t, WITH_HISTORY());
    t.p.forkChat("w", "5", "x");
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "forkChat", chatId: "5", toWindow: "w-mesh", from: "weld-sim" }]]);
    assert.deepStrictEqual(t.ch.did, []);
    t.status.sent.length = 0;
    await t.p.onRequest({ type: "forkChat", chatId: "5", toWindow: "w-mesh", from: "weld-sim" });
    assert.deepStrictEqual(t.ch.did, [["forkCopy", "5"]]);
    assert.deepStrictEqual(t.status.sent, [["w-mesh", { type: "adoptChat", chatId: "f1", from: "weld-sim" }]]);
    t.ch.did.length = 0; t.status.sent.length = 0; t.ch.forkId = null;
    await t.p.onRequest({ type: "forkChat", chatId: "5", toWindow: "w-mesh", from: "weld-sim" });
    assert.deepStrictEqual(t.status.sent, []);
    assert.ok(shown.some((x) => x[0] === "info" && /can't be forked/.test(x[1])));
    t.p.stop();
  });

  await check("project menu: Pin, Unpin, Close and Remove from Recent do what the row's buttons do", async () => {
    const t = make(); setModel(t, CHATS());
    await commands["kural.projects.pin"]({ webviewSection: "project", key: "w" });
    await commands["kural.projects.unpin"]({ webviewSection: "project", key: "w" });
    assert.strictEqual(t.status.calls.filter((c) => c[0] === "pin").length, 2);
    for (const c of ["kural.projects.close", "kural.projects.removeRecent"]) assert.strictEqual(typeof commands[c], "function", c);
    t.p.stop();
  });

  await check("search and ready tell the host what is typed, and the model is built with it", async () => {
    const t = make();
    await t.p.onMessage({ type: "ready", q: "weld" });
    assert.strictEqual(fakeModel.args.query, "weld");
    await t.p.onMessage({ type: "search", q: "" });
    assert.strictEqual(fakeModel.args.query, "");
    t.p.stop();
  });

  await check("the bin removes a Recent project from VS Code's list, and the list is read again", async () => {
    const t = make();
    setModel(t, [{ id: "recent", title: "Recent", projects: [proj("d", "dotfiles", { open: false, windowId: null })] }]);
    ran.length = 0;
    await t.p.onMessage({ type: "removeRecent", key: "d" });
    assert.deepStrictEqual(ran[0], ["vscode.removeFromRecentlyOpened", "/p/dotfiles"]);
    assert.ok(ran.some((a) => a[0] === "_workbench.getRecentlyOpened"));
    t.p.stop();
  });

  // ---------- closing ----------
  await check("the cross asks first: names the working and waiting chats, says Closing stops them and that chats stay in History; Cancel does nothing", async () => {
    const t = make();
    const chats = [chat("3", "Tune the arc model", "run"), chat("6", "Fix broken links", "ask"), chat("5", "Fix the login", "done"), chat("9", "Mesh import")];
    setModel(t, [{ id: "open", title: "Open", projects: [proj("w", "weld-sim", { chats })] }]);
    warn = async () => undefined;                 // Cancel / closed the dialog
    await t.p.onMessage({ type: "close", key: "w" });
    const [kind, message, opts, button] = shown.find((s) => s[0] === "warn");
    assert.strictEqual(message, "Close weld-sim?");
    assert.strictEqual(opts.modal, true);
    assert.strictEqual(button, "Close project");
    assert.match(opts.detail, /2 chats are still working or waiting for you\. Closing stops them:/);
    assert.match(opts.detail, /- Tune the arc model\n/);
    assert.match(opts.detail, /- Fix broken links \(waiting for you\)\n/);
    assert.ok(!opts.detail.includes("Mesh import") && !opts.detail.includes("Fix the login"));
    assert.match(opts.detail, /Your chats stay in History/);
    assert.strictEqual(kind, "warn");
    assert.deepStrictEqual(openFolder(), []);
    assert.deepStrictEqual(t.status.sent, []);
    assert.ok(!ran.some((a) => a[0] === "workbench.action.closeWindow"));
    t.p.stop();
  });

  await check("one working chat is worded in the singular; no working chat says the window closes", async () => {
    const t = make();
    setModel(t, [{ id: "open", title: "Open", projects: [proj("w", "weld-sim", { chats: [chat("3", "Tune", "run")] }), proj("c", "calm", { chats: [chat("4", "Idle")] })] }]);
    await t.p.onMessage({ type: "close", key: "w" });
    assert.match(shown.filter((s) => s[0] === "warn")[0][2].detail, /1 chat is still working or waiting for you\. Closing stops it:/);
    await t.p.onMessage({ type: "close", key: "c" });
    assert.match(shown.filter((s) => s[0] === "warn")[1][2].detail, /^Its window closes\./);
    t.p.stop();
  });

  await check("confirmed: this window closes itself; another window is brought forward and then told to close", async () => {
    const t = make();
    setModel(t, [{ id: "open", title: "Open", projects: [proj("f:/p/kural", "kural", { here: true }), proj("w", "weld-sim")] }]);
    warn = async (m, o, button) => button;
    await t.p.onMessage({ type: "close", key: "f:/p/kural" });
    assert.ok(ran.some((a) => a[0] === "workbench.action.closeWindow"));
    assert.match(shown.filter((s) => s[0] === "warn")[0][2].detail, /^This window closes\./);
    ran.length = 0;
    await t.p.onMessage({ type: "close", key: "w" });
    assert.deepStrictEqual(openFolder(), [["/p/weld-sim", { forceNewWindow: true }]]);
    assert.deepStrictEqual(t.status.sent, [["w-weld-sim", { type: "close" }]]);
    assert.ok(!ran.some((a) => a[0] === "workbench.action.closeWindow"), "not this window");
    t.p.stop();
  });

  // ---------- a new project ----------
  await check("a name: not empty, no / \\ or :, and the folder must not exist", () => {
    const t = make();
    const dir = fs.mkdtempSync(path.join(tmp, "p-"));
    fs.mkdirSync(path.join(dir, "taken"));
    assert.strictEqual(t.p.nameProblem("", dir), "Give the project a name.");
    assert.strictEqual(t.p.nameProblem("   ", dir), "Give the project a name.");
    for (const bad of ["a/b", "a\\b", "c:x"]) assert.match(t.p.nameProblem(bad, dir), /can't contain/);
    assert.ok(t.p.nameProblem("..", dir));
    assert.match(t.p.nameProblem("taken", dir), /already exists/);
    assert.strictEqual(t.p.nameProblem("fresh", dir), null);
    assert.strictEqual(t.p.nameProblem(" fresh ", dir), null);
    t.p.stop();
  });

  await check("a name that Windows refuses is refused on every system: <>:\"|?* and control characters, a trailing dot, CON & co.", () => {
    const t = make();
    const dir = fs.mkdtempSync(path.join(tmp, "pw-"));
    for (const bad of ["x:y", "a<b", "a>b", "a\"b", "a|b", "a?b", "a*b", "a\u0001b", "a\tb"]) assert.match(t.p.nameProblem(bad, dir), /can't contain/, JSON.stringify(bad));
    for (const bad of ["a.", "name..."]) assert.match(t.p.nameProblem(bad, dir), /can't end with a dot/, bad);
    for (const bad of ["CON", "con", "Prn", "AUX", "nul", "COM1", "com9", "LPT1", "lpt9", "CON.txt", "nul.tar.gz", "aux ."]) assert.match(t.p.nameProblem(bad, dir), /Windows keeps for itself|can't end/, bad);
    for (const fine of ["console", "com", "com0", "com10", "lpt", "my.project", "a b", ".hidden", "nullable", "CON-sole", "v1.2"]) assert.strictEqual(t.p.nameProblem(fine, dir), null, fine);
    t.p.stop();
  });

  await check("the last place for new projects is used only when it is an absolute, existing, unprotected folder", () => {
    const t = make();
    const dir = fs.mkdtempSync(path.join(tmp, "last-"));
    t.store.set("kural.projects.lastParent.v1", dir);
    assert.strictEqual(t.p.parentFolder(), dir);
    for (const bad of ["relative/folder", "C:\\nowhere\\at\\all", path.join(dir, "missing"), 42, ""]) {
      t.store.set("kural.projects.lastParent.v1", bad);
      assert.strictEqual(t.p.parentFolder(), os.homedir(), String(bad));
    }
    t.store.set("kural.projects.lastParent.v1", os.homedir());
    assert.strictEqual(t.p.parentFolder(), os.homedir());
    t.p.stop();
  });

  await check("git init uses the git program found (git.exe on Windows) with no console window", async () => {
    const gits = [];
    const t = make({ findGit: async () => "C:\\Program Files\\Git\\cmd\\git.exe", execFile: (bin, args, o, cb) => { gits.push([bin, args, o]); cb(null); } });
    assert.strictEqual(await t.p.gitInit("C:\\Code\\new"), true);
    assert.strictEqual(gits[0][0], "C:\\Program Files\\Git\\cmd\\git.exe");
    assert.deepStrictEqual(gits[0][1], ["init"]);
    assert.strictEqual(gits[0][2].cwd, "C:\\Code\\new");
    assert.strictEqual(gits[0][2].windowsHide, true);
    t.p.stop();
  });

  await check("the branch comes from the repository that is this window's folder, on Windows whatever the drive letter's case", () => {
    const repo = (root, name) => ({ rootUri: { fsPath: root }, state: { HEAD: { name } } });
    const api = { repositories: [repo("C:\\Code\\Other", "other"), repo("C:\\Code\\App", "feature")] };
    const win = make({ platform: "win32" });
    folders = ["c:\\code\\app"];
    win.p.readBranch(api);
    assert.strictEqual(win.p.branch, "feature");
    win.p.stop();
    // on Linux the same two spellings are two folders: no match, so the first repository is taken
    const lin = make({ platform: "linux" });
    folders = ["c:\\code\\app"];
    lin.p.readBranch(api);
    assert.strictEqual(lin.p.branch, "other");
    lin.p.stop();
  });

  await check("New empty project: name, a folder to put it in, mkdir, git init, a new window; the place is remembered", async () => {
    const gits = [];
    const t = make({ findGit: async () => "/usr/bin/gitx", execFile: (bin, args, o, cb) => { gits.push([bin, args, o.cwd]); cb(null); } });
    const parent = fs.mkdtempSync(path.join(tmp, "parent-"));
    input = async () => " my-new ";
    openDialog = async () => [Uri.file(parent)];
    await commands["kural.projects.newProject"]();
    const dir = path.join(parent, "my-new");
    assert.ok(fs.statSync(dir).isDirectory());
    assert.deepStrictEqual(gits, [["/usr/bin/gitx", ["init"], dir]]);
    assert.deepStrictEqual(openFolder(), [[dir, { forceNewWindow: true }]]);
    assert.strictEqual(t.store.get("kural.projects.lastParent.v1"), parent);
    const dialog = shown.find((s) => s[0] === "dialog")[1];
    assert.strictEqual(dialog.canSelectFolders, true);
    assert.strictEqual(dialog.defaultUri.fsPath, os.homedir(), "home the first time");
    // the input box checks the name as you type
    const box = shown.find((s) => s[0] === "input")[1];
    assert.strictEqual(box.validateInput(""), "Give the project a name.");
    assert.strictEqual(box.validateInput("ok"), undefined);
    // the next time it starts where you made the last one
    shown.length = 0; input = async () => undefined;
    await commands["kural.projects.newProject"]();
    assert.strictEqual(shown.find((s) => s[0] === "input")[1].title, "New empty project");
    input = async () => "second"; openDialog = async () => undefined;
    await commands["kural.projects.newProject"]();
    assert.strictEqual(shown.filter((s) => s[0] === "dialog").pop()[1].defaultUri.fsPath, parent);
    t.p.stop();
  });

  await check("a protected folder is never the starting place", () => {
    const t = make();
    const isProtected = require("../extension/lib/paths").isProtected;
    const docs = path.join(os.homedir(), "Documents");
    t.store.set("kural.projects.lastParent.v1", docs);
    assert.strictEqual(t.p.parentFolder(), isProtected(docs) ? os.homedir() : t.p.parentFolder());
    t.store.set("kural.projects.lastParent.v1", "/does/not/exist");
    assert.strictEqual(t.p.parentFolder(), os.homedir());
    t.p.stop();
  });

  await check("no Git on this computer: the folder is made and opened, and a message says it isn't set up with Git", async () => {
    const t = make({ findGit: async () => null });
    const parent = fs.mkdtempSync(path.join(tmp, "parent-"));
    input = async () => "plain"; openDialog = async () => [Uri.file(parent)];
    await commands["kural.projects.newProject"]();
    assert.ok(fs.existsSync(path.join(parent, "plain")));
    assert.ok(shown.some((s) => s[0] === "info" && /no Git/.test(s[1])));
    assert.strictEqual(openFolder().length, 1);
    t.p.stop();
  });

  await check("a folder that exists by the time you pick the place stops with a message; cancelling the picker makes nothing", async () => {
    const t = make({ findGit: async () => null });
    const parent = fs.mkdtempSync(path.join(tmp, "parent-"));
    fs.mkdirSync(path.join(parent, "there"));
    input = async () => "there"; openDialog = async () => [Uri.file(parent)];
    await commands["kural.projects.newProject"]();
    assert.ok(shown.some((s) => s[0] === "error" && /already exists/.test(s[1])));
    assert.deepStrictEqual(openFolder(), []);
    shown.length = 0; openDialog = async () => undefined; input = async () => "nothing-made";
    await commands["kural.projects.newProject"]();
    assert.ok(!fs.existsSync(path.join(os.homedir(), "nothing-made")));
    assert.deepStrictEqual(openFolder(), []);
    t.p.stop();
  });

  await check("Open folder opens the picked folder by the same rules; Clone Git repository is the git extension's command", async () => {
    const t = make();
    openDialog = async () => [Uri.file("/picked/one")];
    await commands["kural.projects.open"]();
    assert.deepStrictEqual(openFolder(), [["/picked/one", { forceReuseWindow: true }]], "not open anywhere: this window");
    setModel(t, [{ id: "open", title: "Open", projects: [proj("f:/picked/two", "two", { path: "/picked/two" })] }]);
    await t.p.openPath("/picked/two");
    assert.deepStrictEqual(openFolder().pop(), ["/picked/two", { forceNewWindow: true }], "open elsewhere: brought forward");
    ran.length = 0;
    await commands["kural.projects.clone"]();
    assert.deepStrictEqual(ran[0], ["git.clone"]);
    t.p.stop();
  });

  // ---------- requests from other windows ----------
  await check("requests in: show a chat, close this window", async () => {
    const t = make();
    await t.p.onRequest({ type: "showChat", chatId: "7" });
    assert.deepStrictEqual(t.ch.showed, ["7"]);
    await t.p.onRequest({ type: "close" });
    assert.ok(ran.some((a) => a[0] === "workbench.action.closeWindow"));
    t.p.stop();
  });

  await check("the card: drawn by _kural.card (12 s); a click sends 'show the chat' back and brings that window forward", async () => {
    const t = make();
    t.status.windows = [{ windowId: "w-weld", key: "f:/p/weld-sim", folders: ["/p/weld-sim"], workspaceFile: null }];
    handlers.cardAnswer = { clicked: false };
    const req = { type: "card", from: "w-weld", chatId: "4", title: 'weld-sim: "Tune" is done', body: "4 files changed.", button: "Go to weld-sim", color: "#4b6f9c", letter: "W" };
    await t.p.onRequest(req);
    const card = ran.find((a) => a[0] === "_kural.card")[1];
    assert.deepStrictEqual({ ...card, id: undefined }, { id: undefined, title: req.title, body: req.body, button: req.button, color: "#4b6f9c", letter: "W", timeout: 12000 });
    assert.deepStrictEqual(t.status.sent, [], "not clicked: nothing sent");
    handlers.cardAnswer = { clicked: true };
    await t.p.onRequest(req);
    assert.deepStrictEqual(openFolder(), [["/p/weld-sim", { forceNewWindow: true }]]);
    assert.deepStrictEqual(t.status.sent, [["w-weld", { type: "showChat", chatId: "4" }]]);
    t.p.stop();
  });

  await check("without the workbench's card command: an information message with the button", async () => {
    const t = make();
    commandList = [];
    t.status.windows = [{ windowId: "w-weld", folders: ["/p/weld-sim"] }];
    info = async () => "Go to weld-sim";
    await t.p.onRequest({ type: "card", from: "w-weld", chatId: "4", title: "weld-sim: Tune is done", body: "Finished in another window.", button: "Go to weld-sim" });
    assert.ok(!ran.some((a) => a[0] === "_kural.card"));
    assert.deepStrictEqual(shown.find((s) => s[0] === "info").slice(1), ["weld-sim: Tune is done. Finished in another window.", "Go to weld-sim"]);
    assert.deepStrictEqual(t.status.sent, [["w-weld", { type: "showChat", chatId: "4" }]]);
    t.status.sent.length = 0; info = async () => undefined;
    await t.p.onRequest({ type: "card", from: "w-weld", chatId: "4", title: "t", body: "", button: "Go to weld-sim" });
    assert.deepStrictEqual(t.status.sent, [], "dismissed");
    t.p.stop();
  });

  await check("a chat that finishes while another window is in front sends that window a card, with this project's name and color", async () => {
    const t = make();
    config = { workspaceColor: "#3f7a5a" };
    t.status.windows = [{ windowId: "w-me", focused: false }, { windowId: "w-other", focused: true }];
    const ok = await t.ch.cardElsewhere({ tabId: "1", title: '"Refactor notify" is done', body: "3 files changed." });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(t.status.sent, [["w-other", { type: "card", from: "w-me", chatId: "1", title: 'kural: "Refactor notify" is done', body: "3 files changed.", button: "Go to kural", color: "#3f7a5a", letter: "K" }]]);
    t.p.stop();
  });

  await check("no other window in front (none, closed, or only this one): the card isn't sent and the caller keeps its own notification", async () => {
    const t = make();
    t.status.windows = [{ windowId: "w-me", focused: true }, { windowId: "w-b", focused: true, closed: true }, { windowId: "w-c", focused: false }];
    assert.strictEqual(await t.ch.cardElsewhere({ tabId: "1", title: "t", body: "b" }), false);
    assert.deepStrictEqual(t.status.sent, []);
    t.p.stop();
  });

  // ---------- the real modules, when they are there ----------
  const real = fs.existsSync(path.join(__dirname, "../extension/lib/projects/status.js")) && fs.existsSync(path.join(__dirname, "../extension/lib/projects/model.js"));
  if (real) await check("with the real status store and model: this window shows up in its own list", async () => {
    folders = ["/p/kural"]; ran.length = 0;
    const dir = fs.mkdtempSync(path.join(tmp, "shared-"));
    const { ProjectStatus } = require("../extension/lib/projects/status");
    const store = new ProjectStatus({ dir });
    const ctx = { subscriptions: [], globalState: { get() {}, update: async () => {} }, extensionUri: Uri.file("/ext"), globalStorageUri: Uri.file(tmp) };
    const p = new Projects(ctx, { chat: { projectChats: () => [chat("1", "Refactor notify", "done")], showChat() {} }, log: () => {}, deps: { statusStore: store } });
    p.register();
    store.flush();
    p.rebuild();
    const names = p.built.sections.flatMap((s) => s.projects).map((x) => x.name);
    assert.ok(names.includes("kural"), `projects: ${names}`);
    assert.ok(p.built.sections.flatMap((s) => s.projects).find((x) => x.name === "kural").here);
    // (This window's own finished chat isn't "another project needing a look".)
    assert.strictEqual(p.built.badge, 0);
    assert.strictEqual(p.built.needLook, 0);
    p.stop();
  });
  else console.log("skip  with the real status store and model (not there yet)");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : "\nall ok");
  process.exit(failed ? 1 : 0);
})();
