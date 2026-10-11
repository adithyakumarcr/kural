# CI PROPOSAL

Audit date: 2026-10-11 (UTC). Target: profiles / PR #60 head `2814cd8aed8309b3de173b04c87e91ff3e72636d`; main `fa78955dd6b5e455fe00c03d7c10c38a20a1c51c` was not assumed equivalent. Initial investigation used `audit/security-remediation`. Authorized PR follow-up uses `security-fixes/agent-permissions-and-release-integrity` based on merged main `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (same tree as audited profiles head). The Windows workflow credential guard is now included. No release published or repository settings changed. Published artifact inspected: v1.1.0-alpha.8, which still contains original code. Local changes do not protect existing installations until a new validated release ships.

Environment: Ubuntu 24.04.3 x86_64 container; Node 24.19.0, npm 11.9.0, Python 3.12.14, Git 2.51.1. No native macOS/Windows, GUI/display server, production credentials, or paid provider calls. A local build is not a native installation/startup test.

## Long-term pipeline proposal — NOT APPLIED

User Phase10 explicitly says: "Do not modify GitHub workflows without approval." The user approved the minimal credential guard and security branch/PR in the follow-up. The long-term isolated-signing design and production repository settings remain follow-up work.

1. Keep pull_request test/platform build jobs credential-free. Remove all signing/certificate/Azure credential job env from Windows build. Do not write PFX, call external signing service or expose signing-store passwords in PR jobs. Preserve disposable self-signed signing helper test.
2. Separate protected release-sign job with `if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')`, `environment: release-signing`, minimal contents:read and id-token only if needed. Fetch artifacts by exact run/digest from successful approved build; verify source tag ancestry/version, run/scanner gates and immutable artifact digest. Never run arbitrary PR artifact executable code with signing secrets.
3. Reference real signing secrets only at the signing step in protected job, prefer federated short-lived key access; use 0700/0600 temporary keystore cleanup. Restrict environment to intended v* tags and required owner reviewer. GitHub environment restrictions require separate owner settings changes.
4. Release publish job depends on successful native build/test/sign jobs, signs checksum manifest and attaches provenance over final signed bytes. Enforce no overwrite and verify attestation digest/source/ref before publish.
5. Add credential-free PR gates: existing npm test, JS/bash syntax, Semgrep JS/security rules pinned, CodeQL JS, Gitleaks pinned+redacted, per-artifact OSV/native dependency inventory. Replace informational `npm audit || true` with a scoped explicit gate once nonempty dependencies exist. Review documented scanner exceptions individually, retaining version/path/reachability evidence.
6. Native matrix: Ubuntu22.04/24.04 x64 DEB install/remove/recovery; macOS arm64 signature/notarization/quarantine; Windows10/11 x64 setup/portable and Authenticode/uninstall. GUI read-only review/Auto Save and provider deny-before-edit fixtures mandatory.
7. Settings proposal: main requires PR + owner review + test/security/build checks and no force pushes/deletion; v* tags restricted create/update/delete to release maintainers; production signing secrets scoped to protected environment. No production settings were modified in this engagement.

The minimal guard is applied and its branch/PR push is authorized. Owner-level GitHub settings and publishing remain unchanged. This report is not an automatically enforced control and does not close SEC-010/011.


## Reviewable interim patch

CI_CREDENTIAL_GUARD.patch changes only Windows job signing/Azure secret expressions to empty values on pull_request, populated only on push to v* tags. It is now APPLIED in .github/workflows/build.yml, with explanatory comments and a regression test. This removes routine PR-job exposure in the current workflow; it is not a substitute for a separate protected signing environment or branch/tag settings. Implement the isolated signing design above as a separate reviewed follow-up. A write-enabled actor who can alter workflows still requires owner-enforced protection.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.

Follow-up: publisher secrets are additionally scoped to the gated Windows build step. Packaged inventories are required on all three builds and merged before signed checksum generation. Full tests/CodeQL/platform build/startup checks pass on b4c0348. Protected signer isolation and main/tag/environment settings remain owner follow-up; the concrete proposal is in REMEDIATION_PLAN.md.
