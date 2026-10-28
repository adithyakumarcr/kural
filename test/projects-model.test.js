// Projects bar: sections, rows, chat order, labels and numbers (lib/projects/model.js). Pure functions; no vscode.
// Mac and Linux path rules (Windows' are in projects-windows.test.js), so this runs the same on every system.
const assert = require("assert"), path = require("path").posix;
const model = require("../extension/lib/projects/model");
const { chatOrder, ago, colorFor, PALETTE } = model;
const keyOf = (w) => model.keyOf(w, { platform: "linux" });
const buildModel = (o) => model.buildModel({ platform: "linux", ...o });

let failed = 0;
function check(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } }

const NOW = 1_800_000_000_000, MIN = 60_000, H = 60 * MIN, DAY = 24 * H;
const HOME = path.resolve("/home/ada");
const chat = (id, state, extra = {}) => ({ id, title: `Chat ${id}`, state, ask: "", doneAt: null, onScreen: false, ...extra });
const win = (id, folder, over = {}) => ({
  v: 1, windowId: id, pid: 1, seen: NOW - 1000, closed: false, alive: true, key: path.resolve(folder), name: path.basename(folder),
  folders: [path.resolve(folder)], workspaceFile: null, color: null, branch: null, focused: false, chats: [], ...over,
});
const ids = (section) => section.projects.map((p) => p.name);
const build = (o) => buildModel({ home: HOME, now: NOW, here: "me", ...o });
const section = (m, id) => m.sections.find((s) => s.id === id);

check("keyOf: the workspace file, else the first folder, else none", () => {
  assert.strictEqual(keyOf({ folders: ["/a/b", "/c"], workspaceFile: null }), path.resolve("/a/b"));
  assert.strictEqual(keyOf({ folders: ["/a/b"], workspaceFile: "/w/x.code-workspace" }), path.resolve("/w/x.code-workspace"));
  assert.strictEqual(keyOf({ folders: [], workspaceFile: null }), null);
  assert.strictEqual(keyOf({}), null);
  assert.strictEqual(keyOf({ folders: ["/a/b/../c"] }), path.resolve("/a/c"));
});

check("ago: just now, minutes, hours, yesterday, days", () => {
  assert.strictEqual(ago(NOW - 20_000, NOW), "just now");
  assert.strictEqual(ago(NOW - 5 * MIN, NOW), "5 min ago");
  assert.strictEqual(ago(NOW - 59 * MIN - 59_000, NOW), "59 min ago");
  assert.strictEqual(ago(NOW - 60 * MIN, NOW), "1 h ago");
  assert.strictEqual(ago(NOW - 23 * H, NOW), "23 h ago");
  assert.strictEqual(ago(NOW - 24 * H, NOW), "yesterday");
  assert.strictEqual(ago(NOW - 47 * H, NOW), "yesterday");
  assert.strictEqual(ago(NOW - 3 * DAY, NOW), "3 days ago");
  assert.strictEqual(ago(NOW + 5000, NOW), "just now", "a clock a little ahead is not negative");
});

check("chatOrder: waiting, finished, working, the rest; tab order inside a group", () => {
  const list = [chat("1", "idle"), chat("2", "run"), chat("3", "done"), chat("4", "ask"), chat("5", "idle"), chat("6", "ask"), chat("7", "done"), chat("8", "run")];
  assert.deepStrictEqual(chatOrder(list).map((c) => c.id), ["4", "6", "3", "7", "2", "8", "1", "5"]);
  assert.deepStrictEqual(list.map((c) => c.id), ["1", "2", "3", "4", "5", "6", "7", "8"], "the input is not changed");
  assert.deepStrictEqual(chatOrder([]), []);
});

