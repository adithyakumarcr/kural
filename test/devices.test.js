// Devices over SSH (extension/lib/devices): the ssh layer, the bridge and the device tools' MCP server, against a
// stand-in ssh (test/fake-ssh.js) that checks the password the way real ssh gets it (askpass).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");

if (process.platform === "win32") { console.log("devices: skipped on Windows (the stand-in ssh is a script)"); process.exit(0); }

const fake = path.join(__dirname, "fake-ssh.js");
fs.chmodSync(fake, 0o755);
process.env.KURAL_SSH_BIN = fake;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "kural-dev-test-"));
process.env.FAKE_SSH_HOME = home;
const { Ssh, explain, q } = require("../extension/lib/devices/ssh");
const { Bridge } = require("../extension/lib/devices/bridge");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const ssh = new Ssh({ dir: path.join(home, ".kural-ssh") });
const dev = { host: "rpi.local", port: 22, user: "pi" };

(async () => {
  await check("the right password: connected, and what the device is", async () => {
    const t = await ssh.test(dev, "secret");
    assert.strictEqual(t.ok, true); assert.ok(t.system.length > 0);
  });
  await check("a wrong password: said in plain words", async () => {
    const t = await ssh.test(dev, "nope");
    assert.strictEqual(t.ok, false); assert.match(t.error, /username or password is wrong/);
  });
  await check("an unknown address: said in plain words", async () => {
    const t = await ssh.test({ ...dev, host: "nowhere" }, "secret");
    assert.strictEqual(t.ok, false); assert.match(t.error, /No device with that name/);
  });
  await check("the password never goes on ssh's command line", async () => {
    assert.ok(!ssh.args(dev).some((a) => /secret/.test(a)));
    assert.strictEqual(ssh.env("secret").KURAL_SSH_PW, "secret");
    assert.strictEqual(ssh.env("secret").SSH_ASKPASS_REQUIRE, "force");
  });
  await check("write, read and list a file (quotes and spaces in names are safe)", async () => {
    const name = "it's a file.txt";
    const w = await ssh.writeFile(dev, "secret", `sub dir/${name}`, "line 1\nline 2\n");
    assert.strictEqual(w.code, 0, w.stderr);
    assert.strictEqual((await ssh.readFile(dev, "secret", `sub dir/${name}`)).stdout, "line 1\nline 2\n");
    assert.match((await ssh.listDir(dev, "secret", "sub dir")).stdout, /it's a file/);
    assert.strictEqual(q("a'b"), "'a'\\''b'");
  });
  await check("a command that runs too long is stopped", async () => {
    const r = await ssh.run(dev, "secret", "sleep 5", { timeout: 300 });
    assert.strictEqual(r.timedOut, true);
    assert.match(explain(r), /didn't answer in time/);
  });

  // The bridge and the MCP server together, like Claude Code / Codex / Gemini use them.
  const asked = [];
  const bridge = new Bridge(ssh, async (id) => id === "d1" ? { dev, password: "secret" } : null);
  const s = bridge.session({ deviceId: "d1", name: "rpi", approve: async (tool, args) => { asked.push(tool); return args.command === "rm -rf ~" ? { allow: false, message: "Skipped by the user." } : { allow: true }; } });
  const mcp = spawn(process.execPath, s.server.args, { env: { ...process.env, ...s.server.env } });
  let out = "", waiters = [];
  mcp.stdout.on("data", (d) => { out += d; let i; while ((i = out.indexOf("\n")) >= 0) { const m = JSON.parse(out.slice(0, i)); out = out.slice(i + 1); const w = waiters.find((x) => x.id === m.id); if (w) w.done(m); } });
  let n = 0;
  const call = (method, params) => new Promise((done) => { const id = ++n; waiters.push({ id, done }); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const tool = async (name, args) => (await call("tools/call", { name, arguments: args })).result;

  await check("MCP: the device's four tools", async () => {
    await call("initialize", {});
    const r = await call("tools/list", {});
    assert.deepStrictEqual(r.result.tools.map((t) => t.name), ["run_command", "read_file", "write_file", "list_dir"]);
  });
  await check("MCP: a command runs (after Kural's OK) and its exit code comes back", async () => {
    const r = await tool("run_command", { command: "echo hello; exit 3" });
    assert.match(r.content[0].text, /Exit code 3/); assert.match(r.content[0].text, /hello/); assert.strictEqual(r.isError, true);
    assert.deepStrictEqual(asked, ["run_command"]);
  });
  await check("MCP: a command you skip doesn't run", async () => {
    const r = await tool("run_command", { command: "rm -rf ~" });
    assert.match(r.content[0].text, /Skipped/); assert.strictEqual(r.isError, true);
  });
  await check("MCP: writing asks, reading doesn't", async () => {
    asked.length = 0;
    assert.strictEqual((await tool("write_file", { path: "notes/todo.txt", content: "buy solder" })).isError, false);
    assert.strictEqual((await tool("read_file", { path: "notes/todo.txt" })).content[0].text, "buy solder");
    assert.deepStrictEqual(asked, ["write_file"]);
  });
  await check("MCP: another chat's (or a stale) token gets nothing", async () => {
    bridge.end(s.token);
    const r = await tool("list_dir", { path: "." });
    assert.match(r.content[0].text, /isn't linked/);
  });
  mcp.kill(); bridge.stop();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(fail ? `devices: ${fail} FAILED` : "devices: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
