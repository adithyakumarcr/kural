// Google Gemini as a Kural provider: the `gemini` program (Gemini CLI) with your own Google login or API key.
//
// Kural starts `gemini --acp` and talks to it with the Agent Client Protocol (ACP): JSON-RPC 2.0, one JSON message
// per line over stdin/stdout. Kural asks ("session/prompt"), Gemini streams what it writes and does
// ("session/update") and asks before it edits a file or runs a command ("session/request_permission").
// Gemini does its own file and shell work; Kural only says yes or no (so the chat's Agent/Auto modes and Undo work).
//
// GeminiAgent behaves like LocalAgent (./engine.js) and ClaudeProcess (./claude.js) on purpose: same methods
// (start, send, interrupt, kill, setModel, request) and the same events (Claude Code's stream-json), so the chat
// needs nothing special for it. No vscode here (tests run it against test/fake-gemini.js).
//
// Logins are Gemini CLI's own business: Kural never reads a token or a key, only whether the files exist and which
// way you chose in Gemini CLI's settings.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const usage = require("./usage");

const IS_WIN = process.platform === "win32";
const NOT_LOGGED_IN = "Not logged in to Gemini. Log in with Google by running `gemini` in a terminal, or set GEMINI_API_KEY, then try again.";
const LOGIN_RE = /auth(entication)? required|not logged in|api key (is )?(missing|not valid|invalid|not configured)|api_key_invalid|invalid api key|unauthenticated|credential|\b401\b|log ?in\b/i;
const MAX_RESULT = 20000;   // characters of a tool's output shown in the chat

// ---------- where Gemini CLI keeps its things ----------

// ~/.gemini (Gemini CLI moves it with GEMINI_CLI_HOME; the tests use that too).
const geminiDir = (env = process.env) => path.join(env.GEMINI_CLI_HOME || os.homedir(), ".gemini");

// Gemini's settings.json may have comments in it: drop them (outside strings) before reading.
function readJsonc(file) {
  let raw; try { raw = fs.readFileSync(file, "utf8"); } catch { return {}; }
  let out = "", inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i], n = raw[i + 1];
    if (inStr) { out += c; if (c === "\\") { out += n || ""; i++; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { while (i < raw.length && raw[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) || {}; } catch { return {}; }
}

// Gemini CLI's names for its login ways, and what Kural calls them.
const METHODS = { "oauth-personal": "Google account", "gemini-api-key": "API key", "vertex-ai": "Vertex AI", "gateway": "AI API Gateway",
  "compute-default-credentials": "Google Cloud", "cloud-shell": "Google Cloud Shell" };

// Is a GEMINI_API_KEY set somewhere Gemini CLI looks (the environment, or a .env file it reads)? Only "is it there".
function hasKeyIn(file) { try { return /^\s*(export\s+)?GEMINI_API_KEY\s*=\s*\S/m.test(fs.readFileSync(file, "utf8")); } catch { return false; } }
function envMethod(env, dir) {
  if (env.GEMINI_API_KEY || hasKeyIn(path.join(dir, ".env")) || hasKeyIn(path.join(path.dirname(dir), ".env"))) return "gemini-api-key";
  if (/^(true|1)$/i.test(env.GOOGLE_GENAI_USE_VERTEXAI || "")) return "vertex-ai";
  if (/^(true|1)$/i.test(env.GOOGLE_GENAI_USE_GCA || "")) return "oauth-personal";
  if (env.GOOGLE_GEMINI_BASE_URL) return "gateway";
  return null;
}

// How Gemini CLI is logged in, without asking it (no process, no network). Same rules Gemini CLI uses: the way
// chosen in its settings, else what the environment says.
function authSync(env = process.env) {
  const dir = geminiDir(env);
  const settings = readJsonc(path.join(dir, "settings.json"));
  const selected = (settings.security && settings.security.auth && settings.security.auth.selectedType) || settings.selectedAuthType || null;
  const type = selected || envMethod(env, dir);
  let loggedIn = !!type, email = null;
  if (type === "oauth-personal") {
    // The Google login is saved in oauth_creds.json (or, if you asked Gemini CLI for that, in encrypted storage
    // Kural can't see into: then it's taken as there).
    loggedIn = fs.existsSync(path.join(dir, "oauth_creds.json")) || env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE === "true";
    try { email = JSON.parse(fs.readFileSync(path.join(dir, "google_accounts.json"), "utf8")).active || null; } catch { /* no account file */ }
  }
  // (An API key chosen in Gemini CLI itself may be in the system keychain, which Kural doesn't read: the test says.)
  return { loggedIn, method: type ? METHODS[type] || type : null, type, selected, email };
}

// What would make a new Gemini process fail to log in, known before starting it. Only the case where Gemini CLI would
// otherwise open a browser login by itself (Google login chosen, but none saved): Kural must not do that silently.
function authProblem(env) {
  const a = authSync(env);
  return a.type === "oauth-personal" && !a.loggedIn ? NOT_LOGGED_IN : null;
}

// ---------- starting the gemini program ----------

// `gemini` is a Node script (npm's link to bundle/gemini.js). Run it with a Node we can find, not through its
// "#!/usr/bin/env node" line: Kural opened from the Dock doesn't have nvm's node on PATH. Last resort: Kural's own
// executable as Node (ELECTRON_RUN_AS_NODE), like the team board does.
function launch(bin) {
  let real = bin;
  try { real = fs.realpathSync(bin); } catch { /* as given */ }
  if (!/\.(c|m)?js$/i.test(real)) return { cmd: bin, args: [], env: {} };
  const exe = IS_WIN ? "node.exe" : "node";
  const dirs = [path.dirname(bin), path.dirname(real), ...(process.env.PATH || "").split(path.delimiter)].filter(Boolean);
  for (const d of dirs) { const n = path.join(d, exe); if (isFile(n)) return { cmd: n, args: [real], env: {} }; }
  return { cmd: process.execPath, args: [real], env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {} };
}
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// npm on Windows puts a gemini.cmd wrapper on PATH. Windows can't start .cmd files without a shell, so find the
// script it runs ("%dp0%\node_modules\@google\gemini-cli\bundle\gemini.js") and run that with Node.
function cmdTarget(cmdFile) {
  let text; try { text = fs.readFileSync(cmdFile, "utf8"); } catch { return null; }
  const m = /"%~?dp0%?\\?([^"%]+\.(?:c|m)?js)"/i.exec(text);
  const p = m && path.join(path.dirname(cmdFile), ...m[1].split(/[\\/]/));
  return p && isFile(p) ? p : null;
}
function usable(p) {
  if (!p || !isFile(p)) return null;
  if (/\.cmd$/i.test(p)) return cmdTarget(p);
  return p;
}

