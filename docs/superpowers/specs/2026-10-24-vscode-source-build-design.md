# Building VS Code from source, and one-frame windows: design

Date: 24 Oct 2026. Decided by Adithya in chat: move toward Cursor's way, but in this same repo.

## Goal

Kural changes VS Code's own code through patches that are checked in and built from source, instead of editing the
minified files of a finished VSCodium download.

The first thing it buys: switching between projects without the close-and-reopen flash. Done when: opening or switching
to a project shows that project's window in the same place, at the same size, with nothing reloading, and the chats in
the window you left keep running.

## Why

Today `scripts/rebrand.py` turns a VSCodium download into Kural. Many of its patches change the **minified**
`workbench.desktop.main.js` and a few other bundles. They find their place by the shape of the code ("the object that
has these three calls"), because the names are one or two letters long and change with every build.

- Every VS Code update can move a shape. A miss gives a `::warning::` and the feature quietly goes away (the Projects bar
  alone has four such patches). Each monthly update means checking every patch by hand.
- Some things can't be done there at all. Switching a window to another folder in place restarts the window and stops
  its chats, which is why the Projects bar brings other windows forward and why opening a Recent project from a window
  that is working has to ask first. Fixing that means changing the main process (the windows, their bounds, their
  full-screen state), which is not in the workbench bundle at all.
- A patch against readable source has names, types and a compiler. A change that no longer fits fails the build, loudly.

## Options considered

| Option | What it is | Why not / why |
|---|---|---|
| 1. Keep patching VSCodium's download | What `rebrand.py` does now | Minified code is the problem above. The main process can't be reached cleanly |
| 2. Patches against source, in this repo | Fetch VS Code at one commit, apply `patches/kural/*.patch`, then VSCodium's own patches, then compile | **Chosen** |
| 3. A full copy of VS Code in a second repo, like Cursor | A long-lived fork, merged with upstream by hand | The most freedom, and the most work: every month a merge with conflicts in a repo that is millions of lines. Two repos to keep in step. Not needed for the size of Kural's changes |
| 4. From scratch | Not VS Code | Out of the question: Kural is VS Code, and its users keep their extensions, themes and settings |

Option 2 is how VSCodium itself works: its repo has no copy of VS Code either, only a script that downloads one commit
and a folder of patches. Kural does the same one level up. A patch is a few lines of diff that says what changed and
why, can be re-made against a new commit with `git apply --3way`, and a failure shows which file moved.

## The choice

Kural builds VS Code at the **exact commit that VSCodium 1.140.06880 is built from** (the `commit` in the installed
app's `product.json`). Then:

1. Kural's patches (`patches/kural/NNNN-name.patch`) are applied **first, in name order**. They are made against the
   pristine VS Code source, so they read the same as they would in a fork.
2. VSCodium's patches at its tag are applied after. They rename, switch off telemetry and set up VSCodium's
   marketplace, as they do today.
3. VS Code is compiled.
4. `electron_runtime.py`, `rebrand.py`, the renaming and the signing run on the result, **unchanged**. `rebrand.py`
   stays: its patches that haven't moved to source yet keep working on the compiled bundle.

Why Kural's patches go first: they are made against a source anyone can fetch (Microsoft's), not against a source
VSCodium has already changed. A patch made against pristine VS Code keeps fitting when VSCodium changes its own patches.
The cost: where the two touch the same lines, VSCodium's patch can fail after ours. The build says which one, and then
Kural's patch is changed (a patch near VSCodium's lines is a sign it should be smaller).

## Layout

