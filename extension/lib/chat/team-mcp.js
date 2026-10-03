// A tiny message board for an agent team, so the agents can talk to each other.
// Claude starts this as an MCP server (one per chat tab; every agent in that chat shares it).
// Plain Node, no packages: Kural runs it with its own executable (ELECTRON_RUN_AS_NODE=1).
//
// Tools:  post(from, to, message)        to = a name, or "all"
//         read(name, wait_seconds)       new messages for `name`; waits up to wait_seconds for one
//         finish(name, final_position)   "I'm done": tells everyone, and nobody waits for you any more
//
// Nobody waits forever. An agent used to wait for a reply from a teammate who had already finished: it got
// "no messages", waited again, and never ended, so the lead never gave its answer. Now:
//  - a finished agent is known (its finish call, or Kural writes it to KURAL_TEAM_FILE when its task ends),
//    and anyone waiting is told right away;
//  - when everyone else has finished, read returns at once: "end now";
//  - after MAX_EMPTY empty waits in a row, read says: stop waiting, post your final position, end.

const fs = require("fs");
const messages = [];          // { n, from, to, text, at }
const seen = new Map();       // name -> number of the last message they've read
const waiting = [];           // blocked read() calls: { name, done }
const MAX_WAIT = 120;
const MAX_EMPTY = 2;
const team = (process.env.KURAL_TEAM || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const finished = new Set();   // agents done with this question
const emptyWaits = new Map(); // name -> waits in a row that got nothing
let round = null;             // Kural's question number (a new question starts afresh)
let started = [];             // who the lead has actually started (a PM may start 1 of 3 possible developers)
let busy = [];                // who Kural has seen working in the last minute

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

// Everyone but `me` has finished. (Only those started count, once Kural says who that is.)
const members = () => started.length ? started : team;
const othersDone = (me) => { const others = members().filter((n) => n !== me); return others.length > 0 && others.every((n) => finished.has(n)); };
// Someone `me` may be waiting for is still at work (building takes longer than a few waits).
const othersBusy = (me) => members().some((n) => n !== me && !finished.has(n) && busy.includes(n));
const END_NOW = "Everyone else has finished, so no more messages will come. Don't wait: post your final position with " +
  "mcp__team__finish and end.";

function markFinished(name, text) {
  if (!name || finished.has(name)) return;
  finished.add(name);
  const m = { n: messages.length + 1, from: name, to: "all", text, at: Date.now() };
  messages.push(m);
  // Wake everyone who's waiting: for them a teammate has gone.
  for (const w of waiting.splice(0)) w.done();
}

// Kural writes {"round": n, "finished": ["ross"], "started": [...], "busy": [...]} when a question starts, when an
// agent starts or ends, and every few seconds while agents work.
function checkKural() {
  const file = process.env.KURAL_TEAM_FILE;
  if (!file) return;
  let st;
  try { st = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return; }
  if (st.round !== round) { round = st.round; finished.clear(); emptyWaits.clear(); }
  started = Array.isArray(st.started) ? st.started.map(norm) : [];
  busy = Array.isArray(st.busy) ? st.busy.map(norm) : [];
  for (const n of st.finished || []) markFinished(String(n).toLowerCase(), "(has finished and won't reply any more)");
}
if (process.env.KURAL_TEAM_FILE) setInterval(checkKural, 1000).unref();

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
    name: "finish",
    description: "Call this once when you're done, just before you end: it sends your final position to everyone, " +
      "and your teammates stop waiting for you.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Your own name" },
        final_position: { type: "string", description: "Your final position or result, in a few lines" },
      },
      required: ["name", "final_position"],
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
  if (name === "finish") {
    const me = norm(args.name);
    markFinished(me, `FINISHED. Final position: ${String(args.final_position || "").trim()}`);
    return reply("Done. Your teammates know you've finished. End now with your final report.");
  }
  if (name === "read") {
    checkKural();
    const me = norm(args.name);
    const list = deliver(me);
    const wait = Math.max(0, Math.min(MAX_WAIT, Number(args.wait_seconds) || 0));
    if (list.length) { emptyWaits.set(me, 0); return reply(format(list) + (othersDone(me) ? `\n\n${END_NOW}` : "")); }
    if (othersDone(me)) return reply(END_NOW);
    if (!wait) return reply(format(list));
    let timer;
    const w = { name: me, done: () => {
      clearTimeout(timer);
      const got = deliver(me);
      if (got.length) emptyWaits.set(me, 0);
      reply(got.length ? format(got) + (othersDone(me) ? `\n\n${END_NOW}` : "") : othersDone(me) ? END_NOW : format(got));
    } };
    timer = setTimeout(() => {
      const i = waiting.indexOf(w); if (i >= 0) waiting.splice(i, 1);
      checkKural();
      // An empty wait only counts when nobody you could be waiting for is still working.
      const n = othersBusy(me) ? (emptyWaits.get(me) || 0) : (emptyWaits.get(me) || 0) + 1;
      emptyWaits.set(me, n);
      reply(n >= MAX_EMPTY
        ? `No messages in ${wait} s, ${n} times in a row: your teammates aren't answering. Stop waiting: post your final ` +
          `position with mcp__team__finish, then end.`
        : `No messages in ${wait} s.`);
    }, wait * 1000);
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