check("sections, their order and an open project's row", () => {
  const m = build({
    windows: [
      win("w2", "/home/ada/zeta", { color: "#aa00aa", branch: "dev" }),
      win("me", "/home/ada/proj/alpha", { branch: "main", chats: [chat("a", "idle", { onScreen: true })] }),
      win("w3", "/work/beta"),
    ],
  });
  assert.deepStrictEqual(m.sections.map((s) => [s.id, s.title]), [["open", "Open"]]);
  assert.deepStrictEqual(ids(section(m, "open")), ["alpha", "beta", "zeta"], "by name");
  const alpha = section(m, "open").projects[0];
  assert.strictEqual(alpha.key, path.resolve("/home/ada/proj/alpha"));
  assert.strictEqual(alpha.letter, "A");
  assert.strictEqual(alpha.shortPath, "~/proj/alpha".split("/").join(path.sep));
  assert.strictEqual(alpha.path, path.resolve("/home/ada/proj/alpha"));
  assert.strictEqual(alpha.branch, "main");
  assert.strictEqual(alpha.color, colorFor(alpha.key), "no Workspace Color: a color of the palette, the same for the same project");
  assert.deepStrictEqual([alpha.open, alpha.here, alpha.windowId, alpha.pinned, alpha.unseen, alpha.attention], [true, true, "me", false, 0, null]);
  const zeta = section(m, "open").projects[2];
  assert.deepStrictEqual([zeta.color, zeta.branch, zeta.here, zeta.windowId], ["#aa00aa", "dev", false, "w2"]);
  assert.strictEqual(section(m, "open").projects[1].shortPath, path.resolve("/work/beta"), "outside home: the full path");
});

check("pinned projects, open or not, come first and are not repeated under Open or Recent", () => {
  const m = build({
    windows: [win("me", "/p/open-pinned"), win("w2", "/p/open-plain")],
    pins: [{ path: "/p/closed-pinned", workspaceFile: null }, { path: "/p/open-pinned", workspaceFile: null }],
    recent: [{ path: "/p/open-pinned", workspaceFile: null }, { path: "/p/closed-pinned", workspaceFile: null }, { path: "/p/open-plain", workspaceFile: null }, { path: "/p/older", workspaceFile: null }],
  });
  assert.deepStrictEqual(m.sections.map((s) => s.id), ["pinned", "open", "recent"]);
  assert.deepStrictEqual(ids(section(m, "pinned")), ["closed-pinned", "open-pinned"], "in pin order");
  assert.deepStrictEqual(ids(section(m, "open")), ["open-plain"]);
  assert.deepStrictEqual(ids(section(m, "recent")), ["older"]);
  const [closed, open] = section(m, "pinned").projects;
  assert.deepStrictEqual([closed.pinned, closed.open, closed.windowId, open.pinned, open.open, open.here], [true, false, null, true, true, true]);
  assert.strictEqual(closed.unseen, 0);
});

check("Recent: dedupes by key, drops open and pinned, keeps VS Code's order, handles workspace files", () => {
  const m = build({
    windows: [win("me", "/p/a"), win("ws", "/p/ws-home", { key: path.resolve("/p/team.code-workspace"), name: "team", workspaceFile: "/p/team.code-workspace" })],
    recent: [
      { path: "/p/b", workspaceFile: null }, { path: "/p/a", workspaceFile: null }, { path: "/p/c", workspaceFile: null }, { path: "/p/b/", workspaceFile: null },
      { path: "/p/ws-home", workspaceFile: "/p/team.code-workspace" }, { path: "/p/other", workspaceFile: "/p/other.code-workspace" }, { path: "/p/c", workspaceFile: null },
    ],
  });
  assert.deepStrictEqual(ids(section(m, "recent")), ["b", "c", "other"]);
  const other = section(m, "recent").projects[2];
  assert.strictEqual(other.name, "other", "a workspace file's name has no .code-workspace");
  assert.strictEqual(other.workspaceFile, "/p/other.code-workspace");
  assert.strictEqual(other.letter, "O");
  assert.deepStrictEqual(ids(section(m, "open")), ["a", "team"]);
  assert.strictEqual(section(m, "open").projects[1].workspaceFile, "/p/team.code-workspace");
  assert.strictEqual(section(m, "recent").projects[0].open, false);
});

