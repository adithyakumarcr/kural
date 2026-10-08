// Public keys that may sign Kural releases (SHA256SUMS.sig). The matching private key is only a GitHub Actions
// secret. More than one key so a key can be rotated: add the new one, release, later remove the old one.
module.exports = { RELEASE_PUBLIC_KEYS: [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbw1uvx2m0B449L88Hi7JGYbRYzrBt4UZFK4BWXEHF2w=
-----END PUBLIC KEY-----`,
] };
