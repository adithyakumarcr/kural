// Debug Mode: the log endpoint (lib/debug/server.js), the mode's permissions (the same as Agent's), the mapping to Agent
// for every program, and the prompts. No vscode needed except a stand-in for lib/ai/index.js; nothing leaves this computer.
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), Module = require("module");
let failed = 0;
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kural-debug-test-")));
async function check(name, fn) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, e.stack); } }

// Plain http (fetch would add its own headers and hide what the server does).
function request(url, { method = "POST", body = "", headers = {}, host } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers: { ...(host ? { Host: host } : {}), ...headers } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const lines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

(async () => {
  const { DebugLogs, MAX_BODY, MAX_FILE } = require("../extension/lib/debug/server");
  const logs = new DebugLogs({ dir: () => fs.mkdirSync(path.join(tmp, "logs"), { recursive: true }) || path.join(tmp, "logs") });

  await check("a session has an address on 127.0.0.1, a token in the path and a private file", async () => {
    const s = await logs.session("chat-a");
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/log$/);
    assert.ok(s.url.includes(s.token));
    if (process.platform !== "win32") assert.strictEqual(fs.statSync(s.file).mode & 0o777, 0o600);   // (Windows has no Unix modes)
    assert.strictEqual((await logs.session("chat-a")).url, s.url, "the same chat keeps its address");
    assert.strictEqual(logs.server.address().address, "127.0.0.1");
  });

  await check("a POST with the right token is appended as one NDJSON line with a time", async () => {
    const s = await logs.session("chat-a");
    const r = await request(s.url, { body: JSON.stringify({ where: "a()", value: 3 }), headers: { "Content-Type": "application/json" } });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    const r2 = await request(s.url, { body: "plain text, not JSON", headers: { "Content-Type": "text/plain" } });
    assert.strictEqual(r2.status, 204);
    const got = lines(s.file);
    assert.strictEqual(got.length, 2);
    assert.deepStrictEqual(Object.keys(got[0]), ["t", "where", "value"]);
    assert.ok(!isNaN(Date.parse(got[0].t)));
    assert.strictEqual(got[1].message, "plain text, not JSON");
  });

  await check("a wrong token, a wrong path and a wrong Host get 404 or 403 and write nothing", async () => {
    const s = await logs.session("chat-a");
    const before = fs.readFileSync(s.file, "utf8");
    assert.strictEqual((await request(s.url.replace(s.token, "0".repeat(64)), { body: "{}" })).status, 404);
    assert.strictEqual((await request(s.url.replace(s.token, "short"), { body: "{}" })).status, 404);
    assert.strictEqual((await request(s.url.replace(/\/log$/, "/other"), { body: "{}" })).status, 404);
    assert.strictEqual((await request(s.url.replace(/\/[0-9a-f]{64}\/log$/, "/"), { body: "{}" })).status, 404);
    assert.strictEqual((await request(s.url, { body: "{}", host: "evil.example" })).status, 403);
    assert.strictEqual((await request(s.url, { method: "GET" })).status, 405);
    assert.strictEqual(fs.readFileSync(s.file, "utf8"), before);
  });

  await check("the CORS preflight is answered, for POST only", async () => {
    const s = await logs.session("chat-a");
    const r = await request(s.url, { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers["access-control-allow-origin"], "*");
    assert.match(r.headers["access-control-allow-methods"], /POST/);
    assert.ok(!/GET|PUT|DELETE/.test(r.headers["access-control-allow-methods"]));
    assert.match(r.headers["access-control-allow-headers"], /Content-Type/i);
    // (a preflight without the right token learns nothing)
    assert.strictEqual((await request(s.url.replace(s.token, "1".repeat(64)), { method: "OPTIONS" })).status, 404);
  });

  await check("a body over 16 KB is refused and not written; one at the limit is kept", async () => {
    const s = await logs.session("chat-a");
    const before = lines(s.file).length;
    const big = await request(s.url, { body: JSON.stringify({ v: "x".repeat(MAX_BODY + 10) }) });
    assert.strictEqual(big.status, 413);
    assert.strictEqual(lines(s.file).length, before);
    const ok = await request(s.url, { body: JSON.stringify({ v: "y".repeat(MAX_BODY - 100) }) });
    assert.strictEqual(ok.status, 204);
    assert.strictEqual(lines(s.file).length, before + 1);
    assert.strictEqual((await request(s.url, { body: "" })).status, 400);
  });

  await check("the file stays under 5 MB: the oldest half goes, the newest stays", async () => {
    const s = await logs.session("chat-cap");
    logs.clear("chat-cap");
    const pad = "z".repeat(8000);
    const n = Math.ceil(MAX_FILE / 8000) + 40;
    for (let i = 0; i < n; i++) assert.strictEqual((await request(s.url, { body: JSON.stringify({ i, pad }) })).status, 204);
    const size = fs.statSync(s.file).size;
    assert.ok(size <= MAX_FILE, `size ${size}`);
    const got = lines(s.file);   // (every line is still whole JSON)
    assert.strictEqual(got[got.length - 1].i, n - 1, "the newest line is there");
    assert.ok(got[0].i > 0, "the oldest ones are gone");
  });

  await check("clear empties the file; two chats have separate files and tokens", async () => {
    const a = await logs.session("chat-a"), b = await logs.session("chat-b");
    assert.notStrictEqual(a.file, b.file);
    assert.notStrictEqual(a.token, b.token);
    logs.clear("chat-a"); logs.clear("chat-b");
    await request(a.url, { body: JSON.stringify({ from: "a" }) });
    await request(b.url, { body: JSON.stringify({ from: "b" }) });
    assert.deepStrictEqual(lines(a.file).map((x) => x.from), ["a"]);
    assert.deepStrictEqual(lines(b.file).map((x) => x.from), ["b"]);
    logs.clear("chat-a");
    assert.strictEqual(fs.readFileSync(a.file, "utf8"), "");
    assert.strictEqual(lines(b.file).length, 1);
    assert.strictEqual(a.url.split("/").slice(0, 3).join("/"), b.url.split("/").slice(0, 3).join("/"), "one server for both");
  });

  await check("end() stops one chat's address and removes its file; a bad chat id is refused", async () => {
    const b = await logs.session("chat-b");
    logs.end("chat-b");
    assert.ok(!fs.existsSync(b.file));
    assert.strictEqual((await request(b.url, { body: "{}" })).status, 404);
    const a = await logs.session("chat-a");
    assert.strictEqual((await request(a.url, { body: "{}" })).status, 204, "another chat is unaffected");
    await assert.rejects(() => logs.session("../etc"), /bad chat id/);
  });

  await check("stop() closes the server and removes every file", async () => {
    const a = await logs.session("chat-a");
    logs.stop();
    assert.ok(!fs.existsSync(a.file));
    await assert.rejects(() => request(a.url, { body: "{}" }), /ECONNREFUSED|ECONNRESET|socket hang up/);   // (which one depends on the system and the timing)
    const again = await logs.session("chat-c");   // (it starts again when needed)
    assert.strictEqual((await request(again.url, { body: "{}" })).status, 204);
    logs.stop();
  });

  // ---- permissions: Debug decides like Agent ----
  const { decide, gatedMode } = require("../extension/lib/chat/permission-policy");
  const project = path.join(tmp, "project"), outside = path.join(tmp, "elsewhere");
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(outside, { recursive: true });
  await check("decide() gives the same answers for debug as for agent", () => {
    const base = { cwd: project, writeRoots: [project], readRoots: [project], privateFolders: false };
    const calls = [
      { tool: "Bash", input: { command: "npm test" } },
      { tool: "Bash", input: { command: "rm -rf /" } },
      { tool: "Edit", input: { file_path: path.join(project, "a.js") } },
      { tool: "Write", input: { file_path: path.join(outside, "b.js") } },
      { tool: "Read", input: { file_path: path.join(outside, "b.js") } },
      { tool: "WebFetch", input: { url: "https://example.com" } },
      { tool: "AskUserQuestion", input: {} },
      { tool: "mcp__github__create_issue", input: {} },
    ];
    for (const c of calls) {
      for (const extra of [{}, { allowAll: ["command"] }, { unclassified: true }]) {
        assert.deepStrictEqual(decide({ ...base, ...c, ...extra, mode: "debug" }), decide({ ...base, ...c, ...extra, mode: "agent" }), `${c.tool} ${JSON.stringify(extra)}`);
      }
    }
    assert.ok(decide({ ...base, tool: "Bash", input: { command: "npm test" }, mode: "debug" }).ask, "a command asks");
    assert.ok(decide({ ...base, tool: "Edit", input: { file_path: path.join(project, "a.js") }, mode: "debug" }).allow, "an edit inside the project runs");
    assert.ok(decide({ ...base, tool: "Write", input: { file_path: path.join(outside, "b.js") }, mode: "debug" }).ask, "a file outside asks");
  });
  await check("gatedMode treats debug and agent as one level, and keeps the stricter rules", () => {
    assert.strictEqual(gatedMode("debug", "agent"), "agent");
    assert.strictEqual(gatedMode("debug", "debug"), "agent", "(decided as Agent)");
    assert.strictEqual(gatedMode("agent", "debug"), "agent");
    assert.strictEqual(gatedMode("debug", "plan"), "plan");
    assert.strictEqual(gatedMode("plan", "debug"), null);
    assert.strictEqual(gatedMode("debug", "auto"), null);
    assert.strictEqual(gatedMode("auto", "debug"), "agent");
  });
  await check("the Model Router treats Debug like Agent (an editing request needs a model that runs commands)", () => {
    const { select } = require("../extension/lib/router/policy");
    assert.strictEqual(typeof select, "function");
    const src = fs.readFileSync(path.join(__dirname, "..", "extension", "lib", "router", "policy.js"), "utf8");
    assert.match(src, /request\.mode === "agent" \|\| request\.mode === "debug"/);
  });

  // ---- makeAgent: every program gets Agent ----
  const v = { workspace: { isTrusted: true, workspaceFolders: [], textDocuments: [], getConfiguration: () => ({ get: (_, d) => d, inspect: () => undefined }) },
    window: { showWarningMessage: () => {} }, env: { appRoot: "/unused" }, Uri: { file: (f) => ({ fsPath: f }) }, EventEmitter: class {} };
  const load = Module._load; Module._load = function (n, ...a) { return n === "vscode" ? v : load.call(this, n, ...a); };
  const brain = require("../extension/lib/ai");
  await check("makeAgent hands Agent to every provider when the chat is in Debug, and leaves other modes alone", () => {
    const seen = [];
    const saved = brain.PROVIDERS.map((p) => p.agent);
    brain.PROVIDERS.forEach((p) => { p.agent = (_m, opts) => { seen.push([p.id, opts.mode]); return { mode: opts.mode, stub: true }; }; });
    try {
      for (const model of ["sonnet", "codex:default", "agy:default", "ollama:qwen3"]) {
        seen.length = 0;
        const a = brain.makeAgent(model, { mode: "debug", cwd: tmp }, {}, {});
        assert.strictEqual(seen.length, 1, model);
        assert.strictEqual(seen[0][1], "agent", `${model} (${seen[0][0]})`);
        assert.strictEqual(a.mode, "agent");
        brain.makeAgent(model, { mode: "auto" }, {}, {});
        assert.strictEqual(seen[1][1], "auto");
      }
      const opts = { mode: "debug", cwd: tmp };
      brain.makeAgent("sonnet", opts, {}, {});
      assert.strictEqual(opts.mode, "debug", "the caller's options aren't changed");
      // parallel agents: the lead and every agent get Agent too
      seen.length = 0;
      const split = brain.makeAgent("sonnet", { mode: "debug", cwd: tmp, split: { workers: "haiku", models: [], history: () => "", instructions: "", dir: tmp } }, {}, {});
      assert.strictEqual(split.mode, "agent");
      if (typeof split.kill === "function") split.kill();
    } finally { brain.PROVIDERS.forEach((p, i) => { p.agent = saved[i]; }); }
  });
  Module._load = load;

  // ---- the chat page and the chat's lists ----
  await check("Debug is in the mode list right after Agent, and the page knows it", () => {
    const chatSrc = fs.readFileSync(path.join(__dirname, "..", "extension", "lib", "chat", "index.js"), "utf8");
    const m = /const MODES = \[([\s\S]*?)\];/.exec(chatSrc)[1];
    const ids = [...m.matchAll(/id: "(\w+)"/g)].map((x) => x[1]);
    assert.deepStrictEqual(ids, ["agent", "debug", "auto", "plan", "ask"]);
    assert.match(m, /id: "debug", label: "Debug", hint: "finds the cause with logs"/);
    assert.match(chatSrc, /const agentLike = \(m\) => m === "agent" \|\| m === "debug"/);
    assert.ok(!/(tab|reply|t)\.mode === "agent" \|\| (tab|reply|t)\.mode === "auto"/.test(chatSrc.replace(/agentLike\(\w+\.mode\) \|\| \w+\.mode === "auto"/g, "")), "every editing check counts Debug");
    const media = (f) => fs.readFileSync(path.join(__dirname, "..", "extension", "media", f), "utf8");
    assert.match(media("chat.js"), /t\.mode === "agent" \|\| t\.mode === "debug"/);
    assert.match(media("split.js"), /t\.mode === "agent" \|\| t\.mode === "debug"/);
    const css = media("chat.css");
    assert.match(css, /\.mode-tag\.debug \{/);
    assert.match(css, /body\.vscode-light \.mode-tag\.debug/);
  });

  // ---- the prompts ----
  await check("PROMPTS.debug and debugNote carry the marker, the steps and the address", () => {
    const { PROMPTS, debugNote, lessonPrompt } = require("../extension/lib/chat/prompts");
    assert.ok(PROMPTS.debug.startsWith(PROMPTS.agent.slice(0, 80)), "it is the agent's text first");
    assert.match(PROMPTS.debug, /kural-debug/);
    for (const w of ["hypotheses", "AskUserQuestion", "I reproduced it", "It didn't happen", "log file", "Remove every line marked"]) assert.ok(PROMPTS.debug.includes(w), w);
    assert.strictEqual(PROMPTS.debug.split("When a decision is really the user's").length, 2, "the shared format text is there once");
    const url = "http://127.0.0.1:4321/" + "ab".repeat(32) + "/log", file = path.join(tmp, "x.ndjson");
    const note = debugNote(url, file);
    assert.match(note, /^<kural_debug>/);
    assert.match(note, /<\/kural_debug>\n\n$/);
    assert.ok(note.includes(url) && note.includes(file));
    assert.match(note, /kural-debug/);
    for (const w of ["fetch(", "urllib", "curl"]) assert.ok(note.includes(w), w);
    assert.ok(!/\p{Extended_Pictographic}/u.test(PROMPTS.debug + note), "no emoji");
    assert.ok(!/lesson pages need Agent or Auto/.test(lessonPrompt("/x", "debug")), "lesson pages work in Debug like in Agent");
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : "\nAll debug-mode checks passed.");
  process.exit(failed ? 1 : 0);
})();
