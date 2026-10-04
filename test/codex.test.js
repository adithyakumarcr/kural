// Kural's Codex provider (extension/lib/ai/codex.js) against a stand-in Codex (test/fake-codex.js): no OpenAI account,
// no internet.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");

if (process.platform === "win32") { console.log("codex: skipped on Windows"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-codex-"));
process.env.FAKE_CODEX_FILE = path.join(tmp, "state");   // (before codex.js starts any fake: they inherit it)
delete process.env.FAKE_CODEX_STATE;
const codex = require("../extension/lib/ai/codex");
const usage = require("../extension/lib/ai/usage");
const BIN = path.join(__dirname, "fake-codex.js");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack); } };
const setState = (s) => fs.writeFileSync(process.env.FAKE_CODEX_FILE, s);
const proj = path.join(tmp, "proj");
fs.mkdirSync(proj);
const store = path.join(tmp, "store");

// One message → all events, until the result. Resolves { events, result, agent, asked }.
function ask(opts, content, onPermission, during) {
  return new Promise((resolve, reject) => {
    const events = [], asked = [];
    const timer = setTimeout(() => reject(new Error("no result within 10 s")), 10000);
    const a = new codex.CodexAgent({ name: "test", bin: BIN, cwd: proj, mode: "agent", store, ...opts }, {
      onMessage: (m) => { events.push(m); if (m.type === "result") { clearTimeout(timer); a.kill(); resolve({ events, result: m, agent: a, asked }); } },
      onPermission: async (req) => { asked.push({ req, files: snapshot() }); return onPermission ? onPermission(req) : { allow: true }; },
      onExit: () => {},
    });
    if (!a.start()) { reject(new Error("didn't start")); return; }
    a.send(content);
    if (during) during(a);
  });
}
const snapshot = () => Object.fromEntries(fs.readdirSync(proj).map((f) => [f, fs.readFileSync(path.join(proj, f), "utf8")]));
const deltas = (ev, type) => ev.filter((m) => m.type === "stream_event" && m.event.delta && m.event.delta.type === type).map((m) => m.event.delta.text || m.event.delta.thinking).join("");
const tools = (ev) => ev.filter((m) => m.type === "assistant").flatMap((m) => m.message.content);
const results = (ev) => ev.filter((m) => m.type === "user").flatMap((m) => m.message.content);

