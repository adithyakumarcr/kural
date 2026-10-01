// Everything that talks to the `claude` CLI lives here.
// Kural never needs an API key: it runs Claude Code in "headless" mode
// (claude -p), which uses the login you already have.
//
// Speed notes (measured):
//  - Thinking off (MAX_THINKING_TOKENS=0) takes tab suggestions from 1–7 s to ~0.5 s.
//  - --safe-mode skips your hooks, plugins, MCP servers and CLAUDE.md. Those can make
//    every request slow; Kural adds your project's instructions to the chat itself.
//  - Starting `claude` costs 1–3 s, so processes are started ahead of time and reused.

const vscode = require("vscode");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// ---------- logging (View → Output → Kural) ----------
let output = null;
function initLog() { output = vscode.window.createOutputChannel("Kural"); return output; }
function log(msg) { if (output) output.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`); }

const LOGIN_RE = /not logged in|log ?in|invalid api key|api key|oauth|credential|401/i;

const IS_WIN = process.platform === "win32";

// Where Claude Code usually lives. Apps started from a menu/Dock/Start often don't
// have your shell's PATH, so check the usual install places directly.
function findClaude() {
  const home = os.homedir();
  const candidates = IS_WIN ? [
    path.join(home, ".local", "bin", "claude.exe"),                    // official installer
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"), // npm
  ] : [
    path.join(home, ".local/bin/claude"),
    path.join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",                                         // Homebrew on Apple Silicon
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    if (!IS_WIN) { const c = path.join(dir, "claude"); if (fs.existsSync(c)) return c; continue; }
    const exe = path.join(dir, "claude.exe");
    if (fs.existsSync(exe)) return exe;
    // npm puts a claude.cmd wrapper on PATH; run the real claude.exe it points to instead
    // (Windows can't start .cmd files directly without a shell).
    const viaNpm = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (fs.existsSync(path.join(dir, "claude.cmd")) && fs.existsSync(viaNpm)) return viaNpm;
  }
  return null;
}

// Instructions for Claude go in a small file instead of on the command line:
// Windows limits a command line to ~32,000 characters, and CLAUDE.md can be longer.
const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), "kural-prompts-"));
let promptCount = 0;
function promptFile(text) {
  const f = path.join(promptDir, `p${++promptCount}.md`);
  fs.writeFileSync(f, text, "utf8");
  return f;
}

// If Kural was started from a terminal inside Claude Code, that session's variables
// would leak into ours (and confuse which conversation is which). Keep only the
// CLAUDE_CODE_* variables that choose how you log in.
function cleanEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === "CLAUDECODE" || (k.startsWith("CLAUDE_CODE_") && !/^CLAUDE_CODE_(OAUTH_TOKEN|USE_|SKIP_|CLIENT_|API_KEY)/.test(k))) delete env[k];
  }
  env.DISABLE_AUTOUPDATER = "1"; // our background processes shouldn't update Claude Code
  return { ...env, ...extra };
}

const newSessionId = () => crypto.randomUUID();

// ---------- one running `claude` process ----------
// opts: name, model, effort, systemPrompt, appendSystemPrompt, tools, allowedTools, cwd,
//       partial, safeMode, noThinking, sessionId, resume, persist, hostPermissions,
//       jsonSchema, mcpServers ({name: {command, args, env}}), addDirs (more folders Claude may use)
// handlers: onMessage(msg), onPermission(req) -> Promise<{allow, message?}>, onExit(info)
class ClaudeProcess {
  constructor(opts, handlers) {
    this.opts = opts;
    this.h = handlers;
    this.proc = null;
    this.buf = "";
    this.stderr = "";
    this.exited = false;
    this.pending = new Map();   // our control requests waiting for an answer
  }

  start() {
    const bin = findClaude();
    if (!bin) return false;
    const o = this.opts;
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--model", o.model, ...(o.strictMcp === false ? [] : ["--strict-mcp-config"])];   // strict: no MCP servers but ours
    if (o.effort) args.push("--effort", o.effort);
    if (o.partial) args.push("--include-partial-messages");
    // Safe mode skips your hooks, plugins, skills and MCP servers (faster, predictable), but it
    // also skips the MCP servers we pass ourselves. So when we need one (the agent team's message
    // board), turn those things off one by one instead.
    if (o.safeMode && o.mcpServers) args.push("--setting-sources", "", "--disable-slash-commands");
    else if (o.safeMode) args.push("--safe-mode");
    if (o.systemPrompt) args.push("--system-prompt-file", promptFile(o.systemPrompt));
    if (o.appendSystemPrompt) args.push("--append-system-prompt-file", promptFile(o.appendSystemPrompt));
    args.push("--tools", (o.tools || []).join(","));
    if (o.allowedTools && o.allowedTools.length) args.push("--allowedTools", ...o.allowedTools);
    if (o.hostPermissions) args.push("--permission-mode", "default", "--permission-prompt-tool", "stdio");
    if (o.jsonSchema) args.push("--json-schema", JSON.stringify(o.jsonSchema));
    if (o.mcpServers) args.push("--mcp-config", promptFile(JSON.stringify({ mcpServers: o.mcpServers })));
    for (const d of o.addDirs || []) args.push("--add-dir", d);
    if (o.resume) args.push("--resume", o.resume);
    else if (o.sessionId) args.push("--session-id", o.sessionId);
    if (!o.persist) args.push("--no-session-persistence");

    const cwd = o.cwd || fs.mkdtempSync(path.join(os.tmpdir(), "kural-")); // empty folder: no project files loaded
    const env = cleanEnv(o.noThinking ? { MAX_THINKING_TOKENS: "0" } : {});
    // Its own process group (not on Windows), so stopping it also stops the commands it started.
    this.proc = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: !IS_WIN });
    this.startedAt = Date.now();
    log(`${o.name}: started claude (pid ${this.proc.pid}, ${o.model}${o.effort ? "/" + o.effort : ""}${o.resume ? ", resuming" : ""})`);

    this.proc.stdout.on("data", (d) => this.onData(d));
    this.proc.stderr.on("data", (d) => {
      this.stderr += d;
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) log(`${o.name}: [claude] ${line.trim().slice(0, 300)}`);
    });
    this.proc.stdin.on("error", () => {}); // process already gone; the exit handler reports it
    this.proc.on("error", (e) => log(`${o.name}: could not start claude: ${e.message}`));
    this.proc.on("exit", (code) => {
      this.exited = true;
      log(`${o.name}: claude exited (code ${code})`);
      if (this.h.onExit) this.h.onExit({ code, login: LOGIN_RE.test(this.stderr), stderr: this.stderr });
    });
    return true;
  }

  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === "control_response" && msg.response && this.pending.has(msg.response.request_id)) {
        const done = this.pending.get(msg.response.request_id);
        this.pending.delete(msg.response.request_id);
        done(msg.response.subtype === "success" ? msg.response.response || {} : null);
        continue;
      }
      if (msg.type === "control_request" && msg.request && msg.request.subtype === "can_use_tool") {
        this.answerPermission(msg);
        continue;
      }
      try { this.h.onMessage(msg); } catch (e) { log(`${this.opts.name}: ${e.stack}`); }
    }
  }

  // Claude asks before using a tool that isn't pre-approved (editing, running commands).
  async answerPermission(msg) {
    const r = msg.request;
    let ans = { allow: false, message: "Not allowed here." };
    try { if (this.h.onPermission) ans = await this.h.onPermission(r); } catch (e) { log(`${this.opts.name}: permission handler failed: ${e.message}`); }
    this.write({
      type: "control_response",
      response: { subtype: "success", request_id: msg.request_id,
        response: ans.allow ? { behavior: "allow", updatedInput: ans.updatedInput || r.input } : { behavior: "deny", message: ans.message || "The user declined." } },
    });
  }

  write(obj) { if (this.proc && !this.exited) this.proc.stdin.write(JSON.stringify(obj) + "\n"); }
  send(content) { this.write({ type: "user", message: { role: "user", content } }); }
  control(request) { const id = `cx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; this.write({ type: "control_request", request_id: id, request }); return id; }
  // A control request whose answer we want, e.g. { subtype: "mcp_status" }. Resolves null on failure.
  request(request, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!this.proc || this.exited) return resolve(null);
      const id = this.control(request);
      const t = setTimeout(() => { this.pending.delete(id); resolve(null); }, timeoutMs);
      this.pending.set(id, (v) => { clearTimeout(t); resolve(v); });
    });
  }
  interrupt() { this.control({ subtype: "interrupt" }); }
  setModel(model) { this.control({ subtype: "set_model", model }); }
  kill() {
    if (!this.proc || this.exited) return;
    if (!IS_WIN) { try { process.kill(-this.proc.pid, "SIGTERM"); return; } catch { /* fall back */ } }
    this.proc.kill();
  }
}

