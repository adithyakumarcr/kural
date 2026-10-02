# Kural Code Editor — notes for Claude Code

Kural Code Editor (by Adithya Chinnakkonda; formerly ClaudeX) is VSCodium rebranded, plus a built-in extension (`extension/`) that runs the user's own
`claude` CLI headless. No API key: everything goes through Claude Code's login.
Read `README.md` for the features. This file is how the code works and how to change it safely.

## The owner
Adithya is learning to code. Keep answers short; explain the *why* first; when fixing a bug say what
was wrong and why; point out mistakes plainly. Small decisions: make them and say so.
At the end of every change, give the steps to build and install: `./install.sh` on his Mac or Ubuntu (builds from
this folder and installs; `./install.sh --ext` when only `extension/` changed), or the release download.

## Layout
- `extension/` — plain JavaScript, no build step, no npm dependencies at runtime.
  - `extension.js` wires everything; status bar "Tab" opens `lib/tabpanel.js` (bottom panel: switch, slider, model).
  - `lib/claude.js` — `ClaudeProcess` (one `claude -p --input-format stream-json` process) and
    `ClaudeSession` (pool of warm processes for one-shot questions: tab completion, Ctrl+K).
  - `lib/chat.js` — the chat panel backend: tabs, history, modes, moods, models, agent teams, questions,
    permissions, setup reload. `media/chat.js` + `media/chat.css` — the panel UI (a webview).
  - `lib/completion.js` — tab completion; `lib/terminal-tab.js` — Tab in the terminal; `lib/activity.js` — what Tab learns from your work. `lib/team-mcp.js` — the agents' message board (tiny MCP server).
  - `lib/updates.js` (Help → Check for Updates), `lib/attachments.js`, `lib/tickets.js` (+ → Link ticket, Jira via Atlassian connector), `lib/workspace.js` (multi-root),
    `lib/setup.js` (notices Claude Code setup changes), `lib/search.js` (Ask), `lib/ui.js` (font size).
- `scripts/rebrand.py` — turns an unpacked VSCodium into Kural (names, logo, built-in extensions). Shared by:
  `make-deb.sh` (Ubuntu), `build-mac.sh` (Apple Silicon), `build-win.sh` (Windows, runs on Linux).
- `.github/workflows/build.yml` — tests + all three builds; a `v*` tag publishes a Release.

## Things that are easy to break
- **Claude CLI flags** (see `ClaudeProcess.start`): `--safe-mode` skips the user's setup *and* any
  `--mcp-config` we pass; with a team in safe mode we use `--setting-sources "" --disable-slash-commands`
  instead. Full setup (default) = no safe mode, no `--strict-mcp-config`.
- **Control requests** over stdin: `interrupt`, `set_model` (works mid-answer), `mcp_status`, `stop_task` {task_id}
  (stops one background agent; it ends with status "killed"/"stopped").
  Permission requests (`can_use_tool`) are answered by `onPermission`; `AskUserQuestion` is answered by
  returning `updatedInput: { questions, answers }`.
