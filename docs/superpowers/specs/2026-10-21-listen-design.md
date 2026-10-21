# Listen: an answer explained out loud — design

Date: 2026-10-21. Asked for by Adithya.

## What it does

A **Listen** button on every finished chat answer. You click it and Kural starts talking at once: a short, friendly
walkthrough of the answer, like a YouTube explainer, in a voice made on this computer. The answer stays on screen and the
part being explained is highlighted, so you can follow along. Nothing you hear is made outside this computer (the
walkthrough's text is written by the chat's fast model, like Side chat).

Decided with Adithya (21 Oct 2026):

| Question | Answer |
|---|---|
| Where the voice comes from | This computer, offline. No cloud voice, no API key. |
| Which engine | Chosen per computer at first use: Kokoro (more natural) on a capable one, Piper (faster, flatter) otherwise. |
| What it says | A shorter walkthrough of the main points (about 1–2 minutes for a 300–500 word answer), not the full text. |
| Code | Explained ("this loops over the files…"), never read symbol by symbol. |
| Starting | Like Spotify: sound starts right after the click; the rest is made in the background while it plays. |
| Controls | Pause/Play, Rewind 5 s, Close. No slider. |
| Shipping | Like Whisper: nothing ships with Kural. The first Listen asks, then downloads the engine and one voice. |

Not in this version: other languages (English only), choosing a voice, speed control, a slider, listening to your own
messages, cloud voices.

## What you see

- **The button**: a speaker icon in a finished answer's action row ("Listen"). Not shown while the answer streams.
  Greyed out, with a hover saying why, when no AI is set up (the script needs one).
- **First use**: a pop-up: "Listen needs a voice, about N MB, downloaded once. Nothing you hear leaves this computer."
  Download / Cancel, then a progress bar (the same flow as voice input). N is the chosen engine's size (below).
