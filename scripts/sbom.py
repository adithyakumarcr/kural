#!/usr/bin/env python3
"""Manifest inventory of a packaged application. Does not run hooks or follow symlinks."""
import argparse, hashlib, json, os, re
from pathlib import Path
from urllib.parse import quote
ROOT = Path(__file__).resolve().parent.parent

# The whole installed app around resources/app: Electron, its libraries, helper programs (VS Code's tunnel, ripgrep...).
def install_root(app_root):
    p = Path(app_root).resolve()
    if p.parts[-3:] == ('Contents', 'Resources', 'app'):
        return p.parents[2]
    if p.parts[-2:] == ('resources', 'app'):
        return p.parents[1]
    return None

MAGIC = {b'\x7fELF': 'elf', b'\xcf\xfa\xed\xfe': 'mach-o', b'\xce\xfa\xed\xfe': 'mach-o', b'\xca\xfe\xba\xbe': 'mach-o-universal', b'MZ': 'pe'}

def binary_format(path):
    try:
        with open(path, 'rb') as f:
            head = f.read(4)
    except OSError:
        return None
    return next((v for k, v in MAGIC.items() if head.startswith(k)), None)

# Every native program and library (ELF, Mach-O, PE), not following links, each with its SHA-256: what a manifest can't say.
def natives(root):
    if root is None:
        return None
    out = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not Path(directory, d).is_symlink())
        for name in sorted(files):
            f = Path(directory, name)
            if f.is_symlink() or not f.is_file():
                continue
            kind = binary_format(f)
            if not kind:
                continue
            h = hashlib.sha256()
            with open(f, 'rb') as r:
                for chunk in iter(lambda: r.read(1 << 20), b''):
                    h.update(chunk)
            rel = f.relative_to(root).as_posix()
            out.append(dict(type='file', name=rel, **{'bom-ref': f'file:{rel}'}, hashes=[{'alg': 'SHA-256', 'content': h.hexdigest()}],
                            properties=[{'name': 'kural:binary-format', 'value': kind}]))
    return out

def build(app_root=None, platform=None):
    version = json.loads((ROOT / 'extension/package.json').read_text())['version']
    codium = re.search(r'^# VSCodium (\S+)\.', (ROOT / 'codium.lock').read_text(), re.M)
    if not codium:
        raise ValueError('codium.lock has no VSCodium version')
    components = [dict(type='application', name='VSCodium', version=codium[1], **{'bom-ref': 'vscodium'},
                       licenses=[{'license': {'id': 'MIT'}}], purl=f'pkg:github/VSCodium/vscodium@{codium[1]}'),
                  dict(type='library', name='Codicons', **{'bom-ref': 'codicons'},
                       licenses=[{'license': {'id': 'CC-BY-4.0'}}], purl='pkg:github/microsoft/vscode-codicons')]
    inventory = Path(app_root) if app_root else ROOT / 'node_modules'
    if app_root and not inventory.is_dir():
        raise ValueError('Packaged application root is missing')
    packages = {}
    for directory, dirs, files in os.walk(inventory, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not Path(directory, d).is_symlink())
        manifest = Path(directory, 'package.json')
        if 'package.json' not in files or manifest.is_symlink():
            continue
        package = json.loads(manifest.read_text(encoding='utf-8'))
        if not package.get('name') or not package.get('version'):
            continue
        name, ver = package['name'], str(package['version'])
        ref = f'npm:{name}@{ver}'
        if ref not in packages:
            packages[ref] = dict(type='library', name=name, version=ver, **{'bom-ref': ref},
                purl=f'pkg:npm/{name.replace("@", "%40")}@{quote(ver, safe="")}', properties=[])
            if isinstance(package.get('license'), str):
                packages[ref]['licenses'] = [{'license': {'name': package['license']}}]
        packages[ref]['properties'].append({'name': 'kural:manifest', 'value': manifest.relative_to(inventory).as_posix()})
    if app_root and not packages:
        raise ValueError('Packaged application contains no versioned package manifests')
    components += [packages[k] for k in sorted(packages)]
    # The vendor manifest pins Electron; do not misrepresent declared devDependencies as shipped npm packages.
    if app_root:
        app = json.loads((inventory / 'package.json').read_text()) if (inventory / 'package.json').is_file() else {}
        electron = app.get('devDependencies', {}).get('electron')
        if electron and re.fullmatch(r'\d+\.\d+\.\d+', electron):
            components.append(dict(type='framework', name='Electron', version=electron, **{'bom-ref': 'electron'},
                purl=f'pkg:github/electron/electron@{electron}', properties=[{'name': 'kural:version-source', 'value': 'checksum-pinned-runtime' if app.get('kuralRuntime') else 'vendor-package-manifest'}]))
            if app.get('kuralRuntime'):
                components[-1]['hashes'] = [{'alg': 'SHA-256', 'content': app['kuralRuntime']['sha256']}]
            # What Electron itself contains (Chromium, Node, V8, ...): from the pin, checked against the running
            # runtime at build time (scripts/electron_runtime.py check_bundles).
            pin = json.loads((ROOT / 'vendor/electron-runtime.json').read_text())
            if pin.get('version') == electron:
                for lib, v in sorted(pin.get('bundles', {}).items()):
                    purl = {'chromium': f'pkg:generic/chromium@{v}', 'node': f'pkg:github/nodejs/node@v{v}'}.get(lib, f'pkg:generic/{lib}@{quote(v, safe="")}')
                    components.append(dict(type='library', name=lib, version=v, **{'bom-ref': f'electron:{lib}'}, purl=purl,
                        properties=[{'name': 'kural:bundled-in', 'value': f'Electron {electron}'}]))
    native = natives(install_root(app_root)) if app_root else None
    if native is not None:
        components += native
    properties = [{'name': 'kural:inventory-scope', 'value': 'packaged-application-manifests' if app_root else 'source-only'},
                  {'name': 'kural:native-inventory', 'value': 'all-native-files-hashed' if native is not None else 'none'},
                  {'name': 'kural:inventory-limitations', 'value': "JavaScript bundled into VS Code's own files has no manifest here: it is part of the VSCodium component (see its ThirdPartyNotices.txt). Native files without a version are identified by SHA-256."}]
    if platform:
        properties.append({'name': 'kural:platform', 'value': platform})
    return dict(bomFormat='CycloneDX', specVersion='1.5', version=1,
        metadata=dict(properties=properties, component=dict(type='application', name='Kural Code Editor', version=version,
            **{'bom-ref': 'kural'}, licenses=[{'expression': 'LicenseRef-MIT-Commons-Clause'}])),
        components=components, dependencies=[{'ref': 'kural', 'dependsOn': [c['bom-ref'] for c in components]}])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('out', nargs='?')
    parser.add_argument('--app-root')
    parser.add_argument('--platform')
    args = parser.parse_args()
    bom = build(args.app_root, args.platform)
    text = json.dumps(bom, indent=2) + '\n'
    if args.out:
        out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(text)
    else:
        print(text, end='')
