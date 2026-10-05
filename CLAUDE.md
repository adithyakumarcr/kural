# Kural Code Editor — notes for Claude Code

Kural Code Editor (by Adithya Chinnakkonda; formerly ClaudeX) is VSCodium rebranded, plus a built-in extension (`extension/`) with
an AI assistant. Providers (lib/ai/index.js `PROVIDERS`): **Claude** (the user's own `claude` CLI, headless, with its
login: no API key), **Google Gemini** (Google's Antigravity CLI `agy`, the user's Google account; provider id `agy`),
**Codex** (`codex app-server`, the user's ChatGPT login), and **your own model** (Ollama on the user's computer, run by Kural's own engine: no account, offline).
**Identity:** Kural is its own product, not "Claude". UI text says Kural ("Ask Kural to change something…", "Kural
searches…"); "Claude" appears only where it means Claude (its models in the menu, the Claude way in Get started,
Claude Code itself). The completion feature is called **Tab Completion** (never "Kural Tab").
**Icons:** no emoji anywhere (UI, messages, docs). Webview pages use Codicons (`icon("name")` in the page scripts,
`<i class="codicon codicon-…">`); VS Code UI uses `$(name)`. Every webview CSP needs `font-src ${webview.cspSource}`.
**The feature guide:** `lib/chat/guide.js` tells the chat what Kural can do. When you add, change or remove a feature,
change `guide.js` and `docs/wiki/` in the same pull request.
Read `README.md` for the features. This file is how the code works and how to change it safely.

## The owner
Adithya is learning to code. Keep answers short; explain the *why* first; when fixing a bug say what
was wrong and why; point out mistakes plainly. Small decisions: make them and say so.
At the end of every change, give the steps to build and install: `./install.sh` on his Mac or Ubuntu (builds from
this folder and installs; `./install.sh --ext` when only `extension/` changed; `./install.sh --fresh` to try it as a
new user: Kural's data is moved to `~/kural-backup-<date>` first; `./install.sh --from-scratch-install` for a real first
start: `scripts/from-scratch.sh` deletes Kural's data without backup, logs Claude Code/Codex/Antigravity out, resets
Kural's macOS permissions (`tccutil reset All com.kural`) and its keychain item, and optionally removes those programs;
it asks before the build and deletes only after the build worked; `test/from-scratch.test.js`), or the release download.

## Layout
Feature folders; a new feature gets its own file or folder, wired in `extension.js`.
- `extension/` — plain JavaScript, no build step, no npm dependencies at runtime.
  - `extension.js` wires everything; status bar "Tab Completion" opens `lib/tab/panel.js` (bottom panel: switch,
    slider, engine, the engine's model, last suggestion's time).
  - `lib/ai/` — where answers come from. `index.js`: the `PROVIDERS` table (claude, ollama; each `owns(model)`,
    `ready()`, `agent()`, `ask()`), `makeAgent`, `Session`, `usable`: the chat's model decides for the chat, Ask,
    Ctrl+K/Apply, commit messages and terminal plain words. `claude.js` — `ClaudeProcess` (one `claude -p
    --input-format stream-json` process) and `ClaudeSession` (warm pool for one-shot questions). `claude-checks.js`
    (no vscode) — install/login/test checks, `claudeAuth` (email, org, plan), `claudeLogout`. `claude-setup.js` —
    notices Claude Code setup changes. `engine.js` (`LocalAgent`) + `tools.js` — Kural's own engine for Ollama models
    (no vscode inside; same methods and stream-json events as `ClaudeProcess`). `ollama.js` — Ollama API, search.
    `agy.js`, `codex.js` — Gemini (Antigravity) / Codex agents and helpers; `clis.js` — both described once (install, login, test,
    models, usage page). `usage.js` — the usage hub (no vscode).
  - `lib/chat/` — `index.js` the chat backend (tabs, modes, models, questions, permissions, panes); `prompts.js`
    (modes, `MOODS`, mood prompts); `team.js` (roles, team prompts) + `team-mcp.js` (the agents' board); `guide.js`
    (what Kural can do, appended to every chat's prompt); `archive.js` (History), `attachments.js`, `tickets.js`
    (Jira), `changes.js`. UI: `media/chat.js` + `media/chat.css` (a webview).
  - `lib/tab/` — `completion.js` (editor), `terminal.js` (terminal + plain words), `local.js` (Ollama FIM),
    `activity.js` (what Tab learns), `panel.js`.
  - `lib/edit/` — `inline.js` (Ctrl+K, Apply), `review.js` (red/green), `code-reply.js`, `diff.js`.
  - `lib/getstarted.js` (the Get started page, `media/getstarted.*`), `lib/account.js` (Account status item + menu, usage meter), `lib/usage-panel.js` (AI Usage panel), `lib/paths.js` (what the AI may touch without asking),
    `lib/updates.js` (updates), `lib/search.js` (Ask), `lib/workspace.js` (folders; `workDir()` when none is open),
    `lib/log.js`, `lib/ui.js` (font size).
  - `media/codicons/` — the Codicons icon font (CC BY 4.0) for every Kural page.
- `docs/wiki/` — the GitHub wiki's pages; `scripts/push-wiki.sh` publishes them.
- `scripts/rebrand.py` — turns an unpacked VSCodium into Kural (names, logo, built-in extensions). Shared by:
  `make-deb.sh` (Ubuntu), `build-mac.sh` (Apple Silicon), `build-win.sh` (Windows, runs on Linux).
- `.github/workflows/build.yml` — tests + all three builds; a `v*` tag publishes a Release.

## Things that are easy to break
- **Keychain prompts on the Mac** ("Kural wants to use … Safe Storage"): anything that reads VS Code's secret storage
  triggers them (and again after each update). The built-in GitHub extension did, silently, in any GitHub repo
  (branch protection, avatars, git auth): package.json `configurationDefaults` turns `github.branchProtection`,
  `github.showAvatar`, `github.gitAuthentication` off. Don't use `context.secrets` in Kural. `rebrand.py` renames the
  app (package.json `name` → Kural; it was "VSCodium", whose name Electron gives its keychain item). The main
  trigger, at EVERY start in any folder: VS Code's DefaultAccount service (Copilot's account) asks for GitHub sessions,
  which activates github-authentication, which reads `github.auth` from secret storage. `rebrand.py` points
  product.json `defaultChatAgent.provider.{default,enterprise}.id` at a provider that doesn't exist. Check: start
  with `--log trace`; no `[mainThreadSecretState]` lines in the logs (Linux shows the same calls).
- **Google Gemini = Antigravity** (`lib/ai/agy.js`, id/prefix `agy`; shown as "Google Gemini", short "Gemini"):
  Google's `agy` CLI. Google's Gemini CLI (`gemini --acp`) was a provider until Oct 2026; it was removed because it
  refuses personal Google accounts since 26 Sept 2026 ("no longer supported for Gemini Code Assist for individuals").
  Old chats with `gemini:` models fall back to the default model (`validModel`). No ACP: stream-json like Claude Code (`--input-format/--output-format stream-json
  --disable-slash-commands --print-timeout 12h --add-dir <cwd>`; `--add-dir` is load-bearing). Events: `init`
  (conversation_id), `step_update` (agent_response `text_delta`; tool `tool_info.{name,parameters,output,error}`),
  `result` (ends a turn; `usage` adds up per process). **No approvals possible**: Ask = default, Plan = `--mode plan`,
  Agent = `--mode accept-edits` (commands soft-denied; the answer streams a note listing them), Auto =
  `--dangerously-skip-permissions`. Mode/model are launch flags → a new agy with `--conversation <id>` (map file
  `agy-sessions.json` with the mode its instructions were sent for: an unknown id, or another mode, sends them
  again). A restart sends what's queued; an agy that exits before `init` fails the waiting message (`started`), never
  respawns in a loop. Stop = SIGINT (agy
  exits; next message respawns). Text-only input: pictures are saved to a folder passed with `--add-dir`. Undo: a
  best-effort `onPermission` Edit/Write when a tool step starts (agy doesn't wait). No login command: Get started
  (`loginTerminal`) runs agy's screen in a pseudo-terminal Kural reads (`loginPty`: the `script` program, Mac and Linux;
  a `vscode.Pseudoterminal` shows it and passes your keys on). Kural opens the login address itself (found in the
  screen, also when wrapped, or from agy's own `open`/`xdg-open` call through a PATH shim) and, when the screen waits
  on a line asking for a code (`asksForCode`), asks for the code in an input box and types it (+Enter). Windows: agy in
  a plain terminal. It polls `agyAuth` (`--print /model --output-format json`, no quota) and closes the screen when
  logged in. The real screen's wording is unknown: if the code isn't asked for, widen `asksForCode`. Limits: `--print /usage`. Install: Google's script (`install.js` `script` plan). Test with
  `test/fake-agy.js` (`kural.agyPath`; state in `FAKE_AGY_FILE`/tmp). Never checked against the real agy (blocked here):
  verify event names and tool parameter names with a real account (`KURAL_RAW_LOG=/tmp/raw.jsonl` logs agy's lines).
  Models: `agy models` lists one per thinking level ("gemini-3.8-flash-high" / "Gemini 3.8 Flash (High)");
  `groupModels` makes one entry with `efforts` {low, medium, high…} (a plain one listed too = Medium), `variantFor`
  picks the level from the chat's intensity (nearest; Max = highest) when agy starts; old chats' level ids are split
  into model + intensity in `fix()`.
- **Codex** (`lib/ai/codex.js`; with agy described once in `lib/ai/clis.js`; no vscode inside): like agy, an agent class
  with `LocalAgent`'s methods that turns the program's protocol into Claude Code's stream-json events, so the chat needs
  no special code. Model ids `codex:<id>` / `agy:<id>` (`default` = the program's own).
  Codex: `codex app-server`, one JSON object per line, approval `untrusted` + workspace-write sandbox in Agent/Auto
  (read-only in Plan/Ask), so commands and file changes come to Kural's `onPermission` (files: "Edit"/"Write" first, for
  Undo). Neither Codex nor agy does agent teams or Claude Code's setup (`isClaude()` in the chat). Set up in Get started
  (`rec.codex`/`rec.agy`: bin, models) →
  `brain.setCli()`. **Install** (`lib/ai/install.js`, no vscode): no terminal; Homebrew on a Mac if present, else npm
  (PATH from your shell: a Dock-started app has a short PATH), Node too old/missing → pop-up with nodejs.org; npm
  EACCES → retry with `--prefix ~/.npm-global`. Output pauses ending in a question (`promptIn`: [y/N], (y), "press
  RETURN", "Password:") → a modal pop-up, the answer written to the installer's stdin. **Login** without a terminal for Codex:
  `account/login/start {type:"chatgpt"}` → `authUrl` (Kural opens it) → `account/login/completed`. The install shows live on the page (`this.run`: command, lines, quiet time; Stop; a 3-minute-quiet
  notification), since a silent install looks stuck. `refresh()` numbers each ask and returns after the first check
  that started after it (returning at once while a check ran gave callers the old state). Notifications there are never awaited
  while `installing`/`loggingIn` is set. Terminal ways stay as fallbacks (`installCliTerminal`, `loginCliTerminal`). Tests: `test/fake-codex.js`, `test/fake-agy.js` (state via `FAKE_CODEX_STATE` /
  `FAKE_AGY_STATE` or their files in tmp). In the editor: settings `kural.codexPath` / `kural.agyPath` pointing at
  the fakes. The real programs were only checked logged out (agy not at all): verify streaming, approvals and tool names with real
  accounts when you can.
- **Devices over SSH** (`lib/devices/`): `ssh.js` (no vscode) runs the computer's own `ssh` with **Kural's own key**
  (`<globalStorage>/ssh/id_ed25519`, made by `ssh-keygen`; `-i`, IdentitiesOnly, BatchMode, no password auth). The
  password is used once by `installKey` (adding a device, "Set up again") to append the public key to the device's
  `~/.ssh/authorized_keys`, through `SSH_ASKPASS` (+`SSH_ASKPASS_REQUIRE=force`; the askpass prints `KURAL_SSH_PW`, set
  only in that ssh's env), then it's gone: **nothing in the keychain** (`context.secrets` made the Mac ask for the login
  keychain password, and again after every update: each ad-hoc-signed build is a new app to the keychain). Devices
  saved by an older version (no `auth: "key"`) need "Set up again" once; their old SecretStorage entry is left alone
  (deleting it could itself prompt). `remove` takes the key off (`removeKey`; not if another saved device is the same
  login: one key for all). A lost `.pub` is rebuilt with `ssh-keygen -y`, never a new key.
  `run(dev, null, …)` = the key; a non-null password only in `installKey`. Kural's own known_hosts (accept-new), ControlMaster reuse on Mac/Linux (ControlPath under /tmp: macOS
  allows 104 characters), `reuse:false` for login checks. `run()` answers at once on timeout/abort (with a reused
  connection, "close" waits for the device's command); `runLimited` adds the device's `timeout` in `$SHELL`; `qp()` keeps
  `~/` meaning home; `forgetKey` matches hashed known_hosts lines too (Ubuntu hashes them). `index.js`: devices in globalState `kural.devices.v1`. A chat with `tab.device` gets the `device` MCP server
  (`device-mcp.js`, a relay) whose calls come back to `bridge.js` (a private socket, a token per chat); Kural asks per
  mode (`approveDevice` → permission card "Run this on <name>?"), so the tools are pre-allowed for Claude, Codex gets
  `default_tools_approval_mode="approve"`. "Allow all" on a
  device card sets `tab.allowAllDevice` (that device only), never `tab.allowAll`. Unlinking, Stop, a model/engine switch
  and closing the tab end the token (`endDevice`), which aborts its running commands. The device terminal is
  `isTransient`. Only for Claude and Codex (`deviceOk`): Ollama has no MCP in Kural's engine, and Gemini (agy) can't
  ask before a command. Tests: `test/devices.test.js` with `test/fake-ssh.js` (`KURAL_SSH_BIN`). Real check: a local
  sshd (`apt install openssh-server`, `sshd -p 2222`).
- **Usage meter** (`lib/ai/usage.js` hub, drawn by `lib/account.js`): Claude Code sends `rate_limit_event`
  (`unifiedWindows.five_hour/seven_day.utilization`) after every answer; `ClaudeProcess.onData` and `claudeTest` report
  it. Codex: `account/rateLimits/read` (every 10 min) and `…/updated`. Gemini (agy): `--print /usage` weekly limits, and
  tokens per answer.
  Saved in globalState `kural.usage.v1` so the bar shows the last numbers at startup. In words (`usage.limitName`,
  `until`, `inWords`): the status item of the chat's AI (`brain.engineOf(currentModel())`) reads "Claude 5h 50% · resets
  42m | Weekly 25% · resets 3d 4h", the others short; `chat.onChoice` (model pick, tab switch) redraws it. Clicking it
  opens the **AI Usage** bottom panel (`lib/usage-panel.js`, view `kural.usagePanel`, command `kural.showUsage`).
- **Account** (`lib/account.js`): status item (plan) + QuickPick menu. Who's logged in comes from `claude auth status
  --json` (email, orgName, subscriptionType), never from the Keychain (Claudemeter, removed, read the Keychain: prompts
  after every update, then failures). Log out = `claude auth logout` → `getStarted.loggedOut()` (locks Claude); once a new
  login passes its test, `chat.setupChanged()` (new processes with the new login; not earlier, or a process started
  while logged out would be kept). Switch = log out + `getStarted.signIn()` (login terminal;
  the page polls, runs the test, unlocks). `test/fake-claude.js` does `auth logout` too.
- **No unasked-for macOS permission prompts** (Music, Photos, Documents, Desktop, Downloads… are asked about when any
  process Kural starts opens them; Adithya: asking for what Kural doesn't need makes people distrust it). `lib/paths.js`
  (no vscode): `within` (links followed: `real`), `isProtected` (those folders, other homes, /Volumes), `isHomeOrAbove`,
  `privateTmp` (a 0700 folder per run: attachments, team files, Codex/agy helpers; never fixed names in the shared /tmp).
  The AI reads/changes files without asking only inside `ws.aiRoots()` (project folders, workDir, temp; reading also
  globalStorage, `~/.claude/projects|plans`, /tmp) or what you attached (`tab.granted`); elsewhere `onPermission` shows a
  file card (Allow/Skip, no "allow all"). So Read/Grep/Glob aren't in Claude's `--allowedTools` (Claude Code reads inside
  its folders by itself and asks for the rest); Kural's engine asks the same (`READS`); Ask refuses outside. agy can't
  wait, so its file notices carry `notice: true` (no card). `tools.walk` never enters `isProtected` folders; terminal Tab
  skips `git status` in a repo at home or above; the @ file list excludes them when home is open; chat pictures load
  only from the roots plus copies of attached pictures (changing `webview.options` reloads the page: don't). With no
  folder open, AI work runs in `ws.workDir()`, never `~`; shell lookups and checks run with `cwd: os.tmpdir()`, and the
  `$SHELL -ilc` lookup only when claude isn't found otherwise. `build-mac.sh` keeps Info.plist's usage texts (without
  them macOS kills the app when any extension touches that device).
- **Untrusted folders** (VS Code's Restricted Mode): package.json `untrustedWorkspaces: limited` with
  `restrictedConfigurations` (program paths, Ollama URL, chat mode/model, full setup) and `scope: machine` for the paths;
  `fullSetup()` = the setting AND `vscode.workspace.isTrusted` (a project's .claude/settings.json hooks would run, and
  Kural starts Claude early); trusting the folder → `setupChanged`. Updates install only from this repo's releases
  (`downloadOk`) and, when GitHub gives one, after the asset's SHA-256 (`digest`) matches.
- **Get started gate** (`lib/getstarted.js`): two ways, either is enough (globalState `kural.setup.v2` =
  `{claude, local}`): Claude's test passed (`claudeReady`, and nothing broke since) or a local model's test passed
  (`localModel`). `ready` = either. Claude processes only start when `claudeReady` (`setSetupGate` → `ClaudeProcess.start`
  and `ClaudeSession.startSlot` do nothing: no background errors for people without Claude). Nothing set up: the chat
  shows "Set up Kural first", Ask/Ctrl+K open the page. Only the local way: new/empty chats use the local model
  (`chat.localDefault`), Claude models in the menu say "set up Claude…". Claude steps: installed (`claude --version`), logged in (`claude auth status --json`; old versions take unknown
  commands as a prompt, so only JSON counts → "unknown"), test (`checks.claudeTest`: stream-json, Haiku, like Kural).
  Later starts: a quick check (no request) 2.5 s after start. A session reporting login/missing calls `broke()`, which
  checks for real first (the login regex can match unrelated errors) and only then locks. All checks are async
  (`execFile`): spawnSync froze every extension while the page polled.
  `findClaude()`: setting `kural.claudePath` (Windows: `claude.cmd` → its `claude.exe`), the usual places, PATH, then
  the last answer of your shell (`$SHELL -ilc "command -v claude"`, run in the background by `findClaude.lookInShell()`
  at startup and on Check again; interactive, so nvm in .bashrc/.zshrc counts). findClaude never waits for a shell.
  Test all states without logging out: `test/fake-claude.js` (state in `$FAKE_CLAUDE_STATE` or
  `<tmp>/kural-fake-claude-state`: ok / loggedout / nocredit / old) with `kural.claudePath` pointing at it.
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
  asks it for the final answer (up to `MAX_NUDGES`, since a project has several phases). Agent names come from `FRIENDS`; roles (with their duties) from `ROLES`; prompts from `teamPrompt()`.
  **Roles** (Adithya's design): the lead is the Project Manager; Researcher (Rachel), Architect (Ross), Developer
  (`DEVELOPERS`: Monica, Chandler, Joey; the PM starts 1–3), Tester (Phoebe); any combination. Split the work with
  roles = `projectPrompt()`: requirements (PM asks you) → plan (Researcher/Architect, "PLAN:" to the lead) → your OK
  (AskUserQuestion: Go ahead / Change the plan / Stop) → build + Tester review (max 2 rounds) → report. Without
  developers, the plan is the result. `teamMembers()` gives who can exist; the team file's `started` says who the PM
  actually started (the board waits only for them) and `busy` who's working (an empty wait then doesn't count).
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
- **Jira tickets** (`lib/chat/tickets.js`): no Jira login in Kural. Search = a Haiku `claude` helper with the full setup
  (so the Atlassian connector is there), only Atlassian tools allowed, JSON answer. claude.ai connectors connect in the
  background after Claude starts: `waitForAtlassian()` polls `mcp_status` until it's connected before asking (asking at
  once gave "Atlassian tools not available"). The helper is reused between searches, stopped after 5 idle minutes. `tab.ticket` is saved with the
  chat; `ticketNote()` is added to every message. Atlassian *read* tools (get/search/lookup…) are auto-allowed in the
  chat; writes still ask. Test without Jira: `claude mcp add -s user atlassian -- node test/fake-atlassian-mcp.js`.
- **Chat page streaming** (`media/chat.js`): blocks are wrapped in `.blk[data-b]`; deltas patch one block per frame
  (`schedulePatch`/`patchBlock`), a new block is added with `appendBlock` (no full redraw). Thinking is always ONE line
  ("Thinking… <latest sentence>", then "Thought for N s"; click to open): Claude's summarized thinking arrives in
  paragraph bursts every few seconds, and a box that grew with it and collapsed afterwards made the whole answer jump.
  Mode changes mid-answer: `modeChangedMidAnswer` (Auto resolves waiting permission cards; Plan/Ask apply next message). Scrolling follows only while
  you're at the bottom (`stick`); scrolled up, a "Latest" button appears. Pictures: `fileSrc()` turns a path into the
  webview's address (`S.pics` = `{base, root}` from `filesFor()`; `localResourceRoots` = media, project folders,
  globalStorage, tmp, home; the CSP lets the page load pictures only); web pictures load only on click (a picture URL can carry data away). Don't reuse `S.files`: it's
  the @-mention file list (a clash there hid every picture). Links: `a.link[data-url]` → `openUrl` (http/https only).
- **Panes** (`lib/chat/index.js`): a chat can show in several webviews: the side panel and split panels beside the code
  (`openSplit`, WebviewPanel "kural.chatEditor", restored by a serializer from saved `splitIds`). Each pane has its own
  `activeId`; `this.activeId` is a getter for the pane being handled (`this.pane`) or the one you used last
  (`focusPane`). `post()` goes to every pane (each shows what's about its own tab), except `ONE_PANE` replies
  (full, attached, flash…) to the current pane. A reply sent after an `await` uses `postTo(pane, …)`. Use
  `shown(id)` for "is this tab on screen", never `tab.id === this.activeId`.
- **History** (`lib/chat/archive.js`, no vscode inside): every chat in full, all workspaces, in
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
- **Tab completion engines**: `lib/tab/local.js` (Ollama, raw FIM prompt `<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`
  for qwen2.5-coder base models; `tidyLocal()` trims its output) and Claude (`ClaudeSession`). Engine "auto" uses
  local when Ollama has the model, else Claude; in Auto, `race()` gives local a 350 ms head start, then Claude, first
  real answer wins. Local requests use short context (1500/400 chars) and few tokens: CPU-only machines are slow.
  Claude can't go below ~0.5 s per suggestion (measured). `test/fake-ollama.js` imitates Ollama for testing
  (modes via /tmp/rec/fake-mode: {"delay": ms} or {"empty": true}).
- **Tab completion speed (Claude)**: model time (~0.6 s, Haiku, thinking off) dominates. Don't add work before the
  request. Two warm processes (`pool: 2`), early return on `</insert>`, type-through reuse.
- **Tab in the terminal** (`lib/tab/terminal.js`): a terminal completion provider (proposed API
  `terminalCompletionProvider`, in package.json `enabledApiProposals`; fine for a built-in extension). The terminal
  waits for every provider before showing its list (up to 5 s), so Kural never waits: cache or nothing, then asks the
  model after a pause (Tab speed slider), cancels stale asks, and reopens the list
  (`workbench.action.terminal.triggerSuggest`) when the answer comes. Same engine/model as editor Tab; own Claude
  session ("terminal", `<cmd>…</cmd>`). For `git commit` it adds the staged (else unstaged) diff (the chat's model).
  package.json `configurationDefaults` turns on the terminal's suggest-while-typing (VS Code's default is off).
  **Plain words** ("push this to main"): `plainWords()` (no shell syntax, first word not a path; after a program on PATH
  two `PERSONAL` words, else one `FILLER` word: a wrong guess replaces the user's line, so keep it strict) → the chat's
  model with `INTENT_SYSTEM_PROMPT` (`wordsSession`); `tidyIntent` keeps one line. The suggestion list hides items
  whose label doesn't fuzzy-match the typed text, so `suggestionItem()` gives such items an empty replacement range
  (always shown) and `inputData` = DEL × typed characters + the command (what the terminal gets on Tab; VS Code's own
  items use it, the extension API passes it through with `...item`). `inputData` isn't public API: after a VSCodium
  update, check that "push this to main" + Tab still replaces the words.
- **Tab learns from your work** (`lib/tab/activity.js`, no vscode inside; fed by extension.js and chat.js): per workspace
  (`workspaceState` "kural.activity.v1"): chat asks + changed files (`finishReply`; Undo removes the file; "Build it"
  uses the plan's question), Ctrl+K/Apply you accepted (`review.onDone(meta)`), accepted Tab suggestions (the inline item's
  `command` "kural.tab.accepted"), terminal commands (never ones matching `SECRET`); this session only: recent edits.
  `tabNote()` goes before the editor Tab prompt (Claude only; keep it short, it costs speed); `terminalNote()` into the
  terminal prompt: usual commands, or for a commit the work since the last commit on the changed files, plus
  `git log -8` subjects for style. Always on (no setting); "Kural: Forget What Tab Completion Learned" clears it.
  Live check: `node test/personal.live.js` (same request with and without the note, real Haiku).
- **Ctrl+K / Apply replies** come inside `<code>…</code>` (`lib/edit/code-reply.js`): leading spaces at the very start of a
  reply can get lost, which broke the first line's indentation. Don't go back to bare replies.
- **Local models** (`tab.model` = `"ollama:<name>"`): Kural's own engine (`lib/ai/engine.js`), never Claude Code (that
  needed Claude installed and its env tricks). It calls Ollama's `/api/chat` (streamed; `tools`; `think` for thinking
  models; `options.num_ctx` = setting `kural.localModels.contextLength`), runs the tools in `lib/ai/tools.js` (Read, Write,
  Edit, Glob, Grep, Bash, AskUserQuestion: Claude Code's names and inputs, so the chat shows them and Undo works;
  file paths made absolute before the permission check) and emits Claude Code's stream-json events. Conversations are
  saved in globalStorage `local-chats/<session>.json` (resume). `jsonSchema` (Ask) = one more request with `format`.
  Agent teams and Claude Code connectors/skills: Claude only (`teamSize` is 0 for local; the menu says so). Switching a
  chat between Claude and local starts a new session with `carryOver` (the transcript). `prepareLocal`: Ollama running,
  ≥ `MIN_VERSION` (0.8: streamed tool calls), model downloaded, has "tools". Ctrl+K/Apply/commits with a local model:
  one non-streamed `/api/chat` (`askLocal` in `lib/ai/index.js`). Pictures an Ollama model returns become
  `kural_image` events, saved under globalStorage `images/` and shown in the answer. Tab Completion keeps its own engine (FIM model or Claude Haiku).
  Search reads ollama.com/search?c=tools (no API; `parseSearch` reads list items loosely; cloud-only = no sizes → left
  out), falling back to `SUGGESTED`. Test without Ollama: `node test/fake-ollama-chat.js 11434` (`/api/chat` scripted:
  "read the readme" → Read call; "add a line to notes" → Edit; `format` → JSON; non-streamed → `<code>`/`<cmd>` replies)
  and `node test/engine.test.js`. Offline check: start Kural with `HTTPS_PROXY` pointing nowhere.
- **Themes** (`extension/themes/`, written by `scripts/make-themes.py`: edit there, not the JSON): Kural Dark and Kural
  Light, like VS Code's Dark/Light Modern window with Dark+/Light+ code colors; purple (Adithya: the brand color, but
  not everywhere) only for buttons, active tab/view/panel lines, focus, badges, progress, links, the cursor. The panels
  (chat, Ask, Tab, Usage) set their own accent colors in CSS; a light theme overrides them under `body.vscode-light`.
  Code in chat answers: `highlight()` in `media/chat.js` (any language, `.tk-*` classes in Dark+/Light+ colors).
  `test/theme.test.js` checks both themes' text contrast (4.5:1; icons and line numbers 3:1) and that they set the same keys.
- **Mac helper apps**: Electron finds them by the app's CFBundleName ("Kural" → `Kural Helper (GPU).app` …). `build-mac.sh`
  renames the program, the 4 helpers and `bin/kural` together; a mismatch crashes the app at launch. CI opens the real
  app on all three systems (not just `--version`, which never starts the helpers).
- product.json `checksums` cover VS Code's core JS files (VS Code calls the install "corrupt" if they change).
  The one exception: `rebrand.py` `add_update_menu()` adds Help → Check for Updates to workbench.desktop.main.js
  (extensions can't add to the Help menu) and rewrites that file's checksum (sha256, base64, no "="). It only patches
  if the old checksum matches and the anchor ("Ask @vscode" Help item) is found; otherwise it skips with a
  `::warning::` (shows in the CI summary). Because a menu patch can silently miss, updates are also checked daily and
  reachable from the Chat panel's … menu and the Account menu.
- **Updates** (`lib/updates.js`): `autoCheck()` once a day (globalState `kural.update.lastCheck`, setting
  `kural.updates.autoCheck`), quiet unless there's a newer version (non-modal offer, not awaited: an ignored
  notification must not keep `busy` set, or Check for Updates silently does nothing); newest GitHub release incl. alpha/beta/rc (`compareVersions`), file per platform
  (`assetFor`: .deb / mac .zip / win setup.exe). Ubuntu: `pkexec dpkg -i` (PATH set: dpkg needs /usr/sbin), then restart.
  Mac/Windows: a detached script waits for Kural's main process (`process.ppid`) to quit, swaps the app / runs the setup,
  starts Kural. The script clears `CachedProfilesData/*/extensions.builtin.cache` (else the restarted Kural shows the
  old extension description) and drops ELECTRON_*/VSCODE_* env vars. Tested end to end on Ubuntu only.

## Test
- `npm test` (`test/run.js`: every `test/*.test.js`, so a new test needs no package.json change) — no Claude needed (diff engine, Ctrl+K reply parsing, Jira ticket rules, team board, what Tab learns, Tab panel page script, Get started checks).
- `node test/completion.live.js` — real tab completions (needs `claude` logged in): 11 cases + typing burst.
- `node test/personal.live.js` — Tab and commit messages with vs without what you've been doing (real Haiku).
- In the editor: `./install.sh --ext` (copies `extension/` into the installed app; on a Mac it re-signs and restarts
  Kural; on Ubuntu run "Developer: Reload Window"). View → Output → Kural shows every request with timings.

## Branches (main is protected)
Never commit to `main` directly: GitHub rejects pushes to it (repo rules "Protect main" / "Release tags").
Work on a branch (`git checkout -b fix-something`), push the branch, open a pull request to `main`; Adithya
reviews and merges it. Only he creates `v*` tags, and only on `main` (the workflow checks).

## License and issues
MIT + Commons Clause (`LICENSE`): free to use and change, also at work; nobody may sell Kural or a paid service built
mainly on it. `rebrand.py` copies `LICENSE` into the built-in extension, so every release carries it. Bug reports use
`.github/ISSUE_TEMPLATE/bug_report.yml` (what, how to reproduce, expected, screenshots, version, system: required);
blank issues are off.

## Release
**Version numbers:** don't bump the version (1.1.0-alpha.N) unless Adithya says so. If the current version isn't
tagged yet, new changes go into its "What's new" block; if it's already released, they go under "## Not released yet"
at the top of `RELEASE_NOTES.md` until he picks the next version.
Bump `extension/package.json` version, add a "What's new in X.Y.Z" block to `RELEASE_NOTES.md` (it becomes the release
text, via `scripts/release-notes.sh`), merge it into `main` by pull request, then (Adithya) `git tag vX.Y.Z && git push origin vX.Y.Z` on `main`. The workflow
checks the tag matches the version, builds all three, installs/starts them (Ubuntu 22.04 + 24.04, macOS, Windows),
and only then publishes the Release. A tag with a "-" (v1.2.0-alpha.1) becomes a GitHub Pre-release; the .deb
version uses "~" (1.2.0~alpha.1) so the final 1.2.0 upgrades it. Repo: github.com/adithyakumarcr/kural. README pictures: GIFs in `docs/screenshots/`, recorded on a virtual screen (Xvfb + xdotool, `ffmpeg -f x11grab`),
waits sped up, then `palettegen`/`paletteuse` at ~12 fps; keep each under ~2 MB.
