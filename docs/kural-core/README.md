# Kural Core: what we tried, and why we stopped

**Stopped on 25 Oct 2026 (Adithya): not feasible with the AI plans we have.** All code from the attempt was removed; this
folder is the record. The other files here are the plan as it was when we stopped (they name scripts and folders that no
longer exist).

## In short
Kural Core was the plan to make Kural part of VS Code's own source code instead of a built-in extension on top of
VSCodium: Kural's own build, real source patches instead of `scripts/rebrand.py`'s edits of minified code, one window
holding many projects, and every feature (chat, Tab Completion, the AI providers, ...) moved into the editor as
TypeScript. VS Code's extensions would keep working. The foundation was built and checked, and five agents started the
first wave. After about 20 minutes of agent work it was clear the AI plans' usage limits allow roughly one agent at a
time: the whole move would take about 10 days of nonstop, paced work (wave 1 alone about 3 days). We stopped.

## The goal
From `PRD.md` (24 Oct 2026, Adithya: "Kural is no more an extension of VS Code, it becomes an integral part of it"; "the
one thing I still need from them is VS Code's extensions"):

| Limit of today's Kural | What Kural Core would change |
|---|---|
| The extension API decides what Kural can do (5 proposed APIs, webviews for every page) | Kural's code inside the workbench, native views |
| Anything beyond the API is a patch on minified code (about 20 `rebrand.py` functions, found "by shape") | Source patches made against pristine VS Code, re-made with `git apply --3way` per VS Code release |
| One OS window per project (`0100-one-frame-windows` hides and shows whole windows) | One window, a view per project, instant switching |
| Kural shares the extension host with every other extension | The AI work in its own Node process (the "Kural host") |
| VSCodium is in the chain (its download, patches and product values) | Kural's own build, product values and branding |

## What was built

### M0: documents (done)
`PRD.md`, `ARCHITECTURE.md` (the source tree, processes, conventions, switching a feature over), `PLAN.md` (milestones,
tracks, ownership rules), `FEATURES.md` (every feature and where it would live), `CHAT.md` (the chat's design: what moves
to the host, what becomes native UI, the message contract), and the track briefs in `tracks/`.

### M1: foundation (done, checked)
- A `src/` folder in this repository overlaid onto the fetched VS Code tree (`scripts/vscode/overlay.py`, `fetch.sh --src`).
- A hook patch `patches/kural/0001-kural-core.patch` (89 lines) to wire Kural's code into the workbench and main process.
- **The Kural host:** a utility process started once by the main process. Each window talks to it over its own
  MessagePort (`_kural.host.ping`), and it is warmed up at startup.
- Base code in TypeScript: paths, private files, process helpers and version comparison, with 16 unit tests.
- `scripts/vscode/lint.sh`, `build-lock.sh` (one heavy build at a time), and `npm ci` rerun only when dependencies change.
- Checked: the type check, ESLint with 0 warnings, the unit tests, and a Mac source build whose test copy started the host
  once and connected two windows to it.
- Size: 37 files, about 2,700 lines (commits `6d8a870`, `358dc1d`, `175f1a6` on branch `kural-core`).

### M2: wave 1 (started, stopped at about 9 %)
Five agents (`claude -p`, unattended), each in its own git worktree under `build/kc/<track>` on branch `kc/<track>`:

| Track | Job | When stopped |
|---|---|---|
| T1 Build | No VSCodium: Kural's own branding, telemetry and extension-gallery patches and product values; source-only builds and CI | Had read VSCodium's patches and was rewriting them as Kural's; 28 files changed, nothing committed |
| T2 Hooks | Every `rebrand.py` edit of minified code as a source patch or Kural code | First hook modules written (view conditions, comment box height, terminal prefix match, version label, webview permissions); 35 files changed, nothing committed |
| T3 Project views | One OS window, a `WebContentsView` per project | Ran a small Electron experiment (results below), then mapped VS Code's window code: every `BrowserWindow` use, in 9 main-process files |
| T4 AI providers | Claude Code, Codex, Antigravity and its gate, Kural's engine, Ollama, installs, usage, connectors as TypeScript in the host | 2 commits, 25 files, 7,088 lines (`53cb760`, `50c7234`, partly work in progress) |
| T5 Router, split, devices | Model Router, parallel agents, git, SSH devices as TypeScript in the host | 1 commit, 23 files, 4,917 lines (`425dac7`); then moved to Codex, which ran one minute |

### T3's experiment: one window, many projects (worth keeping)
A throwaway copy of the built app with a 150-line test program: one window, three pages standing in for three projects'
workbenches, 30 switches, the screen recorded every ~16 ms.

| Question | Result |
|---|---|
| How fast is a switch? | 23-25 ms on average, 38 ms at most |
| Did every switch draw correctly? | Yes, 30 of 30; no blank or half-drawn frame in 78 samples |
| Is it one OS window the whole time? | Yes |
| Does a hidden project keep running (its chat keeps answering)? | Yes, with `backgroundThrottling: false`; with throttling on, hidden pages pause |
| Can a project move to a window of its own (a second monitor) without a reload? | Yes, the page kept running |

So "project views" works in Electron. The cost is in VS Code: its main process looks windows up as `BrowserWindow`s
everywhere, and a view inside a `BaseWindow` isn't one.

## Why we stopped: the measurements
Measured on 25 Oct 2026 with Claude's Max plan and ChatGPT Plus.

**How big the work is.** Kural's code, tracked files only (`git ls-files`; no builds, `node_modules`, history or the bundled
Mermaid): 34,467 lines in 170 files, 27,751 without blank lines and comments, plus 21,104 lines of tests. Every line moves
into VS Code's strict TypeScript and lint rules, keeps its behaviour, and is checked against VS Code's own large tree.

