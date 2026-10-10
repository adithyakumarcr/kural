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
  - `lib/getstarted.js` (the Get started page, `media/getstarted.*`), `lib/account.js` (Account status item, usage meter,
    log in/out), `lib/settings-page.js` (Kural Settings tab, `media/settings.*`), `lib/usage-panel.js` (AI Usage panel), `lib/paths.js` (what the AI may touch without asking),
    `lib/updates.js` (updates), `lib/search/` (Search & Ask side bar), `lib/workspace.js` (folders; `workDir()` when none is open),
    `lib/crash/` (crash reports), `lib/settings-io.js` (export/import), `lib/scm/commit.js` (Source Control commit message),
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
  (`loginTerminal`) runs agy's screen in a normal terminal (`shellPath` = agy, env from `loginSession`) and reads it
  with the proposed `onDidWriteTerminalData` (package.json `enabledApiProposals` "terminalDataWriteEvent"). Not the
  `script` program: the Mac's `script` quits at once when not started from a terminal (the screen lived < 1 s). Kural
  opens the login address itself (found in the screen, also when wrapped, or from agy's own `open`/`xdg-open` call
  through a PATH shim) and, when the screen waits on a line asking for a code (`asksForCode`), asks for the code in an
  input box and types it (`sendText(code + "\r")`). While you log in it waits on `hasSavedLogin()` (keychain item /
  token file, asks nothing, starts no agy), then confirms with `agyAuth` (`--print /model --output-format json`) and
  closes the screen; a screen that closes by itself within a minute is reported with its last line. The real screen's wording is unknown: if the code isn't asked for, widen `asksForCode`. Its login lives in
  the OS keyring (Mac keychain item service "gemini" / account "antigravity", made with `/usr/bin/security`; Linux
  Secret Service; Windows "gemini:antigravity"), or `~/.gemini/antigravity-cli/antigravity-oauth-token` without one, and
  survives uninstalling agy: a new agy signs in by itself. So `agyLogout` (and `scripts/from-scratch.sh`) run
  `/logout` and then delete that item and file (`forgetLogin`); never re-check with `/model` right after (logged out,
  agy may open the browser). Limits: `--print /usage`. Install: Google's script (`install.js` `script` plan). Test with
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
- **Model Router** (`lib/router/`: `policy.js` decides, no vscode; `words.js` Kural's word classifier ("Native": a
  linear model on words/word pairs, weights in `words-model.json`, made by `node scripts/train-router.js` from
  `examples.json`, 270 labelled requests; `test/router-words.test.js` fails when the weights are stale); `client.js` helper
  models through Ollama (`HELPERS`: minilm, granite, qwen3; centroids of the examples, computed once by `prepare()` and
  saved under globalStorage `router/`, so routing is one embedding: 8-49 ms); `index.js` ModelRouter; `learn.js`
  RouterMemory; `panel.js`). Auto picks only from the AIs with accounts (Claude, Gemini, Codex): `eligible` drops local
  and Tab-only models; there is no per-model allow-list (Adithya: Auto uses every model of your AIs). The panel has
  nothing to choose but the helper (Adithya, 7 Oct 2026): no profile (the chat's model menu is the only place,
  `setRouterProfile`; `kural.modelRouter.profile` is just a new chat's first default and Tab's Auto engine), no model
  chips, "Picks from" or "Last choice" rows, and an info button explaining the helpers (`ABOUT`; numbers
  from the `HELPERS` notes, so they stay in step). The helper is a slider Faster → Quality (Adithya, 7 Oct: simpler than
  four names): its steps are `ABOUT`'s order (`STEPS`), `input` only names the step, `change` (or a dot) sets it. Profiles **cost /
  balance / intelligence** (old ids speed / balanced / quality map via `ALIASES`; keep accepting them). `select()`:
  `needTier(profile, task)` (complex = 3 in every profile; Intelligence simple = 2, standard = 3; Cost standard = 1 for
  search/explain, 2 for edit/review) → the lightest model with that tier (`traits`: tier from name + the program's
  description, "legacy/older" lose ties) → limit pressure (`limitUsed` from `usage.current(provider)`, `router.usageOf`;
  ≥98 % skipped unless it's the only one) + stay bonuses growing with `historyChars` (never against the needed tier or a
  lighter model that's enough) + `learned` lean. Returns `effort` too (chat sets `tab.effort` unless you picked one:
  `effortPinned`). `classify(prompt, context, helper)`: words' probabilities, blended 50/50 with the helper's
  (`HELPER_WEIGHT`, `TEMPERATURE` 0.01: chosen by `test/router-eval-blend.js`), then attached context bumps (files, sizes by
  stat only, error output, browser elements). Measured (10-fold CV, M5): Native 74 %, MiniLM 82 %, Granite 87 %, Qwen3 90 %
  of sizes; old keyword rules 53 %; generative routers (qwen3 4b/1.7b) 351/241 ms = over the 200 ms budget
  (docs/wiki/Model-Router.md, docs/benchmarks/). In the chat, a provider switch whose handoff would lose detail re-routes
  within the current AI (`provider: here`), unless that AI is near its limit. **Limits** (Adithya: Claude near its limit →
  ChatGPT first, no context loss): `policy.js` `nearLimit` (from 80 % of a Session or Weekly limit, rising to 98 %;
  beats any stay bonus) and `LEAVING_TO` (Codex/Claude before Gemini); `usage.js` `blockedUntil`/`markLimited`: an AI
  that refused a request counts as full until its reset (`limitUsed` = 100), a later good answer clears it. An answer
  that hit a limit in Auto → `retryElsewhere` (after `finishReply`): the same request on another AI with the handoff and
  what the stopped answer did; never to an AI at ≥98 %. **Handoff** (`journal.handoff(messages, budget)`): built when
  sent (`carryText`; `handoffBudget` = setting `kural.modelRouter.handoffChars`, or a local model's contextLength × 1.6),
  with a plan excerpt and the latest to-do; too big → compacted in levels 0–4 by fixed rules (newest turns whole while
  they fit; then earlier requests as a list), never a model summary. `handoffRecord` also saves the complete visible
  history via `handoff-store.js` to a per-chat directory under `<globalStorage>/handoffs/`, mode 0600, replaced atomically
  on the next handoff and removed when the chat is deleted. The prompt gives the path so omitted constraints, decisions
  and tool results remain recoverable. Long strings use `kural_text_chunks` (join without separators) to keep each line
  readable by tools; archive failure stops the handoff. The exact file is readable without another permission card;
  its directory is available to the provider from launch. Questions answered and attachments in steer blocks travel too.
  The same handoff for a model switch by hand. Account changes: `account.js` runs the internal command
  `kural.chat.accountChanged` (log out, or another email) → `tab.freshSession` for Codex/Gemini chats (Claude chats
  `--resume` with the new login); a conversation that can't be reopened is handed over, not started empty.
  `test/handoff-fakes.test.js`: all 12 directions between the four AIs with the real adapters and their fakes
  (`test/fake-claude-chat.js`), the account switch and compaction. Learning: `routerFeedback` in the
  chat: next message = good, `setModel` right after = better, every change undone = bad (replaces good); workspaceState
  `kural.router.memory.v1`, command `kural.router.forget`. Tests: `test/router.test.js`, `test/router-chat.test.js`,
  `test/router-words.test.js`; live: `node test/router-eval.js`, `node test/router-latency.js`.
- **Usage meter** (`lib/ai/usage.js` hub, drawn by `lib/account.js`): Claude Code sends `rate_limit_event`
  (`unifiedWindows.five_hour/seven_day.utilization`) after every answer; `ClaudeProcess.onData` and `claudeTest` report
  it. Codex: `account/rateLimits/read` (every 10 min) and `…/updated`. Gemini (agy): `--print /usage` weekly limits, and
  tokens per answer.
  Saved in globalState `kural.usage.v1` so the bar shows the last numbers at startup. In words (`usage.limitName`,
  `until`, `inWords`): the 5-hour window is called **Session** everywhere (Adithya), then "Weekly", "Weekly (Opus)",
  "Weekly (Gemini)"; numbers saved as "5-hour" by older versions still read as the Session. The status bar shows only the
  Session limit (Adithya: weekly only on hover): the chat's AI (`brain.engineOf(currentModel())`) "Claude Session 50% ·
  resets 42m", the others short ("Codex 12%"); weekly limits stay on hover even near their limit. Gemini (weekly only)
  shows its name. Warning colors still consider every window, including Weekly. The hover has every AI's
  Session and Weekly in full. `chat.onChoice` (model pick, tab switch) redraws it. Clicking it
  opens the **AI Usage** bottom panel (`lib/usage-panel.js`, view `kural.usagePanel`, command `kural.showUsage`).
- **Account** (`lib/account.js`): status item (plan); clicking it (command `kural.account`) opens **Kural Settings**
  (`lib/settings-page.js`, a WebviewPanel "kural.settings": a card per AI with who/plan/limits/buttons, then version,
  updates and links). It replaced a QuickPick menu Adithya found too cluttered. `account.onChange` redraws the page. Who's logged in comes from `claude auth status
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
  asks it for the final answer (up to `MAX_NUDGES`, since a project has several phases). Claude Code reports a long
  Bash command as a background task too (`task_started`/`task_notification` with the Bash call's id): only a
  notification whose owner is an agent card sets `lastNotifyAt`, or every long command got the "All the agents you
  started have reported back…" nudge (test/queue.test.js). Agent names come from `FRIENDS`; roles (with their duties) from `ROLES`; prompts from `teamPrompt()`.
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
  (`claude -p … < /dev/null`, ~0.5 s, no request) and adds only the known ones. The answer is saved in
  `<globalStorage>/claude-flags.json`, keyed by the binary's real path, size and date, and `prefetchFlags` asks in the
  background at startup: the blocking `spawnSync` probe (only a fallback now) froze every extension for 0.3–8 s at a
  window's first chat answer. Debug raw output: start Kural with
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
- **Panes** (`lib/chat/index.js`): a chat can show in several webviews: the side panel and chat editors beside the code.
  Dragging a chat tab into the editor area makes one (`lib/chat/tab-editor.js`): the page's tab sets `ResourceURLs`
  = `kural-chat:/<id>.kuralchat` (what VS Code's editor drop target opens), which opens in the custom editor
  "kural.chatTab" (`adoptDragged`: the side panel moves on to another chat), so VS Code does the split zones, moving and
  restoring after a restart. Such a pane is `single`: its page hides its tab bar (`tabs` message `single`), `post("tabs")`
  gives it only its own tab and leaves that tab out of the other panes' lists, `activate()` of it from elsewhere reveals
  its editor, `cycle()`/new tab skip it, closing the chat disposes the editor (Adithya: the split showed "New chat" twice
  and his other chats). No FileSystemProvider for that scheme on purpose: with one, VS Code shows a breadcrumb bar
  with the made-up file name. A drop on top of a webview (another chat, Get started) lands in that webview instead: drop
  on an editor's tab bar or a text editor. Checked in the app with DOM drag events (CDP can't start a native drag in a
  background window). Older split panels (WebviewPanel "kural.chatEditor") still come back through their serializer
  (`restoreSplit`, `splitIds`). Each pane has its own
  `activeId`; `this.activeId` is a getter for the pane being handled (`this.pane`) or the one you used last
  (`focusPane`). `post()` goes to every pane (each shows what's about its own tab), except `ONE_PANE` replies
  (full, attached, flash…) to the current pane. A reply sent after an `await` uses `postTo(pane, …)`. Use
  `shown(id)` for "is this tab on screen", never `tab.id === this.activeId`.
- **Links and pictures in answers** (`media/chat.js` `fileLink`, `openPath`/`openImage` in the chat): a markdown link
  that isn't http(s) is a file (`#L12`, `#L12-L20`, `:12` = the line); a folder → Explorer, pictures/binaries →
  `vscode.open`, missing → a message. `ws.find` (lib/workspace.js) turns what the AI wrote into the file: as written,
  else any project file whose path ends with it (`findFiles("**/<path>")`, not node_modules/.git; dist/build last), so
  "devices.test.js" opens test/devices.test.js; several → a QuickPick. A leading "/" not on this computer = the
  project's (test/links-fastest.test.js). Pictures (`img.md-img[data-path|data-url]`, attachments, tool/generated ones) open
  full size in a tab: local → VS Code's image viewer, web → a tiny WebviewPanel. web links → Kural's browser tab.
- **Browser / Design Mode** (`lib/browser/index.js`): it's VS Code's own Integrated Browser (a real WebContentsView tab:
  any site, the element picker, screenshots, console logs). Kural's pieces: `kural.browser.open` (any web link in the chat,
  "Kural: Open Browser" → `workbench.action.browser.open {url, openToSide}`; bare names → `Browser.url`: localhost/IP =
  http, else https), `kural.browser.pick` (+ → Pick from a browser: asks the address if no browser tab is open, then
  `workbench.action.browser.addElementToChat`), and `kural.browser.attach(items)` (called by the patch below) →
  `chat.addBrowserItems`: an element/console-log item = a pill `kind: "element"` (`element.note` = VS Code's own
  description: HTML path, outer HTML, size, computed CSS; `comment` = the text typed in "Comment on Elements", inserted as
  the start of the message; `elementNote()` adds "find the code that makes this element before changing anything"), a
  picture = a chat attachment (`attachments.addData`). **rebrand.py `route_browser_to_kural`** (three anchors found by shape
  with this build's short names; any miss → a `::warning::` and the browser stays plain): (1) the browser editor's
  `_revealChatWidgetForAttachment` returns a stand-in whose `attachmentModel.addContext(...)` runs `kural.browser.attach`
  with plain data (pictures base64; the instantiation service is kept as `this.__kural`, the command service name read
  from the file); (2) the picked-element object gets `comment`; (3) inside the browser's code, VS Code's `chatIsEnabled`
  gate (`G.enabled`, off because Kural sets `chat.disableAIFeatures`) is replaced by `<expr>.true()`, or the "Add to Chat"
  buttons never show. The actions are NOT in the Command Palette (they're menu actions), only in the browser bar's
  split button. `workbench.browser.openLocalhostLinks` is on by default (package.json). Tests: `test/rebrand-browser.test.js`
  (the patch on a real workbench file: valid JS, idempotent, the stand-in's payload). Checked live: bar button there and
  toggles, a pick's data → pill + comment + picture → Claude found and edited the right CSS → reload showed it; chat links
  open Google inside Kural. NOT checked: a real mouse click on the page's element (CDP synthetic clicks don't reach the
  Overlay inspector). The older proxy browser (`proxy.js`, `media/browser.*`, `media/browser-picker.js`, test
  `browser-proxy.test.js`) only runs as a fallback when `workbench.action.browser.open` doesn't exist.
- **Account names** (`lib/ai/names.js`, no vscode): the status item shows the name on the chat's AI's account, from the
  programs' own plain files only when their email is the account's: `~/.claude.json` oauthAccount.displayName (Claude
  Code's `auth status` has no name), `~/.gemini/oauth_creds.json`'s id_token `name` (Antigravity's own login is in the
  keychain: never read), `~/.codex/auth.json`'s id_token. `chat.onChoice` redraws it. Test: `test/names.test.js`.
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
- **Version label** (`lib/version.js`): `install.sh` `stamp_build` writes `extension/build.json` (gitignored: branch,
  commit, "with changes") unless HEAD is exactly the tag `v<version>`; with it, the chat and Kural Settings show
  "Unreleased version · main (abc1234)" instead of `v<version>`. Release builds (CI) never have the file. The update check
  still compares the package version.
- **Tab completion engines**: `lib/tab/local.js` (Ollama, raw FIM prompt `<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`
  for qwen2.5-coder base models; `tidyLocal()` trims its output) and Claude (`ClaudeSession`). Engine "auto" uses
  local when Ollama has the model, else Claude; in Auto, `race()` gives local a 350 ms head start, then Claude, first
  real answer wins. **While Ollama is busy** (`LocalEngine.busy()`: a chat in this window answers with a local model,
  `local.chatBusy` set in extension.js, or answers take over 3× this computer's usual and over 0.8 s), Claude helps
  even with engine "Local model": local gets a 200 ms head start, each engine has its own cancel switch and the slower
  request is stopped (measured: local Tab took 2–6.4 s during a local chat, Ollama runs both models on one GPU; with a
  Claude chat Tab was fine). Without Claude, Tab waits longer between keys then; terminal Tab the same
  (`test/tab-busy.test.js`). Ollama keeps Tab's model 30 minutes after the last suggestion (was 2 h: 1.1 GB).
  The local engine counts only once chosen (`local.allowed`: globalState `kural.tabLocal.v1`, set by the
  panel's Set up/Download, or Get started's own model): a model left over in Ollama isn't "ready". Local requests use short context (1500/400 chars) and few tokens: CPU-only machines are slow.
  Claude can't go below ~0.5 s per suggestion (measured). `test/fake-ollama.js` imitates Ollama for testing
  (modes via /tmp/rec/fake-mode: {"delay": ms} or {"empty": true}).
  **Installing Ollama** (`lib/ai/ollama-install.js`, no vscode; one shared job in `lib/tab/local.js`): the Tab panel's
  Set up (`local.setup()`: choose → install/start Ollama → pull the model, "Step 1 of 2"), Get started and the chat
  (`installOllama()`, a notification). Mac: `Ollama-darwin.zip` → `/Applications/Ollama.app` (else ~/Applications),
  `unzip` lines counted for the install %, `open -a … --args hidden`. Windows: `OllamaSetup.exe /VERYSILENT` (no %).
  Linux: ollama.com/install.sh via `pkexec`, its curl % and `>>>` steps read by `readLinux`. Fails → a message offering
  ollama.com / the terminal installer. Test: `test/ollama-install.test.js` (a stand-in ollama.com). Not yet tried with the real download on any system.
- **Tab completion speed (Claude)**: model time (~0.6 s, Haiku, thinking off) dominates. Don't add work before the
  request. Two warm processes (`pool: 2`), early return on `</insert>`, type-through reuse. They start only when Tab
  needs Claude (`warmTab()`: engine Claude, or no local model ready) and stop after 15 idle minutes.
- **Memory** (`scripts/bench-memory.js`, read-only: a running Kural's processes by part, each `claude` named by its job,
  Ollama's loaded models; results and the long-term plan in `docs/benchmarks/memory-2026-10-08.md`): every
  `ClaudeSession` pool stops after idle minutes (`idleStopMs`; Tab 15, terminal/Ctrl+K/Ask 10, commit/Source
  Control/plain words 5; tests: `KURAL_IDLE_MS`) and the next question starts it (~0.8 s instead of 0.6 s once); Ask's
  Claude starts on the Ask tab, not for text search; terminal Tab keeps one process; `~/.claude.json` is parsed again
  only when it changed; Ollama's status is polled only while the window is in front. Idle chats: see "Idle chats free
  their program". Measured 8 Oct 2026: Adithya's Kural 2.6 GB (326 MB idle helpers); test copy idle 1,268 → 1,078 MB.
- **Rename offer** (`lib/tab/rename.js`, no vscode; setting `kural.tabCompletion.renameAcrossFiles`): follows one word
  per document; after you change a name and move on, Kural searches the project for the old one (ripgrep, whole word,
  case-sensitive; not node_modules/dist/build, minified/lock files or prose files) and offers Review (Search & Ask filled
  in) / Change all (one undoable WorkspaceEdit) / Not now. Not for names being typed, keywords, one-letter names, undo,
  or edits that aren't yours; a Tab acceptance (it replaces the rest of the line) is narrowed to what really changed.
  Tests: `test/rename.test.js`, `test/rename-offer.test.js` (real ripgrep).
- **Status bar icons**: Tab Completion = the sparkle (crossed out when off), Model Router = its icon; error, log in and
  finish setup keep their words. The crossed sparkle is in `media/codicons/kural-icons.ttf` (package.json `icons`), made
  by `scripts/make-status-icons.js` from Codicons' sparkle: edit the script, not the font (`test/status-icons.test.js`
  fails when they differ).
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
  update, check that "push this to main" + Tab still replaces the words. VS Code asks a provider only at its trigger
  characters, so letters/digits/`.` are triggers too (a sentence ending in a word, "delete the file install.sh", was
  never asked about whole); mid-word only plain words go to the model (and after 450 ms). The plain-words item has
  VS Code's internal kind 101 "InlineSuggestionAlwaysOnTop" (not in the public enum) so it's first and Tab takes it;
  a pause timer + `triggerSuggest` was tried and dropped (it showed "No suggestions." on every pause). `ACTIONS`: a
  leading verb that isn't a program ("delete install.sh") counts; apostrophes inside words are English, not quotes.
  Checked live in the app (`rm install.sh` first, Tab replaces the line).
- **Tab learns from your work** (`lib/tab/activity.js`, no vscode inside; fed by extension.js and chat.js): per workspace
  (`workspaceState` "kural.activity.v1"): chat asks + changed files (`finishReply`; Undo removes the file; "Build it"
  uses the plan's question), Ctrl+K/Apply you accepted (`review.onDone(meta)`), accepted Tab suggestions (the inline item's
  `command` "kural.tab.accepted"), terminal commands (never ones matching `SECRET`); this session only: recent edits.
  `tabNote()` goes before the editor Tab prompt (Claude only; keep it short, it costs speed); `terminalNote()` into the
  terminal prompt: usual commands, or for a commit the work since the last commit on the changed files, plus
  `git log -8` subjects for style. Off unless `kural.tabCompletion.learnFromActivity` is on (typed lines can hold secrets `SECRET` misses; older data:
  a one-time Delete/Keep offer); "Kural: Forget What Tab Completion Learned" clears it.
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
- **VS Code's Search and Output views are hidden** (`rebrand.py` `hide_builtin_views`): each view descriptor in
  workbench.desktop.main.js gets VS Code's own never-true `when` (`<ContextKeyExpr>.regex("neverMatch",/doesNotMatch/)`,
  found next to the Search view; marked `/*kural-hidden*/`), and their containers are `hideIfEmpty`, so the activity bar
  icon and the panel tab go away. Same fingerprint rule as the Help menu patch (`patch_workbench`); a VSCodium whose code
  doesn't match keeps both views with a `::warning::`. Checked by launching the patched app (both gone, "Search & Ask"
  there). Edit → Find in Files still runs VS Code's command (it opens nothing now): Kural binds Ctrl/Cmd+Shift+F/H itself.
- **Run and Debug, Debug Console, Ports hidden** (`rebrand.py` `hide_debug_views`, Adithya): the views registry's
  `addViews` is patched so every view in those three containers gets `and config.kural.showDebugViews` (debug ones also
  show `inDebugMode`, so F5 still shows them); Run and Debug gets `hideIfEmpty`. The setting brings them back at once.
  Test: `test/rebrand-debug-views.test.js`; checked in a patched test copy.
- **System notifications from the workbench** (`rebrand.py` `add_os_toast`): `_kural.osToast` {title, body, id, actions,
  silent, timeout, attention} → {clicked, actionIndex, supported} and `_kural.osToastClear` {id}, inserted before the
  file's final `export{… as main}`; the command registry and `hostService` are found by shape, with its own
  cancellation token. VS Code's `showToast` is an Electron Notification from the main process, so it shows as Kural.
  A click brings the window to the front. Test: `test/rebrand-toast.test.js` (also on the real workbench file).
- **Search & Ask** (`lib/search/`: `index.js` the view and Ask (always `brain.fastestModel()`: Haiku, or the lightest
  Codex/Gemini model by router `traits`, the chat's AI first; a local model only with no cloud AI; Adithya: Ask should
  be fast; no Auto routing there), `find.js` text search in the editor, `text.js` no
  vscode: ripgrep args/parsing, include/exclude globs as VS Code reads them, in-memory search; `media/search-replace.js`
  the regex and replace rules, loaded by both the extension and the page so the results' preview equals what Replace
  does). ripgrep is VS Code's own (`rgPath`: `node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/<os>-<arch>`),
  with VS Code's flags (`--hidden --follow --crlf --engine auto`, `--no-ignore-global/-parent` per the search settings,
  `files.exclude`+`search.exclude` as `-g !…`); one ripgrep per workspace folder (settings can differ). Files open with
  unsaved changes are searched in memory instead, and results follow edits (`later`/`again`) and disk changes. ripgrep
  gives byte offsets: `fromRg` turns them into UTF-16 columns (VS Code positions). Replace = one WorkspaceEdit, each
  match re-checked at its place with a sticky regex (changed since: skipped, and said), files that weren't dirty are
  saved; Replace Preview = `vscode.diff` against a `kural-replace:` document. The page (`media/search.js`) draws only the
  rows on screen (fixed row height, `measure()`), so 20 000 results stay fast. Title-bar buttons and F4 use context keys
  `kural.searchTab` / `searchHasResults` / `searchTree` / `searchCollapsed` that the page reports (`ui`). Right-click =
  package.json `webview/context` with each row's `data-vscode-context`. Tests: `test/search-text.test.js` (real
  ripgrep when one is found: the built app's, or `rg` on PATH, or `KURAL_RG`).
- **Windows signing** (`scripts/sign-win.sh` with jsign, `installer/sign.nsh` `!finalize`/`!uninstfinalize`,
  `build-win.sh`): unsigned → SmartScreen's "Windows protected your PC" (user steps in README/Troubleshooting). Does
  nothing until the repo has a certificate in secrets (`WINDOWS_SIGN_*`, Azure's `AZURE_*`: docs/windows-signing.md);
  then Kural.exe, kural-tunnel.exe, the installer and the uninstaller are signed and time-stamped, and windows-check
  fails unless `Get-AuthenticodeSignature` says Valid. Every CI build runs `scripts/sign-win-check.sh` (a throwaway
  certificate, a tiny NSIS installer through the same sign.nsh, both files must be signed). makensis reads from the
  script's folder: `!include "sign.nsh"`, not `${__FILEDIR__}/…`. Kural's own updates (Node fetch, no
  Mark-of-the-Web) aren't checked by SmartScreen.
- **VSCodium's own content** (`rebrand.py` `drop_vscodium_welcome`, `rebrand_messages`, product.json): the Welcome page's
  "VSCodium Announcements" (VSCodium fetches `announcements-extra.json` from its GitHub when
  `workbench.welcomePage.extraAnnouncements` is on, which was the default; `BGe` is empty) isn't built or placed
  (`buildAnnouncementList()` call and its two `getDomElement()` uses removed; the package.json default is also false) and
  the built-in "Setup" walkthrough ("Get started with VSCodium", `when:"!isWeb"`) gets `when:"false"`. Both are found by
  shape; a miss → `::warning::`, and applying twice changes nothing. `out/nls.messages.json` (not in `checksums`): the word
  VSCodium on its own → Kural in ~100 strings, never inside a URL; the issue reporter's guidance links → CONTRIBUTING.md.
  product.json `reportIssueUrl`/`licenseUrl` → Kural's repository. Other VSCodium links (`serverDownloadUrlTemplate`,
  tunnel mutex names) are internal and stay. Test: `test/rebrand-welcome.test.js` (a stand-in app folder, and a real
  workbench file when one is around).
- **Mac helper apps**: Electron finds them by the app's CFBundleName ("Kural" → `Kural Helper (GPU).app` …). `build-mac.sh`
  renames the program, the 4 helpers and `bin/kural` together; a mismatch crashes the app at launch. CI opens the real
  app on all three systems (not just `--version`, which never starts the helpers).
- product.json `checksums` cover VS Code's core JS files (VS Code calls the install "corrupt" if they change).
  The one exception: `rebrand.py` `add_update_menu()` adds Help → Check for Updates to workbench.desktop.main.js
  (extensions can't add to the Help menu) and rewrites that file's checksum (sha256, base64, no "="). It only patches
  if the old checksum matches and the anchor ("Ask @vscode" Help item) is found; otherwise it skips with a
  `::warning::` (shows in the CI summary). Because a menu patch can silently miss, updates are also checked daily and
  reachable from the Chat panel's … menu and Kural Settings.
- **Updates** (`lib/updates.js`): `autoCheck()` once a day (globalState `kural.update.lastCheck`, setting
  `kural.updates.autoCheck`), quiet unless there's a newer version (non-modal offer, not awaited: an ignored
  notification must not keep `busy` set, or Check for Updates silently does nothing); newest GitHub release incl. alpha/beta/rc (`compareVersions`), file per platform
  (`assetFor`: .deb / mac .zip / win setup.exe). Ubuntu: `pkexec dpkg -i` (PATH set: dpkg needs /usr/sbin), then quit at once.
  Mac/Windows: `afterQuit` writes a script FILE (not `sh -c`: `pgrep -f <app>` would find itself) that waits for Kural's
  main process (`process.ppid`) AND every process running from inside the app (`<app>/Contents/`, the install folder on
  Windows; 20 s, then stopped), then installs. Replacing the app while any helper still ran crashed it ("Kural quit
  unexpectedly") and the new one sometimes didn't start. Mac swap: `extension/lib/mac-swap.sh` (`kural_swap NEW APP`, shared
  by `macSteps`, which pastes the file's text into its script, and `install.sh`; `kural_swap_dir` for `--ext`): `ditto` to
  `<app>.kural-new`, check it's whole (`kural_app_ok`: Contents/MacOS/Kural, Electron Framework incl. Versions/Current, the
  4 helpers; codesign only warns) BEFORE touching the old app, then old → `<app>.kural-old`, new → app, check again, only
  then delete `.kural-old`; any failure puts the old app back, and the live app is never deleted without a checked
  `.kural-old`. (The old swap deleted the app when `mv` failed: "Library not loaded: Electron Framework".) Free space and
  write access are checked first; write access also BEFORE quitting (`byHand` otherwise). `test/mac-swap.test.js`. Each step goes to
  `<globalStorage>/update.log`; `lastUpdate()` at the next start reports a failure (globalState `kural.update.pending`).
  A quit vetoed by a dialog: a notification after 20 s (the script keeps waiting). The script clears
  `CachedProfilesData/*/extensions.builtin.cache` and drops ELECTRON_*/VSCODE_* env vars. `test/updates-script.test.js`
  runs the real Mac script on a stand-in app (its stand-ins start detached: a zombie child keeps `kill -0` true).
- **What's new** (`lib/whats-new/`: `notes.js` no vscode, `index.js` the tab): globalState `kural.whatsNew.seen` = the
  version Kural last started as; a newer one → the "What's New in Kural" tab with every "## What's new in X" block of
  RELEASE_NOTES.md since then (`decide`, `between`; its own small markdown renderer, everything escaped). Versions
  before 1.1.0-alpha.7 didn't remember, so without `seen` only `lastUpdate()`'s record of a working update counts (a new
  install isn't greeted). The notes: `RELEASE_NOTES.md` beside the extension (`rebrand.py` copies it), else the file at
  the version's tag on GitHub. So the release's "What's new in <version>" block must exist (`test/whats-new.test.js`).
- **install.sh** (Mac): Kural is found by its path (`pgrep -f /Applications/Kural.app/Contents/`, never `-x Kural`: that
  also hits test copies) and is never force-killed: it waits until Kural has really gone (the 6 Oct crashes were the app
  deleted 1 s after a `pkill` while Kural still showed a dialog). Run from Kural's own terminal (which dies with Kural),
  the replacing step goes to a detached script (`perl -MPOSIX setsid`, log in /tmp) that waits for Kural to close.
  Ubuntu: waits for Kural to be closed before `apt install`; inside Kural's terminal it refuses with a message.
- **Crash log** (`lib/crash/`: `scan.js` no vscode, `index.js`): per window a marker `<globalStorage>/sessions/<ext host
  pid>.json` (refreshed every minute, `clean` on deactivate); at start, unclean markers of dead pids + macOS
  `~/Library/Logs/DiagnosticReports/Kural*.ips` (parsed: exception, crashed thread, frames) + VS Code's logs of the
  sessions since the last scan (`CRASH_LINE`, last errors) → `<globalStorage>/crashes/crash-*.md` and one notification
  (Show report / Report a bug: copies it, opens the bug form). Uncaught errors whose stack is Kural's → `kural-errors.log`.
  VS Code's Crashpad is NOT turned on: it sets `ignoreSystemCrashHandler`, which would lose macOS's readable reports.
- **Checkpoints, Edit, Restore code** (`lib/chat/changes.js`, `restoreTo`/`rewindTo`/`laterChanges` in the chat):
  every snapshot is also saved to `<globalStorage>/checkpoints/<id>.json` (≤10 MB, deleted after 30 days; Keep no longer
  drops it), and each change records `after` (hash of the file as the AI left it) to warn about your later edits.
  Restore = each file back to the snapshot of the EARLIEST answer after the message that changed it; changes become
  "undone". Edit = optional restore (modal), messages cut at the index, a new session with `carryOver {edited}` (the
  handoff record), like a provider switch. Page: `.msg-actions` on user messages, `S.editing` + `.edit-bar`, `editIndex`
  in the send message. Fork from here asks the same (`forkAsk`: Restore Code / Keep Code; closing it = no fork) when
  answers after that message changed files (Adithya: going back to an older point must ask about the code).
- **Messages sent while it answers (the queue)** (`queueSend`/`onEcho`/`giveBack` in `lib/chat/index.js`): Enter never
  stops an answer (Adithya: it did); only Stop/Esc does. The message goes to the program at once (`sendTo`), and every
  program echoes each message when it takes it in (`{type: "user", isReplay: true}`): Claude Code with
  `--replay-user-messages` (an `OPTIONAL_FLAGS` probe; `ClaudeProcess.echoes`; it adds a mid-answer message at the next
  tool step, or runs it as the next turn), Codex with `turn/steer` {threadId, expectedTurnId, input} then an echo (an
  error → its queue, next turn), agy when `next()` starts one (no steering), Kural's engine before its next model request
  (after the tools) or next turn. The chat keeps `r.expect` (everything sent, in order: turn / steer / nudge; matched by
  text, then order) and `r.steers` (not taken in yet: the queue above the box). Echo while the reply runs → a `steer`
  block; after it ended → a new user message + reply (`beginTurn`). `finishReply` keeps the tab "running" while steers
  wait (30 s → `giveBack`); `warm()` never restarts then. Stop with steers → `forceStop` (an interrupt would make Claude
  answer them next) and `giveBack` (page `unqueue`: back into the box). Old Claude Code without the flag: a flash to
  update, the draft stays. Live-checked with Claude Code 2.1.289 (one answer with both; the poem case: next turn).
  Tests: test/queue.test.js, the engine/codex/agy tests (fake-codex has `turn/steer`, FAKE_CODEX_NO_STEER).
- **Steps dropdown** (`media/chat.js` `parts`/`layout`/`stepsNode`): thinking, tools (not team posts), answered permissions and
  the text before the last step go into ONE `.steps` group per part of an answer (a `steer` block, a message you
  added while it worked, splits it into parts; only the last part's dropdown is live); pending permissions/questions, agent cards, team
  posts, pictures and the text after the last step stay outside. An answer with steps is redrawn on each new block
  (`appendBlock` → `rerender`); `patchBlock` still patches inside the group and refreshes `.steps-line`.
- **Instructions changed mid-chat** (`instructionsNote`, `tab.sessionInstructions` fingerprints): Claude Code (checked
  with 2.1.289) ignores `--append-system-prompt(-file)` on `--resume`, so a mode, mood or team change after the first
  message reached Claude never; now the next message starts with a `<kural_instructions_update>` saying what changed.
- **Notifications** (`lib/chat/notify.js`, no vscode): done, or needs you (a permission, a question, a plan to build, an
  error, a login), while you're away (setting `kural.notifications`: whenAway / always / off; `onScreen()` =
  `pane.view.visible` / `panel.visible` and the window's focus). One per answer (a team's at the end; none after Stop),
  one per chat at a time (toast id `kural-chat-<tabId>`), cleared when you answer or open the chat; a click shows it.
  Routes (`Notifier.show` returns the one used): on a Mac osascript FIRST (the Electron toast `_kural.osToast` from an
  ad-hoc-signed app, re-signed on every install, is dropped silently while it still reports `supported`: that's why
  notifications "didn't work"), then the toast, then VS Code's in-window notification; elsewhere the toast, then
  notify-send / a PowerShell toast, then in-window. Every decision is logged (`notifyDecision` gives the reason);
  "Kural: Test Notification" (`kural.testNotification`) sends one ignoring focus and says the route. osascript can't
  report clicks: on a Mac a click doesn't open the chat. The test copies share the bundle id com.kural with the real
  app: a toast from them asks about (and changes) the real Kural's permission.
- **Model menu headings** (`media/chat.js` `mhead`): each AI's heading has a gear (`aiSettings` → `kural.modelRouter` for
  Auto, else `kural.account <ai>` = Kural Settings scrolled to that card, connectors open). Not-set-up AIs, Claude Code's
  setup line and "Find & download models" are NOT in the menu (Adithya: clean menu); the Models page opens from Kural
  Settings (`kural.findModels` → the chat's `openLocal`). Placeholder: "Ask Kural something".
- **Connectors** (`lib/ai/connectors.js`, no vscode; Kural Settings cards): Claude = `claude mcp list|add -s user|remove`
  (list does health checks: seconds; the mark before the status varies: ✓ ✗ × !; "claude.ai …" ones are managed on
  claude.ai, no remove); Codex = `codex mcp list --json|add [--url]|remove`; Gemini (agy) and Ollama: none. A Claude change
  → `chat.setupChanged()`. Names are checked (`NAME_RE`, never starting with "-"); commands are split without a shell.
- **Usage switch points** (`lib/ai/usage-switch.js`): `kural.usageSwitch.enabled` + per AI `kural.usageSwitch.limits`
  {claude|codex|agy: {session, weekly}} (missing → `threshold`). `over(model, settings)` uses `model.limitParts`
  (`policy.limitParts`: Session windows vs the rest) else `limitUsed`; chat `overLimit(provider, model)`.
- **Team offer** (`chat.bigTask`/`offerTeam`): Auto mode, one agent, router `classify` says complex (≥ 0.8) edit/other →
  `teamOffer` card above the box, 15 s (`KURAL_TEAM_OFFER_SECONDS` for tests), answer `teamOfferAnswer`; uses
  `routingJobs` so Stop cancels it. `bigTask` is checked synchronously first (an await on every send broke fork's
  stop-before-dispatch timing). **Haiku for well-defined work**: `routingRequest.wellDefined` ("Build it") → `need = 1`
  in `select` (not Intelligence; a checkpoint still escalates); team prompts start developers with Agent `model: "haiku"`
  (checked with real Claude Code). `test/team-offer.test.js`, `test/haiku-build.test.js`.
- **Workspace Color** (`lib/workspace-color.js`, `rebrand.py` `add_workspace_color_item`): six `activityBar*` keys in
  `workbench.colorCustomizations` + `kural.workspaceColor`, Workspace target, merged; Remove deletes only keys still equal
  to what Kural wrote. The right-click item is a bundle patch: VS Code builds that menu in
  `getActivityBarContextMenuActions()` (not a MenuId), the patch pushes one action before its final `return s.push(...)`;
  found by shape, a miss gives `::warning::` (the command stays in the Command Palette). Verified to apply on VSCodium
  1.135 (codium.lock); a real click not yet checked. Needs a full `./install.sh` (not `--ext`).
- **Tests and the built app**: tests that read the built workbench use `test/workbench.js` (`KURAL_WORKBENCH`, the repo's
  build folders, /Applications/Kural.app) and skip without one. Never hardcode a path on someone's computer.
- **Moods** (`prompts.js` `MOODS` + setting `kural.chat.moods`, edited in Kural Settings → Moods): your own moods are read
  from user settings only (`inspect().globalValue`: a project's settings can't inject instructions); editing one
  restarts idle chats with the new text. Built-in moods can be removed (Adithya, Default too): `kural.chat.hiddenMoods`,
  user settings only as well; `shownMoods` keeps at least one (all four removed and none of yours → Default), and a chat
  whose mood is gone (deleted or removed) gets `firstMood()`, the menu's first. Webview pages: CSP blocks `style="…"` attributes, so set
  `el.style.…` / `style.cssText` in the page script (Kural Settings showed every usage bar full); `replaceChildren(null)`
  writes the text "null". chat.css class names are global: the mood chip once had class `add`, which is the diff's
  monospace "+12", and showed in the code font (now `mood-add`).
- **Ctrl/Cmd+L** = `kural.chat.toggle` (`toggle()` in the chat): the side panel's chat on screen (`side().view.visible`)
  → `workbench.action.closeAuxiliaryBar`, unless code is selected in the editor you're typing in (then `open()` adds it;
  `chatFocused`, from the page's focus events, means the editor's old selection doesn't count). `kural.chat.open` stays
  for menus and the Command Palette.
- **Quotes from the chat** (`media/chat.js` `placeQuoteBtn`/`addQuote`): text selected inside `.list` shows "Add to chat"
  (a fixed button; mousedown is prevented so the click doesn't clear the selection) → a pill `kind: "quote"` {text ≤
  8,000 chars, label}; `buildPrompt` sends it as "Part of this chat I selected" with `> ` lines; textOf/titleOf/journal
  show `"label"`. Test: `test/chat-context.test.js` (also Ctrl+L and the no-log-button title bar).
- **Did you know** (`media/facts.js`, setting `kural.chat.didYouKnow`): one fact under the working line from ~4 s into an
  answer, a new one every 15 s, a fixed three-line height (the answer never jumps), gone when it ends; "Know more" opens
  in Kural's browser. Kural tips link to the wiki (pages not published yet link to `blob/main/docs/wiki/*.md`); the
  others to MDN/Wikipedia/official docs. Every link answered 200 on 8 Oct 2026: check new ones the same way.
- **Only the project's files are "changed"** (`changes.js` `inProject`): checkpoints, `finishTurn` and old chats
  (`clean()`) leave out files outside the project folders (no folder open: `ws.workDir()`; a project inside /tmp counts),
  e.g. notes the AI writes in /tmp or `~/.claude`. Undo all, Restore code and what Tab/Auto learn follow.
- **Idle chats free their program** (`stopIdle`, every minute): a chat off screen and idle for 10 minutes (or beyond the
  two most recently used idle ones) stops its program (`r.stale`); `warm()` starts it again in the same conversation
  when you open the chat, show the side panel or send. Never while an answer, agent, queued message, question or a
  background task runs (`r.bg`: Claude Code's `task_started`/`task_notification`, tracked also after the answer: a dev
  server the AI started dies with the program). Streaming text is redrawn ~15 times a second (the page took 15 % of a
  core at 60). A model on this computer gets `GUIDE_LOCAL` (~1,100 characters) instead of the whole guide.
- **Tokens** (`lib/ai/usage.js` `addTokens`/`tokenTotals`, per provider per day, 35 days, saved with the rest): Claude's
  `result.modelUsage` (all models) in `ClaudeProcess.onData` (every Claude process); Codex `thread/tokenUsage/updated`
  (totals: deltas), Gemini's per-answer usage and Ollama's `prompt_eval_count/eval_count` → the hub + a `kural_usage`
  event to the chat. The chat keeps `tab.tokens` and `tab.context {used, window}` (Claude: the last lead message's usage,
  `modelUsage.contextWindow`) → the ring next to the send button; the AI Usage panel shows read/cache/written.
- **Settings export/import** (`lib/settings-io.js`): JSON `format: "kural-settings"`; kural.* without machine-scoped
  keys, the user settings.json (JSONC parsed) and keybindings.json, non-built-in extensions, chat defaults
  (`kural.chat.last`), devices without auth state. Import: QuickPick of what's in the file; keybindings merged without
  duplicates. Tests: `test/settings-io.test.js` (also the checkpoints on disk).
- **Commit message in Source Control** (`lib/scm/commit.js`): `scm/inputBox` menu (enabledApiProposals
  `contribSourceControlInputBoxMenu`) + `scm/title`; the git extension's API (`repo.diff(true)`, else unstaged; recent
  subjects); its own `brain.Session` ("scm-commit", `<msg>…</msg>`).
- **Moving a dragged-out chat back** (`kural.chat.moveToPanel`): editor/title button when `activeCustomEditorId ==
  kural.chatTab`; disposes the pane and activates the chat in the side panel.

## Test
- `npm test` (`test/run.js`: every `test/*.test.js`, so a new test needs no package.json change) — no Claude needed (diff engine, Ctrl+K reply parsing, Jira ticket rules, team board, what Tab learns, Tab panel page script, Get started checks).
- `node test/completion.live.js` — real tab completions (needs `claude` logged in): 11 cases + typing burst.
- `node test/personal.live.js` — Tab and commit messages with vs without what you've been doing (real Haiku).
- In the editor: `./install.sh --ext` (copies `extension/` into the installed app; on a Mac it re-signs and restarts
  Kural; on Ubuntu run "Developer: Reload Window"). "Kural: Show Log" shows every request with timings (`lib/log.js`:
  the last 5000 lines in memory, a read-only `kural-log:` editor tab; VS Code's Output tab is hidden).

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