function run(cmd, args, { timeout = 20000, env, cwd } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, env: { ...process.env, ...(env || {}) }, cwd, windowsHide: true, maxBuffer: 4 << 20 },
        (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stdout: String(stdout || ""), stderr: String(stderr || ""), error: err }));
    } catch (e) { resolve({ code: -1, stdout: "", stderr: e.message, error: e }); }
  });
}
const runGemini = (bin, args, opts = {}) => { const l = launch(bin); return run(l.cmd, [...l.args, ...args], { ...opts, env: { ...l.env, ...(opts.env || {}) } }); };

// Where is gemini? The path you chose (setting) first, then the usual places, then npm's own global folder and
// (Mac, Linux) your shell's PATH. Async: asking npm or the shell takes a moment.
async function findGemini(chosenPath) {
  const home = os.homedir();
  const expand = (p) => p.replace(/^~(?=$|[\\/])/, home);
  if (chosenPath && String(chosenPath).trim()) { const p = usable(expand(String(chosenPath).trim())); if (p) return p; }
  const names = IS_WIN ? ["gemini.cmd", "gemini.exe", "gemini"] : ["gemini"];
  const dirs = [...(process.env.PATH || "").split(path.delimiter)];
  if (IS_WIN) dirs.push(path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"));
  else dirs.push(path.join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(home, ".npm-global/bin"), path.join(home, ".volta/bin"), path.join(home, ".bun/bin"));
  // nvm installs (newest Node first)
  const nvm = path.join(home, ".nvm", "versions", "node");
  try { for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, "bin")); } catch { /* no nvm */ }
  const look = (list) => { for (const d of list) for (const n of names) { if (!d) continue; const p = usable(path.join(d, n)); if (p) return p; } return null; };
  let found = look(dirs);
  if (found) return found;
  const npm = await run(IS_WIN ? "npm.cmd" : "npm", ["config", "get", "prefix"], { timeout: 8000 });
  const prefix = npm.code === 0 && npm.stdout.trim();
  if (prefix) { found = look([IS_WIN ? prefix : path.join(prefix, "bin")]); if (found) return found; }
  if (!IS_WIN && process.env.SHELL) {
    // -i -l: an interactive login shell reads ~/.zshrc / ~/.bashrc too, where nvm adds to PATH.
    const sh = await run(process.env.SHELL, ["-ilc", "command -v gemini"], { timeout: 6000 });
    const line = sh.stdout.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("/")).pop();
    if (line) return usable(line);
  }
  return null;
}

async function geminiVersion(bin) {
  if (!bin) return null;
  const r = await runGemini(bin, ["--version"], { timeout: 30000 });
  const m = /\d+\.\d+\.\d+[\w.-]*/.exec(r.stdout);
  return r.code === 0 && m ? m[0] : null;
}

// { loggedIn, method ("Google account" / "API key" / "Vertex AI"…), email }. From Gemini CLI's files and the
// environment: whether things exist, and the account's email address it saved. No tokens are read.
async function geminiAuth(_bin, env = process.env) {
  const a = authSync(env);
  return { loggedIn: a.loggedIn, method: a.method, email: a.email, type: a.type };
}

// What Gemini CLI's own "/auth signout" does: delete the saved Google login, mark the account as no longer active,
// and forget the chosen login way in its settings (so the next start asks again).
async function geminiLogout(env = process.env) {
  const dir = geminiDir(env);
  await fs.promises.rm(path.join(dir, "oauth_creds.json"), { force: true }).catch(() => {});
  const accounts = path.join(dir, "google_accounts.json");
  try {
    const a = JSON.parse(fs.readFileSync(accounts, "utf8"));
    if (a.active) {
      a.old = Array.isArray(a.old) ? a.old : [];
      if (!a.old.includes(a.active)) a.old.push(a.active);
      a.active = null;
      fs.writeFileSync(accounts, JSON.stringify(a, null, 2));
    }
  } catch { /* no account file */ }
  // Only when settings.json is plain JSON: rewriting a file with comments would lose them.
  const sf = path.join(dir, "settings.json");
  try {
    const s = JSON.parse(fs.readFileSync(sf, "utf8"));
    if (s.security && s.security.auth && s.security.auth.selectedType !== undefined) {
      delete s.security.auth.selectedType;
      fs.writeFileSync(sf, JSON.stringify(s, null, 2));
    }
  } catch { /* no settings, or with comments */ }
  return { ok: true };
}