// ---------- request/answer session (tab completion, inline edit, apply) ----------
// Warm Claude processes that answer one question at a time each. With clearEach, a process
// forgets each question after answering (so an old answer can't leak into a new one), and
// it's swapped for a fresh one every `restartAfter` requests.
// pool: how many processes to keep ready. With 2, a new question never waits for the
//   previous one to finish being interrupted or cleared (you kept typing): it goes to the other.
// earlyStop: return the answer as soon as Claude has written this text (e.g. "</insert>"),
//   without waiting for the end of its turn.
class ClaudeSession {
  constructor(opts, onState = () => {}) {
    this.opts = { restartAfter: 25, timeoutMs: 20000, pool: 1, ...opts };
    this.slots = [];
    this.freeWaiters = [];   // asks waiting for a process to become free
    this.onState = onState;
  }

  // Start one process. Each slot keeps the list of answers it still expects (in order):
  // { ask: waiter } for a question, { clear: true } for our own "/clear".
  startSlot() {
    const o = this.opts;
    const slot = { cp: null, expect: [], count: 0, dead: false };
    const cp = new ClaudeProcess({ name: o.name, model: o.model(), effort: o.effort, systemPrompt: o.systemPrompt,
      tools: [], safeMode: true, noThinking: o.noThinking, partial: !!o.earlyStop }, {
      onMessage: (msg) => this.onMessage(slot, msg),
      onExit: (info) => {
        slot.dead = true;
        this.slots = this.slots.filter((x) => x !== slot);
        if (info.login) this.onState("login");
        for (const e of slot.expect) if (e.ask) e.ask.finish(null);
        slot.expect = [];
        this.wakeWaiters();
      },
    });
    if (!cp.start()) { this.onState("missing"); return null; }
    slot.cp = cp;
    this.slots.push(slot);
    return slot;
  }

