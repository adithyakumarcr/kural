#!/usr/bin/env node
// A stand-in for the `gemini` program (Gemini CLI), for testing Kural's Gemini provider (extension/lib/ai/gemini.js)
// without a Google login. It speaks the part of the Agent Client Protocol (`gemini --acp`) Kural uses, with the
// same message shapes as Gemini CLI 0.62.
//
// State: $FAKE_GEMINI_STATE, or else the file $FAKE_GEMINI_FILE (default <tmp>/kural-fake-gemini-state):
//   ok         logged in (default)
//   loggedout  session/new and session/load fail the way Gemini CLI does without a login
// Every message it receives is added to $FAKE_GEMINI_LOG (one JSON per line), so a test can see what Kural sent.
// Conversations it knows (for session/load) are kept in $FAKE_GEMINI_SESSIONS (default <tmp>/kural-fake-gemini-sessions.json).
//
// What it answers depends on your message:
//   "run a command"  asks to run `echo hi`; allowed → output "hi"
//   "edit notes"     asks to add "two" to notes.txt in the folder; allowed → writes it
//   "create hello"   asks to create hello.txt; allowed → writes it
//   "slow"           writes a little, then waits until it's cancelled (session/cancel)
//   "rate limit"     fails with Gemini's 429 error
//   anything else    thinks twice, then "Hello from Gemini. You said: <your words>"
// Each answer reports 100 input and 20 output tokens.
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");

const stateFile = process.env.FAKE_GEMINI_FILE || path.join(os.tmpdir(), "kural-fake-gemini-state");
const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
const state = process.env.FAKE_GEMINI_STATE || read(stateFile) || "ok";
const sessionsFile = process.env.FAKE_GEMINI_SESSIONS || path.join(os.tmpdir(), "kural-fake-gemini-sessions.json");
const args = process.argv.slice(2);

if (args.includes("--version")) { console.log("0.62.0"); process.exit(0); }
if (!args.includes("--acp")) { console.log("fake gemini: only --acp and --version"); process.exit(0); }

const log = (m) => { if (process.env.FAKE_GEMINI_LOG) fs.appendFileSync(process.env.FAKE_GEMINI_LOG, JSON.stringify(m) + "\n"); };
const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const reply = (id, result) => out({ jsonrpc: "2.0", id, result });
const fail = (id, code, message, data) => out({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
const update = (sessionId, u) => out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });
const text = (sessionId, t) => update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ids = 1000;
const waiting = new Map();   // our requests (permission) → resolve
let cancelled = null;        // resolve of the slow answer
const ask = (params) => new Promise((r) => { const id = ++ids; waiting.set(id, r); out({ jsonrpc: "2.0", id, method: "session/request_permission", params }); });
const OPTIONS = [
  { optionId: "proceed_always", name: "Allow for this session", kind: "allow_always" },
  { optionId: "proceed_once", name: "Allow", kind: "allow_once" },
  { optionId: "cancel", name: "Reject", kind: "reject_once" },
];
const MODELS = { availableModels: [{ modelId: "auto", name: "Auto", description: "Let Gemini CLI decide" }, { modelId: "gemini-2.5-pro", name: "gemini-2.5-pro" }, { modelId: "gemini-2.5-flash", name: "gemini-2.5-flash" }], currentModelId: "auto" };
const MODES = { availableModes: [{ id: "default", name: "Default" }, { id: "autoEdit", name: "Auto Edit" }, { id: "yolo", name: "YOLO" }, { id: "plan", name: "Plan" }], currentModeId: args.includes("plan") ? "plan" : "default" };
const QUOTA = { quota: { token_count: { input_tokens: 100, output_tokens: 20 }, model_usage: [{ model: "gemini-2.5-flash", token_count: { input_tokens: 100, output_tokens: 20 } }] } };
const sessions = () => { try { return JSON.parse(fs.readFileSync(sessionsFile, "utf8")); } catch { return {}; } };
const cwds = new Map();

async function permissionTool(sid, call, okText, onAllow) {
  update(sid, { sessionUpdate: "tool_call", status: "pending", ...call });
  const ans = await ask({ sessionId: sid, options: OPTIONS, toolCall: { status: "pending", ...call } });
  const ok = ans.outcome && ans.outcome.outcome === "selected" && /^proceed/.test(ans.outcome.optionId);
  if (!ok) {
    update(sid, { sessionUpdate: "tool_call_update", toolCallId: call.toolCallId, status: "failed", content: [{ type: "content", content: { type: "text", text: `Tool "${call.toolCallId}" was canceled by the user.` } }], kind: call.kind });
    text(sid, "Okay, I won't do that.");
    return;
  }
  const content = onAllow();
  update(sid, { sessionUpdate: "tool_call_update", toolCallId: call.toolCallId, status: "completed", title: call.title, content, kind: call.kind });
  text(sid, okText);
}

