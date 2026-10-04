#!/usr/bin/env node
// A stand-in for Google's `agy` (Antigravity CLI 1.2.x), for testing Kural's Antigravity provider
// (extension/lib/ai/agy.js) without a Google login. It speaks the stream-json mode Kural uses, with the event shapes
// seen from agy 1.2.2–1.2.7 (init, step_update, result), plus `--version`, `models` and print-mode slash commands.
//
// State: $FAKE_AGY_STATE, or else the file $FAKE_AGY_FILE (default <tmp>/kural-fake-agy-state): ok | loggedout.
// Every run's arguments are added to $FAKE_AGY_LOG (one JSON per line), so a test can see the flags Kural used.
// What it answers depends on your message:
//   "edit notes"  changes notes.txt in the folder (replace_file_content); refused unless accept-edits or skip-permissions
//   "run tests"   runs `npm test` (run_command); refused unless --dangerously-skip-permissions
//   "slow"        writes slowly until SIGINT, then ends the answer as "interrupted" and exits
//   "who"         says the conversation id
//   anything else "You said: <your words>"
// `agy` with no arguments is its login screen: logged out, it logs in by itself after 2 s.
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");

const args = process.argv.slice(2);
const file = process.env.FAKE_AGY_FILE || path.join(os.tmpdir(), "kural-fake-agy-state");
const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
const state = () => process.env.FAKE_AGY_STATE || read(file) || "ok";
const convFile = `${file}.conversations`;
if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify(args) + "\n");
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const notLoggedIn = () => { process.stderr.write("Print mode: not logged in and no controlling terminal; cannot complete interactive login\n"); process.exit(1); };

// `agy` alone: its interactive screen. Logged out:
//   FAKE_AGY_LOGIN=browser  "opens the browser" (calls open / xdg-open from PATH) and is logged in 2 s later
//   otherwise (default)     shows a Google address and asks for the code: "4/kural-test" logs in, anything else fails
if (!args.length) {
  if (state() !== "loggedout") { console.log("Antigravity CLI (fake). Type a message, or Ctrl+C."); setInterval(() => {}, 1000); return; }
  const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=fake-agy.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fcodeassist.google.com%2Fauthcode&response_type=code&scope=openid%20email&state=xyz";
  if (process.env.FAKE_AGY_LOGIN === "browser") {
    console.log("Welcome to Antigravity. Sign in with Google: opening your browser…");
    try { require("child_process").spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" }).on("error", () => {}); } catch { /* none */ }
    setTimeout(() => { fs.writeFileSync(file, "ok"); console.log("Signed in as tester@example.com."); setInterval(() => {}, 1000); }, 2000);
    return;
  }
  process.stdout.write("\x1b[1mWelcome to Antigravity\x1b[0m\r\n\r\nTo sign in, open this address in a browser:\r\n\r\n  " + url + "\r\n\r\n");
  process.stdout.write("Enter the authorization code: ");
  const ask = () => process.stdin.once("data", (d) => {
    if (String(d).trim() === "4/kural-test") { fs.writeFileSync(file, "ok"); process.stdout.write("\r\nSigned in as tester@example.com.\r\n"); setInterval(() => {}, 1000); }
    else { process.stdout.write("\r\nThat code didn't work. Enter the authorization code: "); ask(); }
  });
  ask();
  return;
}
if (args[0] === "--version") { console.log("1.2.7"); process.exit(0); }
if (args[0] === "models") { console.log("gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-pro-high\tGemini 3.8 Pro (High)"); process.exit(0); }
const printed = flag("--print");
if (printed !== undefined) {
  if (state() === "loggedout") notLoggedIn();
  if (printed === "/model") out({ conversation_id: "", status: "SUCCESS", response: "Model: Gemini 3.8 Flash (High)\nAccount: tester@example.com" });
  else if (printed === "/usage") out({ conversation_id: "", status: "SUCCESS", response: "Gemini Models\tWeekly Limit Remaining\t87%\nClaude Models\tWeekly Limit Remaining\t99%" });
  else if (printed === "/logout") { fs.writeFileSync(file, "loggedout"); out({ conversation_id: "", status: "SUCCESS", response: "Logged out." }); }
  else out({ conversation_id: crypto.randomUUID(), status: "SUCCESS", response: `You said: ${printed}` });
  process.exit(0);
}
if (flag("--input-format") !== "stream-json") { console.log("fake agy: only --version, models, --print and stream-json"); process.exit(0); }

const cwd = flag("--add-dir") || process.cwd();
const skip = args.includes("--dangerously-skip-permissions");
const mode = flag("--mode") || (skip ? "always-proceed" : "request-review");
const known = (() => { try { return JSON.parse(fs.readFileSync(convFile, "utf8")); } catch { return []; } })();
let conv = flag("--conversation");
if (conv && !known.includes(conv)) { process.stderr.write(`warning: conversation "${conv}" not found\n`); conv = null; }
if (!conv) { conv = crypto.randomUUID(); fs.writeFileSync(convFile, JSON.stringify([...known, conv].slice(-50))); }

let total = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0 };
let step = 0, turns = 0;
let interrupted = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const upd = (u) => out({ event: "step_update", step_update: { conversation_id: conv, step_index: step, ...u } });

