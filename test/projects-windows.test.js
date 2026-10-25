// Projects bar on Windows (and Linux): one folder is one key whatever its spelling, the pid test, the busy-file retry.
// This machine may be a Mac, so Windows is simulated: path.win32 and an injected platform. No vscode.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { keyOf, pathKey, samePath, sameKey, shorten, buildModel } = require("../extension/lib/projects/model");
const { ProjectStatus, defaultAlive } = require("../extension/lib/projects/status");

let failed = 0;
function check(name, fn) { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } }

const W = "win32", L = "linux", NOW = 1_800_000_000_000;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-projects-win-")));
let n = 0;
const fresh = () => path.join(tmp, `d${++n}`);
const mk = (dir, id, extra = {}) => new ProjectStatus({ dir, windowId: id, debounceMs: 20, heartbeatMs: 60000, pollMs: 60000, ...extra });

check("keyOf: 'c:\\Code\\App' and 'C:\\code\\app\\' are one key on win32, two on linux", () => {
  assert.strictEqual(keyOf({ folders: ["c:\\Code\\App"] }, { platform: W }), keyOf({ folders: ["C:\\code\\app\\"] }, { platform: W }));
  assert.strictEqual(keyOf({ folders: ["C:/Code/App"] }, { platform: W }), keyOf({ folders: ["c:\\Code\\App"] }, { platform: W }));
  assert.strictEqual(keyOf({ folders: ["C:\\Code\\.\\Other\\..\\App"] }, { platform: W }), keyOf({ folders: ["c:\\code\\app"] }, { platform: W }));
  assert.notStrictEqual(keyOf({ folders: ["c:\\Code\\App"] }, { platform: L }), keyOf({ folders: ["C:\\code\\app\\"] }, { platform: L }));
  assert.notStrictEqual(keyOf({ folders: ["/Code/App"] }, { platform: L }), keyOf({ folders: ["/code/app"] }, { platform: L }));
  assert.strictEqual(keyOf({ folders: ["/code/app/"] }, { platform: L }), "/code/app");
});

check("keyOf on win32: workspace file first, roots keep their separator, UNC paths and different folders stay apart", () => {
  assert.strictEqual(keyOf({ folders: ["C:\\a"], workspaceFile: "D:\\W\\X.code-workspace" }, { platform: W }), "d:\\w\\x.code-workspace");
  assert.strictEqual(pathKey("C:\\", W), "c:\\");
  assert.strictEqual(pathKey("c:/", W), "c:\\");
  assert.strictEqual(pathKey("\\\\Server\\Share\\Proj\\", W), "\\\\server\\share\\proj");
  assert.notStrictEqual(pathKey("C:\\code\\app", W), pathKey("D:\\code\\app", W));
  assert.notStrictEqual(pathKey("C:\\code\\app", W), pathKey("C:\\code\\app2", W));
  assert.strictEqual(keyOf({ folders: [] }, { platform: W }), null);
});

check("samePath and sameKey", () => {
  assert.ok(samePath("c:\\Users\\Ada\\Proj", "C:\\users\\ada\\proj\\", W));
  assert.ok(!samePath("c:\\Users\\Ada\\Proj", "C:\\users\\ada\\proj\\", L));
  assert.ok(!samePath("", "", W));
  assert.ok(sameKey("c:\\a\\b", "C:\\A\\B\\", W));
  assert.ok(!sameKey("/a/b", "/A/b", L));
  assert.ok(sameKey("/a/b", "/a/b", L));
  assert.ok(!sameKey(null, null, W));
});

check("shorten: a Windows home, either separator, any case; ~ for the home itself; other folders untouched", () => {
  const home = "C:\\Users\\Ada";
  assert.strictEqual(shorten("C:\\Users\\Ada\\Code\\App", home, W), "~\\Code\\App");
  assert.strictEqual(shorten("c:\\users\\ada\\Code\\App", home, W), "~\\Code\\App");
  assert.strictEqual(shorten("c:/users/ada/Code/App", home, W), "~\\Code\\App");
  assert.strictEqual(shorten("C:\\Users\\Ada\\", home, W), "~");
  assert.strictEqual(shorten("C:\\Users\\Ada", "c:\\users\\ada\\", W), "~");
  assert.strictEqual(shorten("C:\\Users\\Adam\\Code", home, W), "C:\\Users\\Adam\\Code", "a longer name is not the home");
  assert.strictEqual(shorten("D:\\Code", home, W), "D:\\Code");
  assert.strictEqual(shorten("C:\\Users\\Ada\\Code", "", W), "C:\\Users\\Ada\\Code");
  assert.strictEqual(shorten("/home/ada/proj", "/home/ada", L), "~/proj");
  assert.strictEqual(shorten("/home/adam/proj", "/home/ada", L), "/home/adam/proj");
  assert.strictEqual(shorten("/home/Ada/proj", "/home/ada", L), "/home/Ada/proj", "case counts off Windows");
});

