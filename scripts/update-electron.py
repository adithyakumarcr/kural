#!/usr/bin/env python3
"""Points vendor/electron-runtime.json at the newest Electron patch release for the VSCodium in codium.lock.

Kural replaces VSCodium's own Electron with the newest release of the same major version (same ABI, so VS Code's native
modules keep working; newer Chromium/V8 security fixes). This script:
  1. reads VSCodium's Electron version from the VSCodium package in codium.lock (downloaded and checked if needed),
  2. finds the newest Electron release of that major on GitHub (no pre-releases),
  3. takes the three downloads' SHA-256 from Electron's own SHASUMS256.txt,
  4. downloads the Linux build, checks it against that list, and reads its bundled versions (Chromium, Node, ...) and
     ABI by running it, and checks its security fuses equal VSCodium's,
  5. writes vendor/electron-runtime.json (nothing changes when it's already current).
Usage: python3 scripts/update-electron.py [--codium-deb codium.deb]   (Linux x64; prints what changed)
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import electron_runtime as rt  # noqa: E402  (fuse_wire, vendor_version)

PLATFORMS = ('linux-x64', 'darwin-arm64', 'win32-x64')
NAMES = {'chromium': 'chrome', 'libuv': 'uv', 'c-ares': 'ares'}
BUNDLES = ('chromium', 'node', 'v8', 'libuv', 'icu', 'sqlite', 'zlib', 'nghttp2', 'undici', 'brotli', 'c-ares', 'simdjson', 'zstd')


def get(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': 'kural-update-electron', 'Accept': 'application/vnd.github+json'})
    if os.environ.get('GH_TOKEN') and 'api.github.com' in url:
        req.add_header('Authorization', f'Bearer {os.environ["GH_TOKEN"]}')
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    return data if binary else data.decode()


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def vscodium_electron(deb):
    """VSCodium's Electron version and fuse wire, from its .deb (its binary: devDependencies are gone since VS Code 1.140)."""
    with tempfile.TemporaryDirectory(prefix='kural-codium-') as tmp:
        subprocess.run(['dpkg-deb', '-x', str(deb), tmp], check=True)
        app = Path(tmp) / 'usr/share/codium'
        meta = json.loads((app / 'resources/app/package.json').read_text())
        return rt.vendor_version(meta, app / 'codium'), rt.fuse_wire(app / 'codium')


def newest_in_major(major):
    best = None
    for page in range(1, 4):
        for r in json.loads(get(f'https://api.github.com/repos/electron/electron/releases?per_page=100&page={page}')):
            m = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', r.get('tag_name', ''))
            if not m or r.get('prerelease') or r.get('draft') or int(m.group(1)) != major:
                continue
            v = tuple(int(x) for x in m.groups())
            if best is None or v > best:
                best = v
    return '.'.join(map(str, best)) if best else None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--codium-deb', default=str(ROOT / 'codium.deb'))
    args = ap.parse_args()
    lock = (ROOT / 'codium.lock').read_text()
    ver = re.search(r'^# VSCodium ([0-9.]+)\. ', lock, re.M).group(1)
    want = re.search(r'^codium_' + re.escape(ver) + r'_amd64\.deb\s+([0-9a-f]{64})$', lock, re.M).group(1)
    deb = Path(args.codium_deb)
    if not deb.exists() or sha256(deb) != want:
        print(f'Downloading VSCodium {ver} ...', file=sys.stderr)
        deb.write_bytes(get(f'https://github.com/VSCodium/vscodium/releases/download/{ver}/codium_{ver}_amd64.deb', binary=True))
        if sha256(deb) != want:
            sys.exit('The VSCodium download does not match codium.lock')
    vendor, fuses = vscodium_electron(deb)
    if not vendor:
        sys.exit("Couldn't read VSCodium's Electron version")
    newest = newest_in_major(int(vendor.split('.')[0])) or vendor
    pin_file = ROOT / 'vendor/electron-runtime.json'
    pin = json.loads(pin_file.read_text())
    if pin.get('version') == newest and pin.get('replaces') == vendor:
        print(f'Electron is current: {newest} (VSCodium {ver} ships {vendor})')
        return
    sums = get(f'https://github.com/electron/electron/releases/download/v{newest}/SHASUMS256.txt')
    hashes = {}
    for p in PLATFORMS:
        m = re.search(r'^([0-9a-f]{64}) \*?electron-v' + re.escape(newest) + '-' + p + r'\.zip$', sums, re.M)
        if not m:
            sys.exit(f'SHASUMS256.txt of Electron {newest} has no {p} build')
        hashes[p] = m.group(1)
    downloads = ROOT / 'downloads'
    downloads.mkdir(exist_ok=True)
    linux = downloads / f'electron-v{newest}-linux-x64.zip'
    if not linux.exists() or sha256(linux) != hashes['linux-x64']:
        print(f'Downloading Electron {newest} for Linux ...', file=sys.stderr)
        linux.write_bytes(get(f'https://github.com/electron/electron/releases/download/v{newest}/{linux.name}', binary=True))
    if sha256(linux) != hashes['linux-x64']:
        sys.exit("The Electron download doesn't match its SHASUMS256.txt")
    with tempfile.TemporaryDirectory(prefix='kural-electron-') as tmp:
        with zipfile.ZipFile(linux) as z:
            z.extractall(tmp)
        exe = Path(tmp) / 'electron'
        exe.chmod(0o755)
        if rt.fuse_wire(exe) != fuses:
            sys.exit(f'Electron {newest} has other security fuses than VSCodium ({rt.fuse_wire(exe)} vs {fuses}): look first')
        out = subprocess.run([str(exe), '-p', 'JSON.stringify(process.versions)'], env={**os.environ, 'ELECTRON_RUN_AS_NODE': '1'},
                             capture_output=True, text=True, timeout=60, check=True)
        versions = json.loads(out.stdout.strip().splitlines()[-1])
    if versions.get('electron') != newest:
        sys.exit(f'The Linux build says it is Electron {versions.get("electron")}, not {newest}')
    new = {'version': newest, 'replaces': vendor, 'abi': versions['modules'], 'fuses': fuses, 'platforms': hashes,
           'bundles': {k: versions[NAMES.get(k, k)] for k in BUNDLES if versions.get(NAMES.get(k, k))},
           'bundlesSource': f'process.versions of electron-v{newest}-linux-x64 (ELECTRON_RUN_AS_NODE=1); checked again at each Linux/Mac build'}
    pin_file.write_text(json.dumps(new, indent=2) + '\n')
    print(f'Electron {pin.get("version")} -> {newest} (VSCodium {ver} ships {vendor}, ABI {new["abi"]})')


if __name__ == '__main__':
    main()
