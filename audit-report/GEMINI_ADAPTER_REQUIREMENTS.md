# Gemini approval boundary: unresolved engineering work

Finding **SEC-012 remains CONFIRMED / OPEN**. Returning a denial from the current `agy.js` edit notice cannot prevent a mutation that the CLI has already performed. Killing the CLI after the event also cannot establish pre-edit authorization or recover the original bytes.

## Investigated options

The official [Antigravity hooks documentation](https://antigravity.google/docs/hooks/) describes a `PreToolUse` decision hook loaded through user or workspace configuration. CLI 1.3.3's actual help exposes no per-chat settings/hook override. A private mandatory hook immune to project overrides, startup hooks and agent configuration edits has not been verified. The two tested app-data environment overrides did not establish an isolated configured hook; the no-provider-call probe stopped at authentication. This is incomplete verification, not proof that the vendor cannot support an appropriate integration.

The official [SDK policy interface](https://antigravity.google/docs/sdk/policies/) supports application approval callbacks. Its [quickstart](https://antigravity.google/docs/sdk/overview/) uses API-key or Google Cloud authentication. Switching Kural to that interface needs explicit compatibility work for existing CLI login, model selection, saved conversations, attachments, usage, stop/resume and integrations. It is not a validated drop-in replacement. No real credentials or paid provider calls were used.

## Required implementation behavior

- Every tool executes only after a trusted host decision. Map file, shell, web, device, MCP and nested-agent calls to Kural's existing policy. Unknown tools require approval; Ask/Plan deny unknown capabilities until classified.
- The CLI/SDK must wait for the decision. A denial, disconnected host, invalid request, timeout or cancelled chat prevents execution. No provider-side permissive fallback is acceptable.
- Save the checkpoint only after authorization, and finish it before mutation. Keep file contents byte-exact and enforce canonical paths.
- Bind approval to chat, tool arguments and current mode. Reject stale responses after mode changes, handoffs, restarts or cancellation. Nested agents retain the host gate.
- Keep bridge authentication and configuration outside project control. A repository hook, MCP response or model edit must not replace or deactivate the gate. Existing third-party startup hooks require a separate trust decision.
- Preserve the current provider's authentication and conversation features, or present an explicit supported migration. Do not quietly disable Gemini or downgrade its tools to make tests pass.

## Acceptance tests before closure

Use temporary workspaces, synthetic keys and a local mock model endpoint where supported. With the real provider runtime, a denied write/shell call must leave a harmless marker absent; a pending approval must leave it absent until approval and checkpoint completion. Verify Ask/Plan, Auto's dangerous-command exceptions, outside-workspace reads, symlink aliases, forged hook configuration, host death, timeouts, malformed requests, mode transitions and nested-agent handoffs. Execute platform bridge/termination tests on Linux, macOS and Windows. Fake-provider tests alone cannot close this finding.

Current blocker is an unimplemented, unverified adapter boundary. Existing clearance covers source changes; it does not supply a verified provider capability or authorize paid API tests. Resume with this interface investigation rather than treating documentation or a warning as remediation.

Synthetic recheck on the current adapter: `onTool()` returned before a pending denying callback resolved, the notice flag was true, and the denial was not transmitted. No CLI process or model request was started, and no marker file was written. Private handoff: `evidence/gemini-notice-repro.js` / `.json`. This validates adapter semantics, not a real-provider exploitation claim.
