# SECURITY AUDIT

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Executive assessment

**NO-GO.** Twelve confirmed host-security/data-recovery findings have local fixes with regression coverage. SEC-010 is partially fixed by the approved tag-push credential guard; seven other dependency, provider, pipeline and distribution findings remain deferred. The audit does not establish comprehensive application safety: native installer/updater/UI tests, actual provider confinement and bundled native-code review are incomplete. All user-pasted historical claims were rechecked; no former helper-agent work was assumed available.

## Architecture and attack surface

| Component | Implementation / process | Security-sensitive boundary |
| --- | --- | --- |
| Editor shell | VSCodium 1.135.06055; Electron main, sandboxed renderer, extension host | Web/extension content to privileged OS APIs |
| Built-in extension | Plain CommonJS JS, no npm runtime deps | Webview messages / settings to extension-host operations |
| Claude | CLI headless stream-json; permission callbacks | Untrusted prompts/tool arguments to local files/process/network |
| Codex | app-server JSON-RPC; provider sandbox / approvals | Provider-native sandbox scope vs Kural host permissions |
| Gemini | Antigravity print-mode stream-json | Notices cannot veto edits; provider mode is the enforcement point |
| Ollama | Local HTTP model, Kural tool engine | Model tool JSON to filesystem and subprocesses |
| Teams / tools | Provider helpers; team-board MCP; Jira/Atlassian; device MCP | Tool output/handoffs and remote commands must retain authority boundaries |
| SSH devices | Private socket + random per-chat token; SSH subprocess | Local agent credentials and approval to remote device |
| Browser | Browser view / localhost proxy / design mode | Untrusted web pages and local development services; TLS exceptions |
| Profiles | Per-profile chats/images/provider environment and shared options | Account/profile data access and credential isolation |
| Change recovery | Disk checkpoints and virtual review documents | Captured bytes/path identity vs filesystem changes and Auto Save |
| Release/update | Pinned vendor downloads; signed checksum list; OS-specific installer helpers | GitHub metadata vs signed bytes; initial OS publisher trust |

Most severe prompt-injection routes are automatic instruction ingestion, private read roots, executable config writes and background Git execution. Model prompts are not access controls. Arbitrary commands intentionally allowed by Auto/user approval remain powerful; dangerous-command regexes are best-effort and cannot be treated as a sandbox.

## Confirmed findings

