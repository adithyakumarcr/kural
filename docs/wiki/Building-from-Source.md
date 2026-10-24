# Building from Source

Kural is VS Code with changes. Until now those changes were made on a finished VSCodium download. Kural can now also be
built from VS Code's own source, with its changes as patch files kept in this repository. This page says why, how to do
it, and what is still missing.

> [!NOTE]
> This is for people who build Kural themselves. If you only use Kural, nothing changes: the releases are still built
> from the VSCodium download. A Mac with Apple Silicon and Ubuntu (x64) can build from source; Windows can't yet.

## Why

The changes were made to VS Code's code after it was packed ("minified": names one or two letters long). A VS Code update
can move the place a change needs, and then the change quietly doesn't apply. Some things can't be changed there at all:
for example switching between projects without reloading needs VS Code's window handling.

Patches against the source are readable, can be made again against a new VS Code with Git, and a patch that no longer
fits stops the build. It is the way VSCodium itself builds VS Code, and the same idea as Cursor's own VS Code, but kept in
this repository.

## What it does

1. `vscode.lock` names the VS Code commit that VSCodium 1.140.06880 is built from.
2. `scripts/vscode/fetch.sh` fetches that commit and VSCodium's tag, applies Kural's patches (`patches/kural/`) first,
   then VSCodium's, and writes a `kuralSource` note into `product.json`.
3. `scripts/vscode/build.sh` compiles it.
4. The usual steps then run unchanged: the Electron runtime, `rebrand.py` (which skips the patches that now live in
   `patches/kural/`), renaming and signing.

## Build it

### On a Mac with Apple Silicon

```bash
./install.sh --source            # build from source and install
KURAL_SOURCE=1 ./build-mac.sh    # only the files in dist/
```

Or the steps one by one:

```bash
scripts/vscode/fetch.sh --dry-run    # shows what it would do, changes nothing
scripts/vscode/fetch.sh              # into build/vscode-src
scripts/vscode/build.sh darwin-arm64
```

| You need | Why |
|---|---|
| About 30 to 60 minutes | The first `npm ci` and the compile. Later builds reuse `build/` |
| Node at the version in VS Code's `.nvmrc` | VS Code's build asks for it |
| Python | VS Code's native modules |
| Xcode command line tools (`xcode-select --install`) | Compiling native modules and signing |
| Several GB of disk | The source, its `node_modules` and the result. `build/` can be deleted any time |

Without `--source` or `KURAL_SOURCE=1` nothing changes: the build downloads VSCodium and takes about a minute.

### On Ubuntu (x64)

```bash
./install.sh --source            # build from source, make the .deb and install it
KURAL_SOURCE=1 ./make-deb.sh     # only the .deb in dist/
```

`./install.sh --source` first asks apt for what the build needs (it asks for your password through `sudo`). Or the steps
one by one:

```bash
scripts/vscode/fetch.sh --dry-run    # shows what it would do, changes nothing
scripts/vscode/fetch.sh              # into build/vscode-src (VSCodium's linux patches included)
scripts/vscode/build.sh --download-node linux-x64
KURAL_SOURCE=1 ./make-deb.sh         # uses build/vscode-out/linux-x64; not compiled again when it is up to date
```

| You need | Why |
|---|---|
| About 30 to 60 minutes | The first `npm ci` and the compile. Later builds reuse `build/` |
| An x64 computer, Ubuntu 22.04 or newer | The .deb is for amd64. Build on the oldest Ubuntu it should run on (22.04): VS Code's native modules need the glibc they were built with |
| `sudo apt install build-essential pkg-config git python3 libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev` | The compiler and the libraries VS Code's native modules are built against |
| `curl`, `unzip`, `python3-pil` | The same as for the normal `./install.sh` |
| Node at the version in VS Code's `.nvmrc` | `build.sh --download-node` (and so `make-deb.sh`) keeps a checked private copy in `build/` |
| About 8 GB of memory and 20 GB of disk | The compile and `node_modules`. `build/` can be deleted any time |

`make-deb.sh` packages the app folder that `build.sh` made and writes the rest of the package (shell completions, the
workspace file type, the dependency list from VS Code's own `dep-lists.ts`) the way VS Code's own `.deb` task does. After
that it is the same as the normal build: the Electron runtime, `rebrand.py`, renaming, the .deb.

The manual workflow `Build from source (Mac and Ubuntu)` on GitHub does the same on an Ubuntu 22.04 runner (fetch, build,
`make-deb.sh`, install the .deb, open it on a virtual screen) and uploads the .deb as `linux-from-source`.

## The patches

| Files | What |
|---|---|
| `patches/kural/0100-0199` | Window management. `0100-one-frame-windows`: [[Projects]] switch in one frame, and dialogs of a hidden window. `0101-git-open-after-clone`: Git's Open after a clone opens a new window |
| `patches/kural/0200-0299` | The Projects bar's changes, moved from `rebrand.py`: no "You have not yet opened a folder" page, Projects first and always shown, the in-window card |

Kural's patches are made against Microsoft's untouched VS Code, not against VSCodium's changed copy, and are applied
before VSCodium's. To make one again after a VS Code update, apply it with `git apply --3way` and fix what Git marks.

## One frame

With the one-frame patch, every project still has its own window, so its chats keep running. But only one window is
visible. Opening or switching to a project puts its window exactly over the current one (same place, same size,
same full-screen), shows it once it has painted, and hides the old one instead of closing it. Nothing reloads and nothing
flashes. When you close the visible window the last hidden one comes back; a click on the Dock icon shows the last one;
Cmd+` switches.

A window that is hidden can't show a question. So when a hidden window needs a dialog (for example "Save changes?" when you
quit, or its "not responding" message), it takes the frame first and the dialog opens in it. Git's **Open** after a clone
(and after `git init`) opens the project in a new window too, instead of replacing the project in the window you're in.

Known gap: with native full screen on a Mac, each full-screen window has its own Space, so switching shows a Space change.
Setting `window.nativeFullScreen` to off gives a full screen without Spaces.

The setting `kural.window.oneFrame` (on by default) turns it off. In a Kural built from the VSCodium download, projects
open as before ([[Projects]]).

## What isn't checked yet

- In a running app: a hidden window's dialogs, Git's Open after a clone, native full screen, Show Next/Previous Window.
  (Switching and closing were checked in the Mac build on 24 Oct 2026 with `node test/one-frame.live.js`: one window
  shown at a time, same place and size, no flash, closing the shown one shows the last hidden one.)
- The manual CI workflow (`build-from-source.yml`), both jobs.
- The Ubuntu build itself. Its scripts and the patch set were checked (VSCodium's linux patches apply after Kural's), but
  no full Linux build has been run yet.
- Windows: it still uses the VSCodium download. It needs a Windows build runner, so it comes last.

The design, the options that were rejected and the risks (build time, the monthly VS Code update, disk space) are in
`docs/superpowers/specs/2026-10-24-vscode-source-build-design.md`.
