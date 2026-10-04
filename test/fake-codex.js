#!/usr/bin/env node
// A stand-in for the `codex` program (OpenAI Codex CLI), for testing Kural's Codex provider (extension/lib/ai/codex.js)
// without an OpenAI account or the internet. It speaks the part of `codex app-server` Kural uses: JSON-RPC, one JSON
// object per line, no "jsonrpc" field (like codex-cli 0.160.0).
// Its state comes from $FAKE_CODEX_STATE, or else from the file $FAKE_CODEX_FILE (default <tmp>/kural-fake-codex-state):
//   ok         logged in with ChatGPT (Plus), answers
//   loggedout  account/read says no account; limits need a login
// `logout` switches the state file to "loggedout"; `login` waits 1 s, then switches it to "ok".
// Threads it started are remembered in $FAKE_CODEX_FILE + ".threads" (so thread/resume can find them).
// What a turn does depends on your message:
//   "hello"         reasoning (streamed summary), then text in pieces, plus a rate-limit update
//   "run tests"     asks to run `npm test`; accepted → output, declined → a declined command
//   "edit notes"    changes notes.txt (update) and new.txt (add) in the thread's folder, after asking
//   "ask me"        asks a question (Red / Blue), then says what you picked
//   "slow"          writes slowly until interrupted
//   "fail"          an error (usage limit), then a failed turn
//   "instructions"  says the developer instructions it got
//   anything else   "You said: …" (and how many pictures came with it)
// Use it in Kural: the Codex path setting pointing at this file.
const fs = require("fs"), os = require("os"), path = require("path");
const file = process.env.FAKE_CODEX_FILE || path.join(os.tmpdir(), "kural-fake-codex-state");
const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
const state = () => process.env.FAKE_CODEX_STATE || read(file) || "ok";
const args = process.argv.slice(2);

if (args[0] === "--version") { console.log("codex-cli 0.160.0"); process.exit(0); }
if (args[0] === "login" && args[1] === "status") {
  if (state() === "loggedout") { console.error("Not logged in"); process.exit(1); }
  console.error("Logged in using ChatGPT"); process.exit(0);
}
if (args[0] === "logout") { fs.writeFileSync(file, "loggedout"); console.error("Successfully logged out"); process.exit(0); }
if (args[0] === "login") { console.log("Opening your browser…  (fake: logged in after 1 s)"); setTimeout(() => { fs.writeFileSync(file, "ok"); process.exit(0); }, 1000); return; }
if (args[0] !== "app-server") { console.log("fake codex: nothing to do for", args.join(" ")); process.exit(0); }

// ---------- app-server ----------
const threadsFile = file + ".threads";
const threads = (() => { try { return JSON.parse(read(threadsFile) || "{}"); } catch { return {}; } })();
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const note = (method, params) => out({ method, params });
let initialized = false, nextId = 1000, turnN = 0;
const waiting = new Map();      // our request id → resolve
const turns = new Map();        // turn id → { interrupted }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (method, params) => new Promise((resolve) => { const id = ++nextId; waiting.set(id, resolve); out({ id, method, params }); });
const now = () => Math.floor(Date.now() / 1000);
const limits = () => ({ limitId: "codex", limitName: null, primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: now() + 3600 },
  secondary: { usedPercent: 12.5, windowDurationMins: 10080, resetsAt: now() + 86400 }, credits: null, planType: "plus" });

let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.method === undefined && waiting.has(m.id)) { const r = waiting.get(m.id); waiting.delete(m.id); r(m.result || m.error); continue; }
    handle(m);
  }
});
process.stdin.on("end", () => process.exit(0));

