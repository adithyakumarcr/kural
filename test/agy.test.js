// Antigravity (extension/lib/ai/agy.js) against the stand-in test/fake-agy.js: the chat's events, modes, Undo copies,
// commands it isn't allowed to run, Stop, continuing a conversation, logged out.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");

if (process.platform === "win32") { console.log("agy: skipped on Windows (the stand-in is a script)"); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kural-agy-test-"));
process.env.FAKE_AGY_FILE = path.join(tmp, "state");
process.env.FAKE_AGY_LOG = path.join(tmp, "args.log");
fs.writeFileSync(process.env.FAKE_AGY_FILE, "ok");
const BIN = path.join(__dirname, "fake-agy.js");
fs.chmodSync(BIN, 0o755);
const agy = require("../extension/lib/ai/agy");
const usage = require("../extension/lib/ai/usage");
const store = path.join(tmp, "store");
const project = path.join(tmp, "project");
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, "notes.txt"), "one\n");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.stack.split("\n").slice(0, 2).join(" ")); } };
const lastArgs = () => { const l = fs.readFileSync(process.env.FAKE_AGY_LOG, "utf8").trim().split("\n"); return JSON.parse(l[l.length - 1]); };

// A chat with agy: send messages, collect what the chat would get.
function chat(opts = {}) {
  const events = [], perms = [], waiters = [];
  let exit = null;
  const a = new agy.AgyAgent({ bin: BIN, cwd: project, store, appendSystemPrompt: "Be brief.", mode: "agent", ...opts }, {
    onMessage: (m) => { events.push(m); if (m.type === "result") { const w = waiters.shift(); if (w) w(m); } },
    onPermission: async (req) => { perms.push(req); return { allow: true }; },
    onExit: (info) => { exit = info; for (const w of waiters.splice(0)) w({ type: "exit", ...info }); },
  });
  return {
    a, events, perms, exit: () => exit,
    ask: (text) => new Promise((res) => { waiters.push(res); a.send(text); }),
    text: () => events.filter((m) => m.type === "stream_event" && m.event.delta && m.event.delta.type === "text_delta").map((m) => m.event.delta.text).join(""),
    tools: () => events.filter((m) => m.type === "assistant").flatMap((m) => m.message.content).filter((c) => c.type === "tool_use"),
  };
}

