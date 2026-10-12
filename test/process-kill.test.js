// BUG-11 / BUG-12 / BUG-8: ending a child process and cleaning up after it.
//  - a program that ignores SIGTERM (`trap '' TERM`) is ended with SIGKILL after a grace time, the engine's Bash tool answers
//    (it used to wait for ever), Windows ends the whole tree with taskkill /T /F;
//  - a Claude process removes its own prompt files and its own temporary working folder when it ends.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const { spawn, execFileSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-kill-"));
let claudePath = "";
const load = Module._load;
Module._load = function (r, ...a) {
  return r === "vscode" ? { workspace: { getConfiguration: () => ({ get: (k) => k === "claudePath" ? claudePath : "" }), isTrusted: true }, window: {}, env: {} } : load.call(this, r, ...a);
};
const { killTree } = require("../extension/lib/ai/killtree");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond, what, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(10); } };

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const posix = process.platform !== "win32";

(async () => {
  await check("Windows: taskkill /T /F on the process id (the whole tree), no signals", () => {
    const calls = [];
    killTree({ pid: 4321, kill: () => { throw new Error("must not be used"); } }, { win: true, taskkill: (...a) => calls.push(a) });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], "taskkill");
    assert.deepStrictEqual(calls[0][1], ["/pid", "4321", "/T", "/F"]);
    // no pid yet: falls back to the child's own kill
    let killed = 0;
    killTree({ kill: () => { killed++; } }, { win: true, taskkill: () => { throw new Error("no pid"); } });
    assert.strictEqual(killed, 1);
  });

  await check("a process that ignores SIGTERM is ended by SIGKILL, with the children in its group", async () => {
    if (!posix) return;
    const p = spawn("/bin/sh", ["-c", "trap '' TERM; sleep 302 & echo $! > " + path.join(tmp, "child.pid") + "; wait"], { detached: true, stdio: "ignore" });
    await waitFor(() => fs.existsSync(path.join(tmp, "child.pid")) && fs.readFileSync(path.join(tmp, "child.pid"), "utf8").trim(), "the child to start");
    const childPid = Number(fs.readFileSync(path.join(tmp, "child.pid"), "utf8"));
    const gone = new Promise((r) => p.on("exit", r));
    const t0 = Date.now();
    killTree(p, { grace: 300 });
    await sleep(100);
    assert.ok(alive(p.pid), "SIGTERM alone does not end it");
    await gone;
    assert.ok(Date.now() - t0 < 5000);
    await waitFor(() => !alive(childPid), "the child in its group to end");
  });

  await check("the engine's Bash tool: a command that ignores SIGTERM stops at its time limit and the answer comes", async () => {
    if (!posix) return;
    const { Tools } = require("../extension/lib/ai/tools");
    const t0 = Date.now();
    const out = await new Tools(tmp).bash({ command: "trap '' TERM; echo started; sleep 303 & wait", timeout: 600 });
    const took = Date.now() - t0;
    assert.match(out, /started/);
    assert.ok(took < 8000, `took ${took} ms`);   // (it never ended before: SIGTERM only)
    let left = ""; try { left = execFileSync("pgrep", ["-f", "sleep 303"], { encoding: "utf8" }); } catch { /* none */ }
    assert.strictEqual(left.trim(), "", "the sleep it started is gone too");
  });

  await check("Stop (Tools.stop) ends a command that ignores SIGTERM too", async () => {
    if (!posix) return;
    const { Tools } = require("../extension/lib/ai/tools");
    const tools = new Tools(tmp);
    const p = tools.bash({ command: "trap '' TERM; echo going; sleep 304 & wait" });
    await sleep(300);
    const t0 = Date.now();
    tools.stop();
    const out = await p;
    assert.ok(Date.now() - t0 < 8000);
    assert.match(out, /going/);
  });

  // A stand-in claude: writes what it was started with (arguments, working folder) to $KURAL_OUT, then waits for its input
  // to end; MODE=stubborn ignores SIGTERM.
  const fake = path.join(tmp, "fake-claude.js");
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require("fs");
fs.writeFileSync(process.env.KURAL_OUT, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), pid: process.pid }));
if (process.env.MODE === "stubborn") process.on("SIGTERM", () => {});
process.stdin.on("data", () => {}); process.stdin.on("end", () => process.exit(0));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const { ClaudeProcess } = require("../extension/lib/ai/claude");
  const start = async (env, opts = {}) => {
    const out = path.join(tmp, `out-${Math.random().toString(36).slice(2)}.json`);
    process.env.KURAL_OUT = out; process.env.MODE = env;
    const cp = new ClaudeProcess({ name: "t", model: "haiku", systemPrompt: "SYSTEM TEXT", appendSystemPrompt: "APPEND TEXT", mcpServers: { x: { command: "y" } }, tools: [], ...opts }, { onMessage: () => {} });
    assert.ok(cp.start());
    await waitFor(() => fs.existsSync(out), "the stand-in to start");
    await sleep(30);
    const seen = JSON.parse(fs.readFileSync(out, "utf8"));
    const files = ["--system-prompt-file", "--append-system-prompt-file", "--mcp-config"].map((f) => seen.args[seen.args.indexOf(f) + 1]);
    return { cp, seen, files };
  };

  await check("a Claude process removes its prompt files and its own temporary folder when it ends", async () => {
    if (!posix) return;
    claudePath = fake;
    const { cp, seen, files } = await start("normal");
    for (const f of files) assert.ok(fs.existsSync(f), `${f} exists while it runs`);
    assert.strictEqual(fs.readFileSync(files[0], "utf8"), "SYSTEM TEXT");
    assert.ok(fs.existsSync(seen.cwd) && path.basename(seen.cwd).startsWith("kural-"));
    cp.kill();
    await waitFor(() => cp.exited, "the process to end");
    for (const f of files) assert.ok(!fs.existsSync(f), `${f} is gone`);
    assert.ok(!fs.existsSync(seen.cwd), "its temporary working folder is gone");
  });

  await check("a folder given to a Claude process (the project) is never removed", async () => {
    if (!posix) return;
    claudePath = fake;
    const proj = path.join(tmp, "project"); fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, "keep.txt"), "mine");
    const { cp } = await start("normal", { cwd: proj });
    cp.kill();
    await waitFor(() => cp.exited, "the process to end");
    assert.strictEqual(fs.readFileSync(path.join(proj, "keep.txt"), "utf8"), "mine");
  });

  await check("ClaudeProcess.kill ends a process that ignores SIGTERM (SIGKILL after the grace time)", async () => {
    if (!posix) return;
    claudePath = fake;
    const { cp, seen, files } = await start("stubborn");
    const t0 = Date.now();
    cp.kill();
    await sleep(300);
    assert.ok(alive(seen.pid), "still running after SIGTERM");
    await waitFor(() => cp.exited, "SIGKILL to end it", 10000);
    assert.ok(Date.now() - t0 < 8000);
    for (const f of files) assert.ok(!fs.existsSync(f));
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `process-kill: ${failed} FAILED` : "process-kill: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