  onMessage(slot, msg) {
    const o = this.opts;
    const head = slot.expect[0];
    if (!head) return;
    if (msg.type === "stream_event" && head.ask && o.earlyStop) {
      const ev = msg.event;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        head.text = (head.text || "") + ev.delta.text;
        if (!head.ask.done && head.text.includes(o.earlyStop)) {
          log(`${o.name}: answer ready in ${Date.now() - head.t0} ms`);
          this.onState("ready");
          head.ask.finish(head.text);
        }
      }
      return;
    }
    if (msg.type !== "result") return;
    slot.expect.shift();
    if (head.ask) {
      const text = msg.result || "";
      const stopped = msg.subtype === "error_during_execution";
      if (!head.ask.done) {
        log(`${o.name}: ${stopped ? "stopped (you kept typing)" : `reply in ${msg.duration_ms} ms${msg.is_error ? " (error)" : ""}: ${JSON.stringify(text).slice(0, 100)}`}`);
        if (msg.is_error && !stopped && LOGIN_RE.test(text)) this.onState("login");
        else this.onState(msg.is_error && !stopped ? "error" : "ready");
      }
      head.ask.finish(msg.is_error ? null : text);
      if (slot.count >= o.restartAfter) { this.retire(slot); this.ensurePool(); return; }
      if (o.clearEach) { slot.expect.push({ clear: true }); slot.cp.send("/clear"); return; }   // ~0.02 s, no API call
    }
    if (!slot.expect.length) this.wakeWaiters();
  }

  retire(slot) {
    slot.dead = true;
    this.slots = this.slots.filter((x) => x !== slot);
    for (const e of slot.expect) if (e.ask) e.ask.finish(null);
    slot.expect = [];
    slot.cp.kill();
  }

  // Keep `pool` processes running, so a question never waits for one to start.
  ensurePool() {
    while (this.slots.length < this.opts.pool) if (!this.startSlot()) return false;
    return true;
  }

  start() { return this.ensurePool(); }

  stop() { for (const s of [...this.slots]) this.retire(s); this.wakeWaiters(); }

  wakeWaiters() { const w = this.freeWaiters.splice(0); for (const f of w) f(); }

  freeSlot() { return this.slots.find((s) => !s.dead && !s.expect.length); }

  async ask(prompt, token) {
    // Questions nobody wants any more (you kept typing): stop them.
    for (const s of this.slots) for (const e of s.expect) if (e.ask && e.ask.token && e.ask.token.isCancellationRequested && !e.ask.interrupted) {
      e.ask.interrupted = true; s.cp.interrupt();
    }
    if (!this.slots.length && !this.ensurePool()) return null;
    let slot = this.freeSlot();
    while (!slot) {
      if (token && token.isCancellationRequested) return null;
      if (this.slots.length < this.opts.pool) { slot = this.startSlot(); if (!slot) return null; break; }
      await new Promise((r) => { this.freeWaiters.push(r); setTimeout(r, 2000); });
      slot = this.freeSlot();
    }
    if (token && token.isCancellationRequested) return null;
    slot.count++;
    this.onState("thinking");
    return new Promise((resolve) => {
      const ask = { token, done: false, interrupted: false, finish: null };
      const timer = setTimeout(() => {
        if (ask.done) return;
        log(`${this.opts.name}: no reply after ${this.opts.timeoutMs / 1000} s, restarting claude`);
        this.retire(slot); this.ensurePool();
      }, this.opts.timeoutMs);
      ask.finish = (t) => { if (ask.done) return; ask.done = true; clearTimeout(timer); resolve(t); };
      if (token) token.onCancellationRequested(() => {
        if (!ask.done && !ask.interrupted && !slot.dead) { ask.interrupted = true; slot.cp.interrupt(); }
      });
      slot.expect.push({ ask, t0: Date.now() });
      slot.cp.send(prompt);
    });
  }
}

// Claude sometimes wraps code in ``` fences even when told not to. Strip one outer fence.
function stripFence(text) {
  const m = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : text;
}

module.exports = { IS_WIN, initLog, log, findClaude, ClaudeProcess, ClaudeSession, stripFence, newSessionId, LOGIN_RE };
