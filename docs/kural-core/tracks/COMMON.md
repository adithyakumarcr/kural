# Brief for every track agent (read first)

You are one of several engineers moving Kural from "VSCodium + an extension" to an independent editor built from VS Code's
source, with Kural's features in the editor's own code. Adithya (the owner) is away and asked for the right solution,
not the fastest one: take the time you need, check your work, and say plainly what you could not check.

## Read before you start
1. `CLAUDE.md` (how Kural works today, Kural's rules: no emoji, plain words, no keychain, no unasked macOS prompts...).
2. `docs/kural-core/PRD.md`, `ARCHITECTURE.md`, `PLAN.md`, `FEATURES.md`.
3. Your own brief: `docs/kural-core/tracks/<your track>.md`.

## Where you work
- Your git worktree (the folder you were started in), on your branch `kc/<track>`. Commit there, often, in small steps
  with clear messages; end each commit message with the line
  `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never push, never touch `main` or another branch, never open a pull request.
- Write only the paths your brief says you **own**. Everything else is read-only for you. If you need a change in a file
  you don't own, describe it in your report (section "For the integrator"). Exception: you may add ONE import line for
  your feature to `src/vs/workbench/contrib/kural/electron-browser/kural.contribution.ts`, if your brief says so.
- Don't edit `CLAUDE.md`, `README.md`, `RELEASE_NOTES.md`, `docs/wiki/**`, `docs/kural-core/{PRD,ARCHITECTURE,PLAN,FEATURES}.md`,
  `extension/lib/chat/guide.js` or `extension/package.json`: the integrator does, from your report.

## Your VS Code tree
VS Code's tools need its Node (v24, in `build/`): `export PATH="$PWD/build/node-v24.18.0-darwin-arm64/bin:$PATH"` from your
worktree's root before the commands below (the computer's own Node is v26).
Your worktree has `build/vscode-src` already (an APFS clone of the integrator's, with `node_modules`). After changing
`src/` run `scripts/vscode/fetch.sh --src` (copies Kural's code onto the tree in a second). After changing a patch, or to
start clean, run `scripts/vscode/fetch.sh` (about 10 s; it keeps `node_modules`).
- Type check: `cd build/vscode-src && NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc -p src/tsconfig.json --noEmit`.
  VS Code itself has 7 errors in `src/vs/platform/policy/test/node/nativeManagedSettingsService.test.ts`; anything
  else is yours to fix.
- ESLint: `scripts/vscode/lint.sh` (all of Kural's code and patched files, 0 warnings allowed) or `scripts/vscode/lint.sh <files>`.
- Unit tests in the tree: `cd build/vscode-src && node build/next/index.ts transpile` once (writes `out/`), then
  `npm run test-node -- --run src/vs/platform/kural/test/node/<...>.test.ts` (see `test/unit/README.md` there).
- Legacy tests: `npm test` in the worktree root (161 files; all pass on the branch you started from).

## VS Code's rules that bite
- Node's `path` module is not allowed: use `vs/base/common/path.js` (same functions). The allowed Node modules are listed
  in VS Code's `eslint.config.js` (`fs`, `os`, `child_process`, `crypto`, `net`, `http(s)`, `events`, `stream`,
  `string_decoder`, `util`, `zlib`, `worker_threads`, …). Layers: `common` imports no Node and no DOM; `node` imports
  `common`/`node`; `browser` imports `common`/`browser`; `electron-browser` adds the native host; folders go
  `<area>/<layer>/<domain>/…` (ARCHITECTURE §1).
- Kural's files start with Kural's header (see any file under `src/vs/platform/kural/`), not Microsoft's.
- UI text through `localize()`; no emoji; Codicons.

## Heavy commands share one machine (16 GB, 10 cores)
Run every full build, `npm ci` and Linux container build through the lock, so only one runs at a time:
`scripts/vscode/build-lock.sh env KURAL_SOURCE=1 ./build-mac.sh`. Type checks (about 4 GB for 15 s) and the `transpile` step
go through a second, short lock: `KURAL_BUILD_LOCK="${TMPDIR:-/tmp}/kural-tsc.lock" scripts/vscode/build-lock.sh <command>`.
Unit test runs and ESLint don't need a lock. Five agents share this machine: don't leave test copies of the app running.

## Trying the app
Never install over `/Applications/Kural.app` and never stop its processes: Kural is running this work. Try your build
as a test copy: `build/mac/Kural.app` started with its own `--user-data-dir` and `--extensions-dir` in a temp folder (start
it with `env -i HOME="$HOME" PATH="$PATH" ...` when started from inside Kural: Kural's terminal sets `ELECTRON_RUN_AS_NODE`).
Stop only the processes whose path is inside your worktree. CDP (`--remote-debugging-port`) and the main process's
`--inspect` are fine for checks (see `test/one-frame.live.js` for a working example).

## When you finish (or have to stop)
Write `docs/kural-core/reports/<track>.md` and commit it:
1. What you did (files, decisions and why).
2. How you checked it (the commands you ran and their results).
3. What is NOT checked, and known problems.
4. For the integrator: changes needed in files you don't own, the import line, docs text for CLAUDE.md/wiki/guide.
Then stop. Don't wait for an answer: nobody will reply.