**What it costs.**

| Measurement | Value |
|---|---|
| Five agents together | about 2.4-3 % of Claude's 5-hour Session per minute: a whole Session in about 35 minutes |
| First 20 minutes of wave 1 | the Session went from 8 % to 59 %; about 92 agent-minutes of work |
| One Sonnet agent | about 0.4-0.45 % of the Session per minute of work |
| One full Session in weekly terms | about 12 % of the weekly limit (weekly 3 % to 9 % while the Session went 8 % to 59 %): about 8 full Sessions a week |
| Where the tokens went | mostly cache reads: each agent re-reads its growing context on every step (T1 read 39 million tokens in 19 minutes) |
| T4's five helper agents on Opus | more than any whole track (18 million tokens in 15 minutes): helpers inherit no model unless told |
| Codex on ChatGPT Plus | its first minute used about 5 % of Codex's 5-hour limit, mostly reading the project's notes |
| Codex with its outside tools off (apps, browser, computer use) | half the tokens per request (22k instead of 43k) |

**What that allows.** About 4 agent-hours per full Claude Session, about 33 agent-hours of Claude a week, plus about 5 of
Codex: roughly 5.4 agent-hours a day if the Mac runs day and night and almost no Claude is used for anything else.

| Scope | Work left (estimate) | Time at ~5.4 agent-hours a day |
|---|---|---|
| Wave 1 (T1-T5) | about 16 agent-hours | about 3 days |
| Only T1-T3 (build, patches, project views) plus merging | about 14 agent-hours | about 3 days |
| The full move (both waves, switch-over, old code removed) | about 50 agent-hours | about 10 days |

The weekly limit is the real constraint: running Sessions flat out would use about 60 % of the week in one long day and
then stop everything until the weekly reset.

## What was removed
- Branches `kural-core` (`175f1a6`) and `kc/t1-build`, `kc/t2-hooks`, `kc/t3-project-views` (all `358dc1d`), `kc/t4-ai`
  (`50c7234`), `kc/t5-router-split-devices` (`425dac7`). Their commits stay reachable through `git reflog` until git's
  garbage collection removes them (about 90 days): `git branch rescue 175f1a6` brings the foundation back. The tracks'
  uncommitted work (T1, T2, and parts of T4 and T5) is gone.
- `src/`, `patches/kural/0001-kural-core.patch`, `scripts/vscode/{overlay.py,lint.sh,build-lock.sh}`, the changes to
  `scripts/vscode/{fetch.sh,build.sh}`, and `scripts/kc/` (the track launcher, the usage pacer, the dashboard).
- The agents' worktrees `build/kc/` (28 GB), the attempt's build output (`build/mac/Kural.app` with `0001-kural-core`,
  `build/mac/dmg`, `build/vscode-out`, `build/vscode-lint`), scratch folders in `/tmp`, and the agents' Claude Code session
  records. `build/vscode-src` was reset by `scripts/vscode/fetch.sh` to the normal source build.
- Not touched: `/Applications/Kural.app` (it never had the attempt's code), the source build and Projects bar work from
  before (branch `projects-bar-source-build`), Codex's own session database (`~/.codex/logs_2.sqlite`), and the Linux
  container images and volumes from the earlier source-build work.

## If it's tried again
- **Narrow it first.** Most of the goal (full control, new features, VS Code's extensions) comes from T1-T3: Kural's own
  build, source patches instead of `rebrand.py`, project views. Move a feature into the editor only when it needs to.
- **Plan for the weekly limit, not the 5-hour one.** Pace the week (about one full Session a day), and leave room for
  your own work.
- **One or two agents, Sonnet at medium effort.** Opus only for short design and review moments; Haiku makes too many
  mistakes in VS Code's strict code. Tell helper agents their model (`CLAUDE_CODE_SUBAGENT_MODEL`) or they may run on Opus.
- **Keep contexts small.** Most of the cost was cache reads: find with grep, read line ranges, don't re-read, commit
  finished pieces so a stopped agent can resume cheaply.
- **Codex as a small helper.** On Plus its limit is small; switch its outside tools off.
- **Start from T3's experiment above** for project views, and from `CHAT.md` for the chat.

## The files here
`PRD.md` (the goal), `ARCHITECTURE.md` (the planned source tree and processes), `PLAN.md` (milestones and tracks),
`FEATURES.md` (every feature and its planned home), `CHAT.md` (the chat's planned design), `STATUS.md` (where it
stopped), `tracks/` (the briefs the agents worked from; `T11a-app.md` was written for wave 2 and never started).
