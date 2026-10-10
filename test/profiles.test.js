// Profiles (extension/lib/profiles): the list and its rules, which environment each profile gives Claude / Codex, which
// saved data is shared and which is a profile's own, and that the programs Kural starts really get the profile's folders
// (against the stand-in claude and codex, whose login state lives in CLAUDE_CONFIG_DIR / CODEX_HOME like the real ones).
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");

if (process.platform === "win32") { console.log("profiles: skipped on Windows (the stand-ins are scripts)"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-profiles-"));
// claude.js wants vscode; only its settings are read here.
const vscode = { workspace: { getConfiguration: () => ({ get: () => undefined }) } };
const load = Module._load;
Module._load = function (r, ...a) { return r === "vscode" ? vscode : load.call(this, r, ...a); };
// A login in the test machine's environment must not decide the results below.
for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "FAKE_CLAUDE_STATE", "FAKE_CLAUDE_FILE", "FAKE_CODEX_STATE", "FAKE_CODEX_FILE"]) delete process.env[k];

const { ProfileStore, MAIN } = require("../extension/lib/profiles/store");
const penv = require("../extension/lib/profiles/env");
const scope = require("../extension/lib/profiles/scope");
const claude = require("../extension/lib/ai/claude");
const checks = require("../extension/lib/ai/claude-checks");
const codex = require("../extension/lib/ai/codex");
const { accountName } = require("../extension/lib/ai/names");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const mem = (initial) => { let v = initial; return { read: () => v, write: async (x) => { v = JSON.parse(JSON.stringify(x)); }, get value() { return v; } }; };
const rejects = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail("should have been refused"); };

