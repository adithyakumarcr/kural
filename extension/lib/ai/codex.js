// OpenAI Codex as an AI provider: the `codex` program (Codex CLI) with your ChatGPT login. No API key in Kural, no
// login in Kural: Codex keeps its own login, like Claude Code does.
//
// Kural talks to `codex app-server`: a long-running Codex that speaks JSON-RPC, one JSON object per line on
// stdin/stdout (no "jsonrpc" field, no Content-Length headers; checked against codex-cli 0.160.0).
//   Kural → Codex: requests (initialize, thread/start, turn/start, turn/interrupt…), answered by id.
//   Codex → Kural: notifications (item/started, item/agentMessage/delta, turn/completed…) and requests that wait
//                  for our answer (may I run this command? may I change these files? a question for the user).
//
// CodexAgent behaves like LocalAgent (./engine.js) and ClaudeProcess (./claude.js) on purpose: same methods and the
// same events (Claude Code's stream-json), so the chat, permissions, question cards and Undo work the same.
// No vscode here (tests run against test/fake-codex.js).

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const usage = require("./usage");

const IS_WIN = process.platform === "win32";
const RAW_LOG = process.env.KURAL_RAW_LOG || "";
// The words Kural's chat looks for to show "log in" (see LOGIN_RE in claude.js): keep "not logged in" in it.
const NOT_LOGGED_IN = "Codex is not logged in. Log in to Codex with your ChatGPT account (Get started), then send again.";

let log = () => {};
const setLog = (f) => { log = typeof f === "function" ? f : () => {}; };

// ---------- finding and starting the program ----------

// npm installs `codex` as a small Node script (bin/codex.js) that starts the real program from a platform package.
// Kural starts the real program itself: an app opened from the Dock or a menu often has no `node` on its PATH, and
// Windows can't start npm's codex.cmd without a shell.
const TRIPLES = { "linux-x64": "x86_64-unknown-linux-musl", "linux-arm64": "aarch64-unknown-linux-musl",
  "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc", "win32-arm64": "aarch64-pc-windows-msvc" };

function nativeFromScript(js) {
  const plat = `${process.platform}-${process.arch}`;
  const triple = TRIPLES[plat];
  if (!triple) return null;
  const exe = IS_WIN ? "codex.exe" : "codex";
  const pkg = path.dirname(path.dirname(js));                     // …/node_modules/@openai/codex
  const vendor = (root) => path.join(root, "vendor", triple, "bin", exe);
  for (const c of [vendor(path.join(pkg, "node_modules", "@openai", `codex-${plat}`)),   // npm, nested
    vendor(path.join(path.dirname(pkg), `codex-${plat}`)),                                // npm, flat
    vendor(pkg)]) {                                                                       // older packages
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// A path someone gave us (a setting, PATH) → the program to start.
function resolveBin(p) {
  if (!p || !fs.existsSync(p)) return null;
  let real = p;
  try { real = fs.realpathSync(p); } catch { /* keep p */ }
  if (IS_WIN && /\.cmd$/i.test(real)) {
    const js = path.join(path.dirname(real), "node_modules", "@openai", "codex", "bin", "codex.js");
    return fs.existsSync(js) ? nativeFromScript(js) || js : null;
  }
  if (/[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js$/.test(real)) return nativeFromScript(real) || real;
  return real;
}

// How to start `bin`: a .js file runs with Node. (Inside Kural, process.execPath is Kural itself: with
// ELECTRON_RUN_AS_NODE it behaves as plain Node. Tests run under node, where the variable does nothing.)
function command(bin, args) {
  if (/\.js$/i.test(bin)) return { file: process.execPath, args: [bin, ...args], env: { ELECTRON_RUN_AS_NODE: "1" } };
  return { file: bin, args, env: {} };
}

// The usual places, then PATH, then (Mac, Linux) where your terminal finds it.
async function findCodex(chosenPath) {
  const chosen = String(chosenPath || "").trim();
  if (chosen) return resolveBin(chosen);
  const home = os.homedir();
  const names = IS_WIN ? ["codex.exe", "codex.cmd"] : ["codex"];
  const dirs = [...(process.env.PATH || "").split(path.delimiter).filter(Boolean)];
  if (IS_WIN) dirs.push(path.join(process.env.APPDATA || "", "npm"), path.join(process.env.LOCALAPPDATA || "", "Programs", "codex"));
  else {
    dirs.push(path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
      path.join(home, ".npm-global", "bin"), path.join(home, ".volta", "bin"), path.join(home, ".bun", "bin"));
    if (process.env.npm_config_prefix) dirs.push(path.join(process.env.npm_config_prefix, "bin"));
    // nvm keeps one folder per Node version: the newest first.
    const nvm = path.join(home, ".nvm", "versions", "node");
    try { for (const v of fs.readdirSync(nvm).sort().reverse()) dirs.push(path.join(nvm, v, "bin")); } catch { /* no nvm */ }
  }
  for (const d of dirs) for (const n of names) { const r = resolveBin(path.join(d, n)); if (r) return r; }
  return IS_WIN ? null : fromShell();
}

// `command -v codex` in an interactive login shell (reads .zshrc/.bashrc, where nvm adds to PATH). Up to 8 s.
function fromShell() {
  return new Promise((resolve) => {
    const p = execFile(process.env.SHELL || "/bin/bash", ["-ilc", "command -v codex"], { timeout: 8000, encoding: "utf8" }, (err, stdout) => {
      const line = String(stdout || "").trim().split("\n").pop() || "";
      resolve(path.isAbsolute(line) ? resolveBin(line) : null);
    });
    if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(); }
  });
}

// Run `codex <args>` and wait. Resolves { status, stdout, stderr, error }.
function run(bin, args, timeout = 20000) {
  return new Promise((resolve) => {
    const c = command(bin, args);
    let p;
    try {
      p = execFile(c.file, c.args, { env: { ...process.env, ...c.env }, timeout, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) =>
        resolve({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: stdout || "", stderr: stderr || "",
          error: error && (error.killed ? Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) : typeof error.code === "string" ? error : null) }));
    } catch (e) { resolve({ status: null, stdout: "", stderr: "", error: e }); return; }
    if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(); }
  });
}

