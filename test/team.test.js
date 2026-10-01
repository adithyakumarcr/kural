// The agent team's message board (extension/lib/team-mcp.js): a waiting read gets a later post.
const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");

const p = spawn(process.execPath, [path.join(__dirname, "..", "extension", "lib", "team-mcp.js")]);
const replies = new Map();
let buf = "";
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); }
});
const send = (o) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
const call = (id, name, args) => send({ id, method: "tools/call", params: { name, arguments: args } });
const text = (id) => replies.get(id).result.content[0].text;

send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
send({ id: 2, method: "tools/list" });
call(3, "read", { name: "Ross", wait_seconds: 5 });            // Ross waits…
setTimeout(() => call(4, "post", { from: "Rachel", to: "Ross", message: "It's 42" }), 200);
setTimeout(() => call(5, "read", { name: "Monica" }), 300);     // not for Monica
setTimeout(() => call(6, "post", { from: "Lead", to: "all", message: "Wrap up" }), 400);
setTimeout(() => call(7, "read", { name: "monica" }), 500);
setTimeout(() => {
  assert.deepStrictEqual(replies.get(2).result.tools.map((t) => t.name), ["post", "read"]);
  assert.strictEqual(text(3), "[rachel → ross] It's 42");
  assert.strictEqual(text(5), "No new messages.");
  assert.strictEqual(text(7), "[lead → everyone] Wrap up");
  console.log("team board: ALL PASS");
  p.kill();
}, 800);
