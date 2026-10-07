// Google Gemini in Kural: Google's Antigravity CLI (`agy`), Google's models (Gemini and others) with your Google account
// (free, AI Pro, Ultra). Google stopped personal accounts in Gemini CLI on 26 Sept 2026 and moved them here; Kural shows
// it as "Google Gemini" (texts say Gemini; "Antigravity" where it's about the program itself). No vscode inside.
//
// agy has no protocol for editors (no ACP), so Kural runs it the way it runs Claude Code: one process per chat, in its
// stream-json mode, and turns its events into Claude Code's stream-json events (so the chat needs no special code):
//   agy --input-format stream-json --output-format stream-json --disable-slash-commands --print-timeout 12h
//       --add-dir <project> [--model <id>] [mode flags] [--conversation <id>]
//   stdin, one line per message:  {"event":"user","message":{"role":"user","content":"…"}}   (text only)
//   stdout: {"event":"init","conversation_id",…}  (once, ~2 s after start)
//           {"event":"step_update","step_update":{step_index,state ACTIVE|DONE|ERROR,step_type,…}}
//             step_type "agent_response": text_delta while ACTIVE, usage when DONE
//             step_type "tool": tool_info {name, parameters} when ACTIVE; output / error when DONE / ERROR
//           {"event":"result","result":{status SUCCESS|ERROR,response,error,usage,denied_actions}}   (ends the answer)
//   --add-dir <project> matters: without it agy works in its own scratch folder. --disable-slash-commands: a message
//   starting with "/" would otherwise be a command (and "/usage" ends the session).
//
// Asking before acting: agy can't ask Kural (or anyone) in this mode; each action is allowed or not by its mode alone.
//   Ask → agy's default (reads only)   Plan → --mode plan   Agent → --mode accept-edits (edits yes, commands no:
//   Kural says which commands it didn't run)   Auto → --dangerously-skip-permissions (everything, like Kural's Auto).
// A mode or model is fixed when agy starts: a change starts a new agy in the same conversation (--conversation).
// Stop: SIGINT (agy ends the answer as "interrupted" and exits); the next message starts it again, same conversation.
//
// Logging in needs agy's own screen in a terminal (it has no login command); Get started opens one and closes it when
// you're logged in. Pictures can't be sent: they're saved to a folder agy may read, and the message says where.

const fs = require("fs");
const os = require("os");
const { privateTmp } = require("../paths");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const usage = require("./usage");

const IS_WIN = process.platform === "win32";
const MIN_VERSION = "1.1.15";   // stream-json input
const RAW_LOG = process.env.KURAL_RAW_LOG;   // debugging: every line to and from agy
const raw = (dir, line) => { if (RAW_LOG) { try { fs.appendFileSync(RAW_LOG, `agy ${dir} ${line}\n`, { mode: 0o600 }); } catch { /* debugging only */ } } };
let log = () => {};
const setLog = (f) => { log = f || (() => {}); };

const NOT_LOGGED_IN = "Google Gemini isn't logged in. Log in from Get started (Google Gemini → Log in).";
// (The real agy 1.2.16, logged out, in print mode: "error: authentication failed or timed out".)
const LOGIN_RE = /not logged in|no controlling terminal|You are not logged into Antigravity|auth(entication)? (error|failed|timed out)|sign in/i;

// ---------- finding and running agy ----------

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

async function findAgy(chosenPath) {
  const home = os.homedir();
  const chosen = String(chosenPath || "").trim().replace(/^~(?=$|[\\/])/, home);
  if (chosen) return isFile(chosen) ? chosen : null;
  const names = IS_WIN ? ["agy.exe"] : ["agy"];
  const dirs = [...(process.env.PATH || "").split(path.delimiter).filter(Boolean)];
  // Where Google's installer puts it.
  if (IS_WIN) dirs.push(path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "agy", "bin"));
  else dirs.push(path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin");
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); if (isFile(p)) return p; }
  return IS_WIN ? null : fromShell();
}

// `command -v agy` in an interactive login shell (its installer adds ~/.local/bin to PATH there). Up to 8 s.
function fromShell() {
  return new Promise((resolve) => {
    const p = execFile(process.env.SHELL || "/bin/bash", ["-ilc", "command -v agy"], { cwd: os.tmpdir(), timeout: 8000, encoding: "utf8" }, (_e, stdout) => {
      const line = String(stdout || "").trim().split("\n").pop() || "";
      resolve(path.isAbsolute(line) && isFile(line) ? line : null);
    });
    if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(); }
  });
}

// Run `agy <args>` and wait. { status, stdout, stderr, error }. No terminal: agy never shows its login screen here.
function run(bin, args, { timeout = 30000, cwd } = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = execFile(bin, args, { cwd: cwd || quietDir(), env: cleanEnv(), timeout, encoding: "utf8", windowsHide: true, maxBuffer: 4 << 20 }, (error, stdout, stderr) =>
        resolve({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: stdout || "", stderr: stderr || "",
          error: error && (error.killed ? Object.assign(new Error("Gemini took too long to answer."), { code: "ETIMEDOUT" }) : typeof error.code === "string" ? error : null) }));
    } catch (e) { resolve({ status: null, stdout: "", stderr: "", error: e }); return; }
    if (p.stdin) { p.stdin.on("error", () => {}); p.stdin.end(); }
  });
}

