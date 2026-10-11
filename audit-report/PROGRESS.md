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
- [ ] 13 Remediation: 13 FIXED, 2 PARTIALLY FIXED, 5 DEFERRED; full CI tests and all-platform packaging/startup checks PASS; broad acceptance incomplete.

No helper agents were needed or launched. Work did not pause on unavailable helper infrastructure. Resume: retain branch/base and patch; run native tests, fix vendor/provider/pipeline blockers, then recompute GO status. All partial phases are explicit; this checklist does not claim a comprehensive finished security assurance.


## Authorized PR validation — latest result

On security-fixes/agent-permissions-and-release-integrity after the workflow guard: `npm test` exited1; **79/81 test files passed**. Failures: devices.test.js (socket EPERM) and updates-script.test.js (stuck-helper liveness assertion). The earlier bench-memory.test.js process-inventory failure did not recur; no benchmark source change was made. All six new audit regression files pass. actionlint v1.7.12 and git diff --check PASS. Earlier logs above are retained as historical evidence; this result is the current PR validation. See evidence/pr-validation-tests.log.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## Verified follow-up code revision

Application/build code revision: `b4c03486781d6427682ca47716efe71bd725fe34` (dependency change `39846146055280720a35d1c06d27215863d69b3e`). [Build run 38125659529](https://github.com/adithyakumarcr/kural/actions/runs/38125659529) completed successfully: full test job, Linux build, macOS DMG/startup, Windows build/install/startup, Ubuntu 22.04 and 24.04 install/startup. Release job was skipped. [CodeQL run 38125659585](https://github.com/adithyakumarcr/kural/actions/runs/38125659585) PASS. These are executed automated checks, not full platform acceptance or proof of security. The intermediate 3984614 build failed; b4c0348 corrected the rebranding dependency fixture and executable packaging modes.

Local full-run result remains 76/82 (exit1); corrected rebranding fixture and provider timing failures passed direct reruns. Process-inventory, socket and helper-liveness local failures remain documented. A CycloneDX schema validation attempt could not run because Python jsonschema is unavailable; structural regression tests passed, so formal schema validation is not claimed. The final report update changes Markdown only; code validation is bound to the above SHA.
