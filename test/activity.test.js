// What Tab learns from your work (extension/lib/tab/activity.js): what it remembers, and the notes it builds.
const assert = require("assert");
const { Activity } = require("../extension/lib/tab/activity");

let fail = 0;
const check = (name, fn) => { try { fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };

let now = Date.UTC(2026, 9, 2, 12, 0, 0);
const store = () => { const m = new Map(); return { get: (k) => m.get(k), update: (k, v) => m.set(k, v), m }; };
const make = (s = store(), on = () => true) => new Activity(s, on, () => now);

check("nothing learned: no notes", () => {
  const a = make();
  assert.strictEqual(a.tabNote("a.py", "python"), "");
  assert.strictEqual(a.terminalNote("git commit -m \"", { since: 0, files: [] }), "");
});

check("chat work becomes the current task for Tab", () => {
  const a = make();
  a.addWork("chat", "Add input validation to heat_input", ["src/weld_params.py"]);
  const n = a.tabNote("src/main.py", "python");
  assert.ok(/Current task/.test(n) && /heat_input/.test(n) && /weld_params\.py/.test(n), n);
});

check("old work (over 3 h) isn't the current task", () => {
  const a = make();
  a.addWork("chat", "Old thing", []);
  now += 4 * 3600 * 1000;
  assert.ok(!/Old thing/.test(a.tabNote("x.py", "python")));
});

check("accepted suggestions: same language, this file first", () => {
  const a = make();
  a.tabAccepted("b.py", "python", "def f(", "x: float) -> float:");
  a.tabAccepted("c.js", "javascript", "const x = ", "1;");
  a.tabAccepted("a.py", "python", "return ", "round(v, 2)");
  const n = a.tabNote("a.py", "python");
  assert.ok(/round\(v, 2\)/.test(n) && /x: float/.test(n) && !/const x/.test(n), n);
});

check("an edit in another file shows; the same file doesn't", () => {
  const a = make();
  a.edited("speed.py", "python", 9, "def mm_s_to_m_min(v):\n    return v * 0.06");
  assert.ok(/last edit elsewhere \(speed\.py, line 10\)/.test(a.tabNote("gas.py", "python")));
  assert.ok(!/last edit elsewhere/.test(a.tabNote("speed.py", "python")));
});

check("commit: only work since the last commit, on the changed files", () => {
  const a = make();
  a.addWork("chat", "Before the last commit", ["a.py"]);
  const commitAt = now + 1000; now += 60000;
  a.addWork("Ctrl+K", "Round speeds to 2 decimals", ["src/speed.py"]);
  a.addWork("chat", "Explain the README", []);                 // no files: still context
  a.addWork("chat", "Rename the gas module", ["src/gas.py"]);  // a file that isn't in this commit
  const n = a.terminalNote("git commit -m \"", { since: commitAt, files: ["src/speed.py"] });
  assert.ok(/Round speeds/.test(n) && /Explain the README/.test(n), n);
  assert.ok(!/Before the last commit/.test(n) && !/Rename the gas/.test(n), n);
});

check("undo removes the file from that work", () => {
  const a = make();
  a.addWork("chat", "Change speed", ["src/speed.py"]);
  a.undone("src/speed.py");
  assert.ok(!/speed\.py/.test(a.tabNote("x.py", "python")));
});

check("commands: counted, matching what you type, most used first", () => {
  const a = make();
  for (let i = 0; i < 3; i++) a.ranCommand("npm test");
  a.ranCommand("npm run build");
  a.ranCommand("ls -la");
  const n = a.terminalNote("npm", null);
  assert.ok(/\$ npm test\s+\(3×\)/.test(n) && n.indexOf("npm test") < n.indexOf("npm run build") && !/ls -la/.test(n), n);
});

check("never keeps commands with passwords or tokens", () => {
  const a = make();
  a.ranCommand("export API_KEY=abc123");
  a.ranCommand("curl -H 'Authorization: Bearer xyz' https://x");
  a.ranCommand("mysql --password=hunter2");
  assert.deepStrictEqual(Object.keys(a.commands), []);
});

check("saved per workspace and read back; Forget clears it", () => {
  const s = store();
  const a = make(s);
  a.addWork("chat", "Persist me", ["p.py"]);
  a.ranCommand("make");
  a.save(); clearTimeout(a.saveTimer); a.saveTimer = null;
  s.update("kural.activity.v1", { work: a.work, accepted: a.accepted, commands: a.commands });
  const b = make(s);
  assert.ok(/Persist me/.test(b.tabNote("x.py", "python")));
  b.forget();
  assert.strictEqual(s.get("kural.activity.v1"), undefined);
  assert.strictEqual(make(s).tabNote("x.py", "python"), "");
});

check("switched off: learns nothing, says nothing", () => {
  const a = make(store(), () => false);
  a.addWork("chat", "Something", ["a.py"]);
  a.ranCommand("npm test");
  assert.strictEqual(a.work.length + Object.keys(a.commands).length, 0);
  assert.strictEqual(a.tabNote("a.py", "python"), "");
});

console.log(fail ? `activity: ${fail} FAILED` : "activity: ALL PASS");
process.exit(fail ? 1 : 0);
