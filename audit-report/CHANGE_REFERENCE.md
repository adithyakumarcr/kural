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

## Additional dependency remediation

- `39846146055280720a35d1c06d27215863d69b3e`: verified/pinned shell-quote 1.11.0; staged inventories on all targets; release inventory completeness checks; Windows build-step credential scope; tests/docs.
- `b4c03486781d6427682ca47716efe71bd725fe34`: rebranding dependency fixture and executable packaging modes; full local validation outcomes. This is the code revision validated by successful native CI runs.

The final follow-up changes audit Markdown only; it records the above results and owner approval requirements.

## Electron runtime implementation — interim verification

SEC-009 is now **PARTIALLY FIXED / NATIVE VALIDATION PENDING**. All three packaging scripts replace the complete Electron runtime distribution with official **42.11.12** archives, independently pinned by SHA-256 in `vendor/electron-runtime.json`. VSCodium application code stays on 1.135.06055. The patch retains the vendor fuse wire `101100011`, Linux sandbox permissions and macOS bundle identities. Existing platform signing happens after replacement. Unknown vendor versions, changed fuses, checksum mismatches and unsafe ZIP paths/links fail the build. There is no claim that checksums constitute platform signing or notarization.

Before reproduction: original embedded Linux runtime reported Electron 42.8.1 / Node 24.18.1 / modules ABI 146. After replacement: actual embedded executable reports Electron 42.11.12 / Node 24.19.0 / ABI 146. Node-pty, Parcel watcher and SQLite native bindings load under the replacement runtime. OSV queried for npm Electron 42.11.12 returned no published advisories; this does not prove absence of vulnerabilities. Linux DEB rebuild PASS, and its SBOM records the pinned runtime/archive digest. Verified Windows and macOS vendor archives accept the replacements under Linux staging; **that is not native execution**. Fresh native build/install/startup CI must pass before closing SEC-009.

Commands: `node test/electron-runtime.test.js` PASS (4 Python regression cases, including Python 3.10 hashing and complete macOS frameworks/bundle identity), `node test/sbom.test.js` PASS, `node test/codium-lock.test.js` PASS; `./make-deb.sh` PASS; `python3 scripts/electron_runtime.py <staged-app> <platform> --archive <pinned-archive>` PASS for each target. The new CI checks execute each installed runtime and assert Electron 42.11.12 and ABI 146, followed by the existing real-window startup tests. Full suite and fresh CI results are pending at this report revision.

SEC-012 remains **OPEN**. A checksum-verified real Antigravity CLI 1.3.3 was obtained and its help examined. Official pre-execution hooks exist, but are loaded from user/workspace configuration. A mandatory per-chat configuration path protected from untrusted project configuration has not been established. A no-provider-call `/hooks` probe required authentication and was interrupted; no login or paid API call occurred. No speculative hook patch was shipped, and Gemini was not disabled. This needs an approval-capable adapter with real denial-before-mutation, hook-tampering, failure/timeout, transition and handoff tests. The authorization issue is engineering capability/validation, not missing permission to change source.

Reviewer scope: **added** pinned runtime archives/installer, security regression tests, native runtime version/ABI checks and SBOM archive provenance; **replaced** Electron 42.8.1 runtime bytes during packaging; **removed** no editor or provider functionality. Public alpha.8 binaries are unchanged until a separately approved release ships. Overall recommendation remains **NO-GO**, including open Gemini enforcement, signing/repository protection requirements and incomplete broader acceptance.

Validation update: local full suite **80/83 files PASS, exit1**; bench-memory process lookup, device socket EPERM and updater helper-liveness fail in this host. CI test job and CodeQL passed on `1f4f2de`; the Linux build exposed Python 3.10 incompatibility in `hashlib.file_digest`, corrected in `75be8b2` with a streaming hash and regression. Complete macOS dependency frameworks are also replaced, with bundle-identity regression coverage. Final fresh native CI is required.

## Final Electron remediation verification

Runtime commits:

