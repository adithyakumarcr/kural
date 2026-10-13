# PERFORMANCE REPORT

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Measurements actually executed

| Measurement | Result | Scope |
| --- | --- | --- |
| Final DEB rebuild elapsed | 80.707 seconds | One container run of bash make-deb.sh; warm vendor download cache |
| Build child-process peak RSS | 1174680 KiB | Python getrusage(RUSAGE_CHILDREN).ru_maxrss; peak child RSS, not editor RSS or aggregate agents |
| Cold/warm editor startup | NOT TESTED | GUI unavailable; root sandbox prevented native CLI smoke |
| Idle editor CPU/RSS | NOT TESTED | ps process inventory fails in this container |
| Real AI session memory/CPU/network | NOT TESTED | No provider API calls or authenticated sessions |
| Concurrent agent/long-run leaks | NOT TESTED | Short protocol mocks cannot establish long-term stability |
| Native shutdown/orphan cleanup | NOT TESTED | Updater liveness fixture failure requires representative OS rerun |

Existing docs/benchmarks are prior maintainer observations, not reproduced baselines. No performance improvement is claimed from security changes. The StringDecoder correction is correctness, not a measured throughput optimization. Byte snapshots use base64 (additional storage) and retain display text; memory/disk implications on many large edited files require a real stability test. Existing MAX_DISK cutoff and checkpoint cleanup were not load-tested comprehensively. Build measurements are recorded so the handoff is reproducible; they are not application acceptance benchmarks.

Suggested follow-up: fixed hardware and clean/warm-cache launches, 30-minute idle baseline, 2-hour mocked local-provider sessions, repeated stop/restart, 1/4/8-agent scenarios, open-file growth and child-process inventory after shutdown. Use synthetic workloads and report hardware/tool/commit details, medians and variance; no paid APIs without approval.


## PR follow-up

The existing bench-memory.test.js process-inventory fixture passed on the latest PR validation run. Its earlier container ps failure was transient; no benchmark source fix or editor performance improvement is claimed. Actual native editor/agent resource benchmarks remain NOT TESTED.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## Verified follow-up code revision

Application/build code revision: `b4c03486781d6427682ca47716efe71bd725fe34` (dependency change `39846146055280720a35d1c06d27215863d69b3e`). [Build run 38125659529](https://github.com/adithyakumarcr/kural/actions/runs/38125659529) completed successfully: full test job, Linux build, macOS DMG/startup, Windows build/install/startup, Ubuntu 22.04 and 24.04 install/startup. Release job was skipped. [CodeQL run 38125659585](https://github.com/adithyakumarcr/kural/actions/runs/38125659585) PASS. These are executed automated checks, not full platform acceptance or proof of security. The intermediate 3984614 build failed; b4c0348 corrected the rebranding dependency fixture and executable packaging modes.

Local full-run result remains 76/82 (exit1); corrected rebranding fixture and provider timing failures passed direct reruns. Process-inventory, socket and helper-liveness local failures remain documented. A CycloneDX schema validation attempt could not run because Python jsonschema is unavailable; structural regression tests passed, so formal schema validation is not claimed. The final report update changes Markdown only; code validation is bound to the above SHA.

## Runtime upgrade follow-up

Electron 42.11.12 candidate builds passed automated startup smoke checks on macOS arm64, Ubuntu 22.04/24.04 x64 and a Windows Server 2025 x64 runner (d7a6987, Build run 38131185955). This is functional liveness evidence, not a cold/warm startup benchmark. No new CPU/RSS/leak/network/shutdown measurement or performance improvement is claimed. First builds additionally download about 120–150 MB per platform for the checksum-pinned runtime; subsequent builds can reuse the verified cache.
