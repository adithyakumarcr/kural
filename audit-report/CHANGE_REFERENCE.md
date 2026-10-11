# Change reference

Base commit: `2814cd8aed8309b3de173b04c87e91ff3e72636d` (profiles / PR #60 head).

Security PR branch: `security-fixes/agent-permissions-and-release-integrity`.

PR base: `8d02fbca7202b9338cd000ee3e8fa9b408b7f265` (main after #60; tree identical to the audited profiles revision).

Implementation commits:

- `c73dcc1959bf3b0c174859ae1deeb39657981c09` — application hardening, five regression files and behavior documentation.
- `a3a15e59e92f7aa0bbfc96b9f12ab94e38c61b25` — Windows workflow credential guard, sixth regression file and signing documentation.

A separate report commit contains the audit evidence/handoff. No release or main merge performed.

Standalone source-only patch (downloadable audit handoff, not duplicated in the PR): `remediation.patch`; SHA-256: `fa99ccca43ff6a80b66f0e92f725b0f8f4511ca501285a35c6fd19c210a99589`. Apply from a clean checkout at the base with `git apply --check /path/remediation.patch` then `git apply /path/remediation.patch`. The patch excludes reports and proposed workflow changes.

Changed files:

- `README.md`
- `docs/wiki/Inline-Edit.md`
- `extension/lib/ai/claude.js`
- `extension/lib/ai/engine.js`
- `extension/lib/chat/changes.js`
- `extension/lib/chat/guide.js`
- `extension/lib/chat/index.js`
- `extension/lib/chat/permission-policy.js`
- `extension/lib/chat/project.js`
- `extension/lib/edit/review.js`
- `extension/lib/paths.js`
- `extension/lib/profiles/scope.js`
- `extension/lib/release-verify.js`
- `extension/lib/tab/terminal.js`
- `extension/lib/updates.js`
- `extension/lib/version-compare.js`
- `extension/lib/workspace.js`
- `extension/package.json`
- `test/mac-swap.test.js`
- `test/permissions.test.js`
- `test/profiles.test.js`
- `test/audit-boundaries.test.js`
- `test/audit-data.test.js`
- `test/audit-host.test.js`
- `test/audit-release.test.js`
- `test/audit-review.test.js`

The original source-only patch above contains the first investigation fixes. The PR additionally includes .github/workflows/build.yml, test/audit-ci.test.js and docs/windows-signing.md in the second implementation commit. Native UI/provider/install acceptance remains incomplete.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.
