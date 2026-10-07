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
a brand-new user (your Kural settings and chats move to a backup folder first). `./install.sh --from-scratch-install`
goes further, for testing a first start: Kural's data is deleted (no backup), Claude Code, Codex and Antigravity are
logged out on the computer, the macOS permissions you gave Kural are reset, and, if you say so, those programs are
removed too. It asks before changing anything; Ollama and its models stay.

## 2. Welcome to Kural

Kural opens the editor's **Welcome** page when there are no editors to restore. **Start** has New File, Open File,
Open Folder and Clone Git Repository; **Recent** reopens projects; **Walkthroughs** includes **Get started with Kural**
and guides from your installed extensions.

Open it again with **Kural: Welcome** in the Command Palette or **Help → Welcome**. The checkbox at the bottom controls
whether it appears on startup; an existing startup preference is respected.

In **Get started with Kural**, choose **Set up your AI** to open the setup page. Pick Claude, Google Gemini,
ChatGPT (Codex) or your own model. Any one is enough; you can add others later.
Kural checks every step and helps with it. Until one way passes, nothing runs in the background, so there are no errors.

### Claude

1. **Claude Code installed.** **Install for me** runs Anthropic's official installer in a terminal. Installed somewhere
   Kural can't find? **Choose the claude file…** (setting `kural.claudePath`).
2. **Logged in.** **Log in** opens your browser. You need a Claude Pro, Max, Team or Enterprise plan, or an Anthropic
   Console account (the free plan doesn't include Claude Code).
3. **A test.** One tiny request to Claude. If it fails, the page shows the error and what it means.

### Your own model

1. **Ollama.** **Install Ollama**: Kural downloads Ollama from ollama.com, installs it and starts it (progress in a
   notification; on Ubuntu the system asks for your password). If it fails, the message offers ollama.com instead.
2. **A model.** Pick one you have, or download one that fits your computer's memory (the page suggests a few).
3. **A test.** One request to that model, the way Kural will use it.

### Google Gemini or ChatGPT (Codex)

The same three steps for Google's Antigravity CLI (Gemini) or OpenAI's Codex CLI: installed (**Install for
me** installs in the background and shows what it's doing), logged in (**Log in** opens the login page in your browser),
and a test. See [[Google Gemini and ChatGPT]].

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
