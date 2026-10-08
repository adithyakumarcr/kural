// Stay awake while a chat works (lib/chat/awake.js: caffeinate on a Mac, started once, stopped when idle) and Welcome
// after the last editor tab closes (lib/welcome.js shouldOpen).
const assert = require("assert");
const { EventEmitter } = require("events");
const { StayAwake } = require("../extension/lib/chat/awake");
const { shouldOpen } = require("../extension/lib/welcome");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };

const fakeRun = () => {
  const calls = [];
  const run = (bin, args) => { const p = new EventEmitter(); p.killed = false; p.kill = () => { p.killed = true; p.emit("exit"); }; calls.push({ bin, args, p }); return p; };
  return { run, calls };
};

check("stay awake: one caffeinate while busy, tied to Kural's pid, stopped when idle", () => {
  const f = fakeRun();
  const a = new StayAwake({ platform: "darwin", run: f.run, pid: 4242 });
  a.set(true); a.set(true); a.set(true);
  assert.strictEqual(f.calls.length, 1);
  assert.deepStrictEqual(f.calls[0].args, ["-i", "-w", "4242"]);
  a.set(false);
  assert.ok(f.calls[0].p.killed);
  a.set(false);
  a.set(true);
  assert.strictEqual(f.calls.length, 2);
  a.dispose();
  assert.ok(f.calls[1].p.killed);
});

check("stay awake: caffeinate that ended by itself is started again", () => {
  const f = fakeRun();
  const a = new StayAwake({ platform: "darwin", run: f.run });
  a.set(true);
  f.calls[0].p.emit("exit");
  a.set(true);
  assert.strictEqual(f.calls.length, 2);
});

check("stay awake: nothing on other systems", () => {
  const f = fakeRun();
  new StayAwake({ platform: "linux", run: f.run }).set(true);
  new StayAwake({ platform: "win32", run: f.run }).set(true);
  assert.strictEqual(f.calls.length, 0);
});

check("welcome: only when the last tab closed, and it wasn't Welcome", () => {
  const file = { label: "app.js", input: { uri: {} } };
  const welcome = { label: "Welcome", input: undefined };
  assert.strictEqual(shouldOpen([{ tabs: [] }], [file]), true);
  assert.strictEqual(shouldOpen([{ tabs: [] }, { tabs: [] }], [file, file]), true);
  assert.strictEqual(shouldOpen([{ tabs: [file] }], [file]), false);       // tabs left
  assert.strictEqual(shouldOpen([{ tabs: [] }], []), false);               // nothing closed (startup, opening)
  assert.strictEqual(shouldOpen([{ tabs: [] }], [welcome]), false);        // you closed Welcome itself
  assert.strictEqual(shouldOpen([{ tabs: [] }], [{ label: "Welcome.md", input: { uri: {} } }]), true);   // a file named so
});

if (failed) process.exit(1);
