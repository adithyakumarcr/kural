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
const { spawn, spawnSync, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { initLog, log } = require("../log");   // (re-exported below: older code imports log from here)
const usage = require("./usage");

const LOGIN_RE = /not logged in|log ?in|invalid api key|api key|oauth|credential|401/i;

const IS_WIN = process.platform === "win32";

// Where Claude Code usually lives. Apps started from a menu/Dock/Start often don't
// have your shell's PATH, so check the usual install places directly.
function findClaude() {
  const chosen = (vscode.workspace.getConfiguration("kural").get("claudePath") || "").trim();   // Get started → "Choose…"
  if (chosen) {
    if (!fs.existsSync(chosen)) return null;
    // Windows: npm's claude.cmd can't be started directly; use the claude.exe it points to.
    const viaNpm = path.join(path.dirname(chosen), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    return IS_WIN && /\.cmd$/i.test(chosen) && fs.existsSync(viaNpm) ? viaNpm : chosen;
  }
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
  return IS_WIN ? null : fromLoginShell();
}

// Last try (Mac, Linux): where your terminal finds `claude`. Kural opened from the Dock or a menu doesn't get the
// PATH your terminal has, so e.g. an npm install under nvm (~/.nvm/versions/node/…/bin) isn't found otherwise.
// Asking the shell takes 0.1–2 s, so it runs in the background (lookInShell, at startup and on "Check again")
// and findClaude only uses its last answer: it never waits for a shell.
let shellFound = null;
function fromLoginShell() { return shellFound && fs.existsSync(shellFound) ? shellFound : null; }
function lookInShell() {
  if (IS_WIN) return Promise.resolve(null);
  return new Promise((resolve) => {
    // -i -l: an interactive login shell reads ~/.bashrc / ~/.zshrc too, where nvm and others add to PATH.
    execFile(process.env.SHELL || "/bin/bash", ["-ilc", "command -v claude"], { cwd: os.tmpdir(), timeout: 8000, encoding: "utf8" }, (err, stdout) => {
      const line = String(stdout || "").trim().split("\n").pop() || "";
      const found = path.isAbsolute(line) && fs.existsSync(line) ? line : null;
      if (found !== shellFound) log(`claude ${found ? `found by your shell: ${found}` : "not found by your shell"}`);
      shellFound = found;
      resolve(found);
    }).stdin?.end();
  });
}
findClaude.lookInShell = lookInShell;

// Until Get started has passed (Claude Code installed, logged in, test request OK), nothing starts `claude` in the
// background: it would only fail with errors. lib/getstarted.js sets this.
let setupOk = () => true;
function setSetupGate(f) { setupOk = f; }
const isSetUp = () => setupOk();

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

// Newer Claude Code can show what Claude is thinking (as short summaries: --thinking-display summarized)
// and pass on what agents write and think (--forward-subagent-text). Older versions refuse to start with
// "unknown option" when given a flag they don't know, so ask once (about half a second, no Claude request:
// with no input, Claude stops right after checking its options) and only use the ones it knows.
// --replay-user-messages: Claude Code says when it takes in each message you sent (an echo with "isReplay"), also one
// sent while it's answering: that's how the chat knows a queued message went into the running answer or became the
// next one. (Probing it without --input-format stream-json fails with "requires both…", not "unknown option": known.)
const OPTIONAL_FLAGS = { thinkingDisplay: ["--thinking-display", "summarized"], forwardSubagentText: ["--forward-subagent-text"],
  replayUserMessages: ["--replay-user-messages"] };
// The answer is the same for every start of the same Claude Code, so it's saved (Kural's storage: setFlagsStore) with the
// program's real path, size and date, and asked again only after Claude Code changed (an update). extension.js asks in the
// background at startup (prefetchFlags). Before, the first chat start of every window asked with spawnSync: every extension,
// Tab Completion too, froze for ~0.3 s (up to the 8 s limit when claude started slowly), right as the chat began to answer.
let flagCache = null, flagsFile = null;
const flagJobs = new Map();
function setFlagsStore(dir) { flagsFile = dir ? path.join(dir, "claude-flags.json") : null; }
function binKey(bin) {
  try { const real = fs.realpathSync(bin), st = fs.statSync(real); return `${real}|${st.size}|${Math.round(st.mtimeMs)}`; } catch { return null; }
}
function savedFlags(bin) {
  const key = flagsFile && binKey(bin);
  if (!key) return null;
  try {
    const d = JSON.parse(fs.readFileSync(flagsFile, "utf8"));
    if (d.key !== key || !d.flags) return null;
    const known = { bin };
    for (const k of Object.keys(OPTIONAL_FLAGS)) if (d.flags[k] === true) known[k] = true;
    return known;
  } catch { return null; }
}
// Keeps what was found (and saves it when it's sure: a probe that couldn't tell is asked again next time).
function rememberFlags(bin, known, sure) {
  log(`claude options: thinking summaries ${known.thinkingDisplay ? "on" : "not supported"}, agents' text ${known.forwardSubagentText ? "on" : "not supported"}, ` +
    `messages while answering ${known.replayUserMessages ? "on" : "not supported (update Claude Code)"}`);
  flagCache = known;
  const key = sure && flagsFile && binKey(bin);
  if (key) {
    const flags = Object.fromEntries(Object.keys(OPTIONAL_FLAGS).map((k) => [k, !!known[k]]));
    try { fs.mkdirSync(path.dirname(flagsFile), { recursive: true }); fs.writeFileSync(flagsFile, JSON.stringify({ key, flags })); } catch { /* memory only */ }
  }
  return known;
}
const probeArgs = (left) => ["-p", "--output-format", "stream-json", "--verbose", ...left.flatMap((k) => OPTIONAL_FLAGS[k])];
// One probe's result: "ok" (Claude knows all of `left`), the option it didn't know, or null (couldn't tell).
function probeVerdict(left, r) {
  if (r.error || r.status === null) return null;
  const bad = /unknown option '([^']+)'/.exec(`${r.stdout || ""}${r.stderr || ""}`);
  if (!bad) return "ok";
  return left.find((x) => OPTIONAL_FLAGS[x][0] === bad[1]) || null;
}
// Asks with all the flags, drops the one it doesn't know, asks again… run(args) gives one probe's result.
async function probeFlags(bin, run) {
  const left = Object.keys(OPTIONAL_FLAGS), known = { bin };
  for (let i = 0; i <= Object.keys(OPTIONAL_FLAGS).length; i++) {
    const v = probeVerdict(left, await run(probeArgs(left)));
    if (v === "ok") { for (const k of left) known[k] = true; return { known, sure: true }; }
    if (!v) return { known, sure: false };                       // couldn't tell: use none of them
    left.splice(left.indexOf(v), 1);
  }
  return { known, sure: false };
}
const probeOpts = () => ({ cwd: os.tmpdir(), timeout: 8000, encoding: "utf8", env: cleanEnv({}), windowsHide: true });