- **Agent teams**: Opus often runs agents in the background. The lead's turn ends ("result") while agents
  work, and Claude starts new lead turns as each reports back. So the answer stays open until every agent
  card is done (`task_started` / `task_notification` events, keyed by `tool_use_id`), and a late lead turn
  reopens the answer. Only Stop ends a team answer early; `warm()` never restarts Claude while an agent works
  (that would kill background agents). If Claude doesn't wake the lead after the last report, `conclude()`
  asks it for the final answer. Agent names come from `FRIENDS`; roles (with their duties) from `ROLES`; prompts from `teamPrompt()`.
  Their board posts (`mcp__team__post`) go into the answer itself as bubbles (not the card), so the discussion is
  where you read; cards hold tools, `task_progress` activity, and the agent's text/thinking.
  **Stuck agents** (an agent waiting on the board for a teammate who already ended): the board has `finish`
  (final position; wakes everyone waiting) and tells a reader to stop after 2 empty waits; Kural writes who has
  ended to `KURAL_TEAM_FILE` (`{round, finished}`, new round per question), so agents that end without `finish`
  count too. Watchdog (`watchAgents`, every 30 s): an agent with no event for `STUCK_MS` (6 min; env
  `KURAL_STUCK_MS` for tests; not while you're being asked something) is stopped with the `stop_task` control
  request; "Finish now" (`finishTeam`) stops all. A result within 4 s of an agent's report holds the answer open
  (Claude wakes the lead once more) instead of closing and reopening it.
  Same-model agents agree too easily: the prompts make each form its own position first, require evidence and
  earned agreement, and hand work between roles for review. Test changes with a real run before shipping.
- **Thinking and agents' text** need `--thinking-display summarized` (hidden flag; otherwise thinking arrives empty)
  and `--forward-subagent-text`. Old Claude Code refuses unknown flags, so `supportedFlags()` probes once
  (`claude -p … < /dev/null`, ~0.5 s, no request) and adds only the known ones. Debug raw output: start Kural with
  `KURAL_RAW_LOG=/tmp/raw.jsonl`.
- **Jira tickets** (`lib/tickets.js`): no Jira login in Kural. Search = a Haiku `claude` helper with the full setup
  (so the Atlassian connector is there), only Atlassian tools allowed, JSON answer. claude.ai connectors connect in the
  background after Claude starts: `waitForAtlassian()` polls `mcp_status` until it's connected before asking (asking at
  once gave "Atlassian tools not available"). The helper is reused between searches, stopped after 5 idle minutes. `tab.ticket` is saved with the
  chat; `ticketNote()` is added to every message. Atlassian *read* tools (get/search/lookup…) are auto-allowed in the
  chat; writes still ask. Test without Jira: `claude mcp add -s user atlassian -- node test/fake-atlassian-mcp.js`.
- **Panes** (`lib/chat.js`): a chat can show in several webviews: the side panel and split panels beside the code
  (`openSplit`, WebviewPanel "kural.chatEditor", restored by a serializer from saved `splitIds`). Each pane has its own
  `activeId`; `this.activeId` is a getter for the pane being handled (`this.pane`) or the one you used last
  (`focusPane`). `post()` goes to every pane (each shows what's about its own tab), except `ONE_PANE` replies
  (full, attached, flash…) to the current pane. A reply sent after an `await` uses `postTo(pane, …)`. Use
  `shown(id)` for "is this tab on screen", never `tab.id === this.activeId`.
- **History** (`lib/archive.js`, no vscode inside): every chat in full, all workspaces, in
  `globalStorage/kural.kural/chats/`: `<id>.json` + `<id>.meta.json` (one file per chat, so several windows can save at
  once; `deleted.json` keeps deleted ids so a window that still has one open can't bring it back; pinned is re-read
  from disk before a save). `save()` archives open tabs (only if changed); workspaceState keeps only this window's open
  tabs (shortened; `load()` takes the full messages from the archive). Old per-workspace `history` moves in on `load()`.
  `tab.workspace` = `{key, name, open}`; a chat from another workspace opens with `visiting` (read only: Claude keeps
  sessions per folder, so `--resume` from here would fail). "Continue here" copies it with a new id/session and
  `carryOver` (the transcript) that `send()` puts before the first message.
- **Webviews can't receive file drops from outside VS Code** (VS Code shields them during a drag). There was a
  separate "Attach files" drop area for that; Adithya found it useless and it was removed (1.1.0-alpha.2). Attach
  with +, paste, or Shift+drag from the editor's own explorer.
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
- **Tab in the terminal** (`lib/terminal-tab.js`): a terminal completion provider (proposed API
  `terminalCompletionProvider`, in package.json `enabledApiProposals`; fine for a built-in extension). The terminal
  waits for every provider before showing its list (up to 5 s), so Kural never waits: cache or nothing, then asks the
  model after a pause (Tab speed slider), cancels stale asks, and reopens the list
  (`workbench.action.terminal.triggerSuggest`) when the answer comes. Same engine/model as editor Tab; own Claude
  session ("terminal", `<cmd>…</cmd>`). For `git commit` it adds the staged (else unstaged) diff. package.json
  `configurationDefaults` turns on the terminal's suggest-while-typing (VS Code's default is off).