// "codex-cli 0.160.0" → { version: "0.160.0" }, or { error }.
async function codexVersion(bin) {
  const r = await run(bin, ["--version"], 30000);
  const v = /(\d+\.\d+\.\d+[\w.-]*)/.exec(r.stdout);
  if (r.error || r.status !== 0 || !v) return { error: ((r.error && r.error.message) || r.stderr.trim() || r.stdout.trim() || `exit code ${r.status}`).split("\n").pop().slice(0, 200) };
  return { version: v[1] };
}

// What to type in a terminal to log in (it opens the browser for your ChatGPT account).
function loginCommand(bin) {
  const q = (s) => /[\s"'$`\\]/.test(s) ? (IS_WIN ? `"${s}"` : `'${s.replace(/'/g, "'\\''")}'`) : s;
  const c = command(bin, ["login"]);
  return [c.file === bin ? q(bin) : `node ${q(bin)}`, "login"].join(" ");
}

// Log in without a terminal, the way Codex's own editor extension does: Codex gives the login page's address, Kural
// opens it in your browser (openUrl), and Codex waits for the browser to come back to it (localhost:1455).
// Resolves { ok } or { error } or { cancelled }.
async function codexLogin(bin, { openUrl, signal, timeout = 10 * 60 * 1000 } = {}) {
  let s = null, timer = null, loginId = null;
  try {
    let finish;
    const finished = new Promise((r) => (finish = r));
    s = new AppServer(bin, { name: "codex-login" }, {
      onNotification: (method, p) => {
        if (method === "account/login/completed" && (!loginId || !p.loginId || p.loginId === loginId))
          finish(p.success ? { ok: true } : { error: p.error || "The login didn't finish." });
      },
      onExit: () => finish({ error: lastLine(s && s.stderr) || "Codex stopped." }),
    });
    // (Cancel can come at any moment, even before the page opens.)
    const stop = new Promise((res) => {
      timer = setTimeout(() => res({ error: "The login wasn't finished in time. Try again." }), timeout);
      if (signal) { if (signal.aborted) res({ cancelled: true }); else signal.addEventListener("abort", () => res({ cancelled: true }), { once: true }); }
    });
    const start = (async () => {
      await s.init();
      const r = await s.request("account/login/start", { type: "chatgpt" });
      if (!r.authUrl) return { error: "Codex didn't give a login page." };
      loginId = r.loginId;
      openUrl(r.authUrl);
      return finished;
    })();
    const out = await Promise.race([start, stop]);
    if (!out.ok && loginId) await Promise.race([s.request("account/login/cancel", { loginId }).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    return out;
  } catch (e) {
    return { error: e.message };
  } finally {
    clearTimeout(timer);
    if (s) s.kill();
  }
}

async function codexLogout(bin) {
  const r = await run(bin, ["logout"]);
  if (r.error || r.status !== 0) return { error: ((r.error && r.error.message) || r.stderr.trim() || r.stdout.trim() || `exit code ${r.status}`).split("\n").pop().slice(0, 200) };
  return { ok: true };
}

// ---------- the connection to `codex app-server` ----------

// { device: { command, args, env } } → -c options (TOML values; JSON strings are valid TOML strings). Kural asks you before
// a device tool runs (lib/devices/bridge.js), so Codex doesn't ask again ("approve").
function mcpConfig(servers) {
  const out = [];
  for (const [name, s] of Object.entries(servers || {})) {
    if (!/^[\w-]+$/.test(name) || !s || !s.command) continue;
    const key = `mcp_servers.${name}`;
    out.push("-c", `${key}.command=${JSON.stringify(s.command)}`, "-c", `${key}.args=[${(s.args || []).map((a) => JSON.stringify(String(a))).join(",")}]`);
    const env = Object.entries(s.env || {}).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join(",");
    if (env) out.push("-c", `${key}.env={${env}}`);
    out.push("-c", `${key}.default_tools_approval_mode="approve"`);
  }
  return out;
}

class AppServer {
  // handlers: onNotification(method, params), onRequest(method, params) -> Promise<result> (throw = an error answer),
  //   onExit(code, stderr)
  // mcpServers: { name: { command, args, env } }: MCP servers for this Codex only (Kural's device tools), as -c options.
  constructor(bin, { cwd, env, name, mcpServers } = {}, handlers = {}) {
    this.h = handlers;
    this.name = name || "codex";
    this.ids = 0;
    this.pending = new Map();   // our request id → { resolve, reject }
    this.buf = "";
    this.stderr = "";
    this.exited = false;
    const c = command(bin, [...mcpConfig(mcpServers), "app-server"]);
    // Its own process group (not on Windows), so stopping it also stops the commands it started.
    this.proc = spawn(c.file, c.args, { cwd: cwd || os.tmpdir(), env: { ...process.env, ...(env || {}), ...c.env },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: !IS_WIN });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (d) => this.onData(d));
    this.proc.stderr.on("data", (d) => { this.stderr = (this.stderr + d).slice(-20000); });
    this.proc.stdin.on("error", () => {});   // process already gone; the exit handler reports it
    this.proc.on("error", (e) => { this.stderr += `\n${e.message}`; this.gone(null); });
    this.proc.on("exit", (code) => this.gone(code));
  }

  gone(code) {
    if (this.exited) return;
    this.exited = true;
    for (const p of this.pending.values()) p.reject(new Error(lastLine(this.stderr) || "Codex stopped."));
    this.pending.clear();
    if (this.h.onExit) this.h.onExit(code, this.stderr);
  }

  write(o) {
    if (this.exited) return;
    const line = JSON.stringify(o);
    if (RAW_LOG) { try { fs.appendFileSync(RAW_LOG, `${this.name} >> ${line}\n`); } catch { /* debugging only */ } }
    this.proc.stdin.write(line + "\n");
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (this.exited) { reject(new Error(lastLine(this.stderr) || "Codex isn't running.")); return; }
      const id = ++this.ids;
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params: params === undefined ? {} : params });
    });
  }

  notify(method, params) { this.write(params === undefined ? { method } : { method, params }); }

  // initialize, then "initialized": Codex refuses everything else before that ("Not initialized").
  async init() {
    const r = await this.request("initialize", { clientInfo: { name: "kural", title: "Kural", version: "1" },
      // experimentalApi: Codex's questions to the user (item/tool/requestUserInput) are still marked experimental.
      capabilities: { experimentalApi: true, requestAttestation: false } });
    this.notify("initialized");
    return r;
  }

  onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      if (RAW_LOG) { try { fs.appendFileSync(RAW_LOG, `${this.name} << ${line}\n`); } catch { /* debugging only */ } }
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.method && m.id !== undefined && m.id !== null) this.answer(m);            // Codex asks us
      else if (m.method) { try { this.h.onNotification && this.h.onNotification(m.method, m.params || {}); } catch (e) { log(`${this.name}: ${e.stack}`); } }
      else if (this.pending.has(m.id)) {                                                // Codex answers us
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.reject(Object.assign(new Error(m.error.message || "Codex refused."), { code: m.error.code }));
        else p.resolve(m.result || {});
      }
    }
  }

  async answer(m) {
    try {
      const result = this.h.onRequest ? await this.h.onRequest(m.method, m.params || {}) : undefined;
      if (result === undefined) this.write({ id: m.id, error: { code: -32601, message: `Kural doesn't handle ${m.method}.` } });
      else this.write({ id: m.id, result });
    } catch (e) { this.write({ id: m.id, error: { code: -32603, message: e.message } }); }
  }

  kill() {
    if (this.exited) return;
    try { if (!IS_WIN && this.proc.pid) process.kill(-this.proc.pid, "SIGTERM"); else this.proc.kill(); }
    catch { try { this.proc.kill(); } catch { /* already gone */ } }
  }
}

