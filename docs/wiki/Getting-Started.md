# Getting Started

## 1. Install Kural

Download the file for your computer from [Releases](https://github.com/adithyakumarcr/kural/releases). Versions marked
**Pre-release** (like `1.1.0-alpha.3`) are test versions.

| Your computer | File | How |
|---|---|---|
| Mac with Apple Silicon (M1–M5) | `Kural-…-macos-arm64.dmg` | Open it, drag **Kural** into **Applications**. The first time, allow it in Terminal: `xattr -dr com.apple.quarantine /Applications/Kural.app` (Kural isn't signed with a paid Apple ID). |
| Ubuntu 22.04 / 24.04 (x64) | `kural_…_amd64.deb` | `sudo apt install ./kural_*_amd64.deb`, then open **Kural Code Editor**, or type `kural .` in a folder. |
| Windows 10 / 11 (x64) | `Kural-…-windows-x64-setup.exe` | Run it. If Windows says "Windows protected your PC": **More info → Run anyway**. No admin rights needed. |

Building from the source instead: `./install.sh` in the repository (Mac or Ubuntu). `./install.sh --fresh` installs like
a brand-new user (your Kural settings and chats move to a backup folder first).

## 2. Get started: where Kural's AI comes from

The first time Kural opens, the **Get started** page asks you to pick one: Claude, ChatGPT (Codex), Gemini or your own
model. Any one is enough; you can add others later.
Kural checks every step and helps with it. Until one way passes, nothing runs in the background, so there are no errors.

### Claude

1. **Claude Code installed.** **Install for me** runs Anthropic's official installer in a terminal. Installed somewhere
   Kural can't find? **Choose the claude file…** (setting `kural.claudePath`).
2. **Logged in.** **Log in** opens your browser. You need a Claude Pro, Max, Team or Enterprise plan, or an Anthropic
   Console account (the free plan doesn't include Claude Code).
3. **A test.** One tiny request to Claude. If it fails, the page shows the error and what it means.

### Your own model

1. **Ollama.** **Get Ollama** (on Ubuntu it runs the installer; on a Mac or Windows it opens the download page).
2. **A model.** Pick one you have, or download one that fits your computer's memory (the page suggests a few).
3. **A test.** One request to that model, the way Kural will use it.

### ChatGPT (Codex) or Gemini

The same three steps for OpenAI's Codex CLI or Google's Gemini CLI: installed (**Install for me**), logged in (**Log
in** starts the program's own login in a terminal), and a test. See [[ChatGPT and Gemini]].

### Optional

- **Git**: lets Kural see what changed in your project, and write commit messages.
- **A Tab Completion model** (a small code model, about 1 GB): suggestions in a few hundred milliseconds, offline. See
  [[Tab Completion]].

Open the page again any time: Command Palette → **Kural: Get Started**, or the [[Account|Account and Updates]] menu.
If Claude stops working later (Claude Code removed, logged out), Kural notices and opens the page at that step.

## 3. Your first change

Open a project folder (**File → Open Folder…**). In the chat on the right (**Ctrl+L**, **Cmd+L** on a Mac), ask for a
change in plain words: "add a function that returns the items low on stock, with a test". Kural reads your project,
edits the files and shows each change; keep it or undo it. See [[Chat]].
