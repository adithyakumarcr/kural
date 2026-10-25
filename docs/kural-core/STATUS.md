# Kural Core: status

**Stopped on 25 Oct 2026; all code removed.** Why, what was measured and what was removed: `README.md`.

| Milestone | State | Notes |
|---|---|---|
| M0 Documents | done | PRD, ARCHITECTURE, PLAN, FEATURES, CHAT, track briefs |
| M1 Foundation | done, then removed | `src/` overlay (`scripts/vscode/overlay.py`, `fetch.sh --src`), hook patch `0001-kural-core`, the Kural host (utility process, MessagePort per window, `_kural.host.ping`, warm-up at startup), `base` (paths, private files, process helpers, version compare) with 16 unit tests, `lint.sh`, `build-lock.sh`, `npm ci` only when dependencies change. Checked: type check, ESLint 0 warnings, unit tests, a Mac build whose test copy started the host and connected two windows to it |
| M2 Wave 1 | stopped at about 9 %, removed | T1 build, T2 hooks, T3 project views (experiment kept in `README.md`), T4 AI providers (7,088 lines), T5 router/split/devices (4,917 lines) |
| M3-M5 | not started | merge, wave 2, switch-overs |
