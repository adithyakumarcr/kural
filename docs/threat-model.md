# Kural's threat model

One page: what Kural protects, from whom, how, and what it doesn't protect against.

## What's worth protecting

- **Your code and files**: the project, and everything else on the computer the AI could reach.
- **Your credentials**: logins of Claude Code, Codex and Antigravity, SSH keys, tokens in your shell and files.
- **Linked devices**: a Raspberry Pi or board computer the chat may run commands on.
- **Kural itself**: the app and its updates, which run with your rights (on Ubuntu the update installs as root).

## Who could attack, and what Kural does

| Who | How | What Kural does |
|---|---|---|
| A web page, README, issue or Jira ticket the AI reads | Hidden instructions ("prompt injection") that make the model run or write something | Agent mode asks before every command; writing outside the project, or a file that runs code later (git hooks, tasks, workflows, `package.json`, `.env`, shell profiles), asks too (T3). Dangerous commands ask even in Auto and after "Allow all" (T9). Reading outside the project asks (macOS folders are never looked through). Rules: `extension/lib/chat/permission-policy.js`, tested in `test/permissions.test.js` (T11). |
| Someone who steals the GitHub account or a CI token | Publishes a fake release that the updater installs | The updater installs only files listed in `SHA256SUMS` signed with Kural's release key, which lives only in a GitHub Actions secret (T1). Releases can't be changed after publishing; they carry build provenance (T2). Actions are pinned to commits, CI tokens are read-only by default (T6). |
| A changed VSCodium download | Kural is built on top of it | `codium.lock` holds the SHA-256 of each VSCodium file; the builds stop on a mismatch (T4). A weekly check opens an issue when VSCodium has a newer version with security fixes. |
| A website in your normal browser | Uses Kural's local browser proxy to reach your dev server | The proxy (only a fallback now) opens local pages only, unless you allow remote sites; it refuses requests from other sites and other host names (T5). |
| Another user on the same computer | Plants files in the shared temp folder | Kural's short-lived files are in a folder only you can open (`paths.privateTmp`); the AI can't write to the temp folder without asking (T3). |
| A compromised dependency | Code that runs inside Kural | Kural's extension has no npm dependencies at all. Releases include an SBOM (T8); Dependabot and CodeQL watch the repository (T6). |
| Mistakes in what Kural remembers | Passwords typed in the terminal kept for Tab | Learning is off by default and filters lines that look like secrets (T10). |

Report a vulnerability privately: [SECURITY.md](../SECURITY.md).

## What Kural does NOT protect against

- **An extension you install yourself.** VS Code extensions run with your rights; Kural can't limit them.
- **A request you make yourself.** If you ask the AI to delete a folder, in Auto mode, it will. Auto mode is a choice to
  stop being asked; the danger list is a seat belt, not a sandbox (a script that does the same thing gets through).
- **Google Gemini in Auto mode.** Antigravity can't wait for an answer, so Kural can't stop a dangerous command there.
- **A compromised operating system or account.** Anything that already runs as you can read what Kural reads.
- **The AI companies.** What you send to Claude, Gemini or ChatGPT goes to that company under your account. A model on
  your computer (Ollama) sends nothing.
- **Unsigned apps on macOS and Windows.** Kural isn't code-signed by Apple or Microsoft yet. Verify a download by hand
  (`docs/release-signing.md`) before you allow it.
