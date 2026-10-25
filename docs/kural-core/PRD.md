# Kural Core: product requirements

Status: agreed direction (Adithya, 24 Oct 2026: "Kural is no more an extension of VS Code, it becomes an integral part of it";
"the one thing I still need from them is VS Code's extensions"). Owner of the decisions below: the implementing agent, as asked.

## 1. Problem

Kural today is VSCodium's ready-made app, renamed by `scripts/rebrand.py`, plus one built-in extension (`extension/`: ~180
files, 2.25 MB of JavaScript/CSS). That shape limits the product:

| Limit | Where it shows |
|---|---|
| The extension API decides what Kural can do | Proposed APIs (5), webviews for every page, no control of windows, title bar, layout or menus |
| Anything beyond the API is a patch on minified code | 20 `rebrand.py` functions found "by shape"; each VS Code update can break them silently (`::warning::`) |
| One OS window per project | Switching projects is a trick: stacked windows, one hidden (`0100-one-frame-windows`), Space jumps, flashes |
| Everything runs in the shared extension host | A busy third-party extension slows Kural's chat; Kural's chats stop when a window reloads |
| VSCodium is in the chain | Its download, its patches and its product values; Kural can't change what VSCodium decided |
| UI in iframes | The chat, Settings, Get started, Search & Ask, Plugins are webviews: CSP work, no native focus/keyboard, microphone patches |

## 2. Goal

Kural is an independent editor, built from Microsoft's open-source VS Code ("Code - OSS", MIT), like Cursor. Kural's
features are part of the editor's own code. The only thing kept from VS Code's ecosystem is **its extensions**: any VS Code
extension from Open VSX installs and runs as it does in VS Code.

## 3. Users and what they must notice

People who use Kural today. After the move they must notice only improvements:

1. Every feature in `extension/lib/chat/guide.js` still works, with the same commands, shortcuts and setting names (`kural.*`).
2. Their chats, History, checkpoints, settings, logins, devices, shortcuts, preferences and Tab learning are all still there
   (same data folders: `<user data>/User/globalStorage/kural.kural/…`, same globalState keys, same `~/.kural`).
3. Switching projects is instant, in one OS window, with nothing reloading and every chat still running.
4. No new permission prompts (macOS keychain, folders, microphone only when recording).
5. Third-party extensions work (Open VSX), including their views, commands, languages, debuggers and themes.

## 4. Requirements

### R1. Independent build (no VSCodium)
- R1.1 Kural is built from Microsoft's VS Code source at a pinned commit (`vscode.lock`), on macOS (arm64), Ubuntu (x64) and
  Windows (x64), locally and in CI.
- R1.2 Nothing is downloaded from or cloned from VSCodium. The things VSCodium's patches did that Kural needs are Kural's own:
  telemetry off, Open VSX gallery, no Microsoft branding or licence, Kural's update/issue/feedback addresses, no Microsoft
  accounts or Copilot sign-in prompts.
- R1.3 Kural's product identity (`product.json`): names, bundle id `com.kural`, data folder, URL protocol, Windows app ids,
  exactly as the current releases have them, so an update keeps everyone's data and logins.
- R1.4 Releases (`build.yml`) and `./install.sh` use the source build only. `codium.lock`, the VSCodium download paths and
  `rebrand.py`'s edits to minified code are gone.

### R2. Kural is part of the editor
- R2.1 Kural's code is TypeScript in VS Code's source tree, under Kural's own folders (`src/vs/platform/kural/…`,
  `src/vs/workbench/contrib/kural/…`, `src/vs/workbench/services/kural/…`), kept in this repository under `src/`.
- R2.2 Changes to VS Code's own files are small, numbered hook patches (`patches/kural/`), never edits to built output.
- R2.3 UI is native workbench UI (view panes, editors, parts, status bar items, menus, quick picks), not webviews, except
  where a page shows untrusted content (a lesson page, a web page).
