// Projects bar: the status files, the inboxes and the pins (lib/projects/status.js). Real temp folders, fake clocks and
// pids; no vscode.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const { ProjectStatus } = require("../extension/lib/projects/status");

let failed = 0;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-projects-status-")));
let n = 0;
const fresh = () => path.join(tmp, `d${++n}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(20); }
  return false;
}
async function check(name, fn) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } }

const state = (over = {}) => ({
  key: "/p/weld", name: "weld", folders: ["/p/weld"], workspaceFile: null, color: "#336699", branch: "main", focused: true,
  chats: [{ id: "a", title: "Tune it", state: "run", ask: "", doneAt: null, onScreen: true }], ...over,
});
// The poll is short here: fs.watch can miss the first events after a folder was made (the poll is its safety net).
const mk = (dir, id, extra = {}) => new ProjectStatus({ dir, windowId: id, debounceMs: 20, heartbeatMs: 60000, pollMs: 150, ...extra });
const live = [];
const track = (s) => { live.push(s); return s; };
const windowFile = (dir, id) => path.join(dir, "windows", `${id}.json`);
const writeWindow = (dir, id, rec) => {
  fs.mkdirSync(path.join(dir, "windows"), { recursive: true });
  fs.writeFileSync(windowFile(dir, id), JSON.stringify({ v: 1, windowId: id, pid: 1, closed: false, ...rec }));
};

(async () => {
  await check("publish + flush writes the shape, private", () => {
    const dir = fresh();
    const s = track(mk(dir, "1-aa", { pid: 4242, now: () => 1000 }));
    s.start();
    s.publish(state());
    s.flush();
    const rec = JSON.parse(fs.readFileSync(windowFile(dir, "1-aa"), "utf8"));
    assert.deepStrictEqual(rec, { v: 1, windowId: "1-aa", pid: 4242, seen: 1000, closed: false, ...state() });
    if (process.platform !== "win32") {
      assert.strictEqual(fs.statSync(windowFile(dir, "1-aa")).mode & 0o777, 0o600);
      assert.strictEqual(fs.statSync(path.join(dir, "windows")).mode & 0o777, 0o700);
    }
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, "windows")), ["1-aa.json"], "no temp file left");
  });

  await check("the default window id has the process id and randomness", () => {
    const a = new ProjectStatus({ dir: fresh() }), b = new ProjectStatus({ dir: fresh() });
    assert.match(a.windowId, new RegExp(`^${process.pid}-[0-9a-f]+$`));
    assert.notStrictEqual(a.windowId, b.windowId);
  });

  await check("publishing twice in the debounce window writes once, with the last state", async () => {
    const dir = fresh();
    const s = track(mk(dir, "1-bb", { debounceMs: 80 }));
    s.start();
    let writes = 0;
    const real = fs.renameSync;
    fs.renameSync = (a, b) => { if (String(b).endsWith("1-bb.json")) writes++; return real(a, b); };
    try {
      s.publish(state({ name: "first" }));
      s.publish(state({ name: "second" }));
      assert.ok(!fs.existsSync(windowFile(dir, "1-bb")), "nothing written yet");
      await sleep(250);
    } finally { fs.renameSync = real; }
    assert.strictEqual(writes, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(windowFile(dir, "1-bb"), "utf8")).name, "second");
  });

  await check("readAll: alive, crashed, closed and stale windows", () => {
    const dir = fresh();
    let t = 1_000_000;
    const alive = new Set([10, 11, 13]);
    const s = track(mk(dir, "me", { now: () => t, isAlive: (pid) => alive.has(pid) }));
    s.start();
    writeWindow(dir, "w-live", { pid: 10, seen: t - 1000, key: "/a" });
    writeWindow(dir, "w-crashed", { pid: 12, seen: t - 1000, key: "/b" });
    writeWindow(dir, "w-closed", { pid: 11, seen: t - 1000, closed: true, key: "/c" });
    writeWindow(dir, "w-stale", { pid: 13, seen: t - 20 * 60 * 1000, key: "/d" });
    s.publish(state());
    s.flush();
    const by = Object.fromEntries(s.readAll().map((w) => [w.windowId, w.alive]));
    assert.deepStrictEqual(by, { me: true, "w-live": true, "w-crashed": false, "w-closed": false, "w-stale": false });
    t += 14 * 60 * 1000 + 58_000; // 14 min 59 s after the live one was seen (a hidden or full-screen window's timers can be slow)
    assert.strictEqual(s.readAll().find((w) => w.windowId === "w-live").alive, true);
    t += 5000;
    assert.strictEqual(s.readAll().find((w) => w.windowId === "w-live").alive, false);
  });

  await check("half-written, foreign and unnamed files are skipped", () => {
    const dir = fresh();
    const s = track(mk(dir, "me"));
    s.start();
    writeWindow(dir, "good", { seen: Date.now(), key: "/a", pid: process.pid });
    fs.writeFileSync(windowFile(dir, "half"), '{"v":1,"windowId":"half","pid":1,"se');
    fs.writeFileSync(windowFile(dir, "other-version"), JSON.stringify({ v: 2, key: "/x" }));
    fs.writeFileSync(windowFile(dir, "array"), "[]");
    fs.writeFileSync(path.join(dir, "windows", ".tmp-1-abc"), "{}");
    fs.writeFileSync(path.join(dir, "windows", "notes.txt"), "{}");
    assert.deepStrictEqual(s.readAll().map((w) => w.windowId), ["good"]);
    fs.writeFileSync(path.join(dir, "pins.json"), "[{\"path\":");
    assert.deepStrictEqual(s.readPins(), []);
    // a missing windows folder is an empty list, not an error
    assert.deepStrictEqual(new ProjectStatus({ dir: fresh() }).readAll(), []);
  });

  await check("a window's own file name decides its id, not what the content claims", () => {
    const dir = fresh();
    const s = track(mk(dir, "me"));
    s.start();
    writeWindow(dir, "real", { windowId: "../../etc", seen: Date.now(), pid: process.pid, key: "/a" });
    assert.deepStrictEqual(s.readAll().map((w) => w.windowId), ["real"]);
    assert.throws(() => s.send("../x", { type: "close" }));
  });

  await check("dispose keeps only the done chats and marks the window closed", () => {
    const dir = fresh();
    const s = track(mk(dir, "1-cc"));
    s.start();
    s.publish(state({ chats: [
      { id: "a", title: "A", state: "run", ask: "", doneAt: null, onScreen: false },
      { id: "b", title: "B", state: "done", ask: "", doneAt: 5, onScreen: false },
      { id: "c", title: "C", state: "ask", ask: "Allow?", doneAt: null, onScreen: false },
      { id: "d", title: "D", state: "idle", ask: "", doneAt: null, onScreen: false },
    ] }));
    s.dispose();
    const rec = JSON.parse(fs.readFileSync(windowFile(dir, "1-cc"), "utf8"));
    assert.strictEqual(rec.closed, true);
    assert.deepStrictEqual(rec.chats.map((c) => c.id), ["b"]);
    s.publish(state({ name: "late" })); // a disposed window writes nothing more
    s.flush();
    assert.strictEqual(JSON.parse(fs.readFileSync(windowFile(dir, "1-cc"), "utf8")).name, "weld");
  });

  await check("dispose({closed:false}) only stops: the file stays open", () => {
    const dir = fresh();
    const s = track(mk(dir, "1-dd"));
    s.start();
    s.publish(state());
    s.dispose({ closed: false });
    const rec = JSON.parse(fs.readFileSync(windowFile(dir, "1-dd"), "utf8"));
    assert.strictEqual(rec.closed, false);
    assert.strictEqual(rec.chats.length, 1);
  });

  await check("the heartbeat refreshes `seen`", async () => {
    const dir = fresh();
    let t = 5000;
    const s = track(mk(dir, "1-ee", { now: () => t, heartbeatMs: 40 }));
    s.start();
    s.publish(state());
    s.flush();
    t = 9000;
    assert.ok(await until(() => JSON.parse(fs.readFileSync(windowFile(dir, "1-ee"), "utf8")).seen === 9000));
  });

  await check("adopt removes a dead file with the same key, never a live one or another key", () => {
    const dir = fresh();
    const alive = new Set([10]);
    const s = track(mk(dir, "me", { isAlive: (pid) => alive.has(pid) }));
    s.start();
    const seen = Date.now();
    writeWindow(dir, "old-closed", { pid: 11, seen, closed: true, key: "/p/weld" });
    writeWindow(dir, "old-crashed", { pid: 12, seen, key: "/p/weld" });
    writeWindow(dir, "other-live", { pid: 10, seen, key: "/p/weld" });
    writeWindow(dir, "other-key", { pid: 11, seen, closed: true, key: "/p/else" });
    s.send("old-closed", { type: "close" });
    s.adopt("/p/weld");
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, "windows")).sort(), ["other-key.json", "other-live.json"]);
    assert.ok(!fs.existsSync(path.join(dir, "inbox", "old-closed")), "its inbox goes too");
  });

  await check("prune: closed and dead files after 30 days, not before, never a live one", () => {
    const dir = fresh();
    const day = 24 * 3600 * 1000;
    let t = 100 * day;
    const s = track(mk(dir, "me", { now: () => t, isAlive: (pid) => pid === 10 }));
    s.start();
    writeWindow(dir, "closed-old", { pid: 11, seen: t - 31 * day, closed: true, key: "/a" });
    writeWindow(dir, "dead-old", { pid: 12, seen: t - 40 * day, key: "/b" });
    writeWindow(dir, "closed-new", { pid: 11, seen: t - 29 * day, closed: true, key: "/c" });
    writeWindow(dir, "live-old-seen", { pid: 10, seen: t - 31 * day, key: "/d" }); // seen too old = not alive either
    s.prune();
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, "windows")).sort(), ["closed-new.json"]);
    // a live window (fresh `seen`, pid exists) is never touched, however old its start
    writeWindow(dir, "live", { pid: 10, seen: t - 1000, key: "/e" });
    t += 60 * day;
    s.prune();
    assert.ok(!fs.existsSync(windowFile(dir, "closed-new")));
  });

  await check("prune drops inbox requests older than 30 seconds", () => {
    const dir = fresh();
    let t = 10_000_000;
    const a = track(mk(dir, "a", { now: () => t }));
    const b = track(mk(dir, "b", { now: () => t }));
    a.start(); b.start();
    a.send("b", { type: "close" });
    t += 29_000;
    a.send("b", { type: "showChat", chatId: "x" });
    t += 2000; // the first is now 31 s old, the second 2 s
    b.prune();
    const left = fs.readdirSync(path.join(dir, "inbox", "b"));
    assert.strictEqual(left.length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, "inbox", "b", left[0]), "utf8")).type, "showChat");
  });

  await check("send -> onRequest: in order, each file deleted, private", async () => {
    const dir = fresh();
    let t = 1_700_000_000_000;
    const a = track(mk(dir, "a", { now: () => t++ }));
    const b = track(mk(dir, "b", { now: () => t }));
    a.start(); b.start();
    const got = [];
    b.onRequest((r) => got.push(r));
    for (let i = 0; i < 5; i++) a.send("b", { type: "showChat", chatId: `c${i}` });
    a.send("b", { type: "card", from: "a", chatId: "c9", title: "T", body: "B", button: "Go", color: "#123", letter: "W" });
    assert.ok(await until(() => got.length === 6));
    assert.deepStrictEqual(got.slice(0, 5).map((r) => r.chatId), ["c0", "c1", "c2", "c3", "c4"]);
    assert.strictEqual(got[5].type, "card");
    assert.ok(await until(() => fs.readdirSync(path.join(dir, "inbox", "b")).length === 0));
    a.send("b", { type: "close" });
    if (process.platform !== "win32") {
      const f = fs.readdirSync(path.join(dir, "inbox", "b"))[0];
      if (f) assert.strictEqual(fs.statSync(path.join(dir, "inbox", "b", f)).mode & 0o777, 0o600);
    }
    assert.ok(await until(() => got.length === 7 && got[6].type === "close"));
  });

  await check("a request waiting before onRequest is registered is delivered once it is", async () => {
    const dir = fresh();
    const a = track(mk(dir, "a")), b = track(mk(dir, "b"));
    a.start(); b.start();
    a.send("b", { type: "close" });
    await sleep(100);
    assert.strictEqual(fs.readdirSync(path.join(dir, "inbox", "b")).length, 1, "kept while nobody listens");
    const got = [];
    const off = b.onRequest((r) => got.push(r));
    assert.ok(await until(() => got.length === 1));
    off();
    a.send("b", { type: "close" });
    await sleep(150);
    assert.strictEqual(got.length, 1, "a disposed listener hears nothing");
  });

  await check("a request older than 30 s is dropped unseen", async () => {
    const dir = fresh();
    let t = 50_000_000;
    const a = track(mk(dir, "a", { now: () => t }));
    const b = track(mk(dir, "b", { now: () => t }));
    a.start(); b.start();
    a.send("b", { type: "close" });
    t += 31_000;
    a.send("b", { type: "showChat", chatId: "fresh" });
    const got = [];
    b.onRequest((r) => got.push(r));
    assert.ok(await until(() => got.length === 1));
    await sleep(100);
    assert.deepStrictEqual(got.map((r) => r.chatId), ["fresh"]);
    assert.strictEqual(fs.readdirSync(path.join(dir, "inbox", "b")).length, 0);
  });

  await check("a cut-off request is skipped, then dropped once it is not new", async () => {
    const dir = fresh();
    const b = track(mk(dir, "b"));
    b.start();
    const bad = path.join(dir, "inbox", "b", `${String(Date.now()).padStart(15, "0")}-zz.json`);
    fs.writeFileSync(bad, '{"type":"sh');
    const got = [];
    b.onRequest((r) => got.push(r));
    await sleep(150);
    assert.deepStrictEqual(got, []);
    fs.utimesSync(bad, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    b.takeRequests();
    assert.ok(!fs.existsSync(bad));
    assert.deepStrictEqual(got, []);
  });

  await check("onChange fires for another window's write and for setPinned", async () => {
    const dir = fresh();
    const a = track(mk(dir, "a")), b = track(mk(dir, "b"));
    a.start(); b.start();
    let changes = 0;
    const off = a.onChange(() => changes++);
    b.publish(state());
    b.flush();
    assert.ok(await until(() => changes >= 1), "a window's file");
    const before = changes;
    b.setPinned({ path: "/p/weld", workspaceFile: null }, true);
    assert.ok(await until(() => changes > before), "pins.json");
    off();
    const after = changes;
    b.publish(state({ name: "x" }));
    b.flush();
    await sleep(200);
    assert.strictEqual(changes, after, "a disposed listener hears nothing");
  });

  await check("the poll notices a change when watching gives nothing", async () => {
    const dir = fresh();
    const a = track(mk(dir, "a", { pollMs: 40 }));
    a.start();
    for (const w of a.watchers) w.close();
    a.watchers = [];
    let changes = 0;
    a.onChange(() => changes++);
    writeWindow(dir, "x", { seen: Date.now(), key: "/x", pid: process.pid });
    assert.ok(await until(() => changes >= 1));
  });

  await check("a burst of writes is coalesced into few change calls", async () => {
    const dir = fresh();
    const a = track(mk(dir, "a")), b = track(mk(dir, "b"));
    a.start(); b.start();
    let changes = 0;
    a.onChange(() => changes++);
    for (let i = 0; i < 20; i++) { b.publish(state({ name: `n${i}` })); b.flush(); }
    await sleep(300);
    assert.ok(changes >= 1 && changes <= 5, `changes: ${changes}`);
  });

  await check("pins: add, replace, remove by path; atomic and private", () => {
    const dir = fresh();
    const s = track(mk(dir, "a"));
    assert.deepStrictEqual(s.readPins(), []);
    s.setPinned({ path: "/p/one", workspaceFile: null }, true);
    s.setPinned({ path: "/p/two", workspaceFile: "/p/two/x.code-workspace" }, true);
    s.setPinned({ path: "/p/one", workspaceFile: "/p/one/y.code-workspace" }, true); // same path: replaced, not doubled
    assert.deepStrictEqual(s.readPins(), [
      { path: "/p/two", workspaceFile: "/p/two/x.code-workspace" },
      { path: "/p/one", workspaceFile: "/p/one/y.code-workspace" },
    ]);
    s.setPinned({ path: "/p/two" }, false);
    s.setPinned({ path: "/p/never" }, false);
    assert.deepStrictEqual(s.readPins(), [{ path: "/p/one", workspaceFile: "/p/one/y.code-workspace" }]);
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f !== "windows" && f !== "inbox"), ["pins.json"]);
    if (process.platform !== "win32") assert.strictEqual(fs.statSync(path.join(dir, "pins.json")).mode & 0o777, 0o600);
    fs.writeFileSync(path.join(dir, "pins.json"), JSON.stringify([{ path: 3 }, null, { path: "/ok" }]));
    assert.deepStrictEqual(s.readPins(), [{ path: "/ok", workspaceFile: null }]);
  });

  for (const s of live) s.dispose({ closed: false });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log("\nall passed");
})();
