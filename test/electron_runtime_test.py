import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).resolve().parents[1] / 'scripts/electron_runtime.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class RuntimeTests(unittest.TestCase):
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
            for name in ('../outside', '/outside', 'C:/outside', 'folder\\outside', 'a/../b'):
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
                self.assertEqual(stat.S_IMODE((app / 'chrome-sandbox').stat().st_mode), 0o4755)
                self.assertEqual(marker.read_text(), 'preserve the editor')
                self.assertFalse((app / 'resources/default_app.asar').exists())
                self.assertEqual(json.loads(manifest.read_text())['kuralRuntime']['version'], '42.11.12')
                with self.assertRaisesRegex(ValueError, 'vendor Electron version'):
                    d.install(app, 'linux-x64', archive)
            finally:
                d.ROOT = original


if __name__ == '__main__':
    unittest.main()
