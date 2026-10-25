# Kural Core: architecture

How Kural is built once it is part of the editor. Read with `PRD.md` (what and why) and `PLAN.md` (in what order).

## 1. The source tree

```
kural/                                   this repository
  vscode.lock                            the VS Code commit Kural builds from
  src/vs/…                               Kural's own TypeScript, laid out exactly like VS Code's src/vs
  patches/kural/NNNN-name.patch          small hooks into VS Code's own files (made against pristine VS Code)
  product/product.kural.json             Kural's product.json values (merged over VS Code's)
  extension/                             the legacy built-in extension (shrinks; deleted at the end)
  scripts/vscode/fetch.sh                VS Code + Kural's patches + Kural's src/ -> build/vscode-src
  scripts/vscode/build.sh                npm ci + gulp vscode-<platform>-min
  test/                                  the legacy extension's tests (move with their features)
```

`fetch.sh` copies `src/` onto VS Code's tree **after** the patches. Rules it enforces:
- a file in `src/` may not replace a file VS Code has (a change to VS Code's own file is a patch);
- only `.ts`, `.css`, `.md`, `.json`, `.svg`, `.png`, `.ttf`, `.js` workers that VS Code itself would allow.

So everything under `src/vs/**/kural/**` is Kural's code and reads like code, and `patches/kural/` stays small: the list
of every place where Kural touches VS Code.

### Where Kural's code goes

VS Code's ESLint layering puts the **layer first**: `src/vs/platform/<area>/<layer>/…` and
`src/vs/workbench/contrib/<area>/<layer>/…`. Kural uses one area, `kural`, with a folder per domain inside each layer:

```
src/vs/platform/kural/
  common/<domain>/        types, interfaces, pure logic: no Node, no DOM (runs anywhere)
  node/<domain>/          the Kural host's implementation (Node: child_process, fs, net)
  node/kuralHostMain.ts   the Kural host's entry point
  electron-main/<domain>/ main process: starting the Kural host, frames and project views, OS integration
  electron-browser/       the window's connection to the Kural host
  test/{common,node}/<domain>/*.test.ts
src/vs/workbench/contrib/kural/
  electron-browser/kural.contribution.ts imports every feature (the one list of Kural's UI; Kural is desktop only)
  browser/<feature>/…                    views, editors, actions, status bar items, CSS
  electron-browser/<feature>/…           window parts that need the native host
  common/<feature>/…
  test/browser/<feature>/*.test.ts
src/vs/workbench/services/kural/{common,browser,electron-browser}/<service>…   services several features share
```

Domains (platform): `base` (paths, private files, utf8, killtree, version), `ai` (providers: claude, codex, agy + gate,
ollama engine + tools, install, checks, usage, names, connectors), `chat` (conversation runtime, permissions, prompts,
guide, archive, attachments, checkpoints, handoff, slash, shortcuts, side chat, tickets), `router`, `split`, `devices`,
`browserAgent`, `voice`, `listen`, `enhance`, `review`, `rules`, `plugins`, `profiles`, `projects`, `updates`, `crash`.

Features (workbench): `chat`, `projects`, `settings`, `getStarted`, `usage`, `search`, `plugins`, `connectors`, `tab`,
`inlineEdit`, `fix`, `rules`, `review`, `explorer`, `scm`, `browser`, `lessons`, `voice`, `listen`, `devices`,
`profiles`, `account`, `updates`, `crash`, `whatsNew`, `removeData`, `settingsIO`, `workspaceColor`, `welcome`.

## 2. Processes

```
 main process (electron-main)
   ├─ frames: one OS window (BaseWindow) per frame, project views inside (WebContentsView per workbench)
   ├─ KuralHostStarter: starts the Kural host, hands each workbench a MessagePort
   └─ OS integration: notifications, updates' installer, crash scan, keep-awake
 Kural host (utility process, one for the app: vs/platform/kural/node/kuralHostMain)
   ├─ AI sessions: Claude Code / Codex / Antigravity processes, Kural's engine for Ollama
   ├─ permission policy, checkpoints, usage hub, Model Router, parallel agents, devices, MCP bridges
   └─ helpers: Tab's warm pools, Whisper and Supertonic workers
 workbench (renderer, one per project view)
   ├─ Kural's UI: chat, projects, settings, Tab Completion, Ctrl+K, …  (native workbench parts)
   └─ KuralHostClient: channels to the Kural host over a MessagePort
 extension host (one per workbench): third-party extensions only (and the legacy extension until it is gone)
```

Why a separate host: chats keep running while a window reloads or a project is switched; Kural never shares an event
loop with third-party extensions; usage, the warm Claude pools and the Tab helpers exist once for the app, not per window.

### Talking to the Kural host

- Like VS Code's pty host: the main process starts it with `UtilityProcess` (entry `vs/platform/kural/node/kuralHostMain`,
  added to the build's desktop entry points by a hook patch); a workbench asks for a port with
  `acquirePort('vscode:createKuralHostMessageChannel', 'vscode:createKuralHostMessageChannelResult')`.
- Each service is an `IChannel` (`ProxyChannel.fromService` / `ProxyChannel.toService`), named in
  `platform/kural/common/kuralHost.ts`. Events cross as `Event`s; long work returns promises and streams events.
- The host calls back into a workbench (permission cards, "save this unsaved editor", "is this chat on screen") through a
  channel the workbench serves on the same connection (`IKuralWorkbenchChannel`), identified by the workbench's
  window/view id.
- Every message is plain data (no URIs as classes: `UriComponents`), so it can be logged and tested.

### Data compatibility

The Kural host and the workbench use the legacy extension's places, so nothing is migrated:
- files: `<user data>/User/globalStorage/kural.kural/…` (chats, checkpoints, handoffs, images, local-chats, router,
  voice, listen, ssh key, claude-flags.json…), `~/.kural`, `~/.kural-shared`;
- state: the extension's globalState/workspaceState keys (`kural.chat.v4`, `kural.setup.v2`, `kural.usage.v1`, …) are
  read from the same storage the extension used (`IStorageService` application/workspace scope under the extension's
  key prefix, see `platform/kural/common/base/legacyState.ts`) and written back the same way while both exist;
- settings: the same `kural.*` keys and defaults, registered by core when the feature moves (and removed from
  `extension/package.json` in the same commit: a key registered twice is an error);
- commands, keybindings, context keys, view ids and colors: the same ids.

## 3. Conventions

- TypeScript, VS Code's style: tabs, `localize()` for UI text, services through DI (`createDecorator`,
  `registerSingleton`), `Disposable`/`DisposableStore`, `Event`/`Emitter`, `CancellationToken`. No npm dependencies.