### SEC-001 — Repository instruction symlinks disclose outside files

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/chat/project.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/chat/project.js:26`; baseline: `extension/lib/chat/project.js:24` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-22, CWE-200; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Instruction discovery followed symlinked CLAUDE.md and rules files without checking their canonical location, and ran for restricted workspaces.
- Reproduction: In an isolated folder, symlink CLAUDE.md and .claude/rules to a synthetic secret outside the folder; invoke projectInstructions. Baseline output includes the marker.
- Expected: Outside content is not automatically sent as project instructions; untrusted workspaces cannot start AI.
- Actual: The marker was included in generated instructions.
- Impact: A downloaded repository can cause private local content to enter provider prompts without a read card.
- Remediation: Check real targets against the workspace; skip restricted workspace instructions; explicitly require trust before AI activation and chat launch.
- Regression / verification requirement: `node test/audit-boundaries.test.js; node test/audit-host.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-002 — Implicit private-storage reads and preapproved web egress

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/profiles/scope.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/profiles/scope.js:47`; baseline: `extension/lib/profiles/scope.js:47` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-200, CWE-284; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Implicit read roots included Kural SSH/chat storage, Claude project transcripts and shared system temp; Claude WebFetch/WebSearch were launch-preapproved.
- Reproduction: Baseline root tests include synthetic ssh and other-chat folders. Inspect actual ChatView launch opts with a mocked agent factory.
- Expected: Sensitive internal storage and unrelated temp need approval; web access in Agent reaches permission policy.
- Actual: Sensitive roots were implicitly readable and network tools preapproved.
- Impact: Prompt injection can seek credential/history disclosure and an egress channel. Complete end-to-end provider exfiltration was NOT TESTED.
- Remediation: Limit roots to workspace/workdir, profile images, private attachments and plans; remove web tools from Claude launch preapprovals. This is a host-policy fix, not an OS/provider sandbox.
- Regression / verification requirement: `node test/audit-boundaries.test.js; node test/audit-host.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-003 — Executable repository configuration writes bypass approval

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/paths.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/paths.js:64`; baseline: `extension/lib/paths.js:64` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-862, CWE-78; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: The runs-later guard omitted .git/config, gitfiles and much of .claude; aliases and relative paths were not consistently classified.
- Reproduction: decide Write for .git/config and .claude/commands in Agent; repeat through symlink aliases and paths relative to cwd. Baseline returns allow.
- Expected: Configuration capable of executing later requires a card in Agent.
- Actual: These writes were approved without a card.
- Impact: A malicious model instruction can plant git hooks/fsmonitor or provider commands without initial command approval. Auto remains an explicit broad-access mode.
- Remediation: Guard entire .git and .claude trees, resolve tool paths relative to cwd, inspect canonical and lexical aliases; preserve Windows case-insensitive matching.
- Regression / verification requirement: `node test/audit-boundaries.test.js; node test/paths-runs-later.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-004 — Background terminal Git context executes repository hooks

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/tab/terminal.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/tab/terminal.js:64`; baseline: `extension/lib/tab/terminal.js:64` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-78, CWE-829; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Git context invokes status/diff using workspace-controlled configuration, including core.fsmonitor and textconv.
- Reproduction: Create a temporary git repository with fsmonitor and textconv scripts that only write a marker; call gitContext. Baseline fsmonitor marker is written.
- Expected: Collecting terminal suggestions must not execute repository hooks.
- Actual: A harmless repository hook executed without a user command.
- Impact: Opening/typing in a prepared workspace can execute repository-controlled code through a background helper.
- Remediation: Skip untrusted context; override fsmonitor/untrackedCache/diff.external and use --no-ext-diff --no-textconv. This does not make deliberate user git commands safe.
- Regression / verification requirement: `node test/audit-boundaries.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-005 — Release tag suffix accepted as shell-bearing version

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/version-compare.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/version-compare.js:5`; baseline: `extension/lib/version-compare.js:5` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-78, CWE-20; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: The unanchored version regex accepted arbitrary suffixes; mac update shell generation interpolated the unchecked version.
- Reproduction: Pass v99.0.0$(touch /tmp/never-executed) to parseVersion; inspect macSteps version interpolation. Payload is never executed.
- Expected: Reject the complete malformed version before constructing commands.
- Actual: Malformed shell-bearing version accepted.
- Impact: An actor able to change release metadata can influence updater shell text; successful installed-system execution was NOT TESTED.
- Remediation: Anchor the complete grammar and reject unsafe numeric components; macSteps validates independently.
- Regression / verification requirement: `node test/audit-release.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-006 — Signed old artifacts can be relabeled as a newer update

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/release-verify.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/release-verify.js:50`; baseline: `extension/lib/release-verify.js:31` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-345, CWE-353; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Signature validation authenticated checksum bytes but did not bind requested unsigned tag to the signed asset filename/version.
- Reproduction: Use a synthetic signing key to verify an old manifest, then request its old filename under a newer tag. Baseline hash verification alone succeeds.
- Expected: Reject old signed assets even when unsigned release metadata claims a newer tag.
- Actual: Old signed hashes remained acceptable under relabeled metadata.
- Impact: Release-access attacker without the signing key can attempt downgrade/replay; old known vulnerabilities can reappear.
- Remediation: Require strictly advancing parsed version and exact signed platform filename tied to that version at download and install; reject unsafe/duplicate manifest filenames. Filename version remains a release-signer trust boundary.
- Regression / verification requirement: `node test/audit-release.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-007 — Ask/Plan mutation requests not denied by trusted host policy

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/chat/permission-policy.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/chat/permission-policy.js:20`; baseline: `extension/lib/chat/permission-policy.js:20` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-862, CWE-693; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Read-only modes depended on provider settings/prompts; host policy allowed workspace writes and Allow all could override restrictions.
- Reproduction: Send synthetic Write/Edit/Bash/DeviceWrite/DeviceCommand requests in Ask/Plan, including Allow all and notice. Exercise actual onPermission with a dirty document.
- Expected: Hard deny mutations without saving user buffers or checkpointing before consent.
- Actual: Writes allowed; permission handler could save dirty buffers before a denial/card.
- Impact: Unexpected provider calls or mode transition races can mutate files in ostensibly read-only modes.
- Remediation: Deny host-handled mutating calls regardless Allow all/notice; decide before saves; defer prepareEdit until approval. Provider-native operations outside callbacks remain unconfined.
- Regression / verification requirement: `node test/audit-boundaries.test.js; node test/audit-host.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-008 — Undo follows a redirected symlink target

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/chat/changes.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/chat/changes.js:76`; baseline: `extension/lib/chat/changes.js:108` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-59, CWE-367; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Snapshots stored a lexical file path without checking that restore still addresses the captured real target.
- Reproduction: Snapshot a temporary file, replace its path with a symlink to an outside synthetic file, call undo. Regression requires outside bytes unchanged and restore refused.
- Expected: Reject changed target identities.
- Actual: Baseline restore could follow the new link.
- Impact: Workspace-controlled filesystem changes can redirect restore into unrelated user files.
- Remediation: Record canonical target at capture and refuse a different restore target; conservative check for legacy snapshots. A concurrent local race between check and write is not proven eliminated.
- Regression / verification requirement: `node test/audit-data.test.js`.
- Verification: Original synthetic failure no longer reproducible and named regression passes; native end-to-end/provider validation NOT TESTED.
- Remediation status / change reference: **FIXED**; local remediation.patch against the pinned base; see CHANGE_REFERENCE.md.
### SEC-009 — Bundled Electron falls within published security advisory ranges

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `codium.lock`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `codium.lock:1`; baseline: `codium.lock:1` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-20, CWE-345; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: VSCodium 1.135.06055 ships Electron 42.8.1 in the inspected Linux artifact.
- Reproduction: Run embedded Electron with ELECTRON_RUN_AS_NODE=1 to record process.versions; query OSV for electron 42.8.1.
- Expected: Ship a patched runtime and validate its actual embedded version.
- Actual: Four published advisories match version 42.8.1, including CVE-2026-102677.
- Impact: Known affected dependency is CONFIRMED. Kural exploitability of each prerequisite is not established. Untrusted browser content makes this a release gate.
- Remediation: Upgrade compatible VSCodium to Electron >=42.10.0 (42 branch) or a supported patched newer branch; update all pinned hashes and rebuild/retest three platforms. Do not hot-patch arbitrary vendor binaries.
- Regression / verification requirement: `Record versions in all rebuilt artifacts; verify applicable advisory scenarios on isolated native hosts.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **DEFERRED**; No production/source upgrade or infrastructure change applied; follow-up in REMEDIATION_PLAN.md.
### SEC-010 — Windows signing secrets available to same-repository PR build code

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `.github/workflows/build.yml`; Windows release pipeline.
- Current location: `.github/workflows/build.yml:156`; baseline: `.github/workflows/build.yml:155` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-522, CWE-732; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Windows build job has job-wide signing-secret env on pull_request; repository-controlled build scripts run in that context.
- Reproduction: Inspect workflow trigger and Windows env/steps; no secret values were requested or accessed.
- Expected: Untrusted PR verification jobs cannot access real signing credentials.
- Actual: Secret references are present without a tag-only protected signing boundary.
- Impact: Configuration exposure confirmed; existence of real secrets and compromise NOT TESTED. Same-repository PRs receive secrets when configured; fork PR rules differ.
- Remediation: Separate credential-free PR builds from protected tag-only signing job/environment; use least permissions and short-lived identities. User approval required for workflow/settings changes.
- Regression / verification requirement: `Credential-free PR build; protected signed release canary; confirm secret scopes without exposing values.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **PARTIALLY FIXED**; the ten Windows secret bindings now require push + v* tag. audit-ci and actionlint PASS. Protected signer environment and repository rules remain unresolved.
### SEC-011 — Main and release tags lack effective merge/release protection

- Severity / confidence / classification: **Medium / High / CONFIRMED**.
- Component / operating systems: `.github/workflows/build.yml`; GitHub repository.
- Current location: `.github/workflows/build.yml:20`; baseline: `.github/workflows/build.yml:20` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-284; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Public API returns main protected:false, no effective main rules and no tag ruleset. Existing branch ruleset only lists deletion/non-fast-forward rules with empty include list.
- Reproduction: Read branches/main, rules/branches/main, rulesets and ruleset 24362718; retained JSON evidence.
- Expected: Require approved PRs and passing checks; protect release tags from unauthorized creation/update/deletion.
- Actual: No required review/status-check protection or tag protection observed.
- Impact: A contributor with sufficient write access can bypass expected release review gates. No unauthorized repository operation performed.
- Remediation: Configure explicit default-branch rules, required checks/reviews, restricted release tags and protected signing environment. Owner action required.
- Regression / verification requirement: `Requery effective rules for main/tag refs and exercise a denied change in a disposable repository.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **DEFERRED**; No production/source upgrade or infrastructure change applied; follow-up in REMEDIATION_PLAN.md.
### SEC-012 — Gemini edit notices cannot enforce Kural approval decisions

