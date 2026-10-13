#!/usr/bin/env node
// Compatibility API; Python is already required by all platform builds.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
function build({ appRoot, platform } = {}) {
  const args = [path.join(__dirname, 'sbom.py')];
  if (appRoot) args.push('--app-root', appRoot);
  if (platform) args.push('--platform', platform);
  const r = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || 'SBOM generation failed');
  const bom = JSON.parse(r.stdout);
  return { ver: bom.metadata.component.version, bom };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); if (i < 0) return undefined;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    return args[i + 1]; };
  const { ver, bom } = build({ appRoot: option('--app-root'), platform: option('--platform') });
  const out = args[0] && !args[0].startsWith('--') ? args[0] : path.join(__dirname, '..', 'dist', `kural-${ver}.cdx.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(bom, null, 2) + '\n');
  console.log(`wrote ${out}`);
}
module.exports = { build };
