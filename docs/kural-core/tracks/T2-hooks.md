# T2: Workbench hooks (rebrand.py's edits of minified code, as source)

PRD R2.2. `scripts/rebrand.py` changes VS Code's built output, found "by shape" in minified code (`workbench.desktop.main.js`,
`out/mainImpl.js`, the webview `pre/` files, `out/nls.messages.json`), and rewrites product.json `checksums`. Each VS Code
update can break any of them silently (`::warning::`). With the source build, each becomes either **Kural code** in `src/`
(preferred: a contribution, a menu item, a command, a service) or **a small source patch** in `patches/kural/03NN-name.patch`
made against pristine VS Code (when VS Code's own code must change). Then the function leaves `rebrand.py`.

## You own
`scripts/rebrand.py`, `patches/kural/03*.patch`, `test/rebrand-*.test.js`, new `test/patch-*.test.js` for your patches,
`src/vs/workbench/contrib/kural/*/hooks/**`, `src/vs/platform/kural/*/hooks/**` and their tests
(`src/vs/*/kural/test/**/hooks/**`). You may add ONE import line to
`src/vs/workbench/contrib/kural/electron-browser/kural.contribution.ts` (for `./hooks/hooks.contribution.js`).

Not yours: `patches/kural/00*`, `01*`, `02*` (the Projects bar's four, 0200-0203, are already source patches: leave them),
`product/**` and the build scripts (track T1: it removes VSCodium; `drop_vscodium_welcome` and the "VSCodium" word
replacement in `rebrand_messages` are about VSCodium's own content, which won't exist once T1 lands. Check what VSCodium
added, and drop those two only when T1's audit removes the source of what they fix; say so in your report), `extension/**`.

## The functions (scripts/rebrand.py)
| Function | What it does today | Likely new home |
|---|---|---|
| `add_update_menu` | Help → Check for Updates… (runs `kural.checkForUpdates`) | Kural code: `MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, …)` |
| `hide_builtin_views` | VS Code's Search view and Output view never show | patch (their `when`) or Kural code; keep Edit → Find in Files working with Kural's keybindings |
| `route_browser_to_kural` | Integrated Browser's "Add to Chat" → `kural.browser.attach`; the picked element's comment; the chat gate (`G.enabled`) | patch on `src/vs/workbench/contrib/browserView/…` |
| `hide_debug_views` | Run and Debug, Debug Console, Ports hidden unless `kural.showDebugViews` (debug ones also in debug mode) | patch (views' `when`) |
| `add_plugins_tab` | Extensions side bar's tabs: Extensions / Plugins / Connectors, `_kural.extensionsTabs`, layout fixes | patch in `contrib/extensions/browser/extensionsViewlet.ts` (largest: read `test/rebrand-plugins-tab.test.js` and CLAUDE.md "Extensions \| Plugins" and "UI clean-up of 22 Oct 2026") |
| `add_os_toast` | `_kural.osToast` / `_kural.osToastClear` commands (system notifications through the host service) | Kural code (`IHostService` / `INativeHostService`) |
| `add_workspace_color_item` | "Workspace Color..." in the activity bar's context menu | patch (`getActivityBarContextMenuActions`) |
| `skip_github_probe` | dictation service doesn't ask for GitHub sessions (keychain prompt) | patch |
| `terminal_suggest_prefix` | terminal suggestions match from the start (issue #106) | patch (`SimpleCompletionModel`) |
| `fresh_browser` | the Integrated Browser keeps nothing (`ephemeral` storage) | patch |
| `webview_microphone`, `patch_webview_pre_text`, `patch_main_permissions_text` | microphone for Kural's chat webview only | patches (the CSP hash is computed by the build from source: check) |
| `small_edit_box` | Ctrl+K's comment box starts 2 lines tall | patch |
| `rebrand_messages` | nls: "VSCodium" → "Kural"; "Editing evolved · v…" version line on the Welcome page | product name from T1; the version line as a patch or Kural code |
| `drop_vscodium_welcome` | VSCodium's announcements and walkthrough off the Welcome page | gone with VSCodium (T1), see above |
| `main` step 4 | Git's Ctrl+K keybindings moved to Ctrl+Alt+K (extensions/git/package.json) | patch |

Each function's test (`test/rebrand-*.test.js`) says exactly what must hold; CLAUDE.md has the background of each. Keep the
behaviour identical. `rebrand.py` keeps steps 1-3 and 5 (product values, package.json name, copying the extension and
license, logos) for now: T1 and the integrator take those over.

## Deliver
1. Each function moved (Kural code or a patch), removed from `rebrand.py` with its fingerprint/checksum code once nothing
   needs it (no more `checksums` rewriting if no function edits checksummed files).
2. Tests: each `test/rebrand-*.test.js` replaced by a test of the new home (a patch: applies to pristine VS Code in order
   with the other patches, and the patched source says what it must, like `test/patch-projects-source.test.js`; Kural
   code: a unit test under `src/vs/**/kural/test/**/hooks/`).
3. The patches and Kural code pass the type check and `scripts/vscode/lint.sh`; `npm test` passes.

## Check
A full Mac build through the lock, then a test copy: Help menu has Check for Updates…; the Search and Output views are
gone, Kural's Search & Ask works with Cmd+Shift+F; Run and Debug hidden (and back with the setting); the Extensions side
bar shows Extensions | Plugins | Connectors; `_kural.osToast` shows a notification; the activity bar's context menu has
Workspace Color...; Ctrl+K's box is small; the Integrated Browser's Add Element to Chat puts a pill in Kural's chat.
Use CDP to check what you can, and list what you could not click.
