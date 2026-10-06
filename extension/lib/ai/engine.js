// Kural's own engine: runs a model on your computer (Ollama) as a coding agent, without Claude Code, without an
// account, without internet. It talks to Ollama's /api/chat directly: the model answers or asks for tools
// (lib/tools.js), Kural runs them (asking you first where needed) and sends the results back, until the model
// has its answer.
//
// It behaves like ClaudeProcess (lib/claude.js) on purpose: same methods (start, send, interrupt, kill, setModel,
// request) and the same events (Claude Code's stream-json: text and thinking as they're written, tool calls,
// a "result" at the end). So the chat, Ask, permissions, question cards and Undo work the same for both.
// No vscode here (tests run against a stand-in Ollama).

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { Tools, definitions, SUPPORTED } = require("./tools");
const { within } = require("../paths");
const READS = new Set(["Read", "Grep", "Glob"]);

// A POST to Ollama with Node's own http, not fetch: fetch gives up after 5 minutes without an answer, and a big model
// on a slow computer can take that long to load and read a long prompt. The answer is decoded as UTF-8 across chunks
// (a Tamil letter split between two chunks stays one letter). Resolves { ok, status, text(), chunks (async iterable) }.
function post(url, body, signal) {
  return new Promise((resolve, reject) => {
    const abortErr = () => Object.assign(new Error("Stopped."), { name: "AbortError" });
    if (signal && signal.aborted) { reject(abortErr()); return; }
    let u; try { u = new URL(url); } catch (e) { reject(e); return; }
    const req = (u.protocol === "https:" ? https : http).request(u, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.setEncoding("utf8");
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, chunks: res,
        text: () => new Promise((done) => { let t = ""; res.on("data", (d) => { t += d; }); res.on("end", () => done(t)); res.on("error", () => done(t)); }) });
    });
    req.on("error", (e) => reject(signal && signal.aborted ? abortErr() : e));
    if (signal) signal.addEventListener("abort", () => req.destroy(abortErr()), { once: true });
    req.end(JSON.stringify(body));
  });
}
const errorText = async (res) => ((await res.text().catch(() => "")).replace(/^\{"error":"|"\}\s*$/g, "")) || `Ollama answered ${res.status}`;

const MAX_STEPS = 60;   // tool rounds in one answer, at most

function systemPrompt(o) {
  const dirs = (o.addDirs || []).length ? ` More folders you may use: ${o.addDirs.join(", ")}.` : "";
  return `You are Kural, the AI assistant in the Kural code editor. You help the user with their software project.\n` +
    `Project folder: ${o.cwd} (${process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux"}).${dirs} ` +
    `Today is ${new Date().toISOString().slice(0, 10)}.\n` +
    `Use your tools: look at files before you talk about them or change them; never guess what a file contains. ` +
    `Paths are relative to the project folder. To change a file, use Edit with old_string copied exactly from the file ` +
    `(Read it first), or Write for a new file. Run tests or commands with Bash when it helps. ` +
    `Keep answers short and clear; explain why before how.\n` + (o.appendSystemPrompt || "");
}

class LocalAgent {
  // opts: name, model (Ollama's name), baseUrl, contextLength, capabilities, effort, cwd, addDirs, tools (names),
  //   allowedTools (run without asking), appendSystemPrompt, jsonSchema (the final answer as JSON), store (folder
  //   for saved conversations), sessionId / resume, fetch (for tests).
  // handlers: onMessage(msg), onPermission(req) -> Promise<{allow, updatedInput?, message?}>, onExit(info)
  constructor(opts, handlers) {
    this.opts = { contextLength: 32768, ...opts };
    this.h = handlers || {};
    this.model = opts.model;
    this.exited = false;
    this.queue = [];
    this.busy = false;
    this.abort = null;
    this.tools = new Tools(opts.cwd || process.cwd(), opts.addDirs || []);
    this.offered = (opts.tools || SUPPORTED).filter((n) => SUPPORTED.includes(n));
    this.allowed = new Set(opts.allowedTools || ["Read", "Grep", "Glob"]);
    this.sessionId = opts.resume || opts.sessionId || crypto.randomUUID();
    this.history = [];
    this.ids = 0;
  }

  emit(m) { if (this.exited) return; try { this.h.onMessage && this.h.onMessage({ session_id: this.sessionId, ...m }); } catch (e) { /* the chat logs its own errors */ } }

  file() { return this.opts.store ? path.join(this.opts.store, `${this.sessionId.replace(/[^\w-]/g, "")}.json`) : null; }

  start() {
    if (this.opts.resume && this.file()) { try { this.history = JSON.parse(fs.readFileSync(this.file(), "utf8")).messages || []; } catch { /* a new conversation */ } }
    setImmediate(() => this.emit({ type: "system", subtype: "init", model: this.model, tools: this.offered, mcp_servers: [] }));
    return true;
  }