- **Tab learns from your work** (`lib/activity.js`, no vscode inside; fed by extension.js and chat.js): per workspace
  (`workspaceState` "kural.activity.v1"): chat asks + changed files (`finishReply`; Undo removes the file; "Build it"
  uses the plan's question), Ctrl+K/Apply you accepted (`review.onDone(meta)`), accepted Tab suggestions (the inline item's
  `command` "kural.tab.accepted"), terminal commands (never ones matching `SECRET`); this session only: recent edits.
  `tabNote()` goes before the editor Tab prompt (Claude only; keep it short, it costs speed); `terminalNote()` into the
  terminal prompt: usual commands, or for a commit the work since the last commit on the changed files, plus
  `git log -8` subjects for style. Setting `kural.tabCompletion.learn`; Forget in the Tab panel / command.
  Live check: `node test/personal.live.js` (same request with and without the note, real Haiku).
- **Ctrl+K / Apply replies** come inside `<code>…</code>` (`lib/code-reply.js`): leading spaces at the very start of a
  reply can get lost, which broke the first line's indentation. Don't go back to bare replies.
- **Mac helper apps**: Electron finds them by the app's CFBundleName ("Kural" → `Kural Helper (GPU).app` …). `build-mac.sh`
  renames the program, the 4 helpers and `bin/kural` together; a mismatch crashes the app at launch. CI opens the real
  app on all three systems (not just `--version`, which never starts the helpers).
- product.json `checksums` cover VS Code's core JS files (VS Code calls the install "corrupt" if they change).
  The one exception: `rebrand.py` `add_update_menu()` adds Help → Check for Updates to workbench.desktop.main.js
  (extensions can't add to the Help menu) and rewrites that file's checksum (sha256, base64, no "="). It only patches
  if the old checksum matches and the anchor ("Ask @vscode" Help item) is found; otherwise it skips with a warning.
- **Updates** (`lib/updates.js`): newest GitHub release incl. alpha/beta/rc (`compareVersions`), file per platform
  (`assetFor`: .deb / mac .zip / win setup.exe). Ubuntu: `pkexec dpkg -i` (PATH set: dpkg needs /usr/sbin), then restart.
  Mac/Windows: a detached script waits for Kural's main process (`process.ppid`) to quit, swaps the app / runs the setup,
  starts Kural. The script clears `CachedProfilesData/*/extensions.builtin.cache` (else the restarted Kural shows the
  old extension description) and drops ELECTRON_*/VSCODE_* env vars. Tested end to end on Ubuntu only.

## Test
- `npm test` — no Claude needed (diff engine, Ctrl+K reply parsing, Jira ticket rules, team board, what Tab learns, Tab panel page script).
- `node test/completion.live.js` — real tab completions (needs `claude` logged in): 11 cases + typing burst.
- `node test/personal.live.js` — Tab and commit messages with vs without what you've been doing (real Haiku).
- In the editor: `./install.sh --ext` (copies `extension/` into the installed app; on a Mac it re-signs and restarts
  Kural; on Ubuntu run "Developer: Reload Window"). View → Output → Kural shows every request with timings.

## Branches (main is protected)
Never commit to `main` directly: GitHub rejects pushes to it (repo rules "Protect main" / "Release tags").
Work on a branch (`git checkout -b fix-something`), push the branch, open a pull request to `main`; Adithya
reviews and merges it. Only he creates `v*` tags, and only on `main` (the workflow checks).

## Release
**Version numbers:** don't bump the version (1.1.0-alpha.N) unless Adithya says so. If the current version isn't
tagged yet, new changes go into its "What's new" block; if it's already released, they go under "## Not released yet"
at the top of `RELEASE_NOTES.md` until he picks the next version.
Bump `extension/package.json` version, add a "What's new in X.Y.Z" block to `RELEASE_NOTES.md` (it becomes the release
text, via `scripts/release-notes.sh`), merge it into `main` by pull request, then (Adithya) `git tag vX.Y.Z && git push origin vX.Y.Z` on `main`. The workflow
checks the tag matches the version, builds all three, installs/starts them (Ubuntu 22.04 + 24.04, macOS, Windows),
and only then publishes the Release. A tag with a "-" (v1.2.0-alpha.1) becomes a GitHub Pre-release; the .deb
version uses "~" (1.2.0~alpha.1) so the final 1.2.0 upgrades it. Repo: github.com/adithyakumarcr/kural. README screenshots: `docs/screenshots/`.
