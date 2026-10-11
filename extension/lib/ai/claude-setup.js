// Notices when your Claude Code setup changes — MCP servers / connectors (`claude mcp add`,
// .mcp.json), plugins, skills, agents, settings, CLAUDE.md — so the chat can reload Claude
// in the same conversation and use it right away.
//
// It checks a short list of files every few seconds (cheap: a few stat calls). For
// ~/.claude.json, which Claude Code rewrites all the time, only the MCP server part counts.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { claudeConfigDir } = require("../profiles/env");

const home = os.homedir();

function stamp(p) {
  try { const st = fs.statSync(p); return `${st.mtimeMs}:${st.size}`; } catch { return "-"; }
}

// A folder's entries (a skill/agent added or removed), not their contents.
function listing(dir) {
  try { return fs.readdirSync(dir).sort().map((n) => `${n}@${stamp(path.join(dir, n))}`).join(","); } catch { return "-"; }
}

// ~/.claude.json: only the parts that decide which MCP servers you have. Read again only when the file changed (its
// size and date): it's checked every few seconds in every window, and Claude Code rewrites it often but not every time.
const parsed = new Map();   // file -> { stamp, data }
function mcpPart(file, folders) {
  try {
    const now = stamp(file);
    let hit = parsed.get(file);
    if (!hit || hit.stamp !== now) { hit = { stamp: now, data: JSON.parse(fs.readFileSync(file, "utf8")) }; parsed.set(file, hit); }
    const d = hit.data;
    const proj = d.projects || {};
    return JSON.stringify([d.mcpServers || {}, folders.map((f) => {
      const p = proj[f] || {};
      return [p.mcpServers || {}, p.enabledMcpjsonServers || [], p.disabledMcpjsonServers || [], p.disabledMcpServers || []];
    })]);
  } catch { return "-"; }
}

function signature(folders) {
  const claudeDir = claudeConfigDir(home);   // (a profile's own folder, else CLAUDE_CONFIG_DIR, else ~/.claude)
  const parts = [
    mcpPart(path.join(home, ".claude.json"), folders),
    mcpPart(path.join(claudeDir, ".claude.json"), folders),
    ...["settings.json", "settings.local.json", "CLAUDE.md", path.join("plugins", "installed_plugins.json"),
      path.join("plugins", "known_marketplaces.json")].map((f) => stamp(path.join(claudeDir, f))),
    ...["skills", "agents", "commands"].map((d) => listing(path.join(claudeDir, d))),
  ];
  for (const f of folders) {
    parts.push(...[".mcp.json", "CLAUDE.md", "CLAUDE.local.md", path.join(".claude", "settings.json"), path.join(".claude", "settings.local.json")]
      .map((x) => stamp(path.join(f, x))));
    parts.push(...["skills", "agents", "commands", "rules"].map((d) => listing(path.join(f, ".claude", d))));
  }
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex");
}

// Calls onChange() when the setup changes. folders(): the workspace folders.
function watchSetup(context, folders, onChange, everyMs = 4000) {
  let last = signature(folders());
  const timer = setInterval(() => {
    const now = signature(folders());
    if (now !== last) { last = now; onChange(); }
  }, everyMs);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

module.exports = { watchSetup, signature };
