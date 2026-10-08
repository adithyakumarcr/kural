// Which files the AI may use without asking, and folders Kural never looks through on its own. No vscode here.
//
// Why: on a Mac, an app (or any program it starts) that opens Desktop, Documents, Downloads, Music, Pictures… makes
// macOS ask "Kural would like to access…". Asking for things Kural doesn't need makes people distrust it, so Kural
// stays inside your project unless you (or an answer you allow) point somewhere else.

const path = require("path");
const os = require("os");
const fs = require("fs");

const norm = (p) => process.platform === "win32" ? p.toLowerCase() : p;
const expand = (p) => String(p).replace(/^~(?=$|[\\/])/, os.homedir());

// The real place of a path (links followed), also for a file that doesn't exist yet (its nearest existing folder's).
// So a link inside the project that points at ~/.zshrc counts as ~/.zshrc. A link whose target doesn't exist yet
// (dangling) is followed too: writing through it would create the target, wherever it points.
function real(p, depth = 0) {
  let cur = path.resolve(expand(p)), rest = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch { /* not there yet, or a dangling link */ }
    if (depth < 16) {
      let to = null;
      try { to = fs.lstatSync(cur).isSymbolicLink() ? fs.readlinkSync(cur) : null; } catch { /* no such entry */ }
      if (to !== null) return path.join(real(path.resolve(path.dirname(cur), to), depth + 1), ...rest.reverse());
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.push(path.basename(cur)); cur = up;
  }
  return path.resolve(expand(p));
}

// Is `file` inside one of `roots` (or one of them itself)?
function within(file, roots) {
  if (!file) return false;
  const f = norm(real(file));
  return roots.filter(Boolean).some((r) => {
    const rel = path.relative(norm(real(r)), f);
    return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
  });
}

// Folders macOS guards with a question (and their Linux/Windows look-alikes), other people's home folders, and
// mounted disks. A folder walk never goes into these unless the walk started there.
const HOME_PROTECTED = ["Desktop", "Documents", "Downloads", "Library", "Music", "Pictures", "Movies", "Public",
  "Applications", ".Trash", "Photos Library.photoslibrary", "iCloud Drive (Archive)", "OneDrive", "Dropbox"];
const SYSTEM_PROTECTED = ["/Volumes", "/System", "/private", "/Users", "/home", "/proc", "/sys", "/dev", "/mnt", "/media", "/Network"];
let cache = null;
function protectedDirs() {
  const h = os.homedir();
  if (!cache || cache.home !== h) cache = { home: h, set: new Set([...HOME_PROTECTED.map((n) => norm(path.join(h, n))), ...SYSTEM_PROTECTED]) };
  return cache.set;
}
const isProtected = (dir) => protectedDirs().has(norm(path.resolve(dir)));

// Your home folder itself, or a folder above it ("/", "/Users"): looking through all of it would touch everything.
function isHomeOrAbove(dir) {
  if (!dir) return false;
  return within(os.homedir(), [dir]);
}

// Files that make the computer run something later, even inside the project (a git hook, a task, a workflow, a shell
// profile…). A model tricked by a README or web page could plant one, so writing one asks, like a command does.
const RUNS_LATER = [
  /(^|[\\/])\.git[\\/]hooks[\\/]/, /(^|[\\/])\.vscode[\\/](tasks|launch|settings)\.json$/,
  /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/, /(^|[\\/])\.codex[\\/]/, /(^|[\\/])\.gemini[\\/]/,
  /(^|[\\/])\.husky[\\/]/, /(^|[\\/])\.envrc$/, /(^|[\\/])\.env(\..*)?$/,
  /(^|[\\/])package\.json$/, /(^|[\\/])(Makefile|justfile|Taskfile\.ya?ml)$/,
  /(^|[\\/])\.github[\\/]workflows[\\/]/, /(^|[\\/])\.pre-commit-config\.yaml$/,
  /(^|[\\/])(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/,
  /(^|[\\/])\.(bashrc|zshrc|profile|bash_profile)$/,
];
const runsLater = (file) => RUNS_LATER.some((re) => re.test(String(file)));

// Only printable text on one line: a model's suggestion that hides a carriage return or an escape sequence could run a
// command in the terminal without Enter being pressed.
const hasControl = (s) => /[\x00-\x08\x0a-\x1f\x7f]/.test(String(s));

// A folder only this user can open, for Kural's short-lived files (made once per run). Not a fixed name in the
// shared temp folder: on Linux everyone can write there, so another user could plant a file or a link first.
let mine = null;
function privateTmp(sub) {
  if (!mine || !fs.existsSync(mine)) mine = fs.mkdtempSync(path.join(os.tmpdir(), "kural-"));   // (mode 0700)
  if (!sub) return mine;
  const d = path.join(mine, sub);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

module.exports = { runsLater, privateTmp, real, within, isProtected, isHomeOrAbove, hasControl, expand, HOME_PROTECTED };
