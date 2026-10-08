// Does a tool call the AI wants to make run at once, or ask you first? The decision only, no vscode and no cards:
// the chat's onPermission() does the rest (saving the file, the checkpoint, the card). test/permissions.test.js has the
// whole table: it is the specification.

const { within, runsLater } = require("../paths");
const { dangerous } = require("../ai/danger");
const { isAtlassianRead } = require("./atlassian");

const READ_TOOLS = ["Read", "Grep", "Glob"];
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);   // Claude Code's tool for starting a helper agent
const DEVICE_TOOLS = ["run_command", "read_file", "write_file", "list_dir"];   // a linked device's tools (lib/devices)
const DEVICE_TOOL_RE = new RegExp(`^mcp__device__(${DEVICE_TOOLS.join("|")})$`);

// → { allow: true } | { question: true } (AskUserQuestion: a card with options) | { ask: true, risky? }
//   tool, input: the call. mode: agent / auto / plan / ask. allowAll: "Allow all" for this chat; allowAllDevice: the
//   device it was given for. device: the chat's linked device. writeRoots / readRoots: where the AI may write / read
//   without asking (ws.aiRoots). granted: files and folders you attached (and the handoff file). cwd: the project
//   folder (what "outside" means for rm). notice: the program only tells, it doesn't wait (agy): never a card.
function decide({ tool, input = {}, mode, allowAll = false, allowAllDevice = null, device = null, writeRoots = [], readRoots = [], granted = [], cwd = "/", notice = false }) {
  if (EDIT_TOOLS.has(tool)) {
    const file = input.file_path || input.notebook_path;
    // Inside your project (or Kural's own work folder): no asking, that's what Agent mode is for. Anywhere else
    // (~/.zshrc, a LaunchAgent, Claude Code's own settings with its hooks), and inside the project a file that runs code
    // later (a git hook, a task, a workflow, package.json), a write can make the computer run something later, so it
    // asks like a command does (Auto still doesn't ask).
    if (!file || notice || (within(file, writeRoots) && !runsLater(file))) return { allow: true };
  }
  // Reading inside your project: no asking. Elsewhere (your Documents, Desktop…) it asks, like a command: on a Mac
  // reading there also makes macOS ask about Kural.
  if (READ_TOOLS.includes(tool)) {
    const where = input.file_path || input.path;
    if (!where || within(where, readRoots) || within(where, granted.filter(Boolean))) return { allow: true };
  }
  if (SUBAGENT_TOOLS.has(tool)) return { allow: true };
  // A linked device's tools: Kural asks before each command itself (approveDevice), so the program's own ask is a yes.
  if (device && DEVICE_TOOL_RE.test(tool)) return { allow: true };
  // Reading Jira (the linked ticket, a search) changes nothing. Writing to Jira still asks below.
  if (isAtlassianRead(tool)) return { allow: true };
  if (tool === "AskUserQuestion") return { question: true };
  // "Allow all" is kept apart for a device: allowing every `npm test` here must not allow everything on the robot.
  const onDevice = tool === "DeviceCommand" || tool === "DeviceWrite";
  // A command that's hard to undo (sudo, rm -rf outside the project, curl | sh, a forced push to main…) asks even in
  // Auto and after "Allow all" (lib/ai/danger.js; best effort, not a sandbox). On a device "outside" can't be known,
  // so only the other rules count there.
  const risky = tool === "Bash" || tool === "DeviceCommand" ? dangerous(input.command, onDevice ? "/" : cwd) : null;
  if (risky) return { ask: true, risky };
  if (mode === "auto" || (onDevice ? !!device && allowAllDevice === device : allowAll)) return { allow: true };
  return { ask: true };   // Agent mode: running commands asks you first.
}

module.exports = { decide, READ_TOOLS, EDIT_TOOLS, SUBAGENT_TOOLS, DEVICE_TOOLS, DEVICE_TOOL_RE };