// The command a terminal runs to log in: plain `gemini` shows its login screen when it isn't logged in yet.
// (Windows: Kural's terminal is PowerShell, which runs a quoted program with "&".)
function loginCommand(bin) {
  const l = launch(bin || "gemini");
  const q = (s) => (/^[\w./:\\-]+$/.test(s) ? s : IS_WIN ? `"${s}"` : `'${s.replace(/'/g, "'\\''")}'`);
  const line = [l.cmd, ...l.args].map(q).join(" ");
  const env = Object.entries(l.env).map(([k, v]) => IS_WIN ? `$env:${k}="${v}"; ` : `${k}=${v} `).join("");
  return IS_WIN ? `${env}& ${line}` : `${env}${line}`;
}

// ---------- the JSON-RPC connection to `gemini --acp` ----------

class Rpc {
  // handlers: onRequest(msg) (Gemini asks Kural something), onNotify(msg), onExit(code)
  constructor(bin, args, { cwd, env }, handlers) {
    const l = launch(bin);
    this.h = handlers || {};
    this.waits = new Map();
    this.ids = 0;
    this.stderr = "";
    this.closed = false;
    // Its own process group (not on Windows): Gemini CLI restarts itself as a child process, and stopping only the
    // parent left that child running (a cancelled login could still finish).
    this.proc = spawn(l.cmd, [...l.args, ...args], { cwd, env: { ...process.env, ...l.env, ...(env || {}) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: !IS_WIN });
    let buf = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) this.line(line); }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (d) => { this.stderr = (this.stderr + d).slice(-8000); });
    this.proc.stdin.on("error", () => { /* it stopped; "exit" says so */ });
    this.proc.on("error", (e) => { this.stderr += `\n${e.message}`; this.close(-1); });
    this.proc.on("exit", (code) => this.close(code));
  }

  line(text) {
    let m; try { m = JSON.parse(text); } catch { return; }   // (not ours: a stray log line)
    if (m.method && m.id !== undefined) { if (this.h.onRequest) this.h.onRequest(m); }
    else if (m.method) { if (this.h.onNotify) this.h.onNotify(m); }
    else if (this.waits.has(m.id)) {
      const w = this.waits.get(m.id);
      this.waits.delete(m.id);
      if (m.error) w.reject(rpcError(m.error)); else w.resolve(m.result || {});
    }
  }

  write(obj) { if (this.closed) return; try { this.proc.stdin.write(JSON.stringify(obj) + "\n"); } catch { /* stopped */ } }
  call(method, params) {
    if (this.closed) return Promise.reject(new Error("Gemini isn't running."));
    const id = ++this.ids;
    return new Promise((resolve, reject) => { this.waits.set(id, { resolve, reject }); this.write({ jsonrpc: "2.0", id, method, params }); });
  }
  notify(method, params) { this.write({ jsonrpc: "2.0", method, params }); }
  respond(id, result) { this.write({ jsonrpc: "2.0", id, result }); }
  fail(id, code, message) { this.write({ jsonrpc: "2.0", id, error: { code, message } }); }

  close(code) {
    if (this.closed) return;
    this.closed = true;
    const err = new Error(`Gemini stopped${code ? ` (exit code ${code})` : ""}.`);
    for (const w of this.waits.values()) w.reject(err);
    this.waits.clear();
    if (this.h.onExit) this.h.onExit(code);
  }
  kill() {
    if (this.killed) return;
    this.killed = true;
    try { this.proc.stdin.end(); } catch { /* */ }
    const pid = this.proc.pid;
    const group = (sig) => { try { if (!IS_WIN && pid) process.kill(-pid, sig); else this.proc.kill(sig); } catch { /* gone */ } };
    group("SIGTERM");
    // Waiting for a login, Gemini ignores SIGTERM: make sure after 2 s.
    if (!IS_WIN) setTimeout(() => group("SIGKILL"), 2000).unref();
    else if (pid) execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
  }
}

// A JSON-RPC error → an Error with Gemini's words ("Internal error" comes with the real reason in data.details).
function rpcError(e) {
  const details = e && e.data && (e.data.details || e.data.message);
  const err = new Error([e && e.message, details].filter(Boolean).join(": ") || "Gemini answered with an error.");
  err.code = e && e.code;
  err.login = LOGIN_RE.test(err.message);
  return err;
}

const CLIENT = { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: "kural", title: "Kural Code Editor", version: "1" } };
const READ_ONLY = new Set(["plan", "ask"]);

// ---------- the agent ----------

class GeminiAgent {
  // opts: name, bin, model ("" = Gemini CLI's own choice), effort (Gemini CLI has no setting for it over ACP),
  //   mode ("agent" | "auto" | "plan" | "ask"), cwd, addDirs, appendSystemPrompt, sessionId / resume (Kural's id),
  //   store (folder for the Kural id → Gemini id list), env.
  // handlers: onMessage(msg), onPermission(req) -> Promise<{allow, message?, updatedInput?}>, onExit({code, login, stderr})
  constructor(opts, handlers) {
    this.opts = { ...opts };
    this.h = handlers || {};
    this.model = opts.model || "";
    this.mode = opts.mode || "agent";
    this.sessionId = opts.resume || opts.sessionId || crypto.randomUUID();   // Kural's id for this conversation
    this.gid = null;                                                          // Gemini's id for it
    this.exited = false;
    this.connected = false;
    this.queue = [];
    this.busy = false;
    this.turn = null;
    this.perms = new Set();      // permission questions waiting for an answer
  }

  cwd() { return this.opts.cwd || process.cwd(); }
  env() { return { ...process.env, ...(this.opts.env || {}) }; }
  readOnly() { return READ_ONLY.has(this.mode); }

  emit(m) { if (this.exited) return; try { this.h.onMessage && this.h.onMessage({ session_id: this.sessionId, ...m }); } catch (e) { /* the chat logs its own errors */ } }

  start() {
    if (!this.opts.bin || !isFile(this.opts.bin)) return false;
    // (On the next tick: a message sent right after start() is then waiting, and a failed start can answer it.)
    setImmediate(() => this.connect());
    return true;
  }