| Path | What |
|---|---|
| `vscode.lock` | Keys `vscode_version`, `vscode_commit`, `vscodium_tag` (`1.140.06880`). Pins which VS Code commit is built. Like `codium.lock`, changed by a script and reviewed in a pull request |
| `scripts/vscode/fetch.sh [--dry-run] [dest]` | Fetches the commit (default `build/vscode-src`) and VSCodium's tag, applies the patches, writes `kuralSource` into product.json. `--dry-run` prints the steps and changes nothing |
| `scripts/vscode/build.sh <darwin-arm64\|linux-x64\|win32-x64>` | `npm ci`, then gulp `vscode-<platform>-min` |
| `patches/kural/` | Kural's patches. Ranges: **0100-0199** window management, **0200-0299** the Projects bar's ports from `rebrand.py` |
| `.github/workflows/build-from-source.yml` | Manual, macOS: tries the source build. Not part of `build.yml` |
| `build/` | Where the source and its output go (default `build/vscode-src`). Not for Git |

**The marker.** `fetch.sh` writes `"kuralSource": {"commit": "<vscode commit>", "patches": ["0100-one-frame-windows",
...]}` into the source's product.json. It is the only way later steps know what they are working on:

- `rebrand.py` skips each of its patches that is listed in `kuralSource.patches` (it must never patch a thing twice, and
  the source patch is the one that counts).
- The Projects bar asks the running app (below), not product.json, but the marker is what you read in a bug report.

A build from the VSCodium download has no `kuralSource`, and everything works as it does today.

## Build flow

```
vscode.lock ──► fetch.sh ──► build/vscode-src (VS Code at the commit)
                               + patches/kural/*.patch      (in name order)
                               + VSCodium's patches         (at its tag)
                               + product.json kuralSource
                          ──► build.sh darwin-arm64  (npm ci, gulp vscode-darwin-arm64-min)
                          ──► electron_runtime.py ──► rebrand.py ──► rename ──► sign
```

On a Mac: `KURAL_SOURCE=1 ./build-mac.sh` or `./install.sh --source`. Without either, `build-mac.sh` downloads VSCodium
as before.

**What it needs.** About 30-60 minutes (the first `npm ci` and the compile; later runs reuse `build/`), Node at the
version in VS Code's own `.nvmrc`, Python, and Apple's command-line tools (`xcode-select --install`). Disk: the source,
its `node_modules` and the compiled output come to several GB.

## One-frame windows (patch 0100-one-frame-windows)

**Problem.** One window per project is right: each window owns its chats, so they keep running. But switching means
bringing another window forward, and a Recent project opens in *this* window, which reloads it and stops its chats, so
Kural asks first. Either way the screen flashes: a window closes, another opens somewhere else.

**Idea.** Keep one window per project, and show only one of them. All windows share one **frame**: the place on screen,
the size and the full-screen state.