const lastLine = (s) => String(s || "").split("\n").map((l) => l.trim()).filter((l) => l && !/^WARNING: proceeding/.test(l)).pop() || "";

// A short-lived app server for one helper (auth, models, limits, a test). Always stopped afterwards.
async function withServer(bin, fn, { cwd, timeout = 30000, handlers = {} } = {}) {
  const s = new AppServer(bin, { cwd, name: "codex helper" }, handlers);
  let timer;
  try {
    return await Promise.race([
      (async () => { await s.init(); return fn(s); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`Codex didn't answer within ${Math.round(timeout / 1000)} s`), { code: "ETIMEDOUT" })), timeout); }),
    ]);
  } finally { clearTimeout(timer); s.kill(); }
}

// ---------- account, limits, models ----------

const PLANS = { free: "Free", go: "Go", plus: "Plus", pro: "Pro", prolite: "Pro Lite", promax: "Pro Max", team: "Team", business: "Business",
  enterprise: "Enterprise", edu: "Edu", edu_plus: "Edu Plus", edu_pro: "Edu Pro" };
const planName = (t) => !t || t === "unknown" ? "" : PLANS[t] || String(t).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// account/read's answer → { loggedIn, method, email, plan }. Logged out = no account while Codex needs an OpenAI
// login (with another provider in Codex's config.toml it needs none).
function authFrom(r) {
  const a = r && r.account;
  if (!a) return { loggedIn: !(r && r.requiresOpenaiAuth), method: "", email: "", plan: "" };
  if (a.type === "chatgpt") return { loggedIn: true, method: "ChatGPT", email: a.email || "", plan: planName(a.planType) };
  if (a.type === "apiKey") return { loggedIn: true, method: "API key", email: "", plan: "" };
  return { loggedIn: true, method: a.type || "", email: "", plan: "" };
}

// Who's logged in: account/read (no request to OpenAI). Old Codex without app-server: `codex login status`.
async function codexAuth(bin) {
  try { return authFrom(await withServer(bin, (s) => s.request("account/read", {}), { timeout: 20000 })); }
  catch (e) {
    const r = await run(bin, ["login", "status"]);
    const out = `${r.stdout}\n${r.stderr}`;
    if (/not logged in/i.test(out)) return { loggedIn: false, method: "", email: "", plan: "" };
    if (/logged in/i.test(out)) return { loggedIn: true, method: /api key/i.test(out) ? "API key" : "ChatGPT", email: "", plan: "" };
    return { loggedIn: null, method: "", email: "", plan: "", error: e.message };
  }
}

// Codex's limits are windows of time (5 hours, a week) with a percentage used. Updates come sparse (only the
// window that changed), so Kural keeps the last full picture and fills in what changed.
const limits = { primary: null, secondary: null, plan: "" };
function windowLabel(mins) {
  if (!mins) return "Limit";
  if (mins === 10080) return "Week";
  if (mins % 1440 === 0) return `${mins / 1440}-day`;
  if (mins % 60 === 0) return `${mins / 60}-hour`;
  return `${mins}-minute`;
}
const toMs = (t) => !t ? null : t < 1e12 ? t * 1000 : t;   // Codex sends seconds; accept milliseconds too

function rateReport(snap) {
  if (!snap) return null;
  for (const k of ["primary", "secondary"]) if (snap[k] && Number.isFinite(snap[k].usedPercent)) limits[k] = snap[k];
  if (snap.planType) limits.plan = planName(snap.planType);
  const windows = ["primary", "secondary"].filter((k) => limits[k]).map((k) => ({ id: k, label: windowLabel(limits[k].windowDurationMins),
    usedPercent: Math.round(limits[k].usedPercent * 10) / 10, resetsAt: toMs(limits[k].resetsAt) }));
  if (!windows.length) return null;
  const out = { windows, ...(limits.plan ? { plan: limits.plan } : {}) };
  usage.report("codex", out);
  return out;
}

