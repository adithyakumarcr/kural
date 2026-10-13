# RELEASE READINESS

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Final recommendation: NO-GO

Confirmed release blockers remain: Gemini cannot enforce Kural edit approvals/snapshot ordering, signing infrastructure still lacks a protected isolated signer (routine PR credential exposure now guarded), lack of effective release review/tag protection, and incomplete native release acceptance. Public alpha.8 still contains the original reproduced code. Local fixes are candidates for review; they are not deployed remediation.

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

## Additional remediation

Current tracked status: **13 FIXED, 2 PARTIALLY FIXED, 5 DEFERRED** (20 total). DEP-002 is fixed at the bundled library level; DEP-001 now has staged per-platform inventories and fail-closed release merging, with native/bundle enrichment still outstanding. SEC-010 additionally limits publisher credentials to the Windows build step; isolated protected signing remains outstanding. Native CI on the previous PR head passed the test job and all supported build/install/startup jobs; the follow-up must pass its own fresh run. Release recommendation remains **NO-GO**, particularly for the unresolved Gemini approval boundary and affected Electron runtime. No release or settings operation has been performed.

Validation of this follow-up: Linux DEB rebuild PASS; all eleven shipped shell-quote files match the pinned SHA-256 values; generated inventory has 112 components and explicitly records Electron 42.8.1. Runtime dependency and SBOM regressions PASS, actionlint 1.7.12 PASS, shell/JS/Python syntax checks and git diff --check PASS. Gitleaks rerun exit1: the same two synthetic signing-test/activity-fixture matches, no newly reported secrets. OSV shell-quote 1.11.0 query returned zero advisories. Native CI for these new changes is pending.

Full local follow-up suite: 76/82 files passed, exit1. Failures: agy.test.js and codex.test.js (fake-provider timing assertions), bench-memory.test.js (process lookup), devices.test.js (socket EPERM), rebrand-welcome.test.js (new required dependency missing from synthetic fixture), updates-script.test.js (helper liveness). The rebranding fixture is corrected and its direct rerun PASS; remaining failures require rerun/native CI and have not been waived. The strengthened runtime-dependency regression also passes its direct rerun.

Whitespace check clarification: Kural-authored changes pass `git diff --cached --check -- . ":!vendor"`. The unmodified upstream MIT license has trailing spaces, so the all-files check reports those retained vendor lines; upstream bytes and integrity pins are preserved.

## Verified follow-up code revision

