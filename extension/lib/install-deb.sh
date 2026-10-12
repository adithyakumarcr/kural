# Installs a Kural update on Ubuntu. Runs as root (Kural starts it with pkexec): /bin/sh install-deb.sh FILE SHA256
#
# Why (REL-3): Kural checks the download against its signed checksum list, but it does that as you, and any other
# program running as you could swap the file between that check and dpkg reading it. Here root makes its own copy in
# a folder only root can change, checks THAT copy against the signed checksum, and installs that copy. This file is
# root's too (the .deb puts it under /usr/share/kural), so the check can't be changed either.
set -eu
[ "$(id -u)" = 0 ] || { echo "kural-install-deb: must run as root" >&2; exit 3; }
[ $# -eq 2 ] || { echo "kural-install-deb: usage: install-deb.sh FILE SHA256" >&2; exit 4; }
case "$2" in *[!0-9a-f]*) echo "kural-install-deb: bad checksum" >&2; exit 4 ;; esac
[ ${#2} -eq 64 ] || { echo "kural-install-deb: bad checksum" >&2; exit 4; }

d=$(mktemp -d /var/tmp/kural-install.XXXXXX)   # (root's, 0700)
trap 'rm -rf "$d"' EXIT
cp -- "$1" "$d/kural.deb"
got=$(sha256sum "$d/kural.deb" | cut -d' ' -f1)
[ "$got" = "$2" ] || { echo "kural-install-deb: the file doesn't match Kural's signed checksum; not installing it" >&2; exit 5; }
pkg=$(dpkg-deb -f "$d/kural.deb" Package 2>/dev/null || true)
[ "$pkg" = kural ] || { echo "kural-install-deb: not a Kural package ($pkg); not installing it" >&2; exit 6; }
/usr/bin/dpkg -i "$d/kural.deb"
