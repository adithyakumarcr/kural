<p align="center">
  <img src="docs/logo.png" width="96" alt="Kural logo">
</p>

<h1 align="center">Kural Code Editor</h1>

<p align="center">
  A code editor with Claude built in, in the style of Cursor.<br>
  It uses <b>your Claude Code login</b>, so there's no API key to set up.
</p>

<p align="center">
  <a href="https://github.com/adithyakumarcr/kural/releases/latest"><img src="https://img.shields.io/github/v/release/adithyakumarcr/kural?label=download" alt="Latest release"></a>
  <a href="https://github.com/adithyakumarcr/kural/actions/workflows/build.yml"><img src="https://github.com/adithyakumarcr/kural/actions/workflows/build.yml/badge.svg" alt="Build"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-555" alt="macOS">
  <img src="https://img.shields.io/badge/Ubuntu-22.04%20%7C%2024.04-E95420" alt="Ubuntu">
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4" alt="Windows">
</p>

![Kural: the chat added a method and a test, ran the tests, and shows the change to keep or undo](docs/screenshots/editor.png)

## What is Kural?

Kural is [VSCodium](https://vscodium.com) (the open-source build of VS Code) with Claude built in.
Everything you know from VS Code works the same: extensions, themes, settings, the terminal, Git.
On top of that, Kural adds:

- **A chat that edits your code.** Ask for a change; Claude reads your project, edits files, runs your tests, and you
  keep or undo each change.
- **Tab completion.** Grey suggestions as you type; **Tab** accepts.
- **Inline edit (Ctrl+K).** Select code, say what to change, review it red/green.
- **Teams of agents.** Several Claude agents with roles (Developer, Tester, Critic…) that split a task or discuss it
  and agree on an answer.

Kural runs the `claude` command (Claude Code) in the background. So it uses your Claude plan, your Claude Code
settings, MCP servers, skills and `CLAUDE.md` files. No API key, nothing extra to pay for.

## Install

### 1. Install Claude Code and log in (once)

Kural needs [Claude Code](https://docs.claude.com/en/docs/claude-code/setup). Install it, then run `claude` in a
terminal and type `/login`. Kural uses that login.

### 2. Download Kural

Get the file for your computer from the [latest release](https://github.com/adithyakumarcr/kural/releases/latest):

| Your computer | File |
|---|---|
| **Mac with Apple Silicon** (M1–M5) | `Kural-…-macos-arm64.dmg` |
| **Ubuntu 22.04 / 24.04** (x64) | `kural_…_amd64.deb` |
| **Windows 10 / 11** (x64) | `Kural-…-windows-x64-setup.exe` (or the portable `.zip`) |

**Mac.** Open the `.dmg` and drag **Kural** into **Applications**. Kural isn't signed with a paid Apple developer ID,
so macOS blocks it the first time. Allow it once in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Kural.app
```

**Ubuntu.**

```bash
sudo apt install ./kural_*_amd64.deb
```

Open **Kural Code Editor** from your apps, or type `kural` in a terminal (`kural .` opens the current folder).

**Windows.** Run the setup. If Windows says "Windows protected your PC", click **More info → Run anyway** (Kural isn't
code-signed). It installs for your user only, so you don't need admin rights.

### 3. Optional: a local model for faster Tab completion

Tab completion with Claude takes about 0.6–0.9 s. For suggestions in about 150–300 ms, Kural can use a small code model
on your own computer through [Ollama](https://ollama.com). Click **Tab** in the status bar, then **Install Ollama**
(on a Mac or Windows this opens the Ollama download page). Then click **Check again** and download a model from the same
panel (1.5B is a good start).

## Features

### Chat (Ctrl+L)

The chat sits on the right and has tabs. Pick how much freedom Claude gets:

| Mode | What Claude may do |
|---|---|
| **Agent** | edits files (you keep or undo each one) and asks before running commands |
| **Auto** | edits and runs commands without asking |
| **Plan** | writes a plan without changing anything; **Build it** carries it out |
| **Ask** | only answers |

![Claude asks before running a command](docs/screenshots/permission.png)

Also in the chat:

- **@ mentions.** Type `@` to mention a file in your sentence.
- **Attachments.** **+** adds files, images and PDFs. You can also paste a screenshot, or drop files on **Attach
  files**.
- **Questions with options.** When a choice is yours, Claude asks with options you can click.
- **Model and intensity.** Opus / Sonnet / Haiku, and Low → Max. You can switch in the middle of an answer.
- **Moods.** **Explorer** compares options, **Critic** pushes back, and **Teacher** explains the why.
- **History.** Chats survive restarts. The clock button finds old ones.

### Multiple agents

Turn on **Multiple agents** in the model menu. The lead agent gets a team named after Friends (Rachel, Ross,
Monica…), each with a role you pick. They message each other on a shared board. They can:

- **Split the work.** They work in parallel. For example, the Developer writes the code and hands it to the Tester.
- **Discuss & decide.** Each forms their own view first. Then they argue it out and agree. The answer shows everyone's
  final position and any disagreement left.

| Pick roles and how they work | They discuss and decide |
|---|---|
| ![Multiple agents settings](docs/screenshots/agents-setup.png) | ![A Developer and a Critic discussing](docs/screenshots/agents-discussion.png) |

### Tab completion

Suggestions appear as you type or when you place the cursor, also in the middle of a line. Write a comment, press
Enter, and the suggestion implements it. **Tab** accepts.

![A grey Tab suggestion](docs/screenshots/tab-completion.png)

Click **Tab** in the status bar for the Tab panel. There you can:

- turn suggestions on or off,
- set how quickly they appear,
- pick the engine: **Auto**, **Local model** or **Claude**.

In **Auto**, the local model and Claude race, and the first good answer wins.

![The Tab panel](docs/screenshots/tab-panel.png)

### Inline edit (Ctrl+K)

Select code, press **Ctrl+K**, and say what to change. Then review the change in place and keep it
(**Ctrl+Enter**) or reject it (**Ctrl+Shift+Backspace**). With nothing selected, Ctrl+K writes new code at the
cursor.

![Inline edit: green lines are what Claude adds](docs/screenshots/inline-edit.png)

### More

- **Ask & Search (Ctrl+Alt+A).** Ask "where is the retry limit set?" and get exact `file:line` places. It also does
  fast text and regex search.
- **Claude Code (Ctrl+Esc).** The full Claude Code terminal beside your file.
- **Claudemeter.** Your Claude plan usage in the status bar.
- **Your whole Claude Code setup.** MCP servers, connectors, plugins, skills, hooks and `CLAUDE.md` all work in the
  chat. When you add one, Kural reloads Claude in the same conversation.
- **Kural Dark theme**, and the same text size in the menus, side bar and chat as in the code.

## Keyboard shortcuts

On a Mac, use **Cmd** where it says Ctrl, except for the chat shortcuts marked *(Ctrl on Mac too)*.

| Shortcut | What it does |
|---|---|
| **Ctrl+L** | open the chat; with code selected, adds it to the message |
| **Ctrl+Alt+N** | new chat tab |
| **Ctrl+K** | inline edit |
| **Ctrl+Enter** / **Ctrl+Shift+Backspace** | keep / reject an inline edit |
| **Ctrl+Alt+Space** | Tab completion on/off *(Ctrl on Mac too)* |
| **Ctrl+Alt+A** | Ask & Search |
| **Ctrl+Esc** | Claude Code terminal |
| In the chat: **Ctrl+S** | next model *(Ctrl on Mac too)* |
| In the chat: **Ctrl+M / H / O** | intensity Medium / High / Max *(Ctrl on Mac too)* |
| In the chat: **Ctrl+P** | Plan mode on/off *(Ctrl on Mac too)* |

Inside the editor, Ctrl+K is Kural's inline edit. So VS Code's two-key Ctrl+K shortcuts don't work there, and Git's
moved to Ctrl+Alt+K. Use Ctrl+/ to comment code.

## Build it yourself

Each build script downloads the matching VSCodium once into `downloads/` (about 150–250 MB) and writes the result
to `dist/`.

| Computer | Command | Makes |
|---|---|---|
| Ubuntu (x64) | `./install.sh` | builds **and installs** the `.deb` (installs the build tools it needs first) |
| Ubuntu (x64) | `./make-deb.sh` | `dist/kural_*_amd64.deb` |
| Mac, Apple Silicon | `./build-mac.sh` | `dist/Kural-*-macos-arm64.zip` and `.dmg` (needs `python3 -m pip install Pillow`) |
| Windows (built on Linux) | `./build-win.sh` | `dist/Kural-*-windows-x64-setup.exe` + portable `.zip` (needs `nsis`, `node`) |

To run the tests (no Claude needed), use `npm test`.

To try a change to the extension without rebuilding, copy `extension/` over the installed copy and run **Developer:
Reload Window**. On Ubuntu the installed copy is `/usr/share/kural/resources/app/extensions/kural/`.

## Releases

Releases are built by GitHub Actions (`.github/workflows/build.yml`):

- **Every push and pull request:** runs the tests and all three builds. The files are under the run's **Artifacts**.
- **A version tag:** does the same, then checks each build:
  - installs the `.deb` on Ubuntu 22.04 **and** 24.04 and starts it,
  - checks the Mac app's signature and starts it,
  - installs the Windows setup silently and starts it.

  Only then does it publish a GitHub Release with all the files.

To make a release:

1. Bump `"version"` in `extension/package.json`.
2. Add a `## What's new in X.Y.Z` block at the top of `RELEASE_NOTES.md`. It becomes the release text.
3. Commit, then tag and push:

```bash
git tag v1.2.0
git push origin main v1.2.0
```

The tag must match the version (`v1.2.0` ↔ `1.2.0`), otherwise the run stops early and says why.

## Project layout

```
extension/            the Kural extension (plain JavaScript, no build step)
  extension.js        wires everything together
  lib/claude.js       runs `claude` headless (sessions, permissions, speed)
  lib/chat.js         chat tabs, history, modes, models, agent teams, questions
  lib/completion.js   Tab completion (Claude), lib/local.js (local model via Ollama)
  lib/tabpanel.js     the Tab panel
  lib/edits.js        Ctrl+K and Apply, lib/review.js (red/green review)
  lib/team-mcp.js     the agents' message board (a tiny MCP server)
  lib/…               attachments, drop area, search, workspace folders, setup changes
  media/              the chat and search panels (HTML/CSS/JS)
  themes/             Kural Dark
vendor/claudemeter/   Claudemeter (MIT), bundled as-is
scripts/              shared rebranding, logo, icons, release notes
installer/            the Windows installer (NSIS)
make-deb.sh           Ubuntu .deb    build-mac.sh  Mac app    build-win.sh  Windows
test/                 npm test
docs/                 screenshots for this README
```

## Troubleshooting

- **View → Output → Kural** shows every request Kural makes, with timings.
- **"Kural: log in" in the status bar:** click it, type `/login` in the Claude Code terminal that opens, then reload
  the window.
- **No Tab suggestions:** click **Tab** in the status bar. The panel shows what's wrong and has a speed check.
- **Mac says the app is damaged:** run the `xattr` command from [Install](#2-download-kural).

## Credits

By **Adithya Chinnakkonda**. Built on [VSCodium](https://github.com/VSCodium/vscodium) (MIT) and includes
[Claudemeter](vendor/claudemeter) (MIT). Kural is an independent project. It is not made or endorsed by Anthropic or
Microsoft. "Claude" is a trademark of Anthropic.

MIT license, see [LICENSE](LICENSE).
