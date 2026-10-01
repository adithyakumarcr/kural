// Your project's instructions for Claude (CLAUDE.md, .claude/rules/*.md, ~/.claude/CLAUDE.md).
// Chat runs Claude Code in safe mode for speed, which skips these files, so Kural
// reads them itself and gives them to Claude. (Hooks and plugins stay off.)

const fs = require("fs");
const os = require("os");
const path = require("path");

const LIMIT = 60000; // characters; keeps requests fast

function mdFilesIn(dir, depth = 0) {
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) out = out.concat(mdFilesIn(p, depth + 1));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function projectInstructions(root) {
  const files = [path.join(os.homedir(), ".claude", "CLAUDE.md")];
  if (root) {
    files.push(path.join(root, "CLAUDE.md"), path.join(root, ".claude", "CLAUDE.md"), path.join(root, "CLAUDE.local.md"));
    files.push(...mdFilesIn(path.join(root, ".claude", "rules")));
  }
  let text = "", used = [];
  for (const f of files) {
    let body;
    try { body = fs.readFileSync(f, "utf8").trim(); } catch { continue; }
    if (!body) continue;
    const label = root && f.startsWith(root) ? path.relative(root, f) : f.replace(os.homedir(), "~");
    const chunk = `\n\n### ${label}\n${body}`;
    if (text.length + chunk.length > LIMIT) break;
    text += chunk; used.push(label);
  }
  return { text: text ? `\n\n# Instructions from the user's project files\n${text}` : "", files: used };
}

module.exports = { projectInstructions };
