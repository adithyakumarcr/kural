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
//   folder (what "outside" means for rm). notice: the program only tells, it doesn't wait: never a card (no provider
//   uses it any more; Gemini asks through Kural's gate). unclassified: a call Kural can't classify (Gemini's gate: an
//   unknown tool, or one whose file couldn't be found): refused in Ask/Plan, asks in Agent and Auto. guard(file): files
//   that keep an approval gate working (agy's hooks, Kural's launcher): writing one asks, even in Auto.
function decide({ tool, input = {}, mode, allowAll = false, allowAllDevice = null, device = null, writeRoots = [], readRoots = [], granted = [], cwd = "/", notice = false, unclassified = false, guard = null }) {
  // Enforce read-only modes here, even after a live transition or a provider sends an unexpected call.
  if ((mode === "ask" || mode === "plan") && (EDIT_TOOLS.has(tool) || ["Bash", "DeviceCommand", "DeviceWrite", "Browser"].includes(tool)))
    return { deny: true, message: `${mode} mode cannot run commands or change files.` };
  if (unclassified) return mode === "ask" || mode === "plan" ? { deny: true, message: `${mode} mode: Kural doesn't know what this tool does, so it isn't run.` }
    : { ask: true, risky: { why: "Kural doesn't know what this tool does." } };
  const fileInput = input.file_path || input.notebook_path || input.path;
  if (fileInput) input = { ...input, ...(input.file_path ? { file_path: require("path").resolve(cwd, require("../paths").expand(input.file_path)) } : {}),
    ...(input.notebook_path ? { notebook_path: require("path").resolve(cwd, require("../paths").expand(input.notebook_path)) } : {}),
    ...(input.path ? { path: require("path").resolve(cwd, require("../paths").expand(input.path)) } : {}) };
  if (EDIT_TOOLS.has(tool)) {
    const file = input.file_path || input.notebook_path;
    if (file && typeof guard === "function" && guard(file)) return { ask: true, risky: { why: "It changes Gemini's hook settings or Kural's approval gate." } };
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
  let risky = tool === "Bash" || tool === "DeviceCommand" ? dangerous(input.command, onDevice ? "/" : cwd) : null;
  // A command started in another folder (Gemini's run_command has its own Cwd): outside the project it always asks.
  if (!risky && tool === "Bash" && input.cwd && !within(require("path").resolve(cwd, String(input.cwd)), writeRoots))
    risky = { why: `It runs in ${input.cwd}, outside the project.` };
  if (risky) return { ask: true, risky };
  if (mode === "auto" || (onDevice ? !!device && allowAllDevice === device : allowAll)) return { allow: true };
  return { ask: true };   // Agent mode: running commands asks you first.
}

// The mode a call through Gemini's gate is decided in. startedFor: the mode that agy was started for. The same as the
// chat's: that mode. A stricter one (a team's planners and reviewers run in Plan or Ask while the chat is in Agent, or
// the chat was switched to a looser mode mid-answer): the stricter one, which can only refuse more. A looser one (the chat
// was switched to a stricter mode mid-answer): null, refuse (nothing more runs in that answer).
const STRICTNESS = { ask: 0, plan: 1, agent: 2, auto: 3 };
function gatedMode(chatMode, startedFor) {
  if (!startedFor || startedFor === chatMode) return chatMode;
  return STRICTNESS[startedFor] < STRICTNESS[chatMode] ? startedFor : null;
}

// "Allow all" counts for the mode, model and conversation it was given in: changing any of them (a mode or model switch,
// the router picking another model, a handoff to another AI, a new session) asks again.
const grantKey = (tab) => [tab.mode, tab.model, tab.sessionId].join("|");
const allowAllNow = (tab) => !!tab.allowAll && tab.allowAllFor === grantKey(tab);

// What Auto means, said before the first switch to it with this AI (engine: claude / codex / agy / ollama). Each AI's
// commands reach Kural's checks a different way, so the sentence about dangerous commands differs.
function autoWarning(engine, fullSetup = false) {
  const base = "Auto mode runs commands and edits files without asking. Dangerous commands (sudo, deleting outside the project, a forced push to main…) still ask";
  if (engine === "agy") return `${base}: with Google Gemini through Kural's approval gate, which hasn't been checked against the real Gemini program yet. If Gemini runs a step without asking the gate, Kural stops it after that step.`;
  if (engine === "claude" && fullSetup) return `${base}, unless Claude Code's own settings (yours, or this project's) already allow them: with your full setup, Claude Code doesn't ask Kural about what they allow.`;
  return `${base}.`;
}

module.exports = { decide, gatedMode, grantKey, allowAllNow, autoWarning, READ_TOOLS, EDIT_TOOLS, SUBAGENT_TOOLS, DEVICE_TOOLS, DEVICE_TOOL_RE };
