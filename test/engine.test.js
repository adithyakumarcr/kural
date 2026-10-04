// Kural's own engine (extension/lib/ai/engine.js + tools.js) against a stand-in Ollama (test/fake-ollama-chat.js):
// no Claude, no internet.
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { LocalAgent } = require("../extension/lib/ai/engine");
const { Tools, globRegex } = require("../extension/lib/ai/tools");
const fake = require("./fake-ollama-chat");

let fail = 0;
const check = async (name, fn) => { try { await fn(); console.log("ok  ", name); } catch (e) { fail++; console.log("FAIL", name, e.message); } };
const PORT = 11463;
const proj = fs.mkdtempSync(path.join(os.tmpdir(), "kural-engine-"));
fs.writeFileSync(path.join(proj, "README.md"), "# My project\nmore\n");
fs.writeFileSync(path.join(proj, "notes.txt"), "one\nthree\n");
fs.mkdirSync(path.join(proj, "src")); fs.writeFileSync(path.join(proj, "src", "app.js"), "const speed = 1;\nfunction go() { return speed; }\n");
fs.mkdirSync(path.join(proj, "node_modules")); fs.writeFileSync(path.join(proj, "node_modules", "x.js"), "const speed = 2;\n");

// One message → all events, until the result.
function ask(opts, text, onPermission, during) {
  return new Promise((resolve) => {
    const events = [];
    const a = new LocalAgent({ model: "qwen3-coder:30b", baseUrl: `http://127.0.0.1:${PORT}`, cwd: proj, ...opts }, {
      onMessage: (m) => { events.push(m); if (m.type === "result") resolve({ events, result: m, agent: a }); },
      onPermission: onPermission || (async () => ({ allow: true })),
    });
    a.start(); a.send(text);
    if (during) during(a);
  });
}
const text = (ev) => ev.filter((m) => m.type === "stream_event" && m.event.delta && m.event.delta.type === "text_delta").map((m) => m.event.delta.text).join("");

