# T4: The AI providers in the Kural host

PRD R2.4, FEATURES "Providers". Port `extension/lib/ai/*` to TypeScript in the Kural host: the code that runs Claude Code,
Codex, Antigravity (Gemini) and Kural's own engine for Ollama, checks and installs them, reads usage and account names,
and manages connectors. Not wired to any UI yet (the chat runtime comes next, on top of your work), so the measure of
done is: complete, faithful, typed, tested.

## You own
`src/vs/platform/kural/common/ai/**` (except `agent.ts`, the shared contract the integrator wrote: read it, use it, and
put any change you need to it in your report), `src/vs/platform/kural/node/ai/**`,
`src/vs/platform/kural/test/{common,node}/ai/**`. Nothing else (the legacy `extension/` stays as it is; it keeps running
Kural until the switch-over).

Available to you: `src/vs/platform/kural/common/ai/agent.ts` (IAgent, IAgentOptions, IAgentHandlers, IAgentEvent, …),
`src/vs/platform/kural/node/base/{paths,privateFile,process}.ts`, `src/vs/platform/kural/common/base/versionCompare.ts`.
Track T5 ports the Model Router, parallel agents and devices at the same time; don't import their folders, and they don't
import yours: anything one needs from the other is passed in (a function or an interface in your own folder).

## The modules
`claude.js` (ClaudeProcess, ClaudeSession warm pools, findClaude, flags probe, prompt files, cleanEnv), `claude-checks.js`,
`claude-setup.js`, `codex.js` (AppServer, CodexAgent, lockdown args, login), `agy.js` (AgyAgent, gate decisions,
models/efforts), `agy-gate-host.js` + `agy-gate.js` (the hook gate: keep `agy-gate.js` runnable as its own small Node
program: see how it's launched; it may stay plain JS under `src/vs/platform/kural/node/ai/` only if the build can carry it,
else TypeScript built as its own entry point: decide, and say so), `clis.js`, `engine.js` + `tools.js` (LocalAgent, Kural's
tools), `ollama.js`, `ollama-install.js`, `install.js`, `danger.js`, `model-policy.js`, `names.js`, `usage.js` (the usage hub),
`usage-switch.js`, `connectors.js`, `connectors-off.js`, `connector-catalog.js`, and from `index.js` the provider table
(`PROVIDERS`, `providerOf`, `engineOf`, `makeAgent`, `Session`, `fastestModel`, `askLocal`, …) without its vscode parts.

## Rules for the port
- Same behaviour, same command lines, same files on disk, same JSON shapes: keep every comment that says why.
- `vscode` is gone: settings (`kural.claudePath`, `kural.codexPath`, `kural.agyPath`, `kural.localModels.*`, connector
  on/off, …), the profile environment (`lib/profiles/env.js`), the log, globalState/storage paths and the "is Get started
  done" gate become explicit inputs: one options/settings interface per module, or a small `IKuralAiEnvironment` you define in
  `common/ai/`. No module reads global state behind your back; tests can give each module what it needs.
- The log: take an `ILogService`-like `{ info, warn, error, trace }` (VS Code's `ILogService` satisfies it).
- The usage hub is one per app now (the Kural host): its storage is a file in Kural's storage folder, not globalState
  (say which file; the integrator handles moving the old numbers).
- Keep the `test/fake-*.js` programs working against your code: port their tests (`test/codex.test.js`, `test/agy*.test.js`,
  `test/engine.test.js`, `test/claude*.test.js`, `test/usage*.test.js`, `test/connectors*.test.js`, `test/install*.test.js`,
  `test/handoff-fakes.test.js` parts about the adapters, …) to `src/vs/platform/kural/test/node/ai/` using those same fake
  programs from the repository's `test/` folder (find them with a path relative to the repository; skip with a message if
  absent).
- TypeScript strict (VS Code's tsconfig), VS Code's style (tabs, `Disposable`, `Event`/`Emitter` where events fit), no
  npm dependencies, no `any` without a comment saying why.

## Deliver
Ported modules, their tests passing in the tree (`npm run test-node -- --run …`), type check and lint clean, and a report
that lists every legacy export and where it went (or why it was dropped), and the interfaces the chat runtime will use.
