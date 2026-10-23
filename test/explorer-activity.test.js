// The Explorer's AI activity (extension/lib/explorer/activity.js): which files are being read (blue) and changed
// (yellow), from the chat's tool calls; how long each shows; several chats at once. Fake timers, no vscode.
const assert = require("assert");
const path = require("path");
const { Activity, LINGER_MS, END_MS } = require("../extension/lib/explorer/activity");

let failed = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const ROOT = path.resolve("/work/app");
function setup() {
  const changed = [], queue = [];
  let now = 0;
  const timers = { set: (fn, ms) => { const t = { at: now + ms, fn }; queue.push(t); return t; }, clear: (t) => { t.fn = null; } };
  const a = new Activity({ root: () => ROOT, onChange: (files) => changed.push(...files), timers });
  const wait = (ms) => { now += ms; for (const t of queue.filter((x) => x.fn && x.at <= now)) { const f = t.fn; t.fn = null; f(); } };
  return { a, changed, wait };
}
const f = (rel) => path.join(ROOT, rel);

check("which calls count: reads and changes in Claude Code's names (and Gemini's), with the file's path; commands and globs don't", () => {
  assert.strictEqual(Activity.kindOf("Read"), "read"); assert.strictEqual(Activity.kindOf("Grep"), "read");
  assert.strictEqual(Activity.kindOf("Edit"), "change"); assert.strictEqual(Activity.kindOf("Write"), "change"); assert.strictEqual(Activity.kindOf("write_to_file"), "change");
  assert.strictEqual(Activity.kindOf("Bash"), null); assert.strictEqual(Activity.kindOf("WebFetch"), null);
  assert.strictEqual(Activity.fileOf({ file_path: "src/a.js" }, ROOT), f("src/a.js"));
  assert.strictEqual(Activity.fileOf({ file_path: f("b.js") }, ROOT), f("b.js"));
  assert.strictEqual(Activity.fileOf({ notebook_path: "n.ipynb" }, ROOT), f("n.ipynb"));
  assert.strictEqual(Activity.fileOf({ pattern: "**/*.js" }, ROOT), null);
  assert.strictEqual(Activity.fileOf({ path: "src/*.js" }, ROOT), null);
  assert.strictEqual(Activity.fileOf({ url: "https://x" }, ROOT), null);
  assert.strictEqual(Activity.fileOf({ file_path: "rel.js" }, null), null, "no project: a relative path means nothing");
});

check("a read: blue while it runs and a moment after, then gone (told each time)", () => {
  const { a, changed, wait } = setup();
  a.started("t1", "c1", "Read", { file_path: "src/a.js" });
  assert.strictEqual(a.state(f("src/a.js")), "read"); assert.deepStrictEqual(changed, [f("src/a.js")]);
  a.finished("t1", "c1");
  wait(LINGER_MS - 1); assert.strictEqual(a.state(f("src/a.js")), "read");
  wait(1); assert.strictEqual(a.state(f("src/a.js")), null); assert.strictEqual(changed.length, 2);
});

check("a change: yellow from the call until the answer ends, and a little after; it wins over a read", () => {
  const { a, wait } = setup();
  a.started("t1", "r1", "Read", { file_path: "x.js" });
  a.started("t1", "e1", "Edit", { file_path: "x.js", old_string: "a", new_string: "b" });
  assert.strictEqual(a.state(f("x.js")), "change");
  a.finished("t1", "e1"); a.finished("t1", "r1");
  wait(60000); assert.strictEqual(a.state(f("x.js")), "change", "until the answer ends");
  a.ended("t1");
  wait(END_MS - 1); assert.strictEqual(a.state(f("x.js")), "change");
  wait(1); assert.strictEqual(a.state(f("x.js")), null);
});

check("two chats on one file: it stays yellow until both are done; a call reported twice counts once", () => {
  const { a, wait } = setup();
  a.started("t1", "e1", "Write", { file_path: "y.js" }); a.started("t1", "e1", "Write", { file_path: "y.js" });
  a.started("t2", "e9", "Edit", { file_path: "y.js" });
  a.ended("t1"); wait(END_MS);
  assert.strictEqual(a.state(f("y.js")), "change");
  a.ended("t2"); wait(END_MS);
  assert.strictEqual(a.state(f("y.js")), null);
});

check("an answer stopped while a read runs: the read goes too; dispose stops every timer", () => {
  const { a, wait } = setup();
  a.started("t1", "r1", "Grep", { pattern: "x", path: "lib/z.js" });
  a.ended("t1"); wait(END_MS);
  assert.strictEqual(a.state(f("lib/z.js")), null);
  a.started("t1", "r2", "Read", { file_path: "q.js" }); a.finished("t1", "r2");
  a.dispose(); wait(LINGER_MS * 2);
  assert.strictEqual(a.state(f("q.js")), "read", "(nothing runs after dispose)");
});

console.log(failed ? `explorer-activity: ${failed} FAILED` : "explorer-activity: ALL PASS"); process.exitCode = failed ? 1 : 0;
