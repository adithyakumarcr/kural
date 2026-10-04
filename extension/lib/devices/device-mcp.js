// The linked device's tools for the AI (an MCP server, one per chat linked to a device). Claude Code and Codex
// start it like any MCP server; it only passes each call on to Kural, which asks you first when your chat's mode says so
// and then runs it over SSH (lib/devices/index.js). The password never comes here.
// Plain Node, no packages: Kural runs it with its own executable (ELECTRON_RUN_AS_NODE=1).
//
// Tools:  run_command(command, timeout_seconds)   a shell command on the device
//         read_file(path)                         a text file's contents
//         write_file(path, content)               create or replace a file (folders are made as needed)
//         list_dir(path)                          ls -la
//
// Env: KURAL_DEVICE_SOCKET (where Kural listens), KURAL_DEVICE_TOKEN (which chat this is), KURAL_DEVICE_NAME.

const net = require("net");

const NAME = process.env.KURAL_DEVICE_NAME || "the device";
const TOOLS = [
  { name: "run_command", description: `Run a shell command on ${NAME} (Linux) over SSH and get its output and exit code. Each call is a new shell: ` +
      "cd and environment variables don't carry over (use `cd dir && …`). Don't start programs that never end (servers): run them with nohup … & or a timeout.",
    inputSchema: { type: "object", properties: { command: { type: "string" }, timeout_seconds: { type: "number", description: "default 120, at most 1800" } }, required: ["command"] } },
  { name: "read_file", description: `Read a text file on ${NAME}.`,
    inputSchema: { type: "object", properties: { path: { type: "string", description: "absolute, or relative to the home folder" } }, required: ["path"] } },
  { name: "write_file", description: `Create or replace a text file on ${NAME} (its folders are created as needed).`,
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "list_dir", description: `List a folder on ${NAME} (ls -la).`,
    inputSchema: { type: "object", properties: { path: { type: "string", description: "default: the home folder" } } } },
];

// One call to Kural: a line of JSON over its socket, one line back.
function ask(tool, args) {
  return new Promise((resolve) => {
    let buf = "", done = false;
    const end = (r) => { if (!done) { done = true; resolve(r); try { c.destroy(); } catch { /* closed */ } } };
    const c = net.connect(process.env.KURAL_DEVICE_SOCKET || "");
    c.setEncoding("utf8");
    c.on("connect", () => c.write(JSON.stringify({ token: process.env.KURAL_DEVICE_TOKEN || "", tool, args }) + "\n"));
    c.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { try { end(JSON.parse(buf.slice(0, i))); } catch { end({ text: "Kural sent a reply it couldn't read.", isError: true }); } } });
    c.on("error", (e) => end({ text: `Kural isn't reachable (${e.code || e.message}). Is Kural still open?`, isError: true }));
    c.on("close", () => end({ text: "Kural closed the connection.", isError: true }));
  });
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return;                       // notifications need no answer
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: { protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: {} }, serverInfo: { name: "kural-device", version: "1.0.0" } } });
  }
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const r = await ask(String(params.name || ""), params.arguments || {});
    return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(r.text || "") }], isError: !!r.isError } });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch((e) => msg.id !== undefined && send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } }));
  }
});
process.stdin.on("end", () => process.exit(0));

