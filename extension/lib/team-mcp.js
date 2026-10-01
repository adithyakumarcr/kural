// A tiny message board for an agent team, so the agents can talk to each other.
// Claude starts this as an MCP server (one per chat tab; every agent in that chat shares it).
// Plain Node, no packages: Kural runs it with its own executable (ELECTRON_RUN_AS_NODE=1).
//
// Tools:  post(from, to, message)        to = a name, or "all"
//         read(name, wait_seconds)       new messages for `name`; waits up to wait_seconds for one

const messages = [];          // { n, from, to, text, at }
const seen = new Map();       // name -> number of the last message they've read
const waiting = [];           // blocked read() calls: { name, done }
const MAX_WAIT = 120;

const norm = (s) => String(s || "").trim().toLowerCase();
const forMe = (m, name) => m.from !== name && (m.to === "all" || m.to === name);

function unread(name) {
  const last = seen.get(name) || 0;
  return messages.filter((m) => m.n > last && forMe(m, name));
}

function deliver(name) {
  const list = unread(name);
  if (list.length) seen.set(name, list[list.length - 1].n);
  return list;
}

function format(list) {
  if (!list.length) return "No new messages.";
  return list.map((m) => `[${m.from} → ${m.to === "all" ? "everyone" : m.to}] ${m.text}`).join("\n");
}

const TOOLS = [
  {
    name: "post",
    description: "Send a message to a teammate (by name) or to everyone on the team (to = \"all\"). " +
      "Use it to share decisions others depend on (names, interfaces, values), to ask a teammate a question, or to answer one.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Your own name (e.g. Rachel)" },
        to: { type: "string", description: "A teammate's name, \"lead\", or \"all\"" },
        message: { type: "string" },
      },
      required: ["from", "to", "message"],
    },
  },
  {
    name: "read",
    description: "Get the messages sent to you (or to everyone) that you haven't read yet. " +
      "Set wait_seconds to wait for a reply when you're expecting one (up to 120).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Your own name" },
        wait_seconds: { type: "number", description: "How long to wait if there's nothing yet (0 = don't wait)" },
      },
      required: ["name"],
    },
  },
];

function call(name, args, reply) {
  if (name === "post") {
    const m = { n: messages.length + 1, from: norm(args.from) || "someone", to: norm(args.to) || "all", text: String(args.message || ""), at: Date.now() };
    messages.push(m);
    // Wake anyone waiting for this message.
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i];
      if (forMe(m, w.name)) { waiting.splice(i, 1); w.done(); }
    }
    return reply(`Sent to ${m.to === "all" ? "everyone" : m.to}.`);
  }
  if (name === "read") {
    const me = norm(args.name);
    const list = deliver(me);
    const wait = Math.max(0, Math.min(MAX_WAIT, Number(args.wait_seconds) || 0));
    if (list.length || !wait) return reply(format(list));
    let timer;
    const w = { name: me, done: () => { clearTimeout(timer); reply(format(deliver(me))); } };
    timer = setTimeout(() => { const i = waiting.indexOf(w); if (i >= 0) waiting.splice(i, 1); reply(`No messages in ${wait} s.`); }, wait * 1000);
    waiting.push(w);
    return;
  }
  reply(`Unknown tool ${name}`, true);
}

// ---------- MCP over stdio (one JSON message per line) ----------
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return;                       // notifications need no answer
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: (params && params.protocolVersion) || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "kural-team", version: "1.0.0" },
    } });
  }
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    return call(params.name, params.arguments || {}, (text, isError) =>
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: !!isError } }));
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
    try { handle(JSON.parse(line)); } catch { /* ignore bad input */ }
  }
});
process.stdin.on("end", () => process.exit(0));
