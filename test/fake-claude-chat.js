#!/usr/bin/env node
// A stand-in for Claude Code in the chat (`claude -p --input-format stream-json --output-format stream-json`): it stays
// running, and answers each message with "You said: <everything it was sent>" (text and how many pictures/PDFs), so a
// test can see exactly what the chat handed Claude (test/handoff-fakes.test.js). With no input (Kural's check of which
// options this Claude knows) it just ends. Echoes each message first with --replay-user-messages, like Claude Code.
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.1.300 (Claude Code)"); process.exit(0); }
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const model = (() => { const i = args.indexOf("--model"); return i >= 0 ? `claude-${args[i + 1]}-9-9` : "claude-sonnet-9-9"; })();
const session = (() => { const i = args.indexOf("--session-id"); const j = args.indexOf("--resume"); return i >= 0 ? args[i + 1] : j >= 0 ? args[j + 1] : "s"; })();
let buf = "", inited = false;
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== "user") continue;
    if (!inited) { inited = true; out({ type: "system", subtype: "init", model, session_id: session, mcp_servers: [] }); }
    if (args.includes("--replay-user-messages")) out({ type: "user", isReplay: true, message: m.message, session_id: session });
    const c = m.message && m.message.content;
    const text = typeof c === "string" ? c : (c || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
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
