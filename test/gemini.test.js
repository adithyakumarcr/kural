// Kural's Gemini provider (extension/lib/ai/gemini.js) against a stand-in Gemini CLI (test/fake-gemini.js):
// no Google login, no internet.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");

if (process.platform === "win32") { console.log("gemini: skipped on Windows"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-gemini-"));
const home = path.join(tmp, "home");            // Gemini CLI's home for these tests (GEMINI_CLI_HOME)
const proj = path.join(tmp, "proj");
fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
fs.mkdirSync(proj);
const LOG = path.join(tmp, "log.jsonl");
const FAKE = path.join(__dirname, "fake-gemini.js");
fs.chmodSync(FAKE, 0o755);
// Everything the helpers and the fake read comes from here, never from your real ~/.gemini.
for (const k of Object.keys(process.env)) if (/^(GEMINI|GOOGLE)_/.test(k)) delete process.env[k];
Object.assign(process.env, { GEMINI_CLI_HOME: home, FAKE_GEMINI_LOG: LOG, FAKE_GEMINI_SESSIONS: path.join(tmp, "sessions.json"), FAKE_GEMINI_FILE: path.join(tmp, "state") });
const KEY = { GEMINI_API_KEY: "test-key" };

const g = require("../extension/lib/ai/gemini");
const usage = require("../extension/lib/ai/usage");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack || e.message); } };
const logged = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sent = (method) => logged().filter((m) => m.method === method);

// One message → all events until the result (and the agent, still running, for more).
function ask(opts, text, onPermission, during) {
  return new Promise((resolve, reject) => {
    const events = [];
    let exit = null;
    const a = new g.GeminiAgent({ name: "test", bin: FAKE, cwd: proj, env: KEY, mode: "agent", ...opts }, {
      onMessage: (m) => { events.push(m); if (m.type === "result") resolve({ events, result: m, agent: a, exit: () => exit }); },
      onPermission: onPermission || (async () => ({ allow: true })),
      onExit: (info) => { exit = info; },
    });
    if (!a.start()) { reject(new Error("didn't start")); return; }
    a.send(text);
    if (during) during(a);
    setTimeout(() => reject(new Error("no result in 15 s")), 15000).unref();
  });
}
const deltas = (ev, type) => ev.filter((m) => m.type === "stream_event" && m.event.delta && m.event.delta.type === type).map((m) => m.event.delta[type === "text_delta" ? "text" : "thinking"]).join("");
const uses = (ev) => ev.filter((m) => m.type === "assistant").flatMap((m) => m.message.content);
const results = (ev) => ev.filter((m) => m.type === "user").flatMap((m) => m.message.content);
const lastPrompt = () => { const p = sent("session/prompt"); return p[p.length - 1].params.prompt.map((b) => b.text || "").join(""); };
const chosen = () => logged().filter((m) => !m.method && m.result && m.result.outcome).map((m) => m.result.outcome.optionId || m.result.outcome.outcome);

