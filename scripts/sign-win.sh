#!/usr/bin/env bash
# Signs Windows programs (Kural.exe, the installer and its uninstaller) so Windows knows who made them. Without a
# signature, Microsoft Defender SmartScreen says "Windows protected your PC" when someone opens the installer, and
# Windows 11's Smart App Control can refuse to start Kural at all. Uses jsign, which runs on Linux (where the Windows
# build is made: build-win.sh) and works with a .pfx file and with the cloud signing services.
#
# Does nothing (and says so) unless a code signing certificate is set up. CI gets these from the repository's secrets
# (see docs/windows-signing.md):
#   KURAL_SIGN_STORETYPE  PKCS12 (a .pfx / .p12 file), TRUSTEDSIGNING (Azure Artifact Signing), ESIGNER (SSL.com),
#                         DIGICERTONE, SIGNPATH, CRYPTOCERTUM, … (jsign's names for them)
#   KURAL_SIGN_KEYSTORE   the .pfx file, or the service's address or name
#   KURAL_SIGN_STOREPASS  its password, or the service's access token / credentials
#   KURAL_SIGN_ALIAS      which certificate (not needed for a .pfx with one)
#   KURAL_SIGN_KEYPASS    the key's own password, if it has one (SSL.com eSigner: the TOTP secret)
#   KURAL_SIGN_TSA        time stamp server, so the signature stays valid after the certificate expires
#                         (default http://timestamp.digicert.com; Azure: http://timestamp.acs.microsoft.com; "none": no
#                         time stamp, only for tests)
#   JSIGN                 how to run jsign (default: jsign on PATH, else java -jar "$JSIGN_JAR")
#   KURAL_SIGN_LOG        if set, each signed file's name is added to this file (sign-win-check.sh counts them)
#
# Usage: scripts/sign-win.sh <file.exe>...      (also called by NSIS for the installer and uninstaller: installer/sign.nsh)
set -euo pipefail

if [ -z "${KURAL_SIGN_STORETYPE:-}" ] || [ -z "${KURAL_SIGN_KEYSTORE:-}" ]; then
  echo "sign-win: no code signing certificate set up: $* left unsigned (Windows SmartScreen will warn about it)" >&2
  exit 0
fi
[ $# -gt 0 ] || { echo "usage: $0 <file.exe>..." >&2; exit 2; }

if [ -n "${JSIGN:-}" ]; then read -r -a run <<< "$JSIGN"
elif command -v jsign >/dev/null 2>&1; then run=(jsign)
elif [ -n "${JSIGN_JAR:-}" ]; then run=(java -jar "$JSIGN_JAR")
else echo "sign-win: jsign not found (install it, or set JSIGN_JAR to jsign's .jar)" >&2; exit 1
fi

args=(--storetype "$KURAL_SIGN_STORETYPE" --keystore "$KURAL_SIGN_KEYSTORE" --alg SHA-256
  --name "Kural Code Editor" --url "https://github.com/adithyakumarcr/kural")
[ -n "${KURAL_SIGN_STOREPASS:-}" ] && args+=(--storepass "$KURAL_SIGN_STOREPASS")
[ -n "${KURAL_SIGN_ALIAS:-}" ] && args+=(--alias "$KURAL_SIGN_ALIAS")
[ -n "${KURAL_SIGN_KEYPASS:-}" ] && args+=(--keypass "$KURAL_SIGN_KEYPASS")
tsa="${KURAL_SIGN_TSA:-http://timestamp.digicert.com}"
[ "$tsa" != none ] && args+=(--tsaurl "$tsa" --tsmode RFC3161 --tsretries 3 --tsretrywait 10)

for f in "$@"; do
  # (Never the secrets in the log: only which file.)
  "${run[@]}" "${args[@]}" --quiet "$f"
  echo "sign-win: signed $(basename "$f")"
  [ -n "${KURAL_SIGN_LOG:-}" ] && echo "$(basename "$f")" >> "$KURAL_SIGN_LOG"
done
