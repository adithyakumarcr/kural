## Not released yet

- **Search & Ask, one side bar with two tabs.** **Search** (Ctrl+Shift+F) finds and replaces in your files with
  everything VS Code's own Search had: Match Case, Whole Word, Regular Expression, Preserve Case, files to include and
  exclude, open editors only, results as you type, history, tree or list, Replace Preview, Replace All, dismiss,
  right-click Copy, F4 for the next result. **Ask** is the same as before. VS Code's own Search icon is gone.
- **Kural Settings.** The person icon in the status bar opens a tab instead of a long pop-up list: a card each for
  Claude, Google Gemini, ChatGPT (Codex) and your own model (who's logged in, plan, usage, switch account, log out), and
  Kural's version, updates and links.
- **No Output tab.** VS Code's Output tab at the bottom is gone; Kural's log opens with **Kural: Show Log** (or Kural
  Settings → Kural's log).
- **Ask's example** is now a general one ("where are the user's settings saved?").
- **Fixed:** Shift+Enter in the chat made a new line below the box's edge without scrolling to it.
- **Split a chat by dragging its tab.** Drag a chat tab out of the Kural panel into the editor area: it opens there,
  split like VS Code's editors (beside, above or below), and comes back after a restart. The split button is gone.
- **A tidier Kural panel title bar:** the Claude Code button and Check for Updates are gone from it (Claude Code:
  Ctrl+Esc; updates: Kural Settings, Help menu).
- **Fixed: icons off centre.** The round send buttons (chat, Ask) kept the browser's own button padding, which left too
  little room for the arrow, so it sat a few pixels right of the middle; Get started's check marks sat a little low.
- **Tab Completion: Set up installs Ollama for you.** Without Ollama, the Tab panel's Set up used to open ollama.com
  in the browser. Now one click does everything: Kural downloads Ollama (with a percent), installs it (with a percent),
  starts it, then downloads the model. Get started's and the chat's "Install Ollama" do the same, with a notification.
  On Ubuntu the system asks for your password (Ollama installs for the whole computer).

## What's new in 1.1.0-alpha.4

- **Tab Completion uses a model on your computer only after you chose one.** A model left over from an earlier install
  showed as "ready" although you never set it up. The panel now says "Not set up" with a **Set up** button until you
  pick it (or set up your own model in Get started).
- **Built from the code? Kural says so.** A Kural built with `./install.sh` shows "Unreleased version · main (commit)"
  instead of the release number, in the chat and the Account menu, so you know you're not on a release.
- **Fixed: logging in to Google Gemini on a Mac closed at once.** The login screen ran through a helper that quits on
  a Mac when it isn't started from a terminal. It now runs in a normal terminal: Antigravity opens Google's login page
  (or Kural does), and if Google shows a code, Kural asks for it in a pop-up and types it in. If the screen closes by
  itself, Kural says what it showed.
- **Fixed: Gemini logged out showed "Kural can't tell whether Gemini is logged in" and a failed test.** Antigravity
  says "authentication failed or timed out" when it isn't logged in; Kural now reads that as "not logged in" and shows
  the Log in step.
- **Fixed: logging out of Google Gemini didn't stick.** Antigravity keeps its Google login in your keychain, and a new
  Antigravity signed in with it by itself, even after logging out or reinstalling. **Log out** in the Account menu now
  removes that saved login too.
- **Fixed: after installing Claude Code, the Log in step got stuck.** It said "Finish logging in in your browser" but
  no login had started, and its Log in button was hidden. Now the Log in button shows once Claude Code is installed.
- **Kural asks before going outside your project, and never looks through your private folders.** On a Mac, an app
  that opens Desktop, Documents, Downloads, Music or Photos makes macOS ask "Kural would like to access…". Kural now
  stays inside your project: the AI reads and changes files there without asking, and anywhere else it asks you first
  (a "Read this file?" or "Change this file?" card; files you attach are fine). Kural never searches through those
  folders on its own (not when your home folder is open, not in the terminal's suggestions, not with no folder open).
- **Safer in folders you haven't trusted.** A downloaded project can't change which programs Kural runs or switch it
  to Auto, and its own Claude Code setup (hooks, MCP servers) isn't loaded until you trust the folder.
- **Other security fixes.** Updates are only installed from Kural's GitHub releases and checked against GitHub's
  checksum. A terminal suggestion that hides a key press is thrown away. Pasted pictures and Kural's short-lived files
  sit in a folder only you can open. A device's username can't sneak in an SSH option.
- **Themes like VS Code.** Kural Dark and Kural Light now look like VS Code's own: code in many colors (keywords,
  strings, functions, types each their own), easy to read. Purple, Kural's color, marks only buttons, the active tab,
  focus and links. Code in chat answers is colored the same way.
- **Gemini's thinking level is the intensity.** The model menu shows each Gemini model once (no more "(Low)",
  "(Medium)", "(High)" copies); Low, Medium, High and Max in the menu pick the level.
- **AI Usage panel.** At the bottom, next to Terminal: each limit in words, "5-hour limit 50% used, resets in 42 min",
  "Weekly limit 25% used, resets in 3 days 4 h", with a bar, for Claude, Gemini and Codex. The status bar shows the
  chat's AI the same way ("Claude 5h 50% · resets 42m | Weekly 25% · resets 3d 4h"); click it for the panel.

- **Google Gemini, with your Google account.** Kural runs Google's Gemini models through Google's **Antigravity CLI**,
  with your Google account (free, AI Pro or Ultra). Google stopped personal accounts in its older Gemini CLI on 26 Sept
  2026, so Kural uses Antigravity and calls it Google Gemini (Gemini CLI isn't offered any more). Get started installs it
  with Google's installer, logs in (Kural opens Google's login page, asks you for the code Google shows in a pop-up and types it into
  Antigravity's own login screen) and tests it; its models
  are in the model menu, its weekly limits in the status bar. It can't ask before acting, so in Agent mode it edits
  files but runs no commands (the answer says which it skipped); Auto runs them.
- **No more keychain password prompts on the Mac.** The prompt for "… Safe Storage" came from VS Code quietly looking
  for a GitHub login at every start (for Copilot, which Kural doesn't have) and, in projects cloned from GitHub, for
  branch protection and avatars. Kural turns those lookups off; pushing to GitHub from Source Control uses Git's own login, like in a terminal.
- **Devices log in with an SSH key; the password isn't saved.** The password is used once, when you add a device, to
  put Kural's own SSH key on it (like `ssh-copy-id`); after that Kural logs in with the key. Nothing goes into the
  keychain. **Set up again** puts the key back after reinstalling a device; **Remove** takes it off.
- **See what an install is doing.** While installing, the Get started page shows the command, how long it has run, its
  latest output, and a warning when it has printed nothing for a minute; **Stop** ends it. After 3 quiet minutes Kural
  asks whether to keep waiting.

- **Installing and logging in to Codex without a terminal.** **Install for me** uses whatever your computer has
  (Homebrew on a Mac, otherwise npm), runs in the background, and turns any question the installer asks into a pop-up.
  On a Mac without Homebrew or Node.js, Kural says so and opens Node.js's download page instead of failing in a
  terminal. **Log in** opens the login page in your browser directly.

- **Devices over SSH.** Working on a Raspberry Pi or a board computer? **+ → Link device** saves it once (name,
  address, username, password) and links it to the chat. The AI can then run commands and read and write files on it,
  asking you first in Agent mode. Click the device's chip for a terminal on it. The password is used once to set up
  Kural's SSH key on the device and is never saved or sent to an AI. **Kural: Devices** to set it up again, forget a device's
  key or remove it.

- **ChatGPT (Codex).** Use your ChatGPT plan (through OpenAI's Codex CLI), like Claude. Get started installs, logs in
  and tests it; its models are in the
  chat's model menu; the chat edits files, runs commands (asking first in Agent mode), and Undo works. Ask, Ctrl+K,
  commit messages and plain words in the terminal use it too. (Agent teams and Claude Code's connectors stay
  Claude-only.)
- **Usage meter in the status bar, back and better.** `Claude 45% · 24%` shows the 5-hour and weekly limits used,
  orange from 80 % and red from 95 %, with reset times on hover. It comes from Claude Code itself after every answer,
  so there are no Keychain prompts. Gemini and Codex show their limits the same way. The Account
  menu has a section for each provider (who's logged in, usage page, switch account, log out).
- **Thinking no longer jumps.** Thinking is one steady line ("Thinking…" with its latest thought, then "Thought for
  12 s"; click to read it all). Before, a box grew with each burst of thinking and collapsed afterwards, so the answer
  jumped around. New tool lines are added without redrawing the rest of the answer.
- **Change the mode while Kural answers.** Agent → Auto: the commands waiting for your OK run at once, and later ones
  don't ask. Auto → Agent: Kural asks before the next command.
- **Pictures, really.** "Show me @chart.png" now shows the picture: pictures you mention with @ appear in your message,
  and the model is told how to show one in its answer. Pictures from anywhere in your home folder can be shown.
- **A clear Back button** on the History and Models on this computer pages, and no emoji in model descriptions from
  ollama.com.
- **Fixed: the Linux build failed** (a test step looked for a file that moved).

- **Account menu** (person icon in the status bar). Shows who's logged in to Claude and your plan, opens your usage
  page, and lets you **switch account**, **log out** or **log in**. It replaces Claudemeter, which read your login from
  the macOS Keychain: the Mac asked for permission again after every update, and then it stopped working.
- **Updates are checked by themselves** once a day; a new version is offered in a small notification, never installed
  without asking. **Check for Updates** is also in the Chat panel's **…** menu and the Account menu, in case the Help
  menu doesn't show it (reported on the Mac). Setting `kural.updates.autoCheck`.
- **The Mac asks only for what Kural needs.** No more requests for Apple Music, Photos or other private folders: with no
  project open, Kural's AI works in its own folder instead of your home folder, and never looks through your Music,
  Pictures or Library folders. The Mac build no longer allows camera or microphone use at all.
- **Terminal: plain words become commands.** Type `push this code to fix/code-editor branch` or `commit with message
  added the low stock check`, and Kural suggests `git push origin HEAD:fix/code-editor` or
  `git commit -m "Added the low stock check"`. Tab puts it in place of your words; Enter runs it.
- **Learn mood** (replaces Teacher). It first asks which ideas behind your question you already know, explains only the
  others, answers the question, then checks you got it with a short question.
- **Pictures in the chat.** Pictures in answers show: from your project, ones the model read, ones an image model made.
  Pictures from the internet wait for a click (loading one would tell that website you read the answer). Images you
  attach show as thumbnails.
- **Smoother answers.** Thinking and text no longer jitter while they stream, and the chat doesn't pull you down while
  you're reading further up; **Latest** brings you back. The "See log" note during long thinking is gone.
- **Links in answers open** in your browser, and long addresses wrap instead of widening the chat.
- **Kural knows its own features.** Ask the chat "can Kural …?" or "how do I …?". If Kural can't do it, it says so and
  links to a feature request. Every feature is also explained in the new
  [Kural wiki](https://github.com/adithyakumarcr/kural/wiki).
- **One icon set, no emoji.** Every Kural panel uses VS Code's own icons (Codicons).
- **Tab Completion panel, simpler.** The speed check is gone; the panel shows how long the last suggestion took. It
  shows only the model choice for the engine you picked. Suggestions when you place the cursor, and learning from your
  work, are always on (no more switches).

- **Use Kural with your own model, without Claude.** Kural now runs models on your computer (Ollama) with its own
  engine, not through Claude Code: no Claude account, no subscription, no internet. It reads and edits files, searches
  your project, asks before running commands, and keeps or undoes each change, like with Claude. Before, local models
  still needed Claude Code, and Get started, Ask, Ctrl+K and commit messages needed Claude and the internet.
- **Ask, Ctrl+K, Apply and commit messages use the chat's model.** Pick a model once, in the chat. (Their separate
  model settings are gone.) Switch a chat between Claude and a local model and the conversation carries over.
- **Kural's own name.** The chat says "Ask Kural to change something…", Ask says "Kural searches your project", and
  Kural Tab is now **Tab Completion**. "Claude" appears where you pick Claude's models.
- **Get started.** Without Claude Code (or without a login) Kural used to show errors whenever you used the chat, Tab
  or Ctrl+K. Now a **Get started** page opens the first time and asks where Kural's AI comes from. **Claude**: it checks
  that Claude Code is installed (**Install for me** runs Anthropic's official installer), that you're logged in (**Log
  in** opens your browser), and sends one tiny test request. **Your own model**: Ollama, a model that fits your
  computer (pick or download one), and a test request. Either way unlocks Kural; until then nothing runs in the
  background, so there are no errors. Git and a Tab Completion model are shown as optional. If Claude Code breaks later (removed, logged out), the page opens again at that step. **Kural: Get Started**
  opens it any time.
- **Kural finds Claude Code in more places.** Opened from the Dock or a menu, Kural didn't get your terminal's PATH, so
  an install it doesn't know about (e.g. npm under nvm) wasn't found. Now it asks your login shell too, and Get started
  has **Choose the claude file…** (setting `kural.claudePath`).
- **Models on your computer in the chat (offline).** Besides Opus, Sonnet and Haiku, the model menu now lists
  **On this computer**: your Ollama models that can use tools. The chat works the same with them (it edits files,
  asks before commands), privately and without internet. **Find & download models…**
  searches Ollama's library, shows how much memory each size needs compared to your computer, downloads with a
  progress bar, and lets you use or delete installed models. Only models that can chat and run offline are shown
  (no cloud-only models, no models without tools). Needs Ollama 0.8 or newer.
- **New agent roles: a project team.** The lead is now the **Project Manager**: it gets the requirements from you
  and asks when something is unclear. **Researcher** (searches online, proposes a plan), **Architect** (studies your
  architecture, picks the solution), **Developers** (1–3, the PM decides) and **Tester** (checks every piece of code).
  With **Split the work**, the team runs as a project: plan, **your OK** on the plan, build, review, report. Pick any
  combination; with only a Researcher and/or Architect you get the plan. The old Debugger, Critic and Explorer roles
  are gone (the Critic and Explorer *moods* stay). **Discuss & decide** uses the new roles too.

## What's new in 1.1.0-alpha.3

- **Kural Light theme.** A light theme with the same look as Kural Dark. Every text color, in the code, the
  menus, the terminal and Kural's panels, has at least 4.5:1 contrast with its background, so it's easy to read. Tab's
  grey suggestions stay readable too. In the chat, code blocks use the normal text color. Pick it with
  *Preferences: Color Theme*; with *Auto Detect Color Scheme* on, Kural follows your computer's light/dark mode.
- **Full chat history, from every workspace.** The clock button lists all your chats (before: only this workspace's
  last 100, shortened). Search, filter *All workspaces / This workspace*, **pin** chats to the top, **delete** chats
  (it asks once). A chat from another workspace opens to read; **Open its folder** or **Continue here** (a new chat
  that knows the old conversation). Your existing closed chats move into History by themselves.
- **Two chats at once.** The split button in the Kural panel's title bar opens a second chat beside your code.
  Each one has its own tab, input and answer, and both can work at the same time. You can drag it anywhere,
  even to another screen. It comes back after a restart.
- **Tab in the terminal.** Type in Kural's terminal and Kural suggests the whole command line in the terminal's
  suggestion list; Tab fills it in, and you still press Enter yourself. Made for commit messages: for
  `git commit -m "` it reads your staged changes (or unstaged, if nothing is staged) and names the commit. It uses
  the same engine and model as Tab in the editor. Kural turns on the terminal's "suggest while typing" for this.
- **Tab learns from your work.** With each suggestion, Kural now tells the model what you've been doing in this
  workspace: what you asked the chat and which files it changed, Ctrl+K and Apply changes you accepted,
  suggestions you accepted, the file you just edited, and the commands you run. Suggestions fit your current task and
  style. Commit messages in the terminal say *why* you changed things, in the style of your earlier commits. It's kept
  only on this computer, per workspace; commands with passwords or tokens are never kept. The Tab panel shows what it
  has learned, with **Forget** and an off switch (also: **Kural: Forget What Tab Learned**).
- **Multiple agents no longer get stuck.** An agent waiting for a message from a teammate who had already
  finished used to wait forever, so the lead never gave the final answer. Now agents are told when a teammate
  has finished, stop waiting after two empty waits, and end with their final position. An agent that shows no
  sign of life for 6 minutes is stopped, and the lead answers with what it has. A **Finish now** button next to
  "Waiting for …" stops the agents still working and gets the answer right away.
- **Link a Jira ticket to a chat.** **+ → Link ticket** searches Jira (your recent tickets, a key like
  PROJ-123, or words) and links the epic, story or task to the chat. Every message then tells Claude which
  ticket you're working on, and Claude reads its details from Jira when it needs them. This uses your
  Atlassian connector; if that isn't connected, the menu shows ⚠ and how to connect it. Reading Jira doesn't
  ask for permission; writing to it (comments, status changes) still does. **+** is now a small menu: Add files,
  or Link ticket.
- **Help → Check for Updates…** Kural looks for the newest release on GitHub (also alpha, beta and rc test
  versions), and if there's a newer one, downloads it, installs it and restarts. On Ubuntu it asks for your
  password to install. On a Mac it replaces Kural.app; on Windows it runs the setup.
- **A simpler home screen.** Kural, *AI-powered code editor*, the tagline "Few words. Working code.", and three hints.
  Everything else is in the menus.
- **Ask only.** The left "Ask & Search" panel is now just **Ask** (find code by describing it). For plain text search,
  use VS Code's own search (Ctrl+Shift+F).
- **Ctrl+S (Cmd+S) always saves.** It no longer switches the model when the chat has focus; pick the model in the
  model menu.
- **"Your Claude Code setup" takes one line** in the model menu ("10 connectors · 3 need attention · 30 skills").
  Click it to see each connector.
- **Fixed:** Tab in the terminal now closes a commit message's quote when the model forgets to; the dot of the
  chosen model sat off-centre (it was a "●" text character, which fonts don't centre; now it's drawn as a circle).
- **New license: MIT with the Commons Clause.** Kural stays free to use and change, also at work, but nobody may sell
  it or a paid service built mainly on it. Earlier versions you already downloaded keep the plain MIT license.

## What's new in 1.1.0-alpha.2

- **See the agents' discussion as it happens.** Their messages to each other now appear in the answer, in order,
  right where you're reading. Before, they sat inside the agent cards above the lead's text, out of sight.
- **See the thinking.** Claude's thinking shows as a short summary ("Thought for 12 s", click to open). Each agent's
  card shows what it's doing right now, its thinking, and its notes. This needs a recent Claude Code; older versions
  simply don't show it.
- **Removed the separate "Attach files" area** under the chat. Attach with **+**, paste a screenshot, or hold
  **Shift** and drag files from Kural's file explorer into the chat.
- **Fixed: Kural quit right after opening on a Mac.** Electron finds its helper programs by the app's name. The app
  was renamed to Kural, but its helpers were still called "VSCodium Helper", so Electron stopped at launch. The
  helpers (and the program and the `kural` command) are now renamed too. Every release is now opened for real on
  macOS, Ubuntu and Windows before it's published.

## What's new in 1.1.0

First public version, released as the test version **1.1.0-alpha.1**.

- **ClaudeX is now Kural Code Editor** (by Adithya Chinnakkonda): new name, `{K}` logo, `kural` command, settings
  under `kural.*`. Installing it on Ubuntu replaces ClaudeX. It keeps its own settings and chats, separate from ClaudeX's.
- **Fixed: Ctrl+K could break indentation.** The first line of an edit sometimes came back one space short (4 spaces
  became 3), because spaces at the very start of Claude's reply can get lost. Claude now wraps the code in
  `<code>…</code>`, and the spaces inside are kept.
- **Mac `.dmg`** besides the `.zip`.
- **Releases are built and checked automatically**: pushing a `v*` tag builds all three, installs and starts the
  Ubuntu package on 22.04 and 24.04, checks the Mac signature, installs the Windows setup, then publishes the release.

## What's new in 1.0.8

- **Fixed: local Tab model showed nothing.** An empty answer was silently dropped, and on a computer without a fast
  GPU the model could take longer than Kural waited (each key you typed cancelled it again). Now: shorter context and
  shorter answers for the local model; **Auto races both engines** (local gets a head start, Claude takes over if it's
  slow or empty), so Auto is never slower than Claude alone; every local result is logged.
- **Speed check** in the Tab panel: "Test local model" runs one real completion and shows the time and the answer,
  or exactly what went wrong.

## What's new in 1.0.7

- **Local Tab model for speed (like Cursor).** Tab can use a small code model on your own computer through
  [Ollama](https://ollama.com): `qwen2.5-coder` (0.5B / 1.5B / 3B), which fills in code between what's before and
  after the cursor. Expect roughly 150–300 ms on Apple Silicon or a GPU (CPU-only computers are slower; try 0.5B).
  The Tab panel installs Ollama and downloads the model for you. Engine **Auto** uses it when it's ready and Claude
  otherwise; Claude still does chat, Ctrl+K and agents.

## What's new in 1.0.6

- **Tab panel with a real slider.** Click **Tab** in the status bar: a panel at the bottom with an on/off switch, a
  speed slider you can drag, the model, and how fast recent suggestions came.
- **Agents do their roles.** Each role has real duties (the Critic must raise concrete objections before agreeing,
  the Tester runs tests, the Researcher brings evidence…). In discussions everyone forms their own view first and
  agreement must be earned; in split work, results are handed to the right teammate and reviewed before anyone is done.
  The final answer shows each agent's position and any remaining disagreement.

## What's new in 1.0.5

- **Agent discussions hold until they conclude.** The answer stays open (with "Waiting for Rachel and Ross to
  finish…") until every agent has reported, and the conclusion always comes back to you. Nothing restarts Claude
  while agents are still working; only Stop ends it early.

## What's new in 1.0.4

- **Drag & drop fixed.** Drop files on **Attach files** under the chat, straight from your file manager.
- **Moods**: Explorer, Critic, Teacher (model menu).
- **Agent roles**: Developer, Tester, Researcher, Debugger, Critic, Explorer, any combination.
- **Discuss & decide**: agents with roles talk it through and agree on a decision; you get the decision,
  the reasons and any disagreement.

## What's new in 1.0.3

- **Chat keeps up with your Claude Code setup.** Connectors, MCP servers, plugins and skills are loaded, and
  when you add one (`claude mcp add`, a plugin, a connector on claude.ai) the open chat reloads it in the same
  conversation. The model menu shows what's connected, with a Reload button.
- **Switch models mid-answer.** The next step already uses the new model.
- **Faster tab completion**, **Ctrl+Alt+Space** to turn it on/off, and a **speed slider** when you hover
  **Tab** in the status bar.

## What's new in 1.0.2

- **Agents talk to each other.** A team's agents are named after the Friends cast (Rachel, Ross, Monica, …) and can
  message each other; their messages show on their cards.
- **Attach anything**: the **+** button, paste a screenshot, or hold Shift and drop files. Claude sees images and PDFs.
- **Claude asks you questions with options** when a choice is yours.
- **All workspace folders** work: add a folder to the workspace and Claude can use it.
- **Chat shortcuts**: Ctrl+S next model, Ctrl+M / H / O intensity, Ctrl+P Plan mode.
- **Bigger text** in menus, side bar and chat (same as the code), and the **Kural logo** instead of VSCodium's.
- Fixed: **Stop** didn't work while agents were running (the button stayed stuck).

## What's new in 1.0.1

- **Purple theme** (VS Code grey + purple, Obsidian-style) and VS Code's normal left side bar.
- **Tab completion** works mid-line, shows a suggestion when you place the cursor, and turns a comment into code.
- **Chat**: Agent / Auto / Plan / Ask modes, **Build it** under a plan, proper tables, rename a tab by double-clicking,
  clock button with all old chats, new chats remember your last model, intensity and mode.
- **Multiple agents**: pick a model and 2–5 agents; they split the task and work at the same time.

## Downloads

| Your computer | File |
|---|---|
| **Mac with Apple Silicon** (M1–M5) | `Kural-…-macos-arm64.dmg` (or the `.zip`) |
| **Ubuntu 22.04 / 24.04** (x64) | `kural_…_amd64.deb` |
| **Windows 10 / 11** (x64) | `Kural-…-windows-x64-setup.exe` (or the portable `.zip`) |

Kural's **Get started** page helps you install **Claude Code** and log in the first time you open it.

### Mac
1. Open the `.dmg` (or unzip the `.zip`) and drag **Kural** into **Applications**.
2. Kural isn't signed with a paid Apple developer ID, so allow it once in Terminal:
   `xattr -dr com.apple.quarantine /Applications/Kural.app`
   (or open it, then System Settings → Privacy & Security → **Open Anyway**).

### Ubuntu
`sudo apt install ./kural_*_amd64.deb`

### Windows
Run the setup. If Windows says "Windows protected your PC", click **More info → Run anyway**
(Kural isn't code-signed). Installs for your user; no admin rights needed.
