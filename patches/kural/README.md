# Kural's patches to VS Code

Source patches for the build from source (`scripts/vscode/`). `fetch.sh` applies every `*.patch` here, in name order, with
`git apply`, on **pristine VS Code** (the commit in `vscode.lock`), before VSCodium's own patches. So a patch here must
not rely on anything VSCodium changes, and VSCodium's patches have to apply on top of it (`fetch.sh` stops with the name
of the patch that doesn't).

## Numbers

| Range | What |
|---|---|
| 0100-0199 | window management (one-frame windows) |
| 0200-0299 | the Projects bar's ports of `scripts/rebrand.py` patches |

Name a patch `NNNN-what-it-does.patch`. Its name goes into the app's `product.json` (`kuralSource.patches`), and
`rebrand.py` skips the patches that are already in the source when `kuralSource` is there.

## Making a patch

1. `scripts/vscode/fetch.sh --pristine`: pristine VS Code in `build/vscode-pristine` (a git checkout of the lock's commit).
2. Building on an earlier patch? Apply the ones below your number first: `git -C build/vscode-pristine apply ../../patches/kural/0101-*.patch`,
   then `git -C build/vscode-pristine add -A`, so your diff holds only your change.
3. Edit the files in `build/vscode-pristine`.
4. `git -C build/vscode-pristine diff > patches/kural/NNNN-name.patch` (`git diff --cached` if you added files with `git add`;
   new files need `git add -N <file>` or `git add` first, or they are missing from the diff).
5. `scripts/vscode/fetch.sh` makes `build/vscode-src` again (the stamp changes with the patches), `scripts/vscode/build.sh darwin-arm64` builds it.
   For quick tries, edit `build/vscode-src` directly and run `build.sh` again; copy the result into a patch the way
   step 4 says (but `git diff` there also shows VSCodium's changes: only a pristine tree gives a clean patch).

Keep a patch small and about one thing; put the reason in a comment where the code changes. When `vscode.lock` moves to a new
VS Code, every patch is tried again on the new source: fix the ones that stop applying and keep their numbers.
