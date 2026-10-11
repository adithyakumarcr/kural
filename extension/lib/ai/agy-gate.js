// Kural's approval gate for Google Gemini (Antigravity, `agy`): the program agy runs before every tool call (its
// PreToolUse hook). Plain Node, no packages; Kural runs it with its own executable (ELECTRON_RUN_AS_NODE=1) through a
// small launcher (lib/ai/agy-gate-host.js writes it and the hooks.json entry).
//
// agy writes the call as JSON on stdin ({conversationId, workspacePaths, toolCall: {name, args}, stepIdx, …}) and
// reads the decision from stdout. This program asks Kural (a private local socket, a token per agy process) and
// WAITS for Kural's answer: the permission card, the chat's mode, the same rules as Claude. Then it prints the
// decision in both shapes Google documents ({"decision": …} and {"allow_tool": …}) and exits 0 (a non-zero exit is a
// hook failure for agy, not a "no").
//
// Which agy is Kural's:
//   KURAL_AGY_GATE  set only by Kural when it starts agy: {"socket": "...", "token": "..."}
//   or, if agy doesn't pass its environment to hooks, the conversation id in the call: Kural writes
//   <registry>/<sha256(id)>.json for each conversation it runs (the registry folder comes from KURAL_AGY_GATE_REGISTRY,
//   set by the launcher).
// Neither: this is your own agy in a terminal. Then the gate says nothing (no output, exit 0), so agy behaves exactly
// as it would without Kural.
//
// Kural's agy, anything wrong (Kural unreachable, a bad token, a malformed call, no answer in time): deny. Never allow
// by default.

"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_INPUT = 1 << 20;   // agy's call: at most 1 MB
const MAX_REPLY = 64 * 1024;
// Kural's answer can be a person deciding on a card: wait up to just under the hook's own timeout (hooks.json).
const WAIT_MS = Number(process.env.KURAL_AGY_GATE_TIMEOUT_MS) > 0 ? Number(process.env.KURAL_AGY_GATE_TIMEOUT_MS) : (43200 - 60) * 1000;
const INPUT_MS = 15000;

let finished = false;
function log(line) {
  const f = process.env.KURAL_AGY_GATE_LOG;
  if (!f) return;
  try { fs.appendFileSync(f, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }); } catch { /* logging only */ }
}
function finish(decision, reason) {
  if (finished) return;
  finished = true;
  let out = "";
  if (decision === "allow") out = JSON.stringify({ decision: "allow", allow_tool: true }) + "\n";
  else if (decision === "deny") {
    const why = String(reason || "Kural didn't approve this.").slice(0, 500);
    out = JSON.stringify({ decision: "deny", reason: why, allow_tool: false, deny_reason: why }) + "\n";
  }
  log(`${decision || "neutral"}${reason ? ` (${reason})` : ""}`);
  if (!out) process.exit(0);
  process.stdout.write(out, () => process.exit(0));
}

// The call from agy. Field names are taken loosely (camelCase and snake_case), since Google's docs show both.
function parseCall(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const tc = j.toolCall || j.tool_call || {};
  const name = tc.name || j.tool_name || j.toolName;
  let args = tc.args !== undefined ? tc.args : tc.arguments !== undefined ? tc.arguments : j.tool_input !== undefined ? j.tool_input : j.args;
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = { value: args }; } }
  if (args === undefined || args === null) args = {};
  return {
    event: String(j.hookEventName || j.hook_event_name || j.event || "PreToolUse"),
    tool: typeof name === "string" ? name : "",
    args: typeof args === "object" && !Array.isArray(args) ? args : { value: args },
    conversationId: String(j.conversationId || j.conversation_id || ""),
    stepIdx: j.stepIdx !== undefined ? j.stepIdx : j.step_idx,
    workspacePaths: Array.isArray(j.workspacePaths) ? j.workspacePaths.map(String).slice(0, 20) : [],
  };
}

// Where Kural is for this agy: { socket, token } | null (not Kural's) | { bad } (Kural's, but unusable).
function target(call) {
  const env = process.env.KURAL_AGY_GATE;
  if (env) {
    try { const t = JSON.parse(env); if (t && typeof t.socket === "string" && typeof t.token === "string" && t.socket && t.token) return t; } catch { /* below */ }
    return { bad: "Kural's gate settings are unreadable." };
  }
  const reg = process.env.KURAL_AGY_GATE_REGISTRY;
  if (!reg || !call || !call.conversationId) return null;
  const f = path.join(reg, `${crypto.createHash("sha256").update(call.conversationId).digest("hex")}.json`);
  let text; try { text = fs.readFileSync(f, "utf8"); } catch { return null; }
  try { const t = JSON.parse(text); if (t && typeof t.socket === "string" && typeof t.token === "string") return t; } catch { /* below */ }
  return { bad: "Kural's conversation entry is unreadable." };
}

function ask(t, call) {
  const c = net.connect(t.socket);
  let buf = "";
  const timer = setTimeout(() => { c.destroy(); finish("deny", "Kural didn't answer in time."); }, WAIT_MS);
  const end = (decision, why) => { clearTimeout(timer); try { c.destroy(); } catch { /* closed */ } finish(decision, why); };
  c.setEncoding("utf8");
  c.on("connect", () => c.write(JSON.stringify({ v: 1, token: t.token, event: call.event, tool: call.tool, args: call.args,
    conversationId: call.conversationId, stepIdx: call.stepIdx, workspacePaths: call.workspacePaths }) + "\n"));
  c.on("data", (d) => {
    buf += d;
    if (buf.length > MAX_REPLY) return end("deny", "Kural's answer was too long.");
    const i = buf.indexOf("\n");
    if (i < 0) return;
    let r; try { r = JSON.parse(buf.slice(0, i)); } catch { return end("deny", "Kural's answer was unreadable."); }
    if (r && r.decision === "allow") return end("allow");
    end("deny", (r && typeof r.reason === "string" && r.reason) || "Kural didn't approve this.");
  });
  c.on("error", (e) => end("deny", `Kural isn't reachable (${e.code || e.message}).`));
  c.on("close", () => end("deny", "Kural closed the connection without an answer."));
}

function main() {
  let input = "", tooBig = false;
  const quick = target(null);   // (KURAL_AGY_GATE alone decides whether a bad input is Kural's problem)
  const stop = setTimeout(() => onInput(true), INPUT_MS);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => { if (input.length + d.length > MAX_INPUT) { tooBig = true; onInput(); } else input += d; });
  process.stdin.on("end", () => onInput());
  process.stdin.on("error", () => onInput(true));
  let handled = false;
  function onInput(timedOut) {
    if (handled) return;
    handled = true;
    clearTimeout(stop);
    const call = !timedOut && !tooBig ? parseCall(input) : null;
    const t = call ? target(call) : quick;
    if (!t) return finish(null);                       // your own agy: no opinion
    if (t.bad) return finish("deny", t.bad);
    if (!call) return finish("deny", timedOut ? "agy's call didn't arrive in time." : tooBig ? "agy's call was too large." : "agy's call was unreadable.");
    if (!call.tool) return finish("deny", "agy's call had no tool name.");
    log(`ask ${call.tool}`);
    ask(t, call);
  }
}

if (require.main === module) main();
module.exports = { parseCall };
