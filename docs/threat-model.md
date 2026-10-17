# Kural's threat model

One page: what Kural protects, from whom, how, and what it doesn't protect against.

## What's worth protecting

- **Your code and files**: the project, and everything else on the computer the AI could reach.
- **Your credentials**: logins of Claude Code, Codex and Antigravity, SSH keys, tokens in your shell and files.
- **Linked devices**: a Raspberry Pi or board computer the chat may run commands on.
- **Your accounts on websites**: the logins in Kural's browser (Instagram, mail, a shop), which the AI uses when it works
  in a page there, and what you'd never want posted in your name.
- **Kural itself**: the app and its updates, which run with your rights (on Ubuntu the update installs as root).

## Who could attack, and what Kural does

| Who | How | What Kural does |
|---|---|---|
| A web page, README, issue or Jira ticket the AI reads | Hidden instructions ("prompt injection") that make the model run or write something | Agent mode asks before every command; writing outside the project, or a file that runs code later (git hooks, tasks, workflows, `package.json`, `.env`, shell profiles), asks too (T3). Dangerous commands ask in Agent mode and after "Allow all" (T9); "Allow all" covers one kind of card (commands, web, one connector), never a file outside the project. Ask and Plan refuse changes, also a connector's (a pull request, a Notion page); ChatGPT (Codex) runs them without your connectors, outside Auto without its apps, and never with its own browser and computer use, which can't ask Kural. Auto is unrestricted by choice and the chat lists what it did. Reading outside the project asks (macOS folders are never looked through). Rules: `extension/lib/chat/permission-policy.js`, tested in `test/permissions.test.js` (T11). |
| A page the AI works in, in Kural's browser | Hidden instructions that make the AI post, send, buy or delete something with your login, or carry what it reads elsewhere | The AI never publishes, posts, shares or sends anything, in any mode, also when asked: every click (the element and the buttons around it), Enter key and page question is checked first, in many languages (`extension/lib/browser/guard.js`, `test/browser-guard.test.js`); on Instagram the publish request itself is failed in the network while the AI works in the tab. Agent mode asks once per site in a chat and before Submit, Pay, Delete or Discard; Ask and Plan only read. A file from outside the project asks before it's uploaded (no "Allow all"). There's no tool to run the AI's own JavaScript in a page; Kural's own checks run in a separate world of the page that its scripts can't change. Pages are http/https only. Gemini's own browser (Antigravity's) asks before every action, in Auto too. |
| Someone who steals the GitHub account or a CI token | Publishes a fake release that the updater installs | The updater installs only files listed in `SHA256SUMS` signed with Kural's release key, which lives only in a GitHub Actions secret (T1). Releases can't be changed after publishing; they carry build provenance (T2). Actions are pinned to commits, CI tokens are read-only by default (T6). |
| A changed vendor/runtime download | Kural is built on top of it | `codium.lock` and `vendor/electron-runtime.json` hold independent SHA-256 pins; builds stop on a mismatch. The complete patched Electron distribution replaces the affected runtime while preserving vendor security fuses. Native CI checks the installed runtime version/ABI and startup. A weekly job opens a pull request with the newest VSCodium and Electron patch release, built and tested. |
| Another user on the same computer | Plants files in the shared temp folder | Kural's short-lived files are in a folder only you can open (`paths.privateTmp`); the AI can't write to the temp folder without asking (T3). |
| A compromised dependency | Code that runs inside Kural | Kural's extension has no npm dependencies at all. Releases include an SBOM (T8); Dependabot and CodeQL watch the repository (T6). |
| Mistakes in what Kural remembers | Passwords typed in the terminal kept for Tab | Learning is off by default and filters lines that look like secrets (T10). |

Report a vulnerability privately: [SECURITY.md](../SECURITY.md).

## What Kural does NOT protect against

- **An extension you install yourself.** VS Code extensions run with your rights; Kural can't limit them.
- **A request you make yourself.** If you ask the AI to delete a folder, in Auto mode, it will. Auto mode is a choice to
  stop being asked; the danger list is a seat belt, not a sandbox (a script that does the same thing gets through).
- **Auto mode.** Auto asks about nothing (dangerous commands, files outside the project): it is meant for work you
  watch or can undo. The AI lists what it did at the end of each answer; the list is the AI's own account, not a log.
- **A button that doesn't say what it does.** Kural's browser check reads names: a button with no words, a picture of
  text, a language Kural doesn't list, a cross-site frame, or a site whose "Next" publishes can get past it. Only on
  Instagram is the publish request also stopped in the network (from the community's notes on its API, not watched
  live). And on a site you let the AI use (or in Auto), it reads the pages with your login.
- **A compromised operating system or account.** Anything that already runs as you can read what Kural reads.
- **The AI companies.** What you send to Claude, Gemini or ChatGPT goes to that company under your account. A model on
  your computer (Ollama) sends nothing.
- **Unsigned apps on macOS and Windows.** Kural isn't code-signed by Apple or Microsoft yet. Verify a download by hand
  (`docs/release-signing.md`) before you allow it.
