// Reproduce CVE-2026-102422 without executing its shell output; verify packaged replacement.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const quote = require('../vendor/shell-quote').quote;
for (const separator of ['\n', '\r', '\u2028', '\u2029'])
  assert.throws(() => quote([{ comment: 'untrusted' }, `harmless${separator}echo AUDIT_MARKER`]), TypeError);
assert.strictEqual(quote(['safe', 'space here']), "safe 'space here'");
assert.deepStrictEqual(require('../vendor/shell-quote').parse("one 'two three'"), ['one', 'two three']);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kural-runtime-'));
try {
  const target = path.join(tmp, 'node_modules', 'shell-quote');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'shell-quote', version: '1.10.0' }));
  fs.writeFileSync(path.join(target, 'obsolete.js'), 'must be removed');
  const run = () => spawnSync('python3', ['-c', 'from runtime_dependencies import install; import sys; install(sys.argv[1])', tmp],
    { cwd: path.join(root, 'scripts'), encoding: 'utf8' });
  let r = run(); assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(target, 'package.json'))).version, '1.11.0');
  assert(!fs.existsSync(path.join(target, 'obsolete.js')));
  assert.throws(() => require(target).quote([{ comment: 'x' }, 'safe\necho AUDIT_MARKER']), TypeError);
  r = run(); assert.strictEqual(r.status, 0, r.stderr); // repeat build
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'shell-quote', version: '9.0.0' }));
  assert.notStrictEqual(run().status, 0, 'unknown vendor version must require review');
  const fakeRoot = path.join(tmp, 'fixture-root');
  fs.mkdirSync(fakeRoot); fs.cpSync(path.join(root, 'vendor'), path.join(fakeRoot, 'vendor'), { recursive: true });
  fs.appendFileSync(path.join(fakeRoot, 'vendor/shell-quote/quote.js'), '\n// corrupted fixture\n');
  const corrupt = spawnSync('python3', ['-c',
    'import runtime_dependencies as d; from pathlib import Path; import sys; d.ROOT=Path(sys.argv[2]); d.install(sys.argv[1])', tmp, fakeRoot],
    { cwd: path.join(root, 'scripts'), encoding: 'utf8' });
  assert.notStrictEqual(corrupt.status, 0);
  assert(corrupt.stderr.includes('integrity mismatch'), 'altered vendor bytes rejected before staging mutation');
  if (process.platform !== 'win32') {
    fs.rmSync(target, { recursive: true }); fs.symlinkSync(os.tmpdir(), target);
    assert.notStrictEqual(run().status, 0, 'outside staging symlink must be rejected');
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('runtime dependency replacement, fixed quotation, version/integrity guards PASS');
