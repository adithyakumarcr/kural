// The AI programs Kural can drive besides Claude Code: OpenAI's Codex CLI (a ChatGPT account) and Google's Gemini CLI
// (a Google account or a Gemini API key). Like Claude Code, each keeps its own login; Kural only starts the program
// (./codex.js, ./gemini.js) and asks it things. No vscode here: Get started, the Account menu and the chat's model menu
// use this one description of each.

const codex = require("./codex");
const gemini = require("./gemini");

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
    what: "Google's Gemini models through Gemini CLI, with your Google account or a Gemini API key.",
    facts: ["A free tier with a Google account; needs internet"],
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

const IDS = Object.keys(CLIS);
// "codex:gpt-6.1-sol" → "codex"; "gemini:auto" → "gemini"; anything else → null.
function cliOf(model) { const m = /^(codex|gemini):/.exec(model || ""); return m ? m[1] : null; }
// The model id the program knows ("" = its own default).
function cliModel(model) { const id = String(model || "").replace(/^(codex|gemini):/, ""); return id === "default" ? "" : id; }

module.exports = { CLIS, IDS, cliOf, cliModel, IS_WIN };