(async () => {
  setState("ok");

  await check("init event first, with Codex's model and Kural's session id", async () => {
    const { events } = await ask({ sessionId: "kural-1" }, "hi");
    assert.deepStrictEqual({ ...events[0] }, { session_id: "kural-1", type: "system", subtype: "init", model: "gpt-fake", tools: [], mcp_servers: [] });
  });

  await check("thinking and text stream in as blocks, then a success result", async () => {
    usage._reset(); codex._test.limits.primary = codex._test.limits.secondary = null;
    const { events, result } = await ask({}, "hello");
    assert.strictEqual(deltas(events, "thinking_delta"), "Thinking about a greeting.");
    assert.strictEqual(deltas(events, "text_delta"), "Hello from Codex.");
    const kinds = events.filter((m) => m.type === "stream_event").map((m) => m.event.type === "content_block_start" ? `start:${m.event.content_block.type}` : m.event.type === "content_block_stop" ? "stop" : "d");
    assert.deepStrictEqual(kinds.filter((k) => k !== "d"), ["start:thinking", "stop", "start:text", "stop"]);
    assert.deepStrictEqual({ subtype: result.subtype, is_error: result.is_error, result: result.result }, { subtype: "success", is_error: false, result: "Hello from Codex." });
    assert.ok(result.duration_ms >= 0);
  });

  await check("rate limits → usage.report (read at start, sparse update merged)", async () => {
    const u = usage.current("codex");
    assert.ok(u, "codex reported");
    assert.strictEqual(u.plan, "Plus");
    const w = Object.fromEntries(u.windows.map((x) => [x.label, x.usedPercent]));
    assert.deepStrictEqual(w, { "5-hour": 50, Week: 12.5 });   // primary updated to 50, the week kept from the read
    assert.ok(u.windows[0].resetsAt > Date.now() && u.windows[0].resetsAt < Date.now() + 2 * 86400000);
  });

  await check("Kural's instructions reach Codex as developer instructions", async () => {
    const { result } = await ask({ appendSystemPrompt: "Be brief." }, "instructions?");
    assert.strictEqual(result.result, "Instructions: Be brief.");
  });

  await check("resume: the same Kural id reopens the same Codex thread", async () => {
    await ask({ sessionId: "kural-r" }, "hi");
    const { result } = await ask({ resume: "kural-r", appendSystemPrompt: "Again." }, "instructions?");
    assert.strictEqual(result.result, "Instructions: Again. (resumed)");
    assert.ok(JSON.parse(fs.readFileSync(path.join(store, "codex-threads.json"), "utf8"))["kural-r"]);
  });

  await check("a command asks first (Bash); allowed → it runs, its output is the tool result", async () => {
    const { events, result, asked } = await ask({}, "run tests");
    assert.deepStrictEqual(asked.map((a) => a.req.tool_name), ["Bash"]);
    assert.strictEqual(asked[0].req.input.command, "npm test");
    const use = tools(events)[0];
    assert.deepStrictEqual([use.name, use.input.command], ["Bash", "npm test"]);
    const r = results(events)[0];
    assert.deepStrictEqual([r.tool_use_id, r.content, r.is_error], [use.id, "all 3 tests pass", false]);
    assert.strictEqual(result.result, "Tests pass.");
  });

  await check("a command declined → declined in Codex, an error tool result", async () => {
    const { events, result } = await ask({}, "run tests", async () => ({ allow: false, message: "Not now." }));
    const r = results(events)[0];
    assert.deepStrictEqual([r.content, r.is_error], ["Not now.", true]);
    assert.strictEqual(result.result, "Okay, I won't run them.");
  });

  await check("file changes: Kural is asked per file (Edit / Write) before anything is written", async () => {
    fs.writeFileSync(path.join(proj, "notes.txt"), "one\nthree\n");
    const { events, asked } = await ask({}, "edit notes");
    assert.deepStrictEqual(asked.map((a) => [a.req.tool_name, a.req.input.file_path]),
      [["Edit", path.join(proj, "notes.txt")], ["Write", path.join(proj, "new.txt")]]);
    for (const a of asked) { assert.strictEqual(a.files["notes.txt"], "one\nthree\n"); assert.ok(!("new.txt" in a.files)); }
    assert.strictEqual(fs.readFileSync(path.join(proj, "notes.txt"), "utf8"), "one\ntwo\nthree\n");
    const uses = tools(events);
    assert.deepStrictEqual(uses.map((u) => u.name), ["Edit", "Write"]);
    assert.deepStrictEqual([uses[0].input.old_string, uses[0].input.new_string], ["", "two"]);
    assert.deepStrictEqual(results(events).map((r) => r.tool_use_id), uses.map((u) => u.id));
  });

  await check("file changes declined → nothing written", async () => {
    fs.writeFileSync(path.join(proj, "notes.txt"), "one\nthree\n"); fs.rmSync(path.join(proj, "new.txt"), { force: true });
    const { result } = await ask({}, "edit notes", async (req) => ({ allow: false }));
    assert.strictEqual(fs.readFileSync(path.join(proj, "notes.txt"), "utf8"), "one\nthree\n");
    assert.ok(!fs.existsSync(path.join(proj, "new.txt")));
    assert.strictEqual(result.result, "Left the files alone.");
  });

  await check("Codex's question → AskUserQuestion card → the answer goes back", async () => {
    let q = null;
    const { result } = await ask({}, "ask me", async (req) => { q = req; return { allow: true, updatedInput: { ...req.input, answers: { "Which color?": "Blue" } } }; });
    assert.strictEqual(q.tool_name, "AskUserQuestion");
    assert.deepStrictEqual(q.input.questions[0], { question: "Which color?", header: "Color", multiSelect: false,
      options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }] });
    assert.strictEqual(result.result, "You picked Blue.");
  });

  await check("a picture goes along as a file", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const { result } = await ask({}, [{ type: "text", text: "look" }, { type: "image", source: { type: "base64", media_type: "image/png", data: png } }]);
    assert.strictEqual(result.result, "You said: look (1 picture)");
  });

  await check("Stop: a slow answer ends as stopped", async () => {
    const { result } = await ask({}, "slow please", null, (a) => setTimeout(() => a.interrupt(), 300));
    assert.deepStrictEqual([result.subtype, result.is_error, result.result], ["error_during_execution", true, "Stopped."]);
  });

  await check("an error from Codex: plain words", async () => {
    const { result } = await ask({}, "fail");
    assert.ok(result.is_error); assert.strictEqual(result.subtype, "error");
    assert.match(result.result, /used up your Codex limit/);
  });

  await check("not logged in: the turn ends with an error that says so", async () => {
    setState("loggedout");
    try {
      const { result } = await ask({}, "hi");
      assert.ok(result.is_error);
      assert.match(result.result, /not logged in/i);
      assert.match(result.result, /log ?in/i);   // (what the chat's LOGIN_RE looks for)
    } finally { setState("ok"); }
  });

  await check("helpers: version, auth, models, limits, logout, login command", async () => {
    assert.deepStrictEqual(await codex.codexVersion(BIN), { version: "0.160.0" });
    assert.deepStrictEqual(await codex.codexAuth(BIN), { loggedIn: true, method: "ChatGPT", email: "tester@example.com", plan: "Plus" });
    const models = await codex.codexModels(BIN);
    assert.deepStrictEqual(models.map((m) => [m.id, m.label, m.isDefault]), [["gpt-fake", "GPT-Fake", true], ["gpt-fake-mini", "GPT-Fake Mini", false]]);
    assert.deepStrictEqual(models[0].efforts, ["low", "max"]);
    const lim = await codex.codexRateLimits(BIN);
    assert.deepStrictEqual(lim.windows.map((w) => [w.label, w.usedPercent]), [["5-hour", 42], ["Week", 12.5]]);
    assert.deepStrictEqual(await codex.codexLogout(BIN), { ok: true });
    assert.deepStrictEqual(await codex.codexAuth(BIN), { loggedIn: false, method: "", email: "", plan: "" });
    assert.strictEqual(await codex.codexRateLimits(BIN), null);
    assert.match(codex.loginCommand(BIN), /fake-codex\.js'? login$/);
    setState("ok");
  });

  await check("helpers: test and one-shot answers", async () => {
    const t = await codex.codexTest(BIN, { cwd: proj });
    assert.strictEqual(t.ok, true); assert.match(t.answer, /Kural checking/); assert.ok(t.ms >= 0);
    assert.strictEqual(await codex.askCodex(BIN, { system: "Short.", prompt: "commit message please", cwd: proj }), "You said: commit message please");
    setState("loggedout");
    assert.deepStrictEqual(await codex.codexTest(BIN, { cwd: proj }), { ok: false, error: codex.NOT_LOGGED_IN, login: true });
    assert.strictEqual(await codex.askCodex(BIN, { prompt: "x", cwd: proj }), null);
    setState("ok");
    const ctl = new AbortController(); ctl.abort();
    assert.strictEqual(await codex.askCodex(BIN, { prompt: "x", signal: ctl.signal }), null);
  });

  await check("findCodex: a chosen path; a missing one", async () => {
    assert.strictEqual(await codex.findCodex(BIN), fs.realpathSync(BIN));
    assert.strictEqual(await codex.findCodex(path.join(tmp, "nope")), null);
  });

  await check("small parts: shell unwrapping, window labels, error words", async () => {
    const { unwrapShell, windowLabel, friendlyError } = codex._test;
    assert.strictEqual(unwrapShell("/bin/bash -lc 'git status'"), "git status");
    assert.strictEqual(unwrapShell("bash -lc 'echo '\\''hi'\\'''"), "echo 'hi'");
    assert.strictEqual(unwrapShell(["/bin/zsh", "-lc", "ls -la"]), "ls -la");
    assert.strictEqual(unwrapShell("ls"), "ls");
    assert.deepStrictEqual([300, 10080, 60, 1440, 45].map(windowLabel), ["5-hour", "Week", "1-hour", "1-day", "45-minute"]);
    assert.strictEqual(friendlyError({ message: "x", codexErrorInfo: "unauthorized" }), codex.NOT_LOGGED_IN);
    assert.match(friendlyError({ message: "boom", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } } }), /can't reach Codex/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `codex: ${fail} FAILED` : "codex: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