check("a window without a folder is left out, and a window's key is used as given", () => {
  const m = build({ windows: [win("me", "/p/a"), win("empty", "/x", { key: null, folders: [], name: "" })] });
  assert.deepStrictEqual(ids(section(m, "open")), ["a"]);
});

check("labels: Working, the question, Done with its age, nothing (no \"on screen\")", () => {
  const m = build({
    windows: [win("me", "/p/a", { chats: [
      chat("1", "run"), chat("2", "ask", { ask: "Allow npm run build?" }), chat("3", "ask"),
      chat("4", "done", { doneAt: NOW - 5 * MIN }), chat("5", "idle", { onScreen: true }), chat("6", "idle"), chat("7", "done", { doneAt: NOW - 2 * DAY }),
    ] })],
  });
  const labels = Object.fromEntries(section(m, "open").projects[0].chats.map((c) => [c.id, c.label]));
  assert.deepStrictEqual(labels, {
    1: "Working", 2: "Allow npm run build?", 3: "Needs you", 4: "Done · 5 min ago", 5: "", 6: "", 7: "Done · 2 days ago",
  });
  const p = section(m, "open").projects[0];
  assert.deepStrictEqual(p.chats.map((c) => c.id), ["2", "3", "4", "7", "1", "5", "6"], "an open project lists every chat, in order");
  assert.deepStrictEqual(Object.keys(p.chats[0]).sort(), ["ask", "doneAt", "id", "label", "onScreen", "state", "title"]);
  assert.strictEqual(p.unseen, 2);
  assert.strictEqual(p.attention, "ask");
});

check("attention: asking beats working beats nothing", () => {
  const m = build({ windows: [
    win("me", "/p/a", { chats: [chat("1", "run")] }),
    win("w2", "/p/b", { chats: [chat("1", "run"), chat("2", "ask")] }),
    win("w3", "/p/c", { chats: [chat("1", "done")] }),
  ] });
  const by = Object.fromEntries(section(m, "open").projects.map((p) => [p.name, p.attention]));
  assert.deepStrictEqual(by, { a: "run", b: "ask", c: null });
});

check("a closed project lists only its finished chats; it shows in Pinned or Recent", () => {
  const closed = (id, folder, chats) => win(id, folder, { alive: false, closed: true, chats });
  const m = build({
    windows: [win("me", "/p/here"), closed("c1", "/p/pinned", [chat("1", "done", { doneAt: NOW - H }), chat("2", "run"), chat("3", "idle")]), closed("c2", "/p/recent", [chat("4", "done"), chat("5", "ask", { ask: "?" })])],
    pins: [{ path: "/p/pinned", workspaceFile: null }],
    recent: [{ path: "/p/recent", workspaceFile: null }],
  });
  const pinned = section(m, "pinned").projects[0], recent = section(m, "recent").projects[0];
  assert.deepStrictEqual(pinned.chats.map((c) => c.id), ["1"]);
  assert.strictEqual(pinned.chats[0].label, "Done · 1 h ago");
  assert.deepStrictEqual([pinned.open, pinned.here, pinned.windowId, pinned.unseen, pinned.attention], [false, false, null, 1, null]);
  assert.deepStrictEqual(recent.chats.map((c) => c.id), ["4"]);
  assert.strictEqual(recent.attention, null);
});

check("a closed project in neither list stays under Recent only while it has unseen chats", () => {
  const closed = (id, folder, chats, seen) => win(id, folder, { alive: false, closed: true, chats, seen });
  const m = build({ windows: [
    win("me", "/p/here"),
    closed("a", "/p/with-unseen", [chat("1", "done")], NOW - 2 * H),
    closed("b", "/p/newer-unseen", [chat("1", "done")], NOW - H),
    closed("c", "/p/nothing", [chat("1", "idle")], NOW - H),
  ], recent: [{ path: "/p/listed", workspaceFile: null }] });
  assert.deepStrictEqual(ids(section(m, "recent")), ["listed", "newer-unseen", "with-unseen"]);
  const m2 = build({ windows: [win("me", "/p/here"), closed("c", "/p/nothing", [chat("1", "idle")], NOW)] });
  assert.strictEqual(section(m2, "recent"), undefined);
});