  // Start gemini, say hello, open (or reopen) the conversation, set its mode and model. Messages sent meanwhile wait.
  async connect() {
    try {
      const problem = authProblem(this.env());
      if (problem) throw Object.assign(new Error(problem), { login: true });
      const args = ["--acp", "--approval-mode", this.readOnly() ? "plan" : "default", "--skip-trust"];
      // --skip-trust: you opened this folder in Kural, so it's trusted (else Gemini CLI refuses to work in it).
      // --approval-mode default: every edit and command comes to Kural as a question, whatever Gemini's settings say.
      for (const d of this.opts.addDirs || []) args.push("--include-directories", d);
      this.rpc = new Rpc(this.opts.bin, args, { cwd: this.cwd(), env: this.opts.env }, {
        onRequest: (m) => this.onRequest(m),
        onNotify: (m) => { if (m.method === "session/update") this.onUpdate(m.params || {}); },
        onExit: (code) => this.onProcessExit(code),
      });
      const init = await this.rpc.call("initialize", CLIENT);
      const caps = init.agentCapabilities || {};
      let res = null;
      const saved = this.opts.resume ? this.lookup() : null;
      if (saved && caps.loadSession) {
        try {
          await this.authenticate(init);
          res = await this.rpc.call("session/load", { sessionId: saved, cwd: this.cwd(), mcpServers: this.mcp() });
          this.gid = saved;
          this.primed = true;   // Kural's instructions are already in that conversation
        } catch (e) {
          if (e.login) throw e;
          res = null;           // gone (deleted, another folder): carry on in a new conversation
        }
      }
      if (!this.gid) {
        res = await this.newSession(init);
        this.gid = res.sessionId;
        this.primed = false;
        this.remember();
      }
      const want = this.readOnly() ? "plan" : "default";
      if (res.modes && res.modes.currentModeId !== want) await this.rpc.call("session/set_mode", { sessionId: this.gid, modeId: want }).catch(() => {});
      if (this.model) await this.rpc.call("session/set_model", { sessionId: this.gid, modelId: this.model }).catch(() => {});
      this.connected = true;
      const shown = this.model || (res.models && res.models.currentModelId) || "gemini";
      this.emit({ type: "system", subtype: "init", model: shown, tools: [], mcp_servers: [] });
      this.next();
    } catch (e) {
      this.failStart(e);
    }
  }

  // A new conversation. If Gemini says it needs a login and the environment has a key, log in with that and try once
  // more (never the Google way: that would open a browser).
  async newSession(init) {
    const params = { cwd: this.cwd(), mcpServers: this.mcp() };
    try { return await this.rpc.call("session/new", params); }
    catch (e) {
      if (!e.login || !(await this.authenticate(init))) throw e;
      return this.rpc.call("session/new", params);
    }
  }

  // Tell Gemini which login to use, only when its settings don't name one and the environment does (an API key,
  // Vertex). Calling it with a different way than the one chosen would make Gemini CLI delete the saved Google login.
  async authenticate(init) {
    const env = this.env();
    const a = authSync(env);
    if (a.selected) return false;
    const method = envMethod(env, geminiDir(env));
    if (!method || method === "oauth-personal") return false;
    if (!(init.authMethods || []).some((m) => m.id === method)) return false;
    await this.rpc.call("authenticate", { methodId: method });
    return true;
  }

  // Couldn't start: answer a waiting message with the reason, then stop.
  failStart(e) {
    if (this.exited) return;
    const login = !!(e && e.login);
    const text = login ? NOT_LOGGED_IN : friendly(e);
    if (this.queue.length) {
      this.queue = [];
      this.emit({ type: "result", subtype: "error", is_error: true, result: text, duration_ms: 0 });
    }
    this.finish({ code: login ? 1 : -1, login, stderr: login ? text : this.tail(e) });
  }

  tail(e) { return `${(e && e.message) || ""}\n${(this.rpc && this.rpc.stderr) || ""}`.trim().slice(-2000); }