function handle(m) {
  const reply = (result) => out({ id: m.id, result });
  const fail = (message) => out({ id: m.id, error: { code: -32600, message } });
  if (m.method === "initialized") { initialized = true; return; }
  if (m.method === "initialize") return reply({ userAgent: "kural/0.160.0 (fake)", codexHome: path.join(os.tmpdir(), "fake-codex-home"), platformFamily: "unix", platformOs: "linux" });
  if (!initialized) return fail("Not initialized");
  const p = m.params || {};
  switch (m.method) {
    case "account/read":
      return reply(state() === "loggedout" ? { account: null, requiresOpenaiAuth: true } : { account: { type: "chatgpt", email: "tester@example.com", planType: "plus" }, requiresOpenaiAuth: true });
    case "account/rateLimits/read":
      if (state() === "loggedout") return fail("codex account authentication required to read rate limits");
      return reply({ ordinaryUsageAllowed: true, rateLimits: limits(), rateLimitsByLimitId: null });
    case "model/list":
      return reply({ nextCursor: null, data: [
        { id: "gpt-fake", model: "gpt-fake", displayName: "GPT-Fake", description: "Everyday work.", hidden: false, isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "max", description: "" }] },
        { id: "gpt-fake-mini", model: "gpt-fake-mini", displayName: "GPT-Fake Mini", description: "Fast.", hidden: false, isDefault: false, supportedReasoningEfforts: [] },
        { id: "gpt-hidden", model: "gpt-hidden", displayName: "Hidden", description: "", hidden: true, isDefault: false, supportedReasoningEfforts: [] }] });
    case "thread/start": case "thread/resume": {
      if (m.method === "thread/resume" && !threads[p.threadId]) return fail(`no rollout found for thread id ${p.threadId}`);
      const id = m.method === "thread/resume" ? p.threadId : `thr_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      threads[id] = { cwd: p.cwd || process.cwd(), instructions: p.developerInstructions || "", approvalPolicy: p.approvalPolicy, sandbox: p.sandbox, resumed: m.method === "thread/resume" };
      if (!p.ephemeral) fs.writeFileSync(threadsFile, JSON.stringify(threads));
      return reply({ thread: { id, turns: [] }, model: p.model || "gpt-fake", cwd: threads[id].cwd, approvalPolicy: p.approvalPolicy, sandbox: {} });
    }
    case "turn/start": {
      const th = threads[p.threadId];
      if (!th) return fail(`thread not found: ${p.threadId}`);
      const id = `turn_${++turnN}`;
      turns.set(id, { interrupted: false });
      reply({ turn: { id, items: [], status: "inProgress", error: null } });
      run(p.threadId, id, th, p).catch((e) => process.stderr.write(e.stack));
      return;
    }
    case "turn/interrupt": { const t = turns.get(p.turnId); if (t) t.interrupted = true; return reply({}); }
    case "account/logout": fs.writeFileSync(file, "loggedout"); return reply({});
    default: return fail(`unknown method ${m.method}`);
  }
}

async function run(threadId, turnId, th, p) {
  const ids = { threadId, turnId };
  const started = (item) => note("item/started", { item, ...ids, startedAtMs: Date.now() });
  const completed = (item) => note("item/completed", { item, ...ids, completedAtMs: Date.now() });
  const end = (status, error = null) => note("turn/completed", { threadId, turn: { id: turnId, items: [], status, error, durationMs: 5 } });
  const say = async (text, pieces = [text]) => {
    const item = { type: "agentMessage", id: `msg_${turnId}_${Math.random().toString(36).slice(2, 6)}`, text: "", phase: null };
    started(item);
    for (const d of pieces) { note("item/agentMessage/delta", { ...ids, itemId: item.id, delta: d }); await sleep(5); }
    completed({ ...item, text });
  };
  const input = p.input || [];
  const text = input.filter((x) => x.type === "text").map((x) => x.text).join("\n");
  const pics = input.filter((x) => x.type === "localImage" && fs.existsSync(x.path)).length;
  await sleep(10);

  if (/^hello/i.test(text)) {
    const r = { type: "reasoning", id: `rs_${turnId}`, summary: [], content: [] };
    started(r);
    note("item/reasoning/summaryTextDelta", { ...ids, itemId: r.id, delta: "Thinking about ", summaryIndex: 0 });
    note("item/reasoning/summaryTextDelta", { ...ids, itemId: r.id, delta: "a greeting.", summaryIndex: 0 });
    completed({ ...r, summary: ["Thinking about a greeting."] });
    await say("Hello from Codex.", ["Hello ", "from Codex."]);
    note("account/rateLimits/updated", { rateLimits: { limitId: "codex", primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: now() + 1800 }, secondary: null, planType: null } });
    return end("completed");
  }
  if (/run tests/i.test(text)) {
    const item = { type: "commandExecution", id: `cmd_${turnId}`, command: "/bin/bash -lc 'npm test'", cwd: th.cwd, status: "inProgress",
      commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: null, exitCode: null };
    started(item);
    const ans = await ask("item/commandExecution/requestApproval", { kind: "command", ...ids, itemId: item.id, startedAtMs: Date.now(), command: item.command, cwd: th.cwd, reason: "Run the tests" });
    if (ans && ans.decision === "accept") {
      completed({ ...item, status: "completed", aggregatedOutput: "all 3 tests pass\n", exitCode: 0 });
      await say("Tests pass.");
    } else {
      completed({ ...item, status: "declined" });
      await say("Okay, I won't run them.");
    }
    return end("completed");
  }
  if (/edit notes/i.test(text)) {
    const notes = path.join(th.cwd, "notes.txt"), fresh = path.join(th.cwd, "new.txt");
    const changes = [{ path: notes, kind: { type: "update", move_path: null }, diff: "@@ -1,2 +1,3 @@\n one\n+two\n three\n" },
      { path: fresh, kind: { type: "add" }, diff: "fresh file\n" }];
    const item = { type: "fileChange", id: `fc_${turnId}`, changes, status: "inProgress" };
    started(item);
    const ans = await ask("item/fileChange/requestApproval", { ...ids, itemId: item.id, startedAtMs: Date.now(), reason: null });
    if (ans && ans.decision === "accept") {
      fs.writeFileSync(notes, fs.readFileSync(notes, "utf8").replace("one\n", "one\ntwo\n"));
      fs.writeFileSync(fresh, "fresh file\n");
      completed({ ...item, status: "completed" });
      await say("Done.");
    } else {
      completed({ ...item, status: "declined" });
      await say("Left the files alone.");
    }
    return end("completed");
  }
  if (/ask me/i.test(text)) {
    const ans = await ask("item/tool/requestUserInput", { ...ids, itemId: `ask_${turnId}`, isBlocking: true, autoResolutionMs: null, questions: [
      { id: "color", header: "Color", question: "Which color?", isOther: false, isSecret: false, options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }] }] });
    const picked = ans && ans.answers && ans.answers.color ? ans.answers.color.answers.join(", ") : "nothing";
    await say(`You picked ${picked}.`);
    return end("completed");
  }
  if (/slow/i.test(text)) {
    const item = { type: "agentMessage", id: `msg_${turnId}`, text: "" };
    started(item);
    for (let n = 0; n < 200; n++) {
      if (turns.get(turnId).interrupted) return end("interrupted");
      note("item/agentMessage/delta", { ...ids, itemId: item.id, delta: "." });
      await sleep(50);
    }
    return end("completed");
  }
  if (/fail/i.test(text)) {
    const error = { message: "You've hit your usage limit. Try again at 5:00 PM.", codexErrorInfo: "usageLimitExceeded", additionalDetails: null };
    note("error", { error: { ...error, message: "Reconnecting... 1/5" }, willRetry: true, ...ids });
    note("error", { error, willRetry: false, ...ids });
    return end("failed", error);
  }
  if (/instructions/i.test(text)) { await say(`Instructions: ${th.instructions || "(none)"}${th.resumed ? " (resumed)" : ""}`); return end("completed"); }
  await say(`You said: ${text}${pics ? ` (${pics} picture${pics > 1 ? "s" : ""})` : ""}`);
  return end("completed");
}
