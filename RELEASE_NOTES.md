## What's new in 1.1.0-alpha.3

- **See the agents' discussion as it happens.** Their messages to each other now appear in the answer, in order,
  right where you're reading. Before, they sat inside the agent cards above the lead's text, out of sight.
- **See the thinking.** Claude's thinking shows as a short summary ("Thought for 12 s", click to open). Each agent's
  card shows what it's doing right now, its thinking, and its notes. This needs a recent Claude Code; older versions
  simply don't show it.

- **Removed the separate "Attach files" area** under the chat. Attach with **+**, paste a screenshot, or hold
  **Shift** and drag files from Kural's file explorer into the chat.

## What's new in 1.1.0-alpha.2

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

First install **Claude Code** and log in once (`claude`, then `/login`). Kural uses that login.

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
