// Security contract: PR-controlled Windows build scripts must not receive publisher credentials.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build.yml'), 'utf8');
const windows = /^  windows:\n([\s\S]*?)(?=^  [\w-]+:)/m.exec(workflow)[1];
const expected = ['WINDOWS_SIGN_STORETYPE', 'WINDOWS_SIGN_KEYSTORE', 'WINDOWS_SIGN_STOREPASS',
  'WINDOWS_SIGN_ALIAS', 'WINDOWS_SIGN_KEYPASS', 'WINDOWS_SIGN_TSA', 'WINDOWS_SIGN_PFX_BASE64',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'];
const lines = windows.split('\n').filter(l => /\bsecrets\./.test(l));
assert.strictEqual(lines.length, expected.length, 'review every signing-secret binding');
for (const secret of expected) {
  const line = lines.find(l => l.includes(`secrets.${secret} `));
  assert.ok(line, `missing ${secret}`);
  assert.ok(line.includes("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') &&"),
    `${secret} must require both a push event and release tag`);
  assert.ok(line.endsWith("|| '' }}"), `${secret} must be empty outside release pushes`);
}
assert.ok(windows.includes('./scripts/sign-win-check.sh'), 'retain disposable signing verification on PR builds');
console.log('audit-ci: all ten publisher credential bindings are release-push-only; disposable signing check retained PASS');