// No auto-update while Kural drives it (an update mid-answer would restart it), and never "inside Antigravity".
function cleanEnv(extra) {
  const env = { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: "1", ...(extra || {}) };
  delete env.ANTIGRAVITY_AGENT; delete env.ANTIGRAVITY_CONVERSATION_ID;
  return env;
}

// An empty folder for questions that aren't about a project (agy looks around its folder).
function quietDir() {
  return privateTmp("agy");   // (only you can open it: lib/paths.js)
}

const older = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };

// "1.2.7" → "1.2.7" (or null). Too old for stream-json: null too (Get started then says to update).
async function agyVersion(bin) {
  const r = await run(bin, ["--version"], { timeout: 15000 });
  const v = /(\d+\.\d+\.\d+)/.exec(`${r.stdout}`);
  if (!v) return null;
  return older(v[1], MIN_VERSION) ? null : v[1];
}

// A slash command in print mode (no model turn, no quota): `agy --print /model --output-format json`.
async function slash(bin, cmd, timeout = 30000) {
  const r = await run(bin, ["--print", cmd, "--output-format", "json"], { timeout });
  const text = `${r.stdout}\n${r.stderr}`;
  let json = null;
  for (const line of r.stdout.split("\n").reverse()) { try { json = JSON.parse(line); break; } catch { /* not JSON */ } }
  if (!json) { try { json = JSON.parse(r.stdout); } catch { /* none */ } }
  return { r, text, json };
}

// { loggedIn, method, email }. agy has no "status" command: /model answers without a model turn when logged in.
async function agyAuth(bin) {
  const { r, text, json } = await slash(bin, "/model");
  if (LOGIN_RE.test(text) && !(json && json.status === "SUCCESS")) return { loggedIn: false, method: "", email: "" };
  if (json && json.status === "SUCCESS") return { loggedIn: true, method: "Google account", email: (/[\w.+-]+@[\w-]+\.[\w.-]+/.exec(json.response || "") || [""])[0] };
  return { loggedIn: null, method: "", email: "", error: (r.error && r.error.message) || lastLine(text) };
}

