// Kural's own storage is for you alone (APP-10): folders 0700, files without group or other access. New files are written
// that way (private-file.js), but a file written by an older version keeps the mode it got then (a checkpoint, a crash
// report, a session map could be 0664 in a 0775 folder). So once per Kural version the whole storage folder is walked and
// tightened. Links are never followed (lstat): only what is really inside. No vscode here; Windows has no modes to fix.
const fs = require("fs");
const path = require("path");

// → { dirs, files } changed. Stops after `max` entries (a huge folder isn't walked forever at startup).
function tighten(root, { max = 100000 } = {}) {
  const out = { dirs: 0, files: 0 };
  if (process.platform === "win32" || !root) return out;
  let seen = 0;
  const stack = [root];
  while (stack.length && seen < max) {
    const dir = stack.pop();
    let st;
    try { st = fs.lstatSync(dir); } catch { continue; }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) continue;   // (not ours: leave it)
    if (st.mode & 0o077) { try { fs.chmodSync(dir, st.mode & 0o700 | 0o700); out.dirs++; } catch { /* best effort */ } }
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (++seen > max) break;
      const p = path.join(dir, name);
      let s;
      try { s = fs.lstatSync(p); } catch { continue; }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { stack.push(p); continue; }
      if (!s.isFile() || (typeof process.getuid === "function" && s.uid !== process.getuid())) continue;
      // (Keep the owner's bits: the SSH askpass helper stays runnable.)
      if (s.mode & 0o077) { try { fs.chmodSync(p, s.mode & 0o700); out.files++; } catch { /* best effort */ } }
    }
  }
  return out;
}

// Once per version: `done` / `mark` read and write the version it last ran for (globalState in the extension).
function tightenOnce(root, version, { done, mark, log = () => {} } = {}) {
  if (done() === version) return null;
  const r = tighten(root);
  mark(version);
  if (r.dirs || r.files) log(`private data: ${r.dirs} folders and ${r.files} files made private to you`);
  return r;
}

module.exports = { tighten, tightenOnce };
