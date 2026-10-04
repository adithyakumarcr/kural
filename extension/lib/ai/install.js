// Installing Codex CLI / Gemini CLI without a terminal. No vscode here (lib/getstarted.js shows the progress and the
// pop-ups).
//
// Why not a terminal: the official one-liner ("brew install gemini-cli") fails on a Mac without Homebrew, and any
// question the installer asks ("continue? [y/N]", "press RETURN") waits in a terminal you may not even be looking at.
// So Kural picks the way this computer can actually do (Homebrew if it's there, else npm from Node.js), runs it in the
// background, and turns every question it asks into a pop-up (ask()), writing your answer back to it.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");

const IS_MAC = process.platform === "darwin", IS_WIN = process.platform === "win32";
const PACKAGES = {
  codex: { npm: "@openai/codex", brew: "codex", node: 18 },
  gemini: { npm: "@google/gemini-cli", brew: "gemini-cli", node: 20 },
};

// A Mac app started from the Dock gets a short PATH (no /opt/homebrew/bin, no nvm). Your shell's PATH has them all.
let shellPathCache = null;
function shellPath() {
  if (shellPathCache) return shellPathCache;
  shellPathCache = new Promise((resolve) => {
    if (IS_WIN || !process.env.SHELL) { resolve(""); return; }
    const c = execFile(process.env.SHELL, ["-ilc", "printf '\\n__KURAL_PATH__%s\\n' \"$PATH\""], { timeout: 8000, encoding: "utf8" }, (_e, out) => {
      const m = /__KURAL_PATH__(.*)/.exec(out || "");
      const found = m ? m[1].trim() : "";
      if (!found) shellPathCache = null;   // (try again next time: a slow or chatty shell start isn't forever)
      resolve(found);
    });
    // Nothing to read: a question in .zshrc (an update prompt) gets an end of input instead of waiting 8 s.
    try { c.stdin.end(); } catch { /* gone */ }
  });
  return shellPathCache;
}

// PATH for the install: yours, your shell's, and the usual places.
async function fullPath() {
  const home = os.homedir();
  const dirs = [...(process.env.PATH || "").split(path.delimiter), ...(await shellPath()).split(path.delimiter)];
  if (!IS_WIN) dirs.push("/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".npm-global", "bin"), path.join(home, ".volta", "bin"), "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  else dirs.push(path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"), path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"));
  const nvm = path.join(home, ".nvm", "versions", "node");
  const num = (v) => v.replace(/^v/, "").split(".").map(Number);
  const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
  try { for (const v of fs.readdirSync(nvm).sort(newer)) dirs.push(path.join(nvm, v, "bin")); } catch { /* no nvm */ }   // newest first (v22 before v9)
  return [...new Set(dirs.filter(Boolean))].join(path.delimiter);
}