// In the background (execFile): extension.js at startup, so a chat never waits for it.
function prefetchFlags(bin) {
  if (!bin) return Promise.resolve(null);
  if (flagCache && flagCache.bin === bin) return Promise.resolve(flagCache);
  const saved = savedFlags(bin);
  if (saved) return Promise.resolve(flagCache = saved);
  if (flagJobs.has(bin)) return flagJobs.get(bin);
  const run = (args) => new Promise((resolve) => {
    const p = execFile(bin, args, probeOpts(), (err, stdout, stderr) => resolve({
      error: err && typeof err.code === "string" ? err : null,           // couldn't start it (ENOENT…)
      status: !err ? 0 : typeof err.code === "number" ? err.code : null,  // null: stopped (the time limit)
      stdout, stderr }));
    if (p.stdin) p.stdin.end();
  });
  const job = probeFlags(bin, run)
    .then(({ known, sure }) => flagCache && flagCache.bin === bin ? flagCache : rememberFlags(bin, known, sure))
    .finally(() => flagJobs.delete(bin));
  flagJobs.set(bin, job);
  return job;
}

// When a chat starts: what's known, the saved answer, or (only if neither: Claude Code was just installed or updated,
// before the background probe finished) asking now, synchronously.
function supportedFlags(bin) {
  if (flagCache && flagCache.bin === bin) return flagCache;
  const saved = savedFlags(bin);
  if (saved) return (flagCache = saved);
  const left = Object.keys(OPTIONAL_FLAGS), known = { bin };
  let sure = false;
  for (let i = 0; i <= Object.keys(OPTIONAL_FLAGS).length; i++) {
    const v = probeVerdict(left, spawnSync(bin, probeArgs(left), { ...probeOpts(), input: "" }));
    if (v === "ok") { for (const k of left) known[k] = true; sure = true; break; }
    if (!v) break;
    left.splice(left.indexOf(v), 1);
  }
  return rememberFlags(bin, known, sure);
}
supportedFlags._reset = () => { flagCache = null; };   // (tests)

