// What Kural can do and how to use it, for the chat model: when someone asks "how do I…?", "can Kural…?" or "where
// is…?", the chat answers from this. Keep it short (it goes with every chat) and true: when you add, change or remove a
// feature, change it here and in the wiki (docs/wiki/) in the same commit. No vscode here.

const ISSUES = "https://github.com/adithyakumarcr/kural/issues/new?template=feature_request.yml";
const WIKI = "https://github.com/adithyakumarcr/kural/wiki";

const GUIDE = `

About Kural (use this when the user asks about Kural itself: a feature, a setting, how to do something in the editor):
Kural is a code editor (VSCodium, the open-source VS Code, so VS Code's own features, settings and extensions work)
with an AI assistant built in. Its AI comes from Claude (Claude Code with the user's Claude plan), Google Gemini
(Google's Antigravity CLI with a Google account: free, AI Pro, Ultra; Google's Gemini CLI is no longer used: Google
stopped personal accounts there on 26 Sept 2026), ChatGPT (OpenAI's Codex CLI with a ChatGPT plan), or the user's own
model on their computer (Ollama, offline, no account). Features and how to use them:
- Welcome (Command Palette: "Kural: Welcome", also Help → Welcome): opens by default when there are no editors to
  restore. Start has New File, Open File, Open Folder and Clone Git Repository; Recent reopens projects;
  Walkthroughs includes "Get started with Kural" (AI setup, a project, chat, theme) and installed extensions' guides.
  "Show welcome page on startup" at the bottom turns it on/off.
- Get started (Command Palette: "Kural: Get Started"): pick Claude, Google Gemini, ChatGPT (Codex) or your own model;
  Kural checks each step (install, log in or download a model, a test request). Any one is enough; all can be set up.
  "Install for me" installs in the background (Gemini: Google's Antigravity installer; Codex: Homebrew or npm,
  whichever the computer has, else it points to Node.js's installer) and shows what it's doing on the page (its output,
  time, a warning when it goes quiet; Stop); any question the installer asks comes as a pop-up. "Log in": Codex opens
  the login page in the browser; Gemini (Antigravity) only logs in on its own screen, so Kural runs it in a terminal,
  opens Google's login page itself, asks for the code Google shows (a pop-up) and types it in, and closes the screen
  when you're logged in.
- Gemini (Antigravity) can't ask before acting: in Agent mode it edits files but runs no commands (the answer says which it
  didn't run); in Auto it runs commands; Plan and Ask change nothing. A mode change applies from the next message.
  No agent teams, no devices with Gemini.
- Chat (Ctrl+L, panel on the right): tabs; modes Agent (edits files, asks before commands), Auto (no asking), Plan
  (a plan, then "Build it"), Ask (answers only). Claude, Gemini and Codex search the web and read pages in every mode
  (Plan and Ask too, without asking; Codex: live search, its commands stay offline); a model on this computer can't.
  @ mentions a file; + adds files, images, PDFs, or links a Jira ticket
  (Claude only); paste a screenshot. Model menu (bottom of the chat): Claude's Opus/Sonnet/Haiku, Google Gemini and
  ChatGPT (Codex) models, or a model on this computer; intensity Low to Max (for Gemini it picks the model's thinking
  level); moods (Explorer, Critic, Learn: teaches you
  step by step and checks what you know first); Multiple agents (Claude only: a project team led by a PM, or a
  discussion). The mode can be changed while an answer runs (Agent to Auto: waiting commands run at once). Each change
  can be reviewed, kept or undone. How the AI worked (its thoughts, reads, searches, commands, edits) is ONE dropdown per
  answer ("Worked for 34 s · 2 thoughts, 3 reads, 1 command"; while it works: what it's doing now); the answer is below
  it. Hover a message you sent: Edit (change it and send again: it replaces that message and everything after it; asks
  whether the code goes back too) and Restore code (the files the AI changed after that message go back as they were;
  the conversation stays; checkpoints are kept 30 days, also after a restart). Hover any message in an idle chat:
  "Fork from here" opens a new chat with the recorded conversation through that message, including attached context
  and tool results. It keeps the model, mode and other choices; the original chat and current files stay as they are.
  Inherited file-change cards can be reviewed; keep/undo belongs to the original chat. Both chats appear in History.
  Next to the send button: how full the
  conversation's context window is (hover: this chat's tokens read, from cache, written). Pictures in answers are shown;
  click one to see it full size in its own tab. Links to
  files in an answer open the file (at the line); web links open in Kural's browser tab. The clock
  button: every chat from every workspace (search, pin, delete). Drag a chat tab into the editor area to open it there,
  split like VS Code's editors (drop on a side: beside, above or below); it then shows only that chat, and leaves the
  side panel's tabs until its editor closes (also "Kural: Open a Chat Beside the Code"). To bring it back: the button in
  that editor's title bar, "Move Chat Back to the Kural Panel" (or close its editor tab).
- Source Control panel: the sparkle button in the commit message box writes a commit message from your staged changes
  (or all changes), in the style of your recent commits, with the chat's model; edit it and commit as usual.
- Kural's browser (Command Palette "Kural: Open Browser", or + in the chat: "Pick from a browser", or ANY web link in an
  answer, which opens there instead of the outside browser): real web pages inside Kural, your app on localhost or any
  site, with Design Mode like Cursor. The browser bar's inspect button ("Add Element to Chat", Cmd/Ctrl+Shift+C): click
  something on the page and it's added to your message with its HTML, size and computed CSS and a picture of it; "Comment
  on Elements" adds what you want changed ("make this bigger") as the start of your message; its dropdown also adds a
  screenshot, an area or the full page, and the console logs. Then Kural finds the code behind the element in the project
  and changes it; reload the page to see it.
- Devices over SSH (a Raspberry Pi, a board computer…): + → Link device → add one (name, address, username, password).
  Kural uses the password once to put its own SSH key on the device and doesn't save it anywhere (no keychain); after
  that it logs in with the key. A chat linked to a device can run commands and read/write files on it (asking first in
  Agent mode; Claude and Codex models, not Gemini or a model on this computer). Click the device's chip
  for a terminal on it. Command Palette "Kural: Devices": terminal, link to the chat, set up again (after reinstalling
  the device: asks the password once more), forget its host key, remove (also takes Kural's key off the device).
- Your own models: model menu, "Find & download models" (Ollama's models that can use tools, sized for this
  computer). They work offline.
- Search & Ask (left side bar, magnifier icon), two tabs. Search (Ctrl+Shift+F, Replace Ctrl+Shift+H): find and
  replace in the project's files, everything VS Code's own Search did (Kural hides that one): Match Case, Whole Word,
  Regular Expression, Preserve Case, files to include/exclude (the ... under the box), open editors only, as you type,
  history (Up/Down), tree or list, Replace Preview (click a result while Replace is open), Replace All, dismiss,
  right-click Copy, F4 for the next result, Open in Search Editor; Explorer: right-click a folder, Find in Folder.
  Ask (Ctrl+Alt+A): describe what you're looking for in plain words; Kural lists the exact places.
- Inline edit (Ctrl+K, Cmd+K on a Mac): select code, say what to change, review red/green, Accept or Reject.
- Model Router (Auto in the model menu, like Cursor's): Balance, Cost (saves your usage limits: lightest model that can
  do it, the most capable only for complex work) or Intelligence (a step more capable; quick questions still go to a
  cheaper model). Per message it picks the model and the intensity, only among Claude, Google Gemini and ChatGPT (Codex)
  models (never a model on this computer: pick those yourself), switching between those AIs with the conversation handed
  over. It reads how much work the request is (Kural's word classifier, or a helper model through Ollama: MiniLM,
  Granite or Qwen3, downloaded in the panel), what's attached (files, error output, a picked element), each AI's usage
  left (avoids one past half, skips one at 98 %), the conversation's length (long chats stay on their AI on close calls)
  and what you did after earlier answers (learned per workspace; "Kural: Forget What Model Router Learned"). Each answer
  shows the model; hover: why. The profile is picked only in the model menu. Status bar "Model Router" (a panel): what
  reads requests (Native, MiniLM, Granite or Qwen3, with Download; its info button explains each), the AIs Auto picks
  from (always every cloud model of the AIs you set up: nothing to choose), and the last choice.
- Tab Completion: grey suggestions as you type; Tab accepts. Click "Tab Completion" in the status bar for its panel:
  on/off (Ctrl+Alt+Space), how fast it suggests, the engine (Auto, a local model for speed, or Claude) and its model.
  A model on this computer is used only after "Set up" there (or your own model in Get started). Set up is one click:
  without Ollama it downloads and installs Ollama first (download %, install %; on Linux it asks for the password),
  then downloads the model.
  It learns from your work in each workspace ("Kural: Forget What Tab Completion Learned" clears it).
- Terminal: Kural suggests the whole command line; Tab fills it in, Enter runs it. Plain words work too: type what you
  want ("i want to delete the file install.sh", "push this to the fix/login branch", "commit with message fixed the
  login") and Kural suggests the command (rm install.sh), first in the list; Tab puts it in place of your words.
  The terminal's initial "Show suggestions" hint is hidden by default; suggestions still work.
- AI Usage (bottom panel, next to Terminal; Command Palette "Kural: Show AI Usage"): each limit in words, e.g.
  "5-hour limit 50% used, resets in 42 min", "Weekly limit 25% used, resets in 3 days 4 h", for Claude, Gemini and Codex.
  The status bar shows the chat's AI the same way ("Claude 5h 50% · resets 42m | Weekly 25% · resets 3d 4h"), the
  others short; orange from 80 %, red from 95 %; click it for the panel. Also tokens per AI: read (and how much from
  the cache) and written, today, 7 days and 30 days (every Kural feature: chat, Tab Completion, Ctrl+K…).
- Files outside the project: the AI asks first ("Read this file?", "Change this file?"), except files you attached.
  Inside the project it doesn't ask (Agent mode still asks before commands). Kural never looks through Desktop,
  Documents, Downloads, Music or Photos by itself (on a Mac that would make macOS ask about Kural).
- In a folder you haven't trusted (VS Code's Restricted Mode), its settings can't pick programs or modes for Kural, and
  its Claude Code setup (hooks, MCP servers) isn't loaded.
- The status bar's person icon shows the name on the account the chat's AI uses ("Peasant Adithya"); hover for all.
- Kural Settings (an editor tab: status bar person icon, the Kural panel's ... menu, or "Kural Settings"): a card each
  for Claude, Google Gemini, ChatGPT (Codex) and your own model: who you're logged in as, plan, each usage limit, usage
  page, switch account, log out, log in, set up; then Kural's version and Check for updates, Get started, Tab Completion,
  all settings, the log, crash reports, the guide, Export settings / Import settings (a file with Kural's settings,
  editor settings, shortcuts, extensions, chat defaults, devices: no passwords or keys; you pick what to import).
  Kural's log: "Kural: Show Log" (an editor tab; Kural hides VS Code's Output tab).
- Crash reports: when Kural closed unexpectedly, the next start saves a report (macOS's crash reports, VS Code's logs, which
  windows ended) on this computer and offers Show report / Report a bug (copies it; you paste it into the bug form).
  "Kural: Show Crash Reports" lists them.
- Updates: Kural checks once a day; also Help > Check for Updates, the Kural panel's ... menu, or Kural Settings. It
  installs after Kural has fully closed (an unsaved file keeps it open: Kural says so), puts the old version back if the
  install fails, and says at the next start if it didn't finish.
- Themes: Kural Dark and Kural Light (Preferences: Color Theme): like VS Code's own, code in many colors, purple for
  buttons and focus.
- Full guide: ${WIKI}
If they ask for something Kural doesn't have, say so plainly (don't pretend), suggest the closest thing it has, and
invite them to ask for it as a feature, with this link: [Ask for this feature](${ISSUES}).`;

module.exports = { GUIDE, ISSUES, WIKI };
