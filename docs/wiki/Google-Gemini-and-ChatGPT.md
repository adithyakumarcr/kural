# Google Gemini and ChatGPT

Besides Claude, Kural can use **Google Gemini** (with your Google account) and **ChatGPT (Codex)** (with your ChatGPT
plan). Like Claude, Kural runs the official program in the background and uses its login: there's no key to paste
into Kural.

| | Google Gemini | ChatGPT (Codex) |
|---|---|---|
| Program | Google's [Antigravity CLI](https://antigravity.google/docs/cli) (`agy`) | [Codex CLI](https://developers.openai.com/codex/cli) (`codex`) |
| Account | a Google account: free, Google AI Pro or Ultra | ChatGPT Plus, Pro, Business or Enterprise (or an OpenAI API key) |
| Install (Mac, Ubuntu) | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | `brew install codex` or `npm install -g @openai/codex` |
| Install (Windows) | `irm https://antigravity.google/cli/install.ps1 \| iex` | `npm install -g @openai/codex` |

**Why Antigravity, not Gemini CLI?** Google stopped serving personal Google accounts in its older Gemini CLI on
26 Sept 2026 ("This client is no longer supported for Gemini Code Assist for individuals") and moved them to its
Antigravity program, which runs the same Gemini models. Kural uses Antigravity and calls it Google Gemini.

## Set it up

**Get started** → **Google Gemini** or **ChatGPT (Codex)**. Three steps, like Claude:

1. **Installed.** **Install for me** installs it in the background, and the page shows what's happening: the command,
   how long it has been running, its latest output, and a warning if it has printed nothing for a minute (a big
   download can be quiet; **Stop** ends it). If it's quiet for 3 minutes, Kural also asks whether to keep waiting. If
   the installer asks something ("continue? [y/N]"), Kural asks you in a pop-up and passes your answer on.
   - Gemini: Google's own installer (one program, no Node.js needed).
   - Codex: with whatever this computer has, Homebrew on a Mac, otherwise npm. Without Homebrew and Node.js, Kural says
     so and opens Node.js's download page ([nodejs.org](https://nodejs.org): a normal installer); then click **Install
     for me** again. If npm isn't allowed to write to its shared folder, Kural installs into `~/.npm-global` instead.

   Installed somewhere Kural can't find? **Choose the … file** (settings `kural.agyPath`, `kural.codexPath`).
   **Install in a terminal instead** runs the commands above in a terminal.
2. **Logged in.**
   - Gemini: Google's program has no login command; it logs in on its own screen. **Log in** opens that screen in a
     terminal; pick the Google login there and your browser opens. Kural checks every few seconds and closes the
     terminal by itself once you're logged in.
   - Codex: **Log in** opens the login page in your browser. Log in there; the page turns green by itself. **Cancel** in
     the progress message stops waiting.
3. **A test.** One tiny request. When it passes, its models appear in the chat's model menu.

## What works

- The chat in every mode: it reads and edits files, runs commands, and each change can be kept or undone.
  - Codex asks Kural before each command in Agent mode, like Claude.
  - **Gemini can't ask** before it acts (Google's program has no way to). So in **Agent** mode it edits files but runs
    no commands; the answer says which commands it didn't run. In **Auto** it runs commands. **Plan** and **Ask** change
    nothing. A mode change applies from your next message. Undo works for its edits on a best-effort basis.
  - Gemini can't read attached pictures directly: Kural saves them where it can open them and tells it where.
- Ask, Ctrl+K, Apply, commit messages and plain words in the terminal use the chat's model, so these too.
- The usage meter: Gemini shows its weekly limits; Codex its 5-hour and weekly limits, like Claude.
- The Account menu: who's logged in, the usage page, switch account, log out.

## What needs Claude

- [[Multiple Agents]]
- Claude Code's connectors, MCP servers, plugins and skills
- Linking Jira tickets
- [[Devices]] work with Claude and Codex, not with Gemini (it can't ask before running a command there)

Switching a chat between Claude, Gemini, Codex and your own model works: the new model gets the conversation so far.
