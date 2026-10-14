# Security review, October 2026

A review of Kural before the 1.1.0 release: 11–13 October 2026 (pull request #61 and the follow-ups), and a release
assessment of 1.1.0-rc.1 on 14 October. This page is the short version; the working notes were in `audit-report/`
until 1.1.0-rc.1 (they are in the git history). The regression tests for these findings are the `test/audit-*.test.js`
files and `test/permissions.test.js`; `npm test` runs them.

## What was looked at

The extension (permissions, webviews, files and folders the AI may touch, Tab Completion's terminal context), each AI's
adapter (Claude Code, Codex, Antigravity, Ollama), agent teams and devices, the updater and the release pipeline, the
build scripts and the bundled runtime (VSCodium, Electron, shell-quote), and the repository itself (history, secrets,
GitHub settings).

## Main findings

| ID | Finding | Status |
|---|---|---|
| SEC-001 | A repository's `CLAUDE.md` or rules could be a link to a private file outside the project | Fixed |
| SEC-002 | Kural's own storage (SSH key, other chats) was readable without asking; web tools were pre-allowed | Fixed |
| SEC-003 | Files that run code later (`.git/config`, `.claude/…`) could be written without asking in Agent mode | Fixed |
| SEC-004 | Terminal Tab ran git in the background, which can run a repository's own hooks | Fixed |
| SEC-005 | A release tag could carry shell text into the update script | Fixed |
| SEC-006 | An old signed download could be offered as a newer version | Fixed |
| SEC-007 | Ask and Plan relied on the AI to change nothing | Fixed (Kural refuses changes itself) |
| SEC-008 | Undo could follow a link and write outside the project | Fixed |
| SEC-009 | The bundled Electron had published security fixes missing | Fixed: Kural replaces VSCodium's Electron with a newer patch release, pinned by SHA-256; a weekly job keeps VSCodium and Electron current |
| SEC-010 | Windows signing secrets could reach pull-request builds | Fixed: bound to tag builds only (no signing certificate is configured yet) |
| SEC-011 | `main` and release tags weren't protected | Fixed: rulesets on `main` (pull request + approval) and on every tag |
| SEC-012 | Gemini (Antigravity) couldn't be stopped before a change | Fixed: Kural's approval gate (an Antigravity hook) asks Kural before each tool call and fails closed. Checked with the real agy 1.3.4 on Ubuntu and macOS (`scripts/verify-agy-gate.sh`), not yet on Windows |
| DEP-001 | The SBOM left out most bundled components | Fixed: every native file of the install is listed |
| DEP-002 | The bundled shell-quote had a published advisory | Fixed: 1.11.0, pinned |

The second pass (AGENT-1–12, APP-1–13, REL-1–7, SUP-1–2, BUG-1–14) fixed, among others: 30 ways around the
dangerous-command check, "Allow all" surviving a mode or model change, settings import taking risky settings, secrets
in settings exports, connector keys on command lines, world-readable chats and crash reports, updater requests without
time or size limits, the Ubuntu update installing a file that could be swapped, and split UTF-8 in program output.

No secrets were found in the repository or its history.

## Release assessment, 14 October 2026

Found in 1.1.0-rc.1 and fixed for 1.1.0-rc.2:

- In Ask and Plan, a connector's tools (creating a pull request, a Notion page, a Jira issue) were asked about instead
  of refused. Now they're refused; a connector's lookups still ask.
- "Allow all" on any card (a web search, say) covered everything that asks afterwards, also writing outside the project
  and files that run code later. Now it covers only the card's kind: commands, web, or one connector.
- ChatGPT (Codex) ran its connectors without asking in Ask and Plan, and its ChatGPT apps, browser and computer use never
  asked Kural. Kural now starts Codex without them where Kural can't ask (Auto keeps everything).
- Terminal Tab turned an AI-written commit message into a double-quoted command line, where `$(…)` would run.
- Smaller items from CodeQL: text from ollama.com decoded twice; chat and card ids made with `Math.random`.
- Files Kural wrote with an older version kept looser permissions; they're made private once per version.
- The old fallback browser (a local proxy that removed pages' security headers) is gone.
- The Mac build no longer installs an old Pillow (published advisories): macOS's own tools make the icon.
- The author's work email was removed from the git history (commit metadata only; no file ever contained it).

## Accepted risks

- **Auto mode is unrestricted** by choice: it asks about nothing, and the AI lists what it did. The dangerous-command
  list is a seat belt, not a sandbox.
- Codex's reads in Plan and Ask rely on Codex's own read-only sandbox (AGENT-5).
- With your full Claude Code setup, Claude Code's own allow rules can skip Kural's card (AGENT-9).
- On Ubuntu, another program running as you could swap the update file in a short window before the password prompt
  (REL-3; the privileged step checks the SHA-256 again).
- Ollama publishes no signature for its Linux installer; Kural takes it only from ollama.com or Ollama's GitHub.
- Kural isn't code-signed by Apple or Microsoft; releases are signed with Kural's own key (`docs/release-signing.md`).

See also: [threat model](threat-model.md), [release signing](release-signing.md), [reporting a problem](../SECURITY.md).
