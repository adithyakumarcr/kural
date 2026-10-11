# REMEDIATION PLAN

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Prioritized work

Estimates are engineering planning estimates, not measured completion times; signing certificate procurement/native hosts can add external delays. FIXED denotes the reproduced code-level issue plus regression; it does not imply published or cross-platform verified.

| ID | Severity | Impact / task | Implementation | Estimated effort | Required verification |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | High | Repository instruction symlinks disclose outside files | FIXED | 0.5–2 days | node test/audit-boundaries.test.js; node test/audit-host.test.js |
| SEC-002 | High | Implicit private-storage reads and preapproved web egress | FIXED | 0.5–2 days | node test/audit-boundaries.test.js; node test/audit-host.test.js |
| SEC-003 | High | Executable repository configuration writes bypass approval | FIXED | 0.5–2 days | node test/audit-boundaries.test.js; node test/paths-runs-later.test.js |
| SEC-004 | High | Background terminal Git context executes repository hooks | FIXED | 0.5–2 days | node test/audit-boundaries.test.js |
| SEC-005 | High | Release tag suffix accepted as shell-bearing version | FIXED | 0.5–2 days | node test/audit-release.test.js |
| SEC-006 | High | Signed old artifacts can be relabeled as a newer update | FIXED | 0.5–2 days | node test/audit-release.test.js |
| SEC-007 | High | Ask/Plan mutation requests not denied by trusted host policy | FIXED | 0.5–2 days | node test/audit-boundaries.test.js; node test/audit-host.test.js |
| SEC-008 | High | Undo follows a redirected symlink target | FIXED | 0.5–2 days | node test/audit-data.test.js |
| SEC-009 | High | Bundled Electron falls within published security advisory ranges | FIXED | 2–5 days | Record versions in all rebuilt artifacts; verify applicable advisory scenarios on isolated native hosts. |
| SEC-010 | High | Windows signing secrets available to same-repository PR build code | PARTIALLY FIXED | 1–2 days | Credential-free PR build; protected signed release canary; confirm secret scopes without exposing values. |
| SEC-011 | Medium | Main and release tags lack effective merge/release protection | DEFERRED | 0.5 day | Requery effective rules for main/tag refs and exercise a denied change in a disposable repository. |
| SEC-012 | High | Gemini edit notices cannot enforce Kural approval decisions | DEFERRED | 3–7 days | Fake and real CLI tests must prove denial prevents mutation, snapshot completes first, and mode changes/handoffs retain restrictions. |
| BUG-001 | High | Auto Save can persist unreviewed Ctrl+K code | FIXED | 0.5–2 days | node test/audit-review.test.js |
| BUG-002 | High | Undo corrupts non-UTF-8 file bytes | FIXED | 0.5–2 days | node test/audit-data.test.js |
| BUG-003 | Medium | Split UTF-8 stdout chunks corrupt model output | FIXED | 0.5–2 days | node test/audit-data.test.js |
| BUG-004 | Medium | Failed Undo deletion reports success | FIXED | 0.5–2 days | node test/audit-data.test.js |
| DEP-001 | Medium | Published SBOM omits most bundled runtime components | PARTIALLY FIXED | 1–3 days | Compare SBOM against artifact inventory, and ensure Electron/shell-quote/runtime versions included. |
| DEP-002 | High | Bundled shell-quote 1.10.0 has a published injection advisory | FIXED (library; callers unestablished) | 1–2 days | Run upstream quotation regression and integration tests of reachable callers. |
| REL-001 | Medium | Published Windows installer lacks embedded Authenticode | DEFERRED | 1–3 days | Get-AuthenticodeSignature and native install/uninstall validation. |
| REL-002 | Medium | Published macOS executables use ad-hoc signatures | DEFERRED | 2–4 days | codesign --verify --deep --strict; spctl assessment; stapler validate; fresh quarantined install. |

## Release order and ownership

