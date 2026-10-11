# RELEASE SECURITY

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Distributed artifacts actually inspected

Downloaded all five v1.1.0-alpha.8 binary formats plus SHA256SUMS, signature and published SBOM. Ed25519 manifest verification: **PASS**, key #0. All five SHA-256 digests match the signed list; digest evidence in other-artifact-integrity.json and release manifest. Extracted Linux DEB and both platform ZIPs. Windows setup PE header and macOS root/four helper CodeDirectories inspected without execution. No unexpected .env, id_rsa, id_ed25519, sign.pfx or auth.json filename found in ZIP scan; this is not a full binary secret scan.

| Assurance | Result | Meaning / limitation |
| --- | --- | --- |
| File hash | PASS | Bytes match named checksum |
| Ed25519 manifest signature | PASS | Trusted embedded release key authenticated checksum list |
| Source revision provenance | NOT TESTED | Artifact lacks Kural build.json; upstream commit known, Kural exact build SHA not verified via attestations |
| macOS Developer ID | FAIL | Inspected CodeDirectory flags=2, ad-hoc; no publisher identity |
| macOS notarization / stapling / Gatekeeper | NOT TESTED | Native tools/environment missing |
| Windows installer Authenticode | FAIL | PE security directory offset0/size0 |
| Windows reputation/certificate-chain behavior | NOT TESTED | Native Windows missing |
| Ubuntu installed permissions / scripts | NOT TESTED | Static source and archive review; no install/postinst execution |
| Local fixed DEB build | PASS | Packaged changed extension files match source; not installed/signed/released |

The workflow includes attest-build-provenance but no attestation was cryptographically fetched/verified here. Do not equate signing checksum list, artifact attestation, platform signature and notarization. None alone proves source correctness.

## Update security

Existing updater already requires signed manifest and artifact hash. SEC-005 now rejects complete malformed tags before mac shell generation. SEC-006 now binds requested advancing version to exact signed asset filename and rejects duplicate/path-bearing checksum entries. Regression uses disposable Ed25519 keys; no production key accessed. Attacker model: GitHub release metadata access without checksum signing key. Signing-key compromise is outside this mitigation. Same signer can intentionally label vulnerable bytes as a new release; anti-rollback is not a content-security guarantee.

macOS swap logic retains backups and checks candidate app shape; Linux/Windows invoke platform installer paths. Simulated swap/recovery tests are useful but cannot establish native termination, installation permissions, Gatekeeper/UAC, power-loss recovery or user-data survival. updates-script fixture remains failing, requiring native reproduction. No real update/install or uninstall run against user data.

## Release engineering blockers

### REL-001 — Published Windows installer lacks embedded Authenticode

- Severity / confidence / classification: **Medium / High / CONFIRMED**.
- Component / operating systems: `scripts/sign-win.sh`; Windows x64.
- Current location: `scripts/sign-win.sh:9`; baseline: `scripts/sign-win.sh:9` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-345; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Release Windows signing is optional; actual alpha.8 installer PE certificate directory is empty.
- Reproduction: Parse PE optional-header security directory from checksum-verified setup.exe: offset=0,size=0.
- Expected: Public installer identifies a verified publisher under the chosen distribution policy.
- Actual: No embedded Authenticode present.
- Impact: Initial installation lacks OS publisher authentication; SHA256SUMS signature is a different trust mechanism. SmartScreen reputation is NOT TESTED.
- Remediation: Configure protected publisher signing, sign installer/uninstaller and relevant executables, timestamp and verify chains on Windows.
- Regression / verification requirement: `Get-AuthenticodeSignature and native install/uninstall validation.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **DEFERRED**; No production/source upgrade or infrastructure change applied; follow-up in REMEDIATION_PLAN.md.
### REL-002 — Published macOS executables use ad-hoc signatures

- Severity / confidence / classification: **Medium / High / CONFIRMED**.
- Component / operating systems: `build-mac.sh`; macOS arm64.
- Current location: `build-mac.sh:77`; baseline: `build-mac.sh:77` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-345; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Build signs with ad-hoc identity; Mach-O CodeDirectory flags contain CS_ADHOC in the published ZIP.
- Reproduction: Parse root executable and four helper signatures in checksum-verified ZIP; flag value2/adHoc=true.
- Expected: Developer ID identity and notarized distribution if intended for normal Gatekeeper install.
- Actual: Ad-hoc signatures in inspected executables; notarization acceptance NOT TESTED.
- Impact: OS publisher identity/Gatekeeper release readiness is not established.
- Remediation: Use protected Developer ID signing with reviewed entitlements and notarization/stapling; verify on native macOS. Do not remove quarantine as a substitute.
- Regression / verification requirement: `codesign --verify --deep --strict; spctl assessment; stapler validate; fresh quarantined install.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **DEFERRED**; No production/source upgrade or infrastructure change applied; follow-up in REMEDIATION_PLAN.md.
## Local candidate

Final DEB produced from patched extension with existing vendor pin and unchanged alpha.8 version solely for audit validation. See build-measurement.json and final-package-verification.json for digest, byte count and changed-file equality. It is **not a distributable approved release**, remains on vulnerable Electron, and must not overwrite the published same-version asset. Next approved release needs a new version, patched vendor runtime, platform builds, tests, signing and verified provenance. No keys rotated, releases modified or repository infrastructure settings changed. This follow-up authorizes pushing the security branch/PR only.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.
