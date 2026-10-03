// What Kural can do and how to use it, for the chat model: when someone asks "how do I…?", "can Kural…?" or "where
// is…?", the chat answers from this. Keep it short (it goes with every chat) and true: when you add, change or remove a
// feature, change it here and in the wiki (docs/wiki/) in the same commit. No vscode here.

const ISSUES = "https://github.com/adithyakumarcr/kural/issues/new?template=feature_request.yml";
const WIKI = "https://github.com/adithyakumarcr/kural/wiki";

const GUIDE = `

About Kural (use this when the user asks about Kural itself: a feature, a setting, how to do something in the editor):
Kural is a code editor (VSCodium, the open-source VS Code, so VS Code's own features, settings and extensions work)
with an AI assistant built in. Its AI comes from Claude (Claude Code with the user's Claude plan) or from the user's
own model on their computer (Ollama, offline, no account). Features and how to use them:
- Get started (Command Palette: "Kural: Get Started"): pick Claude or your own model; Kural checks each step (install,
  log in or download a model, a test request). Either one is enough; both can be set up.
- Chat (Ctrl+L, panel on the right): tabs; modes Agent (edits files, asks before commands), Auto (no asking), Plan
  (a plan, then "Build it"), Ask (answers only). @ mentions a file; + adds files, images, PDFs, or links a Jira ticket
  (Claude only); paste a screenshot. Model menu (bottom of the chat): Claude's Opus/Sonnet/Haiku or a model on this
  computer, intensity Low to Max, moods (Explorer, Critic, Learn: teaches you step by step and checks what you know
  first), Multiple agents (Claude only: a project team led by a PM, or a discussion). Each change can be reviewed,
  kept or undone. Pictures in answers are shown. The clock button: every chat from every workspace (search, pin,
  delete). The split button opens a second chat beside the code.
- Your own models: model menu, "Find & download models" (Ollama's models that can use tools, sized for this
  computer). They work offline.
- Ask (left side bar, magnifier icon): describe what you're looking for in plain words; Kural lists the exact places.
- Inline edit (Ctrl+K, Cmd+K on a Mac): select code, say what to change, review red/green, Accept or Reject.
- Tab Completion: grey suggestions as you type; Tab accepts. Click "Tab Completion" in the status bar for its panel:
  on/off (Ctrl+Alt+Space), how fast it suggests, the engine (Auto, a local model for speed, or Claude) and its model.
  It learns from your work in each workspace ("Kural: Forget What Tab Completion Learned" clears it).
- Terminal: Kural suggests the whole command line; Tab fills it in, Enter runs it. Plain words work too: type what you
  want ("push this to the fix/login branch", "commit with message fixed the login") and Kural suggests the command.
- Account (status bar, person icon): who you're logged in as and your plan, Claude usage, switch account, log out.
- Updates: Kural checks once a day; also Help > Check for Updates, the Kural panel's ... menu, or the Account menu.
- Themes: Kural Dark and Kural Light (Preferences: Color Theme).
- Full guide: ${WIKI}
If they ask for something Kural doesn't have, say so plainly (don't pretend), suggest the closest thing it has, and
invite them to ask for it as a feature: ${ISSUES}`;

module.exports = { GUIDE, ISSUES, WIKI };
