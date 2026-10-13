# Security audit review guide

PR #61 tracks 20 findings: 13 FIXED, 2 PARTIALLY FIXED and 5 DEFERRED. Start with RELEASE_READINESS.md, SECURITY_AUDIT.md, BUG_REPORT.md and DEPENDENCY_AUDIT.md. CHANGE_REFERENCE.md identifies implementation revisions; REMEDIATION_PLAN.md gives the concrete owner settings proposal and unresolved engineering work.

Latest code head b4c0348 passes the full CI test job, CodeQL, macOS DMG/startup, Windows installer/startup and Ubuntu 22.04/24.04 installer/startup checks. The local full run was 76/82; rebranding/provider fixtures passed direct reruns, with environment-sensitive process/socket/helper failures retained. Linux DEB byte verification, dependency/inventory regressions and actionlint pass. Broad provider, updater/recovery, uninstall/data-preservation and performance acceptance remain incomplete.

Release recommendation remains NO-GO: affected Electron, Gemini approval enforcement and protected signing/release configuration remain open. Existing released artifacts have not been replaced. No merge, release, credential rotation or production settings operation was performed.

Raw logs, scanner JSON, environment snapshots and archives remain in the private audit handoff. This public PR contains reviewable source, tests, pinned upstream dependency contents and Markdown reports.