- Severity / confidence / classification: **High / High / CONFIRMED**.
- Component / operating systems: `extension/lib/ai/agy.js`; macOS arm64, Ubuntu x64, Windows x64.
- Current location: `extension/lib/ai/agy.js:541`; baseline: `extension/lib/ai/agy.js:541` (new guards may not exist in baseline; use patch for exact removed code).
- Mapping: CWE-693, CWE-862; OWASP A01 Broken Access Control / A03 Injection / A06 Vulnerable and Outdated Components / A08 Software and Data Integrity, as applicable. AI findings additionally map to OWASP LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure and LLM06 Excessive Agency.
- Root cause: Antigravity print-mode does not support an editor approval handshake; onTool fires notice asynchronously and ignores the answer.
- Reproduction: Inspect onTool and mode mapping; invoke synthetic onTool with a denying callback. Agent-mode accept-edits is controlled by provider, not the Kural card. No real provider quota consumed.
- Expected: A required Kural approval veto prevents execution before mutation.
- Actual: Callback is notification only; writes and snapshots can race.
- Impact: Executable-config/outside-file protections and reliable pre-edit Undo are not guaranteed for Gemini. Exploitation against actual CLI is NOT TESTED.
- Remediation: Adopt an approval-capable protocol or isolate provider with enforced filesystem/process policy. A feature-level restriction requires a reviewed product decision; documentation is not a fix.
- Regression / verification requirement: `Fake and real CLI tests must prove denial prevents mutation, snapshot completes first, and mode changes/handoffs retain restrictions.`.
- Verification: Evidence confirms the stated code/configuration/version/artifact fact; remediation verification is incomplete. No installed-system exploit claimed.
- Remediation status / change reference: **DEFERRED**; No production/source upgrade or infrastructure change applied; follow-up in REMEDIATION_PLAN.md.
## Scope checks and residual risk

