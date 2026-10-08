// Kural's warm Claude helpers stop when nobody uses them (lib/ai/claude.js ClaudeSession idleStopMs): each `claude`
// process takes ~100 MB (docs/benchmarks/memory-2026-10-08.md). After the idle time with no questions the processes are
// stopped; the next question starts one again and is answered; a question still being answered is never cut off.
// A stand-in claude (stays running, answers each message) instead of the real one.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-idle-"));
const bin = path.join(tmp, "claude");
fs.writeFileSync(bin, `#!${process.execPath}
const delay = Number(process.env.FAKE_DELAY || 20);
let buf = "";
process.stdin.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== "user") continue;
    const clear = m.message.content === "/clear";
    setTimeout(() => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: clear ? "" : "<insert>ok</insert>", duration_ms: 1 }) + "\\n"), clear ? 1 : delay);
  }
});
process.stdin.on("end", () => process.exit(0));
`, { mode: 0o755 });

const vscode = { workspace: { getConfiguration: () => ({ get: (k) => (k === "claudePath" ? bin : undefined) }) } };
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
const claude = require("../extension/lib/ai/claude");
claude.setSetupGate(() => true);

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (s) => s.slots.filter((x) => !x.dead).map((x) => x.cp.proc.pid);
const running = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

(async () => {
  await check("no questions for the idle time: the processes stop; the next question starts one again", async () => {
    const s = new claude.ClaudeSession({ name: "t", model: () => "haiku", systemPrompt: "x", pool: 2, clearEach: true, idleStopMs: 1200 });
    s.start();
    const pids = alive(s);
    assert.strictEqual(pids.length, 2);
    assert.strictEqual(await s.ask("a question"), "<insert>ok</insert>");
    await sleep(250);
    assert.strictEqual(alive(s).length, 2);                // (not idle long enough yet)
    await sleep(1500);
    assert.strictEqual(s.slots.length, 0);
    await sleep(100);
    assert.ok(pids.every((p) => !running(p)), "the processes are gone");
    assert.strictEqual(await s.ask("another"), "<insert>ok</insert>");
    assert.ok(s.slots.length >= 1);
    s.stop();
  });
  await check("a question being answered isn't cut off by the idle time", async () => {
    process.env.FAKE_DELAY = "700";
    const s = new claude.ClaudeSession({ name: "t", model: () => "haiku", systemPrompt: "x", pool: 1, idleStopMs: 200, timeoutMs: 5000 });
    try {
      assert.strictEqual(await s.ask("slow one"), "<insert>ok</insert>");   // took 700 ms > 200 ms idle
      assert.strictEqual(s.slots.length, 1);
      await sleep(400);
      assert.strictEqual(s.slots.length, 0);
    } finally { delete process.env.FAKE_DELAY; s.stop(); }
  });
  await check("without idleStopMs nothing stops by itself (the chat's own processes don't use it)", async () => {
    const s = new claude.ClaudeSession({ name: "t", model: () => "haiku", systemPrompt: "x", pool: 1 });
    s.start(); await sleep(300);
    assert.strictEqual(alive(s).length, 1);
    s.stop();
  });
  await check("KURAL_IDLE_MS overrides the idle time (for measuring and tests)", () => {
    process.env.KURAL_IDLE_MS = "1234";
    try {
      assert.strictEqual(new claude.ClaudeSession({ name: "t", model: () => "haiku", idleStopMs: 600000 }).opts.idleStopMs, 1234);
      assert.strictEqual(new claude.ClaudeSession({ name: "t", model: () => "haiku" }).opts.idleStopMs, undefined);
    } finally { delete process.env.KURAL_IDLE_MS; }
  });
  await check("extension.js: Tab's Claude starts only when Tab may need it; every helper has an idle time; terminal Tab keeps one", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "extension", "extension.js"), "utf8");
    assert.ok(/if \(cfg\(\)\.get\("tabCompletion\.engine"\) === "claude" \|\| !\(await local\.ready\(\)\)\) tabSession\.start\(\);/.test(src));
    assert.ok(!/tabSession\.start\(\);\s*\n\}/.test(src));
    for (const name of ["tab", "terminal", "edit", "scm-commit", "commit", "words"]) {
      const i = src.indexOf(`name: "${name}"`);
      assert.ok(i > 0 && /idleStopMs: \d+ \* MIN/.test(src.slice(i, i + 500)), name);
    }
    assert.ok(/name: "terminal"[\s\S]{0,300}pool: 1,/.test(src));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `claude-idle: ${fail} FAILED` : "claude-idle: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