check("a crashed window (dead, not closed) reads as closed, and several files for one project use the live one", () => {
  const m = build({ windows: [
    win("me", "/p/here"),
    win("crashed", "/p/x", { alive: false, chats: [chat("1", "run"), chat("2", "done")] }),
    win("old", "/p/y", { alive: false, seen: NOW - H, chats: [chat("1", "done")] }),
    win("new", "/p/y", { seen: NOW - 5000, chats: [chat("9", "run")] }),
  ], recent: [{ path: "/p/x", workspaceFile: null }] });
  assert.deepStrictEqual(section(m, "recent").projects[0].chats.map((c) => c.id), ["2"]);
  const y = section(m, "open").projects.find((p) => p.name === "y");
  assert.deepStrictEqual([y.windowId, y.chats.map((c) => c.id)], ["new", ["9"]]);
});

check("query: by project name or path, or by chat title (then only matching chats)", () => {
  const windows = [
    win("me", "/p/Weld-Sim", { chats: [chat("1", "idle", { title: "Tune the arc" }), chat("2", "idle", { title: "Fix tests" })] }),
    win("w2", "/p/other", { chats: [chat("3", "idle", { title: "Arc length bug" }), chat("4", "idle", { title: "Docs" })] }),
    win("w3", "/q/docs-site", { chats: [chat("5", "idle", { title: "Header" })] }),
  ];
  const recent = [{ path: "/p/weldon", workspaceFile: null }];
  let m = build({ windows, recent, query: "weld" });
  assert.deepStrictEqual(ids(section(m, "open")), ["Weld-Sim"]);
  assert.strictEqual(section(m, "open").projects[0].chats.length, 2, "a project matching by name keeps all its chats");
  assert.deepStrictEqual(ids(section(m, "recent")), ["weldon"]);
  m = build({ windows, recent, query: "ARC" });
  assert.deepStrictEqual(ids(section(m, "open")), ["other", "Weld-Sim"], "by name, this window too");
  assert.deepStrictEqual(section(m, "open").projects.map((p) => p.chats.map((c) => c.id)), [["3"], ["1"]]);
  assert.strictEqual(section(m, "recent"), undefined, "empty sections are not returned");
  m = build({ windows, recent, query: "  /q/  " });
  assert.deepStrictEqual(ids(section(m, "open")), ["docs-site"], "by path, spaces around ignored");
  assert.deepStrictEqual(build({ windows, recent, query: "nothing like this" }).sections, []);
});

check("badge and needLook: other projects' finished chats, waiting chats except the one on screen here", () => {
  const m = build({ windows: [
    win("me", "/p/here", { chats: [chat("1", "idle", { onScreen: true }), chat("2", "done"), chat("3", "ask", { ask: "?" })] }),
    win("w2", "/p/b", { chats: [chat("1", "done"), chat("2", "done"), chat("3", "ask"), chat("4", "run")] }),
    win("w3", "/p/c", { chats: [chat("1", "run")] }),
    win("w4", "/p/d", { chats: [chat("1", "idle")] }),
  ] });
  // here: 1 asking (not on screen), its own finished chat doesn't count; b: 2 finished + 1 asking; c, d: nothing
  assert.strictEqual(m.badge, 1 + 3);
  assert.strictEqual(m.needLook, 1, "only b (here is not 'another project')");
  const asked = build({ windows: [win("me", "/p/here", { chats: [chat("3", "ask", { ask: "?", onScreen: true })] })] });
  assert.deepStrictEqual([asked.badge, asked.needLook], [0, 0], "the question you are looking at is not news");
});

