// The AI programs Kural can drive besides Claude Code: OpenAI's Codex CLI (a ChatGPT account), Google's Antigravity
// CLI (a Google account) and Google's Gemini CLI (a Gemini API key or a company account). Like Claude Code, each keeps
// its own login; Kural only starts the program (./codex.js, ./agy.js, ./gemini.js) and asks it things. No vscode here: Get started, the Account menu and the chat's model menu
// use this one description of each.

const codex = require("./codex");
const gemini = require("./gemini");
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
  gemini: {
    id: "gemini",
    label: "Gemini",
    short: "Gemini",
    program: "Gemini CLI",
    what: "Google's Gemini models through Gemini CLI, with a Gemini API key or a company (Workspace) account.",
    // Google stopped serving personal accounts in Gemini CLI on 26 Sept 2026 ("This client is no longer supported for
    // Gemini Code Assist for individuals"): those use Antigravity.
    facts: ["A personal Google account? Use Antigravity instead", "Needs internet"],
    install: IS_MAC ? "brew install gemini-cli" : "npm install -g @google/gemini-cli",
    installAlt: IS_MAC ? "npm install -g @google/gemini-cli" : "",
    docs: "https://github.com/google-gemini/gemini-cli",
    usageUrl: "https://aistudio.google.com/usage",
    find: (chosen) => gemini.findGemini(chosen),
    version: (bin) => gemini.geminiVersion(bin),
    auth: (bin) => gemini.geminiAuth(bin),
    logout: async () => { try { await gemini.geminiLogout(); return { ok: true }; } catch (e) { return { error: e.message }; } },
    loginCommand: (bin) => gemini.loginCommand(bin),
    login: (bin, o) => gemini.geminiLogin(bin, o),
    test: (bin, o) => gemini.geminiTest(bin, o),
    models: (bin, o) => gemini.geminiModels(bin, o),
    limits: async () => null,      // (Gemini CLI reports tokens with each answer, not a remaining share)
    Agent: gemini.GeminiAgent,
    ask: async (bin, o) => { try { return await gemini.askGemini(bin, o); } catch { return null; } },
  },
};

CLIS.agy = {
  id: "agy",
  label: "Antigravity (Google)",
  short: "Antigravity",
  program: "Antigravity CLI",
  what: "Google's models (Gemini and others) through Google's Antigravity CLI, with your Google account.",
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

const IDS = ["codex", "agy", "gemini"];   // (the order Get started and the model menu show them in)
const PREFIX = new RegExp(`^(${IDS.join("|")}):`);
// "codex:gpt-6.1-sol" → "codex"; "gemini:auto" → "gemini"; anything else → null.
function cliOf(model) { const m = PREFIX.exec(model || ""); return m ? m[1] : null; }
// The model id the program knows ("" = its own default).
function cliModel(model) { const id = String(model || "").replace(PREFIX, ""); return id === "default" ? "" : id; }

module.exports = { CLIS, IDS, PREFIX, cliOf, cliModel, IS_WIN };
