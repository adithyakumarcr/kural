// What Kural can do and how to use it, for the chat model: when someone asks "how do I…?", "can Kural…?" or "where
// is…?", the chat answers from this. Keep it short (it goes with every chat) and true: when you add, change or remove a
// feature, change it here and in the wiki (docs/wiki/) in the same commit. No vscode here.

const ISSUES = "https://github.com/adithyakumarcr/kural/issues/new?template=feature_request.yml";
const WIKI = "https://github.com/adithyakumarcr/kural/wiki";

const GUIDE = `

About Kural (use this when the user asks about Kural itself: a feature, a setting, how to do something in the editor):
Kural is a code editor (VSCodium, the open-source VS Code, so VS Code's own features, settings and extensions work)
with an AI assistant built in. Its AI comes from Claude (Claude Code with the user's Claude plan), ChatGPT (OpenAI's
Codex CLI with a ChatGPT plan), Antigravity (Google's Antigravity CLI with a Google account: free, AI Pro, Ultra),
Gemini (Google's Gemini CLI, now only with a Gemini API key or a company account: Google stopped personal accounts there
on 26 Sept 2026 and points them to Antigravity), or the user's own model on their computer (Ollama, offline, no
account). Features and how to use them:
- Get started (Command Palette: "Kural: Get Started"): pick Claude, ChatGPT (Codex), Antigravity, Gemini or your own
  model; Kural checks each step (install, log in or download a model, a test request). Any one is enough; all can be
  set up. "Install for me" installs in the background (Codex, Gemini: Homebrew or npm, whichever the computer has;
  without either it points to Node.js's installer. Antigravity: Google's own installer) and shows what it's doing on
  the page (its output, time, a warning when it goes quiet; Stop); any question the installer asks comes as a pop-up.
  "Log in" opens the login page in the browser (Codex, Gemini); Antigravity only logs in on its own screen, so Kural
  opens it in a terminal and closes it by itself when you're logged in.
- Antigravity can't ask before acting: in Agent mode it edits files but runs no commands (the answer says which it
  didn't run); in Auto it runs commands; Plan and Ask change nothing. A mode change applies from the next message.
  No agent teams, no devices with Antigravity.
- Chat (Ctrl+L, panel on the right): tabs; modes Agent (edits files, asks before commands), Auto (no asking), Plan
  (a plan, then "Build it"), Ask (answers only). @ mentions a file; + adds files, images, PDFs, or links a Jira ticket
  (Claude only); paste a screenshot. Model menu (bottom of the chat): Claude's Opus/Sonnet/Haiku, ChatGPT (Codex),
  Antigravity and Gemini models, or a model on this computer; intensity Low to Max; moods (Explorer, Critic, Learn: teaches you
  step by step and checks what you know first); Multiple agents (Claude only: a project team led by a PM, or a
  discussion). The mode can be changed while an answer runs (Agent to Auto: waiting commands run at once). Each change
  can be reviewed, kept or undone. Pictures in answers are shown. The clock button: every chat from every workspace
  (search, pin, delete). The split button opens a second chat beside the code.
- Devices over SSH (a Raspberry Pi, a board computer…): + → Link device → add one (name, address, username, password).
  Kural uses the password once to put its own SSH key on the device and doesn't save it anywhere (no keychain); after
  that it logs in with the key. A chat linked to a device can run commands and read/write files on it (asking first in
  Agent mode; Claude, Codex and Gemini models, not Antigravity or a model on this computer). Click the device's chip
  for a terminal on it. Command Palette "Kural: Devices": terminal, link to the chat, set up again (after reinstalling
  the device: asks the password once more), forget its host key, remove (also takes Kural's key off the device).
- Your own models: model menu, "Find & download models" (Ollama's models that can use tools, sized for this
  computer). They work offline.
- Ask (left side bar, magnifier icon): describe what you're looking for in plain words; Kural lists the exact places.
- Inline edit (Ctrl+K, Cmd+K on a Mac): select code, say what to change, review red/green, Accept or Reject.
- Tab Completion: grey suggestions as you type; Tab accepts. Click "Tab Completion" in the status bar for its panel:
  on/off (Ctrl+Alt+Space), how fast it suggests, the engine (Auto, a local model for speed, or Claude) and its model.
  It learns from your work in each workspace ("Kural: Forget What Tab Completion Learned" clears it).
- Terminal: Kural suggests the whole command line; Tab fills it in, Enter runs it. Plain words work too: type what you
  want ("push this to the fix/login branch", "commit with message fixed the login") and Kural suggests the command.
- Usage meter (status bar): "Claude 45% · 24%" is the 5-hour and weekly limit used; Codex the same; Antigravity its
  weekly limits; Gemini tokens today.
  Orange from 80 %, red from 95 %. Hover for reset times.
- Account (status bar, person icon): for Claude, ChatGPT (Codex), Antigravity and Gemini: who you're logged in as, plan, usage
  page, switch account, log out, log in.
- Updates: Kural checks once a day; also Help > Check for Updates, the Kural panel's ... menu, or the Account menu.
- Themes: Kural Dark and Kural Light (Preferences: Color Theme).
- Full guide: ${WIKI}
If they ask for something Kural doesn't have, say so plainly (don't pretend), suggest the closest thing it has, and
invite them to ask for it as a feature, with this link: [Ask for this feature](${ISSUES}).`;

module.exports = { GUIDE, ISSUES, WIKI };
