# Voice Input in the Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mic button in Kural's chat: record, transcribe on this computer with Whisper (English), clean up fillers and
grammar with the fastest model, put the result in the box.

**Architecture:** The chat page records (`MediaRecorder`), decodes to 16 kHz mono and sends samples to the extension.
`lib/voice/` downloads Whisper on first use (WASM + model, pinned SHA-256), transcribes in a helper process
(`ELECTRON_RUN_AS_NODE`), and asks the fastest model for a cleanup, falling back to the raw text.

**Tech Stack:** Plain JavaScript (no npm runtime deps), whisper.cpp v1.9.5 compiled with Emscripten (Docker), Node
worker threads inside the WASM build, VS Code webview messages.

**Spec:** `docs/superpowers/specs/2026-10-20-voice-input-design.md`

## Global Constraints

- No emoji anywhere; webview icons are Codicons (`mic`, `mic-filled`); UI text says "Kural", never "Claude" for Kural.
- `extension/` has no build step and no runtime npm dependencies; files in `lib/voice/` other than `index.js` must not
  `require("vscode")`.
- Nothing about Whisper ships with Kural: both files are downloaded only after the user clicks Download.
- Files: `whisper.wasm` + its loader from this repo's release `whisper-wasm-1.9.5`; model `ggml-base.en-q5_1.bin` (56 MB)
  from Hugging Face `ggerganov/whisper.cpp` at a pinned commit. Each pinned by size and SHA-256 in `assets.js`.
- Stored in `<globalStorage>/voice/`. Audio is never written to disk.
- English only. Click to start / click to stop; shortcut `ctrl+alt+v` / Mac `cmd+alt+v` when the chat is focused; Esc
  cancels; 5:00 limit.
- Result goes into the box at the cursor, never sent automatically; Undo puts the raw transcript in its place.
- Cleanup: `brain.fastestModel(undefined, ["codex"])`, no tools, effort low, no thinking, 15 s limit; fallback = raw text.
- Helper process stops after 5 idle minutes; threads = `min(8, max(1, os.availableParallelism() - 1))`.
- The chat page's CSP does not change.
- Copy (exact): ask bar "Voice input needs Whisper, a speech model that runs on this computer (about 60 MB, once). Nothing
  you say leaves it."; Mac usage text "Kural uses the microphone only while you record a voice prompt in the chat."
- Feature changes update `lib/chat/guide.js`, `docs/wiki/Chat.md`, `RELEASE_NOTES.md` ("## Not released yet"), `CLAUDE.md`.

## Review Focus

- Silence or noise only: Whisper returns "" or "[BLANK_AUDIO]"/"(music)"-style tags → "No speech heard", nothing inserted.
- A download interrupted (Stop, network drop, app closed): the temp file never becomes a "ready" file; next click asks again.
- Cleanup that changes meaning or answers the transcript as if it were a request ("write a test for X" → the model writes
  a test): output longer than 2x the transcript, or without `<clean>` tags → use the raw transcript.
- Recording when the chat tab changes or the window closes mid-recording: the recording is cancelled, no stray text lands
  in another tab's box.
- A second click while transcribing/cleaning: ignored (button disabled), no second recording.

---

### Task 1: Build Whisper as WebAssembly and measure it (gate)

