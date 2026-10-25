# Kural Core: plan

How the move happens: in milestones, with parallel tracks that never edit the same files. Read `PRD.md` and
`ARCHITECTURE.md` first. Branch: `kural-core` (from `projects-bar-source-build`).

## Rules for every track
1. A track writes only inside the paths it **owns** (table below). It reads anything.
2. Shared files are the integrator's (the lead agent): `CLAUDE.md`, `README.md`, `RELEASE_NOTES.md`, `docs/wiki/**`,
   `extension/lib/chat/guide.js`, `extension/package.json`, `src/vs/workbench/contrib/kural/electron-browser/kural.contribution.ts`,
   `src/vs/platform/kural/common/kuralHost.ts`, `docs/kural-core/{PRD,ARCHITECTURE,PLAN,FEATURES}.md`. A track that
   needs a change there writes it in its report (`docs/kural-core/reports/<track>.md`), and the integrator makes it.
3. Each track works in its own git worktree and branch (`kc/<track>`), commits there, and ends with its report:
   what it did, how it was checked (commands and results), what is NOT checked, what the integrator must do.
4. Nothing is pushed, nothing is installed over `/Applications/Kural.app` (Kural runs this work), test copies only
   (`--user-data-dir` in a temp folder, started with `env -i` when started from Kural's terminal).
5. Checks before a commit: the type check and ESLint on the touched files in a fetched tree, the track's unit tests,
   and `npm test` for anything that touches the legacy side.

## Milestones

### M0 Documents (done here)
PRD, architecture, this plan, the feature map.

### M1 Foundation (integrator)
- `fetch.sh` copies `src/` onto the tree (rules in ARCHITECTURE §1); `product/` overlay hook.
- Hook patch `0001-kural-core.patch`: the workbench imports `contrib/kural/electron-browser/kural.contribution`, the build has the
  Kural host's entry point, the main process starts the Kural host and answers `vscode:createKuralHostMessageChannel`.
- The Kural host skeleton (entry, starter, client, the host's log, `ping`), and `platform/kural/{common,node}/base`
  (paths, private files, utf8, killtree, version compare): the shared base every track uses.
- Checked: type check, ESLint, a build, a test copy that starts the host and answers a ping from a window.

### M2 Wave 1: tracks in parallel
Each track has a brief in `docs/kural-core/tracks/` (`COMMON.md` first) and runs as its own agent (`claude -p`) in a git
worktree under `build/kc/<track>` on branch `kc/<track>`, started by `scripts/kc/start-track.sh`.
| Track | Owns | Delivers |
|---|---|---|
| T1 Build ownership | `scripts/vscode/**` (except the overlay step's rules), `product/**`, `patches/kural/00[1-9]*`, `vscode.lock`, `codium.lock`, `build-mac.sh`, `make-deb.sh`, `build-win.sh`, `install.sh`, `.github/workflows/**`, `scripts/update-*`, `scripts/check-codium.sh`, `scripts/electron_runtime.py`, `scripts/sbom.py`, `scripts/make-icons.py`, `installer/**`, `test/vscode-source.test.js`, `test/linux-container.test.js`, `scripts/linux-container/**` | No VSCodium anywhere: Kural's own branding/telemetry/gallery patches and product values, source-only builds and CI (R1) |
| T2 Workbench hooks | `scripts/rebrand.py`, `patches/kural/03*`, `test/rebrand-*.test.js` | Every `rebrand.py` edit of minified code as a source patch (or Kural code), `rebrand.py` reduced to copying files (R2.2) |
| T3 One window, many projects | `patches/kural/01*`, `src/vs/platform/kural/electron-main/frames/**`, `src/vs/platform/kural/test/**/frames/**`, `test/patch-one-frame.test.js`, `test/one-frame.live.js`, new `test/project-views*` | Project views: a frame per OS window, a `WebContentsView` per workbench, instant switching (R3.1, R3.2, R3.4) |
| T4 AI providers | `src/vs/platform/kural/{common,node}/ai/**` (not `agent.ts`) and their tests | Claude Code, Codex, Antigravity + gate, Kural's engine + tools, Ollama, installs, checks, usage hub, names, connectors as TypeScript in the Kural host, tests ported (not wired to UI yet) |
| T5 Router, split, devices | `src/vs/platform/kural/{common,node}/{router,split,devices,git}/**` and their tests | Model Router, parallel agents, git, devices as TypeScript in the Kural host, tests ported (not wired to UI yet) |

### M3 Integration of wave 1 (integrator)
Merge the five branches, resolve the shared files from the reports, full build on the Mac, Linux container run, `npm test`.

### M4 Wave 2: the Kural host's services, then UI tracks
- Integrator: the chat runtime as a Kural host service (`IKuralChatService`: tabs, send, stop, permissions, questions,
  queue, checkpoints, History), on T4's providers.
- Tracks (each a `browser/<feature>` folder + its platform domain): T6 chat view (the page's DOM code as a native view:
  columns, timeline, markdown, choices, side chat, split card, voice and Listen controls), T7 Projects bar native (on T3's
  frames), T8 pages (Kural Settings, Get started, AI Usage, Model Router panel, Tab panel, What's New), T9 editor features
  (Tab Completion, terminal Tab, rename offer, Ctrl+K, selection buttons, Quick Question, Fix with Kural, Explorer
  activity, commit message), T10 side bars (Search & Ask, Plugins, Connectors), T11 the rest (rules, review, debug,
  devices UI, browser + the AI in it, lessons, voice, Listen, enhance, profiles, updates, crash, remove data, settings
  I/O, workspace color, welcome, notifications, keep-awake).

### M5 Switch-overs (integrator, one feature at a time)
For each feature: core on, legacy deleted, tests moved, docs updated (ARCHITECTURE §4). Then delete `extension/`,
`rebrand.py`'s leftovers and the legacy tests; themes become `extensions/theme-kural` (VS Code's way to ship themes).

### M6 Release readiness
Data-compatibility check on a copy of a real user data folder, Open VSX extensions check, CI on all three systems,
CLAUDE.md rewritten for the new layout.

## Status
Kept up to date in `docs/kural-core/STATUS.md`.
