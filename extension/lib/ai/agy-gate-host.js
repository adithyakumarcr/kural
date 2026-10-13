// Kural's side of the approval gate for Google Gemini (Antigravity, `agy`). No vscode here.
//
// agy has no editor protocol that waits for an answer, but it runs "hooks": a program before each tool call
// (PreToolUse) that can say allow or deny. Kural installs one hook entry, "kural-gate", in agy's global hooks file
// (~/.gemini/config/hooks.json; your own entries there are kept) whose command is a small launcher that
// runs lib/ai/agy-gate.js. When Kural starts agy for a chat it opens a gate session here: a random token, sent to the
// gate through agy's environment (KURAL_AGY_GATE) and, once the conversation id is known, a private registry entry.
// Each hook call comes to this process over a private local socket (a Unix socket in a 0700 folder; a named pipe on
// Windows), and Kural answers with the chat's own decision (permission-policy.js and the permission card).
//
// Fail closed: a session that ended (Stop, a restart, a mode change, the chat closed) answers deny, also to calls that
// were waiting. A hooks file Kural can't read is never overwritten: agy isn't started then (open() returns an error).
//
// The launcher and its registry live in ~/.kural/agy-gate (0700): a path without the spaces of "Application Support",
// since agy's docs don't say whether the hook command goes through a shell.

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { privateTmp, within } = require("../paths");

const IS_WIN = process.platform === "win32";
const KEY = "kural-gate";
const HOOK_TIMEOUT_S = 43200;          // 12 hours: a person may take a while to answer a card (the gate itself gives up a minute earlier)
const MAX_REQUEST = 1 << 20;
const FIRST_LINE_MS = 15000;
const GATE_JS = path.join(__dirname, "agy-gate.js");

const home = () => os.homedir();
// agy's global hooks file. Checked with the real agy 1.3.4 (scripts/verify-agy-gate.sh): it reads ~/.gemini/config/
// hooks.json; ~/.gemini/antigravity-cli/hooks.json (agy's changelog: "the /hooks command wrote to … instead of the
// shared ~/.gemini/config/hooks.json") is never read, so a gate there never ran.
const hooksDir = () => path.join(home(), ".gemini", "config");
const hooksFile = () => path.join(hooksDir(), "hooks.json");
const oldHooksFile = () => path.join(home(), ".gemini", "antigravity-cli", "hooks.json");
const gateDir = () => path.join(home(), ".kural", "agy-gate");
const registryDir = () => path.join(gateDir(), "conversations");
const launcherPath = () => path.join(gateDir(), IS_WIN ? "kural-agy-gate.cmd" : "kural-agy-gate");

// Files a model must not quietly change: agy's hook and settings files (all of ~/.gemini), Kural's launcher and
// registry, and a project's own agy hooks (.agents/hooks.json). Writes there ask, even in Auto (permission-policy.js).
function isGateFile(file) {
  if (!file) return false;
  if (/(^|[\\/])\.agents[\\/]hooks\.json$/i.test(String(file))) return true;
  return within(file, [path.join(home(), ".gemini"), path.join(home(), ".kural")]);
}

// ---------- installing the hook ----------

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
function launcherText(execPath, gateJs) {
  const reg = registryDir();
  if (IS_WIN) {
    // (cmd: `"` can't be escaped inside a quoted path, but paths can't contain it on Windows either.)
    return ["@echo off", "rem Kural's approval gate for Gemini (Antigravity). Written by Kural; it rewrites this file when it changes.",
      `set "KURAL_AGY_GATE_REGISTRY=${reg}"`,
      `if "%KURAL_AGY_GATE%"=="" if not exist "${reg}\\*.json" exit /b 0`,
      `if not exist "${execPath}" (`,
      `  if "%KURAL_AGY_GATE%"=="" exit /b 0`,
      "  echo {\"decision\":\"deny\",\"reason\":\"Kural isn't installed here any more.\",\"allow_tool\":false,\"deny_reason\":\"Kural isn't installed here any more.\"}",
      "  exit /b 0", ")",
      "set ELECTRON_RUN_AS_NODE=1",
      `"${execPath}" "${gateJs}"`,
      "exit /b 0", ""].join("\r\n");
  }
  return ["#!/bin/sh", "# Kural's approval gate for Gemini (Antigravity). Written by Kural; it rewrites this file when it changes.",
    "# Not started by Kural (no KURAL_AGY_GATE, no Kural conversation): nothing to say, agy goes on as without Kural.",
    `KURAL_AGY_GATE_REGISTRY=${shq(reg)}; export KURAL_AGY_GATE_REGISTRY`,
    `if [ -z "$KURAL_AGY_GATE" ] && [ -z "$(ls -A "$KURAL_AGY_GATE_REGISTRY" 2>/dev/null)" ]; then cat >/dev/null; exit 0; fi`,
    `if [ ! -x ${shq(execPath)} ]; then`,
    `  cat >/dev/null`,
    `  [ -z "$KURAL_AGY_GATE" ] && exit 0`,
    `  printf '%s\\n' '{"decision":"deny","reason":"Kural is not installed here any more.","allow_tool":false,"deny_reason":"Kural is not installed here any more."}'`,
    `  exit 0`, "fi",
    `ELECTRON_RUN_AS_NODE=1 exec ${shq(execPath)} ${shq(gateJs)}`, ""].join("\n");
}