// How much of your Codex plan is used right now: reported to the usage hub and returned (null when unknown).
async function codexRateLimits(bin) {
  try { return rateReport((await withServer(bin, (s) => s.request("account/rateLimits/read"), { timeout: 20000 })).rateLimits); }
  catch (e) { log(`codex: no limits (${e.message})`); return null; }
}

// The models your account can use: [{ id, label, description, isDefault, efforts }].
async function codexModels(bin) {
  return withServer(bin, async (s) => {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 5; page++) {
      const r = await s.request("model/list", { cursor, includeHidden: false });
      for (const m of r.data || []) {
        if (m.hidden) continue;
        out.push({ id: m.model || m.id, label: m.displayName || m.model || m.id, description: m.description || "", isDefault: !!m.isDefault,
          efforts: (m.supportedReasoningEfforts || []).map((e) => e.reasoningEffort) });
      }
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return out;
  }, { timeout: 20000 });
}

// ---------- one question, one answer ----------

// A thread that can't change anything and doesn't ask: no file changes, no commands outside the read-only sandbox.
// Resolves { text, ms } or { error, login }.
async function oneAnswer(bin, { model, system, prompt, cwd, signal, effort = "low", timeout = 180000 }) {
  const t0 = Date.now();
  let s;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const state = { threadId: null, turnId: null, text: "", error: null };
  try {
    s = new AppServer(bin, { cwd, name: "codex ask" }, {
      onNotification: (method, p) => {
        if (p.threadId && p.threadId !== state.threadId) return;
        if (method === "item/completed" && p.item && p.item.type === "agentMessage") state.text = p.item.text || state.text;
        if (method === "error" && !p.willRetry) state.error = p.error;
        if (method === "turn/completed") finish(p.turn || {});
      },
      // Nothing is allowed here (read-only thread), so any question gets a no.
      onRequest: (method) => Promise.resolve(declineAnswer(method)),
      onExit: () => finish({ status: "failed", error: { message: lastLine(s && s.stderr) || "Codex stopped." } }),
    });
    if (signal) {
      if (signal.aborted) return { error: "Stopped." };
      signal.addEventListener("abort", () => finish({ status: "interrupted" }), { once: true });
    }
    const timer = setTimeout(() => finish({ status: "failed", error: { message: `Codex didn't answer within ${Math.round(timeout / 1000)} s.` } }), timeout);
    try {
      await s.init();
      const acct = authFrom(await s.request("account/read", {}));
      if (acct.loggedIn === false) return { error: NOT_LOGGED_IN, login: true };
      const t = await s.request("thread/start", { cwd: cwd || null, ...(model ? { model } : {}), approvalPolicy: "never", sandbox: "read-only",
        ephemeral: true, developerInstructions: system || null });
      state.threadId = t.thread && t.thread.id;
      const turn = await startTurn(s, { threadId: state.threadId, input: [textInput(prompt)], effort, summary: "none" });
      state.turnId = turn.turn && turn.turn.id;
      const end = await done;
      if (end.status === "interrupted") return { error: "Stopped." };
      if (end.status !== "completed") { const msg = friendlyError(end.error || state.error); return { error: msg, login: msg === NOT_LOGGED_IN }; }
      return { text: state.text, ms: Date.now() - t0 };
    } finally { clearTimeout(timer); }
  } catch (e) {
    const msg = friendlyError({ message: e.message });
    return { error: msg, login: msg === NOT_LOGGED_IN };
  } finally { if (s) s.kill(); }
}

// One answer for Ctrl+K, Apply, commit messages: the text, or null (stopped, failed: the log says why).
async function askCodex(bin, { model, system, prompt, cwd, signal } = {}) {
  const r = await oneAnswer(bin, { model, system, prompt, cwd, signal });
  if (r.error) { log(`codex: no answer: ${r.error}`); return null; }
  log(`codex: answer in ${r.ms} ms`);
  return r.text;
}

// Get started's test: one tiny real request. { ok, ms, answer } or { ok: false, error, login }.
async function codexTest(bin, { cwd, model } = {}) {
  const r = await oneAnswer(bin, { model, cwd, system: null, prompt: "This is Kural checking that Codex works. Reply with exactly: OK", timeout: 90000 });
  if (r.error) return { ok: false, error: r.error, login: !!r.login };
  if (!String(r.text || "").trim()) return { ok: false, error: "Codex answered with nothing.", login: false };
  return { ok: true, ms: r.ms, answer: r.text.trim() };
}

// ---------- helpers for the conversation ----------

const textInput = (text) => ({ type: "text", text: String(text || ""), text_elements: [] });

// turn/start with a reasoning effort; a model that doesn't take that effort: once more without it.
async function startTurn(s, params) {
  try { return await s.request("turn/start", params); }
  catch (e) {
    if (params.effort && /effort/i.test(e.message)) { const { effort, ...rest } = params; return s.request("turn/start", rest); }
    throw e;
  }
}

// Kural's intensity → Codex's reasoning effort (Codex has the same names, plus xhigh and ultra).
const EFFORTS = { low: "low", medium: "medium", high: "high", max: "max" };