(async () => {
  await check("init first, then thinking and text stream in, then the result", async () => {
    const { events, result, agent } = await ask({ appendSystemPrompt: "Be brief." }, "hello there");
    assert.strictEqual(events[0].type, "system"); assert.strictEqual(events[0].subtype, "init");
    assert.strictEqual(events[0].model, "auto"); assert.strictEqual(events[0].session_id, agent.sessionId);
    assert.match(deltas(events, "thinking_delta"), /\*\*Reading the question\*\*[\s\S]*\n\n\*\*Answering\*\*/);
    assert.strictEqual(deltas(events, "text_delta"), "Hello from Gemini. You said: hello there");   // ([MODE_UPDATE] left out)
    const starts = events.filter((m) => m.type === "stream_event" && m.event.type === "content_block_start").map((m) => m.event.content_block.type);
    assert.deepStrictEqual(starts, ["thinking", "text"]);
    assert.strictEqual(events.filter((m) => m.type === "stream_event" && m.event.type === "content_block_stop").length, 2);
    assert.strictEqual(result.subtype, "success"); assert.strictEqual(result.is_error, false);
    assert.strictEqual(result.result, "Hello from Gemini. You said: hello there");
    assert.ok(result.duration_ms >= 0);
    // Kural's instructions go before the first message only.
    assert.match(lastPrompt(), /<kural_instructions>\nBe brief\.\n<\/kural_instructions>/);
    await new Promise((resolve) => { agent.h.onMessage = (m) => { if (m.type === "result") resolve(); }; agent.send("again"); });
    assert.doesNotMatch(lastPrompt(), /kural_instructions/);
    agent.kill();
  });

  await check("modes: Agent asks Gemini for its asking mode; Plan for its read-only one", async () => {
    fs.writeFileSync(LOG, "");
    const a = await ask({ mode: "auto" }, "hi"); a.agent.kill();
    assert.ok(!sent("session/set_mode").length);   // (already "default")
    const b = await ask({ mode: "plan", model: "gemini-2.5-pro" }, "hi"); b.agent.kill();
    assert.strictEqual(b.events[0].model, "gemini-2.5-pro");
    assert.deepStrictEqual(sent("session/set_model").map((m) => m.params.modelId), ["gemini-2.5-pro"]);
  });

  await check("tokens go to the usage hub", async () => {
    usage._reset();
    const { agent } = await ask({}, "hello");
    agent.kill();
    const u = usage.current("gemini");
    assert.strictEqual(u.tokens.input, 100); assert.strictEqual(u.tokens.output, 20);
  });

  await check("a command: Kural is asked (Bash), allowed once, the output comes back", async () => {
    fs.writeFileSync(LOG, "");
    let asked = null;
    const { events, result, agent } = await ask({}, "run a command", async (req) => { asked = req; return { allow: true }; });
    agent.kill();
    assert.strictEqual(asked.tool_name, "Bash");
    assert.deepStrictEqual(asked.input, { command: "echo hi", description: "Say hi" });
    const use = uses(events)[0];
    assert.strictEqual(use.name, "Bash"); assert.strictEqual(use.input.command, "echo hi");
    assert.deepStrictEqual(results(events)[0], { type: "tool_result", tool_use_id: use.id, content: "hi", is_error: false });
    assert.deepStrictEqual(chosen(), ["proceed_once"]);   // never "always"
    assert.strictEqual(result.result, "Ran it.");
  });

  await check("a command declined: rejected once, the tool fails", async () => {
    fs.writeFileSync(LOG, "");
    const { events, result, agent } = await ask({}, "run a command", async () => ({ allow: false, message: "No." }));
    agent.kill();
    assert.deepStrictEqual(chosen(), ["cancel"]);
    assert.strictEqual(results(events)[0].is_error, true);
    assert.match(result.result, /won't/);
  });

  await check("an edit: Kural is asked (Edit, absolute path) before the file changes, then it changes", async () => {
    const file = path.join(proj, "notes.txt");
    fs.writeFileSync(file, "one\nthree\n");
    let seen = null;
    const { events, agent } = await ask({}, "edit notes", async (req) => { seen = { ...req, content: fs.readFileSync(file, "utf8") }; return { allow: true }; });
    agent.kill();
    assert.strictEqual(seen.tool_name, "Edit");
    assert.strictEqual(seen.input.file_path, file);
    assert.strictEqual(seen.content, "one\nthree\n");            // asked before the write: Undo keeps the old file
    assert.strictEqual(fs.readFileSync(file, "utf8"), "one\ntwo\nthree\n");
    const use = uses(events)[0];
    assert.strictEqual(use.name, "Edit");
    assert.deepStrictEqual(use.input, { file_path: file, old_string: "", new_string: "two" });
  });

  await check("a new file: asked as Write", async () => {
    let seen = null;
    const { events, agent } = await ask({}, "create hello", async (req) => { seen = req; return { allow: true }; });
    agent.kill();
    assert.strictEqual(seen.tool_name, "Write");
    assert.strictEqual(uses(events)[0].name, "Write");
    assert.strictEqual(fs.readFileSync(path.join(proj, "hello.txt"), "utf8"), "hello\n");
  });

  await check("Plan mode: edits are refused without asking", async () => {
    const file = path.join(proj, "notes.txt");
    fs.writeFileSync(file, "one\nthree\n");
    let asked = false;
    const { agent } = await ask({ mode: "plan" }, "edit notes", async () => { asked = true; return { allow: true }; });
    agent.kill();
    assert.strictEqual(asked, false);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "one\nthree\n");
  });

  await check("Stop: Gemini is told to cancel, the answer ends as stopped", async () => {
    fs.writeFileSync(LOG, "");
    const { result, agent } = await ask({}, "slow please", null, (a) => setTimeout(() => a.interrupt(), 800));
    agent.kill();
    assert.strictEqual(result.subtype, "error_during_execution");
    assert.ok(sent("session/cancel").length === 1 && sent("session/cancel")[0].id === undefined);   // a notification
  });

  await check("Gemini's errors in plain words (429)", async () => {
    const { result, agent } = await ask({}, "rate limit");
    agent.kill();
    assert.ok(result.is_error); assert.match(result.result, /usage limit/);
  });

  await check("not logged in: an error result, and the process stops with login: true", async () => {
    const { result, exit } = await ask({ env: { FAKE_GEMINI_STATE: "loggedout" } }, "hello");
    assert.ok(result.is_error); assert.strictEqual(result.result, g.NOT_LOGGED_IN);
    assert.match(result.result, /not logged in/i);   // (the chat's login check matches this)
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(exit().login, true);
  });

  await check("Google login chosen but none saved: refused before starting (no browser opens)", async () => {
    fs.writeFileSync(LOG, "");
    fs.writeFileSync(path.join(home, ".gemini", "settings.json"), JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }));
    try {
      const { result, exit } = await ask({ env: {} }, "hello");
      assert.strictEqual(result.result, g.NOT_LOGGED_IN);
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(exit().login, true);
      assert.strictEqual(logged().length, 0);   // gemini never started
    } finally { fs.rmSync(path.join(home, ".gemini", "settings.json")); }
  });

  await check("resume: Kural's id maps to Gemini's; reopened without replaying old history", async () => {
    const store = path.join(tmp, "store");
    const first = await ask({ store, sessionId: "kural-1", appendSystemPrompt: "Rules." }, "hello");
    first.agent.kill();
    const gid = JSON.parse(fs.readFileSync(path.join(store, "gemini-sessions.json"), "utf8"))["kural-1"].gemini;
    assert.ok(gid);
    fs.writeFileSync(LOG, "");
    const again = await ask({ store, resume: "kural-1", appendSystemPrompt: "Rules." }, "hello again");
    again.agent.kill();
    assert.strictEqual(sent("session/load")[0].params.sessionId, gid);
    assert.strictEqual(sent("authenticate")[0].params.methodId, "gemini-api-key");   // (load needs a login way named)
    assert.doesNotMatch(deltas(again.events, "text_delta"), /OLD HISTORY/);
    assert.doesNotMatch(lastPrompt(), /kural_instructions/);   // already in that conversation
    assert.strictEqual(again.result.session_id, "kural-1");
  });

  await check("resume of a conversation Gemini doesn't have: a new one, with Kural's instructions", async () => {
    const store = path.join(tmp, "store2");
    fs.mkdirSync(store);
    fs.writeFileSync(path.join(store, "gemini-sessions.json"), JSON.stringify({ "kural-2": { gemini: "gone-id" } }));
    fs.writeFileSync(LOG, "");
    const { result, agent } = await ask({ store, resume: "kural-2", appendSystemPrompt: "Rules." }, "hi");
    agent.kill();
    assert.strictEqual(result.is_error, false);
    assert.strictEqual(sent("session/new").length, 1);
    assert.match(lastPrompt(), /kural_instructions/);
  });

  await check("request(mcp_status) and control()", async () => {
    const a = new g.GeminiAgent({ bin: FAKE }, {});
    assert.deepStrictEqual(await a.request({ subtype: "mcp_status" }), { mcpServers: [] });
    assert.deepStrictEqual(await a.request({ subtype: "other" }), {});
    assert.strictEqual(a.control(), null);
    assert.strictEqual(new g.GeminiAgent({ bin: path.join(tmp, "nope") }, {}).start(), false);
  });

  // ---- helpers ----
  await check("geminiAuth: Google account, API key, Vertex, none; geminiLogout", async () => {
    const dir = path.join(home, ".gemini");
    assert.deepStrictEqual(await g.geminiAuth(FAKE), { loggedIn: false, method: null, email: null, type: null });
    fs.writeFileSync(path.join(dir, "settings.json"), '{\n  // chosen in Gemini CLI\n  "security": { "auth": { "selectedType": "oauth-personal" } }\n}');
    fs.writeFileSync(path.join(dir, "oauth_creds.json"), "{}");
    fs.writeFileSync(path.join(dir, "google_accounts.json"), JSON.stringify({ active: "me@example.com", old: [] }));
    assert.deepStrictEqual(await g.geminiAuth(FAKE), { loggedIn: true, method: "Google account", email: "me@example.com", type: "oauth-personal" });
    // (settings with a comment aren't rewritten; the login itself is gone)
    await g.geminiLogout();
    assert.ok(!fs.existsSync(path.join(dir, "oauth_creds.json")));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "google_accounts.json"), "utf8")), { active: null, old: ["me@example.com"] });
    assert.strictEqual((await g.geminiAuth(FAKE)).loggedIn, false);
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } }, ui: { theme: "x" } }));
    await g.geminiLogout();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")), { security: { auth: {} }, ui: { theme: "x" } });
    assert.deepStrictEqual(await g.geminiAuth(FAKE, { ...process.env, GEMINI_API_KEY: "k" }), { loggedIn: true, method: "API key", email: null, type: "gemini-api-key" });
    assert.strictEqual((await g.geminiAuth(FAKE, { ...process.env, GOOGLE_GENAI_USE_VERTEXAI: "true" })).method, "Vertex AI");
    fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=abc\n");
    assert.strictEqual((await g.geminiAuth(FAKE)).method, "API key");
    fs.rmSync(path.join(dir, ".env")); fs.rmSync(path.join(dir, "settings.json"));
  });

  await check("geminiModels, geminiVersion, geminiTest, askGemini", async () => {
    process.env.GEMINI_API_KEY = "k";
    try {
      const models = await g.geminiModels(FAKE, { cwd: proj });
      assert.deepStrictEqual(models[0], { id: "auto", label: "Auto", description: "Let Gemini CLI decide", isDefault: true });
      assert.strictEqual(models.length, 3);
      assert.strictEqual(await g.geminiVersion(FAKE), "0.62.0");
      const t = await g.geminiTest(FAKE, { cwd: proj });
      assert.ok(t.ok); assert.match(t.answer, /Hello from Gemini/); assert.ok(t.ms >= 0);
      assert.strictEqual(await g.askGemini(FAKE, { system: "S", prompt: "hey", cwd: proj }), "Hello from Gemini. You said: hey");
      process.env.FAKE_GEMINI_STATE = "loggedout";
      const bad = await g.geminiTest(FAKE, { cwd: proj });
      assert.strictEqual(bad.ok, false); assert.strictEqual(bad.login, true);
      assert.deepStrictEqual(await g.geminiModels(FAKE, { cwd: proj }), []);
    } finally { delete process.env.GEMINI_API_KEY; delete process.env.FAKE_GEMINI_STATE; }
  });

  await check("findGemini, loginCommand", async () => {
    assert.strictEqual(await g.findGemini(FAKE), FAKE);
    assert.match(g.loginCommand(FAKE), /fake-gemini\.js$/);
    // npm's Windows wrapper → the script it runs
    const npmDir = path.join(tmp, "npm"), script = path.join(npmDir, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
    fs.mkdirSync(path.dirname(script), { recursive: true }); fs.writeFileSync(script, "");
    fs.writeFileSync(path.join(npmDir, "gemini.cmd"), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js" %*\r\n');
    assert.strictEqual(g._test.cmdTarget(path.join(npmDir, "gemini.cmd")), script);
  });

  await check("Gemini's tool titles → the chat's tool names", () => {
    const d = (kind, title, extra = {}) => g._test.describe({ kind, title, ...extra }, proj);
    assert.deepStrictEqual(d("search", "'speed' in *.js within ./"), { name: "Grep", input: { pattern: "speed", glob: "*.js" } });
    assert.deepStrictEqual(d("search", "'**/*.ts' within src"), { name: "Glob", input: { pattern: "**/*.ts", path: path.join(proj, "src") } });
    assert.deepStrictEqual(d("search", 'Searching the web for: "acp spec"'), { name: "WebSearch", input: { query: "acp spec" } });
    assert.deepStrictEqual(d("fetch", "Fetching content from: https://example.com/a"), { name: "WebFetch", input: { url: "https://example.com/a" } });
    assert.deepStrictEqual(d("read", "README.md", { locations: [{ path: "README.md" }] }), { name: "Read", input: { file_path: path.join(proj, "README.md") } });
    assert.deepStrictEqual(d("other", "get_issue(id: 7)"), { name: "mcp__gemini__get_issue", input: { args: "id: 7" } });
    assert.deepStrictEqual(g._test.changedPart("a\nb\nc", "a\nB\nc"), { old_string: "b", new_string: "B" });
  });

  console.log(fail ? `gemini: ${fail} FAILED` : "gemini: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