// agy's /logout, then its saved login itself: agy keeps it in the system's keyring (Mac keychain item "gemini" /
// "antigravity", made with the `security` program, so removing it asks nothing; Linux Secret Service; Windows
// Credential Manager "gemini:antigravity") or, without a keyring, in ~/.gemini/antigravity-cli/antigravity-oauth-token.
// `/logout` in print mode isn't sure to run (it may go to the model as a message), and a login left in the keyring
// signs the next agy in by itself, so "Log out" removes it too.
async function agyLogout(bin) {
  // (No check afterwards: asked while logged out, agy may open the browser to log in again.)
  await slash(bin, "/logout").catch(() => null);
  await forgetLogin();
  return { ok: true };
}
async function forgetLogin() {
  const quiet = (cmd, args) => new Promise((resolve) => {
    try { execFile(cmd, args, { cwd: os.tmpdir(), timeout: 5000, windowsHide: true }, () => resolve()); } catch { resolve(); }
  });
  if (process.platform === "darwin") await quiet("/usr/bin/security", ["delete-generic-password", "-s", "gemini", "-a", "antigravity"]);
  else if (IS_WIN) await quiet("cmdkey", ["/delete:gemini:antigravity"]);
  else await quiet("secret-tool", ["clear", "service", "gemini", "username", "antigravity"]);
  try { fs.rmSync(path.join(os.homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token"), { force: true }); } catch { /* gone */ }
}

// The command a terminal runs to log in: agy itself (its first screen is the Google login; it opens your browser).
function loginCommand(bin) { return /[\s"'$`\\]/.test(bin) ? (IS_WIN ? `& "${bin}"` : `'${bin.replace(/'/g, "'\\''")}'`) : bin; }

// ---------- logging in: agy's own screen, read by Kural ----------
//
// agy logs in only on its own screen (no login command). Depending on the computer it opens the browser itself, or
// shows a Google address and waits for the code Google gives you after you log in ("authorization code"). Kural runs
// that screen in a normal terminal (Get started) and reads what it shows (VS Code's terminal data event): it opens the
// login page itself (from the screen, or from agy's own "open the browser" call, caught by a stand-in `open` /
// `xdg-open` first on agy's PATH) and asks you for the code in a pop-up, then types it in. You can type there too.
// (It used to run agy through the `script` program to read the screen; the Mac's `script` quits at once when it isn't
// started from a terminal, so the login screen closed in under a second.)

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][\w]|\x1b[=>78DEHM]/g;
const strip = (s) => String(s || "").replace(ANSI, "");

// A login address in agy's screen, also when the screen wrapped it over several lines (a full line followed by more
// address characters). cols: the screen's width.
function findLoginUrl(text, cols) {
  const lines = strip(text).replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /https:\/\/[^\s"'<>]+/.exec(lines[i]);
    if (!m) continue;
    let url = m[0];
    // Wrapped: the address ran to the end of the line, and the next line goes on with address characters only.
    // (cols 0: the width isn't known; then a line that ends with the address and a next line of address characters
    // only, with at least one of / ? = & %, count as one.)
    const full = (l) => cols ? l.trimEnd().length >= cols - 1 : /https:\/\/\S+$|^[^\s"'<>]+$/.test(l.trimEnd());
    const more = (l) => /^[^\s"'<>]+$/.test(l.trim()) && (cols || /[\/?=&%]/.test(l));
    for (let j = i; full(lines[j] || "") && more(lines[j + 1] || ""); j++) url += lines[j + 1].trim();
    if (/accounts\.google\.com|oauth|auth|login|signin/i.test(url)) return url;
  }
  return null;
}

// Is the screen waiting for the code? (Its last lines ask for a code, and nothing came after.)
function asksForCode(tail) {
  const lines = strip(tail).replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).slice(-4).join(" ");
  return /(enter|paste|type|input|provide)[^.]{0,60}\bcode\b|\b(authori[sz]ation|verification|authenticator|auth|login)\s+code\b|\bcode\s*[:>?]\s*$/i.test(lines);
}

// Is agy's login saved on this computer? true / false / null (can't tell here). Read without opening it (the keychain
// item's name only, or the token file), so nothing asks and no agy starts: Get started waits on this while you log
// in, instead of asking agy every few seconds (asked while logged out, agy may start a login of its own).
async function hasSavedLogin() {
  if (fs.existsSync(path.join(os.homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token"))) return true;
  const code = (cmd, args) => new Promise((resolve) => {
    try { execFile(cmd, args, { cwd: os.tmpdir(), timeout: 5000, windowsHide: true }, (e) => resolve(e ? (typeof e.code === "number" ? e.code : -1) : 0)); } catch { resolve(-1); }
  });
  if (process.platform === "darwin") { const r = await code("/usr/bin/security", ["find-generic-password", "-s", "gemini", "-a", "antigravity"]); return r === 0 ? true : r === 44 ? false : null; }
  if (!IS_WIN) { const r = await code("secret-tool", ["search", "service", "gemini", "username", "antigravity"]); return r === 0 ? true : null; }
  return null;
}

// What Get started needs to run the login screen in a terminal and read it (no vscode here):
//   shellPath, env  for the terminal (agy itself; the stand-in `open` first on its PATH, no auto-update)
//   feed(data)      what the screen showed (finds the login address and the question for the code)
//   codeGiven()     after typing a code: a new question for one counts again
//   dispose()
// onUrl(url) once per address; onCode() when the screen waits for the code.
function loginSession(bin, { onUrl, onCode } = {}) {
  const seen = new Set();
  const url = (u) => { if (u && /^https?:\/\//.test(u) && !seen.has(u)) { seen.add(u); onUrl && onUrl(u); } };
  // The stand-in browser opener (Mac, Linux): agy's "open the browser" writes the address to a file Kural reads.
  let shim = null, poll = null;
  if (!IS_WIN) {
    shim = fs.mkdtempSync(path.join(os.tmpdir(), "kural-agy-open-"));
    const urls = path.join(shim, "urls.txt");
    fs.writeFileSync(urls, "", { mode: 0o600 });
    const quoted = `'${urls.replace(/'/g, "'\\''")}'`;
    for (const n of ["open", "xdg-open"]) fs.writeFileSync(path.join(shim, n), `#!/bin/sh\nfor a in "$@"; do last="$a"; done\nprintf '%s\\n' "$last" >> ${quoted}\n`, { mode: 0o700 });
    poll = setInterval(() => { try { fs.readFileSync(urls, "utf8").split("\n").forEach(url); } catch { /* not yet */ } }, 300);
  }
  let all = "", tail = "", idle = null, asked = false;
  return {
    shellPath: bin,
    env: { AGY_CLI_DISABLE_AUTO_UPDATE: "1", ANTIGRAVITY_AGENT: null, ANTIGRAVITY_CONVERSATION_ID: null,
      ...(shim ? { PATH: `${shim}${path.delimiter}${process.env.PATH || ""}` } : {}) },
    feed(d) {
      const s = String(d);
      all = (all + s).slice(-20000);
      tail = (tail + s).slice(-3000);
      url(findLoginUrl(all, 0));
      clearTimeout(idle);
      // Waiting for the code: the screen stops changing on a line that asks for it.
      idle = setTimeout(() => { if (!asked && asksForCode(tail)) { asked = true; onCode && onCode(); } }, 600);
    },
    codeGiven() { tail = ""; asked = false; },
    // The screen's last line (for "the login screen closed: …").
    lastLine() { return lastLine(strip(all).replace(/\r/g, "\n")); },
    dispose() { clearInterval(poll); clearTimeout(idle); if (shim) fs.rm(shim, { recursive: true, force: true }, () => {}); },
  };
}

// Your models: `agy models` → "<id>\t<label>" lines. [{ id, label, description, isDefault }].
async function agyModels(bin) {
  const r = await run(bin, ["models"], { timeout: 30000 });
  const out = [];
  for (const line of r.stdout.split("\n")) {
    const [id, label] = line.split("\t").map((s) => (s || "").trim());
    if (id && /^[\w.:-]+$/.test(id)) out.push({ id, label: label || id, description: "", isDefault: false });
  }
  return groupModels(out).slice(0, 40);
}

// agy lists one model per thinking level ("gemini-3.8-flash-high" = "Gemini 3.8 Flash (High)"). Kural already has
// that choice (the intensity: Low, Medium, High, Max), so the menu shows each model once, and the intensity picks
// the level: { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", efforts: { low: "…-low", high: "…-high" } }.
// Safe to run on a list that's grouped already.
const LEVEL = /^(.*?)[-_](minimal|low|medium|high|xhigh|max)$/i;
function splitLevel(id) { const m = LEVEL.exec(String(id || "")); return m ? { base: m[1], level: m[2].toLowerCase() } : null; }
function groupModels(list) {
  const out = [], byBase = new Map(), plain = new Set();
  for (const m of list || []) {
    const sp = splitLevel(m.id);
    if (!sp && !(m.efforts && Object.keys(m.efforts).length)) plain.add(m.id);
    if (!sp) { if (!byBase.has(m.id)) { const e = { ...m }; byBase.set(m.id, e); out.push(e); } else Object.assign(byBase.get(m.id), { label: m.label || byBase.get(m.id).label }); continue; }
    let g = byBase.get(sp.base);
    if (!g) { g = { id: sp.base, label: String(m.label || sp.base).replace(/\s*\((minimal|low|medium|high|xhigh|max)\)\s*$/i, ""), description: m.description || "", isDefault: false, efforts: {} }; byBase.set(sp.base, g); out.push(g); }
    g.efforts = { ...(g.efforts || {}), [sp.level]: m.id };
    if (m.isDefault) g.isDefault = true;
  }
  // A model listed both plain and with levels ("gemini-3-pro" and "gemini-3-pro-high"): the plain one is its Medium,
  // so it can still be picked.
  for (const g of out) if (g.efforts && !g.efforts.medium && plain.has(g.id)) g.efforts = { ...g.efforts, medium: g.id };
  return out;
}
// Which of agy's models to run for Kural's intensity (low, medium, high, max). A model without levels: itself.
const NEAREST = { minimal: ["minimal", "low", "medium", "high"], low: ["low", "minimal", "medium", "high"], medium: ["medium", "high", "low"],
  high: ["high", "medium", "xhigh", "low"], max: ["max", "xhigh", "high", "medium", "low"] };
function variantFor(models, id, effort) {
  if (!id) return id;
  const m = (models || []).find((x) => x.id === id);
  if (!m || !m.efforts || !Object.keys(m.efforts).length) return id;
  for (const lv of NEAREST[effort] || NEAREST.medium) if (m.efforts[lv]) return m.efforts[lv];
  return Object.values(m.efforts)[0];
}

// Weekly limits: `/usage` answers with lines like "Gemini Models\tWeekly Limit Remaining\t99%".
async function agyLimits(bin) {
  try {
    const { json } = await slash(bin, "/usage");
    const windows = parseUsage(json && json.response);
    if (windows.length) usage.report("agy", { windows });
    return windows.length ? { windows } : null;
  } catch { return null; }
}
function parseUsage(text) {
  const windows = [];
  for (const line of String(text || "").split("\n")) {
    const cols = line.split("\t").map((s) => s.trim()).filter(Boolean);
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(cols[cols.length - 1] || "");
    if (!pct || cols.length < 2) continue;
    const remaining = /remaining/i.test(line);
    const used = remaining ? 100 - Number(pct[1]) : Number(pct[1]);
    windows.push({ id: cols[0].toLowerCase().replace(/\W+/g, "_"), label: cols[0].replace(/ Models?$/i, ""), usedPercent: Math.max(0, Math.min(100, used)), resetsAt: null,
      ...(/week/i.test(line) ? { period: "week" } : {}) });
  }
  // The one closest to its limit first: that's the one the status bar shows.
  return windows.sort((a, b) => b.usedPercent - a.usedPercent).slice(0, 4);
}

const lastLine = (s) => String(s || "").split("\n").map((l) => l.trim()).filter((l) => l && !/^(warning|jetski):/i.test(l)).pop() || "";

// agy's errors in plain words.
function friendly(text) {
  const t = String(text || "");
  if (LOGIN_RE.test(t)) return NOT_LOGGED_IN;
  const err = /AGY_ERROR:\s*(\{.*\})/.exec(t);
  if (err) { try { const e = JSON.parse(err[1]); return `Gemini: ${e.message || e.error || err[1]}`; } catch { /* as text */ } }
  if (/quota|rate limit|429|RESOURCE_EXHAUSTED/i.test(t)) return "Gemini: you've reached your plan's limit for now. It resets later (see your usage).";
  return `Gemini: ${lastLine(t) || "it stopped."}`;
}

// ---------- the chat: one agy per chat ----------

const MODE_FLAGS = { ask: [], plan: ["--mode", "plan"], agent: ["--mode", "accept-edits"], auto: ["--dangerously-skip-permissions"] };

class AgyAgent {
  // opts: name, bin, model ("" = agy's own), mode, cwd, addDirs, appendSystemPrompt, sessionId / resume (Kural's id),
  //   store (folder for the Kural id → agy conversation id list), env.
  // handlers: onMessage(msg), onPermission(req) (only to let the chat keep a copy of a file before agy changes it,
  //   for Undo: agy doesn't wait for the answer), onExit({code, login, stderr})
  constructor(opts, handlers) {
    this.opts = { ...opts };
    this.h = handlers || {};
    this.base = opts.model || "";                                     // the model as the menu shows it
    this.model = variantFor(opts.models, this.base, opts.effort) || "";  // agy's own id for it at this intensity
    this.mode = MODE_FLAGS[opts.mode] ? opts.mode : "agent";
    this.sessionId = opts.resume || opts.sessionId || crypto.randomUUID();
    const saved = opts.resume ? this.lookup() : null;
    this.conv = saved && saved.agy;                       // agy's conversation id
    // Kural's instructions are in that conversation already, for this mode. (Another mode: its instructions go again,
    // or after Ask → Agent the model would still think it may only answer.)
    this.primed = !!(saved && saved.agy && saved.mode === this.mode);
    this.queue = [];
    this.busy = false;
    this.turn = null;
    this.exited = false;
    this.proc = null;
    this.ready = false;
    this.files = path.join(quietDir(), `files-${crypto.randomBytes(6).toString("hex")}`);   // pictures you attach
    this.usedSoFar = { input: 0, output: 0 };   // agy's usage adds up per process
  }

  cwd() { return this.opts.cwd || process.cwd(); }
  emit(m) { if (this.exited) return; try { this.h.onMessage && this.h.onMessage({ session_id: this.sessionId, ...m }); } catch { /* the chat logs its own */ } }

  start() {
    if (!this.opts.bin || !isFile(this.opts.bin)) return false;
    setImmediate(() => this.spawn());
    return true;
  }

  args() {
    const a = ["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands", "--print-timeout", "12h",
      "--add-dir", this.cwd()];
    for (const d of this.opts.addDirs || []) a.push("--add-dir", d);
    try { fs.mkdirSync(this.files, { recursive: true, mode: 0o700 }); a.push("--add-dir", this.files); } catch { /* no pictures then */ }
    if (this.model) a.push("--model", this.model);
    a.push(...MODE_FLAGS[this.mode]);
    if (this.conv) a.push("--conversation", this.conv);
    return a;
  }

  spawn() {
    if (this.exited || this.proc) return;
    this.ready = false;
    this.started = false;   // this agy said "init"
    this.stderr = "";
    let p;
    try {
      // Its own process group (not on Windows): agy starts helpers (a language server, MCP servers) that should stop with it.
      p = spawn(this.opts.bin, this.args(), { cwd: this.cwd(), env: cleanEnv(this.opts.env), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: !IS_WIN });
    } catch (e) { this.failStart(e.message); return; }
    this.proc = p;
    let buf = "";
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) this.line(line); } });
    p.stderr.setEncoding("utf8");
    p.stderr.on("data", (d) => { this.stderr = (this.stderr + d).slice(-8000); });
    p.stdin.on("error", () => {});
    p.on("error", (e) => { this.stderr += `\n${e.message}`; });
    p.on("exit", (code) => this.onProcessExit(p, code));
    // agy says "init" ~2 s after starting (5–6 s on Windows). Not in 90 s: something is wrong (login, network).
    this.initTimer = setTimeout(() => { if (!this.ready && this.proc === p) { this.failStart(this.stderr || "Gemini (the Antigravity program) didn't start in 90 s."); } }, 90000);
  }

  line(text) {
    raw("<<", text);
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.event === "init") return this.onInit(m);
    if (m.event === "step_update") return this.onStep(m.step_update || {});
    if (m.event === "result") return this.onResult(m.result || {});
  }

  onInit(m) {
    clearTimeout(this.initTimer);
    this.started = true;
    const id = m.conversation_id || (m.init && m.init.conversation_id);
    // An unknown --conversation silently starts a new one: then the instructions have to come again.
    if (this.conv && id && id !== this.conv) { log(`agy: conversation ${this.conv} not found; new one ${id}`); this.primed = false; }
    if (id) { this.conv = id; this.remember(); }
    if (!this.announced) {
      this.announced = true;
      this.emit({ type: "system", subtype: "init", model: (m.init && m.init.model) || this.model || "Gemini", tools: [], mcp_servers: [] });
    }
    this.ready = true;
    this.next();
  }

  // Couldn't start: answer a waiting message with the reason, then stop.
  failStart(why) {
    if (this.exited) return;
    const login = LOGIN_RE.test(String(why || ""));
    const text = login ? NOT_LOGGED_IN : friendly(why);
    if (this.queue.length || this.busy) { this.queue = []; this.busy = false; this.turn = null; this.emit({ type: "result", subtype: "error", is_error: true, result: text, duration_ms: 0 }); }
    this.finish({ code: login ? 1 : -1, login, stderr: login ? text : String(why || "").slice(-2000) });
  }

  // Kural's id → agy's conversation id, in a small JSON file (so a chat reopened later continues the same conversation).
  mapFile() { return this.opts.store ? path.join(this.opts.store, "agy-sessions.json") : null; }
  lookup() { try { return JSON.parse(fs.readFileSync(this.mapFile(), "utf8"))[this.sessionId] || null; } catch { return null; } }
  remember() {
    const f = this.mapFile();
    if (!f) return;
    try {
      let all = {};
      try { all = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* first one */ }
      all[this.sessionId] = { agy: this.conv, mode: this.primedMode || (all[this.sessionId] || {}).mode, cwd: this.cwd(), at: Date.now() };
      const keep = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 500);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(Object.fromEntries(keep)));
    } catch { /* best effort */ }
  }

  send(content) {
    if (this.exited) return;
    this.queue.push(content);
    if (!this.proc) this.spawn(); else this.next();
  }

  // Claude-style blocks → agy's text. Pictures and PDFs are saved where agy may read them, and the message says where.
  toText(content) {
    const parts = [];
    let n = 0;
    for (const b of typeof content === "string" ? [{ type: "text", text: content }] : content || []) {
      if (!b) continue;
      if (b.type === "text" && b.text) parts.push(b.text);
      else if ((b.type === "image" || b.type === "document") && b.source && b.source.type === "base64" && b.source.data) {
        const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf" }[b.source.media_type] || "bin";
        const f = path.join(this.files, `attached-${Date.now()}-${++n}.${ext}`);
        try { fs.writeFileSync(f, Buffer.from(b.source.data, "base64"), { mode: 0o600 }); parts.push(`(Attached ${ext === "pdf" ? "PDF" : "picture"}: ${f}. Open it with your file tool to see it.)`); } catch { /* skip it */ }
      } else if (b.type === "document" && b.source && b.source.type === "text") parts.push(b.source.data || "");
    }
    let text = parts.join("\n\n");
    if (!this.primed && this.opts.appendSystemPrompt) text = `<kural_instructions>\n${this.opts.appendSystemPrompt}\n</kural_instructions>\n\n${text}`;
    return text;
  }

  next() {
    if (this.busy || !this.ready || this.exited || !this.proc) return;
    const content = this.queue.shift();
    if (content === undefined) return;
    this.busy = true;
    this.stopped = false;
    this.turn = { t0: Date.now(), text: "", segment: "", block: null, tools: new Map(), denied: [] };
    const priming = !this.primed;
    const line = JSON.stringify({ event: "user", message: { role: "user", content: this.toText(content) } });
    this.primed = true;
    if (priming) { this.primedMode = this.mode; this.remember(); }
    raw(">>", line);
    try { this.proc.stdin.write(line + "\n"); } catch (e) { this.endTurn({ type: "result", subtype: "error", is_error: true, result: friendly(e.message) }); }
  }

  // ---------- what agy streams ----------

  onStep(s) {
    if (!this.turn) return;
    const type = s.step_type;
    if (type === "agent_response") {
      const t = s.text_delta || (s.agent_response && s.agent_response.text_delta) || "";
      if (t) {
        this.open("text");
        this.turn.text += t; this.turn.segment += t;
        this.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
      }
      if (s.state === "DONE" || s.state === "ERROR") this.closeBlock();
      return;
    }
    if (type === "tool") return this.onTool(s);
    if (s.subagent_info && Array.isArray(s.subagent_info.subagents) && s.state === "ACTIVE" && !this.turn.tools.has(`sub${s.step_index}`)) {
      // A helper agent agy started: a card, like Claude's.
      const t = { id: `agy_${crypto.randomUUID()}`, name: "Task", input: { description: "Gemini helper", prompt: (s.subagent_info.subagents[0] || {}).task || "" }, done: false };
      this.turn.tools.set(`sub${s.step_index}`, t);
      this.closeBlock();
      this.emit({ type: "assistant", message: { role: "assistant", model: this.model || "antigravity", content: [{ type: "tool_use", id: t.id, name: t.name, input: t.input }] } });
    }
    if ((s.state === "DONE" || s.state === "ERROR") && this.turn.tools.has(`sub${s.step_index}`)) {
      const t = this.turn.tools.get(`sub${s.step_index}`);
      if (!t.done) this.toolResult(t, s.state === "ERROR" ? "Failed." : "Done.", s.state === "ERROR");
    }
  }

  onTool(s) {
    const key = `tool${s.step_index}`;
    const info = s.tool_info || {};
    let t = this.turn.tools.get(key);
    if (!t) {
      const d = describe(info.name || s.tool_name || "tool", info.parameters || {}, this.cwd());
      t = { id: `agy_${crypto.randomUUID()}`, name: d.name, input: d.input, done: false };
      this.turn.tools.set(key, t);
      this.closeBlock();
      this.turn.segment = "";   // the final answer is what comes after the last tool
      // A file about to change: let the chat keep a copy first (for Undo). agy doesn't wait, so it's a best effort.
      if ((d.name === "Edit" || d.name === "Write") && d.input.file_path && this.h.onPermission && (this.mode === "agent" || this.mode === "auto")) {
        Promise.resolve(this.h.onPermission({ tool_name: fs.existsSync(d.input.file_path) ? "Edit" : "Write", input: { file_path: d.input.file_path }, tool_use_id: t.id, notice: true })).catch(() => {});
      }
      this.emit({ type: "assistant", message: { role: "assistant", model: this.model || "antigravity", content: [{ type: "tool_use", id: t.id, name: t.name, input: t.input }] } });
    }
    if ((s.state === "DONE" || s.state === "ERROR") && !t.done) {
      const err = info.error && (info.error.message || info.error.type);
      if (err && /permission/i.test(err)) this.turn.denied.push(t);
      const out = err ? String(err) : typeof info.output === "string" ? info.output : info.output != null ? JSON.stringify(info.output) : "Done.";
      this.toolResult(t, out.slice(0, 20000), !!err || s.state === "ERROR");
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
  toolResult(t, text, isError) {
    t.done = true;
    this.emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: t.id, content: text, is_error: !!isError }] } });
  }

  onResult(r) {
    if (!this.turn) return;
    this.reportUsage(r.usage);
    const interrupted = this.stopped || /interrupt|cancel/i.test(`${r.error || ""} ${r.status || ""}`);
    // (agy exits after an interrupted answer: let it go now, so the next message starts a new one instead of writing
    // to this one while it's ending.)
    if (interrupted) { this.restart(); return this.endTurn({ type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped." }); }
    if (r.status && r.status !== "SUCCESS") return this.endTurn({ type: "result", subtype: "error", is_error: true, result: friendly(r.error || this.stderr || r.status) });
    let said = String(r.response || "").trim() || this.turn.segment.trim() || this.turn.text.trim();
    // Commands agy wasn't allowed to run (Agent mode): say so, and how to allow them.
    const denied = this.turn.denied.filter((t) => t.name === "Bash" || /^mcp__/.test(t.name));
    if (denied.length && this.mode !== "auto") {
      const what = denied.map((t) => (t.input && t.input.command) || t.name).slice(0, 3).map((c) => `\`${String(c).slice(0, 80)}\``).join(", ");
      const note = `\n\n(Gemini can't ask before running a command here, so in ${this.mode === "agent" ? "Agent" : this.mode === "plan" ? "Plan" : "Ask"} mode it didn't run: ${what}. Switch to Auto to let it run commands, or run them yourself.)`;
      said += note;
      // (The chat shows the streamed text: the note goes there too.)
      this.open("text");
      this.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: note } } });
    }
    this.endTurn({ type: "result", subtype: "success", is_error: false, result: said.trim() });
  }

  // agy's usage adds up over the process: report only what this answer added.
  reportUsage(u) {
    if (!u) return;
    const input = Number(u.input_tokens) || 0, output = (Number(u.output_tokens) || 0) + (Number(u.thinking_tokens) || 0);
    const d = { input: Math.max(0, input - this.usedSoFar.input), output: Math.max(0, output - this.usedSoFar.output) };
    this.usedSoFar = { input, output };
    if (!d.input && !d.output) return;
    usage.report("agy", { tokens: d });   // (today's line in the status bar's tooltip)
    usage.addTokens("agy", d);
    this.emit({ type: "kural_usage", tokens: { input: d.input, output: d.output, cacheRead: 0, cacheWrite: 0 }, context: null });
  }

  endTurn(result) {
    if (!this.turn) return;
    this.closeBlock();
    for (const t of this.turn.tools.values()) if (!t.done) this.toolResult(t, "Stopped.", true);
    const t0 = this.turn.t0;
    this.turn = null;
    this.busy = false;
    this.emit({ duration_ms: Date.now() - t0, ...result });
    this.next();
  }

  // ---------- control ----------

  setModel(m) {
    // Fixed when agy starts: the next message starts it again with this model, in the same conversation.
    this.base = m && m !== "default" ? m : "";
    const want = variantFor(this.opts.models, this.base, this.opts.effort) || "";
    if (want === this.model) return;
    this.model = want;
    if (!this.busy) this.restart();
  }

  // Start again on the next message (same conversation): new flags apply then.
  restart() {
    const p = this.proc;
    this.proc = null; this.ready = false; this.usedSoFar = { input: 0, output: 0 };
    clearTimeout(this.initTimer);
    if (p) this.killProc(p);
    // Messages already waiting (sent while agy was starting, or behind a stopped answer): a new agy for them.
    if (!this.exited && this.queue.length) setImmediate(() => { if (!this.proc && !this.exited) this.spawn(); });
  }

  request(req) { return Promise.resolve(req && req.subtype === "mcp_status" ? { mcpServers: [] } : {}); }
  control() { return null; }

  // Stop: agy ends the answer as "interrupted" on SIGINT and exits; the next message starts it again.
  interrupt() {
    if (!this.busy || !this.proc) return;
    this.stopped = true;
    const p = this.proc;
    this.signal(p, "SIGINT");
    // If it doesn't answer in 3 s, end the answer anyway.
    setTimeout(() => { if (this.busy && this.stopped && this.proc === p) { this.restart(); this.endTurn({ type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped." }); } }, 3000).unref();
  }

  signal(p, sig) {
    try { if (!IS_WIN && p.pid) process.kill(-p.pid, sig); else p.kill(sig); } catch { /* gone */ }
  }
  killProc(p) {
    try { p.stdin.end(); } catch { /* gone */ }
    this.signal(p, "SIGTERM");
    if (IS_WIN && p.pid) execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], () => {});
    else setTimeout(() => this.signal(p, "SIGKILL"), 2000).unref();
  }

  kill() {
    if (this.exited) return;
    this.queue = [];
    this.finish({ code: 0, login: false, stderr: "" });
  }

  finish(info) {
    if (this.exited) return;
    this.exited = true;
    clearTimeout(this.initTimer);
    if (this.proc) this.killProc(this.proc);
    this.proc = null;
    fs.rm(this.files, { recursive: true, force: true }, () => {});
    setImmediate(() => this.h.onExit && this.h.onExit(info));
  }

  // agy stopped by itself. Stopped by Kural (Stop, a new mode): the next message starts it again. Before "init": it
  // couldn't start (login, network). During an answer: that answer failed; the next message starts it again.
  onProcessExit(p, code) {
    if (this.proc !== p) return;   // an old one, replaced on purpose
    this.proc = null;
    this.ready = false;
    if (this.exited) return;
    // Stopped before it said "init" (no network, not logged in, a flag it refused): starting it again would fail the
    // same way, over and over. Answer what's waiting with the reason, and stop.
    if (!this.started) return this.failStart(this.stderr || `Gemini (the Antigravity program) stopped (exit code ${code}).`);
    if (this.busy) {
      if (this.stopped) this.endTurn({ type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped." });
      else this.endTurn({ type: "result", subtype: "error", is_error: true, result: friendly(this.stderr || `stopped (exit code ${code})`) });
    }
    if (LOGIN_RE.test(this.stderr)) this.finish({ code: 1, login: true, stderr: NOT_LOGGED_IN });
    else if (this.queue.length) this.spawn();
  }
}

// agy's tool → a tool the chat knows (Read, Edit, Bash…). Parameter names differ between agy versions, so the path,
// command or query is found by what it looks like, not by an exact name.
function describe(name, params, cwd) {
  const p = params && typeof params === "object" ? params : {};
  const pick = (re) => { for (const [k, v] of Object.entries(p)) if (re.test(k) && typeof v === "string" && v) return v; return ""; };
  const file = () => { const f = pick(/^(absolute_?path|target_?file|file_?path|path|file|filename)$/i) || pick(/path|file|target/i); return f ? path.resolve(cwd, f) : ""; };
  const n = String(name).toLowerCase();
  if (/^(view_file|read_file|view_file_outline|read)$/.test(n)) return { name: "Read", input: { file_path: file() } };
  if (/^(write_to_file|create_file|write_file|write)$/.test(n)) return { name: "Write", input: { file_path: file() } };
  if (/replace|edit|patch/.test(n)) return { name: "Edit", input: { file_path: file() } };
  if (/run_command|execute|shell|terminal|bash/.test(n)) return { name: "Bash", input: { command: pick(/command|cmd/i) || JSON.stringify(p).slice(0, 300), description: "" } };
  if (/grep/.test(n)) return { name: "Grep", input: { pattern: pick(/query|pattern|regex/i), path: pick(/path|dir/i) || undefined } };
  if (/find|glob|list_dir|list_files/.test(n)) return { name: "Glob", input: { pattern: pick(/pattern|glob|name/i) || "*", path: pick(/dir|path/i) || undefined } };
  if (/search_web|web_search/.test(n)) return { name: "WebSearch", input: { query: pick(/query|q/i) } };
  if (/url|fetch|browser/.test(n)) return { name: "WebFetch", input: { url: pick(/url/i) } };
  return { name: `mcp__agy__${String(name).replace(/[^\w.-]/g, "_") || "tool"}`, input: p };
}

// ---------- one question, one answer (Ask, Ctrl+K, commit messages) and Get started's test ----------

// One answer, read-only, through the same stream-json mode (long prompts don't fit a command line on Windows).
function askAgy(bin, { model, models, effort = "low", system, prompt, cwd, signal, timeout = 180000 } = {}) {
  model = variantFor(models, model, effort);   // (one-off questions: the quick level)
  return new Promise((resolve, reject) => {
    let text = "", done = false;
    const agent = new AgyAgent({ bin, model: model || "", mode: "ask", cwd: cwd || quietDir(), appendSystemPrompt: system || "" }, {
      onMessage: (m) => {
        if (m.type === "stream_event" && m.event && m.event.delta && m.event.delta.type === "text_delta") text += m.event.delta.text;
        if (m.type === "result") end(m.is_error ? Object.assign(new Error(m.result), { login: m.result === NOT_LOGGED_IN }) : null, m.result || text);
      },
      onExit: (info) => end(Object.assign(new Error(info.login ? NOT_LOGGED_IN : friendly(info.stderr)), { login: !!info.login })),
    });
    const timer = setTimeout(() => end(new Error("Gemini took too long to answer.")), timeout);
    function end(err, answer) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      agent.kill();
      if (err) reject(err); else resolve(String(answer || "").trim());
    }
    if (signal) { if (signal.aborted) { end(new Error("Stopped.")); return; } signal.addEventListener("abort", () => end(new Error("Stopped.")), { once: true }); }
    if (!agent.start()) { end(new Error("Kural can't find the agy program.")); return; }
    agent.send(prompt || "");
  });
}

async function agyTest(bin, { cwd, model } = {}) {
  const t0 = Date.now();
  try {
    const answer = await askAgy(bin, { model, cwd, prompt: "Reply with just the word OK.", timeout: 120000 });
    return { ok: true, ms: Date.now() - t0, answer };
  } catch (e) { return { ok: false, error: e.message, login: !!e.login }; }
}

module.exports = { AgyAgent, groupModels, variantFor, splitLevel, findAgy, agyVersion, agyAuth, agyLogout, agyModels, agyLimits, agyTest, askAgy, loginCommand, loginSession, hasSavedLogin, setLog,
  NOT_LOGGED_IN, MIN_VERSION, _test: { describe, parseUsage, friendly, findLoginUrl, asksForCode } };