function which(name, PATH) {
  for (const d of PATH.split(path.delimiter)) {
    const p = path.join(d, name);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
}

function nodeMajor(node, env) {
  return new Promise((resolve) => execFile(node, ["--version"], { timeout: 8000, env }, (e, out) => {
    const m = /^v(\d+)/.exec(String(out || "").trim());
    resolve(e || !m ? null : Number(m[1]));
  }));
}

// How this computer can install it: { how: "brew"|"npm", file, args, env, text } or { missing: "node", text, old? }.
async function installPlan(id) {
  const pkg = PACKAGES[id];
  const PATH = await fullPath();
  const env = { ...process.env, PATH,
    // No questions where there's a choice: Homebrew's installers, npx.
    NONINTERACTIVE: "1", npm_config_yes: "true", npm_config_fund: "false", npm_config_audit: "false", npm_config_update_notifier: "false" };
  if (IS_MAC) {
    const brew = which("brew", PATH);
    if (brew) return { how: "brew", file: brew, args: ["install", pkg.brew], env, text: `brew install ${pkg.brew}` };
  }
  const npm = which(IS_WIN ? "npm.cmd" : "npm", PATH);
  const node = which(IS_WIN ? "node.exe" : "node", PATH);
  if (!npm || !node) return { missing: "node", need: pkg.node, text: `npm install -g ${pkg.npm}` };
  const major = await nodeMajor(node, env);
  if (major && major < pkg.node) return { missing: "node", old: major, need: pkg.node, text: `npm install -g ${pkg.npm}` };
  return { how: "npm", file: npm, args: ["install", "-g", pkg.npm], env, text: `npm install -g ${pkg.npm}` };
}

// Is the installer waiting for an answer? `tail` is what it printed last (a question has no newline after it yet).
// { kind: "yesno" | "enter" | "secret", question } or null.
function promptIn(tail) {
  // A finished line isn't waiting for anything ("Proceed? (y)" printed as part of a log, with a newline after it).
  if (/[\r\n]\s*$/.test(String(tail || ""))) return null;
  const line = String(tail || "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n|\r/).filter((l) => l.trim()).pop() || "";
  const t = line.trim();
  if (!t || t.length > 400) return null;
  if (/(\[|\()\s*y(es)?\s*\/\s*n(o)?\s*(\]|\))\s*[:?]?\s*$/i.test(t) || /\(y\)\s*$/i.test(t) || /\b(proceed|continue)\?\s*$/i.test(t))
    return { kind: "yesno", question: t };
  if (/press (return|enter)|hit (return|enter)/i.test(t)) return { kind: "enter", question: t };
  if (/(password|passphrase)[^:]*:\s*$/i.test(t)) return { kind: "secret", question: t };
  return null;
}

// Run the plan. ask(prompt) -> Promise<string|null|undefined> (the text to type; null = stop the install; undefined =
// leave it unanswered). onOutput(text) for the log.
// Resolves { ok, code, output, cancelled }.
function runInstall(plan, { ask, onOutput, signal, quietMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let output = "", tail = "", asking = false, done = false;
    // Windows: npm is npm.cmd, which only starts through a shell (the arguments are fixed, nothing of yours in them).
    // (Quoted: "C:\Program Files\nodejs\npm.cmd" has a space.)
    const viaShell = IS_WIN && /\.cmd$/i.test(plan.file);
    const p = spawn(viaShell ? `"${plan.file}"` : plan.file, plan.args, { env: plan.env, windowsHide: true, shell: viaShell });
    // Stopping: on Windows npm runs under cmd.exe, and killing cmd.exe alone leaves npm running.
    const stop = () => {
      try { if (IS_WIN && p.pid) execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], () => {}); else p.kill(); } catch { /* gone */ }
    };
    const finish = (r) => { if (done) return; done = true; clearTimeout(idle); clearTimeout(quiet); resolve({ output, ...r }); };
    let idle = null, quiet = null;
    // (After an answer `tail` starts empty, so the same question is asked again only if the installer prints it again.)
    const put = (q) => {
      if (asking || done || !ask) return;
      asking = true;
      Promise.resolve().then(() => ask(q)).catch(() => undefined).then((answer) => {
        asking = false;
        if (done || answer === undefined) return;   // (undefined: leave it unanswered; the install goes on)
        if (answer === null) { stop(); finish({ ok: false, cancelled: true }); return; }
        tail = "";
        try { p.stdin.write(`${answer}\n`); } catch { /* gone */ }
      });
    };
    const check = () => { const q = promptIn(tail); if (q) put(q); };
    // Some other question Kural doesn't know: the installer printed a line without a newline and then nothing for 20 s.
    const unknown = () => {
      if (!tail || /[\r\n]\s*$/.test(tail) || /\d+(\.\d+)?%\s*$/.test(tail) || promptIn(tail)) return;   // (a line, or a progress bar)
      const line = tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean).pop();
      if (line && line.length < 300) put({ kind: "text", question: line });
    };
    const got = (d) => {
      const s = String(d);
      output = (output + s).slice(-100000);
      tail = (tail + s).slice(-2000);
      if (onOutput) onOutput(s);
      // A question shows as text that stops without a newline: look once the output pauses.
      clearTimeout(idle); idle = setTimeout(check, 400);
      clearTimeout(quiet); quiet = setTimeout(unknown, quietMs);
    };
    p.stdout.on("data", got);
    p.stderr.on("data", got);
    p.stdin.on("error", () => {});
    p.on("error", (e) => finish({ ok: false, code: -1, output: `${output}\n${e.message}` }));
    p.on("close", (code) => finish({ ok: code === 0, code }));
    if (signal) signal.addEventListener("abort", () => { stop(); finish({ ok: false, cancelled: true }); }, { once: true });
  });
}

// npm can't write to the shared global folder (Node.js from nodejs.org on a Mac, or a system Node on Linux): the
// same install into ~/.npm-global instead, which Kural looks in. No sudo needed.
function userPrefixPlan(plan) {
  const prefix = path.join(os.homedir(), ".npm-global");
  return { ...plan, args: [...plan.args, "--prefix", prefix], text: `${plan.text} --prefix ~/.npm-global` };
}
const noPermission = (out) => /EACCES|EPERM|permission denied/i.test(out || "");

// The whole install: the plan, then a retry into ~/.npm-global if npm had no permission.
async function install(id, opts = {}) {
  const plan = await installPlan(id);
  if (plan.missing) return { ok: false, plan };
  if (opts.onPlan) opts.onPlan(plan);
  let r = await runInstall(plan, opts);
  if (!r.ok && !r.cancelled && plan.how === "npm" && !IS_WIN && noPermission(r.output)) {
    const again = userPrefixPlan(plan);
    if (opts.onPlan) opts.onPlan(again);
    r = await runInstall(again, opts);
    return { ...r, plan: again };
  }
  return { ...r, plan };
}

// The last lines of a failed install, for the message.
function failure(output) {
  const lines = String(output || "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const err = lines.filter((l) => /error|ERR!|failed|not found/i.test(l));
  return (err.length ? err : lines).slice(-3).join("\n").slice(0, 500) || "The install stopped.";
}

module.exports = { install, installPlan, runInstall, promptIn, failure, PACKAGES, _test: { userPrefixPlan, noPermission, which } };
