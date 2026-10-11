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
| SEC-009 | High | Bundled Electron falls within published security advisory ranges | DEFERRED | 2–5 days | Record versions in all rebuilt artifacts; verify applicable advisory scenarios on isolated native hosts. |
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

1. Review local patch and run full suite on unrestricted CI/native Linux. Resolve the three existing fixture failures before declaring suite green.
2. Upgrade vendor runtime coherently across three pins; recheck Electron >=42.10.0 and bundled shell-quote; trace advisory applicability.
3. Resolve Gemini enforced-approval/snapshot limitations with an approval-capable adapter or isolated process policy; test handoffs/mode transitions on real CLI. Documentation does not close SEC-012.
4. Minimal tag-push-only workflow guard approved/applied; protect main, release tags and signing environments and separate the signer as the remaining owner follow-up.
5. Generate per-artifact SBOM and verify source provenance; configure Windows publisher and macOS Developer ID/notarization.
6. Native installer/updater/recovery/uninstall tests plus first-launch, offline/failure, GUI review and profile credentials; retain user-data backups in disposable test accounts.
7. Measure actual startup/idle/long-run resources. Publish only a new version after release approval, never replace alpha.8 silently.

No real production/data destruction needed for follow-up: use disposable VMs, synthetic credentials, fake provider/tool servers and temporary repositories. Source changes remain reversible and reviewable. User authorization required only for workflow/settings changes, production/destructive operations, push or release publishing.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

## Follow-up implementation

Packaged shell-quote is now 1.11.0 with integrity checks and regression coverage. Packaged manifest inventories and mandatory platform merge are implemented; native/bundle inventory enrichment remains. Windows secrets now exist only in the gated build step. Native CI on commit 34b7d92fc976ec648e00d90ba13765146251c305 passed the complete test job and macOS/Windows/Ubuntu 22.04/24.04 build/install/startup checks. These results precede this follow-up and must be repeated on its new head.

Owner action still required: effective main/tag protection and protected signing environment, Windows certificate, Apple Developer ID/notarization credentials. Source changes/push/PR updates are authorized; merging, release publishing and production settings changes are not performed. Gemini enforcement and vendor Electron upgrade remain engineering blockers, not resolved by documentation.