setTimeout(() => {
  if (state() === "loggedout") notLoggedIn();
  out({ event: "init", conversation_id: conv, init: { cwd, tools: ["view_file", "replace_file_content", "run_command"], permission_mode: mode, ...(flag("--model") ? { model: flag("--model") } : {}) } });
}, 150);

process.on("SIGINT", () => { if (interrupted) interrupted(); else process.exit(1); });

let buf = "", working = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { process.stderr.write("error: bad stream input\n"); process.exit(1); }
    if (m.event !== "user") { process.stderr.write(`warning: unknown event ${m.event}\n`); continue; }
    const c = m.message && m.message.content;
    if (Array.isArray(c) && c.some((b) => b.type !== "text")) { out({ event: "result", result: { status: "ERROR", error: "stream input content block type \"image\" is not supported (only \"text\")" } }); process.exit(1); }
    const text = Array.isArray(c) ? c.map((b) => b.text).join("") : String(c || "");
    working = working.then(() => turn(text));
  }
});
process.stdin.on("end", () => working.then(() => { process.stderr.write(`Print mode: stream input closed after ${turns} turn(s)\n`); process.exit(0); }));

async function say(t) {
  step++;
  upd({ state: "ACTIVE", step_type: "agent_response" });
  for (const piece of t.match(/.{1,12}/gs) || []) { upd({ state: "ACTIVE", step_type: "agent_response", text_delta: piece }); await sleep(5); }
  total.input_tokens += 100; total.output_tokens += 20;
  upd({ state: "DONE", step_type: "agent_response", usage: { input_tokens: 100, output_tokens: 20 } });
}

async function tool(name, parameters, allowed, work) {
  step++;
  upd({ state: "ACTIVE", step_type: "tool", tool_name: name, tool_info: { name, parameters } });
  await sleep(20);
  if (!allowed) { upd({ state: "ERROR", step_type: "tool", tool_name: name, tool_info: { name, error: { type: "permission", message: `permission check failed: user denied permission for ${name}` } } }); return false; }
  const output = work();
  upd({ state: "DONE", step_type: "tool", tool_name: name, tool_info: { name, output } });
  return true;
}

async function turn(text) {
  turns++;
  const t0 = Date.now();
  const denied = [];
  const msg = text.replace(/<kural_instructions>[\s\S]*?<\/kural_instructions>\s*/, "");
  if (/slow/i.test(msg)) {
    let stop = false;
    interrupted = () => { stop = true; };
    step++;
    for (let n = 0; n < 400 && !stop; n++) { upd({ state: "ACTIVE", step_type: "agent_response", text_delta: "." }); await sleep(25); }
    interrupted = null;
    if (stop) { out({ event: "result", result: { conversation_id: conv, status: "ERROR", error: "interrupted", usage: total } }); process.exit(1); }
  } else if (/edit notes/i.test(msg)) {
    const f = path.join(cwd, "notes.txt");
    const ok = await tool("replace_file_content", { TargetFile: f, Instruction: "add a line" }, mode === "accept-edits" || skip, () => { fs.appendFileSync(f, "two\n"); return "Edited notes.txt"; });
    if (!ok) denied.push({ action: "write", display_name: "replace_file_content" });
    await say(ok ? "I added a line to notes.txt." : "I wasn't allowed to change notes.txt.");
  } else if (/run tests/i.test(msg)) {
    const ok = await tool("run_command", { CommandLine: "npm test", Cwd: cwd }, skip, () => "All tests passed.");
    if (!ok) denied.push({ action: "command", display_name: "run_command" });
    await say(ok ? "The tests pass." : "I couldn't run the tests.");
  } else if (/^who/i.test(msg.trim())) {
    await say(`conversation ${conv}`);
  } else {
    await say(`You said: ${msg.trim()}`);
  }
  out({ event: "result", result: { conversation_id: conv, status: "SUCCESS", response: "", duration_seconds: (Date.now() - t0) / 1000, num_turns: turns, usage: total,
    ...(denied.length ? { denied_actions: denied } : {}) } });
}