check("badge and needLook count closed projects' unseen chats, and a search doesn't change them", () => {
  const windows = [
    win("me", "/p/here"),
    win("c1", "/p/closed", { alive: false, closed: true, chats: [chat("1", "done"), chat("2", "done")] }),
    win("w2", "/p/b", { chats: [chat("1", "ask", { ask: "?" })] }),
  ];
  const pins = [{ path: "/p/closed", workspaceFile: null }];
  const all = build({ windows, pins }), some = build({ windows, pins, query: "closed" });
  assert.deepStrictEqual([all.badge, all.needLook], [3, 2]);
  assert.deepStrictEqual([some.badge, some.needLook], [3, 2]);
  assert.deepStrictEqual(build({}).sections, []);
});

check("the project in this window keeps its place (by name, not moved to the top)", () => {
  const order = (here) => ids(section(build({ here, windows: [win("a", "/p/alpha"), win("m", "/p/mid"), win("z", "/p/zeta")] }), "open"));
  assert.deepStrictEqual(order("z"), ["alpha", "mid", "zeta"]);
  assert.deepStrictEqual(order("m"), ["alpha", "mid", "zeta"]);
});

check("tile colors: the palette has none of Kural's purple, and a project keeps its color", () => {
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return null; const d = mx - mn; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  for (const c of PALETTE) { const h = hue(c); assert.ok(h === null || h < 240 || h > 300, `${c} is purple`); }
  assert.strictEqual(colorFor("/p/a"), colorFor("/p/a"));
  assert.ok(new Set(["/p/a", "/p/b", "/p/c", "/p/d", "/p/e"].map(colorFor)).size > 1, "different projects get different colors");
  const m = build({ windows: [win("me", "/p/a", { color: "#aa00aa" })] });
  assert.strictEqual(section(m, "open").projects[0].color, "#aa00aa", "a Workspace Color wins");
});

check("an empty chat (nothing sent) isn't listed unless it's working or waiting", () => {
  const m = build({ windows: [win("me", "/p/a", { chats: [
    chat("1", "idle", { empty: true, title: "New chat" }), chat("2", "idle"), chat("3", "run", { empty: true }), chat("4", "ask", { empty: true, ask: "?" }),
  ] })] });
  assert.deepStrictEqual(section(m, "open").projects[0].chats.map((c) => c.id), ["4", "3", "2"]);
  const none = build({ windows: [win("me", "/p/a", { chats: [chat("1", "idle", { empty: true })] })] });
  assert.deepStrictEqual(section(none, "open").projects[0].chats, [], "only an empty chat: the project has none");
});

check("a project's news line: waiting first, then working, then new answers (not in this window)", () => {
  const news = (chats, id = "me") => section(build({ windows: [win(id, "/p/a", { chats })] }), "open").projects[0].news;
  assert.strictEqual(news([chat("1", "idle")]), null, "nothing new: no second line");
  assert.deepStrictEqual(news([chat("1", "run"), chat("2", "ask", { ask: "Allow npm run build?" })]), { kind: "ask", text: "Waiting for you: Allow npm run build?" });
  assert.deepStrictEqual(news([chat("1", "run", { title: "Fix the login" })]), { kind: "run", text: "Working · Fix the login" });
  assert.deepStrictEqual(news([chat("1", "done"), chat("2", "done")], "w2"), { kind: "done", text: "2 new answers" });
  assert.deepStrictEqual(news([chat("1", "done")], "w2"), { kind: "done", text: "1 new answer" });
  assert.strictEqual(news([chat("1", "done")]), null, "this window's finished chats aren't news here");
});