Application/build code revision: `b4c03486781d6427682ca47716efe71bd725fe34` (dependency change `39846146055280720a35d1c06d27215863d69b3e`). [Build run 38125659529](https://github.com/adithyakumarcr/kural/actions/runs/38125659529) completed successfully: full test job, Linux build, macOS DMG/startup, Windows build/install/startup, Ubuntu 22.04 and 24.04 install/startup. Release job was skipped. [CodeQL run 38125659585](https://github.com/adithyakumarcr/kural/actions/runs/38125659585) PASS. These are executed automated checks, not full platform acceptance or proof of security. The intermediate 3984614 build failed; b4c0348 corrected the rebranding dependency fixture and executable packaging modes.

Local full-run result remains 76/82 (exit1); corrected rebranding fixture and provider timing failures passed direct reruns. Process-inventory, socket and helper-liveness local failures remain documented. A CycloneDX schema validation attempt could not run because Python jsonschema is unavailable; structural regression tests passed, so formal schema validation is not claimed. The final report update changes Markdown only; code validation is bound to the above SHA.

## Electron runtime implementation — interim verification

SEC-009 is now **PARTIALLY FIXED / NATIVE VALIDATION PENDING**. All three packaging scripts replace the complete Electron runtime distribution with official **42.11.12** archives, independently pinned by SHA-256 in `vendor/electron-runtime.json`. VSCodium application code stays on 1.135.06055. The patch retains the vendor fuse wire `101100011`, Linux sandbox permissions and macOS bundle identities. Existing platform signing happens after replacement. Unknown vendor versions, changed fuses, checksum mismatches and unsafe ZIP paths/links fail the build. There is no claim that checksums constitute platform signing or notarization.

Before reproduction: original embedded Linux runtime reported Electron 42.8.1 / Node 24.18.1 / modules ABI 146. After replacement: actual embedded executable reports Electron 42.11.12 / Node 24.19.0 / ABI 146. Node-pty, Parcel watcher and SQLite native bindings load under the replacement runtime. OSV queried for npm Electron 42.11.12 returned no published advisories; this does not prove absence of vulnerabilities. Linux DEB rebuild PASS, and its SBOM records the pinned runtime/archive digest. Verified Windows and macOS vendor archives accept the replacements under Linux staging; **that is not native execution**. Fresh native build/install/startup CI must pass before closing SEC-009.

Commands: `node test/electron-runtime.test.js` PASS (4 Python regression cases, including Python 3.10 hashing and complete macOS frameworks/bundle identity), `node test/sbom.test.js` PASS, `node test/codium-lock.test.js` PASS; `./make-deb.sh` PASS; `python3 scripts/electron_runtime.py <staged-app> <platform> --archive <pinned-archive>` PASS for each target. The new CI checks execute each installed runtime and assert Electron 42.11.12 and ABI 146, followed by the existing real-window startup tests. Full suite and fresh CI results are pending at this report revision.

SEC-012 remains **OPEN**. A checksum-verified real Antigravity CLI 1.3.3 was obtained and its help examined. Official pre-execution hooks exist, but are loaded from user/workspace configuration. A mandatory per-chat configuration path protected from untrusted project configuration has not been established. A no-provider-call `/hooks` probe required authentication and was interrupted; no login or paid API call occurred. No speculative hook patch was shipped, and Gemini was not disabled. This needs an approval-capable adapter with real denial-before-mutation, hook-tampering, failure/timeout, transition and handoff tests. The authorization issue is engineering capability/validation, not missing permission to change source.

Reviewer scope: **added** pinned runtime archives/installer, security regression tests, native runtime version/ABI checks and SBOM archive provenance; **replaced** Electron 42.8.1 runtime bytes during packaging; **removed** no editor or provider functionality. Public alpha.8 binaries are unchanged until a separately approved release ships. Overall recommendation remains **NO-GO**, including open Gemini enforcement, signing/repository protection requirements and incomplete broader acceptance.

Validation update: local full suite **80/83 files PASS, exit1**; bench-memory process lookup, device socket EPERM and updater helper-liveness fail in this host. CI test job and CodeQL passed on `1f4f2de`; the Linux build exposed Python 3.10 incompatibility in `hashlib.file_digest`, corrected in `75be8b2` with a streaming hash and regression. Complete macOS dependency frameworks are also replaced, with bundle-identity regression coverage. Final fresh native CI is required.

## Final Electron remediation verification

**SEC-009: FIXED in candidate builds.** Application/build revision [`d7a6987929793c69df2fa9a47915446cc488b33d`](https://github.com/adithyakumarcr/kural/commit/d7a6987929793c69df2fa9a47915446cc488b33d). [Build run 38131185955](https://github.com/adithyakumarcr/kural/actions/runs/38131185955) PASS: all 83 test files, Linux/macOS/Windows packaging, macOS DMG/signature/startup, Ubuntu 22.04 and 24.04 installation/startup, Windows installer/runtime/startup. [CodeQL 38131185998](https://github.com/adithyakumarcr/kural/actions/runs/38131185998) PASS. Release job SKIPPED; no release published.

Actual installed runtime logs on every native target report **Electron 42.11.12 / modules ABI 146**. Native environments: macOS 26.6.2 arm64, Ubuntu 22.04/24.04 x64, Windows Server 2025 x64 as a representative Windows installer environment. Native Windows 10/11, other macOS versions, update/uninstall/data preservation and broader feature/performance acceptance remain **NOT TESTED**. These are automated startup smoke checks, not a full UI inspection or proof of security.

Windows verification first required correcting the GUI executable exit-status check. Final CI waits for each probe, verifies an intentional exit code 7, verifies the runtime version with exit code 0, then starts the application; the final native startup showed seven Kural processes. The Python 3.10 hash regression also passes in the Ubuntu 22.04 build. All 241 staged macOS framework files match the pinned official archive. Runtime security regression cases: four PASS. OSV: zero published advisories for Electron 42.11.12 and shell-quote 1.11.0. Gitleaks 8.30.1: exit1, the same two synthetic fixtures; no real secret reported. actionlint 1.7.12 and authored-source whitespace checks PASS.

Current tracked status: **14 FIXED, 2 PARTIALLY FIXED, 4 DEFERRED** (20 findings). Earlier pending/status paragraphs are historical. Local full suite remains 80/83, exit1, with the documented container process/socket/helper-liveness failures; the complete native CI test job passes. Formal dependency closure remains partial.

**SEC-012 is still OPEN.** Synthetic recheck confirms `onTool()` does not await a denying callback or transmit the denial. Real provider enforcement was not tested; no paid API calls or production credentials were used. See `GEMINI_ADAPTER_REQUIREMENTS.md` for the compatible approval-capable adapter requirements. No provider was disabled and no speculative approval patch was shipped.

Overall recommendation remains **NO-GO** for open Gemini enforcement, protected signing/repository settings, production platform signing/notarization requirements and incomplete broader acceptance. Existing alpha.8 binaries retain the original affected code/runtime until a separately approved release ships. Source changes and PR updates are authorized; no merge, release, production settings change or credential rotation occurred. This final report revision changes Markdown only; code validation is bound to d7a6987.


## SEC-012 hook gate — readiness impact

Recommendation stays **NO-GO**. SEC-012 is **IMPLEMENTED, NOT VERIFIED against the real CLI** (`297944cf5850c3e3cf814ccc05e7aa2d25dadfb0`): a Kural-owned Antigravity `PreToolUse` hook now asks Kural's permission policy before each Gemini tool call and fails closed, verified only against the stand-in CLI. Release requires the owner's real-CLI acceptance (`scripts/verify-agy-gate.sh`) in addition to the other blockers (signing/repository protection, broader native acceptance). Local `npm test`: 84/84 test files PASS (exit 0) on this container at this revision; the previously recorded bench-memory, device-socket EPERM and updater helper-liveness environment failures did not recur in this run. User-visible change: Kural writes a `kural-gate` entry into `~/.gemini/antigravity-cli/hooks.json` and a launcher into `~/.kural/agy-gate`; `scripts/from-scratch.sh` removes the entry.


## Second-pass remediation — readiness impact

Recommendation stays **NO-GO**. The second pass fixed or mitigated most AGENT/APP/REL/SUP/BUG findings (table in SECURITY_AUDIT.md and BUG_REPORT.md); local `npm test` 98/98 PASS at `4355ff8`. Several fixes for Windows and macOS (installer folder check, install.ps1 BOM, tree kill, Ollama signature checks) were not run on those systems: the Windows installer only under Wine. The original blockers are unchanged: SEC-012 real-CLI verification, SEC-010/011 and REL-001/002 owner actions, native acceptance.


## What remains for GO (2026-10-12)

Code findings: none open beyond documented residuals (danger.js is not a sandbox; AGENT-5/9 documented; APP-6 Linux relies on HTTPS from Ollama). REL-001/002: **accepted risk** by the owner (no paid signing); state it in the release notes. Still required, by the owner:
1. SEC-011: protect `main` and `v*` tags, then confirm a direct push is refused.
2. SEC-010: move Windows signing secrets into a protected environment (or remove them while unused).
3. SEC-012: run `scripts/verify-agy-gate.sh` with a logged-in agy and record the result.
4. Native acceptance: install, start, update and uninstall a release candidate on macOS, Windows and Ubuntu; on Windows the installer folder check, the update script with a non-ASCII folder and Stop on a long command; on Ubuntu the update's password window (install-deb.sh) and Ollama's install.
With 1–4 done and passing, the recommendation can move to **GO for an alpha release** with the signing warnings documented.
