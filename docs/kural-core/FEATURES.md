# Kural Core: feature map

Every legacy file and where it goes. `P:` = `src/vs/platform/kural/<layer>/<domain>/`, `W:` =
`src/vs/workbench/contrib/kural/<layer>/<feature>/`. Status: legacy (runs in `extension/`), ported (core code exists, not
switched on), core (switched over, legacy deleted).

| Feature | Legacy files | Target | Track | Status |
|---|---|---|---|---|
| Shared base | `lib/paths.js`, `private-file.js`, `private-data.js`, `utf8.js`, `ai/killtree.js`, `version-compare.js`, `version.js`, `log.js`, `workspace.js` (workDir) | P: `base` | M1 | legacy |
| Providers | `lib/ai/{index,claude,claude-checks,claude-setup,codex,agy,agy-gate,agy-gate-host,clis,engine,tools,ollama,ollama-install,install,danger,model-policy,names,usage,usage-switch,connectors,connectors-off,connector-catalog}.js` | P: `ai` | T4 | legacy |
| Model Router | `lib/router/*` (words-model.json, examples.json as data) | P: `router`; panel W: `router` | T5, T8 | legacy |
| Parallel agents | `lib/split/*`, `lib/git.js` | P: `split`; plan card W: `chat` | T5, T6 | legacy |
| Devices | `lib/devices/*` | P: `devices`; UI W: `devices` | T5, T11 | legacy |
| Chat runtime | `lib/chat/{index,permission-policy,prompts,guide,archive,attachments,changes,handoff-store,fork,project,trim,slash,shortcuts,side,tickets,atlassian,notify,awake}.js`, `router/journal.js` | P: `chat` (host service) | M4 | legacy |
| Chat UI | `media/chat*.js`, `chat.css`, `markdown.js`, `timeline.js`, `choices.js`, `side.js`, `split.js`, `voice.js`, `listen.js`, `mermaid-view.js`, `mermaid/`; `lib/chat/tab-editor.js` | W: `chat` | T6 | legacy |
| Projects bar | `lib/projects/*`, `media/projects.*` | P: `projects` (main), W: `projects` | T7 | legacy |
| One window, many projects | `patches/kural/0100`, `0101` | P: `frames` (electron-main) + hooks | T3 | legacy (patch) |
| Kural Settings | `lib/settings-page.js`, `media/settings.*`, `lib/account.js` | W: `settings`, `account` | T8 | legacy |
| Get started | `lib/getstarted.js`, `media/getstarted.*` | W: `getStarted` | T8 | legacy |
| AI Usage, Tab panel, Router panel | `lib/usage-panel.js`, `lib/tab/panel.js`, `lib/router/panel.js` | W: `usage`, `tab`, `router` | T8 | legacy |
| What's New, welcome | `lib/whats-new/*`, `lib/welcome.js` | W: `whatsNew`, `welcome` | T8 | legacy |
| Tab Completion | `lib/tab/{completion,local,activity,rename,rename-offer}.js` | P: `tab` (pools, Ollama FIM), W: `tab` | T9 | legacy |
| Terminal Tab | `lib/tab/terminal.js` | W: `tab` (terminal suggest provider) | T9 | legacy |
| Ctrl+K, selection buttons, Quick Question | `lib/edit/*` | W: `inlineEdit` | T9 | legacy |
| Fix with Kural | `lib/fix/*` | W: `fix` | T9 | legacy |
| Explorer activity | `lib/explorer/*` | W: `explorer` | T9 | legacy |
| Commit message | `lib/scm/commit.js` | W: `scm` | T9 | legacy |
| Search & Ask | `lib/search/*`, `media/search*` | W: `search` | T10 | legacy |
| Plugins, Connectors | `lib/plugins/*`, `lib/connectors/*`, `media/plugins*`, `connectors*`, `plugin-details.js` | P: `plugins`, W: `plugins`, `connectors` | T10 | legacy |
| Rules | `lib/rules/*` | P: `rules`, W: `rules` | T11 | legacy |
| Agent Review | `lib/agent-review/*` | P: `review`, W: `review` | T11 | legacy |
| Debug mode | `lib/debug/server.js` | P: `chat` (debug log server) | T11 | legacy |
| Browser, the AI in it | `lib/browser/*` | P: `browserAgent`, W: `browser` | T11 | legacy |
| Lessons | `lib/learn/*`, `media/lesson.*` | P: `chat` (lesson server), W: `lessons` | T11 | legacy |
| Voice input | `lib/voice/*` | P: `voice`, W: `chat` (record) | T11 | legacy |
| Listen | `lib/listen/*` | P: `listen`, W: `chat` (player) | T11 | legacy |
| Enhance prompt | `lib/enhance/*` | P: `enhance` | T11 | legacy |
| Profiles | `lib/profiles/*` | P: `profiles`, W: `profiles` | T11 | legacy |
| Updates, release check | `lib/updates.js`, `update-net.js`, `release-*.js`, `mac-swap.sh`, `install-deb.sh` | P: `updates` (main + node) | T11 | legacy |
| Crash reports | `lib/crash/*` | P: `crash` (main) | T11 | legacy |
| Remove Kural's data | `lib/remove-data/*` | P: `removeData`, W: `removeData` | T11 | legacy |
| Settings export/import | `lib/settings-io.js` | W: `settingsIO` | T11 | legacy |
| Workspace color | `lib/workspace-color.js` | W: `workspaceColor` | T11 | legacy |
| Font size | `lib/ui.js` | W: `chat` | T5 | legacy |
| Themes | `themes/*` (made by `scripts/make-themes.py`) | `extensions/theme-kural` (built-in theme extension) | M5 | legacy |
| `rebrand.py` workbench edits | 20 functions (update menu, hidden views, debug views, plugins tab, OS toast, workspace color item, GitHub probe, terminal suggest prefix, fresh browser, webview microphone, small edit box, browser routing, messages, VSCodium welcome, Projects' four) | `patches/kural/03*` or Kural code | T2 | legacy |
| VSCodium | `codium.lock`, downloads, `fetch.sh` steps 2 and 4 | `product/`, `patches/kural/00*` | T1 | legacy |
