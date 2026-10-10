// The folders open in the editor. With File → Add Folder to Workspace there can be several;
// Claude works in the first and gets access to the others (--add-dir).
// Paths shown to you use VS Code's style: "src/app.py" with one folder, "<folder>/src/app.py" with several.

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

function folders() {
  return (vscode.workspace.workspaceFolders || [])
    .filter((f) => f.uri.scheme === "file")
    .map((f) => ({ name: f.name, path: f.uri.fsPath }));
}

function root() { const f = folders(); return f.length ? f[0].path : undefined; }

// Where AI work happens when no folder is open: an empty folder of Kural's own. Never your home folder: a program
// that looks through your home folder makes macOS ask for Music, Photos, Documents… ("Kural would like to access
// Apple Music"). setWorkDir is called once at startup (Kural's storage folder); the temp folder is the fallback.
let scratch = null;
function setWorkDir(dir) { scratch = dir; }
function workDir() {
  const dir = scratch || path.join(require("os").tmpdir(), "kural-work");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists, or the temp folder: still usable */ }
  return dir;
}
// Where the AI may read (and, in Agent mode, change) files without asking: your project folders, Kural's work folder,
// the temp folder (attachments). Reading also Kural's storage (pictures a model made). Anywhere else asks you first.
function aiRoots(write = false) {
  const os = require("os");
  const store = scratch ? path.dirname(scratch) : null;
  const claude = require("./profiles/env").claudeConfigDir();   // (~/.claude, or this profile's own folder)
  // Reading also: Claude Code's own files (long tool output it saved, its plans) and the system temp folder, where
  // Claude Code's background agents write (on a Mac that's /tmp, not the per-user temp folder).
  // Writing: not the temp folder (anyone's files can be there; a write there asks). Reading: yes (attachments).
  return [...folders().map((f) => f.path), workDir(), ...(write ? [] : [os.tmpdir()]),
    ...(write ? [path.join(claude, "plans")]
      : [...require("./profiles/scope").storageReadRoots(store), path.join(claude, "projects"), path.join(claude, "plans"), process.platform === "win32" ? null : "/tmp"])].filter(Boolean);
}
function mayUse(file, write = false) { return require("./paths").within(file, aiRoots(write)); }
function extraDirs() { return folders().slice(1).map((f) => f.path); }
function key() { return folders().map((f) => f.path).join("|"); }

const inside = (dir, p) => { const r = path.relative(dir, p); return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : (r === "" ? "." : null); };

// Absolute path -> what to show ("src/app.py" or "docs/src/app.py").
function label(abs) {
  if (!abs || !path.isAbsolute(abs)) return abs || "";
  const list = folders();
  for (const f of list) {
    const r = inside(f.path, abs);
    if (r != null) {
      const rel = r.split(path.sep).join("/");
      return list.length > 1 ? `${f.name}/${rel}` : rel;
    }
  }
  return abs;
}

// What you or Claude wrote ("src/app.py", "docs/src/app.py", or an absolute path) -> a file Uri.
function resolve(p) {
  if (!p) return null;
  if (path.isAbsolute(p)) return vscode.Uri.file(p);
  const list = folders();
  if (!list.length) return null;
  const clean = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (list.length > 1) {
    const first = clean.split("/")[0];
    const f = list.find((x) => x.name === first);
    if (f) {
      const cand = path.join(f.path, clean.slice(first.length + 1));
      if (fs.existsSync(cand) || !fs.existsSync(path.join(list[0].path, clean))) return vscode.Uri.file(cand);
    }
  }
  for (const f of list) {
    const cand = path.join(f.path, clean);
    if (fs.existsSync(cand)) return vscode.Uri.file(cand);
  }
  return vscode.Uri.file(path.join(list[0].path, clean));
}

// A file the AI named in a link or `code` ("devices.test.js", "lib/chat/index.js:12", "/test/a.js") -> the files it may
// mean: [{ uri, label }], most likely first. As written first (resolve); not there, then any project file whose path
// ends with it: the AI often writes just a file's name, or a path from inside another folder (it said
// "devices.test.js" for test/devices.test.js, and Kural answered "can't find"). A leading "/" that isn't on this
// computer counts as the project's own. Not in node_modules or .git; build output (dist, build, out) last.
async function find(p) {
  let clean = String(p || "").trim().replace(/^file:\/\//i, "").replace(/\\/g, "/");
  if (!clean) return [];
  if (/^~\//.test(clean)) clean = path.join(require("os").homedir(), clean.slice(2));
  const direct = resolve(clean);
  if (direct && fs.existsSync(direct.fsPath)) return [{ uri: direct, label: label(direct.fsPath) }];
  const rel = clean.replace(/^[A-Za-z]:(?=\/)/, "").replace(/^\/+/, "").replace(/^(\.\/)+/, "");
  if (!rel || rel.split("/").includes("..")) return [];
  if (!folders().length) {   // (no folder open: the AI worked in Kural's work folder)
    const w = path.join(workDir(), rel);
    return fs.existsSync(w) ? [{ uri: vscode.Uri.file(w), label: w }] : [];
  }
  // (Glob characters in a name, like Next.js's [id].tsx, match any one character here; the exact check below.)
  const glob = `**/${rel.replace(/[[\]{}*?!]/g, "?")}`;
  const found = new Map();
  for (const f of folders()) {
    let uris = [];
    try { uris = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(f.path), glob), "**/{node_modules,.git}/**", 50); } catch { /* not searchable */ }
    for (const u of uris) {
      const p = u.fsPath.split(path.sep).join("/");
      if (p === rel || p.endsWith(`/${rel}`)) found.set(u.fsPath, { uri: u, label: label(u.fsPath) });
    }
  }
  const built = (l) => /(^|\/)(dist|build|out|\.next|coverage|target)\//.test(l) ? 1 : 0;
  return [...found.values()].sort((a, b) => built(a.label) - built(b.label) || a.label.length - b.label.length || a.label.localeCompare(b.label));
}

// Told to Claude when there's more than one folder.
function promptNote() {
  const list = folders();
  if (list.length < 2) return "";
  return `\n\nThis workspace has ${list.length} folders and you may read and change files in all of them: ` +
    list.map((f) => `"${f.name}" = ${f.path}`).join("; ") +
    `. Your working directory is the first one. A path written as <folder name>/... is inside that folder.`;
}

module.exports = { workDir, setWorkDir, aiRoots, mayUse, folders, root, extraDirs, key, label, resolve, find, promptNote };
