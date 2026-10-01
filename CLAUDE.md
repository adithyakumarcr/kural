# Kural Code Editor — notes for Claude Code

Kural Code Editor (by Adithya Chinnakkonda; formerly ClaudeX) is VSCodium rebranded, plus a built-in extension (`extension/`) that runs the user's own
`claude` CLI headless. No API key: everything goes through Claude Code's login.
Read `README.md` for the features. This file is how the code works and how to change it safely.

## The owner
Adithya is learning to code. Keep answers short; explain the *why* first; when fixing a bug say what
was wrong and why; point out mistakes plainly. Small decisions: make them and say so.
At the end of every change, give the steps to build and install the Ubuntu .deb (`./install.sh`, or the
manual steps in README.md).

## Layout
- `extension/` — plain JavaScript, no build step, no npm dependencies at runtime.
  - `extension.js` wires everything; status bar "Tab" opens `lib/tabpanel.js` (bottom panel: switch, slider, model).
  - `lib/claude.js` — `ClaudeProcess` (one `claude -p --input-format stream-json` process) and
    `ClaudeSession` (pool of warm processes for one-shot questions: tab completion, Ctrl+K).
  - `lib/chat.js` — the chat panel backend: tabs, history, modes, moods, models, agent teams, questions,
    permissions, setup reload. `media/chat.js` + `media/chat.css` — the panel UI (a webview).
  - `lib/completion.js` — tab completion. `lib/team-mcp.js` — the agents' message board (tiny MCP server).
  - `lib/attachments.js`, `lib/drop.js` (the "Attach files" drop area), `lib/workspace.js` (multi-root),
    `lib/setup.js` (notices Claude Code setup changes), `lib/search.js` (Ask & Search), `lib/ui.js` (font size).
- `scripts/rebrand.py` — turns an unpacked VSCodium into Kural (names, logo, built-in extensions). Shared by:
  `make-deb.sh` (Ubuntu), `build-mac.sh` (Apple Silicon), `build-win.sh` (Windows, runs on Linux).
- `.github/workflows/build.yml` — tests + all three builds; a `v*` tag publishes a Release.

## Things that are easy to break
- **Claude CLI flags** (see `ClaudeProcess.start`): `--safe-mode` skips the user's setup *and* any
  `--mcp-config` we pass; with a team in safe mode we use `--setting-sources "" --disable-slash-commands`
  instead. Full setup (default) = no safe mode, no `--strict-mcp-config`.
- **Control requests** over stdin: `interrupt`, `set_model` (works mid-answer), `mcp_status`.
  Permission requests (`can_use_tool`) are answered by `onPermission`; `AskUserQuestion` is answered by
  returning `updatedInput: { questions, answers }`.
- **Agent teams**: Opus often runs agents in the background. The lead's turn ends ("result") while agents
  work, and Claude starts new lead turns as each reports back. So the answer stays open until every agent
  card is done (`task_started` / `task_notification` events, keyed by `tool_use_id`), and a late lead turn
  reopens the answer. Only Stop ends a team answer early; `warm()` never restarts Claude while an agent works
  (that would kill background agents). If Claude doesn't wake the lead after the last report, `conclude()`
  asks it for the final answer. Agent names come from `FRIENDS`; roles (with their duties) from `ROLES`; prompts from `teamPrompt()`.
  Same-model agents agree too easily: the prompts make each form its own position first, require evidence and
  earned agreement, and hand work between roles for review. Test changes with a real run before shipping.
- **Webviews can't receive file drops from outside VS Code** (VS Code shields them during a drag). That's
  why `lib/drop.js` exists. Drags from the editor's own explorer reach the chat only with Shift.
- **Keyboard shortcuts in the chat**: VS Code's `focusedView` isn't set for webviews, so the page reports
  focus itself (`kural.chatFocused` context key).
- **Tab completion engines**: `lib/local.js` (Ollama, raw FIM prompt `<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`
  for qwen2.5-coder base models; `tidyLocal()` trims its output) and Claude (`ClaudeSession`). Engine "auto" uses
  local when Ollama has the model, else Claude; in Auto, `race()` gives local a 350 ms head start, then Claude, first
  real answer wins. Local requests use short context (1500/400 chars) and few tokens: CPU-only machines are slow.
  Claude can't go below ~0.5 s per suggestion (measured). `test/fake-ollama.js` imitates Ollama for testing
  (modes via /tmp/rec/fake-mode: {"delay": ms} or {"empty": true}).
- **Tab completion speed (Claude)**: model time (~0.6 s, Haiku, thinking off) dominates. Don't add work before the
  request. Two warm processes (`pool: 2`), early return on `</insert>`, type-through reuse.
- **Ctrl+K / Apply replies** come inside `<code>…</code>` (`lib/code-reply.js`): leading spaces at the very start of a
  reply can get lost, which broke the first line's indentation. Don't go back to bare replies.
- product.json `checksums` cover VS Code's core JS files: never edit those; media files are fine.

## Test
- `npm test` — no Claude needed (diff engine, Ctrl+K reply parsing, team board, Tab panel page script).
- `node test/completion.live.js` — real tab completions (needs `claude` logged in): 11 cases + typing burst.
- In the editor: copy `extension/` over `/usr/share/kural/resources/app/extensions/kural/` and run
  "Developer: Reload Window". View → Output → Kural shows every request with timings.

## Release
Bump `extension/package.json` version, add a "What's new in X.Y.Z" block to `RELEASE_NOTES.md` (it becomes the release
text, via `scripts/release-notes.sh`), commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`. The workflow
checks the tag matches the version, builds all three, installs/starts them (Ubuntu 22.04 + 24.04, macOS, Windows),
and only then publishes the Release. Repo: github.com/adithyakumarcr/kural. README screenshots: `docs/screenshots/`.