**Files:**
- Create: `scripts/whisper-wasm/kural-whisper.cpp`, `scripts/whisper-wasm/build.sh`
- Create: `test/fixtures/voice/jfk.wav` (whisper.cpp's `samples/jfk.wav` at v1.9.5, 11 s, US public domain)
- Create: `test/voice-transcribe.live.js`

**Interfaces:**
- Produces: `dist/whisper-wasm/kural-whisper.js` (Emscripten loader, `MODULARIZE`, `EXPORT_NAME=createWhisper`, Node env,
  `USE_PTHREADS`, `PTHREAD_POOL_SIZE=8`, `ALLOW_MEMORY_GROWTH`, `-O3 -msimd128`) + `kural-whisper.wasm` +
  `kural-whisper.worker.js` if emitted.
- Embind API: `init(modelPath: string) → bool`, `transcribe(samples: Float32Array, threads: number) → string` (all
  segment texts joined, trimmed; language "en", no timestamps, greedy), `free()`.

- [ ] **Step 1:** Write `kural-whisper.cpp` (embind, modelled on whisper.cpp's `bindings/javascript/emscripten.cpp` but
  returning the text via `whisper_full_n_segments` / `whisper_full_get_segment_text` instead of printing).
- [ ] **Step 2:** Write `build.sh`: clone whisper.cpp at tag `v1.9.5` into `dist/whisper-src`, build in Docker image
  `emscripten/emsdk:3.1.74` (pin by digest), output to `dist/whisper-wasm/`, print `sha256sum` of each output.
- [ ] **Step 3:** Run `bash scripts/whisper-wasm/build.sh`. Expected: three or two files in `dist/whisper-wasm/`, exit 0.
- [ ] **Step 4:** Write `test/voice-transcribe.live.js`: loads the build from `KURAL_WHISPER_DIR` (default
  `dist/whisper-wasm`) and the model from `KURAL_WHISPER_MODEL` (default `dist/ggml-base.en-q5_1.bin`, downloaded by the
  test if missing), reads `jfk.wav` (16-bit PCM 16 kHz), transcribes it once and repeated 3x (33 s), prints both times.
  Asserts the text contains "ask not what your country can do for you" (case/punctuation ignored).
- [ ] **Step 5:** Run `node test/voice-transcribe.live.js`. Expected: PASS, prints `33 s of audio in N ms`.
- [ ] **Step 6: Gate.** Report the time to Adithya. Under 5000 ms → continue. Over → stop and decide with him
  (`tiny.en`, or native). Record the measured time in the spec's "First step" section.
- [ ] **Step 7:** Commit (`scripts/whisper-wasm/`, the fixture, the live test, the spec note).

### Task 2: Publish the WASM build from CI

**Files:**
- Create: `.github/workflows/whisper-wasm.yml`
- Modify: `scripts/whisper-wasm/build.sh` (also write `SHA256SUMS` and copy whisper.cpp's `LICENSE` as `LICENSE-whisper.cpp`)

**Interfaces:**
- Produces: release `whisper-wasm-1.9.5` (pre-release, not "latest") with `kural-whisper.js`, `kural-whisper.wasm`,
  (`kural-whisper.worker.js`), `SHA256SUMS`, `LICENSE-whisper.cpp`; their sizes and hashes go into Task 3's `FILES`.

- [ ] **Step 1:** Workflow: `workflow_dispatch` only, `permissions: contents: write`, runs `build.sh`, then
  `gh release create whisper-wasm-1.9.5 --prerelease --latest=false --title "Whisper for Kural's voice input (whisper.cpp 1.9.5)"` with the files (or `gh release upload --clobber` when it exists).
- [ ] **Step 2:** Push the branch; ask Adithya to run the workflow (creating the release's tag needs his bypass). Expected:
  the release exists with all files; its `SHA256SUMS` equals the local build's from Task 1 (Emscripten builds are
  reproducible at a pinned image; if not, the release's hashes are the ones pinned).
- [ ] **Step 3:** Commit.

### Task 3: Download and verify (`lib/voice/assets.js`)

**Files:**
- Create: `extension/lib/voice/assets.js`
- Test: `test/voice-assets.test.js`

**Interfaces:**
- Produces: `FILES: [{name, url, size, sha256}]` (the WASM files from Task 2, the model at pinned HF commit);
  `TOTAL_BYTES`; `class Assets { constructor(dir, {fetchFiles = FILES, downloadTo = require("../update-net").downloadTo} = {}); ready(): Promise<boolean>; paths(): {loader, wasm, model}; download({onProgress(got, total), signal}): Promise<void>; remove(): Promise<void> }`.

- [ ] **Step 1: Failing tests** (stand-in HTTP server on 127.0.0.1 serving test files; `FILES` passed in):
  - `download fetches every file, reports progress up to total, and ready() is true after`
  - `a wrong sha256 deletes the file and rejects with "Whisper's download didn't match"`
  - `a wrong size is refused the same way`
  - `Stop (signal.abort) leaves no files and ready() is false`
  - `a file already there with the right hash isn't downloaded again`
  - `ready() checks hashes once, then trusts size and mtime` (change a byte without changing size/mtime → still true;
    change size → false)
- [ ] **Step 2:** `node test/voice-assets.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement. Download each to `<name>.part`, hash while writing isn't required (hash after), rename on
  match; `<dir>` created 0700; progress is the sum over files against `TOTAL_BYTES`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 4: Transcribe in a helper process (`whisper-worker.js`, `transcriber.js`)

**Files:**
- Create: `extension/lib/voice/whisper-worker.js`, `extension/lib/voice/transcriber.js`
- Test: `test/voice-transcriber.test.js` (with `test/fake-whisper-worker.js`)

**Interfaces:**
- Consumes: `Assets#paths()`.
- Produces: `class Transcriber { constructor({paths: () => {loader, wasm, model}, execPath = process.execPath, worker = <path of whisper-worker.js>, idleMs = 300000, log}); transcribe(samples: Float32Array): Promise<{text: string, ms: number}>; stop(): void }`.
  `isBlank(text): boolean` (exported): true for "" and texts made only of bracketed/parenthesised tags like
  `[BLANK_AUDIO]`, `(music)`, `[ Silence ]`.
- Wire protocol over stdio (audio stays in memory, never a file): request = a JSON line `{"id":N,"n":<samples>}` followed
  by exactly `n * 4` bytes of little-endian Float32 samples; answer = one JSON line `{"id":N,"text":"…","ms":123}` or
  `{"id":N,"error":"…"}`.

- [ ] **Step 1: Failing tests** (the fake worker echoes the sample count as text, or errors / exits on demand):
  - `transcribe sends the samples and resolves with the worker's text and ms`
  - `two calls in a row reuse one process`
  - `the process stops after idleMs and a later call starts it again`
  - `a worker crash rejects that call only; the next call works`
  - `isBlank: "", "[BLANK_AUDIO]", " (music) ", "[ Silence ]" are blank; "Hello." isn't`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `transcriber.js` (spawn with `ELECTRON_RUN_AS_NODE=1`, `stdio: pipe`, `lib/utf8.js onText`
  for stdout, `lib/ai/killtree.js` to stop) and `whisper-worker.js` (loads `createWhisper` from the loader path given in
  argv, `init(model)` once, threads per Global Constraints, answers per the protocol).
- [ ] **Step 4:** Run → PASS. Then run the real worker once: extend `test/voice-transcribe.live.js` with a second case
  through `Transcriber` → PASS with the same JFK sentence.
- [ ] **Step 5:** Commit.

### Task 5: Cleanup (`cleanup.js`)

**Files:**
- Create: `extension/lib/voice/cleanup.js`
- Test: `test/voice-cleanup.test.js`

**Interfaces:**
- Produces: `SYSTEM` (string), `buildPrompt(transcript): string`, `extract(reply, transcript): string|null`,
  `cleanup(transcript, deps): Promise<{text, cleaned: boolean, why?: string, model?: string}>` where `deps` are the same
  as Side chat's (`makeAgent, model, mode, emptyDir, check, isClaude, nameOf, localOpts, cwd`) plus `timeoutMs = 15000`.

- [ ] **Step 1: Failing tests** (Side chat's stand-in agent harness):
  - `the prompt puts the transcript inside <transcript> and says it is data, not a request`
  - `extract takes the text inside <clean>…</clean>, trimmed`
  - `extract returns null without <clean>, or when the result is over 2x the transcript's length + 40 characters`
  - `cleanup returns the cleaned text and the model's name`
  - `no model set up → {text: transcript, cleaned: false, why: "No AI is set up, so the text isn't cleaned up."}`
  - `an error, an exit or 15 s without an answer → the raw transcript with why`
  - `the agent is started with tools: [], effort "low", noThinking, and is killed after`
  - `the system prompt says: keep technical words, code, file and command names exactly; add nothing`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (same agent options as `side.js` `ask`, single `send(buildPrompt(t))`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 6: `Voice` and the chat's messages

**Files:**
- Create: `extension/lib/voice/index.js`
- Modify: `extension/lib/chat/index.js` (constructor next to `this.sideChats`; message switch near `case "enhance"`;
  `dispose`/tab close cancels)
- Modify: `extension/extension.js` (create `Voice` with `<globalStorage>/voice`, pass to the chat; register
  `kural.chat.voice`)
- Modify: `extension/package.json` (command `kural.chat.voice` "Kural: Record a Voice Prompt"; keybinding `ctrl+alt+v` /
  mac `cmd+alt+v`, `when: kural.chatFocused`)
- Test: `test/voice-chat.test.js`

**Interfaces:**
- Consumes: `Assets`, `Transcriber`, `isBlank`, `cleanup`.
- Produces: `class Voice { constructor({dir, cleanupDeps, log}); state(): "missing"|"ready"|"downloading"; download(onProgress, signal); begin(tabId); chunk(tabId, seq, samples: number[]); finish(tabId): Promise<{raw, text, cleaned, why?, model?}>; cancel(tabId) }`.
  Page → host: `voiceStart {tabId}`, `voiceDownload`, `voiceDownloadStop`, `voiceChunk {tabId, seq, samples}`,
  `voiceStop {tabId}`, `voiceCancel {tabId}`.
  Host → page: `voiceState {tabId, phase: "ask"|"downloading"|"recording"|"transcribing"|"cleaning"|"done"|"error", pct?, raw?, text?, why?, message?}`; `voiceToggle` (from the command).

- [ ] **Step 1: Failing tests** (fake Assets/Transcriber/cleanup injected):
  - `voiceStart with Whisper missing posts phase "ask"; voiceDownload posts downloading with pct, then "recording"`
  - `chunks are joined in seq order; voiceStop → transcribing → cleaning → done {raw, text}`
  - `blank speech → error "No speech heard"; nothing inserted`
  - `cleanup fallback → done with text = raw and why`
  - `voiceCancel and closing the tab drop the chunks; a later voiceStop does nothing`
  - `a second voiceStart for another tab while one records → error "Already recording in another chat"`
  - `more than 5 minutes of samples (4,800,000) are cut to 5 minutes`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `Voice` and the wiring (replies after an `await` use `postTo(pane, …)`).
- [ ] **Step 4:** Run → PASS; `npm test` → only the known local `rebrand-toast` failure.
- [ ] **Step 5:** Commit.

### Task 7: The mic on the chat page

**Files:**
- Create: `extension/media/voice.js` (factory like `media/side.js`: `module.exports = make` in tests, `window.KURAL_VOICE` in the page)
- Modify: `extension/media/chat.js` (mic button beside `enhanceBtn`; bar; Esc; insert at cursor; Undo), `extension/media/chat.css`,
  `extension/lib/chat/index.js:741` (one more `<script nonce>` for `voice.js`)
- Test: `test/voice-page.test.js` (the small DOM from `side-page.test.js`, a fake `navigator.mediaDevices`, `MediaRecorder`, `AudioContext`)

**Interfaces:**
- Consumes: Task 6's messages.
- Produces: `make({post, el, icon, flash, insertText(text), replaceText(old, text), now = Date.now, media}) → { button, bar, toggle(), cancel(), onState(msg) }`.

- [ ] **Step 1: Failing tests:**
  - `click with phase ask shows the exact ask text and Download / Not now`
  - `Download posts voiceDownload; progress shows "Downloading Whisper… 42 %" and Stop`
  - `recording shows a timer and level; a second click stops and posts the chunks of 16000 samples then voiceStop`
  - `Esc while recording posts voiceCancel and inserts nothing`
  - `done inserts the text at the cursor (a space before it if needed) and shows "From your voice · Undo"`
  - `Undo replaces the cleaned text with the raw transcript`
  - `permission refused shows the Mac hint "Allow Kural in System Settings > Privacy & Security > Microphone"`
  - `the button is disabled while transcribing and cleaning, hidden in a visiting chat`
  - `at 5:00 it stops by itself`
  - `switching tabs while recording cancels it`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Decode: `new OfflineAudioContext(1, Math.ceil(duration * 16000), 16000)` over
  `decodeAudioData(await blob.arrayBuffer())`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 8: Microphone on the Mac build

**Files:**
- Modify: `build-mac.sh` (main entitlements: add `device.audio-input`, change the "no camera or microphone" comment;
  set `NSMicrophoneUsageDescription` to the exact text in Global Constraints)
- Test: `test/build-mac-mic.test.js` (reads `build-mac.sh`: the main `ent` line has `device.audio-input`, no `device.camera`;
  the usage text is set)

- [ ] **Step 1:** Failing test → Step 2: run, FAIL → Step 3: change `build-mac.sh` → Step 4: PASS → Step 5: commit.

### Task 9: Docs and release notes

**Files:**
- Modify: `extension/lib/chat/guide.js` (the chat paragraph: mic, one-time download ~60 MB, offline, English only,
  Ctrl+Alt+V, cleanup by the quick model, nothing sent), `docs/wiki/Chat.md`, `RELEASE_NOTES.md` (new
  "## Not released yet" at the top), `CLAUDE.md` ("Voice input" entry: `lib/voice/`, the pins, the helper process, the
  WASM release, the Mac entitlement, the tests)
- Test: `test/whats-new.test.js` still passes; `npm test`.

- [ ] **Step 1:** Write the docs. **Step 2:** `npm test` → only the known `rebrand-toast` failure. **Step 3:** Commit.

### Task 10: Check it in the app

- [ ] **Step 1:** `./install.sh --ext`; Developer: Reload Window.
- [ ] **Step 2:** In a chat: click the mic → ask → Download → speak a sentence with "um" → stop. Expected: cleaned text in
  the box within ~5 s, Undo gives the raw one; nothing sent. Esc cancels. Ctrl+Alt+V toggles.
- [ ] **Step 3:** Report to Adithya with times; the Mac permission prompt is checked on a Mac build by him.