async function prompt(m) {
  const { sessionId: sid, prompt: blocks } = m.params;
  const said = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  const cwd = cwds.get(sid) || process.cwd();
  if (/rate limit/.test(said)) return fail(m.id, 429, "Rate limit exceeded. Try again later.");
  if (/slow/.test(said)) {
    text(sid, "Thinking slowly");
    const how = await Promise.race([new Promise((r) => { cancelled = r; }), sleep(10000).then(() => "timeout")]);
    return reply(m.id, how === "timeout" ? { stopReason: "end_turn", _meta: QUOTA } : { stopReason: "cancelled" });
  }
  if (/run a command/.test(said)) {
    await permissionTool(sid, { toolCallId: "run_shell_command-1", title: "echo hi", kind: "execute", locations: [],
      content: [{ type: "content", content: { type: "text", text: `[current working directory ${cwd}] (Say hi)` } }] }, "Ran it.", () => [{ type: "content", content: { type: "text", text: "hi" } }]);
  } else if (/edit notes/.test(said)) {
    const file = path.join(cwd, "notes.txt");
    const oldText = fs.readFileSync(file, "utf8"), newText = oldText.replace("one\n", "one\ntwo\n");
    const diff = { type: "diff", path: file, oldText, newText, _meta: { kind: "modify" } };
    await permissionTool(sid, { toolCallId: "replace-1", title: "notes.txt: one => one two", kind: "edit", locations: [{ path: file }], content: [diff] },
      "Added a line.", () => { log({ wrote: file }); fs.writeFileSync(file, newText); return [diff]; });
  } else if (/create hello/.test(said)) {
    const file = path.join(cwd, "hello.txt");
    const diff = { type: "diff", path: file, oldText: "", newText: "hello\n", _meta: { kind: "add" } };
    await permissionTool(sid, { toolCallId: "write_file-1", title: "Writing to hello.txt", kind: "edit", locations: [{ path: file }], content: [diff] },
      "Created it.", () => { fs.writeFileSync(file, "hello\n"); return [diff]; });
  } else {
    update(sid, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "**Reading the question**\nThe user says hello." } });
    update(sid, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "**Answering**\nA short greeting." } });
    text(sid, "Hello from Gemini. ");
    text(sid, "[MODE_UPDATE] default");
    text(sid, `You said: ${said.replace(/<kural_instructions>[\s\S]*?<\/kural_instructions>\s*/, "")}`);
  }
  reply(m.id, { stopReason: "end_turn", _meta: QUOTA });
}

function handle(m) {
  log(m);
  if (!m.method) { const r = waiting.get(m.id); if (r) { waiting.delete(m.id); r(m.result || {}); } return; }
  const p = m.params || {};
  switch (m.method) {
    case "initialize":
      return reply(m.id, { protocolVersion: 1, authMethods: [{ id: "oauth-personal", name: "Log in with Google" }, { id: "gemini-api-key", name: "Gemini API key" }, { id: "vertex-ai", name: "Vertex AI" }],
        agentInfo: { name: "gemini-cli", title: "Gemini CLI", version: "0.62.0" }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: true, embeddedContext: true } } });
    case "authenticate": return reply(m.id, {});
    case "session/new": {
      if (state === "loggedout") return fail(m.id, -32000, "Gemini API key is missing or not configured.");
      const sessionId = crypto.randomUUID();
      cwds.set(sessionId, p.cwd);
      const all = sessions(); all[sessionId] = { cwd: p.cwd }; fs.writeFileSync(sessionsFile, JSON.stringify(all));
      return reply(m.id, { sessionId, modes: MODES, models: MODELS });
    }
    case "session/load": {
      if (state === "loggedout") return fail(m.id, -32000, "Authentication required");
      if (!sessions()[p.sessionId]) return fail(m.id, -32603, "Internal error", { details: "No previous sessions found for this project." });
      cwds.set(p.sessionId, p.cwd);
      // Gemini CLI replays the conversation before answering.
      update(p.sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "an old question" } });
      text(p.sessionId, "OLD HISTORY");
      return reply(m.id, { modes: MODES, models: MODELS });
    }
    case "session/set_mode": text(p.sessionId, `[MODE_UPDATE] ${p.modeId}`); return reply(m.id, {});
    case "session/set_model": return reply(m.id, {});
    case "session/prompt": prompt(m).catch((e) => fail(m.id, 500, e.message)); return;
    case "session/cancel": for (const r of waiting.values()) r({ outcome: { outcome: "cancelled" } }); waiting.clear(); if (cancelled) cancelled("cancel"); return;
    default: if (m.id !== undefined) fail(m.id, -32601, `"Method not found": ${m.method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { handle(JSON.parse(line)); } catch (e) { process.stderr.write(`fake gemini: ${e.message}\n`); } } }
});
process.stdin.on("end", () => process.exit(0));
