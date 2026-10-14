// Public keys that may sign Kural releases (SHA256SUMS.sig). The matching private key is only a GitHub Actions
// secret. More than one key so a key can be rotated: add the new one, release, later remove the old one.
module.exports = { RELEASE_PUBLIC_KEYS: [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGiXeNMVcY8EvBnKswLkiWHBKOPwN5YwXZyW4AQ4nnxQ=
-----END PUBLIC KEY-----`,
  // Key #1 (13 Oct 2026): its private key is only in the GitHub environment "release" (v* tags only). Releases after
  // 1.1.0 are signed with it; 1.1.0 is the last one signed with key #0, so rc.1 and older can still update to it
  // (docs/release-signing.md).
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAPc3bDBZuFD6x0+sc9xFu+F5FgHTjw0Ti3y9YBZbuQqI=
-----END PUBLIC KEY-----`,
] };
