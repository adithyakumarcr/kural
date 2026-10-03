// A stand-in for Ollama, for testing local models in the chat without the real thing (no model, no GPU).
// Same API shape: /api/version, /api/tags, /api/show, /api/pull, /api/delete, /api/create, and the
// Claude-compatible /v1/messages that Claude Code talks to.
//   node test/fake-ollama-chat.js [port]          (default 11435; requests are logged to stdout)
// /v1/messages: if your message says "read the readme", the "model" first asks to Read README.md
// (a tool call, like a real model would), then answers with the file's first line. Otherwise it says hello.
// /api/chat (Kural's own engine), streamed: "read the readme" → a Read tool call, then the first line;
// "add a line to notes.txt" → an Edit tool call; "slow" → a slow answer (to test Stop); "think" → thinking first;
// with "format" → a JSON answer (for Ask). Otherwise: "Hello from <model>. You said: …".
const http = require("http");

function start(port = 11435, { version = "0.15.2", log = () => {} } = {}) {
  const models = new Map([
    ["qwen3-coder:30b", { size: 18e9, params: "30.5B", caps: ["completion", "tools"] }],
    ["nomic-embed-text:latest", { size: 274e6, params: "137M", caps: ["embedding"] }],
    ["qwen2.5-coder:1.5b-base", { size: 986e6, params: "1.5B", caps: ["completion", "insert"] }],
    ["qwen3:8b", { size: 5.2e9, params: "8.2B", caps: ["completion", "tools", "thinking"] }],
  ]);
  const created = [];
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => body += d);
    req.on("end", () => {
      let j = {}; try { j = body ? JSON.parse(body) : {}; } catch {}
      requests.push({ method: req.method, url: req.url, body: j, auth: req.headers.authorization || "" });
      log(`${req.method} ${req.url} ${j.model || ""}`);
      const json = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url === "/api/version") return json({ version });
      if (req.url === "/api/tags") return json({ models: [...models].map(([name, m]) => ({ name, size: m.size, details: { parameter_size: m.params } })) });
      if (req.url === "/api/show") {
        const m = models.get(j.model) || models.get(`${j.model}:latest`);
        return m ? json({ capabilities: m.caps, details: { parameter_size: m.params } }) : json({ error: `model '${j.model}' not found` }, 404);
      }
      if (req.url === "/api/delete") { const had = models.delete(j.model); return had ? json({}) : json({ error: "not found" }, 404); }
      if (req.url === "/api/create") {
        const from = models.get(j.from);
        if (!from) return json({ error: `model '${j.from}' not found` }, 404);
        models.set(j.model, { ...from }); created.push(j);
        return json({ status: "success" });
      }
      if (req.url === "/api/pull") {
        if (/nope/.test(j.model)) return json({ error: "pull model manifest: file does not exist" }, 404);
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        let done = 0; const total = 4e9;
        const t = setInterval(() => {
          done += total / 4;
          if (done >= total) { models.set(j.model, { size: total, params: "8B", caps: ["completion", "tools"] }); res.end(JSON.stringify({ status: "success" }) + "\n"); clearInterval(t); return; }
          res.write(JSON.stringify({ status: "pulling 1a2b3c", total, completed: done }) + "\n");
        }, Number(process.env.FAKE_PULL_MS) || 60);
        return;
      }
      if (req.url === "/api/chat") return ollamaChat(j, res, models);
      if (req.url.startsWith("/v1/messages/count_tokens")) return json({ input_tokens: 100 });
      if (req.url.startsWith("/v1/messages")) return messages(j, res);
      json({ error: "not found" }, 404);
    });
  });
  server.listen(port, "127.0.0.1");
  return { server, requests, created, models, close: () => server.close() };
}

