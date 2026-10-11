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

## Follow-up changes

Publisher credentials have moved from Windows job-wide environment into the release-push-gated build step. The disposable signing check remains credential-free. Packaged per-platform SBOMs are uploaded with their artifacts; release generation requires all three, validates version/platform/scope, and hashes the platform inventory references before signing the checksum list. Separate protected signing, effective tag protection, Authenticode certificates, Developer ID and notarization remain owner/release follow-ups.

## Verified follow-up code revision

Application/build code revision: `b4c03486781d6427682ca47716efe71bd725fe34` (dependency change `39846146055280720a35d1c06d27215863d69b3e`). [Build run 38125659529](https://github.com/adithyakumarcr/kural/actions/runs/38125659529) completed successfully: full test job, Linux build, macOS DMG/startup, Windows build/install/startup, Ubuntu 22.04 and 24.04 install/startup. Release job was skipped. [CodeQL run 38125659585](https://github.com/adithyakumarcr/kural/actions/runs/38125659585) PASS. These are executed automated checks, not full platform acceptance or proof of security. The intermediate 3984614 build failed; b4c0348 corrected the rebranding dependency fixture and executable packaging modes.

Local full-run result remains 76/82 (exit1); corrected rebranding fixture and provider timing failures passed direct reruns. Process-inventory, socket and helper-liveness local failures remain documented. A CycloneDX schema validation attempt could not run because Python jsonschema is unavailable; structural regression tests passed, so formal schema validation is not claimed. The final report update changes Markdown only; code validation is bound to the above SHA.

## Electron runtime follow-up — 2026-10-11

SEC-009 is now **PARTIALLY FIXED / NATIVE VALIDATION PENDING**. All three packaging scripts replace the complete Electron runtime distribution with official **42.11.12** archives, independently pinned by SHA-256 in `vendor/electron-runtime.json`. VSCodium application code stays on 1.135.06055. The patch retains the vendor fuse wire `101100011`, Linux sandbox permissions and macOS bundle identities. Existing platform signing happens after replacement. Unknown vendor versions, changed fuses, checksum mismatches and unsafe ZIP paths/links fail the build. There is no claim that checksums constitute platform signing or notarization.

Before reproduction: original embedded Linux runtime reported Electron 42.8.1 / Node 24.18.1 / modules ABI 146. After replacement: actual embedded executable reports Electron 42.11.12 / Node 24.19.0 / ABI 146. Node-pty, Parcel watcher and SQLite native bindings load under the replacement runtime. OSV queried for npm Electron 42.11.12 returned no published advisories; this does not prove absence of vulnerabilities. Linux DEB rebuild PASS, and its SBOM records the pinned runtime/archive digest. Verified Windows and macOS vendor archives accept the replacements under Linux staging; **that is not native execution**. Fresh native build/install/startup CI must pass before closing SEC-009.

Commands: `node test/electron-runtime.test.js` PASS (2 Python regression cases), `node test/sbom.test.js` PASS, `node test/codium-lock.test.js` PASS; `./make-deb.sh` PASS; `python3 scripts/electron_runtime.py <staged-app> <platform> --archive <pinned-archive>` PASS for each target. The new CI checks execute each installed runtime and assert Electron 42.11.12 and ABI 146, followed by the existing real-window startup tests. Full suite and fresh CI results are pending at this report revision.

SEC-012 remains **OPEN**. A checksum-verified real Antigravity CLI 1.3.3 was obtained and its help examined. Official pre-execution hooks exist, but are loaded from user/workspace configuration. A mandatory per-chat configuration path protected from untrusted project configuration has not been established. A no-provider-call `/hooks` probe required authentication and was interrupted; no login or paid API call occurred. No speculative hook patch was shipped, and Gemini was not disabled. This needs an approval-capable adapter with real denial-before-mutation, hook-tampering, failure/timeout, transition and handoff tests. The authorization issue is engineering capability/validation, not missing permission to change source.

Reviewer scope: **added** pinned runtime archives/installer, security regression tests, native runtime version/ABI checks and SBOM archive provenance; **replaced** Electron 42.8.1 runtime bytes during packaging; **removed** no editor or provider functionality. Public alpha.8 binaries are unchanged until a separately approved release ships. Overall recommendation remains **NO-GO**, including open Gemini enforcement, signing/repository protection requirements and incomplete broader acceptance.