  save() {
    const f = this.file();
    if (!f) return;
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ model: this.model, messages: this.history })); } catch { /* best effort */ }
  }

  // Your message: a string, or Claude-style blocks (text and images).
  send(content) {
    if (this.exited) return;
    this.queue.push(content);
    if (!this.busy) this.next();
  }

  setModel(m) { this.model = m; }
  request(req) { return Promise.resolve(req && req.subtype === "mcp_status" ? { mcpServers: [] } : {}); }
  control() { return null; }

  interrupt() { this.stopped = true; if (this.abort) this.abort.abort(); this.tools.stop(); }

  kill() {
    if (this.exited) return;
    this.interrupt();
    this.exited = true;
    setImmediate(() => this.h.onExit && this.h.onExit({ code: 0, login: false, stderr: "" }));
  }

  async next() {
    const content = this.queue.shift();
    if (content === undefined) { this.busy = false; return; }
    this.busy = true;
    this.stopped = false;
    const t0 = Date.now();
    const msg = { role: "user", content: "" };
    for (const b of typeof content === "string" ? [{ type: "text", text: content }] : content) {
      if (b.type === "text") msg.content += (msg.content ? "\n\n" : "") + b.text;
      else if (b.type === "image" && b.source && b.source.data) (msg.images = msg.images || []).push(b.source.data);
      else if (b.type === "document") msg.content += `\n\n(A PDF was attached: ${b.title || "document"}. This model can't read PDFs.)`;
    }
    const before = this.history.length;
    this.history.push(msg);
    let result;
    try { result = await this.turn(); }
    catch (e) {
      const stopped = this.stopped || (e && e.name === "AbortError");
      // Failed (not stopped): forget this question and what came after it. It may be what failed (an image for a
      // model that can't read images); kept, every later message would fail the same way.
      if (!stopped) this.history.length = before;
      result = stopped
        ? { type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped." }
        : { type: "result", subtype: "error", is_error: true, result: friendly(e, this.model) };
    }
    if (this.exited) return;   // killed meanwhile: a newer process owns this conversation's file now
    this.save();
    this.emit({ duration_ms: Date.now() - t0, ...result });
    this.next();
  }

  // One answer: ask the model, run the tools it wants, again, until it answers without tools.
  async turn() {
    let text = "";
    for (let step = 0; step < MAX_STEPS; step++) {
      if (this.stopped) throw Object.assign(new Error("stopped"), { name: "AbortError" });
      const reply = await this.chat(this.offered.length ? definitions(this.offered) : undefined);
      const calls = reply.tool_calls || [];
      this.history.push({ role: "assistant", content: reply.content || "", ...(calls.length ? { tool_calls: calls } : {}) });
      text = reply.content || text;
      if (!calls.length) {
        const out = { type: "result", subtype: "success", is_error: false, result: (reply.content || "").trim() };
        if (this.opts.jsonSchema) out.structured_output = await this.structured();
        return out;
      }
      const uses = calls.map((c) => ({ type: "tool_use", id: `toolu_kural_${++this.ids}`, name: c.function.name, input: args(c.function.arguments) }));
      this.emit({ type: "assistant", message: { role: "assistant", model: this.model, content: uses } });
      const results = [];
      for (const u of uses) {
        const out = await this.use(u);
        this.history.push({ role: "tool", tool_name: u.name, content: out.text });
        results.push({ type: "tool_result", tool_use_id: u.id, content: out.text, is_error: !!out.error });
        if (this.stopped) break;
      }
      this.emit({ type: "user", message: { role: "user", content: results } });
      // Kural can await a routing decision here: every tool finished, and the next model request has not started.
      if (!this.stopped && this.h.onCheckpoint) await this.h.onCheckpoint();
    }
    return { type: "result", subtype: "success", is_error: false, result: `${text}\n\n(Stopped after ${MAX_STEPS} tool steps.)`.trim() };
  }

  // Run one tool, asking first when it isn't one that's always allowed.
  async use(u) {
    if (!this.offered.includes(u.name)) return { text: `Error: there's no tool called ${u.name}. Tools: ${this.offered.join(", ")}.`, error: true };
    let input = u.input;
    // Models often give paths relative to the project: make them absolute, so the chat's permission card and Undo
    // (which keeps a copy of each file before it changes) see the real file.
    if (input && typeof input.file_path === "string" && input.file_path) { try { input = { ...input, file_path: this.tools.abs(input.file_path) }; } catch { /* no path */ } }
    if (input && typeof input.path === "string" && input.path) { try { input = { ...input, path: this.tools.abs(input.path) }; } catch { /* no path */ } }
    // Reading is allowed without asking only inside the project (and its other folders, the temp folder): reading
    // your Documents or Desktop would make macOS ask about Kural, so it's your call (the chat asks you).
    const where = input && (input.file_path || input.path);
    const outside = READS.has(u.name) && where && !within(where, [this.tools.cwd, ...(this.tools.dirs || []), os.tmpdir(), ...(this.opts.readRoots || [])]);
    if (!this.allowed.has(u.name) || outside) {
      let ans = { allow: false, message: "Not allowed here." };
      try { if (this.h.onPermission) ans = await this.h.onPermission({ tool_name: u.name, input, tool_use_id: u.id }); } catch (e) { ans = { allow: false, message: e.message }; }
      if (!ans || !ans.allow) return { text: ans && ans.message ? ans.message : "The user declined.", error: true };
      input = ans.updatedInput || input;
    }
    if (u.name === "AskUserQuestion") {
      const a = input.answers || {};
      return { text: Object.keys(a).length ? `The user answered:\n${Object.entries(a).map(([q, v]) => `- ${q} → ${v}`).join("\n")}` : "The user didn't answer." };
    }
    const r = await this.tools.run(u.name, input);
    return { text: r.output || r.error || "", error: !!r.error };
  }

  // One request to Ollama, streamed: text and thinking go to the chat as they come.
  async chat(tools) {
    this.trim();
    const think = (this.opts.capabilities || []).includes("thinking") ? this.opts.effort !== "low" : undefined;
    const body = { model: this.model, stream: true, messages: [{ role: "system", content: systemPrompt(this.opts) }, ...this.history],
      options: { num_ctx: this.opts.contextLength }, ...(tools ? { tools } : {}), ...(think !== undefined ? { think } : {}) };
    this.abort = new AbortController();
    const res = await post(this.url("/api/chat"), body, this.abort.signal);
    if (!res.ok) throw new Error(await errorText(res));
    let buf = "", content = "", calls = [], block = null;
    const open = (type) => { if (block === type) return; close(); block = type; this.emit({ type: "stream_event", event: { type: "content_block_start", content_block: { type } } }); };
    const close = () => { if (block) this.emit({ type: "stream_event", event: { type: "content_block_stop" } }); block = null; };
    for await (const piece of res.chunks) {
      buf += piece;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.error) throw new Error(m.error);
        const d = m.message || {};
        if (d.thinking) { open("thinking"); this.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: d.thinking } } }); }
        if (d.content) { open("text"); content += d.content; this.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: d.content } } }); }
        if (d.tool_calls && d.tool_calls.length) calls = calls.concat(d.tool_calls);
        // Image models answer with pictures (base64): the chat saves and shows them.
        for (const img of [...(d.images || []), ...(m.image ? [m.image] : [])]) {
          if (typeof img === "string" && img.length > 100) this.emit({ type: "kural_image", data: img, mime: img.startsWith("/9j/") ? "image/jpeg" : "image/png" });
        }
      }
    }
    close();
    this.abort = null;
    return { content, tool_calls: calls };
  }

  // Ask (lib/search.js) wants the answer as JSON: one more request with Ollama's "format" (no tools).
  async structured() {
    const body = { model: this.model, stream: false, format: this.opts.jsonSchema, options: { num_ctx: this.opts.contextLength },
      messages: [{ role: "system", content: systemPrompt(this.opts) }, ...this.history, { role: "user", content: "Now give your final answer as JSON in the requested format." }] };
    this.abort = new AbortController();
    try {
      const res = await post(this.url("/api/chat"), body, this.abort.signal);
      if (!res.ok) return null;
      return JSON.parse(JSON.parse(await res.text()).message.content);
    } catch { return null; } finally { this.abort = null; }
  }

  url(p) { return String(this.opts.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "") + p; }

  // Keep the conversation inside the model's window: shorten old tool output first, then drop the oldest turns.
  trim() {
    const budget = this.opts.contextLength * 3 * 0.75;   // ~3 characters per token, 3/4 of the window
    const size = () => this.history.reduce((n, m) => n + (m.content || "").length + JSON.stringify(m.tool_calls || "").length, 0) + 4000;
    for (let i = 0; size() > budget && i < this.history.length - 4; i++) {
      const m = this.history[i];
      if (m.role === "tool" && m.content.length > 300) m.content = `${m.content.slice(0, 200)}\n… (shortened to save room)`;
    }
    // (Never the current question or what followed it: the model must see what it's answering.)
    const current = () => { for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].role === "user") return i; return 0; };
    while (size() > budget && current() > 0) {
      this.history.shift();
      while (current() > 0 && this.history[0].role !== "user") this.history.shift();   // start at a question
    }
    // Still too big (huge tool output in this answer): shorten this answer's tool output too.
    for (let i = current(); size() > budget && i < this.history.length; i++) {
      const m = this.history[i];
      if (m.role === "tool" && m.content.length > 2000) m.content = `${m.content.slice(0, 1500)}\n… (shortened to fit the model's memory)`;
    }
  }
}

// Ollama returns tool arguments as an object (sometimes as a JSON string).
function args(a) { if (a && typeof a === "object") return a; try { return JSON.parse(a); } catch { return {}; } }

function friendly(e, model) {
  const s = String((e && e.message) || e);
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(s) || (e && /ECONNREFUSED/.test(String(e.code)))) return "Kural can't reach Ollama. Is it running? Start Ollama, then send again.";
  if (/not found|no such model/i.test(s)) return `Ollama doesn't have ${model}. Download it (model menu → Find & download models), or pick another.`;
  if (/does not support tools/i.test(s)) return `${model} can't use tools, so it can't read or change files. Pick a model with "tools".`;
  if (/memory|out of memory|requires more system memory/i.test(s)) return `${model} needs more memory than this computer has free. Try a smaller model. (${s})`;
  return s;
}

module.exports = { LocalAgent, systemPrompt, friendly, post, errorText };