- Reproductions use synthetic files, temporary workspaces and harmless marker hooks; no credential exfiltration or destructive production testing occurred.
- Real Claude/Codex/Gemini/Ollama sessions and adversarial handoffs were NOT TESTED. A passing host-policy test only covers callbacks actually received. Provider-native reads, CLI/MCP hooks, credentials inherited in environment and external tools can have broader access.
- Gemini snapshot notifications do not wait; retained as SEC-012, not closed by documentation.
- Browser local-development TLS relaxation/header removal is intentional code behavior, not a verified exploit. Local proxy cross-origin/navigation and SSRF scenarios require isolated network integration testing. XSS/CSP, webview-message validation and external URL handling received selected static review, not exhaustive DOM fuzzing.
- Device token scoping and approval logic received static and mocked tests; live Unix-socket integration failed EPERM here. Windows named-pipe ACL/native SSH behavior NOT TESTED.
- No custom SQL query path was identified; SQL injection NOT APPLICABLE to reviewed extension paths. Bundled SQLite/native C++ memory-corruption review NOT TESTED.
- Selected subprocesses use execFile/spawn arrays; this does not prove shell fragments, user settings, external extensions or inherited upstream code are safe.
- Static symlink escape checks and restore identity checks mitigate reproduced attacks; hostile simultaneous local filesystem changes (TOCTOU) were not comprehensively eliminated/tested.
- CodeQL's preexisting settings CAT.errors[m.item] comment was reviewed: no reproducible Object.prototype pollution demonstrated from its known error-ID flow; NOT REPRODUCED, not a confirmed vulnerability. CodeQL itself was not run.
- Two Gitleaks matches are reviewed synthetic test/signing-check values, not confirmed live credentials. No rotation performed.
- Custom issue CVSS is intentionally omitted without fully validated native exploit preconditions. Published Electron preload advisory has CVSS 7.8 (AV:L/AC:H/PR:L/UI:N/S:C/C:H/I:H/A:H); dependency presence and app exploitability remain distinct.

Evidence: findings.json, baseline-reproductions.json, baseline-* logs, post-reproductions.json, final-tests.log, final-package-verification.json, scanner/API/manifest evidence. Source diff is reviewable and reversible; no remote operations performed.


