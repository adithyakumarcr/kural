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
const crypto = require("crypto");
const { Ssh, explain, q } = require("../extension/lib/devices/ssh");
const { Bridge } = require("../extension/lib/devices/bridge");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const ssh = new Ssh({ dir: path.join(home, ".kural-ssh") });
const dev = { host: "rpi.local", port: 22, user: "pi" };

(async () => {
  await check("before setup, Kural's key isn't accepted", async () => {
    const t = await ssh.test(dev);
    assert.strictEqual(t.ok, false); assert.match(t.error, /no longer accepts Kural's key/);
  });
  await check("a wrong password: said in plain words, nothing installed", async () => {
    const t = await ssh.installKey(dev, "nope");
    assert.strictEqual(t.ok, false); assert.match(t.error, /username or password is wrong/);
    assert.ok(!fs.existsSync(path.join(home, ".ssh", "authorized_keys")));
  });
  await check("an unknown address: said in plain words", async () => {
    const t = await ssh.installKey({ ...dev, host: "nowhere" }, "secret");
    assert.strictEqual(t.ok, false); assert.match(t.error, /No device with that name/);
  });
  await check("the right password puts Kural's key on the device once; then the key works on its own", async () => {
    const t = await ssh.installKey(dev, "secret");
    assert.strictEqual(t.ok, true, t.error); assert.ok(t.system.length > 0);
    await ssh.installKey(dev, "secret");   // twice: still one line
    const keys = fs.readFileSync(path.join(home, ".ssh", "authorized_keys"), "utf8").trim().split("\n");
    assert.strictEqual(keys.length, 1); assert.match(keys[0], /^ssh-ed25519 /);
    assert.strictEqual((fs.statSync(ssh.key).mode & 0o077), 0, "the private key is readable only by you");
    assert.strictEqual((await ssh.test(dev)).ok, true);
  });
  await check("the password never goes on ssh's command line; key logins never ask anything", async () => {
    assert.ok(!ssh.args(dev, { password: true }).some((a) => /secret/.test(a)));
    assert.strictEqual(ssh.env("secret").KURAL_SSH_PW, "secret");
    assert.strictEqual(ssh.env("secret").SSH_ASKPASS_REQUIRE, "force");
    assert.strictEqual(ssh.env(null).KURAL_SSH_PW, undefined);
    const a = ssh.args(dev).join(" ");
    assert.match(a, /-i \S+id_ed25519/); assert.match(a, /BatchMode=yes/); assert.match(a, /PasswordAuthentication=no/);
  });
  await check("write, read and list a file (quotes and spaces in names are safe)", async () => {
    const name = "it's a file.txt";
    const w = await ssh.writeFile(dev, null, `sub dir/${name}`, "line 1\nline 2\n");
    assert.strictEqual(w.code, 0, w.stderr);
    assert.strictEqual((await ssh.readFile(dev, null, `sub dir/${name}`)).stdout, "line 1\nline 2\n");
    assert.match((await ssh.listDir(dev, null, "sub dir")).stdout, /it's a file/);
    assert.strictEqual(q("a'b"), "'a'\\''b'");
  });
  await check("a command that runs too long is stopped", async () => {
    const r = await ssh.run(dev, null, "sleep 5", { timeout: 300 });
    assert.strictEqual(r.timedOut, true);
    assert.match(explain(r), /didn't answer in time/);
  });
  await check("a timeout answers at once even while something still holds ssh's output (a reused connection)", async () => {
    const t0 = Date.now();
    const r = await ssh.run(dev, null, "sleep 3 & sleep 3", { timeout: 300 });
    assert.strictEqual(r.timedOut, true);
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  });
  await check("the device's own time limit stops a command that never ends", async () => {
    const r = await ssh.runLimited(dev, null, "echo started; sleep 30", 1);
    assert.match(r.stdout, /started/); assert.strictEqual(r.code, 124);
  });
  await check("~/ paths mean the home folder (not a folder named ~)", async () => {
    assert.strictEqual((await ssh.writeFile(dev, null, "~/tilde/a.txt", "hi")).code, 0);
    assert.ok(fs.existsSync(path.join(home, "tilde", "a.txt")));
    assert.ok(!fs.existsSync(path.join(home, "~")));
    assert.strictEqual((await ssh.readFile(dev, null, "~/tilde/a.txt")).stdout, "hi");
  });
  await check("Forget its key: plain and hashed (Ubuntu's HashKnownHosts) lines", async () => {
    const salt = crypto.randomBytes(20);
    const hashed = (h) => `|1|${salt.toString("base64")}|${crypto.createHmac("sha1", salt).update(h).digest("base64")}`;
    fs.writeFileSync(ssh.knownHosts, `rpi.local ssh-ed25519 AAA1\n${hashed("rpi.local")} ssh-ed25519 AAA2\n${hashed("[rpi.local]:2222")} ssh-ed25519 AAA3\nother ssh-ed25519 AAA4\n`);
    ssh.forgetKey(dev);
    assert.deepStrictEqual(fs.readFileSync(ssh.knownHosts, "utf8").trim().split("\n").map((l) => l.split(" ")[2]), ["AAA3", "AAA4"]);
  });

  // The bridge and the MCP server together, like Claude Code / Codex / Gemini use them.
  const asked = [];
  const bridge = new Bridge(ssh, async (id) => id === "d1" ? { dev, password: null } : id === "old" ? { error: "old needs to be set up again" } : null);
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
  await check("MCP: unlinking stops a command that's still running", async () => {
    const t0 = Date.now();
    const p = tool("run_command", { command: "sleep 20" });
    await new Promise((r) => setTimeout(r, 300));
    bridge.end(s.token);
    const r = await p;
    assert.match(r.content[0].text, /Stopped/); assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });
  await check("MCP: another chat's (or a stale) token gets nothing", async () => {
    const r = await tool("list_dir", { path: "." });
    assert.match(r.content[0].text, /isn't linked/);
  });
  mcp.kill();
  await check("MCP for Gemini: the tools carry a prefix (Gemini doesn't say which server a tool is from)", async () => {
    const g = bridge.session({ deviceId: "d1", name: "rpi", prefix: "kural_device_", approve: async () => ({ allow: true }) });
    const m = spawn(process.execPath, g.server.args, { env: { ...process.env, ...g.server.env } });
    const lines = []; let buf = "";
    m.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const ask = (id, method, params) => new Promise((done) => { m.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); const t = setInterval(() => { const x = lines.find((l) => l.id === id); if (x) { clearInterval(t); done(x); } }, 20); });
    assert.deepStrictEqual((await ask(1, "tools/list", {})).result.tools.map((t) => t.name), ["kural_device_run_command", "kural_device_read_file", "kural_device_write_file", "kural_device_list_dir"]);
    assert.match((await ask(2, "tools/call", { name: "kural_device_run_command", arguments: { command: "echo via-gemini" } })).result.content[0].text, /via-gemini/);
    m.kill(); bridge.end(g.token);
  });
  await check("a device saved by an older Kural (no key yet): the AI is told it needs setting up, nothing is asked or run", async () => {
    const asked = [];
    const o = bridge.session({ deviceId: "old", name: "old", approve: async (t) => { asked.push(t); return { allow: true }; } });
    const r = await bridge.call({ token: o.token, tool: "run_command", args: { command: "echo hi" } });
    assert.match(r.text, /set up again/); assert.strictEqual(r.isError, true); assert.deepStrictEqual(asked, []);
  });
  await check("removing the device takes Kural's key off it", async () => {
    fs.appendFileSync(path.join(home, ".ssh", "authorized_keys"), "ssh-ed25519 AAAAother someone@else\n");
    await ssh.removeKey(dev);
    assert.deepStrictEqual(fs.readFileSync(path.join(home, ".ssh", "authorized_keys"), "utf8").trim().split("\n"), ["ssh-ed25519 AAAAother someone@else"]);
    assert.strictEqual((await ssh.test(dev)).ok, false);
  });
  bridge.stop();
  fs.rmSync(home, { recursive: true, force: true });
  console.log(fail ? `devices: ${fail} FAILED` : "devices: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
