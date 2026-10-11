# DEPENDENCY AUDIT

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Inventory and tool scope

Root package/package-lock contain no third-party npm dependencies; extension has no runtime npm dependencies. npm audit reports zero known findings for that empty scope. The application still inherits a large vendor dependency graph. Extracted release: 118 package manifests, 109 named/versioned packages; additional compiled/bundled/native dependencies are not fully inventoried. Measured runtime: Electron 42.8.1, Chromium 148.0.7778.280, Node 24.18.1, V8 14.8.178.38-electron.0, SQLite 3.53.1. See runtime-versions.json and bundled-dependencies.json.

OSV querybatch scanned 10 distinct ecosystem/name/version pairs from runtime-node_modules plus Electron; 2 packages returned 5 advisories. Built-in extension manifests are mostly VSCode identities, not necessarily npm packages. No full transitive graph or Chromium/Node native-CVE scan was completed. OSV results are not blanket proof of exploitability.

| Package | Observed | Advisory / CVE | Fix on relevant branch | Application applicability |
| --- | --- | --- | --- | --- |
| Electron | 42.8.1 | GHSA-qmv3-fv6v-rmhq / CVE-2026-102677 | 42.10.0 | Preload cache poisoning requires compromised renderer and untrusted content. Known affected runtime; exploit NOT TESTED |
| Electron | 42.8.1 | GHSA-9qh4-3jw8-366w / CVE-2026-102676 | 42.9.2 | Requires enabled webview tag and unsandboxed embedder. Selected extracted main code shows sandbox:true/webviewTag:false; all contexts NOT VERIFIED |
| Electron | 42.8.1 | GHSA-gr2m-v5gq-v685 / CVE-2026-102674 | 42.9.2 | Requires sandboxed top-level content allowed to open popups; popup policy needs native review |
| Electron | 42.8.1 | GHSA-j84w-jfhq-vhvj / CVE-2026-102675 | 42.9.2 | Custom file/HTTP protocol plus supportFetchAPI without corsEnabled; such handlers exist in upstream bundle, complete scheme flags/reachability NOT VERIFIED |
| shell-quote | 1.10.0 | GHSA-pqg4-j6r4-53mv / CVE-2026-102422 | 1.11.0 | Library reproducer confirms unsafe comment/newline output; Kural caller exploitability SUSPECTED |

