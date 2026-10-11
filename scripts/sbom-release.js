#!/usr/bin/env node
// Release inventory assembled from platform builds. Missing/incomplete inventories stop publishing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const targets = ['linux-x64', 'macos-arm64', 'windows-x64'];
function merge(dir, version) {
  const components = new Map();
  const inventories = targets.map(platform => {
    const name = `kural-${version}-${platform}.cdx.json`;
    const bytes = fs.readFileSync(path.join(dir, name));
    const bom = JSON.parse(bytes);
    const props = bom.metadata?.properties || [];
    if (bom.bomFormat !== 'CycloneDX' || bom.metadata?.component?.version !== version ||
        !props.some(p => p.name === 'kural:platform' && p.value === platform) ||
        !props.some(p => p.name === 'kural:inventory-scope' && p.value === 'packaged-application-manifests') ||
        !bom.components?.some(c => c['bom-ref']?.startsWith('npm:')))
      throw new Error(`Invalid packaged inventory: ${name}`);
    for (const c of bom.components) {
      // Keep platform manifests separate: packages may differ despite identical names/versions.
      const ref = `${platform}:${c['bom-ref']}`;
      components.set(ref, { ...c, 'bom-ref': ref,
        properties: [...(c.properties || []), { name: 'kural:platform', value: platform }] });
    }
    return { type: 'bom', url: name, hashes: [{ alg: 'SHA-256', content: crypto.createHash('sha256').update(bytes).digest('hex') }] };
  });
  return { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { component: { type: 'application', 'bom-ref': 'kural', name: 'Kural Code Editor', version },
      properties: [{ name: 'kural:inventory-scope', value: 'packaged-application-manifests' },
        { name: 'kural:inventory-limitations', value: 'Native binaries and JavaScript without manifests are not a complete transitive dependency inventory' }] },
    externalReferences: inventories, components: [...components.values()],
    dependencies: [{ ref: 'kural', dependsOn: [...components.keys()] }] };
}
if (require.main === module) {
  const version = require('../extension/package.json').version;
  const dir = process.argv[2] || 'dist';
  fs.writeFileSync(path.join(dir, `kural-${version}.cdx.json`), JSON.stringify(merge(dir, version), null, 2) + '\n');
}
module.exports = { merge };