1. Review local patch and run full suite on unrestricted CI/native Linux. Record local failures separately from representative CI; the complete CI test job passes on code commit b4c0348.
2. Upgrade vendor runtime coherently across three pins; recheck Electron >=42.10.0; packaged shell-quote is now 1.11.0; trace advisory applicability.
3. Resolve Gemini enforced-approval/snapshot limitations with an approval-capable adapter or isolated process policy; test handoffs/mode transitions on real CLI. Documentation does not close SEC-012.
4. Minimal tag-push-only workflow guard approved/applied; protect main, release tags and signing environments and separate the signer as the remaining owner follow-up.
5. Enrich the implemented per-artifact manifest SBOM with native/bundled dependencies and verify source provenance; configure Windows publisher and macOS Developer ID/notarization.
6. Native installer/updater/recovery/uninstall tests plus first-launch, offline/failure, GUI review and profile credentials; retain user-data backups in disposable test accounts.
7. Measure actual startup/idle/long-run resources. Publish only a new version after release approval, never replace alpha.8 silently.

No real production/data destruction needed for follow-up: use disposable VMs, synthetic credentials, fake provider/tool servers and temporary repositories. Source changes remain reversible and reviewable. User authorization required only for workflow/settings changes, production/destructive operations, push or release publishing.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## Follow-up implementation

Packaged shell-quote is now 1.11.0 with integrity checks and regression coverage. Packaged manifest inventories and mandatory platform merge are implemented; native/bundle inventory enrichment remains. Windows secrets now exist only in the gated build step. Native CI on commit 34b7d92fc976ec648e00d90ba13765146251c305 passed the complete test job and macOS/Windows/Ubuntu 22.04/24.04 build/install/startup checks. These results precede this follow-up and must be repeated on its new head.

Owner action still required: effective main/tag protection and protected signing environment, Windows certificate, Apple Developer ID/notarization credentials. Source changes/push/PR updates are authorized; merging, release publishing and production settings changes are not performed. Gemini enforcement remains an engineering blocker; the Electron runtime upgrade is now verified in candidate builds.

### Proposed owner settings (not applied)

- Main: require a pull request, at least one independent review, dismiss stale approvals, block force-push/deletion, and require the verified GitHub Actions checks `test`, `macos`, `linux-check (ubuntu-22.04)`, `linux-check (ubuntu-24.04)`, `windows-check`, and `analyze`. Choose reviewers/bypass policy before applying; a sole maintainer cannot independently approve their own PR.
- Release tags (`v*`): restrict creation to the release maintainer process and prohibit update/deletion except documented emergency access. Keep the existing requirement that tags match the application version and are on main.
- Signing: create a protected environment with an owner-selected reviewer and release-tag restrictions; move publisher credentials into it after an isolated signing job is implemented and validated. Moving secrets alone would leave the current build without them.
- Signing credentials: provision Windows Authenticode and Apple Developer ID/notarization through protected secret storage. No real credential values belong in reports or source.

The effective main-rules API was queried again on 2026-10-11 and returned an empty list. These settings and credential operations require owner access/approval under the original production-change restriction. Code/workflow remediation remains authorized.

### Gemini adapter constraint

The [official headless protocol](https://antigravity.google/docs/cli/headless/) documents that control-request/control-response stream events terminate the session and workspace file writes can be auto-allowed. This supports retaining SEC-012 as open: the current tool notices cannot become a reliable approval gate by returning a decision or killing the process afterwards. The real CLI was unavailable in the initial pass; see the latest follow-up below. A hook/SDK adapter or cross-platform process confinement requires capability-specific integration and real-provider permission tests before closure; no paid calls were made.

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

SEC-009 is **FIXED in candidate builds**: d7a6987 and [Build 38131185955](https://github.com/adithyakumarcr/kural/actions/runs/38131185955) / [CodeQL 38131185998](https://github.com/adithyakumarcr/kural/actions/runs/38131185998) PASS. Current tracked status: **14 FIXED, 2 PARTIALLY FIXED, 4 DEFERRED**. Remaining engineering priority is SEC-012, detailed in `GEMINI_ADAPTER_REQUIREMENTS.md`; synthetic denial callbacks still do not prevent provider execution. Owner-controlled protection/signing requirements remain. Native smoke passes do not close broader acceptance or dependency inventory. No additional source-code clearance is required, but paid API calls, production settings, credentials, merge and publication are outside performed work. See `RELEASE_READINESS.md` for full result.
