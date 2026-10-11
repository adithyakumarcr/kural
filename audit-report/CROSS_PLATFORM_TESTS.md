# CROSS PLATFORM TESTS

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Supported targets verified from scripts/lock/workflow

| Platform | Target / formats | Unsupported targets |
| --- | --- | --- |
| macOS | Apple Silicon arm64, DMG and ZIP | Intel/macOS x64 not implemented in current pin/workflow |
| Ubuntu | 22.04/24.04 x86_64, DEB | ARM64/other Linux formats not implemented in current release |
| Windows | Windows 10/11 x64, per-user setup EXE and portable ZIP | ARM64/x86 releases not implemented |

## Test matrix

PASS only denotes the specific executed check. Linux container is not a complete desktop or installer environment. Native build/install/startup smoke checks subsequently passed as recorded below; broader acceptance remains NOT TESTED.

| Check | macOS arm64 | Ubuntu x64 | Windows x64 |
| --- | --- | --- | --- |
| Published artifact hashes vs verified signed manifest | PASS (DMG+ZIP) | PASS (DEB) | PASS (EXE+ZIP) |
| Static archive metadata inspection | PASS (ZIP) | PASS (DEB) | PASS (ZIP+PE header) |
| Package build | PASS (macOS arm64 CI) | PASS (DEB/container + CI) | PASS (cross-build CI) |
| Native installation/startup smoke | PASS (arm64 CI) | PASS (22.04 + 24.04 CI) | PASS (windows-latest CI) |
| OS publisher signing readiness | FAIL (ad-hoc CodeDirectory) | NOT APPLICABLE (individual DEB platform signing) | FAIL (empty installer certificate table) |
| Gatekeeper/quarantine/notarization | NOT TESTED | NOT APPLICABLE | NOT APPLICABLE |
| Defender/SmartScreen/UAC/registry | NOT APPLICABLE | NOT APPLICABLE | NOT TESTED |
| Native updater interrupted/restart/recovery | NOT TESTED | NOT TESTED | NOT TESTED |
| Native keychain/credential storage permissions | NOT TESTED | NOT TESTED | NOT TESTED |
| AI CLI discovery/authentication/execution | NOT TESTED | NOT TESTED | NOT TESTED |
| Native terminal/SSH integration | NOT TESTED | NOT TESTED (socket EPERM) | NOT TESTED |
| Uninstall/user-data preservation | NOT TESTED | NOT TESTED | NOT TESTED |
| Unicode/long paths/native file permissions | NOT TESTED | NOT TESTED (synthetic UTF-8/byte tests PASS separately) | NOT TESTED |
| Core JS security regressions executed on target OS | NOT TESTED | PASS (Node in Ubuntu container) | NOT TESTED |
| GUI review/Auto Save behavior | NOT TESTED | NOT TESTED (mocked contract PASS) | NOT TESTED |

## Applied source changes / workarounds

Shared JS fixes cover targets by intent; Windows regex matching preserves case-insensitive executable-config checks. Updater schemas retain supported per-platform names. No OS privilege/quarantine workarounds applied. Linux CLI attempts were blocked by root Electron sandbox policy; switching to nobody failed `cannot set groups: Operation not permitted`. No `--no-sandbox` workaround used. Run Ubuntu22.04 and24.04 native desktop VMs, Apple Silicon macOS and Windows10/11 before marking installation, update or uninstall PASS. Existing mac-swap and updater script fixtures run on Linux do not count as native macOS tests.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## Native CI follow-up (2026-10-11)

[Build run 38124450582](https://github.com/adithyakumarcr/kural/actions/runs/38124450582), commit 34b7d92fc976ec648e00d90ba13765146251c305: test job PASS; macOS build/ad-hoc signature/DMG copy/startup PASS; Windows build/install/startup PASS; Ubuntu 22.04 and 24.04 install/startup PASS. CodeQL run 38124450589 PASS. The earlier table describes the initial local investigation; these narrowly scoped checks supersede its NOT TESTED build/startup rows. Gatekeeper notarization, real provider authentication, update interruptions, uninstall/data preservation and long-run stability remain NOT TESTED. The new dependency/inventory changes require a fresh CI run before inheriting these results.

## Verified follow-up code revision

Application/build code revision: `b4c03486781d6427682ca47716efe71bd725fe34` (dependency change `39846146055280720a35d1c06d27215863d69b3e`). [Build run 38125659529](https://github.com/adithyakumarcr/kural/actions/runs/38125659529) completed successfully: full test job, Linux build, macOS DMG/startup, Windows build/install/startup, Ubuntu 22.04 and 24.04 install/startup. Release job was skipped. [CodeQL run 38125659585](https://github.com/adithyakumarcr/kural/actions/runs/38125659585) PASS. These are executed automated checks, not full platform acceptance or proof of security. The intermediate 3984614 build failed; b4c0348 corrected the rebranding dependency fixture and executable packaging modes.

Local full-run result remains 76/82 (exit1); corrected rebranding fixture and provider timing failures passed direct reruns. Process-inventory, socket and helper-liveness local failures remain documented. A CycloneDX schema validation attempt could not run because Python jsonschema is unavailable; structural regression tests passed, so formal schema validation is not claimed. The final report update changes Markdown only; code validation is bound to the above SHA.