## Authorized workflow follow-up

SEC-010 is PARTIALLY FIXED: all ten Windows signing/Azure credentials now evaluate to empty values for PR, main and manual builds. The disposable signing helper remains. A v* tag push retains signing behavior. A protected signer environment/separate job and repository rules still require follow-up; this guard is not a complete signing trust boundary. See test/audit-ci.test.js and evidence/workflow-actionlint.log.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## Verified follow-up code revision

Application/build code revision: `b4c03486781d6427682ca47716efe71bd725fe34` (dependency change `39846146055280720a35d1c06d27215863d69b3e`). [Build run 38125659529](https://github.com/adithyakumarcr/kural/actions/runs/38125659529) completed successfully: full test job, Linux build, macOS DMG/startup, Windows build/install/startup, Ubuntu 22.04 and 24.04 install/startup. Release job was skipped. [CodeQL run 38125659585](https://github.com/adithyakumarcr/kural/actions/runs/38125659585) PASS. These are executed automated checks, not full platform acceptance or proof of security. The intermediate 3984614 build failed; b4c0348 corrected the rebranding dependency fixture and executable packaging modes.

Local full-run result remains 76/82 (exit1); corrected rebranding fixture and provider timing failures passed direct reruns. Process-inventory, socket and helper-liveness local failures remain documented. A CycloneDX schema validation attempt could not run because Python jsonschema is unavailable; structural regression tests passed, so formal schema validation is not claimed. The final report update changes Markdown only; code validation is bound to the above SHA.

## Electron runtime follow-up — 2026-10-11

SEC-009 is now **PARTIALLY FIXED / NATIVE VALIDATION PENDING**. All three packaging scripts replace the complete Electron runtime distribution with official **42.11.12** archives, independently pinned by SHA-256 in `vendor/electron-runtime.json`. VSCodium application code stays on 1.135.06055. The patch retains the vendor fuse wire `101100011`, Linux sandbox permissions and macOS bundle identities. Existing platform signing happens after replacement. Unknown vendor versions, changed fuses, checksum mismatches and unsafe ZIP paths/links fail the build. There is no claim that checksums constitute platform signing or notarization.

Before reproduction: original embedded Linux runtime reported Electron 42.8.1 / Node 24.18.1 / modules ABI 146. After replacement: actual embedded executable reports Electron 42.11.12 / Node 24.19.0 / ABI 146. Node-pty, Parcel watcher and SQLite native bindings load under the replacement runtime. OSV queried for npm Electron 42.11.12 returned no published advisories; this does not prove absence of vulnerabilities. Linux DEB rebuild PASS, and its SBOM records the pinned runtime/archive digest. Verified Windows and macOS vendor archives accept the replacements under Linux staging; **that is not native execution**. Fresh native build/install/startup CI must pass before closing SEC-009.

Commands: `node test/electron-runtime.test.js` PASS (2 Python regression cases), `node test/sbom.test.js` PASS, `node test/codium-lock.test.js` PASS; `./make-deb.sh` PASS; `python3 scripts/electron_runtime.py <staged-app> <platform> --archive <pinned-archive>` PASS for each target. The new CI checks execute each installed runtime and assert Electron 42.11.12 and ABI 146, followed by the existing real-window startup tests. Full suite and fresh CI results are pending at this report revision.

SEC-012 remains **OPEN**. A checksum-verified real Antigravity CLI 1.3.3 was obtained and its help examined. Official pre-execution hooks exist, but are loaded from user/workspace configuration. A mandatory per-chat configuration path protected from untrusted project configuration has not been established. A no-provider-call `/hooks` probe required authentication and was interrupted; no login or paid API call occurred. No speculative hook patch was shipped, and Gemini was not disabled. This needs an approval-capable adapter with real denial-before-mutation, hook-tampering, failure/timeout, transition and handoff tests. The authorization issue is engineering capability/validation, not missing permission to change source.

Reviewer scope: **added** pinned runtime archives/installer, security regression tests, native runtime version/ABI checks and SBOM archive provenance; **replaced** Electron 42.8.1 runtime bytes during packaging; **removed** no editor or provider functionality. Public alpha.8 binaries are unchanged until a separately approved release ships. Overall recommendation remains **NO-GO**, including open Gemini enforcement, signing/repository protection requirements and incomplete broader acceptance.