check("History: a project's saved chats, newest first, without its open chats; folded projects get none; a search reads every project's", () => {
  const meta = (id, folder, when, extra = {}) => ({ id, title: `Saved ${id}`, when, count: 2, workspace: { key: path.resolve(folder), name: path.basename(folder), open: path.resolve(folder) }, ...extra });
  const archive = [meta("a1", "/p/a", NOW - 2 * H), meta("a2", "/p/a", NOW - 5 * MIN), meta("open1", "/p/a", NOW), meta("b1", "/p/b", NOW - DAY * 3),
    meta("multi", "/p/a", NOW - 9 * H, { workspace: { key: "/p/a|/p/z", name: "ws", open: "/w/ws.code-workspace" } }), { id: "lost", title: "No workspace", when: 1 }];
  const windows = [win("me", "/p/a", { chats: [chat("open1", "idle")] })];
  const base = { windows, recent: [{ path: "/p/b", workspaceFile: null }], archive };
  const closed = build({ ...base, historyOpen: [] });
  const a0 = section(closed, "open").projects[0];
  assert.deepStrictEqual(a0.history, { open: false, loaded: false, total: 0, items: [] }, "nothing is read for a folded History");
  const m = build({ ...base, historyOpen: [path.resolve("/p/a")] });
  const a = section(m, "open").projects[0], b = section(m, "recent").projects[0];
  assert.deepStrictEqual(a.history.items.map((h) => h.id), ["a2", "a1", "multi"], "newest first, the open chat left out; a multi-root chat counts for its first folder");
  assert.strictEqual(a.history.total, 3);
  assert.strictEqual(a.history.items[0].ago, "5 min ago");
  assert.strictEqual(a.history.items[1].title, "Saved a1");
  assert.deepStrictEqual(b.history, { open: false, loaded: false, total: 0, items: [] });
  const r = build({ ...base, historyOpen: [path.resolve("/p/b")] });
  assert.deepStrictEqual(section(r, "recent").projects[0].history.items.map((h) => h.id), ["b1"], "a Recent project has its History too");
  const s = build({ ...base, historyOpen: [], query: "saved b" });
  assert.deepStrictEqual(s.sections.flatMap((x) => x.projects).map((p) => p.name), ["b"], "a search finds a saved chat by its title");
  assert.deepStrictEqual(s.sections[0].projects[0].history.items.map((h) => h.id), ["b1"]);
});

check("History: a card belongs to a project by key, by workspace file or by folder; a Windows uri path matches its drive path", () => {
  const p = { key: "/p/a", path: "/p/a", workspaceFile: null };
  assert.ok(model.belongs({ workspace: { key: "/p/a" } }, p, "linux"));
  assert.ok(model.belongs({ workspace: { key: "/p/a|/p/b", open: "/p/a" } }, p, "linux"));
  assert.ok(!model.belongs({ workspace: { key: "/p/ab", open: "/p/ab" } }, p, "linux"));
  assert.ok(!model.belongs({}, p, "linux"));
  const ws = { key: "/w/x.code-workspace", path: "/w", workspaceFile: "/w/x.code-workspace" };
  assert.ok(model.belongs({ workspace: { key: "/p/a|/p/b", open: "/w/x.code-workspace" } }, ws, "linux"));
  const win32 = { key: "c:\\code\\app", path: "C:\\Code\\App", workspaceFile: null };
  assert.ok(model.belongs({ workspace: { key: "/c:/Code/App", open: "/c:/Code/App" } }, win32, "win32"));
  assert.ok(!model.belongs({ workspace: { key: "/c:/Code/Other", open: "/c:/Code/Other" } }, win32, "win32"));
});

check("History: at most HISTORY_MAX cards go to the page", () => {
  const archive = Array.from({ length: model.HISTORY_MAX + 20 }, (_, i) => ({ id: `h${i}`, title: `T${i}`, when: i, workspace: { key: path.resolve("/p/a"), open: path.resolve("/p/a") } }));
  const m = build({ windows: [win("me", "/p/a")], archive, historyOpen: [path.resolve("/p/a")] });
  const h = section(m, "open").projects[0].history;
  assert.strictEqual(h.items.length, model.HISTORY_MAX);
  assert.strictEqual(h.total, model.HISTORY_MAX + 20);
  assert.strictEqual(h.items[0].id, `h${model.HISTORY_MAX + 19}`);
});

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
