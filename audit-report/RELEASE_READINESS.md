# RELEASE READINESS

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Final recommendation: NO-GO

Confirmed release blockers remain: vulnerable bundled Electron version, Gemini cannot enforce Kural edit approvals/snapshot ordering, signing infrastructure still lacks a protected isolated signer (routine PR credential exposure now guarded), lack of effective release review/tag protection, and incomplete native release acceptance. Public alpha.8 still contains the original reproduced code. Local fixes are candidates for review; they are not deployed remediation.

## Findings and changes

- Discovered: 20 tracked findings: 12 locally FIXED, 1 PARTIALLY FIXED (SEC-010), 7 DEFERRED. Findings are code/configuration/dependency/artifact facts with exploitation limits explicitly stated; not 20 independently exploited application vulnerabilities.
- Fixed: instruction symlink/trust ingestion, implicit private reads/web preapproval, executable config guards, background git hooks, updater version injection/replay, host Ask/Plan mutation enforcement, restore symlink redirection, Auto Save proposal mutation, byte-corrupting Undo, split UTF-8 streams and false-success deletion.
- Added: six auto-discovered regression files (audit-boundaries/ci/data/host/release/review). Updated permission/profile expectations and valid mac-swap fixture. Tests use mocks/temp/synthetic data, no production credentials or paid APIs.
- Change reference: pinned base, local branch, source patch SHA-256 and file list in CHANGE_REFERENCE.md. Implementation commits and exact hashes are recorded in CHANGE_REFERENCE.md; an authorized PR includes the Windows workflow guard.

## Verified results

- All eight initial synthetic reproduced failure flags changed true → false. Original targeted regressions fail against pristine baseline and pass patched source. New review test demonstrates no real-buffer proposal edit; host launch test demonstrates web tools removed and trust/read-only guard.
- Full final npm test result is appended below from actual runner. Environment-specific failures are not a passing suite.
- Node syntax checks and bash syntax checks PASS; git diff --check PASS.
- Final Linux DEB build PASS; all 16 changed packaged extension files equal working source; no world-writable extracted entries. Native installer/UI acceptance NOT TESTED.
- Published Ed25519 manifest PASS and all five artifact hashes PASS. Actual Windows installer lacks Authenticode and macOS ZIP executables use ad-hoc identity.
- npm audit zero in empty source-root dependency scope; OSV API found 5 advisories across 2 runtime packages; Gitleaks matches reviewed as synthetic, scanner status retained. Missing scanners listed in DEPENDENCY_AUDIT.md.

## Explicit untested scope

Native macOS/Windows and Ubuntu desktop install/startup/update/uninstall; Mac Intel (unsupported); real keychain/Windows credential/pipe ACL handling; actual paid-provider authentication/tool enforcement; real Ollama/MCP/SSH/Jira services; hostile multi-agent transitions; crash/power-loss recovery; complete renderer/native memory fuzzing; complete upstream dependency graph and artifact secret scan; provenance attestation verification; cold/warm application startup, actual CPU/RSS and long-run leak testing. Code-level Node tests on Ubuntu are not substitutes.

## Follow-up and resume

Read PROGRESS.md and COMMANDS.md. Keep the pristine baseline worktree for before/after evidence. Start with unresolved items rather than re-running completed read-only checks. Review CI_PROPOSAL.md as the concrete permission-dependent next change. Obtain native test environments and patched vendor archive before any GO assessment. Recompute readiness only after required tests, approval boundary and signer isolation are verified; never close a finding solely with a documented workaround.


## Final test runner result

`npm test`: exit 1; **77 / 80 test files passed**. Failures: bench-memory.test.js, devices.test.js, updates-script.test.js. Targeted new regression files all pass. See evidence/final-tests.log; original baseline has the same three failures.

## Authorized PR validation — latest result

On security-fixes/agent-permissions-and-release-integrity after the workflow guard: `npm test` exited1; **79/81 test files passed**. Failures: devices.test.js (socket EPERM) and updates-script.test.js (stuck-helper liveness assertion). The earlier bench-memory.test.js process-inventory failure did not recur; no benchmark source change was made. All six new audit regression files pass. actionlint v1.7.12 and git diff --check PASS. Earlier logs above are retained as historical evidence; this result is the current PR validation. See evidence/pr-validation-tests.log.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.
