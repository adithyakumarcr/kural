# PROGRESS

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Phase checklist

- [x] 1 Repository/architecture: pinned target, read docs/locks/builds, mapped trust boundaries.
- [x] 2 Source audit: prioritized high-risk code examined; confirmed defects reproduced/fixed. Complete native/upstream proof NOT COMPLETE.
- [ ] 3 AI security: host mocks/reproductions complete; actual provider/MCP/handoff adversarial tests incomplete, Gemini limitation unresolved.
- [ ] 4 Dependencies: npm/Gitleaks/OSV API/artifact inventory complete for stated scopes; native/transitive closure and unavailable scanners incomplete.
- [ ] 5 Cross-platform: all-target static artifacts; native build/install/startup smoke PASS in CI. Broader acceptance incomplete.
- [ ] 6 Releases: all asset hashes/signature verified; static signing defects documented; provenance and installed updates incomplete.
- [ ] 7 Functional: complete available mock suite attempted; actual UI/auth/failure workflows incomplete.
- [ ] 8 Performance: build measured; actual editor benchmarks incomplete.
- [x] 9 Automated tests: inspected/ran available suite, added security/data regressions; full CI test job PASS; local failures retained; broader provider acceptance incomplete.
- [x] 10 CI review/proposal: reviewed existing workflow/settings, proposed fix; approved minimal credential guard applied/tested; long-term pipeline/settings remain deferred.
- [x] 11 Findings: classification/evidence/location/status in reports and findings.json.
- [x] 12 Reports: eight required reports plus evidence, SBOMs, patch and handoff.
- [ ] 13 Remediation: 14 FIXED, 2 PARTIALLY FIXED, 4 DEFERRED; full CI tests and all-platform packaging/startup checks PASS; broad acceptance incomplete.

No helper agents were needed or launched. Work did not pause on unavailable helper infrastructure. Resume: retain branch/base and patch; run native tests, fix vendor/provider/pipeline blockers, then recompute GO status. All partial phases are explicit; this checklist does not claim a comprehensive finished security assurance.


## Authorized PR validation — latest result

On security-fixes/agent-permissions-and-release-integrity after the workflow guard: `npm test` exited1; **79/81 test files passed**. Failures: devices.test.js (socket EPERM) and updates-script.test.js (stuck-helper liveness assertion). The earlier bench-memory.test.js process-inventory failure did not recur; no benchmark source change was made. All six new audit regression files pass. actionlint v1.7.12 and git diff --check PASS. Earlier logs above are retained as historical evidence; this result is the current PR validation. See evidence/pr-validation-tests.log.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

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

Final application/build verification revision: d7a6987929793c69df2fa9a47915446cc488b33d. [Build 38131185955](https://github.com/adithyakumarcr/kural/actions/runs/38131185955) / [CodeQL 38131185998](https://github.com/adithyakumarcr/kural/actions/runs/38131185998) PASS: all 83 CI test files and supported platform build/install/runtime/startup smoke jobs; release SKIPPED. Current status: **14 FIXED, 2 PARTIALLY FIXED, 4 DEFERRED**. Gemini remains OPEN with a current synthetic reproduction and concrete adapter requirements. Local 80/83 container result remains documented. Broader acceptance, full dependency closure and owner production configuration are unfinished. No paid APIs, release publication or production change occurred. Final follow-up changes Markdown only; code validation is bound to d7a6987.