function hookEntry(command) {
  return { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] }] };
}

// A folder only you own and can open (not a link). Throws with a plain reason otherwise.
function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`${dir} isn't a plain folder`);
  if (!IS_WIN) {
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error(`${dir} belongs to another user`);
    if (st.mode & 0o077) fs.chmodSync(dir, 0o700);
  }
}

function writeAtomic(file, text, mode) {
  const tmp = `${file}.kural-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, text, { mode });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
  if (!IS_WIN) fs.chmodSync(file, mode);
}

// Make sure agy's global hooks file runs Kural's gate, with today's launcher. { ok, launcher, changed } | { error }.
// Your own entries in the file stay as they are; the old file is kept as hooks.json.kural-backup when Kural changes it.
function ensureInstalled({ execPath = process.execPath, gateJs = GATE_JS } = {}) {
  try {
    privateDir(gateDir());
    privateDir(registryDir());
    const launcher = launcherPath();
    const want = launcherText(execPath, gateJs);
    let have = null; try { have = fs.readFileSync(launcher, "utf8"); } catch { /* none yet */ }
    let lst = null; try { lst = fs.lstatSync(launcher); } catch { /* none yet */ }
    if (have !== want || (lst && lst.isSymbolicLink()) || (!IS_WIN && lst && (lst.mode & 0o777) !== 0o700)) {
      if (lst && lst.isSymbolicLink()) fs.unlinkSync(launcher);
      writeAtomic(launcher, want, 0o700);
    }

    dropOldEntry();
    fs.mkdirSync(hooksDir(), { recursive: true, mode: 0o700 });
    const file = hooksFile();
    let text = null; try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    let cfg = {};
    if (text !== null && text.trim()) {
      try { cfg = JSON.parse(text); } catch { cfg = null; }
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg))
        return { error: `Kural can't read ${file} (it isn't a JSON object), so it can't add its approval gate there. Fix or move that file, then send your message again. Gemini isn't started without the gate.` };
    }
    const entry = hookEntry(launcher);
    if (JSON.stringify(cfg[KEY]) === JSON.stringify(entry)) return { ok: true, launcher, changed: false };
    if (text !== null) writeAtomic(`${file}.kural-backup`, text, 0o600);
    writeAtomic(file, JSON.stringify({ ...cfg, [KEY]: entry }, null, 2) + "\n", 0o600);
    return { ok: true, launcher, changed: true };
  } catch (e) {
    return { error: `Kural couldn't set up its approval gate for Gemini (${e.message}). Gemini isn't started without it.` };
  }
}

// Kural's entry in the file older Kural versions used (agy doesn't read it): taken out, your own entries stay. A file
// that isn't JSON is left alone (best effort: it does nothing either way).
function dropOldEntry() {
  const file = oldHooksFile();
  try {
    const text = fs.readFileSync(file, "utf8");
    const cfg = JSON.parse(text);
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg) || !(KEY in cfg)) return;
    delete cfg[KEY];
    writeAtomic(file, JSON.stringify(cfg, null, 2) + "\n", 0o600);
  } catch { /* no file, or not ours to fix */ }
}

// Is Kural's entry there, pointing at today's launcher? (For checks and tests.)
function installed() {
  try {
    const cfg = JSON.parse(fs.readFileSync(hooksFile(), "utf8"));
    return JSON.stringify(cfg[KEY]) === JSON.stringify(hookEntry(launcherPath())) && fs.existsSync(launcherPath());
  } catch { return false; }
}

// ---------- the gate's socket ----------

const hashOf = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

class GateHost {
  constructor() {
    this.sessions = new Map();   // sha256(token) -> session
    this.server = null;
    this.where = null;
  }

  start() {
    if (this.server) return this.where;
    const id = crypto.randomBytes(8).toString("hex");
    // (A short path: macOS allows 104 characters for a socket's path.)
    this.where = IS_WIN ? `\\\\.\\pipe\\kural-agy-gate-${id}` : path.join(privateTmp("g"), `${id}.sock`);
    const server = net.createServer((c) => this.connection(c));
    server.on("error", () => {});
    const old = process.umask(0o077);   // the socket: only you can open it (its folder is 0700 too)
    try { server.listen(this.where); } finally { process.umask(old); }
    server.unref();
    this.server = server;
    return this.where;
  }

  stop() {
    for (const h of [...this.sessions.keys()]) this.endHash(h);
    if (this.server) { try { this.server.close(); } catch { /* closed */ } this.server = null; }
    if (!IS_WIN && this.where) { try { fs.unlinkSync(this.where); } catch { /* gone */ } }
    this.where = null;
  }

  // A gate for one agy process. decide(call) -> Promise<{ allow, message? }>; call = { tool, args, event, stepIdx,
  // conversationId }. → { token, env, close(), register(conversationId) } | { error } (the hook couldn't be set up).
  open({ decide, install = ensureInstalled } = {}) {
    const inst = install();
    if (!inst || inst.error) return { error: (inst && inst.error) || "Kural couldn't set up its approval gate for Gemini." };
    this.start();
    const token = crypto.randomBytes(32).toString("hex");
    const h = hashOf(token);
    const s = { token, decide, ctl: new AbortController(), registered: [] };
    this.sessions.set(h, s);
    return {
      token,
      env: JSON.stringify({ socket: this.where, token }),
      close: () => this.endHash(h),
      register: (conv) => this.register(h, conv),
    };
  }

  // agy's conversation id → this session, for a hook that doesn't get agy's environment (agy-gate.js).
  register(h, conv) {
    const s = this.sessions.get(h);
    if (!s || !conv) return;
    try {
      privateDir(registryDir());
      const f = path.join(registryDir(), `${hashOf(conv)}.json`);
      writeAtomic(f, JSON.stringify({ socket: this.where, token: s.token }), 0o600);
      if (!s.registered.includes(f)) s.registered.push(f);
    } catch { /* the environment still carries it */ }
  }

  endHash(h) {
    const s = this.sessions.get(h);
    if (!s) return;
    this.sessions.delete(h);
    s.ctl.abort();
    for (const f of s.registered) { try { if (JSON.parse(fs.readFileSync(f, "utf8")).token === s.token) fs.unlinkSync(f); } catch { /* gone */ } }
  }

  connection(c) {
    let buf = "", done = false;
    c.setEncoding("utf8");
    c.on("error", () => {});
    const timer = setTimeout(() => { if (!done) c.destroy(); }, FIRST_LINE_MS);
    const reply = (r) => { if (done) return; done = true; clearTimeout(timer); try { c.end(JSON.stringify(r) + "\n"); } catch { /* closed */ } };
    c.on("data", (d) => {
      if (done) return;
      buf += d;
      const i = buf.indexOf("\n");
      if (i < 0) { if (buf.length > MAX_REQUEST) { done = true; clearTimeout(timer); c.destroy(); } return; }
      clearTimeout(timer);
      let req; try { req = JSON.parse(buf.slice(0, i)); } catch { req = null; }
      buf = "";
      this.handle(req).then(reply, (e) => reply({ decision: "deny", reason: `Kural: ${e.message}` }));
    });
  }

  lookup(token) {
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return null;
    const s = this.sessions.get(hashOf(token));
    if (!s) return null;
    const a = Buffer.from(s.token), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? s : null;
  }

  // One request, one decision.
  async handle(req) {
    const deny = (reason) => ({ decision: "deny", reason });
    if (!req || typeof req !== "object") return deny("Kural couldn't read the request.");
    const s = this.lookup(req.token);
    if (!s) return deny("This Gemini session isn't approved by Kural any more (it was stopped or restarted).");
    if (req.event !== "PreToolUse") return deny(`Kural's gate only answers PreToolUse, not ${String(req.event).slice(0, 40)}.`);
    if (typeof req.tool !== "string" || !req.tool || req.tool.length > 200) return deny("The request had no tool name.");
    const args = req.args && typeof req.args === "object" && !Array.isArray(req.args) ? req.args : {};
    if (s.ctl.signal.aborted) return deny("Stopped.");
    const stopped = new Promise((resolve) => s.ctl.signal.addEventListener("abort", () => resolve({ allow: false, message: "Stopped (the chat stopped, restarted or changed mode)." }), { once: true }));
    let r;
    try {
      r = await Promise.race([Promise.resolve(s.decide({ tool: req.tool, args, event: req.event, stepIdx: req.stepIdx, conversationId: String(req.conversationId || "") })), stopped]);
    } catch (e) { r = { allow: false, message: e.message }; }
    // (A session that ended while the card was open: its late "yes" doesn't count.)
    if (s.ctl.signal.aborted || this.lookup(req.token) !== s) return deny("Stopped (the chat stopped, restarted or changed mode).");
    return r && r.allow === true ? { decision: "allow" } : deny((r && r.message) || "Kural didn't approve this.");
  }
}

const host = new GateHost();

module.exports = { host, GateHost, ensureInstalled, installed, isGateFile, hooksFile, oldHooksFile, launcherPath, registryDir, gateDir, KEY, HOOK_TIMEOUT_S, GATE_JS, _test: { launcherText, hookEntry } };
