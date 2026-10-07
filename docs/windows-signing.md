# Signing the Windows build (for maintainers)

## Why Windows warns

When someone opens `Kural-…-windows-x64-setup.exe` they downloaded, Microsoft Defender SmartScreen checks who made it.
Kural's Windows files aren't signed, so it says **"Windows protected your PC … an unrecognized app"** and only offers
**Don't run** (the **Run anyway** button appears after clicking the small **More info** link). Windows 11's **Smart App
Control** (on for some new Windows installs) goes further: it blocks unsigned programs, with no "Run anyway".

Kural's own updates (Help → Check for Updates) are downloaded by Kural itself, not the browser, so SmartScreen doesn't
check them: only the first install from the web shows the warning.

The only real fix is a **code signing certificate** in your name (or a company's), used on every release. Even then
SmartScreen keeps warning for a while after the first signed release: Microsoft builds a "reputation" for the
certificate as people download and run it without trouble. Since 2024 an EV certificate no longer skips that.

## What's ready in the build

Nothing to change in the code once you have a certificate: add it as repository secrets and the next build is signed.

- `scripts/sign-win.sh` signs with [jsign](https://github.com/ebourg/jsign) (Java; runs on Linux, where the Windows build
  is made). It signs `Kural.exe` and `bin/kural-tunnel.exe` (in `build-win.sh`), and NSIS signs the installer and its
  uninstaller as it makes them (`installer/sign.nsh`). Each signature gets a time stamp, so it stays valid after the
  certificate expires.
- Without a certificate it changes nothing: the build is unsigned, as before, with a note in the log.
- Every CI build runs `scripts/sign-win-check.sh`: a throwaway certificate signs a tiny installer made the same way, and
  the check fails unless the installer and its uninstaller were both signed. So the signing step is known to work
  before a real certificate is used. (Locally: `JSIGN_JAR=<jsign.jar> ./scripts/sign-win-check.sh`, needs `makensis`,
  `openssl`, `java`.)
- When the build was signed, the Windows check job installs it and fails unless Windows calls the installer, `Kural.exe`
  and the uninstaller validly signed (`Get-AuthenticodeSignature`).

## Getting a certificate (October 2026)

| Option | Cost | Who | In the build |
|---|---|---|---|
| [Azure Artifact Signing](https://azure.microsoft.com/products/artifact-signing) (was Trusted Signing) | USD 9.99 a month (Basic, 5,000 signatures) | Companies in the US, Canada, EU and UK; individuals only in the US and Canada | `TRUSTEDSIGNING` |
| An OV code signing certificate with cloud signing: SSL.com eSigner, DigiCert KeyLocker, Certum (SimplySign or its card) | roughly USD 100–400 a year, depending on the company | Individuals and companies, after an identity check | `ESIGNER`, `DIGICERTONE`, `CRYPTOCERTUM` / `PKCS11`… |
| [SignPath Foundation](https://signpath.org) | free | Open-source projects under an OSI-approved license. Kural's MIT + Commons Clause isn't one, so it's unlikely to qualify | `SIGNPATH` |
| A `.pfx` file you already have | — | — | `PKCS12` |

(Since June 2023 a code signing key has to live in a hardware token or a cloud service, so a new certificate is used
through one of the services above, not as a plain file.)

## Turning it on

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | What |
|---|---|
| `WINDOWS_SIGN_STORETYPE` | jsign's name for it: `TRUSTEDSIGNING`, `ESIGNER`, `DIGICERTONE`, `SIGNPATH`, `PKCS12`… |
| `WINDOWS_SIGN_KEYSTORE` | the service's address or name (Azure: the endpoint, e.g. `weu.codesigning.azure.net`; SSL.com: `https://cs.ssl.com`) |
| `WINDOWS_SIGN_STOREPASS` | its password or credentials (not needed for Azure: see below) |
| `WINDOWS_SIGN_ALIAS` | which certificate (Azure: `<account>/<certificate profile>`; SSL.com: the credential id) |
| `WINDOWS_SIGN_KEYPASS` | only if the key has its own password (SSL.com eSigner: the TOTP secret) |
| `WINDOWS_SIGN_TSA` | the time stamp server, if not DigiCert's (Azure: `http://timestamp.acs.microsoft.com`) |
| `WINDOWS_SIGN_PFX_BASE64` | only for a `.pfx` file: `base64 -i cert.pfx` (then `WINDOWS_SIGN_STOREPASS` is its password) |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | only for Azure: a service principal with the "Artifact Signing Certificate Profile Signer" role; the build gets the access token itself |

jsign's documentation lists what each service needs: <https://ebourg.github.io/jsign/>.

Then run **Actions → Build Kural → Run workflow** (or push a tag): the Windows job's log says `sign-win: signed …` for
each file, and the **Signed** step of the Windows check shows each file as `Valid`.
