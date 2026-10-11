// Security regressions for the checksum-pinned, complete runtime replacement.
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync('python3', [path.join(__dirname, 'electron_runtime_test.py')], { encoding: 'utf8' });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
process.exit(r.status === null ? 1 : r.status);
