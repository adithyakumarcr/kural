// BUG-1: output of a program with a multi-byte character cut in two between chunks (Tamil, é, ✓, emoji) must arrive whole
// in every place Kural reads a child process: lib/utf8.js onText, ripgrep results, ssh commands, the engine's Bash tool,
// Claude's test request, installers. The child writes one BYTE at a time, so every such character is split.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const { spawn } = require("child_process");
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? { workspace: { getConfiguration: () => ({ get: () => "" }) }, window: {}, env: {} } : load.call(this, r, ...a); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-utf8-"));
const EMIT = path.join(tmp, "emit.js");
fs.writeFileSync(EMIT, `const buf = Buffer.from(process.argv[2], "utf8"); let i = 0;
(function next() { if (i >= buf.length) return setTimeout(() => process.exit(0), 20); process.stdout.write(buf.subarray(i, i + 1)); i++; setTimeout(next, 1); })();\n`);
const word = "வணக்கம் é ✓ 😀";

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } };
const script = (name, body) => { const f = path.join(tmp, name); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return f; };

(async () => {
  await check("onText: a character split across chunks arrives whole; strings pass through", () => {
    const { onText } = require("../extension/lib/utf8");
    const { EventEmitter } = require("events");
    const s = new EventEmitter(); let got = "";
    onText(s, (t) => { got += t; });
    const b = Buffer.from(word + "\n");
    for (let i = 0; i < b.length; i++) s.emit("data", b.subarray(i, i + 1));
    s.emit("data", "plain");
    assert.strictEqual(got, word + "\nplain");
  });

  await check("ripgrep results (search/text.js runRg)", async () => {
    const { runRg } = require("../extension/lib/search/text");
    const line = [{ type: "begin", data: { path: { text: "f.txt" } } },
      { type: "match", data: { path: { text: "f.txt" }, lines: { text: word + "\n" }, line_number: 1, absolute_offset: 0, submatches: [{ match: { text: word }, start: 0, end: Buffer.byteLength(word) }] } },
      { type: "end", data: { path: { text: "f.txt" } } }].map((j) => JSON.stringify(j)).join("\n") + "\n";
    const got = [];
    await runRg("rg", os.tmpdir(), [], (f, m) => got.push(...m), { spawnFn: (b, a, o) => spawn(process.execPath, [EMIT, line], o) }).job;
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].text, word);
  });

  await check("ssh command output (devices/ssh.js run)", async () => {
    if (process.platform === "win32") return;
    const { Ssh } = require("../extension/lib/devices/ssh");
    const bin = script("fake-ssh.sh", `exec "${process.execPath}" "${EMIT}" '${word}'`);
    const ssh = new Ssh({ dir: path.join(tmp, "ssh"), bin });
    const r = await ssh.run({ host: "h", user: "u" }, null, "x", { timeout: 8000, reuse: false });
    assert.strictEqual(r.stdout, word);
  });

  await check("the engine's Bash tool (ai/tools.js)", async () => {
    if (process.platform === "win32") return;
    const { Tools } = require("../extension/lib/ai/tools");
    const out = await new Tools(tmp).bash({ command: `"${process.execPath}" "${EMIT}" '${word}'` });
    assert.ok(out.startsWith(word), out);
  });

  await check("Claude's test request (ai/claude-checks.js claudeTest)", async () => {
    if (process.platform === "win32") return;
    const checks = require("../extension/lib/ai/claude-checks");
    const res = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: word }) + "\n";
    const bin = script("fake-claude.sh", `cat >/dev/null &\nexec "${process.execPath}" "${EMIT}" '${res}'`);
    const t = await checks.claudeTest(bin, process.env, { cwd: tmp, timeoutMs: 15000 });
    assert.strictEqual(t.ok, true, t.error);
    assert.strictEqual(t.answer, word);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `utf8-output: ${failed} FAILED` : "utf8-output: ALL PASS");
  process.exit(failed ? 1 : 0);
})();
