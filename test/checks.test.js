// Get started's checks (extension/lib/ai/claude-checks.js), against a stand-in claude (test/fake-claude.js).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const checks = require("../extension/lib/ai/claude-checks");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const fake = path.join(__dirname, "fake-claude.js");
fs.chmodSync(fake, 0o755);
const env = (state) => ({ ...process.env, FAKE_CLAUDE_STATE: state, FAKE_CLAUDE_MS: "50" });
const isWin = process.platform === "win32";

(async () => {
  if (isWin) { console.log("checks: skipped on Windows (the stand-in claude is a script)"); return; }
  await check("installed: the version", async () => assert.deepStrictEqual(await checks.claudeVersion(fake, env("ok")), { version: "2.1.300" }));
  await check("not a working claude: an error, not a version", async () => assert.ok((await checks.claudeVersion("/bin/false", env("ok"))).error));
  await check("logged in / logged out", async () => {
    assert.strictEqual((await checks.claudeAuth(fake, env("ok"))).loggedIn, true);
    assert.strictEqual((await checks.claudeAuth(fake, env("loggedout"))).loggedIn, false);
  });
  await check("who's logged in: email, organization, plan", async () => {
    const a = await checks.claudeAuth(fake, env("ok"));
    assert.strictEqual(a.email, "tester@example.com"); assert.strictEqual(a.org, "Tester's Organization"); assert.strictEqual(a.plan, "Pro");
    assert.strictEqual(a.method, "Claude Pro"); assert.strictEqual(a.apiKey, false);
  });
  await check("log out: Claude Code says logged out afterwards", async () => {
    const file = path.join(os.tmpdir(), `kural-fake-state-${process.pid}`);
    fs.writeFileSync(file, "ok");
    const e = { ...process.env, FAKE_CLAUDE_FILE: file, FAKE_CLAUDE_MS: "50" };
    delete e.FAKE_CLAUDE_STATE;
    assert.deepStrictEqual(await checks.claudeLogout(fake, e), { ok: true });
    assert.strictEqual((await checks.claudeAuth(fake, e)).loggedIn, false);
    fs.unlinkSync(file);
  });
  await check("old Claude Code without `auth status`: unknown (the test decides)", async () =>
    assert.strictEqual((await checks.claudeAuth(fake, env("old"))).loggedIn, null));
  await check("checks don't block: other work runs meanwhile", async () => {
    let ticks = 0; const t = setInterval(() => ticks++, 5);
    await checks.claudeAuth(fake, env("ok")); clearInterval(t);
    assert.ok(ticks > 0, "the event loop was blocked");
  });
  await check("test passes: Claude answered", async () => {
    const r = await checks.claudeTest(fake, env("ok"));
    assert.strictEqual(r.ok, true); assert.strictEqual(r.answer, "OK"); assert.ok(r.ms >= 0);
  });
  await check("test fails when logged out, and says it's the login", async () => {
    const r = await checks.claudeTest(fake, env("loggedout"));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.login, true);
    assert.match(checks.explain(r.error), /isn't logged in/);
  });
  await check("test fails without Claude Code access: says why", async () => {
    const r = await checks.claudeTest(fake, env("nocredit"));
    assert.strictEqual(r.ok, false); assert.strictEqual(r.login, false);
    assert.match(checks.explain(r.error), /Pro, Max, Team or Enterprise/);
  });
  await check("test: a program that just stops is a failure, not a hang", async () => {
    const r = await checks.claudeTest("/bin/true", env("ok"), { timeoutMs: 5000 });
    assert.strictEqual(r.ok, false);
  });
  await check("the official installer per system", () => {
    assert.match(checks.installFor("darwin").command, /claude\.ai\/install\.sh \| bash/);
    assert.match(checks.installFor("win32").command, /install\.ps1 \| iex/);
  });
  await check("login method in plain words", () => {
    assert.strictEqual(checks.describeMethod({ apiProvider: "bedrock" }), "Amazon Bedrock");
    assert.strictEqual(checks.describeMethod({ authMethod: "api_key", apiProvider: "firstParty" }), "API key");
    assert.strictEqual(checks.describeMethod({ authMethod: "claude.ai", subscriptionType: "max" }), "Claude Max");
  });
})().then(() => { console.log(fail ? `checks: ${fail} FAILED` : "checks: ALL PASS"); process.exit(fail ? 1 : 0); });
