import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).resolve().parents[1] / 'scripts/electron_runtime.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class RuntimeTests(unittest.TestCase):
    def test_mac_frameworks_and_bundle_identity(self):
        original = d.ROOT
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'Vendor.app'
            manifest = app / 'Contents/Resources/app/package.json'
            manifest.parent.mkdir(parents=True)
            manifest.write_text(json.dumps({'devDependencies': {'electron': '42.8.1'}}))
            wire = d.SENTINEL + bytes([1, 9]) + b'101100011'
            files = {}
            for name in ('Electron Framework.framework', 'Mantle.framework', 'ReactiveObjC.framework', 'Squirrel.framework'):
                relative = f'Frameworks/{name}/Versions/A/{name[:-10]}'
                old = app / 'Contents' / relative
                old.parent.mkdir(parents=True)
                old.write_bytes(wire + b'old' if name.startswith('Electron') else b'old')
                files[f'Electron.app/Contents/{relative}'] = wire + b'new' if name.startswith('Electron') else b'new'
            main = app / 'Contents/MacOS/VSCodium'
            main.parent.mkdir(parents=True); main.write_bytes(b'old')
            files['Electron.app/Contents/MacOS/Electron'] = b'new'
            for suffix in ('', ' (GPU)', ' (Plugin)', ' (Renderer)'):
                old = app / f'Contents/Frameworks/VSCodium Helper{suffix}.app/Contents'
                (old / 'MacOS').mkdir(parents=True)
                (old / f'MacOS/VSCodium Helper{suffix}').write_bytes(b'old')
                (old / 'Info.plist').write_bytes(b'vendor identity')
                files[f'Electron.app/Contents/Frameworks/Electron Helper{suffix}.app/Contents/MacOS/Electron Helper{suffix}'] = b'new'
            (app / 'Contents/Info.plist').write_bytes(b'vendor main identity')
            archive = root / 'mac.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                for name, data in files.items(): z.writestr(name, data)
            (root / 'vendor').mkdir()
            pin = {'version': '42.11.12', 'replaces': '42.8.1', 'fuses': '101100011',
                   'platforms': {'darwin-arm64': hashlib.sha256(archive.read_bytes()).hexdigest()}}
            (root / 'vendor/electron-runtime.json').write_text(json.dumps(pin))
            d.ROOT = root
            try:
                d.install(app, 'darwin-arm64', archive)
                self.assertEqual((app / 'Contents/Info.plist').read_bytes(), b'vendor main identity')
                for name in ('Mantle', 'ReactiveObjC', 'Squirrel'):
                    self.assertEqual((app / f'Contents/Frameworks/{name}.framework/Versions/A/{name}').read_bytes(), b'new')
                for suffix in ('', ' (GPU)', ' (Plugin)', ' (Renderer)'):
                    helper = app / f'Contents/Frameworks/VSCodium Helper{suffix}.app/Contents'
                    self.assertEqual((helper / 'Info.plist').read_bytes(), b'vendor identity')
                    self.assertEqual((helper / f'MacOS/VSCodium Helper{suffix}').read_bytes(), b'new')
            finally:
                d.ROOT = original

    def test_python310_hashing(self):
        # Ubuntu 22.04 ships Python 3.10, before hashlib.file_digest was introduced.
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'archive'
            archive.write_bytes(b'fixture' * (1 << 18))
            expected = hashlib.sha256(archive.read_bytes()).hexdigest()
            original = getattr(hashlib, 'file_digest', None)
            if original is not None:
                del hashlib.file_digest
            try:
                d.verify(archive, expected)
            finally:
                if original is not None:
                    hashlib.file_digest = original

    def test_archive_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            # (On Windows zipfile itself turns 'folder\\outside' into 'folder/outside', a harmless subfolder.)
            for name in ('../outside', '/outside', 'C:/outside', 'a/../b') + (() if os.name == 'nt' else ('folder\\outside',)):
                archive = root / 'bad.zip'
                with zipfile.ZipFile(archive, 'w') as z:
                    z.writestr(name, b'harmless')
                with self.assertRaises(ValueError):
                    d.extract(archive, root / 'stage')
            with zipfile.ZipFile(archive, 'w') as z:
                link = zipfile.ZipInfo('link')
                link.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(link, '../../outside')
            with self.assertRaises(ValueError):
                d.extract(archive, root / 'stage')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                d.verify(archive, '0' * 64)
            self.assertFalse((root / 'outside').exists())

    def test_complete_overlay_and_fuses(self):
        original = d.ROOT
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'app'
            manifest = app / 'resources/app/package.json'
            manifest.parent.mkdir(parents=True)
            manifest.write_text(json.dumps({'name': 'editor', 'devDependencies': {'electron': '42.8.1'}}))
            marker = manifest.parent / 'editor.js'
            marker.write_text('preserve the editor')
            wire = d.SENTINEL + bytes([1, 9]) + b'101100011'
            (app / 'codium').write_bytes(wire + b'old')
            (app / 'chrome-sandbox').write_bytes(b'old sandbox')
            (app / 'chrome-sandbox').chmod(0o4755)
            (app / 'libEGL.so').write_bytes(b'old library')
            archive = root / 'electron.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                for name, data in {'electron': wire + b'new', 'chrome-sandbox': b'new sandbox',
                                   'libEGL.so': b'new library', 'locales/en-US.pak': b'new locale',
                                   'resources/default_app.asar': b'never install'}.items():
                    z.writestr(name, data)
            (root / 'vendor').mkdir()
            pin = {'version': '42.11.12', 'replaces': '42.8.1', 'fuses': '101100011',
                   'platforms': {'linux-x64': hashlib.sha256(archive.read_bytes()).hexdigest()}}
            (root / 'vendor/electron-runtime.json').write_text(json.dumps(pin))
            d.ROOT = root
            try:
                (app / 'codium').write_bytes(wire[:-1] + b'0old')
                with self.assertRaisesRegex(ValueError, 'fuses'):
                    d.install(app, 'linux-x64', archive)
                self.assertEqual((app / 'libEGL.so').read_bytes(), b'old library')
                (app / 'codium').write_bytes(wire + b'old')
                d.install(app, 'linux-x64', archive)
                self.assertEqual((app / 'codium').read_bytes(), wire + b'new')
                self.assertEqual((app / 'libEGL.so').read_bytes(), b'new library')
                self.assertEqual((app / 'locales/en-US.pak').read_bytes(), b'new locale')
                if os.name != 'nt':   # (no setuid bit on Windows)
                    self.assertEqual(stat.S_IMODE((app / 'chrome-sandbox').stat().st_mode), 0o4755)
                self.assertEqual(marker.read_text(), 'preserve the editor')
                self.assertFalse((app / 'resources/default_app.asar').exists())
                self.assertEqual(json.loads(manifest.read_text())['kuralRuntime']['version'], '42.11.12')
                with self.assertRaisesRegex(ValueError, 'vendor Electron version'):
                    d.install(app, 'linux-x64', archive)
            finally:
                d.ROOT = original

    def test_bundled_versions_checked_against_the_running_runtime(self):
        # DEP-001: the SBOM's Chromium/Node versions come from the pin; the build asks the new runtime and refuses a mismatch.
        import platform, sys
        if platform.system() != 'Linux':
            self.skipTest('runs the Linux runtime stand-in')
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp)
            pin = {'version': '42.0.0', 'bundles': {'chromium': '148.0.1', 'node': '24.1.0', 'libuv': '1.5.0'}}
            def runtime(versions):
                exe = app / 'codium'
                exe.write_text(f'#!{sys.executable}\nimport json\nprint(json.dumps({versions!r}))\n')
                exe.chmod(0o755)
            runtime({'electron': '42.0.0', 'chrome': '148.0.1', 'node': '24.1.0', 'uv': '1.5.0'})
            d.check_bundles(app, 'linux-x64', pin)
            runtime({'electron': '42.0.0', 'chrome': '147.9.9', 'node': '24.1.0', 'uv': '1.5.0'})
            with self.assertRaises(ValueError):
                d.check_bundles(app, 'linux-x64', pin)
            d.check_bundles(app, 'win32-x64', pin)   # (a Windows build on Linux can't run it: says so, doesn't fail)


if __name__ == '__main__':
    unittest.main()
