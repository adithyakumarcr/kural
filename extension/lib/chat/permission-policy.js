// Does a tool call the AI wants to make run at once, or ask you first? The decision only, no vscode and no cards:
// the chat's onPermission() does the rest (saving the file, the checkpoint, the card). test/permissions.test.js has the
// whole table: it is the specification.

const { within, runsLater, expand, isHomeOrAbove, privateFolder, privateUse, privateWords } = require("../paths");
const { dangerous } = require("../ai/danger");
const { isAtlassianRead } = require("./atlassian");

const READ_TOOLS = ["Read", "Grep", "Glob"];
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);   // Claude Code's tool for starting a helper agent
const DEVICE_TOOLS = ["run_command", "read_file", "write_file", "list_dir"];   // a linked device's tools (lib/devices)
const DEVICE_TOOL_RE = new RegExp(`^mcp__device__(${DEVICE_TOOLS.join("|")})$`);
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);
// Kural's browser (lib/browser), asked through the chat's approveBrowser: BrowserSite = the AI may use a site in this chat
// (read it, in Ask and Plan); BrowserAction = Submit, Pay, Delete, Discard and the like; BrowserUpload = a file from this
// computer for a page. Nothing that publishes ever gets here: Kural refuses that itself, in every mode (browser/guard.js).
// "Browser" is Gemini's own browser (Antigravity's, through its gate): Kural can't see what it clicks, so it can't keep the
// AI from publishing there; each action asks, in Auto too, with no "Allow all".

// A connector's (MCP server's) tool: mcp__<server>__<tool> → { server, name }.
function connectorTool(tool) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(tool || ""));
  return m ? { server: m[1], name: m[2] } : null;
}
// Does a connector tool only look things up, by its name? (get_issue, listProjects, notion-search, resolve-library-id)
// Only for Ask and Plan, where everything else from a connector is refused; it still asks you there. A name with a word
// that changes things (get_or_create_page, search_and_replace) is not a lookup.
const LOOKUP_VERBS = new Set(["get", "list", "search", "find", "fetch", "read", "query", "lookup", "view", "show", "describe", "retrieve",
  "resolve", "browse", "inspect", "count", "preview"]);
// (Verbs that are rarely nouns: "get_release", "get_workflow_run", "get_comment" are lookups.)
const CHANGE_WORDS = new Set(["create", "add", "insert", "update", "upsert", "edit", "set", "put", "modify", "write", "delete", "remove", "destroy",
  "drop", "replace", "rename", "move", "send", "push", "apply", "execute", "exec", "invoke", "approve", "reject", "assign", "invite", "upload",
  "refund", "charge", "pay", "transfer", "subscribe", "unsubscribe", "enable", "disable", "install", "uninstall", "archive", "restore", "cancel",
  "submit", "save", "duplicate", "publish", "clear", "reset"]);
function isLookup(tool) {
  const c = connectorTool(tool);
  if (!c) return false;
  const words = c.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // (A server's own prefix comes first in some names: notion-search, notion-fetch. Skip a first word that is the server's name.)
  const server = c.server.toLowerCase().replace(/^claude_ai_/, "").split(/[^a-z0-9]+/).filter(Boolean);
  const verbs = words.length > 1 && server.includes(words[0]) ? words.slice(1) : words;
  return verbs.length > 0 && LOOKUP_VERBS.has(verbs[0]) && !verbs.some((w) => CHANGE_WORDS.has(w));
}