- Kural's rules from CLAUDE.md still hold: no emoji, Codicons, "Kural" in UI text, "Tab Completion", plain words,
  no keychain (`ISecretStorageService` is not used), no unasked-for macOS folder prompts.
- Pure logic goes in `common/` or `node/` with unit tests; UI stays thin.
- A file that ported a legacy module says so in one line at the top (`// From extension/lib/ai/claude.js.`) until the
  legacy file is deleted, so a reviewer can compare.
- Tests: `test/{common,node,browser}/…/*.test.ts`, mocha `suite`/`test`, `ensureNoDisposablesAreLeakedInTestSuite()`.
  Run node tests with `npm run test-node -- --run <file>` in the built tree; the type check with
  `node_modules/.bin/tsc -p src/tsconfig.json --noEmit`.

## 4. Switching a feature over

A feature moves in one commit that:
1. adds its core code and tests (`src/vs/…/kural/…`);
2. registers its commands, settings, views and keybindings in core with the legacy ids;
3. deletes the legacy code and its `package.json` contributions and moves or deletes its `test/*.test.js`;
4. updates `CLAUDE.md`, `docs/wiki/` and the guide (`guide.js`, which moves into `platform/kural/common/chat/guide.ts`).

Until then the legacy extension runs the feature. While the chat is still legacy, core features that need it call the
legacy commands (`kural.chat.addContext`, …); once the chat is core they call `IKuralChatService`.

## 5. VS Code's own AI

VS Code 1.140 ships its chat, Copilot, an agent host (`vs/platform/agentHost`, Claude SDK/Codex/Copilot CLI agents) and the
"Agents" window (`vs/sessions`). Kural keeps them switched off (`chat.disableAIFeatures`, no default chat agent, the
GitHub probes removed) and does not build on them (PRD, Decisions). They stay in the tree, so VS Code updates stay small.
