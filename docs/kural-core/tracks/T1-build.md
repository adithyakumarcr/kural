# T1: Build ownership (no VSCodium)

PRD R1. Today `scripts/vscode/fetch.sh` takes VS Code at `vscode.lock` and, besides Kural's patches, clones VSCodium at
`vscodium_tag` and applies its 42+ patches, its JSON "remove" actions, its `src/stable` overlay (icons, resources), its
product.json values (`prepare_vscode.sh` setpath lines) and some text edits; `scripts/vscode/build.sh` follows VSCodium's
build environment (and its `undo_telemetry` step). Releases (`build.yml`) still download VSCodium's app (`codium.lock`) and
rebrand it with `scripts/rebrand.py`. After this track, Kural is built from Microsoft's source and Kural's own files only.

## You own
`scripts/vscode/**` (but keep `overlay.py`, `lint.sh`, `build-lock.sh` working; you may improve them), `product/**`,
`patches/kural/000[2-9]-*.patch` and `patches/kural/00[1-9][0-9]-*.patch` (Kural's branding/telemetry/gallery patches;
`0001-kural-core.patch` is the integrator's), `vscode.lock`, `codium.lock`, `build-mac.sh`, `make-deb.sh`, `build-win.sh`,
`install.sh`, `.github/workflows/**`, `scripts/update-codium.sh`, `scripts/update-electron.py`, `scripts/check-codium.sh`,
`scripts/electron_runtime.py`, `vendor/**`, `scripts/sbom.py`, `scripts/make-icons.py`, `installer/**`,
`scripts/linux-container/**`, `test/vscode-source.test.js`, `test/linux-container.test.js`, `test/build-*.test.js`,
`test/electron-runtime*.test.js`, `test/sbom*.test.js`, `test/installer*.test.js`, `test/update-*.test.js` (only the ones about
the build scripts), and new tests you add under `test/` named `build-*.test.js`.

Not yours: `scripts/rebrand.py` (track T2 owns it; it still runs after your build and still sets some product.json values:
keep what it does working, and list in your report which of its product edits now come from `product.kural.json`),
`patches/kural/01*`, `02*`, `03*`, `src/**`.

## Deliver
1. **The audit.** Every piece of VSCodium at the tag (each patch in `patches/`, `patches/<os>/`, `patches/user/`, the JSON
   actions, `src/stable`, the product.json values, `prepare_vscode.sh`'s text edits, `build.sh`'s environment,
   `undo_telemetry.sh`): keep (as a Kural patch or product value), replace, or drop, with one line of why. Kural must keep:
   telemetry off (also the `*.data.microsoft.com` addresses in dependencies), Open VSX as the gallery, no Microsoft
   branding/licence text or trademarks (VS Code's own product name strings come from product.json), no Microsoft account
   / GitHub sign-in at startup (keychain prompts: CLAUDE.md "Keychain prompts on the Mac"), extension signature checks
   that work with Open VSX, Kural's update addresses (Kural has its own updater: VS Code's updater off), the issue
   reporter to Kural's GitHub. Drop what only VSCodium needs (its announcements, its own update feed, codium names).
   Put the table in your report.
2. **Kural's patches** for what you keep, made against pristine VS Code (`scripts/vscode/fetch.sh --pristine`), with
   Kural's names written in (no `!!APP_NAME!!` placeholders), numbered `0002-…` onward, each small and named for what it
   does. They must apply in name order with every other patch in `patches/kural/`.
3. **`product/product.kural.json`** merged over VS Code's product.json by `fetch.sh` (replacing VSCodium's values):
   Kural's identity exactly as the current release has it, so an update keeps everyone's data, settings, logins and
   keychain item: compare with `/Applications/Kural.app/Contents/Resources/app/product.json` (read only) and with what
   `scripts/rebrand.py` writes. `nameShort`, `nameLong`, `applicationName`, `dataFolderName`, `darwinBundleIdentifier`
   (`com.kural`), `urlProtocol`, the Windows ids (`win32*`, mutexes), `linuxDesktopName`, `extensionsGallery` (Open VSX),
   `reportIssueUrl`, `licenseUrl`, `defaultChatAgent` (pointed at a provider that doesn't exist, as rebrand.py does), and the
   rest. Decide what `commit` should be (today: sha1 of VSCodium's version; it keys VS Code's extension caches) and say why.
4. **Icons and resources** that VSCodium's `src/stable` gave (app icons per system, the Windows/Linux resources): Kural's
   own, from `scripts/make-icons.py` / the repo's logo, under `product/` or a patch.
5. **`fetch.sh` without VSCodium** (no step 2, no step 4; `vscode.lock` without `vscodium_tag`), `build.sh` without
   VSCodium's names (keep the telemetry clean-up of dependencies as Kural's own step, and `--download-node`).
6. **Source builds only.** `build-mac.sh`, `make-deb.sh`, `build-win.sh`, `install.sh`: no download path, no
   `KURAL_SOURCE` switch (source is the only way; accept `KURAL_SOURCE=1` silently for old habits). Remove `codium.lock`,
   `scripts/update-codium.sh`, `scripts/check-codium.sh`; `electron_runtime.py` and `update-electron.py` read Electron's
   version from VS Code's own source (`.npmrc` `target=`), not from VSCodium's binary.
7. **CI.** `build.yml` builds all three systems from source (cache `node_modules` by the package-lock hashes; keep every
   existing check: install/start on Ubuntu 22.04 + 24.04, macOS, Windows, the signing, the release job).
   `build-from-source.yml` goes (or becomes a manual "try a new VS Code version" job). `upstream-check.yml` watches
   Microsoft's VS Code releases (new stable tag → `vscode.lock` → fetch → open a PR that says which patches don't apply).
8. **Tests** for the build scripts (update `test/vscode-source.test.js`, `test/linux-container.test.js`), and `npm test` passes.

## Check
- `scripts/vscode/fetch.sh` from scratch into a new folder: no request to VSCodium's repository (show the log).
- A full Mac build through the lock (`scripts/vscode/build-lock.sh env KURAL_SOURCE=1 ./build-mac.sh`); the app starts as a
  test copy; `grep -ri vscodium` over `build/mac/Kural.app/Contents/Resources/app/product.json` and the app's `out/nls.messages.json`
  finds nothing; About shows Kural; Extensions search reaches Open VSX; `--log trace` shows no `[mainThreadSecretState]` and no
  `GitHub Authentication.log`.
- If time allows: `scripts/linux-container/run.sh --platform linux/amd64 build` then `live` through the lock.
- NOT possible here: the Windows build and CI runs; say what you expect them to do.
