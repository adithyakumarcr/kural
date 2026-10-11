# Evidence files

JSON inventories, scanner results and signed checksum metadata are committed directly. Verbatim `.log` files are in `validation-logs.zip`; extract from the `audit-report` directory to recreate the `evidence/*.log` paths referenced by reports. The archive preserves test output without adding thousands of console lines to the PR diff.

The standalone source-only `remediation.patch` is in the downloadable audit handoff; the PR itself is the authoritative complete code/workflow diff. No binaries/installers or credentials are committed.

## Evidence availability

Raw validation logs, scanner JSON and local environment snapshots are retained in the private audit handoff and are not published in this PR. References to `evidence/` identify those retained files. Reviewers can reproduce the code-level checks with the committed `test/audit-*.test.js` files. See the PR description for the latest 79/81 test-file result and its limitations.