| When | What happens |
|---|---|
| Open or switch to a project | Its window is put exactly over the current one: same bounds, same full-screen state. It is shown **once it has painted**. Then the old one is **hidden**, not closed |
| The hidden window | Stays alive. Its chats, terminals and servers keep running. Nothing in it reloads |
| Close the visible window | The last hidden one is shown (same frame) |
| Click the Dock icon | Shows the last window that was in front |
| Cmd+` | Switches between the project windows (VS Code's own window switch, but into the same frame) |

Why "show once painted, then hide the old one": hiding first would show the desktop for a moment; showing the new one
before it has painted would show a white window. Between the two the user sees the old window, then the new one, in the
same place.

**Switch.** The setting `kural.window.oneFrame` (default **true**) turns it off. The workbench command
`_kural.oneFrame` answers `{enabled: boolean}`: the patch is there, and the setting is on.

**The Projects bar** (`lib/projects/index.js`) asks `_kural.oneFrame` when it needs it:

| `_kural.oneFrame` | A project that isn't open (Recent, a pin, Open folder, New empty project) |
|---|---|
| exists, `enabled: true` | Opens with `forceNewWindow: true`. No "Open Here?" question: nothing stops, nothing reloads |
| missing, or `enabled: false` (a VSCodium-based build, or the setting is off) | Today's behaviour: this window is reused (`forceReuseWindow`), and Kural asks first while a chat here is working or waiting |

A project that is open still comes forward as before (`vscode.openFolder` with `forceNewWindow` finds its window); with
the patch, that is the placement above.

**Hidden windows in the status files and notifications** (settled by patch 0100): a hidden window isn't closed, so its
extension host (a process of its own) keeps running, and with it `lib/projects/status.js`'s 60-second heartbeat; the
window stays "alive" (not `closed`, `seen` within 3 minutes) and stays under Open. The patch also creates frame windows
with `backgroundThrottling: false`, so the hidden page isn't slowed either. A hidden window never has focus, so a chat
finishing there counts as "away": its notification goes to the visible window as the in-window card (`cardElsewhere`),
and the card's "Go to" brings the hidden window into the frame through `openFolder`, which the patch turns into a swap.
Not checked in a running app yet.

## Order of work

1. **Mac, first.** The foundation (`vscode.lock`, `fetch.sh`, `build.sh`, `KURAL_SOURCE`, `kuralSource`), then patch 0100
   and the Projects bar's use of it. Ubuntu and Windows keep the VSCodium download meanwhile, and `build.yml` does not
   change.
2. **Port the Projects bar's `rebrand.py` patches** (0200-0203): `drop_explorer_empty_view`, `projects_default_view`,
   `projects_always_shown`, `add_in_window_card`. `rebrand.py` skips each one listed in `kuralSource.patches`.
3. **Port the other `rebrand.py` patches one by one**, each with its own test; the order is chosen by how often a
   patch broke. A ported patch is removed from `rebrand.py` only when all three systems build from source.
4. **Ubuntu** (`make-deb.sh`): the same `fetch.sh` and `build.sh linux-x64`, built on a Linux runner.
5. **Windows**: `build-win.sh` runs on Linux today and unpacks a download. Compiling VS Code for `win32-x64` needs
   Windows, so this needs a **Windows CI runner**. Last.
6. When all three build from source and a normal CI run passes, `build.yml` switches over and the VSCodium download is
   only a fallback.

## Risks

| Risk | What we do |
|---|---|
| **Build time.** 30-60 minutes against about a minute now | Only the source build is slow; `build/` is reused; `install.sh --ext` (extension only) is unchanged. CI's source build is manual until it is proven |
| **Monthly VS Code updates.** Patches must be re-made against the new commit | One commit per update: bump `vscode.lock`, run `fetch.sh`, fix the patches that fail (`git apply --3way`). A failure is loud, which is the point. `upstream-check.yml` (weekly) could do the first two steps later; not planned yet |
| **VSCodium's patches fail after ours** | The build names the patch. Make ours smaller or move the change |
| **Disk space.** Several GB for `build/` | `build/` is not for Git and can be deleted at any time |
| **Two ways to build for a while** (download and source) | `kuralSource` tells which one a build is. `rebrand.py` handles both. Dropping the download is step 6 |
| **Signing and the checksum list.** product.json `checksums` cover the core files; a source build computes its own | `rebrand.py`'s `add_update_menu()` and the other patches that rewrite a checksum still do, on whichever file they touch |
| **Hidden windows cost memory** | Each project window keeps its renderer. The same as today's one window per project, but none of them closes by itself. Closing a project's window (the red cross) still ends it |

## What is not checked yet

Written 24 Oct 2026, before the code exists or runs:

- The one-frame windows in a running app: the bounds, full-screen, painting before showing, the Dock click, Cmd+`,
  closing the visible window.
- Ubuntu and Windows (not started), and the manual CI workflow.

Checked on a Mac on 24 Oct 2026: `fetch.sh` against the real VSCodium tag (its 42 patches apply after Kural's five), the
type check (no errors beyond VS Code 1.140.0's own eight in its test files), `KURAL_SOURCE=1 ./build-mac.sh` (rebrand.py
skips 0200-0203, no warnings) and a start of the built app with a throwaway profile.
- The patch's effect on the Projects bar's status files (hidden windows publishing).

This page is updated as each one is checked.