- R2.4 The AI work (Claude Code, Codex, Antigravity, Ollama processes, permissions, usage, Model Router, parallel agents,
  devices, connectors' helpers) runs in **the Kural host**, a Node utility process of the app, like VS Code's pty host:
  one for the whole app, reached from every window over MessagePorts, independent of the extension host.
- R2.5 The legacy extension shrinks feature by feature and is deleted at the end.

### R3. One window, many projects
- R3.1 One OS window (the frame) shows one project at a time; every open project is a full workbench inside it (an Electron
  `WebContentsView`), with its own extension host. Switching swaps the view: no window is hidden, moved or reloaded.
- R3.2 A project can be moved into its own window (second monitor); the frame logic is per window.
- R3.3 The Projects bar is native and reads projects and chats from the main process / Kural host, not status files.
- R3.4 Full screen, dialogs, the dock/taskbar, Cmd+` / Ctrl+Alt+. and quitting behave like one normal window.

### R4. Every feature moves
The features (see `docs/kural-core/FEATURES.md` for the full list with their current files and target homes): chat
(tabs, modes, models, columns, chat editors, queue, timeline, questions, side chat, fork/edit/restore, notifications,
History), parallel agents, Model Router, usage meter and AI Usage, Get started, Kural Settings, profiles, account,
connectors, plugins, Search & Ask, Tab Completion (editor, terminal, plain words, rename offer, learning), Ctrl+K and the
selection buttons, Quick Question, Fix with Kural, Rules, Agent Review, Debug mode, devices, Kural's browser and the AI in
it, Design Mode, lessons, voice input, Listen, Enhance prompt, shortcuts and "/", commit messages, Explorer activity,
crash reports, updates, What's New, Remove Kural's data, settings export/import, workspace color, welcome, themes,
notifications, keep-awake, the GitHub/keychain protections.

### R5. Extensions
- R5.1 VS Code's extension host, extension API and Extensions view are kept unchanged; the gallery is Open VSX.
- R5.2 Kural no longer needs proposed APIs itself; it does not remove any API extensions use.
- R5.3 Microsoft's chat, Copilot, the agent host and the "Agents" window stay switched off (as today:
  `chat.disableAIFeatures`, no default chat agent); they don't sign in to GitHub and don't read the keychain.

### R6. Quality
- R6.1 Kural's core code passes VS Code's own TypeScript check (`tsc -p src/tsconfig.json`) and ESLint on its files.
- R6.2 Unit tests live next to the code (`test/{common,node,browser}/*.test.ts`) and run with VS Code's test runner; every
  existing `test/*.test.js` either moves with its feature or stays until the legacy code it covers is gone.
- R6.3 Each step leaves an app that builds, starts and works: the legacy extension keeps the features not moved yet.
- R6.4 Security properties stay: permission policy, private folders, the agy gate, browser publishing rule, tokens over
  private sockets, untrusted-workspace behaviour, no `context.secrets`/keychain reads.

## 5. Non-goals (now)
- Removing Microsoft's chat/agent-host code from the source tree (switched off is enough; deleting it would make every
  VS Code update a large merge). Revisit once Kural's own stack is complete.
- A web or remote-server build of Kural.
- New features during the move (the move itself is the feature), except what R3 needs.
- Microsoft's Marketplace and Microsoft-only extensions (Pylance, C# Dev Kit, Remote SSH, Live Share, Copilot): their
  licences forbid other products.

## 6. Decisions (and why)

| Decision | Why |
|---|---|
| Own VS Code source build, not "from scratch" | 10+ years of editor work for free; Cursor and Windsurf do the same |
| Kural's code as normal files in `src/` + small hook patches, not one big patch, not a full fork repo | One repository (Adithya); Kural's code reads like code, not diffs; a VS Code update touches only the hooks |
| Kural's own stack, not VS Code's chat + agent host | VS Code's chat is tied to Copilot/GitHub sign-in (keychain prompts), changes every release, and its UX isn't Kural's |
| A Kural host utility process | Chats survive window reloads and project switches; no shared extension host with third-party code; one usage hub and one set of helpers for the whole app |
| `WebContentsView` per project in one frame | The only way to get one OS window with instant switching and no restart; a browser does it the same way |
| Feature by feature, shipping at every step | 2.25 MB of code: a big-bang rewrite would be untestable for weeks |
| Same command ids, setting keys and data folders | Users' keybindings, settings and data keep working with no migration step |
| TypeScript with VS Code's conventions (DI services, Disposables, `localize`) | Type safety for a codebase this size; the build's mangler and bundler expect it |

## 7. Success criteria
1. `./install.sh` builds Kural from source with no VSCodium file or URL involved; CI builds and starts all three systems.
2. The legacy `extension/` folder and `rebrand.py`'s minified patches are gone; every feature in the guide works.
3. Switching between two open projects shows the other one in under 100 ms, one OS window throughout, chats running.
4. A user's existing data (chats, settings, logins, devices) is there after updating.
5. Popular Open VSX extensions (a language server, a theme, a linter, a debugger) install and work.

## 8. Risks
- Size: the move is weeks of work. Mitigation: tracks with separate file ownership, the legacy extension as the fallback.
- VS Code updates: hooks and the window change need updating each release. Mitigation: few, small hook patches; the
  window work isolated in Kural's own classes.
- Electron views: VS Code assumes one `BrowserWindow` per workbench (17 lookups in 9 files), its Integrated Browser and
  auxiliary windows too. Mitigation: a `CodeWindow` abstraction that keeps its interface; checked live per system.
- Not everything can be checked here: Windows and real accounts for Codex/Gemini. Mitigation: CI and the container; listed
  as NOT checked where true, as today.
