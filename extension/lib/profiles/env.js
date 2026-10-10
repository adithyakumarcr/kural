// What a profile changes for the programs Kural starts. No vscode here (tests run without it).
//
// A profile with its own accounts gives Claude Code and Codex their own settings folder, and each program keeps its
// login there:
//   Claude Code:  CLAUDE_CONFIG_DIR   (login, settings, conversations)
//   Codex:        CODEX_HOME          (login, conversations)
// Google Gemini (agy) has no such variable we know of, so its account is the same in every profile, and so is Ollama
// (it runs on this computer and has no account).
//
// extension.js calls setProfileEnv() once at startup, before anything starts a program. Everything that starts claude or
// codex merges profileEnv() into its environment (cleanEnv() in lib/ai/claude.js, lib/ai/codex.js, the login terminals),
// so there is one place that says "which account": a program started without it would use the main profile's login.
// The main profile ("default") sets nothing: it is exactly what Kural did before profiles existed.

const os = require("os");
const path = require("path");

let extra = {};

// obj: { NAME: "value" }; anything that isn't a non-empty string is ignored. Replaces the earlier set.
function setProfileEnv(obj) {
  extra = {};
  for (const [k, v] of Object.entries(obj || {})) if (typeof v === "string" && v) extra[k] = v;
}

function profileEnv() { return { ...extra }; }

// A copy of base (the real environment by default) with the profile's variables on top.
function withProfileEnv(base = process.env) { return { ...base, ...extra }; }

// The variables for a profile whose folder is dir (null = the main profile: none).
function envFor(dir) {
  if (!dir) return {};
  return { CLAUDE_CONFIG_DIR: path.join(dir, "claude"), CODEX_HOME: path.join(dir, "codex") };
}

// Where Claude Code keeps its files now (plans, conversations, CLAUDE.md): the profile's folder, else the
// CLAUDE_CONFIG_DIR you set yourself, else ~/.claude.
function claudeConfigDir(home = os.homedir(), env = process.env) {
  return extra.CLAUDE_CONFIG_DIR || env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
}

module.exports = { setProfileEnv, profileEnv, withProfileEnv, envFor, claudeConfigDir };
