"""Replace the complete Electron distribution in an extracted, disposable vendor build.

Keep the editor application, launchers, bundle identities and vendor security fuses.
Downloads are pinned independently of GitHub's mutable release metadata.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SENTINEL = b'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'


def fuse_wire(binary):
    data = binary.read_bytes()
    if data.count(SENTINEL) != 1:
        raise ValueError('Expected one Electron fuse wire')
    i = data.index(SENTINEL) + len(SENTINEL)
    if data[i:i + 2] != bytes([1, 9]):
        raise ValueError('Unknown Electron fuse layout')
    return data[i + 2:i + 11].decode('ascii')


def verify(archive, digest):
    actual = hashlib.sha256()
    with archive.open('rb') as stream:
        while block := stream.read(1 << 20):
            actual.update(block)
    if actual.hexdigest() != digest:
        raise ValueError('Electron archive integrity mismatch')


def extract(archive, destination):
    """Validate all paths and links before extracting; never write through a link."""
    with zipfile.ZipFile(archive) as z:
        seen, links, entries = set(), {}, []
        for entry in z.infolist():
            name = entry.filename.rstrip('/')
            p = PurePosixPath(name)
            if not name or p.is_absolute() or '\\' in name or ':' in name or any(s in ('', '.', '..') for s in name.split('/')):
                raise ValueError('Unsafe Electron archive path')
            if name.casefold() in seen:
                raise ValueError('Duplicate Electron archive path')
            seen.add(name.casefold())
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                target = z.read(entry).decode('utf-8')
                if not target or '\\' in target or ':' in target or target.startswith('/'):
                    raise ValueError('Unsafe Electron archive link')
                resolved = (destination / name).parent.joinpath(target).resolve()
                if not resolved.is_relative_to(destination.resolve()):
                    raise ValueError('Escaping Electron archive link')
                links[name] = target
            elif mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Unsupported Electron archive file type')
            entries.append((entry, name, mode))
        for _, name, _ in entries:
            if any(str(p) in links for p in PurePosixPath(name).parents):
                raise ValueError('Electron archive writes through a link')
        for entry, name, mode in entries:
            target = destination / name
            if name in links:
                continue
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(entry) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(stat.S_IMODE(mode) or 0o644)
        for name, target in links.items():
            link = destination / name
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(target)
        for name in links:
            if not (destination / name).resolve().is_relative_to(destination.resolve()):
                raise ValueError('Escaping Electron archive link chain')


def replace(source, target):
    if target.is_symlink():
        raise ValueError('Symlink at runtime destination')
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()
    if source.is_dir():
        shutil.copytree(source, target, symlinks=True)
    else:
        shutil.copy2(source, target)


def check_bundles(app_root, platform, pin):
    """The SBOM lists Electron's Chromium, Node and libraries from the pin (vendor/electron-runtime.json `bundles`).
    Where the new runtime can run on this machine, ask it for its own versions and refuse a mismatch (DEP-001)."""
    import platform as host, subprocess
    here = {'Linux': 'linux-x64', 'Darwin': 'darwin-arm64'}.get(host.system())
    if here != platform or not pin.get('bundles'):
        print(f'Electron bundled versions: not checked here (building {platform} on {host.system()})')
        return
    # (Still VSCodium's names here: the build renames them afterwards.)
    exe = app_root / ('Contents/MacOS/VSCodium' if platform == 'darwin-arm64' else 'codium')
    out = subprocess.run([str(exe), '-p', 'JSON.stringify(process.versions)'], env={**os.environ, 'ELECTRON_RUN_AS_NODE': '1'},
                         capture_output=True, text=True, timeout=60)
    got = json.loads(out.stdout.strip().splitlines()[-1])
    names = {'chromium': 'chrome', 'libuv': 'uv', 'c-ares': 'ares'}
    wrong = {k: (v, got.get(names.get(k, k))) for k, v in pin['bundles'].items() if got.get(names.get(k, k)) != v}
    if wrong or got.get('electron') != pin['version']:
        raise ValueError(f'Electron bundled versions differ from vendor/electron-runtime.json: {wrong or got.get("electron")}')
    print(f'Electron bundled versions match the pin (Chromium {got["chrome"]}, Node {got["node"]})')


def install(app_root, platform, archive=None):
    pin = json.loads((ROOT / 'vendor/electron-runtime.json').read_text())
    app_root = Path(app_root).resolve(strict=True)
    mac = platform == 'darwin-arm64'
    app = app_root / ('Contents/Resources/app' if mac else 'resources/app')
    manifest = app / 'package.json'
    metadata = json.loads(manifest.read_text())
    if metadata.get('devDependencies', {}).get('electron') != pin['replaces']:
        raise ValueError('Unreviewed vendor Electron version')
    if archive is None:
        archive = ROOT / 'downloads' / f'electron-v{pin["version"]}-{platform}.zip'
        archive.parent.mkdir(parents=True, exist_ok=True)
        if not archive.exists():
            url = f'https://github.com/electron/electron/releases/download/v{pin["version"]}/{archive.name}'
            with urllib.request.urlopen(url, timeout=120) as response, tempfile.NamedTemporaryFile(dir=archive.parent, delete=False) as temp:
                temp_path = Path(temp.name)
                try:
                    shutil.copyfileobj(response, temp)
                    temp.flush()
                    verify(temp_path, pin['platforms'][platform])
                    os.replace(temp_path, archive)
                finally:
                    temp_path.unlink(missing_ok=True)
    archive = Path(archive)
    verify(archive, pin['platforms'][platform])
    with tempfile.TemporaryDirectory(prefix='kural-electron-') as staging:
        stage = Path(staging)
        extract(archive, stage)
        if mac:
            source = stage / 'Electron.app/Contents'
            old_binary = app_root / 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
            new_binary = source / 'Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
        else:
            source = stage
            old_binary = app_root / ('codium' if platform == 'linux-x64' else 'VSCodium.exe')
            new_binary = source / ('electron' if platform == 'linux-x64' else 'electron.exe')
        if fuse_wire(old_binary) != pin['fuses'] or fuse_wire(new_binary) != pin['fuses']:
            raise ValueError('Runtime replacement changes vendor security fuses')
        if mac:
            # Retain each VSCodium bundle identity; replace its executable and the complete framework.
            helpers = []
            frameworks = []
            for name in ('Electron Framework.framework', 'Mantle.framework', 'ReactiveObjC.framework', 'Squirrel.framework'):
                new = source / 'Frameworks' / name
                old = app_root / 'Contents/Frameworks' / name
                if not new.is_dir() or not old.is_dir() or old.is_symlink():
                    raise ValueError('Missing expected Electron framework')
                frameworks.append((new, old))
            for suffix in ('', ' (GPU)', ' (Plugin)', ' (Renderer)'):
                old = app_root / f'Contents/Frameworks/VSCodium Helper{suffix}.app/Contents/MacOS/VSCodium Helper{suffix}'
                new = source / f'Frameworks/Electron Helper{suffix}.app/Contents/MacOS/Electron Helper{suffix}'
                if not old.is_file() or not new.is_file():
                    raise ValueError('Missing expected Electron helper')
                helpers.append((new, old))
            for new, old in frameworks:
                replace(new, old)
            replace(source / 'MacOS/Electron', app_root / 'Contents/MacOS/VSCodium')
            for new, old in helpers:
                replace(new, old)
        else:
            # All DLLs/shared libraries, snapshots, locales and helper executables move together.
            # resources/app is the editor and must never be replaced by Electron's default app.
            sandbox_mode = (app_root / 'chrome-sandbox').stat().st_mode if platform == 'linux-x64' else None
            for item in source.iterdir():
                if item.name in ('resources', 'LICENSE', 'LICENSES.chromium.html', 'version'):
                    continue
                target = old_binary if item == new_binary else app_root / item.name
                replace(item, target)
            if sandbox_mode is not None:
                (app_root / 'chrome-sandbox').chmod(stat.S_IMODE(sandbox_mode))
        licenses = app_root / ('Contents/Resources' if mac else '') / 'electron-runtime'
        licenses.mkdir(exist_ok=True)
        for name in ('LICENSE', 'LICENSES.chromium.html', 'version'):
            if (stage / name).is_file():
                shutil.copy2(stage / name, licenses / name)
        metadata['devDependencies']['electron'] = pin['version']
        metadata['kuralRuntime'] = dict(version=pin['version'], platform=platform,
                                        sha256=pin['platforms'][platform], source='electron/electron')
        manifest.write_text(json.dumps(metadata, indent=2) + '\n')
    check_bundles(app_root, platform, pin)
    print(f'Installed verified Electron {pin["version"]} ({platform}); retained vendor fuses {pin["fuses"]}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app_root')
    parser.add_argument('platform', choices=('linux-x64', 'darwin-arm64', 'win32-x64'))
    parser.add_argument('--archive')
    args = parser.parse_args()
    install(args.app_root, args.platform, args.archive)
