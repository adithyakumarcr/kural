#!/usr/bin/env bash
# Builds dist/kural_<ver>_amd64.deb (Ubuntu 22.04+ / Debian 12+, x64) from VSCodium. Usage: ./make-deb.sh
set -euo pipefail
cd "$(dirname "$0")"

NAME=kural            # command / folder name
TITLE="Kural"         # name shown in the app
CODIUM_VER="${CODIUM_VER:-1.143.17183}"

mkdir -p dist
R=pkg
if [ "${KURAL_SOURCE:-0}" = 1 ]; then
  # 0. Our own build of VS Code from its source plus Kural's patches (scripts/vscode/), not VSCodium's download.
  #    (--download-node: VS Code wants one exact Node version; a private copy is kept in build/. build/vscode-out is
  #    not compiled again when it is up to date.) The result is the app folder (like the one inside VSCodium's .deb);
  #    the rest of the package (completions, mime, control) is made here the way VS Code's own deb task does it.
  echo "Building VS Code from source (scripts/vscode/fetch.sh + build.sh) ..."
  [ "$(uname -m)" = x86_64 ] || { echo "Error: the source build on Linux is for x64 (this computer: $(uname -m))." >&2; exit 1; }
  ./scripts/vscode/fetch.sh
  ./scripts/vscode/build.sh --download-node linux-x64
  SRC=build/vscode-src
  VER="$(python3 -c 'import json;print(json.load(open("extension/package.json"))["version"])')+$(python3 -c 'import json;print(json.load(open("build/vscode-out/linux-x64/resources/app/package.json"))["version"])')"
  rm -rf root "$R" && mkdir -p "$R/DEBIAN" "$R/usr/share/codium" "$R/usr/share/pixmaps" "$R/usr/share/applications" \
    "$R/usr/share/bash-completion/completions" "$R/usr/share/zsh/vendor-completions" "$R/usr/share/mime/packages"
  cp -a build/vscode-out/linux-x64/. "$R/usr/share/codium/"      # (cp -a keeps links and the sandbox's mode)
  sed "s/@@APPNAME@@/codium/g" "$SRC/resources/completions/bash/code" > "$R/usr/share/bash-completion/completions/codium"
  sed "s/@@APPNAME@@/codium/g" "$SRC/resources/completions/zsh/_code" > "$R/usr/share/zsh/vendor-completions/_codium"
  sed -e "s/@@NAME@@/codium/g" -e "s/@@NAME_LONG@@/VSCodium/g" "$SRC/resources/linux/code-workspace.xml" > "$R/usr/share/mime/packages/codium-workspace.xml"
  # What the program needs: VS Code's own list for x64 (build/linux/debian/dep-lists.ts), without repeats.
  DEPENDS="$(python3 -I - "$SRC/build/linux/debian/dep-lists.ts" <<'PYEOF'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"'amd64':\s*\[(.*?)\]", text, re.S)
deps = list(dict.fromkeys(re.findall(r"'([^']+)'", m.group(1)))) if m else []
if len(deps) < 20: sys.exit("could not read the amd64 dependencies from dep-lists.ts: did its layout change?")
print(", ".join(deps))
PYEOF
)"
else
  # 0. Download VSCodium (the open-source build of VS Code) if we don't have it yet
  if [ ! -f codium.deb ]; then
    echo "Downloading VSCodium $CODIUM_VER ..."
    curl -fL -o codium.deb "https://github.com/VSCodium/vscodium/releases/download/$CODIUM_VER/codium_${CODIUM_VER}_amd64.deb"
  fi
  ./scripts/check-codium.sh "codium_${CODIUM_VER}_amd64.deb" codium.deb || exit 1   # (also a file left from an earlier run)
  VER="$(python3 -c 'import json;print(json.load(open("extension/package.json"))["version"])')+$(dpkg-deb -f codium.deb Version)"
  DEPENDS="$(dpkg-deb -f codium.deb Depends)"
fi
# "1:" (an epoch) makes 1.0.x count as newer than the earlier 3.0.0 builds, so apt upgrades cleanly.
# A test version like 1.1.0-alpha.1 becomes 1.1.0~alpha.1 inside the package: "~" sorts before the final 1.1.0,
# so apt later upgrades the alpha to 1.1.0. (A "-" would mean something else to apt.)
DEBVER="1:${VER//-/\~}"
if [ "${KURAL_SOURCE:-0}" != 1 ]; then
  rm -rf root "$R" && dpkg-deb -R codium.deb root && mv root "$R"
fi
echo "Building $TITLE ..."

# 1. Move the app folder and rename the executables
mv "$R/usr/share/codium" "$R/usr/share/$NAME"
A="$R/usr/share/$NAME"
python3 scripts/electron_runtime.py "$A" linux-x64
mv "$A/codium" "$A/$NAME"
mv "$A/bin/codium" "$A/bin/$NAME"
rm -f "$A/bin/codium-tunnel"
sed -i -e "s#/usr/share/codium#/usr/share/$NAME#" \
       -e "s#ELECTRON=\"\$VSCODE_PATH/codium\"#ELECTRON=\"\$VSCODE_PATH/$NAME\"#" \
       -e "s#which -a 'codium'#which -a '$NAME'#" \
       -e "s#VSCodium#$TITLE#g" -e "s#\`codium\`#\`$NAME\`#g" "$A/bin/$NAME"