(async () => {
  // ---------- the list ----------
  await check("nothing saved: the main profile 'Personal', active", () => {
    const s = new ProfileStore(() => undefined, async () => {});
    assert.deepStrictEqual(s.data(), { active: MAIN, list: [{ id: "default", name: "Personal", kind: "personal", share: true }] });
    assert.strictEqual(s.active().id, MAIN);
  });
  await check("create: id is a short slug plus a random ending; names are unique, any case; at most 30 characters", async () => {
    const m = mem(); const s = new ProfileStore(m.read, m.write);
    const w = await s.create({ name: "  Work Stuff! ", kind: "work", share: false });
    assert.match(w.id, /^work-stuff-[0-9a-f]{6}$/);
    assert.deepStrictEqual([w.name, w.kind, w.share], ["Work Stuff!", "work", false]);
    await rejects(s.create({ name: "work stuff!", kind: "work" }), /already exists/);
    await rejects(s.create({ name: "PERSONAL", kind: "personal" }), /already exists/);   // (the main profile's name counts too)
    await rejects(s.create({ name: "   " }), /name/);
    await rejects(s.create({ name: "x".repeat(31) }), /30/);
    assert.strictEqual(m.value.list.length, 2);
    const odd = await s.create({ name: "日本語", kind: "nonsense" });
    assert.match(odd.id, /^profile-[0-9a-f]{6}$/);   // (nothing left to make a slug from)
    assert.strictEqual(odd.kind, "personal"); assert.strictEqual(odd.share, true);   // (unknown kind -> personal; sharing is the default)
  });
  await check("ids are safe folder names", async () => {
    const s = new ProfileStore(() => undefined, async () => {});
    for (const n of ["../../etc", "a/b\\c", "..", "Ünïcode name", "x".repeat(30)]) assert.ok(scope.SAFE_ID.test(s.newId(n)), n);
  });
  await check("rename (also the main profile); a taken name is refused; its own name again is fine", async () => {
    const m = mem(); const s = new ProfileStore(m.read, m.write);
    const w = await s.create({ name: "Work", kind: "work" });
    await s.rename(MAIN, "Home");
    assert.strictEqual(s.get(MAIN).name, "Home");
    await rejects(s.rename(w.id, "home"), /already exists/);
    await s.rename(w.id, "WORK");
    assert.strictEqual(s.get(w.id).name, "WORK");
    await rejects(s.rename("nope", "Whatever"), /No such/);
  });
  await check("share flag: changeable on another profile, not on the main one", async () => {
    const m = mem(); const s = new ProfileStore(m.read, m.write);
    const w = await s.create({ name: "Work", kind: "work", share: true });
    await s.setShare(w.id, false);
    assert.strictEqual(s.get(w.id).share, false);
    await s.setShare(w.id, true);
    assert.strictEqual(s.get(w.id).share, true);
    await rejects(s.setShare(MAIN, false), /main profile/);
  });
  await check("delete: not the main profile, not the active one; the rest goes", async () => {
    const m = mem(); const s = new ProfileStore(m.read, m.write);
    const w = await s.create({ name: "Work", kind: "work" });
    await rejects(s.remove(MAIN), /can't be deleted/);
    await s.setActive(w.id);
    await rejects(s.remove(w.id), /in use/);
    await s.setActive(MAIN);
    const gone = await s.remove(w.id);
    assert.strictEqual(gone.name, "Work");
    assert.deepStrictEqual(s.list().map((p) => p.id), [MAIN]);
    await rejects(s.setActive(w.id), /No such/);
  });
  await check("damaged saved data is repaired, not trusted", () => {
    const s = new ProfileStore(() => ({ active: "gone", list: [
      { id: "w-1", name: "Work", kind: "work", share: false }, { id: "w-1", name: "Duplicate" }, { id: 5, name: "x" }, { id: "n-1", name: "  " },
      null, { id: "default", name: "Home" }, { id: "k-1", name: "K", kind: "weird" }] }), async () => {});
    const d = s.data();
    assert.deepStrictEqual(d.list.map((p) => [p.id, p.name, p.kind, p.share]), [["default", "Home", "personal", true], ["w-1", "Work", "work", false], ["k-1", "K", "personal", true]]);
    assert.strictEqual(d.active, MAIN);
  });

  // ---------- the environment ----------
  await check("main profile: no variables; another profile: its own Claude and Codex folders", () => {
    assert.deepStrictEqual(penv.envFor(null), {});
    const dir = path.join(tmp, "profiles", "work-1");
    assert.deepStrictEqual(penv.envFor(dir), { CLAUDE_CONFIG_DIR: path.join(dir, "claude"), CODEX_HOME: path.join(dir, "codex") });
  });
  await check("setProfileEnv / profileEnv / withProfileEnv / claudeConfigDir", () => {
    penv.setProfileEnv({});
    assert.deepStrictEqual(penv.profileEnv(), {});
    assert.strictEqual(penv.withProfileEnv({ A: "1" }).A, "1");
    assert.strictEqual(penv.claudeConfigDir("/h", {}), path.join("/h", ".claude"));
    assert.strictEqual(penv.claudeConfigDir("/h", { CLAUDE_CONFIG_DIR: "/mine" }), "/mine");   // (your own setting still counts for the main profile)
    penv.setProfileEnv({ CLAUDE_CONFIG_DIR: "/p/claude", CODEX_HOME: "/p/codex", EMPTY: "", NUM: 5 });
    assert.deepStrictEqual(penv.profileEnv(), { CLAUDE_CONFIG_DIR: "/p/claude", CODEX_HOME: "/p/codex" });
    assert.strictEqual(penv.withProfileEnv({ CLAUDE_CONFIG_DIR: "/mine" }).CLAUDE_CONFIG_DIR, "/p/claude");   // (the profile wins)
    assert.strictEqual(penv.claudeConfigDir("/h", { CLAUDE_CONFIG_DIR: "/mine" }), "/p/claude");
    penv.profileEnv().CODEX_HOME = "changed";   // (a copy: nobody changes it from outside)
    assert.strictEqual(penv.profileEnv().CODEX_HOME, "/p/codex");
    penv.setProfileEnv({});
  });

  // ---------- shared or own data ----------
  await check("main profile: today's keys and folders", () => {
    scope.configure({ storage: tmp, profile: { id: "default", share: true } });
    assert.strictEqual(scope.key("kural.usage.v1", "account"), "kural.usage.v1");
    assert.strictEqual(scope.key("kural.chat.v4", "data"), "kural.chat.v4");
    assert.strictEqual(scope.dir("chats", "data"), path.join(tmp, "chats"));
    assert.strictEqual(scope.dir("cli-chats", "account"), path.join(tmp, "cli-chats"));
  });
  await check("profile that shares: chats, tabs and Tab's memory are the main profile's; logins and usage are its own", () => {
    scope.configure({ storage: tmp, profile: { id: "work-1", share: true } });
    assert.strictEqual(scope.key("kural.chat.v4", "data"), "kural.chat.v4");
    assert.strictEqual(scope.key("kural.activity.v1", "data"), "kural.activity.v1");
    assert.strictEqual(scope.dir("chats", "data"), path.join(tmp, "chats"));
    assert.strictEqual(scope.key("kural.setup.v2", "account"), "kural.setup.v2@work-1");
    assert.strictEqual(scope.key("kural.usage.v1", "account"), "kural.usage.v1@work-1");
    assert.strictEqual(scope.dir("cli-chats", "account"), path.join(tmp, "profiles", "work-1", "cli-chats"));
  });
  await check("profile that keeps its data apart: everything is its own", () => {
    scope.configure({ storage: tmp, profile: { id: "work-1", share: false } });
    assert.strictEqual(scope.key("kural.chat.v4", "data"), "kural.chat.v4@work-1");
    assert.strictEqual(scope.key("kural.router.memory.v1", "data"), "kural.router.memory.v1@work-1");
    assert.strictEqual(scope.dir("chats", "data"), path.join(tmp, "profiles", "work-1", "chats"));
    assert.strictEqual(scope.dir("checkpoints", "data"), path.join(tmp, "profiles", "work-1", "checkpoints"));
    assert.strictEqual(scope.profileId(), "work-1");
    assert.strictEqual(scope.dir("handoffs", "data", "/elsewhere"), path.join("/elsewhere", "profiles", "work-1", "handoffs"));   // (a caller that knows its own storage folder)
  });
  await check("a profile's folder: only inside <storage>/profiles, only for a safe id; deleting it leaves the rest", () => {
    assert.strictEqual(scope.profileDir(tmp, "default"), null);
    assert.strictEqual(scope.profileDir(tmp, "../x"), null);
    assert.strictEqual(scope.profileDir(tmp, ""), null);
    fs.mkdirSync(path.join(tmp, "profiles", "work-1", "claude"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "profiles", "other-2"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "chats"), { recursive: true });
    assert.strictEqual(scope.removeProfileDir(tmp, "default"), false);
    assert.strictEqual(scope.removeProfileDir(tmp, "../chats"), false);
    assert.ok(fs.existsSync(path.join(tmp, "chats")));
    assert.strictEqual(scope.removeProfileDir(tmp, "work-1"), true);
    assert.ok(!fs.existsSync(path.join(tmp, "profiles", "work-1")));
    assert.ok(fs.existsSync(path.join(tmp, "profiles", "other-2")));
  });

  // ---------- the programs get the profile's folders ----------
  await check("cleanEnv() carries the profile's variables (and beats the ones you set); the main profile changes nothing", () => {
    process.env.CLAUDE_CONFIG_DIR = "/yours";
    penv.setProfileEnv({});
    assert.strictEqual(claude.cleanEnv({}).CLAUDE_CONFIG_DIR, "/yours");
    penv.setProfileEnv({ CLAUDE_CONFIG_DIR: "/p/claude", CODEX_HOME: "/p/codex" });
    const e = claude.cleanEnv({ MAX_THINKING_TOKENS: "0" });
    assert.strictEqual(e.CLAUDE_CONFIG_DIR, "/p/claude"); assert.strictEqual(e.CODEX_HOME, "/p/codex"); assert.strictEqual(e.MAX_THINKING_TOKENS, "0");
    assert.strictEqual(e.DISABLE_AUTOUPDATER, "1");
    delete process.env.CLAUDE_CONFIG_DIR; penv.setProfileEnv({});
  });

  const fakeClaude = path.join(__dirname, "fake-claude.js"), fakeCodex = path.join(__dirname, "fake-codex.js");
  fs.chmodSync(fakeClaude, 0o755); fs.chmodSync(fakeCodex, 0o755);
  const A = path.join(tmp, "profiles", "a"), B = path.join(tmp, "profiles", "b");
  for (const d of [A, B]) for (const p of ["claude", "codex"]) fs.mkdirSync(path.join(d, p), { recursive: true });
  const as = (dir) => penv.setProfileEnv(penv.envFor(dir));

  await check("two profiles, two Claude logins: logging B out leaves A logged in (the checks use cleanEnv)", async () => {
    fs.writeFileSync(path.join(A, "claude", "fake-claude-state"), "ok");
    fs.writeFileSync(path.join(B, "claude", "fake-claude-state"), "loggedout");
    as(A); assert.strictEqual((await checks.claudeAuth(fakeClaude, claude.cleanEnv({}))).loggedIn, true);
    as(B); assert.strictEqual((await checks.claudeAuth(fakeClaude, claude.cleanEnv({}))).loggedIn, false);
    // a login in B (what Get started's terminal does with the same variables) does not touch A
    as(B); fs.writeFileSync(path.join(B, "claude", "fake-claude-state"), "ok");
    await checks.claudeLogout(fakeClaude, claude.cleanEnv({}));
    assert.strictEqual((await checks.claudeAuth(fakeClaude, claude.cleanEnv({}))).loggedIn, false);
    as(A); assert.strictEqual((await checks.claudeAuth(fakeClaude, claude.cleanEnv({}))).loggedIn, true);
  });
  await check("a Claude process started in a profile runs with that profile's folder", async () => {
    const probe = path.join(tmp, "probe-claude");
    fs.writeFileSync(probe, `#!${process.execPath}\nrequire("fs").writeFileSync(process.env.PROBE_OUT, process.env.CLAUDE_CONFIG_DIR || "(none)");\nconsole.log("2.1.300 (Claude Code)");\n`, { mode: 0o755 });
    const out = path.join(tmp, "probe-out");
    as(B);
    await checks.claudeVersion(probe, claude.cleanEnv({ PROBE_OUT: out }));
    assert.strictEqual(fs.readFileSync(out, "utf8"), path.join(B, "claude"));
    penv.setProfileEnv({});
    await checks.claudeVersion(probe, claude.cleanEnv({ PROBE_OUT: out }));
    assert.strictEqual(fs.readFileSync(out, "utf8"), "(none)");
  });
  await check("two profiles, two Codex logins (codex.js merges the profile into both the one-off calls and the app server)", async () => {
    fs.writeFileSync(path.join(A, "codex", "fake-codex-state"), "ok");
    fs.writeFileSync(path.join(B, "codex", "fake-codex-state"), "loggedout");
    as(A); assert.strictEqual((await codex.codexAuth(fakeCodex)).loggedIn, true);   // (app-server: AppServer spawn)
    as(B); assert.strictEqual((await codex.codexAuth(fakeCodex)).loggedIn, false);
    const probe = path.join(tmp, "probe-codex");
    const out = path.join(tmp, "probe-codex-out");
    fs.writeFileSync(probe, `#!${process.execPath}\nrequire("fs").writeFileSync(process.env.PROBE_OUT, process.env.CODEX_HOME || "(none)");\nconsole.log("codex-cli 0.160.0");\n`, { mode: 0o755 });
    process.env.PROBE_OUT = out;
    as(B); await codex.codexVersion(probe);   // (execFile: run())
    assert.strictEqual(fs.readFileSync(out, "utf8"), path.join(B, "codex"));
    delete process.env.PROBE_OUT; penv.setProfileEnv({});
  });
  await check("the name on the account is read from the profile's own Claude folder", () => {
    fs.writeFileSync(path.join(B, "claude", ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "work@example.com", displayName: "Work Me" } }));
    const home = path.join(tmp, "emptyhome"); fs.mkdirSync(home, { recursive: true });
    assert.strictEqual(accountName("claude", "work@example.com", { home }), "");
    as(B);
    assert.strictEqual(accountName("claude", "work@example.com", { home }), "Work Me");
    penv.setProfileEnv({});
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
