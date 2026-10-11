"""Replace an affected vendor dependency with a reviewed, hash-pinned upstream package."""
import hashlib, json, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

def install(app):
    app = Path(app).resolve()
    pins = json.loads((ROOT / 'vendor/runtime-dependencies.json').read_text())
    for name, pin in pins.items():
        source = ROOT / 'vendor' / name
        # Check every byte before changing the staging tree. Never run npm lifecycle scripts.
        actual = {p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file() and not p.is_symlink()}
        if actual != set(pin['files']) or any(p.is_symlink() for p in source.rglob("*")):
            raise ValueError(f'Unexpected vendored files: {name}')
        for rel, digest in pin['files'].items():
            if hashlib.sha256((source / rel).read_bytes()).hexdigest() != digest:
                raise ValueError(f'Vendored dependency integrity mismatch: {name}/{rel}')
        package = json.loads((source / 'package.json').read_text())
        if package['name'] != name or package['version'] != pin['version'] or package.get('dependencies'):
            raise ValueError(f'Vendored dependency metadata mismatch: {name}')
        target = app / 'node_modules' / name
        if target.is_symlink() or not target.resolve().is_relative_to(app):
            raise ValueError(f'Dependency target escapes staging tree: {name}')
        current = json.loads((target / 'package.json').read_text())
        if current['name'] != name or current['version'] not in pin['replaces']:
            raise ValueError(f'Unreviewed vendor dependency version: {name}')
        shutil.rmtree(target)
        shutil.copytree(source, target)
