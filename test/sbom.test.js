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
  const app = path.join(tmp, 'app');
  for (const [rel, name, version] of [['node_modules/@scope/one', '@scope/one', '1.0.0'],
      ['node_modules/outer/node_modules/one', '@scope/one', '2.0.0']]) {
    fs.mkdirSync(path.join(app, rel), { recursive: true });
    fs.writeFileSync(path.join(app, rel, 'package.json'), JSON.stringify({ name, version,
      scripts: { postinstall: 'THIS MUST NEVER EXECUTE' } }));
  }
  const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'private-outside', version: '1.0.0' }));
  if (process.platform !== 'win32') fs.symlinkSync(outside, path.join(app, 'escape'), 'dir');
  const result = build({ appRoot: app, platform: 'linux-x64' }).bom;
  assert.deepStrictEqual(build({ appRoot: app, platform: 'linux-x64' }).bom, result);
  assert.strictEqual(result.components.filter(c => c.name === '@scope/one').length, 2);
  assert(!JSON.stringify(result).includes(tmp));
  assert(!result.components.some(c => c.name === 'private-outside'));
  assert.throws(() => build({ appRoot: path.join(tmp, 'missing') }));
  assert.throws(() => merge(tmp, ver), /ENOENT/);
  for (const platform of ['linux-x64', 'macos-arm64', 'windows-x64'])
    fs.writeFileSync(path.join(tmp, `kural-${ver}-${platform}.cdx.json`), JSON.stringify(build({ appRoot: app, platform }).bom));
  assert.strictEqual(merge(tmp, ver).externalReferences.length, 3);
  fs.writeFileSync(path.join(tmp, `kural-${ver}-windows-x64.cdx.json`), JSON.stringify(bom));
  assert.throws(() => merge(tmp, ver), /Invalid packaged inventory/);
  console.log('packaged SBOM recursion, containment, multi-platform completeness PASS');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