// Codex's error → plain words.
function friendlyError(err) {
  if (!err) return "Codex stopped without an answer.";
  const info = err.codexErrorInfo;
  const kind = typeof info === "string" ? info : info && typeof info === "object" ? Object.keys(info)[0] : "";
  const msg = String(err.message || "");
  const more = err.additionalDetails ? ` (${String(err.additionalDetails).slice(0, 200)})` : "";
  if (kind === "unauthorized" || /\b401\b|unauthori[sz]ed|not logged in|log ?in again|authentication required/i.test(msg)) return NOT_LOGGED_IN;
  if (kind === "usageLimitExceeded") return `You've used up your Codex limit for now. ${msg}`.trim();
  if (kind === "rateLimitExceeded") return "Codex is getting too many requests from you right now. Wait a minute, then send again.";
  if (kind === "contextWindowExceeded") return "This conversation is too long for the model. Start a new chat (it can carry this one over).";
  if (kind === "serverOverloaded" || kind === "internalServerError") return "Codex's servers are busy or having trouble. Try again in a minute.";
  if (/ConnectionFailed|StreamDisconnected|TooManyFailedAttempts/i.test(kind) || /stream disconnected|connection/i.test(msg)) return `Kural can't reach Codex. Check your internet connection, then send again.${more}`;
  if (kind === "sandboxError") return `Codex's sandbox failed: ${msg}${more}`;
  return msg + more || "Something went wrong in Codex.";
}

// What to answer Codex's questions we don't support (or when nothing may change): a no in each one's own shape.
function declineAnswer(method) {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval": return { decision: "decline" };
    case "item/tool/requestUserInput": return { answers: {} };
    case "mcpServer/elicitation/request": return { action: "decline", content: null, _meta: null };
    case "item/permissions/requestApproval": return { permissions: {}, scope: "turn" };
    case "item/tool/call": return { contentItems: [], success: false };
    case "applyPatchApproval":
    case "execCommandApproval": return { decision: { denied: { rejection: "Not allowed here." } } };
    default: return undefined;   // an error answer: "Kural doesn't handle …"
  }
}

