// Removing Kural's data from this computer ("Kural: Remove Kural's Data…", for uninstalling). No vscode here
// (test/remove-data.test.js).
//
// Uninstalling removes only the program: Windows' uninstaller deletes the install folder, Ubuntu's package manager may
// not touch home folders, and a Mac app goes to the Trash alone. What Kural keeps stays: chats and checkpoints (copies of
// your files), its SSH key for your devices (and that key on each device), the logins of your other profiles, connector
// keys, and its approval gate in Antigravity's settings. The command removes what only a running Kural can (the device
// keys, the gate entry, the connectors, the profile logins); then, once Kural has closed, a small script deletes the
// folders (this file decides which, and refuses anything that isn't plainly Kural's).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const GATE_KEY = "kural-gate";
const hooksFiles = (home) => [path.join(home, ".gemini", "config", "hooks.json"), path.join(home, ".gemini", "antigravity-cli", "hooks.json")];

// Is Kural's approval gate for Gemini installed anywhere? (Its entry in a hooks file, or its launcher folder.)
function gateInstalled(home = os.homedir()) {
  if (fs.existsSync(path.join(home, ".kural", "agy-gate"))) return true;
  return hooksFiles(home).some((f) => { try { return GATE_KEY in JSON.parse(fs.readFileSync(f, "utf8")); } catch { return false; } });
}

// Kural's entry taken out of Antigravity's hooks files (your own entries stay, written back atomically), the copy Kural
// kept of the file before it changed it (hooks.json.kural-backup) and Kural's launcher folder (~/.kural/agy-gate).
// → [{ file }, { file, error }]
function removeGate(home = os.homedir()) {
  const done = [];
  for (const file of hooksFiles(home)) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    let cfg = null;
    try { cfg = JSON.parse(text); } catch { /* not JSON */ }
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
      if (text.includes(GATE_KEY)) done.push({ file, error: `isn't readable JSON: take the entry "${GATE_KEY}" out by hand` });
      continue;
    }
    if (GATE_KEY in cfg) {
      delete cfg[GATE_KEY];
      const tmp = `${file}.kural-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
      fs.renameSync(tmp, file);
      done.push({ file });
    }
    try { fs.unlinkSync(`${file}.kural-backup`); } catch { /* none */ }
  }
  const gateDir = path.join(home, ".kural", "agy-gate");
  if (fs.existsSync(gateDir)) { fs.rmSync(gateDir, { recursive: true, force: true }); done.push({ file: gateDir }); }
  return done;
}

// The connectors whose key Kural keeps (added in Kural Settings with a token: lib/ai/connector-catalog.js keyFile): they
// stop working once Kural's folder is gone, so they're removed from Claude Code / Codex too. → [{ ai, name }]
function keyedConnectors(keyDir) {
  let files = [];
  try { files = fs.readdirSync(keyDir); } catch { return []; }
  const out = new Map();
  for (const f of files) {
    const m = /^(claude|codex)-([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\.(env|headers\.json)$/.exec(f);
    if (m) out.set(`${m[1]}:${m[2]}`, { ai: m[1], name: m[2] });
  }
  return [...out.values()];
}

// Inside `home` (never home itself).
function insideHome(p, home) {
  const r = path.relative(path.resolve(home), path.resolve(p));
  return !!r && !r.startsWith("..") && !path.isAbsolute(r);
}

// What a complete removal deletes once Kural has closed: Kural's user data folder (settings, chats, History, every
// extension's storage, caches), ~/.kural (extensions, the gate's launcher), ~/.kural-shared, and on a Mac its caches,
// saved window state, preferences and logs. Only what is plainly Kural's: the user data folder must be called "Kural"
// (not a folder given with --user-data-dir), and everything must be inside your home folder.
function wipeTargets({ userDataDir, home = os.homedir(), platform = process.platform } = {}) {
  const out = [];
  if (userDataDir && path.basename(userDataDir) === "Kural") out.push(path.resolve(userDataDir));
  out.push(path.join(home, ".kural"), path.join(home, ".kural-shared"));
  if (platform === "darwin") {
    const lib = path.join(home, "Library");
    out.push(path.join(lib, "Caches", "com.kural"), path.join(lib, "Caches", "com.kural.ShipIt"),
      path.join(lib, "Saved Application State", "com.kural.savedState"), path.join(lib, "HTTPStorages", "com.kural"),
      path.join(lib, "Preferences", "com.kural.plist"), path.join(lib, "Logs", "Kural"));
  }
  return out.filter((p) => insideHome(p, home));
}

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;     // sh
const qp = (s) => `'${String(s).replace(/'/g, "''")}'`;        // PowerShell

// The script's steps after Kural has quit (lib/updates.js afterQuit waits for that): delete each target, say what
// happened in the log. A Mac also forgets Kural's keychain item ("Kural Safe Storage") and the permissions you gave it.
function wipeSteps(targets, platform = process.platform) {
  if (platform === "win32") {
    return targets.map((t) => [
      `for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath ${qp(t)}); $i++) { Remove-Item -LiteralPath ${qp(t)} -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath ${qp(t)}) { Start-Sleep -Seconds 1 } }`,
      `if (Test-Path -LiteralPath ${qp(t)}) { Log ${qp(`failed: ${t} is still there`)} } else { Log ${qp(`deleted ${t}`)} }`,
    ].join("\r\n")).join("\r\n") + "\r\nLog 'done'";
  }
  const lines = targets.map((t) => `if [ -e ${q(t)} ] || [ -L ${q(t)} ]; then rm -rf ${q(t)} && log ${q(`deleted ${t}`)} || log ${q(`failed: ${t}`)}; fi`);
  if (platform === "darwin") {
    lines.push(`security delete-generic-password -s 'Kural Safe Storage' >/dev/null 2>&1 && log 'deleted the keychain item Kural Safe Storage'`,
      `defaults delete com.kural >/dev/null 2>&1 || true`,
      `tccutil reset All com.kural >/dev/null 2>&1 && log 'macOS forgot the permissions you gave Kural'`);
  }
  lines.push(`log 'done'`);
  return lines.join("\n");
}

module.exports = { GATE_KEY, gateInstalled, removeGate, keyedConnectors, wipeTargets, wipeSteps, insideHome };
