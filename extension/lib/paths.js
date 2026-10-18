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
  // (and the folder of everyone's homes, by its own name: C:\Users on Windows, where /Users and /home don't apply)
  if (!cache || cache.home !== h) cache = { home: h, set: new Set([...HOME_PROTECTED.map((n) => norm(path.join(h, n))), ...SYSTEM_PROTECTED, norm(path.dirname(h))]) };
  return cache.set;
}
const isProtected = (dir) => protectedDirs().has(norm(path.resolve(dir)));

// Your home folder itself, or a folder above it ("/", "/Users"): looking through all of it would touch everything.
function isHomeOrAbove(dir) {
  if (!dir) return false;
  return within(os.homedir(), [dir]);
}

// The folders macOS asks about ("Kural would like to access files in your Downloads folder", Apple Music for ~/Music,
// Photos for the library in ~/Pictures). An AI command in a chat with no folder open once ran `ls -d ~/*/ ~/*/*/` to look
// for a project, and macOS asked about all of them at once. So the AI's own looks there ask you first, in every mode
// (permission-policy.js), unless you attached what it reads.
const PRIVATE = ["Desktop", "Documents", "Downloads", "Music", "Pictures", "Movies", "Library/Mobile Documents"];
const HOME_RE = () => `(?:~|\\$HOME|\\$\\{HOME\\}|${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`;
// Programs that go through every folder under the one they're given (ls/grep only with their recursive flag).
// (Not mdfind or locate: they ask an index, they don't open the folders.)
const WALKERS = new Set(["find", "fd", "du", "tree", "rg", "ag", "rsync", "tar"]);
const RECURSIVE = new Set(["ls", "grep", "egrep", "fgrep", "cp", "scp", "zip", "chmod", "chown", "rm"]);

// Which private folder `p` is in ("Downloads"), or null.
function privateFolder(p) {
  if (!p) return null;
  const f = real(String(p)), h = os.homedir();
  for (const name of PRIVATE) if (within(f, [path.join(h, name)])) return name;
  return null;
}