// Ollama's own chat API (what Kural's engine uses), scripted.
function ollamaChat(j, res, models) {
  if (!models.has(j.model)) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `model "${j.model}" not found, try pulling it first` })); return; }
  const msgs = j.messages || [];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user") || { content: "" };
  const afterUser = msgs.slice(msgs.lastIndexOf(lastUser) + 1);
  const toolDone = afterUser.find((m) => m.role === "tool");
  const say = (text, extra = {}) => ({ model: j.model, message: { role: "assistant", content: text, ...extra }, done: false });
  let chunks;
  if (j.format) {
    const out = { answer: "The README starts the project.", results: [{ file: "README.md", line: 1, why: "the first line" }] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ model: j.model, message: { role: "assistant", content: JSON.stringify(out) }, done: true }));
    return;
  }
  if (j.stream === false) {   // one answer, not streamed: Ctrl+K / Apply (<code>…</code>), commit messages (<cmd>…</cmd>)
    const sys = String((msgs.find((m) => m.role === "system") || {}).content || "");
    const text = /<code>/.test(sys) ? `<code>\n# edited by ${j.model}, offline\n</code>`
      : /<cmd>/.test(sys) ? `<cmd>git commit -m "Add notes"</cmd>` : `Hello from ${j.model}.`;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ model: j.model, message: { role: "assistant", content: text }, done: true }));
    return;
  }
  if (/read the readme/i.test(lastUser.content) && !toolDone) chunks = [say("Let me look.", { tool_calls: [{ function: { name: "Read", arguments: { file_path: "README.md" } } }] })];
  else if (/read the readme/i.test(lastUser.content)) {
    const first = (toolDone.content.split("\n").find((l) => /\S/.test(l.replace(/^\s*\d+\t/, ""))) || "").replace(/^\s*\d+\t/, "").trim();
    chunks = [say("The README's first line is: "), say(first)];
  } else if (/add a line to notes/i.test(lastUser.content) && !toolDone) chunks = [say("", { tool_calls: [{ function: { name: "Edit", arguments: { file_path: "notes.txt", old_string: "one", new_string: "one\ntwo" } } }] })];
  else if (/add a line to notes/i.test(lastUser.content)) chunks = [say(`Done: ${toolDone.content}`)];
  else if (/think/i.test(lastUser.content)) chunks = [{ model: j.model, message: { role: "assistant", content: "", thinking: "Let me think about this." }, done: false }, say("Thought it through.")];
  else chunks = [say(`Hello from ${j.model}. `), say(`You said: ${String(lastUser.content).slice(0, 60)}`)];
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  const slow = /slow/i.test(lastUser.content);
  let i = 0;
  const t = setInterval(() => {
    if (res.destroyed) { clearInterval(t); return; }
    if (i < chunks.length) { res.write(JSON.stringify(chunks[i++]) + "\n"); return; }
    clearInterval(t);
    res.end(JSON.stringify({ model: j.model, message: { role: "assistant", content: "" }, done: true }) + "\n");
  }, slow ? 2000 : 5);
}

// The "model": scripted answers in Anthropic's streaming format.
function messages(j, res) {
  const msgs = j.messages || [];
  // (Newer Claude Code can end the list with a "system" note, after the user's message: look at the last user message.)
  const last = [...msgs].reverse().find((m) => m.role === "user") || {};
  const texts = (m) => (typeof m.content === "string" ? [m.content] : (m.content || []).map((c) => c.text || (c.type === "tool_result" ? JSON.stringify(c.content) : "")));
  const lastText = texts(last).join(" ");
  const askedToRead = msgs.some((m) => m.role === "user" && /read the readme/i.test(texts(m).join(" ")));
  const toolResult = (last.content || []).find && (last.content || []).find((c) => c.type === "tool_result");
  let blocks;
  if (askedToRead && !toolResult) blocks = [{ type: "tool_use", id: "toolu_fake1", name: "Read", input: { file_path: `${process.env.FAKE_CWD || process.cwd()}/README.md` } }];
  else if (toolResult) {
    const content = typeof toolResult.content === "string" ? toolResult.content : (toolResult.content || []).map((c) => c.text).join("");
    const first = (content.split("\n").find((l) => /\S/.test(l.replace(/^\s*\d+[→\t]/, ""))) || "").replace(/^\s*\d+[→\t]/, "").trim();
    blocks = [{ type: "text", text: `The README's first line is: ${first}` }];
  } else blocks = [{ type: "text", text: `Hello from the local model (${j.model}). You said: ${lastText.slice(0, 60)}` }];
  if (!j.stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "msg_fake", type: "message", role: "assistant", model: j.model, content: blocks,
      stop_reason: blocks[0].type === "tool_use" ? "tool_use" : "end_turn", usage: { input_tokens: 50, output_tokens: 20 } }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const ev = (type, d) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`);
  ev("message_start", { message: { id: "msg_fake", type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, usage: { input_tokens: 50, output_tokens: 0 } } });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      for (const piece of b.text.match(/.{1,12}/g)) ev("content_block_delta", { index, delta: { type: "text_delta", text: piece } });
    } else {
      ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    ev("content_block_stop", { index });
  });
  ev("message_delta", { delta: { stop_reason: blocks[0].type === "tool_use" ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
  ev("message_stop", {});
  res.end();
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 11435;
  start(port, { log: (s) => console.log(new Date().toISOString().slice(11, 23), s) });
  console.log(`fake ollama (chat) on ${port}`);
}
module.exports = { start };