(async () => {
  await check("version, models, login check, limits", async () => {
    assert.strictEqual(await agy.agyVersion(BIN), "1.2.7");
    // One entry per model; its thinking levels go to the intensity.
    const models = await agy.agyModels(BIN);
    assert.deepStrictEqual(models.map((m) => [m.id, m.label]), [["gemini-3.8-flash", "Gemini 3.8 Flash"], ["gemini-3.8-pro", "Gemini 3.8 Pro"], ["claude-sonnet-5", "Claude Sonnet 5"]]);
    assert.deepStrictEqual(Object.keys(models[0].efforts), ["low", "medium", "high"]);
    assert.ok(!models[2].efforts);
    assert.deepStrictEqual(agy.groupModels(models), models);   // (grouping twice changes nothing)
    const a = await agy.agyAuth(BIN);
    assert.strictEqual(a.loggedIn, true); assert.strictEqual(a.email, "tester@example.com");
    const l = await agy.agyLimits(BIN);
    assert.strictEqual(l.windows[0].label, "Gemini"); assert.strictEqual(l.windows[0].usedPercent, 13);
    assert.strictEqual(usage.current("agy").windows.length, 2);
  });

  let first;
  await check("a message streams back as Claude-style events; instructions go before the first message only", async () => {
    const c = first = chat();
    assert.ok(c.a.start());
    const r = await c.ask("hello there");
    assert.strictEqual(r.is_error, false); assert.match(r.result, /You said: hello there/); assert.match(c.text(), /You said: hello there/);
    assert.ok(c.events.some((m) => m.type === "system" && m.subtype === "init"));
    const r2 = await c.ask("again");
    assert.match(r2.result, /You said: again/);
    const args = lastArgs();
    assert.deepStrictEqual(args.slice(args.indexOf("--add-dir"), args.indexOf("--add-dir") + 2), ["--add-dir", project]);
    assert.ok(args.includes("--disable-slash-commands"));
  });

  await check("Agent mode: edits happen (the chat keeps a copy first, for Undo); commands don't, and the answer says so", async () => {
    const c = first;
    assert.deepStrictEqual([lastArgs().includes("--mode"), lastArgs()[lastArgs().indexOf("--mode") + 1]], [true, "accept-edits"]);
    const r = await c.ask("edit notes");
    assert.match(fs.readFileSync(path.join(project, "notes.txt"), "utf8"), /two/);
    assert.deepStrictEqual(c.perms.map((p) => [p.tool_name, p.input.file_path]), [["Edit", path.join(project, "notes.txt")]]);
    assert.strictEqual(c.tools().find((t) => t.name === "Edit").input.file_path, path.join(project, "notes.txt"));
    assert.match(r.result, /added a line/);
    const r2 = await c.ask("run tests");
    assert.match(r2.result, /didn't run: `npm test`/); assert.match(r2.result, /Switch to Auto/);
  });

  await check("Stop ends the answer at once; the next message continues the same conversation", async () => {
    const c = first;
    const before = await c.ask("who");
    const conv = /conversation (\S+)/.exec(before.result)[1];
    const p = c.ask("slow please");
    await new Promise((r) => setTimeout(r, 300));
    c.a.interrupt();
    const r = await p;
    assert.strictEqual(r.result, "Stopped.");
    const after = await c.ask("who");
    assert.strictEqual(/conversation (\S+)/.exec(after.result)[1], conv);
    assert.ok(lastArgs().includes("--conversation"));
    c.a.kill();
  });

  await check("Auto mode runs commands; a reopened chat continues its conversation without repeating the instructions", async () => {
    const sid = first.a.sessionId;
    const c = chat({ mode: "auto", resume: sid });
    c.a.start();
    const r = await c.ask("run tests");
    assert.match(r.result, /tests pass/);
    assert.ok(lastArgs().includes("--dangerously-skip-permissions"));
    assert.ok(lastArgs().includes("--conversation"));
    assert.strictEqual(c.a.primed, true);
    c.a.kill();
  });

  await check("a conversation agy doesn't know any more: a new one, and the instructions are sent again", async () => {
    const all = JSON.parse(fs.readFileSync(path.join(store, "agy-sessions.json"), "utf8"));
    all["gone"] = { agy: "00000000-dead-beef-0000-000000000000", at: Date.now() };
    fs.writeFileSync(path.join(store, "agy-sessions.json"), JSON.stringify(all));
    const c = chat({ resume: "gone", mode: "plan" });
    c.a.start();
    await c.ask("hi");
    assert.strictEqual(lastArgs()[lastArgs().indexOf("--mode") + 1], "plan");
    assert.notStrictEqual(c.a.conv, "00000000-dead-beef-0000-000000000000");
    c.a.kill();
  });

  await check("one-shot answers (Ask, commit messages) and Get started's test", async () => {
    assert.match(await agy.askAgy(BIN, { prompt: "name this commit", cwd: project }), /You said: name this commit/);
    const t = await agy.agyTest(BIN, { cwd: project });
    assert.strictEqual(t.ok, true);
  });

  await check("logged out: the chat and the test say to log in", async () => {
    fs.writeFileSync(process.env.FAKE_AGY_FILE, "loggedout");
    assert.strictEqual((await agy.agyAuth(BIN)).loggedIn, false);
    const c = chat();
    c.a.start();
    const r = await c.ask("hello");
    assert.strictEqual(r.is_error, true); assert.strictEqual(r.result, agy.NOT_LOGGED_IN);
    await new Promise((res) => setTimeout(res, 50));
    assert.strictEqual(c.exit().login, true);
    const t = await agy.agyTest(BIN, { cwd: project });
    assert.strictEqual(t.ok, false); assert.strictEqual(t.login, true);
    fs.writeFileSync(process.env.FAKE_AGY_FILE, "ok");
  });

  await check("the intensity picks Gemini's thinking level", async () => {
    const models = await agy.agyModels(BIN);
    const v = (id, e) => agy.variantFor(models, id, e);
    assert.strictEqual(v("gemini-3.8-flash", "low"), "gemini-3.8-flash-low");
    assert.strictEqual(v("gemini-3.8-flash", "medium"), "gemini-3.8-flash-medium");
    assert.strictEqual(v("gemini-3.8-flash", "max"), "gemini-3.8-flash-high");      // (no Max: the highest there is)
    assert.strictEqual(v("gemini-3.8-pro", "low"), "gemini-3.8-pro-high");          // (only High)
    assert.strictEqual(v("claude-sonnet-5", "high"), "claude-sonnet-5");            // (no levels)
    assert.strictEqual(v("gemini-3.8-flash-high", "low"), "gemini-3.8-flash-high"); // (an exact id stays)
    // Listed plain and with a level: the plain one is Medium, so it stays reachable.
    const both = agy.groupModels([{ id: "g-pro", label: "G Pro" }, { id: "g-pro-high", label: "G Pro (High)" }]);
    assert.deepStrictEqual(both.map((m) => [m.id, m.efforts]), [["g-pro", { high: "g-pro-high", medium: "g-pro" }]]);
    assert.strictEqual(agy.variantFor(both, "g-pro", "medium"), "g-pro");
    const c = chat({ model: "gemini-3.8-flash", models, effort: "low" });
    c.a.start();
    assert.match((await c.ask("hi")).result, /You said: hi/);
    assert.strictEqual(lastArgs()[lastArgs().indexOf("--model") + 1], "gemini-3.8-flash-low");
    c.a.kill();
  });

  await check("a message sent while agy restarts (new model) is answered; one that can't start fails once, not forever", async () => {
    const c = chat();
    c.a.start();
    const p = c.ask("first");
    c.a.setModel("gemini-3.8-pro-high");   // before "init": a restart with the message still waiting
    const r = await p;
    assert.match(r.result, /You said: first/);
    assert.strictEqual(lastArgs()[lastArgs().indexOf("--model") + 1], "gemini-3.8-pro-high");
    // Now agy can't start any more (logged out): the next message gets the reason, and agy isn't started again and again.
    c.a.setModel("gemini-3.8-flash-high");
    fs.writeFileSync(process.env.FAKE_AGY_FILE, "loggedout");
    const before = fs.readFileSync(process.env.FAKE_AGY_LOG, "utf8").split("\n").length;
    const r2 = await c.ask("second");
    assert.strictEqual(r2.is_error, true);
    await new Promise((res) => setTimeout(res, 300));
    assert.ok(fs.readFileSync(process.env.FAKE_AGY_LOG, "utf8").split("\n").length - before <= 2, "started once");
    fs.writeFileSync(process.env.FAKE_AGY_FILE, "ok");
    c.a.kill();
  });

  await check("a message waiting behind a stopped answer still runs", async () => {
    const c = chat();
    c.a.start();
    const p1 = c.ask("slow one");
    const p2 = c.ask("queued one");
    await new Promise((res) => setTimeout(res, 300));
    c.a.interrupt();
    assert.strictEqual((await p1).result, "Stopped.");
    assert.match((await p2).result, /You said: queued one/);
    c.a.kill();
  });

  await check("switching mode sends that mode's instructions again", async () => {
    const c = chat({ mode: "ask" });
    c.a.start();
    await c.ask("hi");
    const sid = c.a.sessionId;
    c.a.kill();
    const d = chat({ mode: "agent", resume: sid });
    assert.strictEqual(d.a.primed, false);
    d.a.start();
    await d.ask("hi again");
    d.a.kill();
    const e = chat({ mode: "agent", resume: sid });
    assert.strictEqual(e.a.primed, true);
  });

  await check("login screen: Kural finds the Google address and the code question, and types the code in", async () => {
    if (!fs.existsSync("/usr/bin/script") && !fs.existsSync("/bin/script")) return;   // (no `script` here)
    fs.writeFileSync(process.env.FAKE_AGY_FILE, "loggedout");
    const seen = { urls: [], codes: 0, screen: "" };
    await new Promise((done) => {
      const pty = agy.loginPty(BIN, { cols: 60, rows: 20,
        onData: (d) => { seen.screen += d; if (/Signed in/.test(seen.screen)) { pty.kill(); done(); } },
        onUrl: (u) => seen.urls.push(u),
        onCode: () => { seen.codes++; pty.answerCode(seen.codes === 1 ? "wrong" : "4/kural-test"); },
        onExit: done });
      setTimeout(() => { pty.kill(); done(); }, 15000);
    });
    // The address is longer than the 60-column screen: found whole anyway.
    assert.strictEqual(seen.urls.length, 1); assert.match(seen.urls[0], /^https:\/\/accounts\.google\.com\/.*state=xyz$/);
    assert.strictEqual(seen.codes, 2, "asked again after a wrong code");
    assert.strictEqual(fs.readFileSync(process.env.FAKE_AGY_FILE, "utf8"), "ok");
    assert.strictEqual(agy._test.asksForCode("\x1b[1mEnter the authorization code:\x1b[0m "), true);
    assert.strictEqual(agy._test.asksForCode("Signed in as you@example.com"), false);
  });

  await check("real agy's logged-out message means \"not logged in\" (Log in, not a failed test)", async () => {
    assert.strictEqual(agy._test.friendly("error: authentication failed or timed out"), agy.NOT_LOGGED_IN);
  });

  await check("agy's tool names and parameters → the chat's tools", async () => {
    const d = agy._test.describe;
    assert.deepStrictEqual(d("view_file", { AbsolutePath: "/a/b.py" }, "/x"), { name: "Read", input: { file_path: "/a/b.py" } });
    assert.deepStrictEqual(d("write_to_file", { TargetFile: "c.txt" }, "/x"), { name: "Write", input: { file_path: "/x/c.txt" } });
    assert.strictEqual(d("multi_replace_file_content", { TargetFile: "/a" }, "/x").name, "Edit");
    assert.deepStrictEqual(d("run_command", { CommandLine: "ls -la", Cwd: "/x" }, "/x").input.command, "ls -la");
    assert.strictEqual(d("search_web", { query: "kural" }, "/x").name, "WebSearch");
    assert.strictEqual(d("call_mcp_tool", { ServerName: "s" }, "/x").name, "mcp__agy__call_mcp_tool");
    assert.deepStrictEqual(agy._test.parseUsage("Gemini Models\tWeekly Limit Remaining\t40%").map((w) => w.usedPercent), [60]);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `agy: ${fail} FAILED` : "agy: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
