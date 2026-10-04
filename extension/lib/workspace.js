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

// Told to Claude when there's more than one folder.
function promptNote() {
  const list = folders();
  if (list.length < 2) return "";
  return `\n\nThis workspace has ${list.length} folders and you may read and change files in all of them: ` +
    list.map((f) => `"${f.name}" = ${f.path}`).join("; ") +
    `. Your working directory is the first one. A path written as <folder name>/... is inside that folder.`;
}

module.exports = { workDir, setWorkDir, folders, root, extraDirs, key, label, resolve, promptNote };