// What "Allow all" on a card covers: one kind of call, for the rest of this chat (in this mode, with this model and
// conversation: allowAllNow). Commands; web searches and pages; one connector's tools; Kural's browser (every site, and
// Submit and the like; never an upload from outside the project, never publishing).
// null: a card that never gets "Allow all" (a file outside the project, a tool Kural can't classify, Gemini's own browser:
// yes or no each time).
function allowKind(tool) {
  if (tool === "Bash") return "command";
  if (WEB_TOOLS.has(tool)) return "web";
  if (tool === "BrowserSite" || tool === "BrowserAction") return "browser";
  const c = connectorTool(tool);
  if (c && !DEVICE_TOOL_RE.test(tool)) return `connector:${c.server}`;
  return null;
}
// The kinds "Allow all" was given for. (Chats saved by 1.1.0-rc.1 and older have `true`: that was given on a command card.)
const allowedKinds = (allowAll) => Array.isArray(allowAll) ? allowAll : allowAll === true ? ["command"] : [];

// → { allow: true } | { question: true } (AskUserQuestion: a card with options) | { ask: true, risky? } | { deny: true, message }
//   tool, input: the call. mode: agent / debug (the same) / auto / plan / ask. allowAll: the kinds "Allow all" was given for in this chat
//   (allowKind; `true` = commands, from older chats); allowAllDevice: the
//   device it was given for. device: the chat's linked device. writeRoots / readRoots: where the AI may write / read
//   without asking (ws.aiRoots). granted: files and folders you attached (and the handoff file). cwd: the project
//   folder (what "outside" means for rm). notice: the program only tells, it doesn't wait: never a card (no provider
//   uses it any more; Gemini asks through Kural's gate). unclassified: a call Kural can't classify (Gemini's gate: an
//   unknown tool, or one whose file couldn't be found): refused in Ask/Plan, asks in Agent, runs in Auto. guard(file): files
//   that keep an approval gate working (agy's hooks, Kural's launcher): writing one asks, even in Auto. Auto runs everything else.
//   privateFolders: check the AI's looks into Desktop, Documents, Downloads, Music, Pictures… (on a Mac, where macOS asks).
function decide({ tool, input = {}, mode, allowAll = false, allowAllDevice = null, device = null, writeRoots = [], readRoots = [], granted = [], cwd = "/", notice = false, unclassified = false, guard = null, privateFolders = process.platform === "darwin" }) {
  if (mode === "debug") mode = "agent";   // (Debug asks and allows exactly like Agent)
  // Enforce read-only modes here, even after a live transition or a provider sends an unexpected call.
  if ((mode === "ask" || mode === "plan") && (EDIT_TOOLS.has(tool) || ["Bash", "DeviceCommand", "DeviceWrite", "Browser", "BrowserAction", "BrowserUpload"].includes(tool)))
    return { deny: true, message: `${mode} mode cannot run commands or change files.` };
  if (tool === "Browser") return { ask: true, risky: { why: "This is Gemini's own browser, not Kural's: Kural can't see what it clicks, so it can't keep it from publishing, posting or sending something." } };
  // Your private folders: on a Mac the AI looking there makes macOS ask about Kural ("…would like to access files in your
  // Downloads folder", Apple Music, Photos), so Kural asks first, in every mode (Auto too: Adithya, 18 Oct 2026), and
  // "Allow all" doesn't cover it. Not for what you attached.
  if (privateFolders) {
    const why = privateWhy(tool, input, cwd, [...granted, ...readRoots, ...writeRoots]);
    if (why) return { ask: true, private: true, risky: { why } };
  }
  // Auto is unrestricted (Adithya, 14 Oct 2026): nothing asks, not a dangerous command, not a file outside the project,
  // not a tool Kural can't classify. The chat reports what was done instead (PROMPTS.auto). Two things stay: a question
  // the AI asks you (AskUserQuestion), and a write to the files that keep Gemini's approval gate working (otherwise one
  // Auto answer could switch the gate off for every later one).
  if (mode === "auto" && tool !== "AskUserQuestion") {
    const file = input.file_path || input.notebook_path;
    if (EDIT_TOOLS.has(tool) && file && typeof guard === "function" && guard(file)) return { ask: true, risky: { why: "It changes Gemini's hook settings or Kural's approval gate." } };
    return { allow: true };
  }
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
    // asks like a command does (Auto doesn't ask).
    if (!file || notice || (within(file, writeRoots) && !runsLater(file))) return { allow: true };
  }
  // Reading inside your project: no asking. Elsewhere (your Documents, Desktop…) it asks, like a command: on a Mac
  // reading there also makes macOS ask about Kural.
  if (READ_TOOLS.includes(tool)) {
    const where = input.file_path || input.path;
    if (!where || within(where, readRoots) || within(where, granted.filter(Boolean))) return { allow: true };
  }
  // A file for a page in Kural's browser leaves this computer: from the project (or one you attached) it may; anywhere else
  // (the temp folder, Kural's own chats, Claude Code's transcripts: places the AI may read but that aren't yours to send),
  // yes or no each time.
  if (tool === "BrowserUpload" && input.file_path && (within(input.file_path, writeRoots) || within(input.file_path, granted.filter(Boolean)))) return { allow: true };
  if (SUBAGENT_TOOLS.has(tool)) return { allow: true };
  // A linked device's tools: Kural asks before each command itself (approveDevice), so the program's own ask is a yes.
  if (device && DEVICE_TOOL_RE.test(tool)) return { allow: true };
  // Reading Jira (the linked ticket, a search) changes nothing. Writing to Jira still asks below.
  if (isAtlassianRead(tool)) return { allow: true };
  if (tool === "AskUserQuestion") return { question: true };
  // Ask and Plan change nothing, also through a connector (creating a pull request, a Notion page, a Jira issue): only a
  // connector tool whose name says it looks something up may run there, and it asks first (or "Allow all" for that one).
  if ((mode === "ask" || mode === "plan") && connectorTool(tool) && !isLookup(tool))
    return { deny: true, message: `${mode === "ask" ? "Ask" : "Plan"} mode doesn't use connector tools that may change things (${tool}). Switch to Agent mode to use it.` };
  const kinds = allowedKinds(allowAll);
  // "Allow all" is kept apart for a device: allowing every `npm test` here must not allow everything on the robot.
  const onDevice = tool === "DeviceCommand" || tool === "DeviceWrite";
  // A command that's hard to undo (sudo, rm -rf outside the project, curl | sh, a forced push to main…) asks in Agent
  // and after "Allow all" (not in Auto: it returned above) (lib/ai/danger.js; best effort, not a sandbox). On a device "outside" can't be known,
  // so only the other rules count there.
  let risky = tool === "Bash" || tool === "DeviceCommand" ? dangerous(input.command, onDevice ? "/" : cwd) : null;
  // A command started in another folder (Gemini's run_command has its own Cwd): outside the project it always asks.
  if (!risky && tool === "Bash" && input.cwd && !within(require("path").resolve(cwd, String(input.cwd)), writeRoots))
    risky = { why: `It runs in ${input.cwd}, outside the project.` };
  if (risky) return { ask: true, risky };
  // "Allow all" covers only the kind of card it was given on (commands, web, one connector): never a file outside the
  // project or a file that runs code later (those are yes or no each time), never a device (its own "Allow all").
  const kind = allowKind(tool);
  if (mode === "auto" || (onDevice ? !!device && allowAllDevice === device : !!kind && kinds.includes(kind))) return { allow: true };
  return { ask: true };   // Agent mode: running commands asks you first.
}

