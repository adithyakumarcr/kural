#!/usr/bin/env bash
# Builds dist/Kural-<ver>-macos-arm64.zip (Apple Silicon: M1–M5) from VSCodium, plus a .dmg when run on a Mac.
# Runs on Linux or macOS. Needs: curl, unzip, zip, python3 + Pillow, rcodesign (or macOS codesign).
set -euo pipefail
cd "$(dirname "$0")"

CODIUM_VER="${CODIUM_VER:-1.135.06055}"
VER="$(python3 -c 'import json;print(json.load(open("extension/package.json"))["version"])')"
SRC="downloads/VSCodium-darwin-arm64-$CODIUM_VER.zip"
OUT="dist/Kural-$VER-macos-arm64.zip"
WORK="build/mac"

mkdir -p downloads dist
if [ ! -f "$SRC" ]; then
  echo "Downloading VSCodium $CODIUM_VER for macOS (Apple Silicon) ..."
  curl -fL -o "$SRC" "https://github.com/VSCodium/vscodium/releases/download/$CODIUM_VER/VSCodium-darwin-arm64-$CODIUM_VER.zip"
fi
rm -rf "$WORK" && mkdir -p "$WORK"
unzip -q "$SRC" -d "$WORK"      # keeps the app's internal links (symlinks) intact
mv "$WORK/VSCodium.app" "$WORK/Kural.app"
APP="$WORK/Kural.app"

echo "Rebranding ..."
python3 scripts/rebrand.py "$APP/Contents/Resources/app" mac
python3 scripts/make-icons.py "$WORK/icons" >/dev/null
cp "$WORK/icons/icon.icns" "$APP/Contents/Resources/Kural.icns"
rm -f "$APP/Contents/Resources/VSCodium.icns"

# The name macOS shows (menu bar, Dock, Finder), the app id, icon and link scheme.
# Electron finds its four helper apps by that name: with CFBundleName "Kural" it looks for "Kural Helper.app",
# "Kural Helper (GPU).app", ... If they're still called "VSCodium Helper", Electron stops right at launch
# ("Kural quit unexpectedly"). So the program, the helpers and the `kural` command are all renamed too.
mv "$APP/Contents/MacOS/VSCodium" "$APP/Contents/MacOS/Kural"
for s in "" " (GPU)" " (Plugin)" " (Renderer)"; do
  h="$APP/Contents/Frameworks/Kural Helper$s.app"
  mv "$APP/Contents/Frameworks/VSCodium Helper$s.app" "$h"
  mv "$h/Contents/MacOS/VSCodium Helper$s" "$h/Contents/MacOS/Kural Helper$s"
done
mv "$APP/Contents/Resources/app/bin/codium" "$APP/Contents/Resources/app/bin/kural"
python3 - "$APP" <<'PYEOF'
import glob, os, plistlib, sys
app = sys.argv[1]
def edit(path, **changes):
    with open(path, "rb") as f: d = plistlib.load(f)
    d.update(changes)
    for u in d.get("CFBundleURLTypes", []):
        u["CFBundleURLName"] = "Kural"; u["CFBundleURLSchemes"] = ["kural"]
    with open(path, "wb") as f: plistlib.dump(d, f)
edit(f"{app}/Contents/Info.plist", CFBundleName="Kural", CFBundleDisplayName="Kural", CFBundleExecutable="Kural",
     CFBundleIdentifier="com.kural", CFBundleIconFile="Kural.icns")
# The texts macOS shows if something asks for a permission. They don't ask for anything by themselves, and they stay:
# without one, macOS closes the whole app when an extension tries that device. Kural itself uses none of them, and the
# signature below doesn't allow camera or microphone (macOS just says no). The prompts people saw (Music, Photos…) came
# from walking the home folder, which Kural no longer does.
with open(f"{app}/Contents/Info.plist", "rb") as f: d = plistlib.load(f)
for k in [k for k in d if k.endswith("UsageDescription")]:
    d[k] = d[k].replace("Visual Studio Code", "Kural")