  // Kural's id → Gemini's id, in a small JSON file in the store folder (so "resume" can reopen it).
  mapFile() { return this.opts.store ? path.join(this.opts.store, "gemini-sessions.json") : null; }
  lookup() {
    const f = this.mapFile();
    if (!f) return null;
    try { const e = JSON.parse(fs.readFileSync(f, "utf8"))[this.sessionId]; return e && e.gemini; } catch { return null; }
  }
  remember() {
    const f = this.mapFile();
    if (!f) return;
    try {
      let all = {};
      try { all = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* first one */ }
      all[this.sessionId] = { gemini: this.gid, cwd: this.cwd(), at: Date.now() };
      // Keep the newest 500: old chats' ids aren't worth a growing file.
      const keep = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 500);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(Object.fromEntries(keep)));
    } catch { /* best effort */ }
  }

  // Your message: a string, or Claude-style blocks (text and images).
  send(content) {
    if (this.exited) return;
    this.queue.push(content);
    if (this.connected && !this.busy) this.next();
  }

  // Claude-style blocks → ACP blocks. Kural's instructions go before the first message of a conversation:
  // ACP has no place for a system prompt of our own.
  toPrompt(content) {
    const blocks = [];
    for (const b of typeof content === "string" ? [{ type: "text", text: content }] : content || []) {
      if (!b) continue;
      if (b.type === "text" && b.text) blocks.push({ type: "text", text: b.text });
      else if (b.type === "image" && b.source && b.source.data) blocks.push({ type: "image", mimeType: b.source.media_type || "image/png", data: b.source.data });
      // A PDF goes the same way as a picture (inline data with its type): Gemini reads PDFs given like that.
      else if (b.type === "document" && b.source && b.source.data && b.source.type === "base64") blocks.push({ type: "image", mimeType: b.source.media_type || "application/pdf", data: b.source.data });
      else if (b.type === "document" && b.source && b.source.type === "text") blocks.push({ type: "text", text: b.source.data || "" });
    }
    if (!this.primed && this.opts.appendSystemPrompt) {
      blocks.unshift({ type: "text", text: `<kural_instructions>\n${this.opts.appendSystemPrompt}\n</kural_instructions>\n\n` });
    }
    return blocks;
  }

  async next() {
    if (this.busy || !this.connected || this.exited) return;
    const content = this.queue.shift();
    if (content === undefined) return;
    this.busy = true;
    this.stopped = false;
    const t0 = Date.now();
    this.turn = { text: "", segment: "", block: null, tools: new Map() };
    let result;
    try {
      const res = await this.rpc.call("session/prompt", { sessionId: this.gid, prompt: this.toPrompt(content) });
      this.primed = true;
      this.closeBlock();
      this.reportUsage(res);
      if (this.stopped || res.stopReason === "cancelled") result = { type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped." };
      else {
        const said = (this.turn.segment.trim() || this.turn.text.trim());
        const why = { max_turn_requests: "Gemini stopped: too many steps in one answer.", max_tokens: "Gemini stopped: the conversation is too long for the model.",
          refusal: "Gemini declined to answer." }[res.stopReason];
        result = { type: "result", subtype: "success", is_error: false, result: why ? `${said}\n\n(${why})`.trim() : said };
      }
    } catch (e) {
      this.closeBlock();
      result = this.stopped
        ? { type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped." }
        : { type: "result", subtype: "error", is_error: true, result: e.login ? NOT_LOGGED_IN : friendly(e) };
    }
    // Tools that never reported back (stopped, failed): close their cards.
    for (const t of this.turn.tools.values()) if (!t.done) this.toolResult(t, "Stopped.", true);
    this.turn = null;
    this.busy = false;
    if (this.exited) return;
    this.emit({ duration_ms: Date.now() - t0, ...result });
    this.next();
  }

  // Gemini reports what each answer used: { _meta: { quota: { token_count: { input_tokens, output_tokens } } } }.
  reportUsage(res) {
    const t = res && res._meta && res._meta.quota && res._meta.quota.token_count;
    if (!t) return;
    const input = Number(t.input_tokens) || 0, output = Number(t.output_tokens) || 0;
    if (input || output) usage.report("gemini", { tokens: { input, output } });
  }

  // ---------- what Gemini streams ----------

  onUpdate(p) {
    // Only during an answer: reopening a conversation replays its history, which the chat already shows.
    if (!this.turn || p.sessionId !== this.gid) return;
    const u = p.update || {};
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const t = u.content && u.content.type === "text" ? u.content.text : "";
        if (!t || /^\[MODE_UPDATE\] \w+$/.test(t)) return;   // (Gemini's note that the mode changed: not part of the answer)
        this.open("text");
        this.turn.text += t; this.turn.segment += t;
        this.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
        return;
      }
      case "agent_thought_chunk": {
        let t = u.content && u.content.type === "text" ? u.content.text : "";
        if (!t) return;
        // Gemini sends each thought whole ("**Subject**\ndetails"): keep them apart.
        if (this.turn.block === "thinking") t = `\n\n${t}`;
        this.open("thinking");
        this.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: t } } });
        return;
      }
      case "tool_call": this.toolCall(u); return;
      case "tool_call_update": {
        const t = this.turn.tools.get(u.toolCallId) || this.toolCall(u);
        if ((u.status === "completed" || u.status === "failed") && !t.done) this.toolResult(t, resultText(u.content) || (u.status === "failed" ? "Failed." : "Done."), u.status === "failed");
        return;
      }
      default: return;   // plan, available commands, mode changes, history replay: nothing the chat shows
    }
  }

  open(type) {
    if (this.turn.block === type) return;
    this.closeBlock();
    this.turn.block = type;
    this.emit({ type: "stream_event", event: { type: "content_block_start", content_block: { type } } });
  }
  closeBlock() {
    if (!this.turn || !this.turn.block) return;
    this.emit({ type: "stream_event", event: { type: "content_block_stop" } });
    this.turn.block = null;
  }

  // A tool Gemini starts → a tool_use the chat knows (Bash, Edit, Read…).
  toolCall(u) {
    const known = this.turn.tools.get(u.toolCallId);
    if (known) return known;
    this.closeBlock();
    this.turn.segment = "";   // the final answer is what comes after the last tool
    const d = describe(u, this.cwd());
    const t = { id: String(u.toolCallId || `gemini_${crypto.randomUUID()}`), kind: u.kind, name: d.name, input: d.input, done: false };
    this.turn.tools.set(u.toolCallId, t);
    this.emit({ type: "assistant", message: { role: "assistant", model: this.model || "gemini", content: [{ type: "tool_use", id: t.id, name: t.name, input: t.input }] } });
    if (u.status === "completed" || u.status === "failed") this.toolResult(t, resultText(u.content) || "Done.", u.status === "failed");
    return t;
  }

  toolResult(t, text, isError) {
    t.done = true;
    this.emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t.id, content: text, is_error: !!isError }] } });
  }

  // ---------- Gemini asks before it acts ----------

  onRequest(m) {
    if (m.method !== "session/request_permission") { this.rpc.fail(m.id, -32601, `Kural doesn't offer ${m.method}.`); return; }
    const entry = { id: m.id, done: false };
    this.perms.add(entry);
    this.permission(m.params || {}).catch(() => ({ outcome: "cancelled" })).then((outcome) => this.answer(entry, outcome));
  }

  answer(entry, outcome) {
    if (entry.done) return;   // (already answered "cancelled" by Stop)
    entry.done = true;
    this.perms.delete(entry);
    if (this.rpc) this.rpc.respond(entry.id, { outcome });
  }

  // Kural decides: edits are allowed (after Kural keeps a copy of each file, for Undo), commands and web pages ask
  // you in Agent mode. Gemini offers "allow once", "always", "reject": Kural only ever picks once or reject, so every
  // later action comes back to Kural too.
  async permission(p) {
    const tc = p.toolCall || {};
    const options = p.options || [];
    const pick = (kind, fallback) => (options.find((o) => o.kind === kind) || {}).optionId || fallback;
    const yes = { outcome: "selected", optionId: pick("allow_once", "proceed_once") };
    const no = { outcome: "selected", optionId: pick("reject_once", "cancel") };
    if (this.stopped || !this.turn || this.exited) return { outcome: "cancelled" };
    const t = this.turn.tools.get(tc.toolCallId) || this.toolCall(tc);
    const kind = tc.kind || t.kind;
    if (kind === "switch_mode") return no;   // Kural switches modes itself (Plan → "Build it")
    if (kind === "edit" || kind === "delete" || kind === "move") {
      if (this.readOnly()) return no;
      // Ask about every file before Gemini touches it: the chat snapshots it then, so Undo can bring it back.
      const files = [...new Set([...(tc.content || []).filter((c) => c && c.type === "diff" && c.path).map((c) => c.path),
        ...(tc.locations || []).map((l) => l && l.path).filter(Boolean)].map((f) => path.resolve(this.cwd(), f)))];
      if (!files.length && t.input && t.input.file_path) files.push(t.input.file_path);
      for (const f of files) {
        const ans = await this.ask({ tool_name: fs.existsSync(f) ? "Edit" : "Write", input: { file_path: f }, tool_use_id: t.id });
        if (!ans.allow || this.stopped) return no;
      }
      return yes;
    }
    if (kind === "execute") {
      if (this.readOnly()) return no;
      const ans = await this.ask({ tool_name: "Bash", input: { command: t.input.command, description: t.input.description || "" }, tool_use_id: t.id });
      return ans.allow && !this.stopped ? yes : no;
    }
    // Gemini's own question tool can't carry your answer back over ACP: say no, so it asks in plain words instead.
    if (/^Asking user:/.test(tc.title || "")) return no;
    const ans = await this.ask({ tool_name: t.name, input: t.input, tool_use_id: t.id });
    return ans.allow && !this.stopped ? yes : no;
  }

  async ask(req) {
    if (!this.h.onPermission) return { allow: false };
    try { return (await this.h.onPermission(req)) || { allow: false }; } catch (e) { return { allow: false, message: e.message }; }
  }

  // ---------- control ----------

  setModel(m) {
    this.model = m || "";
    if (this.connected && this.gid && this.model) this.rpc.call("session/set_model", { sessionId: this.gid, modelId: this.model }).catch(() => {});
  }
  request(req) { return Promise.resolve(req && req.subtype === "mcp_status" ? { mcpServers: [] } : {}); }

  // opts.mcpServers ({ name: { command, args, env } }, Kural's device tools) in ACP's shape.
  mcp() {
    return Object.entries(this.opts.mcpServers || {}).filter(([, v]) => v && v.command)
      .map(([name, v]) => ({ name, command: v.command, args: (v.args || []).map(String), env: Object.entries(v.env || {}).map(([k, val]) => ({ name: k, value: String(val) })) }));
  }
  control() { return null; }

  // Stop: questions waiting for you are answered "cancelled", and Gemini is told to stop (a notification in ACP).
  interrupt() {
    this.stopped = true;
    for (const e of [...this.perms]) this.answer(e, { outcome: "cancelled" });
    if (this.busy && this.gid && this.rpc) this.rpc.notify("session/cancel", { sessionId: this.gid });
  }

  kill() {
    if (this.exited) return;
    this.interrupt();
    this.finish({ code: 0, login: false, stderr: "" });
  }

  finish(info) {
    if (this.exited) return;
    this.exited = true;
    this.connected = false;
    if (this.rpc) this.rpc.kill();
    setImmediate(() => this.h.onExit && this.h.onExit(info));
  }

  // gemini stopped by itself.
  onProcessExit(code) {
    if (this.exited) return;
    this.finish({ code, login: false, stderr: ((this.rpc && this.rpc.stderr) || "").slice(-2000) });
  }
}

