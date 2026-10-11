#!/usr/bin/env python3
"""Manifest inventory of a packaged application. Does not run hooks or follow symlinks."""
import argparse, json, os, re
from pathlib import Path
from urllib.parse import quote
ROOT = Path(__file__).resolve().parent.parent

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
                purl=f'pkg:github/electron/electron@{electron}', properties=[{'name': 'kural:version-source', 'value': 'vendor-package-manifest'}]))
    properties = [{'name': 'kural:inventory-scope', 'value': 'packaged-application-manifests' if app_root else 'source-only'},
                  {'name': 'kural:inventory-limitations', 'value': 'Native binaries and JavaScript without manifests require separate analysis; Electron version is vendor-declared'}]
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