with open(f"{app}/Contents/Info.plist", "wb") as f: plistlib.dump(d, f)
for h in glob.glob(f"{app}/Contents/Frameworks/Kural Helper*.app"):
    name = os.path.basename(h)[:-4]                       # "Kural Helper (GPU)"
    with open(f"{h}/Contents/Info.plist", "rb") as f: ident = plistlib.load(f).get("CFBundleIdentifier", "")
    edit(f"{h}/Contents/Info.plist", CFBundleName=name, CFBundleExecutable=name,
         CFBundleIdentifier=ident.replace("com.vscodium", "com.kural"))
# The `kural` command: runs the renamed program
cli = f"{app}/Contents/Resources/app/bin/kural"
s = open(cli).read().replace('MacOS/VSCodium"', 'MacOS/Kural"').replace("which -a 'codium'", "which -a 'kural'")
open(cli, "w").write(s)
PYEOF

# macOS refuses to run changed apps unless they're signed again. We sign "ad-hoc"
# (free, no Apple developer account). First launch then needs one approval: see README.
echo "Signing (ad-hoc) ..."
if command -v codesign >/dev/null 2>&1; then
  # On a Mac: plain ad-hoc signature (no "hardened runtime", so no permissions needed).
  codesign --force --deep --sign - "$APP"
else
  # On Linux: rcodesign keeps VSCodium's "hardened runtime" mode. In that mode macOS only
  # loads libraries from the same developer, and ad-hoc signatures have no developer, so each
  # program also gets "disable-library-validation" (plus the permissions it already had).
  ent() {  # ent <file> <permission>...
    local f="$1"; shift
    { echo '<?xml version="1.0" encoding="UTF-8"?>'
      echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      echo '<plist version="1.0"><dict>'
      for k in "$@"; do echo "  <key>com.apple.security.$k</key><true/>"; done
      echo '</dict></plist>'; } > "$f"; }
  E="$WORK/entitlements"; mkdir -p "$E"
  DLV=cs.disable-library-validation
  ent "$E/main.plist"     cs.allow-jit automation.apple-events $DLV   # (no camera or microphone: Kural doesn't use them)
  ent "$E/renderer.plist" cs.allow-jit $DLV
  ent "$E/plugin.plist"   cs.allow-jit cs.allow-unsigned-executable-memory $DLV
  ent "$E/plain.plist"    $DLV
  # Each helper is its own little app; its settings are given by the path of its program file.
  h() { echo "Contents/Frameworks/Kural Helper$1.app/Contents/MacOS/Kural Helper$1"; }
  rcodesign sign \
    --entitlements-xml-file "$E/main.plist" \
    --entitlements-xml-file "$(h " (Renderer)"):$E/renderer.plist" \
    --entitlements-xml-file "$(h " (Plugin)"):$E/plugin.plist" \
    --entitlements-xml-file "$(h " (GPU)"):$E/plain.plist" \
    --entitlements-xml-file "$(h ""):$E/plain.plist" \
    "$APP" >"$WORK/sign.log" 2>&1
fi

echo "Zipping ..."
rm -f "$OUT"
( cd "$WORK" && zip -qry -X "../../$OUT" Kural.app )   # -y keeps symlinks as links
DMG="dist/Kural-$VER-macos-arm64.dmg"
if command -v hdiutil >/dev/null 2>&1; then
  # On a Mac also make a .dmg: open it, drag Kural onto Applications.
  echo "Making the .dmg ..."
  rm -rf "$WORK/dmg" "$DMG" && mkdir "$WORK/dmg"
  ditto "$APP" "$WORK/dmg/Kural.app"          # ditto keeps links and the signature intact
  ln -s /Applications "$WORK/dmg/Applications"
  hdiutil create -quiet -volname "Kural" -srcfolder "$WORK/dmg" -fs HFS+ -format UDZO "$DMG"
fi
echo
echo "Built: $OUT"
if [ -f "$DMG" ]; then echo "       $DMG"; fi
