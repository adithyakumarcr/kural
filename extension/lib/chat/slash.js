// The "/" list in the chat box: your skills and commands, as Claude Code reports them (no vscode here).
// Claude Code answers the `initialize` control request with { commands: [{ name, description, argumentHint, aliases?,
// builtin? }] } and sends { type: "system", subtype: "commands_changed", commands } when they change (a plugin installed,
// a skill added). Checked with Claude Code 2.1.296: your plugins' skills ("superpowers:brainstorming"), your own skills
// and commands, and Claude Code's own. A message that starts with "/name args" runs that skill or command in Kural's chat
// too (the program echoes it as <command-name>/name</command-name>), so the chat only has to put it first.
//
// Left out: Claude Code's own commands that work only on its own screen (settings, pickers, its login) or that Kural
// does in its own way (the model menu, the mode, connectors, AI Usage). They'd do nothing, or something confusing, here.
const SCREEN_ONLY = new Set([
  "advisor", "agents", "auto-mode-setup", "autocompact", "clear", "color", "config", "context", "design-consent", "design-revoke",
  "doctor", "effort", "extra-usage", "fast", "focus", "goal", "heapdump", "import", "insights", "list-agents", "login", "logout",
  "mcp", "model", "output-style", "permissions", "plugin", "plugins", "recap", "reload-plugins", "reload-skills", "rename",
  "resume", "skill-doctor", "status", "team-onboarding", "theme", "usage", "usage-credits", "vim", "workflow-launch-exec",
]);
const NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const MAX = 400;

const str = (v, max) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

// Claude Code's list → what the page shows: [{ name, description, hint, aliases, builtin }], yours first, each by name.
function clean(commands) {
  const seen = new Set(), out = [];
  for (const c of Array.isArray(commands) ? commands : []) {
    if (!c || typeof c !== "object" || !NAME.test(String(c.name || "")) || c.name.startsWith("_") || SCREEN_ONLY.has(c.name)) continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ name: c.name, description: str(c.description, 300), hint: str(c.argumentHint, 120),
      aliases: (Array.isArray(c.aliases) ? c.aliases : []).filter((a) => typeof a === "string" && NAME.test(a)).slice(0, 5), builtin: !!c.builtin });
    if (out.length >= MAX) break;
  }
  return out.sort((a, b) => (a.builtin - b.builtin) || a.name.localeCompare(b.name));
}

// "/superpowers:brainstorming a login page" → { name: "superpowers:brainstorming", rest: "a login page" } when it's one of
// the chat's commands (by name or alias); otherwise null (a path like "/usr/bin" or a plain "/" stays text).
function split(text, commands) {
  const m = /^\/([A-Za-z0-9][A-Za-z0-9:._-]*)(?=\s|$)([\s\S]*)$/.exec(String(text || ""));
  if (!m || !Array.isArray(commands)) return null;
  const c = commands.find((x) => x.name === m[1] || (x.aliases || []).includes(m[1]));
  return c ? { name: m[1], rest: m[2].replace(/^[ \t]+/, "") } : null;
}

module.exports = { clean, split, SCREEN_ONLY };
