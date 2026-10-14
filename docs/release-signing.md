# How Kural releases are signed

Kural isn't code-signed with an Apple or Microsoft certificate. Instead every release carries two extra files:

- `SHA256SUMS`: the SHA-256 of every download in the release.
- `SHA256SUMS.sig`: a signature of that list, made with Kural's release key (Ed25519).

The private keys exist only as GitHub Actions secrets. The public keys are in `extension/lib/release-keys.js`, so
they are inside every Kural. Kural's updater installs a download only when the list is signed by one of those keys and
the download's SHA-256 is in the list. A release without the two files is never installed automatically (download it
from the releases page and install it by hand).

**The key change (decided 14 Oct 2026).** Key #0's private key is the repository secret `KURAL_RELEASE_PRIVATE_KEY`,
which any workflow could read, also one changed on a branch. Key #1's private key is `KURAL_RELEASE_PRIVATE_KEY_NEW`,
only in the GitHub environment `release`, which only `v*` tags can use; it was made straight into the secret, so no
copy exists anywhere else.

1. 1.1.0-rc.2 and 1.1.0 ship both public keys and are still signed with key #0: rc.1 and older trust only key #0.
2. Before switching, the workflow `verify-signing-key` (run on a `v*` tag) checks that each secret signs for its public
   key in `release-keys.js`.
3. After 1.1.0: the release job signs with `secrets.KURAL_RELEASE_PRIVATE_KEY_NEW`, and the repository secrets
   `KURAL_RELEASE_PRIVATE_KEY` and `KURAL_RELEASE_PUBLIC_KEY` are deleted. Key #0 is then gone for good, and its public
   key can come out of `release-keys.js`. Versions before 1.1.0-rc.2 trust only key #0: their updater refuses releases
   signed with key #1 (it says the list isn't signed by Kural's key), so people still on them install a newer Kural by
   hand once.

## Verify a download by hand

Put the download, `SHA256SUMS` and `SHA256SUMS.sig` in one folder, with a copy of this repository:

```
sha256sum -c --ignore-missing SHA256SUMS            # on a Mac: shasum -a 256 -c SHA256SUMS (it lists the files you don't have)
node scripts/release-key.js verify SHA256SUMS SHA256SUMS.sig
```

The second command prints `OK (key #0)` when the list was signed by Kural's key. A running Kural can do the same
check for its own version: Command Palette, "Kural: Verify this installation...".

## Where did the build come from?

Releases also carry GitHub build provenance (a signed statement that this file was built by this repository's workflow):

```
gh attestation verify Kural-<version>-macos-arm64.zip --owner adithyakumarcr
```

Releases are never changed after they are published: the workflow refuses to touch an existing release, so a fix is a
new version.

## Making and rotating the key (for the owner)

1. `node scripts/release-key.js generate` prints a private and a public key.
2. Save the private one as a secret of the environment `release` (Settings, Environments, release; never a repository
   secret: any workflow can read those). Never commit it or paste it anywhere else.
3. Put the public one in `extension/lib/release-keys.js`.

To rotate: generate a new pair, ADD the new public key to the list (keep the old one), release, change the secret to
the new private key. After the versions signed with the old key are no longer in use, remove the old public key.
If the private key may have leaked: replace the secret at once and release a version whose list has only the new key;
people on older versions must install it by hand.
