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
  Walkthroughs includes "Get started with Kural" (AI setup, a project, chat, theme), "Learn the Fundamentals" and
  installed extensions' guides. "Show welcome page on startup" at the bottom turns it on/off. It doesn't open by itself
  when Kural restores files from last time: use Help → Welcome. Kural has no VSCodium walkthrough or announcements,
  and Help → Report Issue goes to Kural's GitHub issues.
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
  Multiple agents work with Gemini; devices do not.
- Chat (Ctrl+L, panel on the right): tabs; modes Agent (edits files, asks before commands), Auto (no asking, except
  dangerous commands: sudo, deleting outside the project, curl | sh, a forced push to main, git reset --hard…; the
  first switch to Auto explains this once; Gemini can't ask, so not for Gemini), Plan
  (a plan, then "Build it"), Ask (answers only). Claude, Gemini and Codex search the web and read pages in every mode
  (Plan and Ask too, without asking; Codex: live search, its commands stay offline); a model on this computer can't.
  Files are attached only when you choose them: @ mentions a file; + adds files, images, PDFs, or links a Jira ticket
  (Claude only); paste a screenshot. Model menu (bottom of the chat): Claude's Opus/Sonnet/Haiku (with a Claude model,
  Claude's line also shows its Claude Code setup: "10 connectors · 30 skills", click for each connector, and a reload
  button), Google Gemini and
  ChatGPT (Codex) models, or a model on this computer; intensity Low to Max (for Gemini it picks the model's thinking
  level); moods (Explorer, Critic, Learn: teaches you
  step by step and checks what you know first; and your own: "Add your own mood…" at the end of the moods opens Kural
  Settings → Moods: a name, a one-line hint and instructions for the AI, with tips and examples; edit or delete them
  there; a changed mood or mode applies from the next message); Multiple agents (Claude, ChatGPT and Gemini: a project
  team led by a PM, or a discussion; Kural shares Codex/Gemini agents' reports between phases). The mode can be changed while an answer runs (Agent to Auto: waiting commands run at once). Sending while
  an answer runs (Enter, or the arrow beside Stop) doesn't stop it: the message is queued (shown above the box) and the
  AI takes it in at its next step (after the command or edit it's doing) into the same answer, shown there as "You added
  this while it worked"; if the answer ends first, it's answered right after as your next message (Gemini and Kural-managed teams always do
  that). Stop (the square button, or Esc) stops the answer and puts queued messages back into the box. Each change
  can be reviewed, kept or undone ("Files changed" lists only the project's files: not notes in the temp folder or
  Claude Code's own plans and memory). How the AI worked (its thoughts, reads, searches, commands, edits) is ONE dropdown per
  answer ("Worked for 34 s · 2 thoughts, 3 reads, 1 command"; while it works: what it's doing now); the answer is below
  it. While it works, a "Did you know?" line under "Thinking…" shows a Kural tip or programming fact (a new one every
  15 s; "Know more" opens its page in Kural's browser tab); setting kural.chat.didYouKnow turns it off.
  Notifications: when an answer is done or needs you (a command or file to allow, a question, a plan to build, an
  error, a login), a system notification names the chat ("Fix the login is done"); click it to go there. By default only
  while you're not looking (Kural's window not in front, or that chat not on screen); setting kural.notifications:
  whenAway, always, off. A team's answer notifies once, at the end; Stop doesn't. macOS asks once whether Kural may send
  notifications; if you chose Don't Allow: System Settings > Notifications > Kural. Hover a message you sent: Edit (change it and send again: it replaces that message and everything after it; asks
  whether the code goes back too) and Restore code (the files the AI changed after that message go back as they were;
  the conversation stays; checkpoints are kept 30 days, also after a restart). Hover any message in an idle chat:
  "Fork from here" opens a new chat with the recorded conversation through that message, including attached context
  and tool results. It keeps the model, mode and other choices; the original chat's conversation stays as it is. When
  answers after that message changed files, it first asks whether the code goes back too (Restore Code: those files
  as they were at that message; Keep Code: files stay as they are now).
  Inherited file-change cards can be reviewed; keep/undo belongs to the original chat. Both chats appear in History.
  Next to the send button: how full the
  conversation's context window is (click: AI Usage; hover: tokens in context / context capacity, and total tokens consumed,
  read and written). Pictures in answers are shown;
  click one to see it full size in its own tab. Links to
  files in an answer (and file names in \`code\`) open the file (at the line), also when the answer gives only its name
  or a path from another folder: Kural finds it in the project (several with that name: you pick one); web links open
  in Kural's browser tab. The clock
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
  Ask (Ctrl+Alt+A): describe what you're looking for in plain words; Kural lists the exact places. Ask always uses the
  fastest model you have (Claude's Haiku, or the lightest Gemini or Codex model; your own model if that's all), not the
  chat's model; each result list shows which. An empty box shows no results (in both tabs).
- Inline edit (Ctrl+K, Cmd+K on a Mac): select code, say what to change, review red/green, Accept or Reject.
- Model Router (Auto in the model menu, like Cursor's): Balance, Cost (saves your usage limits: lightest model that can
  do it, the most capable only for complex work) or Intelligence (a step more capable; quick questions still go to a
  cheaper model). Per message it picks the model and the intensity, only among Claude, Google Gemini and ChatGPT (Codex)
  models (never a model on this computer: pick those yourself), switching between those AIs with the conversation handed
  over (everything visible: requests, what was sent, answers, steps and results, files changed, plan and to-do list,
  pictures; a long conversation gets an overview sized for the next model and a complete local history file it can
  read to recover omitted details). It reads how much work the request is (Kural's word classifier, or a helper model through Ollama: MiniLM,
  Granite or Qwen3, downloaded in the panel), what's attached (files, error output, a picked element), each AI's usage
  left (avoids one past half; from 80 % of a Session or Weekly limit it moves to another AI, Claude to ChatGPT (Codex)
  first, then Gemini, even in a long chat; skips one at 98 %), the conversation's length (long chats stay on their AI on
  close calls) and what you did after earlier answers (learned per workspace; "Kural: Forget What Model Router
  Learned"). When an answer stops because its AI reached its usage limit, Auto carries the same request on with another
  AI at once (the stopped answer gets a note) and avoids that AI until the limit resets. Switching a chat to another AI
  yourself (model menu), or switching an AI's account or logging in again, also hands the conversation over. Each answer
  shows the model; hover: why. The profile is picked only in the model menu. The Model Router icon in the status bar
  (two arrows in boxes; hover: "Model Router" and the step that reads requests) opens its panel: only a slider from
  Faster to Quality for what reads requests (four steps: Native, MiniLM, Granite, Qwen3; the panel names the step,
  Download when it isn't on this computer yet; the info button explains each, and says Auto picks from every cloud model
  of the AIs you set up).
- Tab Completion: grey suggestions as you type; Tab accepts. Click the icon in the status bar to enable or disable
  suggestions (sparkle while on, crossed out while off; Ctrl+Alt+Space also toggles). Its hover has a Tab Completion
  settings link, or Kural Settings → Tab Completion opens its panel: on/off, speed, engine (Auto, local or Claude) and model.
  A model on this computer is used only after "Set up" there (or your own model in Get started). Set up is one click:
  without Ollama it downloads and installs Ollama first (download %, install %; on Linux it asks for the password),
  then downloads the model.
  It learns from your work in each workspace only when you turn it on (setting kural.tabCompletion.learnFromActivity,
  off by default; "Kural: Forget What Tab Completion Learned" clears it).
  While a chat answers with a model on this computer (Ollama runs both on one GPU, so Tab's local answers slow to 2-3 s),
  Claude helps Tab if it's set up (also for "Local model"); without Claude, Tab asks a little less often meanwhile.
- Change a name in your code (type over it, or accept a Tab suggestion that changes it) and Kural looks for the old name
  in the rest of the project (whole word, same capitals; not node_modules, dist, build, minified/lock files or prose like
  READMEs) and offers: "count" became "total" here. Also change it in this file (2 places) and 3 other files (7 places)?
  Review opens Search & Ask filled in (Match Case + Whole Word, the new name in Replace); Change all changes every place
  in one edit (Ctrl+Z undoes it). Not for new names you're typing, keywords or one-letter names. Off: setting
  kural.tabCompletion.renameAcrossFiles.
- Memory: Kural's Claude helpers (Tab Completion's, terminal Tab, Ctrl+K, commit messages, Ask) start when they're first
  needed and stop after a few idle minutes (the next use starts them again in about a second); each open chat keeps one
  Claude Code process (~120 MB) while it's on screen or was used in the last 10 minutes (at most two idle ones stay
  warm; it starts again, same conversation, when you open the chat or send to it). Ollama keeps Tab Completion's model loaded 30 minutes after
  the last suggestion. A model on this computer takes gigabytes (a 9B model at kural.localModels.contextLength 32768:
  about 7.8 GB).
- Terminal: Kural suggests the whole command line; Tab fills it in, Enter runs it. Plain words work too: type what you
  want ("i want to delete the file install.sh", "push this to the fix/login branch", "commit with message fixed the
  login") and Kural suggests the command (rm install.sh), first in the list; Tab puts it in place of your words.
  The terminal's initial "Show suggestions" hint is hidden by default; suggestions still work.
- AI Usage (bottom panel, next to Terminal; Command Palette "Kural: Show AI Usage"): one compact summary per AI, its
  most used limit and reset time. Details expands the other limits and tokens. Session = the 5-hour limit (Claude and
  Codex); Gemini has weekly limits.
  The status bar shows only each AI's Session limit: the chat's AI with when it resets ("Claude Session 50% · resets
  42m"), the others short ("Codex 12%"); Gemini, which has only weekly limits, shows its name. Weekly numbers stay in
  the hover at every usage level; hover for every AI's Session and Weekly limits; orange
  from 80 %, red from 95 %; click it for the panel. Also tokens per AI: read (and how much from
  the cache) and written, today, 7 days and 30 days (every Kural feature: chat, Tab Completion, Ctrl+K…).
- Kural Settings → AI Usage: "Automatically switch AI" (off by default) and "Switch at" (70% by default, editable
  from 1 to 99). When a reported Session or Weekly limit for the chat's model reaches it, Kural transfers the same chat
  with its visible context to another available cloud service below the threshold. It waits for commands, edits,
  approvals, background work and agents to finish. A paused request continues there; a completed answer switches for
  the next message. This works with a model you picked yourself and with Auto. Without a suitable service it stays put;
  usage reports can arrive after an answer, so the percentage is a switching trigger, not a hard quota cap.
- Files outside the project: the AI asks first ("Read this file?", "Change this file?"), except files you attached.
  Inside the project it doesn't ask, except for files that run code later (git hooks, .vscode/tasks.json, package.json,
  .env, Makefile, Dockerfile, workflows, shell profiles) and the temp folder (Agent mode still asks before commands). Kural never looks through Desktop,
  Documents, Downloads, Music or Photos by itself (on a Mac that would make macOS ask about Kural).
- In a folder you haven't trusted (VS Code's Restricted Mode), its settings can't pick programs or modes for Kural, and
  its Claude Code setup (hooks, MCP servers) isn't loaded.
- The status bar's person icon shows the name on the account the chat's AI uses ("Peasant Adithya"); hover for all.
- Kural Settings (an editor tab: status bar person icon, the Kural panel's ... menu, or "Kural Settings"): a card each
  for Claude, Google Gemini, ChatGPT (Codex) and your own model: who you're logged in as, plan, each usage limit, usage
  page, switch account, log out, log in, set up; then AI Usage (automatic switching and its threshold), Moods
  (your own chat moods: add, edit, delete); then Kural's
  version and Check for updates, Get started, Tab Completion,
  all settings, the log, crash reports, the guide, Export settings / Import settings (a file with Kural's settings,
  editor settings, shortcuts, extensions, chat defaults, devices: no passwords or keys; you pick what to import).
  Kural's log: "Kural: Show Log" (an editor tab; Kural hides VS Code's Output tab).
- Crash reports: when Kural closed unexpectedly, the next start saves a report (macOS's crash reports, VS Code's logs, which
  windows ended) on this computer and offers Show report / Report a bug (copies it; you paste it into the bug form).
  "Kural: Show Crash Reports" lists them.
- Updates: Kural checks once a day; also Help > Check for Updates, the Kural panel's ... menu, or Kural Settings. It
  installs after Kural has fully closed (an unsaved file keeps it open: Kural says so), puts the old version back if the
  install fails, and says at the next start if it didn't finish. It installs only a release whose checksum list is signed
  by Kural's release key and matches the download; "Kural: Verify this installation..." checks the running version's list.
- Installing on Windows: Windows says "Windows protected your PC" with only "Don't run", because the installer isn't
  code-signed yet: click the small "More info" link, then "Run anyway" ("Unknown publisher"). Kural's own updates don't
  ask again. No "Run anyway" at all: Smart App Control or a company policy blocks unsigned programs.
- Themes: Kural Dark and Kural Light (Preferences: Color Theme): like VS Code's own, code in many colors, purple for
  buttons and focus.
- VS Code's Run and Debug side bar, Debug Console and Ports panels are hidden to keep Kural simple; the setting
  kural.showDebugViews brings them back at once. While you debug (F5), Run and Debug and the Debug Console show anyway.
- Full guide: ${WIKI}
If they ask for something Kural doesn't have, say so plainly (don't pretend), suggest the closest thing it has, and
invite them to ask for it as a feature, with this link: [Ask for this feature](${ISSUES}).`;

// The short version, for a model on this computer: every token of the instructions costs it time before its first word
// (Ross measured the whole guide in a 9,600-token first message: 28 s on an M5 before qwen3.5:9b said anything). The
// essentials and where the full guide is.
const GUIDE_LOCAL = `

About Kural (when the user asks about Kural itself): a code editor (VSCodium, so VS Code's features and extensions
work) with an AI assistant: Claude, Google Gemini, ChatGPT (Codex) or a model on the user's computer (Ollama, offline:
that's you). Main features: Get started (set up an AI); the chat (Ctrl+L: modes Agent, Auto, Plan, Ask; @ mentions a
file; + attaches files; the model menu has models, intensity and moods; hover a message to Edit it, Restore code, or
Fork from here; the clock button has every chat); Ctrl+K edits selected code in place; Tab Completion; plain words in
the terminal ("push this to main", then Tab); Search & Ask; Kural's browser; devices over SSH; the Model Router (Auto);
Kural Settings (accounts, usage switching, moods, updates). Agent teams work with Claude, ChatGPT and Gemini; Jira
tickets and Claude Code's connectors need Claude. For anything else, point to the full guide: ${WIKI}. If Kural can't do something, say so plainly and
link [Ask for this feature](${ISSUES}).`;

module.exports = { GUIDE, GUIDE_LOCAL, ISSUES, WIKI };