// ---------- one running `claude` process ----------
// opts: name, model, effort, systemPrompt, appendSystemPrompt, tools, allowedTools, cwd,
//       partial, safeMode, noThinking, sessionId, resume, persist, hostPermissions,
//       jsonSchema, mcpServers ({name: {command, args, env}}), addDirs (more folders Claude may use),
//       env (extra environment variables, e.g. to use a local model through Ollama)
// handlers: onMessage(msg), onPermission(req) -> Promise<{allow, message?}>, onExit(info)
// Debugging: set KURAL_RAW_LOG=/some/file before starting Kural to save everything Claude sends.
const RAW_LOG = process.env.KURAL_RAW_LOG || "";

class ClaudeProcess {
  constructor(opts, handlers) {
    this.opts = opts;
    this.h = handlers;
    this.proc = null;
    this.buf = "";
    this.stderr = "";
    this.exited = false;
    this.pending = new Map();   // our control requests waiting for an answer
    // Does it echo each message when it takes it in ({type: "user", isReplay: true})? Then a message sent while it
    // answers can go to it at once: Claude Code adds it to the running answer at its next step, or answers it next.
    this.echoes = false;
  }

  start() {
    if (!setupOk()) return false;   // not set up yet (Get started)
    const bin = findClaude();
    if (!bin) return false;
    const o = this.opts;
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--model", o.model, ...(o.strictMcp === false ? [] : ["--strict-mcp-config"])];   // strict: no MCP servers but ours
    if (o.effort) args.push("--effort", o.effort);
    if (o.partial) args.push("--include-partial-messages");
    if (o.showThinking || o.replay) {
      const f = supportedFlags(bin);
      // The chat: show Claude's thinking and what its agents write.
      if (o.showThinking) for (const k of ["thinkingDisplay", "forwardSubagentText"]) if (f[k]) args.push(...OPTIONAL_FLAGS[k]);
      // … and hear when Claude takes in each message (queued ones too: see `echoes`).
      if (o.replay && f.replayUserMessages) { args.push(...OPTIONAL_FLAGS.replayUserMessages); this.echoes = true; }
    }
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
    const env = cleanEnv({ ...(o.noThinking ? { MAX_THINKING_TOKENS: "0" } : {}), ...(o.env || {}) });   // env: e.g. a local model (Ollama)
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
      if (RAW_LOG) { try { fs.appendFileSync(RAW_LOG, `${this.opts.name} ${line}\n`, { mode: 0o600 }); } catch { /* debugging only */ } }
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === "control_response" && msg.response && this.pending.has(msg.response.request_id)) {
        const done = this.pending.get(msg.response.request_id);
        this.pending.delete(msg.response.request_id);
        done(msg.response.subtype === "success" ? msg.response.response || {} : null);
        continue;
      }
      // How much of your plan is used (sent after every answer): for the usage meter in the status bar.
      if (msg.type === "rate_limit_event") { const u = usage.fromClaude(msg); if (u) usage.report("claude", u); continue; }
      // Tokens each answer used (every Claude process: chat, Tab Completion, Ctrl+K…): the AI Usage panel's totals.
      if (msg.type === "result") usage.addTokens("claude", usage.fromResult(msg));
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
    if (!setupOk()) return null;   // not set up yet: quietly nothing (Get started says what's missing)
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

module.exports = { supportedFlags, prefetchFlags, setFlagsStore, OPTIONAL_FLAGS, IS_WIN, initLog, log, findClaude, cleanEnv, setSetupGate, isSetUp, ClaudeProcess, ClaudeSession, stripFence, newSessionId, LOGIN_RE };
