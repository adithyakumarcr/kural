// Connectors you turned off in Kural Settings (Adithya, issue #105: "everywhere in Kural"). No vscode here.
// Kural keeps the list (globalState, per profile: each profile has its own accounts and connectors) and every program it
// starts follows it: Claude with your full setup gets `--disallowedTools mcp__<name>` (its tools are hidden from the AI;
// the connector still connects in the background: Claude Code has no per-run switch for one connector, and its own
// `/mcp disable` would write your settings), Codex gets `mcp_servers.<name>.enabled = false` (lib/ai/codex.js lockdownArgs).
// Your own `claude` and `codex` in a terminal don't change.
const AIS = new Set(["claude", "codex"]);
const ok = (name) => typeof name === "string" && name.length > 0 && name.length <= 200 && !/[\r\n\0]/.test(name);

let read = () => ({}), write = async () => {};
// get() → { claude: [names], codex: [names] }; set(value) saves it.
function init(get, set) { read = get; write = set; }

function list(ai) {
  const v = (read() || {})[ai];
  return Array.isArray(v) ? [...new Set(v.filter(ok))] : [];
}
const isOff = (ai, name) => list(ai).includes(name);

async function set(ai, name, off) {
  if (!AIS.has(ai) || !ok(name)) return false;
  const all = { ...(read() || {}) };
  const now = list(ai).filter((n) => n !== name);
  all[ai] = off ? [...now, name] : now;
  await write(all);
  return true;
}

// Claude Code's name for a connector's tools: mcp__<name with anything but letters, digits, _ and - as "_">__<tool>
// ("claude.ai Atlassian MCP" → mcp__claude_ai_Atlassian_MCP__getJiraIssue). A rule with only the server's part matches
// all of its tools.
const toolPrefix = (name) => `mcp__${String(name).replace(/[^A-Za-z0-9_-]/g, "_")}`;
const claudeDeny = () => list("claude").map(toolPrefix);

module.exports = { init, list, isOff, set, toolPrefix, claudeDeny };
