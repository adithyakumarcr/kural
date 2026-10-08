// Public keys that may sign Kural releases (SHA256SUMS.sig). The matching private key is only a GitHub Actions
// secret. More than one key so a key can be rotated: add the new one, release, later remove the old one.
module.exports = { RELEASE_PUBLIC_KEYS: [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGiXeNMVcY8EvBnKswLkiWHBKOPwN5YwXZyW4AQ4nnxQ=
-----END PUBLIC KEY-----`,
] };
