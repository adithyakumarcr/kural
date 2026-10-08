#!/usr/bin/env bash
# Checks the Windows signing step without a real certificate (CI's Windows job runs it before the build): a throwaway
# self-signed certificate signs a tiny installer that NSIS makes the way installer/kural.nsi makes Kural's (through
# installer/sign.nsh and scripts/sign-win.sh), and the check fails unless both the installer and its uninstaller were
# signed and the installer carries that certificate. So a mistake there shows up now, not on the day a real
# certificate is set up. Nothing it makes is kept or published.
# Needs: makensis (3.08+), openssl, java and jsign (jsign on PATH, JSIGN, or JSIGN_JAR).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=Kural signing check" -addext "extendedKeyUsage=codeSigning" \
  -keyout "$T/key.pem" -out "$T/cert.pem" 2>/dev/null
openssl pkcs12 -export -inkey "$T/key.pem" -in "$T/cert.pem" -name check -passout pass:check -out "$T/check.p12"

cat > "$T/check.nsi" <<EOF
Unicode true
Name "Kural signing check"
OutFile "$T/check-setup.exe"
RequestExecutionLevel user
!include "$ROOT/installer/sign.nsh"
Section
  WriteUninstaller "\$INSTDIR\\uninstall.exe"
SectionEnd
Section "Uninstall"
SectionEnd
EOF

export KURAL_SIGN_STORETYPE=PKCS12 KURAL_SIGN_KEYSTORE="$T/check.p12" KURAL_SIGN_STOREPASS=check KURAL_SIGN_ALIAS=check \
  KURAL_SIGN_KEYPASS= KURAL_SIGN_TSA=none KURAL_SIGN_LOG="$T/signed.log"
makensis -V2 -DSIGN="$ROOT/scripts/sign-win.sh" "$T/check.nsi"

signed="$(cat "$T/signed.log" 2>/dev/null || true)"
if [ "$(printf '%s\n' "$signed" | grep -c .)" -ne 2 ]; then
  echo "::error::Windows signing check: expected the installer and its uninstaller to be signed; signed: ${signed:-nothing}"
  exit 1
fi
if [ -n "${JSIGN:-}" ]; then read -r -a run <<< "$JSIGN"; elif command -v jsign >/dev/null 2>&1; then run=(jsign); else run=(java -jar "$JSIGN_JAR"); fi
"${run[@]}" extract --format PEM "$T/check-setup.exe" >/dev/null
if ! openssl pkcs7 -in "$T/check-setup.exe.sig.pem" -print_certs -noout | grep -Eq "CN *= *Kural signing check"; then
  echo "::error::Windows signing check: the installer doesn't carry the signature"
  exit 1
fi
echo "Windows signing check: the installer and its uninstaller were signed (with a throwaway certificate)"