const chat = (id, state) => ({ id, title: `Chat ${id}`, state, ask: "", doneAt: null, onScreen: false });
const winWindow = (id, folder, over = {}) => ({
  v: 1, windowId: id, pid: 1, seen: NOW - 1000, closed: false, alive: true, name: "", folders: [folder], workspaceFile: null,
  color: null, branch: null, focused: false, chats: [], ...over,
});

check("buildModel on win32: a window, a pin and a recent entry spelled differently are one row; the window's spelling shows", () => {
  const m = buildModel({
    platform: W, home: "C:\\Users\\Ada", now: NOW, here: "me",
    windows: [winWindow("me", "c:\\Users\\Ada\\Code\\App", { key: "c:\\Users\\Ada\\Code\\App", chats: [chat("a", "run")] })],
    pins: [{ path: "C:\\USERS\\ADA\\CODE\\APP\\", workspaceFile: null }],
    recent: [{ path: "C:\\users\\ada\\code\\app", workspaceFile: null }, { path: "D:\\Other", workspaceFile: null }],
  });
  const rows = m.sections.flatMap((s) => s.projects.map((p) => [s.id, p]));
  assert.deepStrictEqual(rows.map(([s, p]) => [s, p.name]), [["pinned", "App"], ["recent", "Other"]]);
  const app = rows[0][1];
  assert.ok(app.open && app.here && app.pinned, "the one row is this window's, and pinned");
  assert.strictEqual(app.path, "c:\\Users\\Ada\\Code\\App", "the spelling of the open window");
  assert.strictEqual(app.shortPath, "~\\Code\\App");
  assert.strictEqual(app.key, "c:\\users\\ada\\code\\app");
  assert.strictEqual(app.chats.length, 1);
});

check("buildModel on win32: two windows of one folder spelled differently pick one; names come from the Windows path", () => {
  const m = buildModel({
    platform: W, home: "C:\\Users\\Ada", now: NOW, here: "me",
    windows: [
      winWindow("w1", "C:\\Code\\Weld", { key: "C:\\Code\\Weld", seen: NOW - 5000 }),
      winWindow("w2", "c:\\code\\weld\\", { key: "c:\\code\\weld", seen: NOW - 1000 }),
    ],
    recent: [{ path: "E:\\Work\\Shop", workspaceFile: null },
      { path: "E:\\Work\\Plan", workspaceFile: "E:\\Work\\Plan\\team.code-workspace" }],
  });
  const open = m.sections.find((s) => s.id === "open").projects;
  assert.strictEqual(open.length, 1);
  assert.strictEqual(open[0].windowId, "w2", "the one seen last");
  assert.strictEqual(open[0].name, "weld", "the name is from the chosen window's own spelling");
  const recent = m.sections.find((s) => s.id === "recent").projects;
  assert.deepStrictEqual(recent.map((p) => p.name), ["Shop", "team"]);
});

check("buildModel on linux: folders that differ in case are two projects", () => {
  const m = buildModel({ platform: L, home: "/home/ada", now: NOW, here: "me", windows: [], recent: [{ path: "/p/App", workspaceFile: null }, { path: "/p/app", workspaceFile: null }] });
  assert.deepStrictEqual(m.sections[0].projects.map((p) => p.name), ["App", "app"]);
});

check("defaultAlive: this process, not 0 / negative / junk, EPERM means alive, ESRCH means gone", () => {
  assert.strictEqual(defaultAlive(process.pid), true);
  for (const bad of [0, -1, 1.5, "12", null, undefined, NaN]) assert.strictEqual(defaultAlive(bad), false, String(bad));
  const real = process.kill;
  try {
    process.kill = () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); };
    assert.strictEqual(defaultAlive(4321), true);
    process.kill = () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); };
    assert.strictEqual(defaultAlive(4321), false);
  } finally { process.kill = real; }
});

const busy = (code = "EPERM") => Object.assign(new Error(`${code}: busy`), { code });
const winFile = (dir, id) => path.join(dir, "windows", `${id}.json`);

check("a rename onto a file that is busy is tried again, then succeeds; no temp file is left", () => {
  const dir = fresh(), waits = [];
  let fails = 2;
  const s = mk(dir, "1-aa", { sleep: (ms) => waits.push(ms), rename: (a, b) => { if (fails-- > 0) throw busy("EBUSY"); fs.renameSync(a, b); } });
  s.start();
  s.publish({ key: "/p/a", name: "a", folders: ["/p/a"], chats: [] });
  s.flush();
  assert.strictEqual(waits.length, 2);
  assert.strictEqual(JSON.parse(fs.readFileSync(winFile(dir, "1-aa"), "utf8")).name, "a");
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, "windows")), ["1-aa.json"]);
  s.dispose({ closed: false });
});