(async () => {
  const f = fake.start(PORT);
  await new Promise((r) => setTimeout(r, 100));

  await check("an answer streams in, then the result", async () => {
    const { events, result } = await ask({}, "hello there");
    assert.strictEqual(events[0].type, "system");
    assert.match(text(events), /Hello from qwen3-coder:30b\. You said: hello there/);
    assert.strictEqual(result.is_error, false);
  });
  await check("tools: the model reads a file, Kural runs it, the model answers from it", async () => {
    const { events, result } = await ask({}, "read the readme");
    const use = events.find((m) => m.type === "assistant").message.content[0];
    assert.strictEqual(use.name, "Read"); assert.strictEqual(use.input.file_path, "README.md");
    assert.ok(events.some((m) => m.type === "user" && m.message.content[0].tool_use_id === use.id));
    assert.match(result.result, /first line is: # My project/);
  });
  await check("edits ask first; declined = nothing changes", async () => {
    let asked = null;
    const { result } = await ask({ allowedTools: ["Read", "Grep", "Glob"] }, "add a line to notes.txt", async (req) => { asked = req; return { allow: false, message: "No." }; });
    assert.strictEqual(asked.tool_name, "Edit");
    assert.strictEqual(fs.readFileSync(path.join(proj, "notes.txt"), "utf8"), "one\nthree\n");
    assert.match(result.result, /No\./);
  });
  await check("edits ask first; allowed = the file changes", async () => {
    await ask({ allowedTools: ["Read"] }, "add a line to notes.txt", async () => ({ allow: true }));
    assert.strictEqual(fs.readFileSync(path.join(proj, "notes.txt"), "utf8"), "one\ntwo\nthree\n");
  });
  await check("tools not offered (Ask mode) aren't run", async () => {
    fs.writeFileSync(path.join(proj, "notes.txt"), "one\nthree\n");
    await ask({ tools: ["Read", "Grep", "Glob"] }, "add a line to notes.txt");
    assert.strictEqual(fs.readFileSync(path.join(proj, "notes.txt"), "utf8"), "one\nthree\n");
  });
  await check("thinking shows as thinking", async () => {
    const { events } = await ask({ model: "qwen3:8b", capabilities: ["tools", "thinking"], effort: "medium" }, "think first");
    assert.ok(events.some((m) => m.type === "stream_event" && m.event.delta && m.event.delta.type === "thinking_delta"));
  });
  await check("Ask: the answer as JSON (structured_output)", async () => {
    const { result } = await ask({ jsonSchema: { type: "object" }, tools: ["Read"] }, "where is it?");
    assert.deepStrictEqual(result.structured_output.results[0], { file: "README.md", line: 1, why: "the first line" });
  });
  await check("Stop: a slow answer ends as stopped", async () => {
    const { result } = await ask({}, "slow please", null, (a) => setTimeout(() => a.interrupt(), 300));
    assert.strictEqual(result.subtype, "error_during_execution");
  });
  await check("a model Ollama doesn't have: says so plainly", async () => {
    const { result } = await ask({ model: "nope:1b" }, "hi");
    assert.ok(result.is_error); assert.match(result.result, /doesn't have nope:1b/);
  });
  await check("Ollama not running: says so plainly", async () => {
    const { result } = await ask({ baseUrl: "http://127.0.0.1:1" }, "hi");
    assert.ok(result.is_error); assert.match(result.result, /can't reach Ollama/);
  });
  await check("the conversation is saved and picked up again (resume)", async () => {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), "kural-store-"));
    const { agent } = await ask({ store, sessionId: "s1" }, "hello there");
    const b = new LocalAgent({ model: "qwen3-coder:30b", store, resume: "s1", cwd: proj }, {});
    b.start();
    assert.strictEqual(b.history.length, agent.history.length);
    assert.strictEqual(b.history[0].content, "hello there");
  });
  await check("long conversations are trimmed to the model's window", () => {
    const a = new LocalAgent({ model: "m", contextLength: 2000, cwd: proj }, {});
    for (let i = 0; i < 30; i++) a.history.push({ role: "user", content: `q${i} ${"x".repeat(300)}` }, { role: "assistant", content: "a" });
    a.trim();
    assert.ok(a.history.length < 60 && a.history[0].role === "user");
    assert.match(a.history[a.history.length - 2].content, /^q29/);
  });

  // ---- the tools themselves ----
  const t = new Tools(proj);
  await check("glob patterns", () => {
    assert.ok(globRegex("**/*.js").test("src/app.js") && globRegex("**/*.js").test("a.js"));
    assert.ok(globRegex("src/*.{js,ts}").test("src/a.ts") && !globRegex("src/*.js").test("src/x/a.js"));
  });
  await check("Glob finds files, skips node_modules", async () => {
    const r = (await t.run("Glob", { pattern: "**/*.js" })).output;
    assert.match(r, /src\/app\.js/); assert.doesNotMatch(r, /node_modules/);
  });
  await check("Grep finds lines with numbers", async () => {
    const r = (await t.run("Grep", { pattern: "speed", glob: "*.js" })).output;
    assert.match(r, /src\/app\.js:1: const speed = 1;/); assert.match(r, /src\/app\.js:2:/); assert.doesNotMatch(r, /node_modules/);
  });
  await check("Read: numbered lines, a part with offset", async () => {
    assert.match((await t.run("Read", { file_path: "src/app.js" })).output, /^\s+1\tconst speed = 1;/);
    assert.match((await t.run("Read", { file_path: "src/app.js", offset: 2 })).output, /^\s+2\tfunction go/);
  });
  await check("Edit: must match exactly once", async () => {
    fs.writeFileSync(path.join(proj, "d.txt"), "a\na\n");
    assert.match((await t.run("Edit", { file_path: "d.txt", old_string: "a", new_string: "b" })).error, /2 times/);
    assert.match((await t.run("Edit", { file_path: "d.txt", old_string: "zzz", new_string: "b" })).error, /isn't in d\.txt/);
    await t.run("Edit", { file_path: "d.txt", old_string: "a", new_string: "b", replace_all: true });
    assert.strictEqual(fs.readFileSync(path.join(proj, "d.txt"), "utf8"), "b\nb\n");
  });
  await check("Write creates folders", async () => {
    await t.run("Write", { file_path: "new/dir/x.txt", content: "hi" });
    assert.strictEqual(fs.readFileSync(path.join(proj, "new/dir/x.txt"), "utf8"), "hi");
  });
  await check("Bash: output and exit code", async () => {
    if (process.platform === "win32") return;
    const r = (await t.run("Bash", { command: "echo hello; exit 3" })).output;
    assert.match(r, /hello/); assert.match(r, /exit code 3/);
  });

  await check("Bash: a command that leaves something running in the background still returns", async () => {
    if (process.platform === "win32") return;
    const t0 = Date.now();
    const out = await new Tools(proj).run("Bash", { command: "sleep 30 & echo started" });
    assert.match(out.output, /started/);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });
  await check("Bash: the time limit stops what the command started too", async () => {
    if (process.platform === "win32") return;
    const t0 = Date.now();
    const out = await new Tools(proj).run("Bash", { command: "sleep 30 & sleep 30", timeout: 800 });
    assert.match(out.output || out.error, /stopped after/);
    assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  });
  await check("text split across network chunks stays whole (Tamil)", async () => {
    const http = require("http");
    const word = "வணக்கம் உலகம்";
    const line = Buffer.from(JSON.stringify({ message: { role: "assistant", content: word }, done: false }) + "\n" + JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
    const cut = line.indexOf(Buffer.from("வ")) + 1;   // in the middle of a letter
    const srv = http.createServer((q, res) => { q.resume(); q.on("end", () => { res.write(line.subarray(0, cut)); setTimeout(() => res.end(line.subarray(cut)), 30); }); }).listen(11464);
    await new Promise((r) => setTimeout(r, 50));
    const { events } = await ask({ baseUrl: "http://127.0.0.1:11464", tools: [] }, "hello");
    srv.close();
    assert.strictEqual(text(events), word);
  });
  await check("a failed message isn't kept (it would fail every time after)", async () => {
    const { agent } = await ask({ model: "not-there:1b" }, "hello");
    assert.strictEqual(agent.history.length, 0);
  });

  f.close();
  console.log(fail ? `engine: ${fail} FAILED` : "engine: ALL PASS");
  process.exit(fail ? 1 : 0);
})();
