# T11a: App services in the editor (updates, crash reports, What's New, welcome, workspace color, settings export/import)

PRD R2, R4. Move these features from the legacy extension into Kural's code in the editor, and **switch them over**: the
core version runs, the legacy code is deleted. They don't need the AI, so they go first.

| Feature | Legacy | Where it belongs now |
|---|---|---|
| Updates (daily check, offer, download, checksum + signature check against Kural's release keys, install after quit, Mac swap, Ubuntu pkexec, Windows installer, the update log, `lastUpdate()` report) | `lib/updates.js`, `update-net.js`, `release-verify.js`, `release-keys.js`, `version-compare.js` (already ported: `common/base/versionCompare.ts`), `mac-swap.sh`, `install-deb.sh` | main process (`src/vs/platform/kural/electron-main/updates/`: it outlives the window, it starts the installer after every Kural process ended) + the workbench (offer, progress, Help → Check for Updates, the commands) |
| Crash reports | `lib/crash/{scan,index}.js` | main process (`electron-main/crash/`: the scan of macOS's reports and VS Code's logs at start) + workbench (the notification, "Kural: Show Crash Reports") |
| What's New | `lib/whats-new/*` | workbench: an editor with the release notes (no webview: render the notes as DOM, everything escaped, like its small markdown renderer did) |
| Welcome when the last editor closes | `lib/welcome.js` | workbench |
| Workspace Color | `lib/workspace-color.js` (+ `rebrand.py add_workspace_color_item`: track T2 moves that hook; use the command id it calls) | workbench |
| Settings export/import | `lib/settings-io.js` | workbench (dialogs, files, the extension management service for extensions); devices' part stays a call to the legacy command until devices move |

## You own
`src/vs/platform/kural/{common,node,electron-main}/{updates,crash}/**`, `src/vs/workbench/contrib/kural/{browser,electron-browser}/{updates,crash,whatsNew,welcome,workspaceColor,settingsIO}/**`,
their tests, the legacy files above and their tests (`test/updates*.test.js`, `audit-update-net`, `audit-release`,
`release-verify`, `mac-swap`, `crash-scan`, `whats-new`, `awake-welcome` (only the welcome part; keep-awake stays),
`workspace-color`, `settings-io`, `profiles-update`). For the switch-over you may also edit, minimally: `extension/extension.js`
(remove the lines that wire these features), `extension/package.json` (remove their commands, settings, menus,
keybindings: the same ids are registered by core), and add ONE import line to `kural.contribution.ts`.

## Rules
- Same command ids (`kural.checkForUpdates`, `kural.whatsNew`, `kural.showCrashReports`, `kural.settings.export`,
  `kural.settings.import`, `kural.workspaceColor`, …), same setting keys and defaults (`kural.updates.*`,
  `kural.welcomeWhenEmpty`, …), same state (the extension's globalState keys `kural.update.lastCheck`,
  `kural.update.pending`, `kural.whatsNew.seen`, … are in the application storage under the key `kural.kural`: read
  them from there (ARCHITECTURE §2), and keep writing them where the legacy code can still read them while both exist).
  Legacy code that calls these features keeps working through the commands.
- Security is exact: downloads only from this repository's releases, the SHA-256 checks, the signed checksum list with
  Kural's release keys (`release-keys.js`, both keys), the Mac swap's "never delete the live app without a checked copy",
  `verifiedCopy()` before pkexec, the update log. Port every test.
- The update's install script waits for every Kural process to end; with the Kural host (a utility process) and project
  views, check that its wait still covers all of them.
- What's New needs `RELEASE_NOTES.md`: today `rebrand.py` copies it into the extension's folder. Read it from there for
  now (`<app>/extensions/kural/RELEASE_NOTES.md`) and say in your report where it should live once the extension is gone.

## Check
Type check, lint, unit tests, `npm test`; a Mac build through the lock and a test copy: Check for Updates says there is
nothing newer (or offers the newest release; never install it), What's New opens, closing the last editor opens Welcome,
Workspace Color colors the activity bar, export then import settings round-trips; a crash report is made from a planted
unclean marker. NOT possible here: installing a real update over this machine's Kural; Windows and Ubuntu installers.
