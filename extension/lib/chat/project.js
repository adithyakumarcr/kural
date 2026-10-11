// Your project's instructions for Claude (CLAUDE.md, .claude/rules/*.md, ~/.claude/CLAUDE.md).
// Chat runs Claude Code in safe mode for speed, which skips these files, so Kural
// reads them itself and gives them to Claude. (Hooks and plugins stay off.)

const fs = require("fs");
const os = require("os");
const path = require("path");
const { within } = require("../paths");
const { claudeConfigDir } = require("../profiles/env");

const LIMIT = 60000; // characters; keeps requests fast

function mdFilesIn(dir, depth = 0, root = dir) {
  if (!within(dir, [root])) return [];
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) out = out.concat(mdFilesIn(p, depth + 1, root));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function projectInstructions(root, trusted = true) {
  if (!trusted) return { text: "", files: [] };
  const files = [path.join(claudeConfigDir(), "CLAUDE.md")];
  if (root) {
    files.push(path.join(root, "CLAUDE.md"), path.join(root, ".claude", "CLAUDE.md"), path.join(root, "CLAUDE.local.md"));
    files.push(...mdFilesIn(path.join(root, ".claude", "rules"), 0, root));
  }
  let text = "", used = [];
  for (const f of files) {
    // Repository-controlled links must never turn private files into model instructions.
    const globalFile = path.join(claudeConfigDir(), "CLAUDE.md");
    if (f !== globalFile && !within(f, [root])) continue;
    let body;
    // Only plain files of a sane size: a pipe (FIFO) named CLAUDE.md would block the editor forever on read, and a device
    // or a huge file isn't instructions.
    // (Opened without waiting, then checked on the open file: swapping it for a pipe after a check can't block either.)
    let fd = null;
    try {
      fd = fs.openSync(f, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > LIMIT * 4) continue;
      body = fs.readFileSync(fd, "utf8").trim();
    } catch { continue; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ } }
    if (!body) continue;
    const label = root && f.startsWith(root) ? path.relative(root, f) : f.replace(os.homedir(), "~");
    const chunk = `\n\n### ${label}\n${body}`;
    if (text.length + chunk.length > LIMIT) break;
    text += chunk; used.push(label);
  }
  return { text: text ? `\n\n# Instructions from the user's project files\n${text}` : "", files: used };
}

module.exports = { projectInstructions };