- **Playing**: a small bar at the top of the answer:

  ```
   ❚❚  ⟲5   "Now here's the clever part…"   ✕
  ```

  The current piece's text is shown in the bar; the answer block it explains is highlighted and scrolled into view
  (only while you haven't scrolled away yourself: same rule as `stick` in the chat).
- **Controls**:

  | Control | What it does |
  |---|---|
  | Pause / Play | Stops and continues where it was |
  | Rewind 5 s | Back 5 seconds of audio, also into the previous piece; the highlight follows |
  | ✕ | Stops, closes the bar |

- One answer plays at a time: Listen on another stops the first. Switching chats keeps it playing; closing the chat
  stops it.
- Played once, the walkthrough is saved with the answer: Listen again plays at once, no AI tokens.

## How it starts at once

1. Click → the page plays the **opener** at once: one of a few short lines ("Alright, let me walk you through this."),
   made by the voice right after the download and saved, so it needs nothing at click time.
2. At the same time the host asks the fast model for the script (streamed) and feeds each finished piece to the voice.
3. Piece 1's audio arrives while the opener plays (target: under 3 s after the click); pieces play back to back. The
   voice stays a few pieces ahead of playback.

Measured targets (checked in the spike, below): first sound < 0.5 s, first real piece < 3 s, no gap between pieces on
the chosen engine.

## The pieces

New folder `extension/lib/listen/` (feature folder, wired in `extension.js` and the chat), all but `index.js` without
vscode. It follows `lib/voice/` file for file.

- **`assets.js`**: what the voice needs, each with address, size and SHA-256 pinned in code (like `lib/voice/assets.js`):
  - the TTS runtime: **sherpa-onnx's offline TTS compiled to WebAssembly** (one runtime that runs both Kokoro and
    Piper models; espeak-ng's phoneme data is part of it), built by Kural's CI at a pinned tag and published on this
    repo's release `tts-wasm-<version>`;
  - the models, from their Hugging Face repositories at pinned commits: Kokoro (int8, English, one voice) or a Piper
    voice (`en_US`, medium).
  - Two file sets, `KOKORO` and `PIPER`; `download(set, {onProgress, signal})` to `.part`, checked, renamed, into
    `<globalStorage>/listen/`. A wrong hash deletes the file and fails.
- **`device.js`**: which engine this computer gets (see "Choosing the engine").
- **`speaker.js`** + **`tts-worker.js`**: the helper process (`process.execPath`, `ELECTRON_RUN_AS_NODE=1`, with
  `--no-liftoff` like Whisper's), started on first use, stopped after 5 idle minutes. `speak(text) → {pcm Float32Array,
  sampleRate, ms}`, one JSON line per request on stdin/stdout, audio back as binary frames. A crash fails that request
  only; the next one starts it again. Threads: `os.availableParallelism() - 1`, at most 8.
- **`script.js`**: the walkthrough. The fast model (`brain.fastestModel(prefer, ["codex"])`, like Side chat: Haiku,
  Gemini's lightest, or your own model; no tools, effort low) gets the answer split into numbered blocks (paragraphs,
  list groups, code blocks, tables) and `script-prompt.md` (read on every use), and answers streamed as
  `<piece for="3">…</piece>`. `parse()` yields pieces as each closes; a `for` that doesn't exist goes to the nearest
  block; text outside pieces is dropped. Rules in the prompt: about 150–250 words, spoken English, a friendly tone,
  no markdown, no symbols, code described not read, numbers and paths said the way a person would.
- **`index.js`**: Listen. Connects them: one job per answer (`start`, `pause` is page-only, `stop`), pieces → speaker →
  the page (`listenAudio` {id, piece, block, text, pcm}), `listenState` (ask → downloading → preparing → playing → done
  | error). Saves the script and audio (one 16-bit PCM WAV per piece) under
  `scope.dir("listen", "data")/<chat id>/<message id>/`, deleted with the chat (like lessons). A saved walkthrough is
  replayed from disk.
- **`media/listen.js`**: the page. Web Audio playback of a queue of pieces (no `<audio>` element: pieces join without
  gaps), the bar, the highlight (`.blk[data-b]` of the answer), Rewind 5 s across piece boundaries, page-wide listeners
  through the chat's `on` AbortController (one per column, like `chat.js`).
- **Playback needs no permission**: unlike the microphone, playing sound in a webview is allowed as is; no `rebrand.py`
  patch.

## Choosing the engine

At the first Listen, before the download pop-up, `device.js` picks:

- **Kokoro** when the computer has at least 8 CPU threads and 8 GB of memory (`os.availableParallelism()`,
  `os.totalmem()`);
- **Piper** otherwise.

The pop-up names it and its size. After the first walkthrough, Kural measures the real speed (audio seconds made per
second). If Kokoro made audio slower than 1.2× real time (it would gap on longer answers), Kural offers once: "Use the
faster voice (Piper, N MB)?". The choice is saved in globalState `kural.listen.engine`; Kural Settings shows it with a
"Change voice engine" button (downloads the other one).

## When things go wrong

| What | What happens |
|---|---|
| Download fails or hash mismatch | The file is deleted, the pop-up says so, Listen can be tried again |
| The model fails partway | What's made plays; then a short closing line ("That's all I could put together."), and the bar says so |
| No piece arrives in 15 s | Stops with "Couldn't write the walkthrough. Try again." |
| The voice helper crashes | Playback stops, a short message; the next click restarts it |
| ✕, Stop, closing the chat | The script request and the voice stop at once; nothing half-made is saved |

## License

Kokoro (Apache-2.0), Piper's voices (per voice; pick one with a permissive license), sherpa-onnx (Apache-2.0).
espeak-ng's data/code inside the runtime is GPL-3.0: it is downloaded on first use, never shipped in Kural's installers,
and its source (the pinned tag) is published on the same `tts-wasm-<version>` release, as GPL requires. Kural's own
license is unchanged. Adithya to confirm before the first release that includes Listen.

## Spike first (before building)

1. Build sherpa-onnx TTS to WebAssembly at a pinned tag (`scripts/tts-wasm/build.sh`, a digest-pinned Emscripten image,
   like `scripts/whisper-wasm/`); run it with `ELECTRON_RUN_AS_NODE`.
2. On this computer (16 threads) and a slow one (4 threads, `taskset`): Kokoro and Piper, time to first piece and
   speed vs real time, for a 30-word and a 60-word piece.
3. Real download sizes of each set.

If Kokoro can't reach 1.2× real time on 16 threads in WebAssembly, the spec changes: Piper by default and Kokoro only
on request. If sherpa-onnx doesn't build to WASM cleanly, try kokoro-js's bundle the same way (pinned, our build).

## Tests

- `listen-assets.test.js`: pinned files, bad hash deleted (a stand-in server, like `voice-assets`).
- `listen-device.test.js`: the engine choice for stated cores/memory.
- `listen-script.test.js`: `parse()` with streamed chunks, wrong `for`, text outside pieces, a model that ignores the
  format.
- `listen-speaker.test.js`: with `test/fake-tts-worker.js` (crash, timeout, idle stop).
- `listen-chat.test.js`: the flow through the chat host with fakes: opener, pieces in order, stop, saved replay, deleted
  with the chat.
- `listen-page.test.js`: the page's queue, Rewind 5 s across pieces, one answer at a time.
- Live: `node test/listen.live.js` (real Haiku + the real runtime: first piece time, speed).

## Docs

`lib/chat/guide.js` and `docs/wiki/` (a Listen section in the chat page) in the same pull request, and a line in
`RELEASE_NOTES.md` under "Not released yet".