Authoritative references: [Electron preload advisory](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq), [webview advisory](https://github.com/electron/electron/security/advisories/GHSA-9qh4-3jw8-366w), [popup advisory](https://github.com/electron/electron/security/advisories/GHSA-gr2m-v5gq-v685), [protocol advisory](https://github.com/electron/electron/security/advisories/GHSA-j84w-jfhq-vhvj), [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv). Exact advisory snapshots and affected ranges are retained in evidence/osv-advisories.json. No dependency updates applied: a vendor upgrade without three-platform validation would be unsafe.

## Supply chain review

- codium.lock pins SHA-256 for Ubuntu amd64, macOS arm64 and Windows x64 archives. Upstream Linux checksum verified during rebuild. This is integrity pinning, not a vendor-signature/provenance proof.
- Third-party GitHub Actions in reviewed build workflow are pinned to commit SHAs. Default read-only permissions; release job separately grants contents/attestations/id-token write. PR credential gating and build-step credential scope are implemented; protected signer isolation remains SEC-010.
- npm audit in workflow uses `|| true`, therefore is informational; no observed comprehensive dependency/secret scanner release gate. Proposed pipeline in CI_PROPOSAL.md requires approval before editing workflows.
- Root npm lifecycle scripts do not install third-party dependencies. Vendor manifests/lifecycle hooks are present in the repackaged app; lifecycle code was not executed by audit scanner. Third-party CLI installers/extensions and downloaded helper binaries need separate provenance testing.
- Source lockfile reduces source-root npm dependency-confusion exposure; it says nothing about unpinned external tools/CLI updates or vendor graph maintenance.
- Gitleaks 8.30.1 binary verified against published checksum; history scan covers 181 commits. Findings: AWS example in test/activity.test.js and disposable `check` password in scripts/sign-win-check.sh. Both synthetic; scanner exit1 retained, not rewritten as a clean scan. Final worktree report recorded separately.
- Semgrep, CodeQL, Trivy and OSV-Scanner CLI unavailable/not run. OSV public API used instead. No paid scanning services.

### DEP-001 — Published SBOM omits most bundled runtime components

- Severity / confidence / classification: **Medium / High / CONFIRMED**.
- Component / operating systems: `scripts/sbom.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `scripts/sbom.js:12`; baseline: `scripts/sbom.js:12` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-1104; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: SBOM enumerates source-root node_modules rather than the repackaged VSCodium installation.
- Reproduction: Compare published 1048-byte SBOM (2 components) with extracted DEB manifest inventory (109 identified packages plus measured runtimes).
- Expected: Release SBOM describes actual packaged dependencies and versions.
- Actual: Electron, Chromium and most bundled dependencies omitted.
- Impact: Scanner coverage and consumers ability to assess runtime CVEs are substantially reduced.
- Remediation: Generate SBOM from final staging tree on each platform and enrich native/bundled dependencies; include digests and provenance. Audit adds a partial artifact-derived SBOM, not a production pipeline fix.
- Regression / verification requirement: `Compare SBOM against artifact inventory, and ensure Electron/shell-quote/runtime versions included.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **DEFERRED**; No production/source upgrade or infrastructure change applied; follow-up in REMEDIATION_PLAN.md.
### DEP-002 — Bundled shell-quote 1.10.0 has a published injection advisory

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `codium.lock`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `codium.lock:1`; baseline: `codium.lock:1` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-78; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Vendor node_modules includes shell-quote 1.10.0, affected by CVE-2026-102422.
- Reproduction: Invoke quote with comment token followed by a newline-bearing string; inspect returned shell text without executing it.
- Expected: Reject line terminators following comment tokens.
- Actual: Bundled library generates a new shell command line.
- Impact: Library flaw and affected version confirmed; attacker-controlled token composition in Kural/upstream call sites remains SUSPECTED.
- Remediation: Upgrade through compatible vendor build to shell-quote >=1.11.0; trace reachable quote() usages before assigning app exploit CVSS.
- Regression / verification requirement: `Run upstream quotation regression and integration tests of reachable callers.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **DEFERRED**; No production/source upgrade or infrastructure change applied; follow-up in REMEDIATION_PLAN.md.
## SBOM deliverables

kural-source.cdx.json reflects existing generator. kural-linux-artifact.cdx.json is an audit-derived CycloneDX 1.5 inventory of identified release package manifests and measured runtimes. It does not claim complete bundled/native dependency closure or license/provenance resolution. Generate authoritative per-platform SBOMs from final packaging trees before release.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## PR #61 dependency follow-up

DEP-002: **FIXED at the packaged-library level**. Verified registry archive shell-quote 1.11.0 against its SHA-512 integrity; retained full upstream contents/license in `vendor/shell-quote`, with per-file SHA-256 pins. `scripts/runtime_dependencies.py` verifies pins and expected vendor versions before replacing the staged package on all three build paths. No lifecycle hooks run. Original comment-plus-newline quotation reproduces against shipped 1.10.0; 1.11.0 rejects it. `node test/runtime-dependencies.test.js` PASS. OSV query for npm shell-quote 1.11.0 returned zero advisories on 2026-10-11. Caller-level application exploitability remains unestablished. Existing published binaries remain affected until replaced by a new validated release.

DEP-001: **PARTIALLY FIXED**. Per-platform packaging now inventories the staged application recursively, rejects invalid manifests, ignores symlinks and records portable manifest paths. The Linux inventory has 112 components, including vendor-declared Electron 42.8.1 and shell-quote. Release merging fails if any of the three packaged inventories is missing, mismatched, or source-only; hashes bind the referenced platform inventories. `node test/sbom.test.js` PASS. Python was already a build prerequisite; this adds no Node requirement to macOS/Linux source builds. Native binaries and bundles without manifests still require enrichment, so this does not claim a complete dependency closure.

SEC-009 remains open: the latest stable VSCodium release API returned the currently pinned 1.135.06055; a bare Electron replacement would need compatibility and artifact integrity validation. No runtime replacement was applied.

Validation of this follow-up: Linux DEB rebuild PASS; all eleven shipped shell-quote files match the pinned SHA-256 values; generated inventory has 112 components and explicitly records Electron 42.8.1. Runtime dependency and SBOM regressions PASS, actionlint 1.7.12 PASS, shell/JS/Python syntax checks and git diff --check PASS. Gitleaks rerun exit1: the same two synthetic signing-test/activity-fixture matches, no newly reported secrets. OSV shell-quote 1.11.0 query returned zero advisories. Native CI for these new changes is pending.
