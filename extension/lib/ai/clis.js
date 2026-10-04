// The AI programs Kural can drive besides Claude Code: OpenAI's Codex CLI (a ChatGPT account) and Google's Antigravity
// CLI (a Google account), shown as "Google Gemini". Like Claude Code, each keeps its own login; Kural only starts the
// program (./codex.js, ./agy.js) and asks it things.
// (Google's Gemini CLI was here too. Google stopped personal accounts in it on 26 Sept 2026 and moved them to
// Antigravity, which runs the same Gemini models, so Kural dropped it: most people have a personal account.) No vscode here: Get started, the Account menu and the chat's model menu
// use this one description of each.

const codex = require("./codex");
const agy = require("./agy");

const IS_MAC = process.platform === "darwin", IS_WIN = process.platform === "win32";

const CLIS = {
  codex: {
    id: "codex",
    label: "ChatGPT (Codex)",      // the way in Get started and the model menu's section
    short: "Codex",                // status bar, model names
    program: "Codex CLI",
    what: "OpenAI's models through Codex, with your ChatGPT plan.",
    facts: ["Needs a ChatGPT Plus, Pro, Business or Enterprise plan (or an OpenAI API key) and internet"],
    // Official installs: npm everywhere (needs Node.js), Homebrew on a Mac.
    install: IS_MAC ? "brew install codex" : "npm install -g @openai/codex",
    installAlt: IS_MAC ? "npm install -g @openai/codex" : "",
    docs: "https://developers.openai.com/codex/cli",
    usageUrl: "https://chatgpt.com/codex/settings/usage",
    find: (chosen) => codex.findCodex(chosen),
    version: async (bin) => (await codex.codexVersion(bin)).version || null,
    auth: (bin) => codex.codexAuth(bin),
    logout: (bin) => codex.codexLogout(bin),
    loginCommand: (bin) => codex.loginCommand(bin),
    login: (bin, o) => codex.codexLogin(bin, o),
    test: (bin, o) => codex.codexTest(bin, o),
    models: (bin) => codex.codexModels(bin),
    limits: (bin) => codex.codexRateLimits(bin),
    Agent: codex.CodexAgent,
    ask: (bin, o) => codex.askCodex(bin, o),
  },
};

CLIS.agy = {
  id: "agy",
  // Called Google Gemini in Kural: that's what people know. The program is Google's Antigravity CLI.
  label: "Google Gemini",
  short: "Gemini",
  program: "Antigravity CLI",
  what: "Google's Gemini models (and others) with your Google account, through Google's Antigravity CLI.",
  facts: ["Free with a Google account; more with Google AI Pro or Ultra", "Can't ask before a command: Agent mode edits files only, Auto runs commands"],
  // Google's own installer (a single program, no Node.js needed): ~/.local/bin/agy, or %LOCALAPPDATA%\agy\bin on Windows.
  install: IS_WIN ? "irm https://antigravity.google/cli/install.ps1 | iex" : "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  installAlt: IS_WIN ? "winget install Google.AntigravityCLI" : "",
  docs: "https://antigravity.google/docs/cli",
  usageUrl: "https://antigravity.google/docs/cli",
  // agy has no login command: its own screen in a terminal (it opens your browser). Kural closes the terminal after.
  loginTerminal: true,
  find: (chosen) => agy.findAgy(chosen),
  version: (bin) => agy.agyVersion(bin),
  auth: (bin) => agy.agyAuth(bin),
  logout: (bin) => agy.agyLogout(bin),
  loginCommand: (bin) => agy.loginCommand(bin),
  test: (bin, o) => agy.agyTest(bin, o),
  models: (bin) => agy.agyModels(bin),
  limits: (bin) => agy.agyLimits(bin),
  Agent: agy.AgyAgent,
  ask: async (bin, o) => { try { return await agy.askAgy(bin, o); } catch { return null; } },
};

const IDS = ["agy", "codex"];      // (the order Get started and the model menu show them in)
const PREFIX = new RegExp(`^(${IDS.join("|")}):`);
// "codex:gpt-6.1-sol" → "codex"; "agy:gemini-3.8-flash-high" → "agy"; anything else (also an old "gemini:…") → null.
function cliOf(model) { const m = PREFIX.exec(model || ""); return m ? m[1] : null; }
// The model id the program knows ("" = its own default).
function cliModel(model) { const id = String(model || "").replace(PREFIX, ""); return id === "default" ? "" : id; }

module.exports = { CLIS, IDS, PREFIX, cliOf, cliModel, IS_WIN };