// ---------- ACP tool call → the chat's tool names ----------

// ACP tells us a tool's kind, title, file locations and (for edits) the change, not Gemini's own tool name or
// arguments. These are Gemini CLI's titles: a command's title is the command, a search's is "'pattern' in *.js
// within src", a web search's is 'Searching the web for: "…"', a fetch's "Fetching content from: <url>".
function describe(tc, cwd) {
  const title = String(tc.title || "");
  const abs = (p) => (p ? path.resolve(cwd, p) : "");
  const loc = (tc.locations || []).find((l) => l && l.path);
  const diff = (tc.content || []).find((c) => c && c.type === "diff");
  const note = textOf(tc.content);
  const web = /^Searching the web for: "?(.*?)"?$/.exec(title);
  if (web) return { name: "WebSearch", input: { query: web[1] } };
  switch (tc.kind) {
    case "read":
      return loc ? { name: "Read", input: { file_path: abs(loc.path) } } : { name: "Glob", input: { pattern: title } };
    case "edit": case "delete": {
      const file = abs((diff && diff.path) || (loc && loc.path) || title.replace(/^(Writing to|Create)\s+/, "").split(":")[0]);
      if (!fs.existsSync(file)) return { name: "Write", input: { file_path: file, ...(diff ? { content: diff.newText || "" } : {}) } };
      return { name: "Edit", input: { file_path: file, ...(diff ? changedPart(diff.oldText || "", diff.newText || "") : {}) } };
    }
    case "execute": {
      const why = /\(([^)]*)\)/.exec(note);
      return { name: "Bash", input: { command: title, description: why ? why[1] : "" } };
    }
    case "fetch": {
      const url = /https?:\/\/\S+/.exec(`${title} ${note}`);
      return { name: "WebFetch", input: { url: url ? url[0].replace(/["'),.]+$/, "") : title } };
    }
    case "search": {
      const m = /^'(.*)'(?: in (\S+))?(?: within (.+))?$/.exec(title);
      if (!m) return { name: "Grep", input: { pattern: title } };
      const dir = m[3] && m[3] !== "./" ? abs(m[3]) : undefined;
      if (!m[2] && /[*?{[]/.test(m[1])) return { name: "Glob", input: { pattern: m[1], ...(dir ? { path: dir } : {}) } };
      return { name: "Grep", input: { pattern: m[1], ...(m[2] ? { glob: m[2] } : {}), ...(dir ? { path: dir } : {}) } };
    }
    case "think":
      return { name: "mcp__gemini__agent", input: { task: title } };
    default: {
      // MCP tools and others: "tool_name(arg: value, …)". ACP doesn't say which MCP server, so "gemini" stands in.
      const m = /^([\w.-]+)\(([\s\S]*)\)$/.exec(title);
      if (m) return { name: `mcp__gemini__${m[1]}`, input: { args: m[2] } };
      return { name: `mcp__gemini__${(title.split(/\s/)[0] || "tool").replace(/[^\w.-]/g, "") || "tool"}`, input: { title } };
    }
  }
}

// Only the lines that changed (Gemini sends the whole file before and after): the chat shows "+3 −1".
function changedPart(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  return { old_string: A.slice(s, A.length - e).join("\n"), new_string: B.slice(s, B.length - e).join("\n") };
}

const textOf = (content) => (content || []).map((c) => (c && c.type === "content" && c.content && c.content.type === "text" ? c.content.text : "")).filter(Boolean).join("\n");

function resultText(content) {
  const parts = (content || []).map((c) => {
    if (!c) return "";
    if (c.type === "content" && c.content && c.content.type === "text") return c.content.text;
    if (c.type === "diff") return `${c.oldText ? "Changed" : "Created"} ${c.path}`;
    return "";
  }).filter(Boolean);
  const s = parts.join("\n");
  return s.length > MAX_RESULT ? `${s.slice(0, MAX_RESULT)}\n… (shortened)` : s;
}

function friendly(e) {
  const s = String((e && e.message) || e || "");
  // Since 26 Sept 2026 Gemini CLI refuses personal Google accounts and points to Antigravity.
  if (/no longer supported for Gemini Code Assist for individuals|migrate to the Antigravity/i.test(s))
    return "Google no longer lets personal Google accounts use Gemini CLI (since 26 Sept 2026). Use Antigravity instead: Get started → Antigravity, with the same Google account. (Gemini CLI still works with a Gemini API key or a company account.)";
  if ((e && e.login) || LOGIN_RE.test(s)) return NOT_LOGGED_IN;
  if (/\b429\b|rate limit|quota|resource_exhausted/i.test(s)) return `Gemini's usage limit was reached. Try again later, or pick another Gemini model. (${s})`;
  if (/ENOENT|spawn/i.test(s)) return "Kural can't start the gemini program. Check that Gemini CLI is installed (npm install -g @google/gemini-cli).";
  return `Gemini: ${s}`;
}

// ---------- one-off helpers ----------

// The Gemini models your login can use (from a new conversation's list), or [] if Gemini can't start or log in.
async function geminiModels(bin, { cwd, env } = {}) {
  if (!bin || authProblem({ ...process.env, ...(env || {}) })) return [];
  const rpc = new Rpc(bin, ["--acp", "--skip-trust"], { cwd: cwd || quietDir(), env }, { onRequest: (m) => rpc.fail(m.id, -32601, "No.") });
  try {
    await withTimeout(rpc.call("initialize", CLIENT), 60000);
    const res = await withTimeout(rpc.call("session/new", { cwd: cwd || quietDir(), mcpServers: [] }), 60000);
    const m = res.models || {};
    return (m.availableModels || []).map((x) => ({ id: x.modelId, label: x.name || x.modelId, description: x.description || "", isDefault: x.modelId === m.currentModelId }));
  } catch { return []; } finally { rpc.kill(); }
}

// One question, one answer (inline edits, commit messages): a short conversation in Gemini's read-only mode, and
// every tool it would use that changes something is refused. Resolves the answer text; rejects with an Error
// (`.login` true when Gemini isn't logged in).
function askGemini(bin, { model, system, prompt, cwd, signal, env } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const end = (err, text) => { if (done) return; done = true; agent.kill(); if (err) reject(err); else resolve(text); };
    const agent = new GeminiAgent({ name: "ask", bin, model: model || "", mode: "ask", cwd: cwd || quietDir(), appendSystemPrompt: system || "", env }, {
      onMessage: (m) => {
        if (m.type !== "result") return;
        if (m.is_error) end(Object.assign(new Error(m.result || "Gemini didn't answer."), { login: m.result === NOT_LOGGED_IN, stopped: m.subtype === "error_during_execution" }));
        else end(null, m.result || "");
      },
      onPermission: async () => ({ allow: false, message: "Not here." }),
      onExit: (info) => end(Object.assign(new Error(info.login ? NOT_LOGGED_IN : `Gemini stopped. ${info.stderr || ""}`.trim()), { login: !!info.login })),
    });
    if (signal) {
      if (signal.aborted) { end(Object.assign(new Error("Stopped."), { name: "AbortError", stopped: true })); return; }
      signal.addEventListener("abort", () => { agent.interrupt(); end(Object.assign(new Error("Stopped."), { name: "AbortError", stopped: true })); }, { once: true });
    }
    if (!agent.start()) { end(new Error("Kural can't find the gemini program.")); return; }
    agent.send(prompt || "");
  });
}

// Get started's test: one tiny question. { ok, ms, answer } or { ok: false, error, login }.
async function geminiTest(bin, { cwd, model, env } = {}) {
  const t0 = Date.now();
  try {
    const answer = await askGemini(bin, { model, cwd, env, prompt: "Reply with just the word OK." });
    return { ok: true, ms: Date.now() - t0, answer: answer.trim() };
  } catch (e) {
    return { ok: false, error: e.message, login: !!e.login };
  }
}

// Log in with Google without a terminal. In a terminal, Gemini CLI first shows a login menu and a "continue? [Y/n]"
// question, and opens the browser only after both (easy to miss). Through ACP it's one request: "authenticate" with
// the Google way. Gemini then opens the login page and waits (up to 5 minutes) until the browser comes back to it.
// To be sure the page opens, Kural hands Gemini its own "open" / "xdg-open" (a tiny script first on PATH that gives
// Kural the address), and opens it with openUrl(url). Windows: Gemini opens it itself.
// Resolves { ok } or { error } or { cancelled }.
async function geminiLogin(bin, { openUrl, signal, dir, timeout = 6 * 60 * 1000 } = {}) {
  const env = {};
  // Gemini prints a code to paste instead of opening a browser when it thinks there's no screen (CI, SSH,
  // DEBIAN_FRONTEND=noninteractive, NO_BROWSER): through ACP that waits for input that never comes.
  for (const k of ["CI", "NO_BROWSER", "DEBIAN_FRONTEND", "SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"]) env[k] = "";
  let urls = null, shim = null;
  if (!IS_WIN && openUrl) {
    try {
      // A new private folder (0700) each time: in a shared /tmp another user could otherwise put their own "open" there.
      shim = fs.mkdtempSync(path.join(dir || os.tmpdir(), "kural-open-"));
      urls = path.join(shim, "urls.txt");
      fs.writeFileSync(urls, "", { mode: 0o600 });
      const quoted = `'${urls.replace(/'/g, "'\\''")}'`;
      const script = `#!/bin/sh\nfor a in "$@"; do last="$a"; done\nprintf '%s\\n' "$last" >> ${quoted}\n`;
      for (const n of ["open", "xdg-open"]) fs.writeFileSync(path.join(shim, n), script, { mode: 0o700 });
      env.PATH = `${shim}${path.delimiter}${process.env.PATH || ""}`;
    } catch { urls = null; }
  }
  const rpc = new Rpc(bin, ["--acp", "--skip-trust"], { cwd: quietDir(), env }, { onRequest: (m) => rpc.fail(m.id, -32601, "No.") });
  let poll = null, timer = null, opened = 0;
  const flush = () => {
    if (!urls) return;
    let lines = []; try { lines = fs.readFileSync(urls, "utf8").split("\n").filter((l) => /^https?:\/\//.test(l)); } catch { /* not yet */ }
    for (; opened < lines.length; opened++) openUrl(lines[opened]);
  };
  // From the start: if Gemini's settings already say "Google" (an earlier login that wasn't finished), Gemini starts
  // the login by itself before it even answers "initialize".
  if (urls) poll = setInterval(flush, 300);
  try {
    // (Cancel can come at any moment, even while Gemini is still starting.)
    const stop = new Promise((res) => {
      timer = setTimeout(() => res({ error: "The login wasn't finished in time. Try again." }), timeout);
      if (signal) { if (signal.aborted) res({ cancelled: true }); else signal.addEventListener("abort", () => res({ cancelled: true }), { once: true }); }
    });
    const done = (async () => {
      // A minute to start, unless it's already showing a login page (then it answers once you've logged in).
      // Windows: Kural can't see that, so no limit but Cancel.
      const t0 = Date.now();
      let slow = null;
      const init = await Promise.race([rpc.call("initialize", CLIENT), new Promise((_, rej) => {
        slow = setInterval(() => { if (!IS_WIN && !opened && Date.now() - t0 > 60000) rej(new Error("Gemini took too long to start.")); }, 500);
      })]).finally(() => clearInterval(slow));
      const google = (init.authMethods || []).find((m) => m.id === "oauth-personal");
      if (init.authMethods && !google) return { error: "This Gemini CLI doesn't offer a Google login." };
      await rpc.call("authenticate", { methodId: "oauth-personal" });
      return { ok: true };
    })().catch((e) => ({ error: e.message }));
    const out = await Promise.race([done, stop]);
    if (out.ok) flush();   // (a page that's only now in the file; never after Cancel: nothing is waiting for it then)
    return out;
  } catch (e) {
    return { error: e.message };
  } finally {
    clearInterval(poll); clearTimeout(timer);
    rpc.kill();
    if (shim) fs.rm(shim, { recursive: true, force: true }, () => {});
  }
}

// An empty folder for questions that aren't about a project: Gemini CLI looks around its folder at start, and in
// your home folder that makes macOS ask for Photos, Music…
function quietDir() {
  const d = path.join(os.tmpdir(), "kural-gemini");
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* exists */ }
  return d;
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Gemini took too long to answer.")), ms).unref())]); }

module.exports = { GeminiAgent, findGemini, geminiVersion, geminiAuth, geminiLogout, geminiModels, geminiTest, askGemini, loginCommand, geminiLogin,
  NOT_LOGGED_IN, _test: { describe, changedPart, authSync, readJsonc, cmdTarget, launch, resultText } };
