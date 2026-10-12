const assert = require("assert");
const { build } = require("../scripts/sbom");
const { bom, ver } = build();
assert.strictEqual(bom.bomFormat, "CycloneDX");
assert.strictEqual(bom.specVersion, "1.5");
assert.strictEqual(bom.metadata.component.version, ver);
const names = bom.components.map((c) => c.name);
assert(names.includes("VSCodium") && names.includes("Codicons"));
assert(bom.components.find((c) => c.name === "VSCodium").version.match(/^\d+(\.\d+)+$/));
JSON.parse(JSON.stringify(bom));
console.log("sbom ok");
// Nested/scoped shipped packages, multiple versions, deterministic paths and symlink containment.
const fs = require('fs'), os = require('os'), path = require('path');
const { merge } = require('../scripts/sbom-release');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kural-sbom-'));
try {
  const app = path.join(tmp, 'inst', 'resources', 'app');
  for (const [rel, name, version] of [['node_modules/@scope/one', '@scope/one', '1.0.0'],
      ['node_modules/outer/node_modules/one', '@scope/one', '2.0.0']]) {
    fs.mkdirSync(path.join(app, rel), { recursive: true });
    fs.writeFileSync(path.join(app, rel, 'package.json'), JSON.stringify({ name, version,
      scripts: { postinstall: 'THIS MUST NEVER EXECUTE' } }));
  }
  const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'private-outside', version: '1.0.0' }));
  if (process.platform !== 'win32') fs.symlinkSync(outside, path.join(app, 'escape'), 'dir');
  // DEP-001: native files of the whole install, hashed (links not followed), and Electron's bundled libraries.
  const inst = path.join(tmp, 'inst');
  fs.writeFileSync(path.join(inst, 'kural'), Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('elf')]));
  fs.mkdirSync(path.join(inst, 'lib')); fs.writeFileSync(path.join(inst, 'lib', 'x.dll'), 'MZ fake pe');
  fs.writeFileSync(path.join(inst, 'notes.txt'), 'not a binary');
  if (process.platform !== 'win32') fs.symlinkSync(path.join(inst, 'kural'), path.join(inst, 'link-to-kural'));
  const pin = require('../vendor/electron-runtime.json');
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'code-oss', version: '1.0.0', devDependencies: { electron: pin.version } }));
  const result = build({ appRoot: app, platform: 'linux-x64' }).bom;
  const files = result.components.filter((c) => c.type === 'file');
  assert.deepStrictEqual(files.map((c) => c.name), ['kural', 'lib/x.dll']);
  assert.strictEqual(files[0].hashes[0].content, require('crypto').createHash('sha256').update(fs.readFileSync(path.join(inst, 'kural'))).digest('hex'));
  assert.ok(result.metadata.properties.some((p) => p.name === 'kural:native-inventory' && p.value === 'all-native-files-hashed'));
  const lib = (n) => result.components.find((c) => c['bom-ref'] === `electron:${n}`);
  assert.strictEqual(lib('chromium').version, pin.bundles.chromium);
  assert.strictEqual(lib('node').purl, `pkg:github/nodejs/node@v${pin.bundles.node}`);
  assert.deepStrictEqual(build({ appRoot: app, platform: 'linux-x64' }).bom, result);
  assert.strictEqual(result.components.filter(c => c.name === '@scope/one').length, 2);
  assert(!JSON.stringify(result).includes(tmp));
  assert(!result.components.some(c => c.name === 'private-outside'));
  assert.throws(() => build({ appRoot: path.join(tmp, 'missing') }));
  assert.throws(() => merge(tmp, ver), /ENOENT/);
  for (const platform of ['linux-x64', 'macos-arm64', 'windows-x64'])
    fs.writeFileSync(path.join(tmp, `kural-${ver}-${platform}.cdx.json`), JSON.stringify(build({ appRoot: app, platform }).bom));
  assert.strictEqual(merge(tmp, ver).externalReferences.length, 3);
  // An inventory of just resources/app (no native files) is not enough for a release.
  const bare = path.join(tmp, 'bare'); fs.mkdirSync(path.join(bare, 'node_modules/a'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'node_modules/a/package.json'), JSON.stringify({ name: 'a', version: '1.0.0' }));
  fs.writeFileSync(path.join(tmp, `kural-${ver}-macos-arm64.cdx.json`), JSON.stringify(build({ appRoot: bare, platform: 'macos-arm64' }).bom));
  assert.throws(() => merge(tmp, ver), /Invalid packaged inventory/);
  fs.writeFileSync(path.join(tmp, `kural-${ver}-macos-arm64.cdx.json`), JSON.stringify(build({ appRoot: app, platform: 'macos-arm64' }).bom));
  fs.writeFileSync(path.join(tmp, `kural-${ver}-windows-x64.cdx.json`), JSON.stringify(bom));
  assert.throws(() => merge(tmp, ver), /Invalid packaged inventory/);
  console.log('packaged SBOM recursion, containment, multi-platform completeness PASS');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
