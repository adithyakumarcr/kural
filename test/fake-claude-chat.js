#!/usr/bin/env node
// A stand-in for Claude Code in the chat (`claude -p --input-format stream-json --output-format stream-json`): it stays
// running, and answers each message with "You said: <everything it was sent>" (text and how many pictures/PDFs), so a
// test can see exactly what the chat handed Claude (test/handoff-fakes.test.js). With no input (Kural's check of which
// options this Claude knows) it just ends. Echoes each message first with --replay-user-messages, like Claude Code, and
// answers `initialize` with a few skills and commands (the chat's "/" list).
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.300 (Claude Code)"); process.exit(0); }
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const model = (() => { const i = args.indexOf("--model"); return i >= 0 ? `claude-${args[i + 1]}-9-9` : "claude-sonnet-9-9"; })();
const session = (() => { const i = args.indexOf("--session-id"); const j = args.indexOf("--resume"); return i >= 0 ? args[i + 1] : j >= 0 ? args[j + 1] : "s"; })();
let buf = "", inited = false;
const COMMANDS = [
  { name: "superpowers:brainstorming", description: "(Superpowers) You MUST use this before any creative work", argumentHint: "", aliases: ["brainstorming"] },
  { name: "code-review", description: "Review the current diff", argumentHint: "[low|medium|high]", aliases: ["review"], builtin: true },
  { name: "config", description: "Open the settings", argumentHint: "key=value", builtin: true },
];
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    // Its skills and commands (the chat's "/" list), like Claude Code 2.1.296's answer to `initialize`.
    if (m.type === "control_request" && m.request && m.request.subtype === "initialize") {
      out({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: { commands: COMMANDS, models: [], pid: process.pid } } });
      continue;
    }
    if (m.type !== "user") continue;
    if (!inited) { inited = true; out({ type: "system", subtype: "init", model, session_id: session, mcp_servers: [] }); }
    const c = m.message && m.message.content;
    const text = typeof c === "string" ? c : (c || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    // (A message starting with one of its commands is echoed the way Claude Code does it.)
    const cmd = /^\/([^\s]+)\s*([\s\S]*)$/.exec(text), known = cmd && COMMANDS.some((x) => x.name === cmd[1]);
    const echo = known ? { role: "user", content: `<command-message>${cmd[1]}</command-message>\n<command-name>/${cmd[1]}</command-name>\n<command-args>${cmd[2]}</command-args>` } : m.message;
    if (args.includes("--replay-user-messages")) out({ type: "user", isReplay: true, message: echo, session_id: session });
    const media = typeof c === "string" ? 0 : (c || []).filter((b) => b.type === "image" || b.type === "document").length;
    const said = `You said: ${text}${media ? ` (${media} attached)` : ""}`;
    // (Streamed, like Claude Code with --include-partial-messages: the chat shows the text from these.)
    out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, session_id: session });
    out({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: said } }, session_id: session });
    out({ type: "stream_event", event: { type: "content_block_stop", index: 0 }, session_id: session });
    out({ type: "assistant", message: { model, role: "assistant", content: [{ type: "text", text: said }] }, session_id: session });
    out({ type: "result", subtype: "success", is_error: false, result: said, session_id: session });
  }
});
process.stdin.on("end", () => process.exit(0));