check("a file that stays busy is overwritten in place; any other error still fails and cleans up", () => {
  const dir = fresh();
  const s = mk(dir, "1-bb", { sleep() {}, rename: () => { throw busy("EACCES"); } });
  s.start();
  s.publish({ key: "/p/b", name: "first", folders: [], chats: [] });
  s.flush();
  assert.strictEqual(JSON.parse(fs.readFileSync(winFile(dir, "1-bb"), "utf8")).name, "first");
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, "windows")), ["1-bb.json"], "temp file removed");
  s.dispose({ closed: false });

  const pins = mk(fresh(), "1-cc", { sleep() {}, rename: () => { throw busy("ENOSPC"); } });
  assert.throws(() => pins.setPinned({ path: "/p/x" }, true), /ENOSPC/);
  assert.deepStrictEqual(fs.readdirSync(pins.dir).filter((f) => f.startsWith(".tmp-")), []);
});

check("readAll: a window file that is busy for a moment is read again, not dropped", () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, "windows"), { recursive: true });
  fs.writeFileSync(winFile(dir, "2-xx"), JSON.stringify({ v: 1, pid: 9, seen: 1000, closed: false, name: "x", key: "/p/x", folders: ["/p/x"], chats: [] }));
  const s = mk(dir, "1-me", { now: () => 2000, isAlive: () => true, sleep() {} });
  const read = fs.readFileSync;
  let fails = 1;
  fs.readFileSync = function (f, ...a) { if (String(f).endsWith("2-xx.json") && fails-- > 0) throw busy("EPERM"); return read.call(this, f, ...a); };
  try {
    assert.deepStrictEqual(s.readAll().map((w) => [w.windowId, w.alive]), [["2-xx", true]]);
  } finally { fs.readFileSync = read; }
});

check("pins on win32: the same folder spelled two ways is one pin, replaced and removed by any spelling", () => {
  const dir = fresh();
  const s = mk(dir, "1-me", { platform: W });
  s.setPinned({ path: "c:\\Code\\App", workspaceFile: null }, true);
  s.setPinned({ path: "C:\\code\\app\\", workspaceFile: null }, true);
  assert.deepStrictEqual(s.readPins(), [{ path: "C:\\code\\app\\", workspaceFile: null }]);
  s.setPinned({ path: "D:\\Other" }, true);
  s.setPinned({ path: "C:\\CODE\\APP" }, false);
  assert.deepStrictEqual(s.readPins(), [{ path: "D:\\Other", workspaceFile: null }]);
  // a file written with two spellings (by an older Kural, or another window) reads as one
  fs.writeFileSync(path.join(dir, "pins.json"), JSON.stringify([{ path: "c:\\a\\b" }, { path: "C:\\A\\B\\" }, { path: "c:\\a\\c" }]));
  assert.deepStrictEqual(s.readPins().map((p) => p.path), ["c:\\a\\b", "c:\\a\\c"]);
});

check("pins on linux: spellings that differ in case are two pins", () => {
  const s = mk(fresh(), "1-me", { platform: L });
  s.setPinned({ path: "/p/App" }, true);
  s.setPinned({ path: "/p/app" }, true);
  assert.strictEqual(s.readPins().length, 2);
});

check("adopt on win32: a closed window of the same folder (any spelling of the key) is replaced", () => {
  const dir = fresh();
  fs.mkdirSync(path.join(dir, "windows"), { recursive: true });
  const rec = (key, over) => JSON.stringify({ v: 1, pid: 9, seen: 1000, closed: true, name: "app", key, folders: [], chats: [], ...over });
  fs.writeFileSync(winFile(dir, "2-old"), rec("C:\\Code\\App\\"));
  fs.writeFileSync(winFile(dir, "3-other"), rec("c:\\code\\other"));
  const s = mk(dir, "1-me", { platform: W, now: () => 2000, isAlive: () => false });
  s.adopt("c:\\code\\app");
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, "windows")).sort(), ["3-other.json"]);
  // on linux the same two keys are different projects
  const dir2 = fresh();
  fs.mkdirSync(path.join(dir2, "windows"), { recursive: true });
  fs.writeFileSync(winFile(dir2, "2-old"), rec("/p/App"));
  mk(dir2, "1-me", { platform: L, now: () => 2000, isAlive: () => false }).adopt("/p/app");
  assert.deepStrictEqual(fs.readdirSync(path.join(dir2, "windows")), ["2-old.json"]);
});

check("the inbox works with the busy-file retry: send, then take", () => {
  const dir = fresh();
  const a = mk(dir, "1-a", { sleep() {} }), b = mk(dir, "2-b", { sleep() {} });
  b.start();
  const got = [];
  b.onRequest((r) => got.push(r));
  a.send("2-b", { type: "showChat", chatId: "c1" });
  b.takeRequests();
  assert.deepStrictEqual(got, [{ type: "showChat", chatId: "c1" }]);
  b.dispose({ closed: false });
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : "\nall ok");
process.exit(failed ? 1 : 0);
