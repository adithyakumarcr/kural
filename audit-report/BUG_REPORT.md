# BUG REPORT

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Confirmed defects and remediation

### BUG-001 — Auto Save can persist unreviewed Ctrl+K code

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/edit/review.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/edit/review.js:43`; baseline: `extension/lib/edit/review.js:72` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-841; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Original ReviewManager inserted a combined old/new proposal directly into the real document while awaiting Accept/Reject.
- Reproduction: Call propose against a mocked document/applyEdit, then simulate Auto Save. Baseline applies an edit before acceptance.
- Expected: Only explicit Accept changes the original document.
- Actual: Proposing mutated the real buffer, enabling automatic persistence.
- Impact: Unreviewed changes or mixed old/new code may be saved; crash/restart can leave incorrect source.
- Remediation: Preview through a read-only virtual document and vscode.diff; apply only on Accept; reject stale document version/content and discard on concurrent changes. Native UI compatibility still requires validation.
- Regression / verification requirement: `node test/audit-review.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### BUG-002 — Undo corrupts non-UTF-8 file bytes

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/chat/changes.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/chat/changes.js:74`; baseline: `extension/lib/chat/changes.js:108` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-172, CWE-664; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Snapshots decoded arbitrary bytes as UTF-8 then re-encoded during undo.
- Reproduction: Capture bytes ff fe 00 61 80, change file, undo; compare exact Buffer, including snapshot reload from disk.
- Expected: Byte-for-byte restoration.
- Actual: Baseline replaced invalid UTF-8 sequences with replacement characters.
- Impact: Permanent corruption of binary/legacy-encoding source and data files.
- Remediation: Persist original bytes as base64; hash/compare raw bytes; retain decoded text for display. Old already-lossy checkpoints cannot recover missing bytes.
- Regression / verification requirement: `node test/audit-data.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### BUG-003 — Split UTF-8 stdout chunks corrupt model output

- Severity / confidence / classification: **Medium / High / CONFIRMED**.
- Component / operating systems: `extension/lib/ai/claude.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/ai/claude.js:12`; baseline: `extension/lib/ai/claude.js:see original diff` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-172; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: ClaudeProcess decoded each stdout chunk independently.
- Reproduction: Feed newline JSON containing Tamil, Japanese and emoji one byte at a time to onData.
- Expected: Identical Unicode text after arbitrary chunk boundaries.
- Actual: Baseline emitted replacement characters.
- Impact: Incorrect generated code/answers and possible parser/UI errors.
- Remediation: Use streaming StringDecoder for stdout and UTF-8 stream encoding for stderr. Codex/agy already use stream encoding.
- Regression / verification requirement: `node test/audit-data.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### BUG-004 — Failed Undo deletion reports success

- Severity / confidence / classification: **Medium / High / CONFIRMED**.
- Component / operating systems: `extension/lib/chat/changes.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/chat/changes.js:112`; baseline: `extension/lib/chat/changes.js:108` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-703; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Undo of a newly created file swallowed every deletion exception.
- Reproduction: Mock workspace.fs.delete to throw EACCES; invoke undo.
- Expected: Surface failure and retain accurate state.
- Actual: Baseline suppressed the error, leaving the file behind.
- Impact: Misleading rollback result and inconsistent workspace state.
- Remediation: Ignore only ENOENT/FileNotFound; propagate other deletion errors.
- Regression / verification requirement: `node test/audit-data.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
## Test failures that remain unresolved

The original full suite failed bench-memory.test.js, devices.test.js and updates-script.test.js. Final status is recorded in RELEASE_READINESS.md and evidence/final-tests.log. These failures are not silently suppressed or changed to make the suite green:

| File | Observed failure | Interpretation / required follow-up |
| --- | --- | --- |
| bench-memory.test.js | ps: fatal library error, lookup self | Process inventory unavailable in container; real performance/native rerun required |
| devices.test.js | MCP socket connection EPERM | Host environment prevents socket transport; device isolation behavior remains unverified end-to-end |
| updates-script.test.js | Stuck helper/process-liveness expectation fails | Possible process reaping/liveness issue in container; native rerun needed; do not declare product fixed |

mac-swap.test.js initially also failed after strict version validation because its fixture used version "1". Fixture now uses valid "1.0.0"; security checks retained and final relevant tests pass. Permission/profiles tests were updated to assert the strengthened behavior, not remove controls.

## Workflow coverage and limitations

Existing tests exercise provider protocol mocks, teams/routing, settings, profiles, attachments, Git/terminal suggestion processing, snapshots, updater scripts and signing helper generation. Unit and fixture-based tests do not prove first-launch authentication, account switching with real credentials, native webview/inline-review UI, network disconnect recovery, extension compatibility or long-running concurrent agents. These remain NOT TESTED. Legacy corrupted UTF-8 checkpoints cannot reconstruct lost original bytes; the new byte snapshot format protects newly captured checkpoints only.


## Authorized PR validation — latest result

On security-fixes/agent-permissions-and-release-integrity after the workflow guard: `npm test` exited1; **79/81 test files passed**. Failures: devices.test.js (socket EPERM) and updates-script.test.js (stuck-helper liveness assertion). The earlier bench-memory.test.js process-inventory failure did not recur; no benchmark source change was made. All six new audit regression files pass. actionlint v1.7.12 and git diff --check PASS. Earlier logs above are retained as historical evidence; this result is the current PR validation. See evidence/pr-validation-tests.log.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## Verified follow-up code revision

Application/build code revision: `b4c03486781d6427682ca47716efe71bd725fe34` (dependency change `39846146055280720a35d1c06d27215863d69b3e`). [Build run 38125659529](https://github.com/adithyakumarcr/kural/actions/runs/38125659529) completed successfully: full test job, Linux build, macOS DMG/startup, Windows build/install/startup, Ubuntu 22.04 and 24.04 install/startup. Release job was skipped. [CodeQL run 38125659585](https://github.com/adithyakumarcr/kural/actions/runs/38125659585) PASS. These are executed automated checks, not full platform acceptance or proof of security. The intermediate 3984614 build failed; b4c0348 corrected the rebranding dependency fixture and executable packaging modes.

Local full-run result remains 76/82 (exit1); corrected rebranding fixture and provider timing failures passed direct reruns. Process-inventory, socket and helper-liveness local failures remain documented. A CycloneDX schema validation attempt could not run because Python jsonschema is unavailable; structural regression tests passed, so formal schema validation is not claimed. The final report update changes Markdown only; code validation is bound to the above SHA.

## Runtime upgrade follow-up

The Electron upgrade uncovered two implementation/harness regressions: Python 3.10 lacks `hashlib.file_digest`, and PowerShell did not provide a reliable `LASTEXITCODE` for the Windows GUI executable. Streaming SHA-256 and a waited process with an exit-7 negative control correct these failures. Both original failing platform checks now pass in native CI on d7a6987 (Build run 38131185955). These are audit implementation corrections, not additional baseline Kural finding IDs. All 83 CI test files pass; local container failures remain documented. Existing provider/UI/update/recovery coverage limitations remain.