// Why a shell command would make macOS ask about your private folders, or null. Best effort (a script can still look
// anywhere): what the command says in so many words. found: [{ folder, path? }]; a path only for a named one, so a file
// you attached there needn't ask.
function privateUse(command, cwd = "/") {
  const cmd = String(command || ""), found = [];
  const named = new RegExp(`${HOME_RE()}/(${PRIVATE.map((n) => n.replace(" ", "\\\\? ")).join("|")})(?=$|[/\\s'"*;|&)])([^\\s'";|&)]*)`, "g");
  for (const m of cmd.matchAll(named)) found.push({ folder: m[1].replace("\\", ""), path: path.normalize(expand(m[0].replace(/^\$\{?HOME\}?/, "~").replace(/\\ /g, " "))) });
  // A wildcard right in the home folder (~/*, $HOME/*/): it can mean any of them. (~/.* means only the dot files.)
  if (new RegExp(`${HOME_RE()}/+(?!\\.)[^/\\s'";|&]*[*?[{]`).test(cmd)) found.push({ folder: "home" });
  // A program that walks through everything below your home folder (or "/"), or below the folder it runs in when that is one.
  for (const part of cmd.split(/&&|\|\||[;|&\n]/)) {
    const words = part.trim().split(/\s+/).filter((w) => !/^\w+=/.test(w));
    while (words[0] === "sudo" || words[0] === "command" || words[0] === "exec" || words[0] === "time") words.shift();
    const prog = path.basename(words[0] || "");
    const flags = words.slice(1).filter((w) => w.startsWith("-")), args = words.slice(1).filter((w) => !w.startsWith("-"));
    const walks = WALKERS.has(prog) || (RECURSIVE.has(prog) && flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === "--recursive"));
    if (!walks) continue;
    const targets = args.length ? args : ["."];
    if (targets.some((t) => { const u = t.replace(/^['"]|['"]$/g, "").replace(/^\$\{?HOME\}?/, "~"); return !/[*?]/.test(u) && isHomeOrAbove(path.resolve(cwd, expand(u))); }))
      { found.push({ folder: "home" }); break; }
  }
  return found.length ? found : null;
}

// Words for a card: "your Downloads folder", "the folders in your home folder (Desktop, Downloads, Music…)".
function privateWords(found) {
  if (found.some((f) => f.folder === "home")) return "the folders in your home folder (Desktop, Documents, Downloads, Music, Pictures…)";
  const names = [...new Set(found.map((f) => f.folder === "Library/Mobile Documents" ? "iCloud Drive" : f.folder))];
  return `your ${names.join(" and ")} folder${names.length > 1 ? "s" : ""}`;
}

// Files that make the computer run something later, even inside the project (a git hook, a task, a workflow, a shell
// profile…). A model tricked by a README or web page could plant one, so writing one asks, like a command does.
const RUNS_LATER = [
  /(^|[\\/])\.git([\\/]|$)/, /(^|[\\/])\.vscode[\\/](tasks|launch|settings)\.json$/,
  /(^|[\\/])\.claude([\\/]|$)/, /(^|[\\/])\.codex[\\/]/, /(^|[\\/])\.gemini[\\/]/,
  /(^|[\\/])\.agents[\\/]/, /(^|[\\/])\.kural[\\/]/, /(^|[\\/])\.husky[\\/]/, /(^|[\\/])\.envrc$/, /(^|[\\/])\.env(\..*)?$/,
  /(^|[\\/])package\.json$/, /(^|[\\/])(Makefile|justfile|Taskfile\.ya?ml)$/,
  /(^|[\\/])\.github[\\/]workflows[\\/]/, /(^|[\\/])\.pre-commit-config\.yaml$/,
  /(^|[\\/])(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/,
  /(^|[\\/])\.(bashrc|zshrc|profile|bash_profile|bash_login|zshenv|zprofile|zlogin)$/, /(^|[\\/])\.config[\\/]fish[\\/]/,
  // Git settings that run programs (filters, diff drivers, submodule commands), editor/container settings that start
  // tasks or install extensions, AI instructions and MCP servers the next session obeys or starts.
  /(^|[\\/])\.git(attributes|modules)$/, /(^|[\\/])\.vscode[\\/]/, /(^|[\\/])\.devcontainer([\\/]|\.json$)/, /\.code-workspace$/,
  /(^|[\\/])\.mcp\.json$/, /(^|[\\/])(CLAUDE|CLAUDE\.local|AGENTS|GEMINI)\.md$/,
  // Build and test files that run code when you build, install or test: npm/yarn/pnpm, Python, Ruby, Gradle/Maven, Rust,
  // tool version managers.
  /(^|[\\/])\.(npmrc|yarnrc(\.ya?ml)?|pnpmfile\.c?js)$/, /(^|[\\/])(pyproject\.toml|setup\.py|setup\.cfg|conftest\.py|tox\.ini|noxfile\.py)$/,
  /(^|[\\/])(Gemfile|Rakefile)$/, /(^|[\\/])(build|settings)\.gradle(\.kts)?$/, /(^|[\\/])(gradlew(\.bat)?|pom\.xml)$/,
  /(^|[\\/])(build\.rs|Cargo\.toml)$/, /(^|[\\/])\.cargo[\\/]config(\.toml)?$/, /(^|[\\/])\.(tool-versions|mise\.toml)$/,
];
// A path as Windows (and a Mac, for the case) reads it: letters in any case, a name's trailing dots and spaces dropped
// (".git." is ".git"), an NTFS stream suffix dropped (".git::$INDEX_ALLOCATION", "package.json::$DATA"). Checked on
// every system: a file that only looks like one of these on Linux asks once more, which is harmless.
const winForm = (f) => String(f).split(/([\\/])/).map((part, i) => i % 2 ? part
  : part.replace(/^(?![a-z]:$)([^:]*):.*$/i, "$1").replace(/(?<=[^. ])[. ]+$/, "")).join("");
// An 8.3 short name ("GIT~1", "PACKAG~1.JSO") can stand for any of these on Windows: it asks too. Looked for in the real
// path only: Windows expands every existing short name there ("GIT~1" → ".git", caught above), so one that's left
// names nothing yet. The path as written isn't checked for them: Windows' own temp folder is often one
// ("C:\Users\ADITHY~1\…"), and every file under it asked.
const SHORT_NAME = /(^|[\\/])[^\\/~]{1,6}~\d+(\.[^\\/.]{0,3})?([\\/]|$)/;
const runsLater = (file) => {
  const r = real(file);
  return SHORT_NAME.test(r) || [String(file), r].some((f) => [f, winForm(f)].some((g) => RUNS_LATER.some((re) => new RegExp(re.source, "i").test(g))));
};

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

module.exports = { runsLater, privateTmp, real, within, isProtected, isHomeOrAbove, hasControl, expand, HOME_PROTECTED, PRIVATE, privateFolder, privateUse, privateWords };
