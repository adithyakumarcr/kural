# Security

## Supported versions

Only the newest final release (and the newest test version, for people who use test versions) gets security fixes.
Please update first (Kural checks once a day, or Help > Check for Updates).

## Reporting a vulnerability

Please don't open a public issue for a security problem.

- Use GitHub's private reporting: https://github.com/adithyakumarcr/kural/security/advisories/new
- Or email adithyakumarcr(at)hotmail(dot)com.

What to expect: an answer within 7 days, and a fix or a workaround within 90 days. If you like, you're credited in the
release notes.

## Scope

Kural's own code (the extension, the build scripts, the updater, the release workflow). Problems in VSCodium, VS Code or
Chromium belong to those projects; Kural ships their fixed version in its next release (a weekly check opens a pull
request as soon as a new VSCodium or Electron is out).

Releases are signed: see [docs/release-signing.md](docs/release-signing.md) for how to verify a download. How Kural
protects you is in [docs/threat-model.md](docs/threat-model.md); what the October 2026 security review found and fixed
is in [docs/security-audit.md](docs/security-audit.md).
