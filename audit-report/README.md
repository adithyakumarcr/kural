# Security audit review guide

This PR contains twelve locally verified application fixes and a partial CI credential-isolation fix, plus the eight required audit reports. Start with RELEASE_READINESS.md, SECURITY_AUDIT.md and BUG_REPORT.md. CHANGE_REFERENCE.md identifies the two implementation commits; CI_PROPOSAL.md distinguishes the applied guard from deferred signer isolation.

The latest npm test run passed 79/81 test files. Device Unix-socket tests fail with EPERM and updater helper-liveness assertions fail in the audit container. All six added regression files pass. Linux DEB build/packaged-content checks and workflow actionlint passed. Native macOS/Windows and desktop installer/provider acceptance remain untested. Release recommendation remains NO-GO.

Raw logs, scanner JSON, local environment snapshots and binary archives are deliberately kept out of this public PR. They remain in the private audit handoff; references in the reports identify that evidence. No release binaries or credentials are included.