- `1f4f2de0236c7da780918fcea444fdafa6169cf6`: coherent checksum-pinned Electron 42.11.12 runtime replacement, native version/ABI checks and archive/fuse tests.
- `75be8b21858205b9589e0f359fab36ca817f5a6d`: Python 3.10-compatible streaming hash with regression.
- `c346902c08e51360634a9ec862c85fbb8197b087`: all macOS dependency frameworks replaced; identity regression and build documentation.
- `d7a6987929793c69df2fa9a47915446cc488b33d`: waited Windows process and exit-7 negative control. **Final validated code revision.**

[Build 38131185955](https://github.com/adithyakumarcr/kural/actions/runs/38131185955) / [CodeQL 38131185998](https://github.com/adithyakumarcr/kural/actions/runs/38131185998) PASS; all 83 test files and supported-target build/install/runtime/startup checks; release SKIPPED. Final follow-up is Markdown-only, including `GEMINI_ADAPTER_REQUIREMENTS.md`. Full local patch and redacted raw logs are retained privately. Published binaries, main and production settings were not changed.


## SEC-012 hook gate

Commit `297944cf5850c3e3cf814ccc05e7aa2d25dadfb0` (branch `sec61`, on top of `857f352`). Status: **IMPLEMENTED, NOT VERIFIED against the real CLI**.

- **Added:** `extension/lib/ai/agy-gate.js` (hook program), `extension/lib/ai/agy-gate-host.js` (installer, socket host, registry, `isGateFile`), `test/agy-gate.test.js`, `scripts/verify-agy-gate.sh` (owner-run real-CLI acceptance).
- **Replaced:** the fire-and-forget `onPermission({notice: true})` in `AgyAgent.onTool` with `gateDecide` (waiting) and `gateMissed` (detection); the "Gemini can't ask" Agent-mode note wording.
- **Changed:** `extension/lib/ai/agy.js`, `extension/lib/chat/permission-policy.js` (`unclassified`, `guard`, Browser, Bash `cwd`), `extension/lib/chat/index.js` (gate requests bound to mode/running answer, `revokeGate` on mode change), `extension/lib/ai/danger.js`, `extension/lib/paths.js`, `extension/extension.js` (stop host on deactivate), `scripts/from-scratch.sh` (remove the hook entry), `test/fake-agy.js` (runs hooks), `test/agy.test.js`, `test/permissions.test.js`, `test/from-scratch.test.js`, `test/handoff-fakes.test.js` and `test/team-agent.test.js` (temporary HOME), `CLAUDE.md`, `README.md`, `RELEASE_NOTES.md`, `extension/lib/chat/guide.js`, `docs/wiki/Chat.md`, `docs/wiki/Google-Gemini-and-ChatGPT.md`.
- **Removed:** no provider or tool functionality; Gemini's tools and modes are unchanged.


## Second-pass remediation

Branch `sec61` on top of `f2372f3`; merge `4355ff8` joins four branches (`fix2-agent`, `fix2-app`, `fix2-release`, `fix2-bugs`; one conflict in `lib/chat/archive.js`, both changes kept). Commits: 45a7e81, 4e5c3b3, 44d85c2, 5b1508f, 262df09, 9a4b60b (agent boundary); 9b17d98, 47726e6, 8410fad, 22fd704, a98fb97, b2d2dc8, 6192638, 07045f0 (app); 11acb48, 3cbe796, f37dc98 (release/supply); 0654497, 065fae6, dcf48e5, b084bf7, f4f0b9f, 6146aa6, 55be254 (bugs/perf/tests). New files: `lib/private-file.js`, `lib/update-net.js`, `lib/utf8.js`, `lib/ai/killtree.js`, `lib/chat/trim.js`, `scripts/requirements-icons.txt` and 14 test files. Local `npm test`: all 98 test files PASS (exit 0) at `4355ff8`.


## Third pass

Commits on `sec61`: f9498b4 (APP-9), 971799d (REL-3), 4ff201a (APP-6 Linux), 098b198 (DEP-001). New: `extension/lib/install-deb.sh`, `test/connector-keys.test.js`, `test/install-deb.test.js`; `vendor/electron-runtime.json` gained `bundles`. Local `npm test`: 100/100 test files PASS.
