# T5: Model Router, parallel agents and devices in the Kural host

PRD R2.4, FEATURES "Model Router", "Parallel agents", "Devices". Port to TypeScript in the Kural host:
`extension/lib/router/*` (policy, words classifier + `words-model.json`/`examples.json`, helper client, learn, journal,
retrieve; NOT `panel.js`, which is UI), `extension/lib/split/*` (SplitAgent, worktrees, plan prompts), `extension/lib/git.js`,
`extension/lib/devices/*` (ssh, bridge, device-mcp; NOT the vscode UI parts of `index.js`: port its non-UI logic, and list
the UI parts for the later UI track). Not wired to UI yet: complete, faithful, typed, tested.

## You own
`src/vs/platform/kural/{common,node}/{router,split,devices,git}/**` and
`src/vs/platform/kural/test/{common,node}/{router,split,devices,git}/**`. Nothing else.

Available to you: `src/vs/platform/kural/common/ai/agent.ts` (the agent contract: SplitAgent IS an `IAgent` and wraps
other `IAgent`s made by a factory it is given), `src/vs/platform/kural/node/base/*`, `common/base/*`. Track T4 ports the
providers at the same time: don't import `node/ai/**` or `common/ai/**` except `agent.ts`; whatever you need from them (a
model's traits, usage numbers, `fastestModel`, `makeAgent`) is passed in: define the small interface in your own folder.

## Rules for the port
- Same behaviour, same prompts, same files on disk (worktrees, handoff archives, router memory), same JSON: keep every
  comment that says why. `node scripts/train-router.js` must still produce the weights your classifier reads (keep the JSON
  files as data next to the code; check how the build carries `.json` files under `src/` and say what you chose).
- `vscode` is gone: settings, workspaceState (router memory: `kural.router.memory.v1`), the log, storage folders become
  explicit inputs. The devices' list lived in globalState `kural.devices.v1`: take a storage interface.
- Device MCP relay and the bridge: private socket, token per chat, exactly as today (CLAUDE.md "Devices over SSH").
- Port the tests: `test/router*.test.js`, `test/haiku-build.test.js`, `test/split*.test.js` (the non-page parts),
  `test/devices.test.js`, `test/audit-f1.test.js` (the split part), using the repository's `test/fake-*.js` programs (real git
  for the worktrees tests, `test/fake-ssh.js` for devices).
- TypeScript strict, VS Code's style, no npm dependencies.

## Deliver
Ported modules, their tests passing in the tree, type check and lint clean, and a report that lists every legacy export and
where it went, and the interfaces the chat runtime will call.
