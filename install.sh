#!/usr/bin/env bash
# Build and install Kural on Ubuntu / Debian in one go:  ./install.sh
# 1. installs the few tools the build needs, 2. builds the .deb (make-deb.sh), 3. installs it.
set -euo pipefail
cd "$(dirname "$0")"

need=()
for p in curl python3 unzip; do command -v "$p" >/dev/null || need+=("$p"); done
python3 -c "import PIL" 2>/dev/null || need+=(python3-pil)
if [ ${#need[@]} -gt 0 ]; then
  echo "Installing build tools: ${need[*]}"
  sudo apt-get update -qq && sudo apt-get install -y "${need[@]}"
fi

chmod +x make-deb.sh
./make-deb.sh

deb=$(ls -t dist/kural_*_amd64.deb | head -1)
echo "Installing $deb ..."
sudo apt install -y "./$deb"
echo "Done. Open Kural from your apps menu (or run: kural)."