// Codex runs commands through a shell: `/bin/bash -lc 'npm test'`. The chat shows just `npm test`.
function unwrapShell(cmd) {
  if (Array.isArray(cmd)) cmd = cmd.length >= 3 && /(^|[\\/])(ba|z)?sh(\.exe)?$/.test(cmd[0]) && /^-l?c$/.test(cmd[1]) ? cmd[2] : cmd.join(" ");
  const s = String(cmd || "");
  const m = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/.exec(s);
  return m ? (m[1] === "'" ? m[2].replace(/'\\''/g, "'") : m[2]) : s;
}

// A file change's diff → what the chat shows (+lines −lines) and Undo needs (the path).
function editInput(abs, change) {
  const diff = String(change.diff || "");
  const unified = /^@@ /m.test(diff);
  const added = [], removed = [];
  if (unified) for (const l of diff.split("\n")) {
    if (/^(\+\+\+|---|@@)/.test(l)) continue;
    if (l.startsWith("+")) added.push(l.slice(1)); else if (l.startsWith("-")) removed.push(l.slice(1));
  }
  const kind = change.kind && change.kind.type;
  if (kind === "add") return { name: "Write", input: { file_path: abs, content: unified ? added.join("\n") : diff } };
  if (kind === "delete") return { name: "Edit", input: { file_path: abs, old_string: unified ? removed.join("\n") : diff, new_string: "" } };
  return { name: "Edit", input: { file_path: abs, old_string: removed.join("\n"), new_string: added.join("\n") } };
}

// ---------- the conversation ----------

class CodexAgent {
  // opts: name, bin, model ("" = Codex's default), effort, mode ("agent" | "auto" | "plan" | "ask"), cwd, addDirs,
  //   appendSystemPrompt (Kural's instructions: Codex's "developer instructions"), sessionId / resume (Kural's
  //   conversation id), store (folder for the Kural id → Codex thread id file), env.
  // handlers: onMessage(msg), onPermission(req) -> Promise<{allow, message?, updatedInput?}>, onExit({code, login, stderr})
  constructor(opts, handlers) {
    this.opts = { mode: "agent", ...opts };
    this.h = handlers || {};
    this.model = opts.model || "";
    this.exited = false;
    this.queue = [];
    this.busy = false;
    this.ready = false;
    this.sessionId = opts.resume || opts.sessionId || crypto.randomUUID();
    this.threadId = null;
    this.server = null;
    this.turn = null;            // the answer being written: { id, t0, text, error, stopped, files, items }
    this.loggedIn = true;
  }

  emit(m) { if (this.exited) return; try { this.h.onMessage && this.h.onMessage({ session_id: this.sessionId, ...m }); } catch (e) { log(`${this.opts.name}: ${e.stack}`); } }

  get editing() { return this.opts.mode === "agent" || this.opts.mode === "auto"; }
  get cwd() { return this.opts.cwd || process.cwd(); }

  // Codex asks Kural before every command and every file change (Kural decides: it asks you in Agent mode, keeps a
  // copy of each file for Undo). Plan and Ask: a read-only sandbox, and nothing to ask about.
  settings() {
    return this.editing
      ? { approvalPolicy: "untrusted", sandbox: "workspace-write",
        sandboxPolicy: { type: "workspaceWrite", writableRoots: this.opts.addDirs || [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }
      : { approvalPolicy: "never", sandbox: "read-only", sandboxPolicy: { type: "readOnly", networkAccess: false } };
  }

  // Kural's conversation id → Codex's thread id, so `resume` reopens the same thread.
  threadsFile() { return this.opts.store ? path.join(this.opts.store, "codex-threads.json") : null; }
  savedThread() { try { return JSON.parse(fs.readFileSync(this.threadsFile(), "utf8"))[this.sessionId] || null; } catch { return null; } }
  saveThread() {
    const f = this.threadsFile();
    if (!f || !this.threadId) return;
    try {
      let all = {}; try { all = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* first one */ }
      all[this.sessionId] = this.threadId;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(all));
    } catch { /* best effort */ }
  }

  start() {
    if (!this.opts.bin || !fs.existsSync(this.opts.bin)) return false;
    try {
      this.server = new AppServer(this.opts.bin, { cwd: this.cwd, env: this.opts.env, name: this.opts.name, mcpServers: this.opts.mcpServers }, {
        onNotification: (m, p) => this.onNotification(m, p),
        onRequest: (m, p) => this.onRequest(m, p),
        onExit: (code, stderr) => this.onServerExit(code, stderr),
      });
    } catch (e) { log(`${this.opts.name}: could not start codex: ${e.message}`); return false; }
    this.boot();
    return true;
  }

  async boot() {
    const s = this.server;
    try {
      await s.init();
      this.loggedIn = authFrom(await s.request("account/read", {})).loggedIn !== false;
      // The usage meter gets numbers right away (later ones come with every answer).
      if (this.loggedIn) s.request("account/rateLimits/read").then((r) => rateReport(r.rateLimits)).catch(() => {});
      const common = { cwd: this.cwd, ...(this.model ? { model: this.model } : {}), approvalPolicy: this.settings().approvalPolicy,
        sandbox: this.settings().sandbox, developerInstructions: this.opts.appendSystemPrompt || null };
      let r = null;
      const saved = this.opts.resume ? this.savedThread() : null;
      // (A thread Codex never wrote to disk, e.g. one with no answer yet, can't be reopened: start a new one.)
      if (saved) { try { r = await s.request("thread/resume", { threadId: saved, ...common }); } catch (e) { log(`${this.opts.name}: couldn't reopen Codex thread ${saved}: ${e.message}`); } }
      if (!r) r = await s.request("thread/start", common);
      this.threadId = r.thread && r.thread.id;
      this.saveThread();
      this.ready = true;
      this.emit({ type: "system", subtype: "init", model: r.model || this.model || "codex", tools: [], mcp_servers: [] });
      if (!this.busy) this.next();
    } catch (e) {
      log(`${this.opts.name}: codex didn't start: ${e.message}`);
      if (!s.exited) { s.stderr += `\n${e.message}`; s.kill(); }
    }
  }

  onServerExit(code, stderr) {
    if (this.exited) return;
    this.exited = true;
    log(`${this.opts.name}: codex exited (code ${code})`);
    if (this.h.onExit) this.h.onExit({ code, login: !this.loggedIn || /not logged in|unauthori[sz]ed|\b401\b/i.test(stderr), stderr: stderr || "" });
  }

  // Your message: a string, or Claude-style blocks (text and images).
  send(content) {
    if (this.exited) return;
    this.queue.push(content);
    if (this.ready && !this.busy) this.next();
  }

  setModel(m) { this.model = m || ""; }
  request(req) { return Promise.resolve(req && req.subtype === "mcp_status" ? { mcpServers: [] } : {}); }
  control() { return null; }

  interrupt() {
    const t = this.turn;
    if (!t) return;
    t.stopped = true;
    // (Before Codex has said the turn's id, the stop waits for it: see next().)
    if (t.id && this.server) this.server.request("turn/interrupt", { threadId: this.threadId, turnId: t.id }).catch(() => {});
  }

  kill() {
    if (this.exited) return;
    if (this.server) this.server.kill();
    this.exited = true;
    setImmediate(() => this.h.onExit && this.h.onExit({ code: 0, login: false, stderr: "" }));
  }

  // Pictures go to Codex as files (localImage): write them to temporary files, deleted after the answer.
  input(content) {
    const items = [], temp = [];
    let text = "";
    for (const b of typeof content === "string" ? [{ type: "text", text: content }] : content || []) {
      if (b.type === "text") text += (text ? "\n\n" : "") + b.text;
      else if (b.type === "image" && b.source && b.source.data) {
        const ext = (/image\/(\w+)/.exec(b.source.media_type || "") || [, "png"])[1].replace("jpeg", "jpg");
        const f = path.join(os.tmpdir(), `kural-codex-${crypto.randomUUID()}.${ext}`);
        try { fs.writeFileSync(f, Buffer.from(b.source.data, "base64")); items.push({ type: "localImage", path: f }); temp.push(f); } catch { /* skip it */ }
      } else if (b.type === "document") text += `\n\n(A PDF was attached: ${b.title || "document"}. Codex can't read PDFs here.)`;
    }
    return { items: [textInput(text), ...items], temp };
  }

  async next() {
    if (this.exited) return;
    const content = this.queue.shift();
    if (content === undefined) { this.busy = false; return; }
    this.busy = true;
    const t = { id: null, t0: Date.now(), text: "", error: null, stopped: false, files: new Map(), shown: new Set(), deltas: new Set(), block: null, last: null };
    this.turn = t;
    const { items, temp } = this.input(content);
    t.temp = temp;
    try {
      // Logged out: say so plainly at once (a turn would only retry for a while and then fail).
      if (!this.loggedIn) this.loggedIn = authFrom(await this.server.request("account/read", {})).loggedIn !== false;
      if (!this.loggedIn) return this.finish({ status: "failed", error: { message: NOT_LOGGED_IN } });
      const set = this.settings();
      const r = await startTurn(this.server, { threadId: this.threadId, input: items, effort: EFFORTS[this.opts.effort] || null, summary: "auto",
        ...(this.model ? { model: this.model } : {}), approvalPolicy: set.approvalPolicy, sandboxPolicy: set.sandboxPolicy });
      t.id = r.turn && r.turn.id;
      if (t.stopped) this.interrupt();   // Stop came before Codex said the turn's id
    } catch (e) {
      this.finish({ status: "failed", error: { message: e.message } });
    }
  }

  // The turn is over: close what's open, tell the chat, start the next message.
  finish(turn) {
    const t = this.turn;
    if (!t || t.finished) return;
    t.finished = true;
    this.close();
    for (const f of t.temp || []) fs.rm(f, { force: true }, () => {});
    const duration_ms = Date.now() - t.t0;
    if (turn.status === "interrupted" || (t.stopped && turn.status !== "completed")) this.emit({ type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped.", duration_ms });
    else if (turn.status === "completed") this.emit({ type: "result", subtype: "success", is_error: false, result: t.text.trim(), duration_ms });
    else this.emit({ type: "result", subtype: "error", is_error: true, result: friendlyError(turn.error || t.error), duration_ms });
    this.turn = null;
    this.next();
  }

  // ---- streaming blocks (thinking, text), like Claude Code's stream_event ----
  open(type) {
    const t = this.turn;
    if (t.block === type) return;
    this.close();
    t.block = type;
    this.emit({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type } } });
  }
  close() {
    const t = this.turn;
    if (t && t.block) { this.emit({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }); t.block = null; }
  }
  think(itemId, s) {
    if (!s) return;
    this.open("thinking");
    this.turn.last = "think";
    this.emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: s } } });
  }
  say(itemId, s) {
    if (!s) return;
    const t = this.turn;
    // A new message right after another one (no tool in between): the chat would glue them; keep a blank line.
    if (!t.deltas.has(itemId) && t.last === "text") s = `\n\n${s}`;
    t.deltas.add(itemId);
    this.open("text");
    t.last = "text";
    this.emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: s } } });
  }
  tool(id, name, input) {
    const t = this.turn;
    if (t.shown.has(id)) return;
    t.shown.add(id);
    this.close();
    t.last = "tool";
    this.emit({ type: "assistant", message: { role: "assistant", model: this.model || "codex", content: [{ type: "tool_use", id, name, input }] } });
  }
  toolResult(results) { this.emit({ type: "user", message: { role: "user", content: results } }); }

  // ---- what Codex tells us ----
  onNotification(method, p) {
    if (method === "account/rateLimits/updated") { rateReport(p.rateLimits); return; }
    if (method === "account/updated") { if (p.authMode) this.loggedIn = true; return; }   // you logged in meanwhile
    const t = this.turn;
    // Only this thread's current turn (Codex's own helper agents have their own threads).
    if (!t || (p.threadId && p.threadId !== this.threadId)) return;
    if (p.turnId && t.id && p.turnId !== t.id) return;
    switch (method) {
      case "item/reasoning/summaryTextDelta":
        t.deltas.add(p.itemId + ":summary");
        return this.think(p.itemId, p.delta);
      case "item/reasoning/summaryPartAdded":
        if (t.deltas.has(p.itemId + ":summary")) this.think(p.itemId, "\n\n");
        return;
      case "item/reasoning/textDelta":
        // The raw reasoning only when there's no summary of it (never both: it would show twice).
        if (t.deltas.has(p.itemId + ":summary")) return;
        t.deltas.add(p.itemId + ":raw");
        return this.think(p.itemId, p.delta);
      case "item/agentMessage/delta": return this.say(p.itemId, p.delta);
      case "item/started": return this.itemStarted(p.item || {});
      case "item/completed": return this.itemCompleted(p.item || {});
      case "item/fileChange/patchUpdated": if (p.itemId && p.changes) t.files.set(p.itemId, p.changes); return;
      case "error": if (!p.willRetry) t.error = p.error; else log(`${this.opts.name}: ${p.error && p.error.message}`); return;
      case "turn/completed": return this.finish(p.turn || { status: "failed" });
      default: return;
    }
  }

  itemStarted(item) {
    const t = this.turn;
    if (item.type === "commandExecution") this.tool(item.id, ...commandTool(item, this.cwd));
    else if (item.type === "fileChange") { t.files.set(item.id, item.changes || []); this.fileTools(item.id); }
    else if (item.type === "mcpToolCall") this.tool(item.id, `mcp__${item.server}__${item.tool}`, item.arguments && typeof item.arguments === "object" ? item.arguments : {});
  }

  itemCompleted(item) {
    const t = this.turn;
    switch (item.type) {
      case "reasoning":
        // Nothing streamed (an older Codex, or a short summary): show it whole.
        if (!t.deltas.has(item.id + ":summary") && !t.deltas.has(item.id + ":raw")) this.think(item.id, (item.summary || []).join("\n\n"));
        if (t.block === "thinking") this.close();
        return;
      case "agentMessage":
        if (!t.deltas.has(item.id)) this.say(item.id, item.text || "");
        if (item.text) t.text = item.text;
        return this.close();
      case "commandExecution": {
        this.tool(item.id, ...commandTool(item, this.cwd));
        const failed = item.status === "failed" || item.status === "declined" || (typeof item.exitCode === "number" && item.exitCode !== 0);
        const out = item.status === "declined" ? (t.declined && t.declined.get(item.id)) || "The user declined." : (item.aggregatedOutput || "") + (failed && typeof item.exitCode === "number" ? `\n(exit code ${item.exitCode})` : "");
        return this.toolResult([{ type: "tool_result", tool_use_id: item.id, content: out.trim(), is_error: failed }]);
      }
      case "fileChange": {
        if (item.changes) t.files.set(item.id, item.changes);
        this.fileTools(item.id);
        const ok = item.status === "completed";
        const msg = ok ? "Done." : item.status === "declined" ? (t.declined && t.declined.get(item.id)) || "The user declined." : "The change couldn't be applied.";
        return this.toolResult((t.files.get(item.id) || []).map((c, i) => ({ type: "tool_result", tool_use_id: `${item.id}:${i}`, content: msg, is_error: !ok })));
      }
      case "mcpToolCall": {
        this.tool(item.id, `mcp__${item.server}__${item.tool}`, item.arguments && typeof item.arguments === "object" ? item.arguments : {});
        const text = item.error ? item.error.message : ((item.result && item.result.content) || []).map((c) => c && c.type === "text" ? c.text : "").filter(Boolean).join("\n");
        return this.toolResult([{ type: "tool_result", tool_use_id: item.id, content: text || "", is_error: !!item.error || item.status === "failed" }]);
      }
      case "webSearch": {
        const a = item.action || {};
        const name = a.type === "openPage" ? "WebFetch" : "WebSearch";
        const input = a.type === "openPage" ? { url: a.url || "" } : { query: item.query || a.query || (a.queries || []).join(", ") };
        this.tool(item.id, name, input);
        return this.toolResult([{ type: "tool_result", tool_use_id: item.id, content: "Searched.", is_error: false }]);
      }
      case "imageGeneration":
        // A picture Codex made (base64): the chat saves and shows it.
        if (typeof item.result === "string" && item.result.length > 100) this.emit({ type: "kural_image", data: item.result, mime: item.result.startsWith("/9j/") ? "image/jpeg" : "image/png" });
        return;
      default: return;
    }
  }

  // One Edit/Write card per file in a change (ids "<item>:<n>").
  fileTools(itemId) {
    (this.turn.files.get(itemId) || []).forEach((c, i) => {
      const e = editInput(path.resolve(this.cwd, c.path), c);
      this.tool(`${itemId}:${i}`, e.name, e.input);
    });
  }

  // ---- what Codex asks us ----
  async onRequest(method, p) {
    switch (method) {
      case "item/commandExecution/requestApproval": return this.approveCommand(p);
      case "item/fileChange/requestApproval": return this.approveFiles(p);
      case "item/tool/requestUserInput": return this.askUser(p);
      // Kural's own device tools: Kural asks you itself before one runs (lib/devices/bridge.js), so if Codex asks too, yes.
      case "mcpServer/elicitation/request":
        if (p && p.serverName === "device" && p.mode !== "url") return { action: "accept", content: {}, _meta: null };
        return declineAnswer(method);
      case "execCommandApproval": {   // (the older way of asking, before v2)
        const ok = await this.permit({ tool_name: "Bash", input: { command: unwrapShell(p.command), description: p.reason || undefined }, tool_use_id: p.callId });
        return { decision: ok.allow ? "approved" : { denied: { rejection: ok.message || "The user declined." } } };
      }
      case "applyPatchApproval": {
        for (const f of Object.keys(p.fileChanges || {})) {
          const abs = path.resolve(this.cwd, f);
          const ok = await this.permit({ tool_name: fs.existsSync(abs) ? "Edit" : "Write", input: { file_path: abs } });
          if (!ok.allow) return { decision: { denied: { rejection: ok.message || "The user declined." } } };
        }
        return { decision: "approved" };
      }
      default: return declineAnswer(method);
    }
  }

  async permit(req) {
    try { return (this.h.onPermission && await this.h.onPermission(req)) || { allow: false, message: "Not allowed here." }; }
    catch (e) { return { allow: false, message: e.message }; }
  }

  noteDeclined(itemId, message) {
    const t = this.turn;
    if (!t) return;
    (t.declined = t.declined || new Map()).set(itemId, message || "The user declined.");
  }

  async approveCommand(p) {
    const command = unwrapShell(p.command || "");
    if (this.turn) this.tool(p.itemId, "Bash", { command });
    const ans = await this.permit({ tool_name: "Bash", input: { command, ...(p.reason ? { description: p.reason } : {}) }, tool_use_id: p.itemId });
    if (!ans.allow) this.noteDeclined(p.itemId, ans.message);
    return { decision: ans.allow ? "accept" : "decline" };
  }

  // Before Codex changes files: Kural is asked once per file (it keeps a copy of each for Undo), then Codex gets
  // its answer. The files come from the item Codex started just before asking.
  async approveFiles(p) {
    const changes = (this.turn && this.turn.files.get(p.itemId)) || [];
    if (this.turn) this.fileTools(p.itemId);
    for (const c of changes) {
      const files = [path.resolve(this.cwd, c.path)];
      if (c.kind && c.kind.move_path) files.push(path.resolve(this.cwd, c.kind.move_path));   // a rename: both names
      for (const abs of files) {
        const ans = await this.permit({ tool_name: fs.existsSync(abs) ? "Edit" : "Write", input: { file_path: abs } });
        if (!ans.allow) { this.noteDeclined(p.itemId, ans.message); return { decision: "decline" }; }
      }
    }
    return { decision: "accept" };
  }

  // Codex's question → Kural's question card (AskUserQuestion) → Codex's answer shape ({ answers: { id: { answers: [] } } }).
  async askUser(p) {
    const qs = p.questions || [];
    const questions = qs.map((q) => ({ question: q.question, header: q.header || "", multiSelect: false,
      options: (q.options || []).map((o) => ({ label: o.label, description: o.description || "" })) }));
    if (this.turn) this.tool(p.itemId, "AskUserQuestion", { questions });
    const ans = await this.permit({ tool_name: "AskUserQuestion", input: { questions }, tool_use_id: p.itemId });
    const got = (ans.allow && ans.updatedInput && ans.updatedInput.answers) || {};
    const answers = {};
    for (const q of qs) {
      const a = got[q.question];
      if (a === undefined || a === null || a === "") continue;
      answers[q.id] = { answers: Array.isArray(a) ? a.map(String) : [String(a)] };
    }
    return { answers };
  }
}

// A command → the chat's card: reading one file shows as Read, a search as Grep, anything else as Bash.
function commandTool(item, cwd) {
  const acts = item.commandActions || [];
  if (acts.length === 1 && acts[0].type === "read" && acts[0].path) return ["Read", { file_path: path.resolve(item.cwd || cwd, acts[0].path) }];
  if (acts.length === 1 && acts[0].type === "search" && acts[0].query) return ["Grep", { pattern: acts[0].query, ...(acts[0].path ? { path: acts[0].path } : {}) }];
  return ["Bash", { command: unwrapShell(item.command) }];
}

module.exports = { CodexAgent, findCodex, codexVersion, codexAuth, codexLogout, codexRateLimits, codexModels, codexTest, askCodex,
  loginCommand, codexLogin, setLog, NOT_LOGGED_IN, _test: { AppServer, unwrapShell, editInput, friendlyError, windowLabel, rateReport, resolveBin, command, limits } };