# 2–3. Names, data folders, the built-in Kural extension, Git's Ctrl+K
#      shortcuts moved, auto-update off. Shared with the macOS and Windows builds.
python3 scripts/rebrand.py "$A/resources/app" linux
python3 scripts/sbom.py "dist/kural-${VER%%+*}-linux-x64.cdx.json" --app-root "$A/resources/app" --platform linux-x64

# 4. Desktop menu entries, icon, shell completions, mime
# (Every menu entry VSCodium ships: newer ones are com.visualstudio.CodeOSS*.desktop, which pointed at the missing
#  /usr/share/codium and showed as a second, gear-shaped dock icon. Kural writes its own two below.)
rm -f "$R"/usr/share/applications/*.desktop "$R/usr/share/pixmaps/vscodium.png" "$R"/usr/share/appdata/*.xml "$R"/usr/share/metainfo/*.xml
cp assets/icon.png "$R/usr/share/pixmaps/$NAME.png"
# Icons in every size the desktop asks for (dock, app grid, window switcher)
for s in 16 24 32 48 64 128 256 512; do
  d="$R/usr/share/icons/hicolor/${s}x${s}/apps"; mkdir -p "$d"
  python3 -c "from PIL import Image; Image.open('assets/icon.png').resize(($s,$s), Image.LANCZOS).save('$d/$NAME.png')" 2>/dev/null \
    || cp assets/icon.png "$d/$NAME.png"
done
mv "$R/usr/share/bash-completion/completions/codium" "$R/usr/share/bash-completion/completions/$NAME"
mv "$R/usr/share/zsh/vendor-completions/_codium" "$R/usr/share/zsh/vendor-completions/_$NAME"
sed -i "s/codium/$NAME/g" "$R/usr/share/bash-completion/completions/$NAME" "$R/usr/share/zsh/vendor-completions/_$NAME"
mv "$R/usr/share/mime/packages/codium-workspace.xml" "$R/usr/share/mime/packages/$NAME-workspace.xml"
sed -i "s/codium/$NAME/g; s/VSCodium/$TITLE/g" "$R/usr/share/mime/packages/$NAME-workspace.xml"

cat > "$R/usr/share/applications/$NAME.desktop" <<EOF
[Desktop Entry]
Name=$TITLE Code Editor
Comment=Code editor with AI built in: Tab Completion, chat with agents and inline edit
GenericName=Text Editor
Exec=/usr/share/$NAME/$NAME %F
Icon=$NAME
Type=Application
StartupNotify=false
StartupWMClass=$NAME
Categories=TextEditor;Development;IDE;
MimeType=text/plain;inode/directory;application/x-$NAME-workspace;
Actions=new-empty-window;
Keywords=claude;kural;vscode;editor;ai;

[Desktop Action new-empty-window]
Name=New Empty Window
Exec=/usr/share/$NAME/$NAME --new-window %F
Icon=$NAME
EOF
cat > "$R/usr/share/applications/$NAME-url-handler.desktop" <<EOF
[Desktop Entry]
Name=$TITLE - URL Handler
Exec=/usr/share/$NAME/$NAME --open-url %U
Icon=$NAME
Type=Application
NoDisplay=true
MimeType=x-scheme-handler/$NAME;
EOF

# 5. Package metadata + simple install/uninstall scripts
#    (VSCodium's originals add a Microsoft apt repo; we don't want that)
rm -f "$R"/DEBIAN/{postinst,postrm,prerm,templates}
SIZE=$(du -sk "$R/usr" | cut -f1)
cat > "$R/DEBIAN/control" <<EOF
Package: $NAME
Version: $DEBVER
Section: devel
Priority: optional
Architecture: amd64
Depends: $DEPENDS
Recommends: libvulkan1, curl
Conflicts: claude-vs, claudex
Replaces: claude-vs, claudex
Installed-Size: $SIZE
Maintainer: Adithya Chinnakkonda <50017783+adithyakumarcr@users.noreply.github.com>
Description: $TITLE Code Editor - a code editor with AI built in
 VSCodium (open-source VS Code) rebuilt as $TITLE: Tab Completion, a chat
 panel with agents (Ctrl+L), inline edits (Ctrl+K) and Search & Ask, with
 Claude, Google Gemini, ChatGPT (Codex) or your own model on this computer
 (Ollama, offline), using your own accounts.
EOF
cat > "$R/DEBIAN/postinst" <<EOF
#!/bin/sh
set -e
ln -sf /usr/share/$NAME/bin/$NAME /usr/bin/$NAME
chown root:root /usr/share/$NAME/chrome-sandbox 2>/dev/null || true
chmod 4755 /usr/share/$NAME/chrome-sandbox 2>/dev/null || true
command -v update-desktop-database >/dev/null && update-desktop-database -q || true
command -v update-mime-database >/dev/null && update-mime-database /usr/share/mime || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
exit 0
EOF
cat > "$R/DEBIAN/postrm" <<EOF
#!/bin/sh
set -e
if [ "\$1" = "remove" ] || [ "\$1" = "purge" ]; then rm -f /usr/bin/$NAME; fi
command -v update-desktop-database >/dev/null && update-desktop-database -q || true
exit 0
EOF
chmod 755 "$R"/DEBIAN/postinst "$R"/DEBIAN/postrm

OUT="dist/${NAME}_${VER}_amd64.deb"
dpkg-deb --root-owner-group -Zxz -b "$R" "$OUT" >/dev/null
rm -rf "$R"
echo
echo "Built: $OUT"
echo "Install with:  sudo apt install ./$OUT   (this also replaces ClaudeX / Claude VS)"