// Why this call would look in your private folders (a card's "Asks first: …"), or null. ok: what you attached and the
// project folders (a project in ~/Documents is already allowed there: you opened it).
function privateWhy(tool, input, cwd, ok) {
  const P = require("path");
  const attached = (p) => within(p, ok.filter(Boolean));
  const at = (p) => P.resolve(cwd, expand(String(p)));
  let found = null;
  if (tool === "Bash") {
    const runIn = input.cwd ? at(input.cwd) : cwd;
    found = privateUse(input.command, runIn);
    if (found && found.every((f) => f.path && attached(f.path))) found = null;
    // (A command started inside one of them reads it, whatever it says: Gemini's run_command has its own folder.)
    const inside = privateFolder(runIn);
    if (inside && !attached(runIn)) found = [...(found || []), { folder: inside }];
  } else if (READ_TOOLS.includes(tool) || EDIT_TOOLS.has(tool) || tool === "BrowserUpload") {
    // (Glob's pattern can carry the folder itself: "~/Downloads/*.pdf".)
    const pat = tool === "Glob" && /^[~/]/.test(String(input.pattern || "")) ? String(input.pattern).split(/[*?[{]/)[0] : null;
    const where = input.file_path || input.notebook_path || input.path || pat;
    const walks = tool === "Grep" || tool === "Glob";
    const abs = where ? at(where) : cwd;
    const folder = where ? privateFolder(abs) : null;
    if (folder && !attached(abs)) found = [{ folder }];
    else if (walks && !folder && isHomeOrAbove(abs) && !attached(abs)) found = [{ folder: "home" }];
  }
  return found && `It looks in ${privateWords(found)}. On a Mac that makes macOS ask you about Kural too.`;
}

// The mode a call through Gemini's gate is decided in. startedFor: the mode that agy was started for. The same as the
// chat's: that mode. A stricter one (parallel agents' lead plans in Plan while the chat is in Agent, or
// the chat was switched to a looser mode mid-answer): the stricter one, which can only refuse more. A looser one (the chat
// was switched to a stricter mode mid-answer): null, refuse (nothing more runs in that answer).
// (Debug is Agent here: the programs are started in Agent for it, so the two must compare equal.)
const STRICTNESS = { ask: 0, plan: 1, agent: 2, auto: 3 };
const asAgent = (m) => m === "debug" ? "agent" : m;
function gatedMode(chatMode, startedFor) {
  chatMode = asAgent(chatMode); startedFor = asAgent(startedFor);
  if (!startedFor || startedFor === chatMode) return chatMode;
  return STRICTNESS[startedFor] < STRICTNESS[chatMode] ? startedFor : null;
}

// "Allow all" counts for the mode, model and conversation it was given in: changing any of them (a mode or model switch,
// the router picking another model, a handoff to another AI, a new session) asks again.
const grantKey = (tab) => [tab.mode, tab.model, tab.sessionId].join("|");
const allowAllNow = (tab) => tab.allowAllFor === grantKey(tab) ? allowedKinds(tab.allowAll) : [];

// What Auto means, said before the first switch to it with this AI (engine: claude / codex / agy / ollama). Each AI's
// commands reach Kural's checks a different way, so the sentence about dangerous commands differs.
function autoWarning(engine, fullSetup = false) {
  const base = "Auto mode is unrestricted: it runs commands and edits files without asking, also dangerous ones (sudo, deleting outside the project, a forced push to main…). The chat tells you what it did";
  if (engine === "agy") return `${base}. Only a change to Gemini's own approval gate (its hook settings) and Gemini's own browser still ask.`;
  return `${base}. It still never publishes, posts or sends anything in the browser.`;
}

// The words beside "Allow all" on a card of this kind (allowKind). null: no "Allow all" on it.
function allowLabel(tool) {
  const kind = allowKind(tool);
  if (!kind) return null;
  if (kind === "command") return "Allow all commands in this chat";
  if (kind === "web") return "Allow all web searches and pages in this chat";
  if (kind === "browser") return "Allow all browser actions in this chat";
  const server = kind.slice("connector:".length).replace(/^claude_ai_/, "").replace(/[_-]+/g, " ");
  return `Allow everything from ${server} in this chat`;
}

module.exports = { decide, gatedMode, grantKey, allowAllNow, allowKind, allowLabel, allowedKinds, isLookup, autoWarning, READ_TOOLS, EDIT_TOOLS, SUBAGENT_TOOLS, DEVICE_TOOLS, DEVICE_TOOL_RE };
