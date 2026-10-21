# Listen: an answer explained out loud — design

Date: 2026-10-21. Asked for by Adithya. Second version, after a review of the first (what changed and why: at the end).

## What it does

A **Listen** button on every finished chat answer. You click it and Kural starts talking at once: a short, friendly
walkthrough of the answer, like a YouTube explainer, in a voice made on this computer. The answer stays on screen and the
part being explained is highlighted, so you can follow along.

Decided with Adithya (21 Oct 2026):

| Question | Answer |
|---|---|
| Where the voice is made | On this computer, offline. No cloud voice, no API key. |
| Which voice engine | Decided by a spike (below): Supertonic 3, Kokoro and Piper, timed on real machines; Adithya picks by ear. One engine for everyone if it's fast enough on a 4-thread machine; a second, lighter one only if the numbers show weaker machines need it. |
| What it says | A short walkthrough of the main points: about 150–250 words, 1–2 minutes for a 300–500 word answer. |
| Code | Explained ("this loops over the files and skips the hidden ones"), never read symbol by symbol. |
| Starting | Like Spotify: sound right after the click; the rest is made in the background while it plays. |
| Controls | Pause/Play, Rewind 5 s, Close. No slider. |
| What's saved | The walkthrough's text, on the answer. Not the audio: replaying makes it again on this computer (free, fast). |
| Shipping | Like Whisper: nothing ships with Kural. The first Listen asks, then downloads the voice. Every file pinned by size and SHA-256. |

Not in this version: other languages (English only), choosing a voice, speed control, a slider, listening to your own
messages, a keyboard shortcut, cloud voices, Listen in a chat opened from another workspace (read only, like Side chat).

## What you see

- **The button**: a speaker icon ("Listen") in the finished answer's `.answer-actions` row, beside Fork from here
  (`media/chat.js` `messageNode`). Not shown while the answer streams, nor in a read-only chat from another workspace.
  Greyed out, with the reason on hover, when no model can write the walkthrough (see "Which model writes it").
- **First use**: a pop-up: "Listen needs a voice: about N MB, downloaded once. The voice is made on this computer; the
  walkthrough's words are written by <model> from this answer." Download / Cancel, then a progress bar (voice input's
  flow). N is the real size of the chosen engine's files.
- **Playing**: a small bar at the top of the answer (under the model line):

  ```
   ❚❚  ⟲5   "Now here's the clever part…"   ✕
  ```

  It shows the sentence being spoken. The part of the answer it explains is highlighted and scrolled into view; once you
  scroll the chat yourself during a listen, it stops scrolling for you (it still highlights) until you press Play or
  Rewind.
- **Controls**:

  | Control | What it does |
  |---|---|
  | Pause / Play | Stops and continues where it was |
  | Rewind 5 s | Back 5 seconds of audio, across sentences and pieces if needed; the highlight follows |
  | ✕ | Stops, closes the bar |

- **One at a time** in the window: Listen on another answer (any chat, any pane) stops the first.
- **It plays where you clicked**: a chat can be on screen in several places (the side panel, its columns, an editor
  beside the code). The sound and the bar are only in the place you clicked. If that place shows another chat, closes,
  or the answer is removed (Edit), it stops. Sending a new message in the same chat doesn't stop it.

## How it starts at once

1. **Warm-up on hover**: pointing at Listen starts the voice helper (it loads the engine and model; no AI request, no
   tokens). It stops again after 5 idle minutes.
2. **Click**, first time for this answer: the page plays an **opener** at once ("Alright, let me walk you through
   this."; one of five, picked at random), made with the chosen voice right after the download and kept in
   `<globalStorage>/listen/openers/`. Meanwhile the host asks the model for the walkthrough, streamed.
3. **Sentence by sentence**: as each sentence of the walkthrough is complete, it goes to the voice helper; each finished
   sentence's audio goes to the page and is queued. The first sentence is short by design (the prompt asks for it), so
   it is ready before the opener ends. The helper keeps a few sentences ahead of playback.
4. **Replay** (the walkthrough is saved): no opener, no AI request; the first sentence goes to the voice at once.

Targets (the spike checks them): on a first-time click, first sound (the opener) < 0.3 s and the first real sentence
< 2.5 s; on replay with a warm helper, the first sentence < 1 s; no gaps between sentences.

## Which blocks get explained (the highlight)

The page decides, because it has the rendered answer. `media/chat.js` `markdown()` turns the answer's text into top-level
elements: paragraphs, lists, code cards, tables, headings (and `hr`). At the click, `listen.js` walks the answer's text
blocks that are outside the steps dropdown (not `.interim`, not inside `.steps`), numbers their top-level elements in
order (skipping `hr`), tags each with `data-lb="<n>"`, and sends `[{n, kind: "p"|"list"|"code"|"table"|"heading", text}]`
with the click. The script refers to these numbers, so the highlight always matches what is on screen. When the chat
redraws (a new message, a `full` redraw), the page tags the blocks again the same way before the next highlight.
(`.blk[data-b]` is NOT used: one text block is the whole answer, not a paragraph.)

Limits on what goes to the model: at most 12,000 characters in total; a code block is cut to its first 40 lines, a
table to its first 20 rows (it's explained, not read).

## The walkthrough (script)

- The model gets the numbered blocks and `script-prompt.md` (read on every use, like Enhance's prompt) and answers
  streamed as `<piece for="3">…</piece>` pieces, in the order to speak them. A `for` that isn't a block number goes to
  the nearest one; text outside pieces is dropped; a reply with no pieces at all is treated as one piece for block 0.
- Prompt rules: about 150–250 words in total; the first sentence short (under 12 words); spoken English, friendly,
  contractions, short sentences; no markdown, symbols, or lists; code described, never read; file paths said the way a
  person would ("the chat's index file", not `lib/chat/index.js`); numbers spoken naturally. If the engine has
  expression tags (Supertonic 3's `<laugh>`, `<breath>`, `<sigh>`…), the prompt lists the ones it supports and allows at
  most one per piece; otherwise the prompt doesn't mention them.
- `speech.js` (no vscode) then: splits pieces into sentences; strips anything markdown-like left over; removes
  expression tags the engine doesn't support; fixes a short table of tech words the voices say badly (npm → "N P M",
  JSON → "jason", CLI → "C L I", UI → "U I", README → "read me", `.js` → "dot J S"…; extended from the spike's
  listening test).

## Which model writes it

- The chat's model is **on this computer** (Ollama) → the same local model writes it. Nothing leaves the computer for a
  chat you keep local.
- Otherwise: Side chat's choice, `brain.fastestModel(<chat's model>, ["codex"])`: the chat's own AI first (Haiku, or
  Gemini's lightest), no tools, effort low, no thinking, Side chat's options (Claude: `systemPrompt` + the shared empty
  folder; agy: `--mode plan`, its session-map entry removed after).
- Codex is skipped, as in Side chat (it can't be made answer-only). Known gap: someone with only ChatGPT set up gets a
  greyed-out Listen ("Listen needs Claude, Gemini or a model on this computer to write the walkthrough").
- No team, no turn, no tab status, no notification: like Side chat, it isn't part of the conversation.

## Saved with the answer

```
msg.listen = { pieces: [{ block, text }], model, engine, at }
```

Like Side chat's `msg.side`: tiny, deleted with the chat, copied by Fork, cut by Edit, and ignored by handoffs (journal
reads only blocks). Saved only when the walkthrough finished; a stopped or failed one isn't kept. `clean()` drops malformed
entries from old chats. The `text` keeps expression tags; `speech.js` strips the ones the current engine can't say, so a
later engine change still replays.

## The pieces

New folder `extension/lib/listen/`, wired in `extension.js` and the chat; all but `index.js` without vscode. It follows
`lib/voice/` (assets, a helper process, a host class that posts states to the page).

| File | Job |
|---|---|
| `assets.js` | The chosen engine's files (runtime + model + voice), each with URL, size and SHA-256 pinned in code; `ready()`, `download({onProgress, signal})` to `.part`, checked, renamed into `<globalStorage>/listen/`; a wrong hash deletes the file |
| `engines/<name>.js` | One per engine the spike keeps: text → model inputs and the model's outputs → PCM (Supertonic: characters, no phonemizer; Kokoro/Piper: phonemes). The same small interface: `load(paths, threads)`, `speak(text) → {pcm Int16Array, rate}` |
| `tts-worker.js` | The helper: `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and `--no-liftoff` (as Whisper's), loads the runtime and the engine once, answers one JSON line per request on stdin, audio back as length-prefixed binary on stdout. Threads: `os.availableParallelism() - 1`, at most 8 (fewer if the spike shows Tab Completion's local model suffers) |
| `speaker.js` | Starts/stops the helper (`warm()`, 5 idle minutes), `speak(text)` → audio, a crash fails that request only; the next one restarts it |
| `script.js` | Builds the prompt from the blocks, runs the model (Side chat's deps), `parse()` yields pieces as they close |
| `speech.js` | Sentences, clean-up, tag filtering, the pronunciation table |
| `script-prompt.md` | The walkthrough prompt |
| `index.js` | `Listen`: one job in the window; blocks → script → sentences → speaker → the page; states; saving `msg.listen` |
| `media/listen.js` | The page: the button, the bar, block numbering and tags, Web Audio playback of a queue of sentences (no `<audio>` element: they join without gaps), Pause (`ctx.suspend()`), Rewind 5 s over the queue, the highlight; per column, page-wide listeners through the chat's `on` AbortController |

Messages (page → host): `listenWarm {tabId}`, `listenStart {tabId, index, blocks}`, `listenStop {tabId, index}`,
`listenDownload`. Host → page, **only to the pane that started it** (`postTo(pane, …)`, never `post()`, which goes to
every pane and would play the audio twice): `listenState {tabId, index, phase: ask | downloading {pct} | preparing |
playing | done | error {message}}`, `listenAudio {tabId, index, seq, block, text, pcm, rate}`, `listenEnd`. The page
answers a host's `listenStop` (another Listen started) by stopping.

Playback needs no permission: VS Code's webview frames already allow `autoplay`, the AudioContext starts inside the click,
and Web Audio buffers need no CSP change. No `rebrand.py` patch, so `./install.sh --ext` is enough to try it.

## The engine (decided by the spike)

| | Supertonic 3 | Kokoro (82M) | Piper (medium) |
|---|---|---|---|
| Sounds | Natural; **expression tags** (`<laugh>`, `<breath>`, `<sigh>`… 10 of them) | The most natural of the small models (reviews) | Clear but flatter |
| Needs a phonemizer | No (reads characters) | Yes: espeak-ng (GPL-3) | Yes: espeak-ng (GPL-3) |
| Model | ~99M parameters, 44.1 kHz | ~86–114 MB int8, 24 kHz | ~60 MB, 22.05 kHz |
| License | Code MIT; weights OpenRAIL-M (use restrictions, passed on to users) | Apache-2.0 | Per voice: `en_US-lessac` is **non-commercial**; pick a public-domain or CC-BY voice (e.g. LJSpeech) |
| Watch out | Its GitHub repository was archived (9 Sept 2026): no more fixes; the files are pinned anyway | int8 gave silent audio in sherpa-onnx's WASM (#2236): test the exact file | — |

**Decision rule**: the best-sounding engine (Adithya's pick) that meets the bars below on a 4-thread machine is the only
engine. If it meets them only on stronger machines, the lighter engine that does is added for the rest, and the rule
for "stronger" comes from the spike's numbers (not a guessed thread count). In that case, after the first walkthrough
Kural measures the real speed, and if the voice made audio slower than 2× real time it offers once to switch to the
lighter one; Kural Settings shows the engine with "Change voice".

**If Kokoro or Piper wins** (espeak-ng is GPL-3): the voice helper for that engine (its glue code, plain MIT, not Commons
Clause, + espeak-ng) is a separate program downloaded from Kural's release with espeak-ng's source beside it; Kural's
extension only starts it and talks to it over stdin/stdout. Kural's own license is unchanged. Adithya to confirm before
release (not legal advice).

## Packaging (like Whisper)

- **Runtime**, in this order, stopping at the first that meets the bars:
  1. Microsoft's prebuilt onnxruntime-web WebAssembly (SIMD + threads), pinned from npm, run in the helper. Open
     question for the spike: whether its threads work under `ELECTRON_RUN_AS_NODE` (sherpa-onnx's own Node WASM build
     is single-threaded, which is why it's not used).
  2. Our own reproducible onnxruntime WebAssembly build with threads, made by a workflow like `whisper-wasm.yml` (pinned
     Emscripten image, output checked against pinned hashes), published on this repo's release `tts-wasm-<version>`.
  3. Microsoft's native onnxruntime-node (Node-API, works in Electron without rebuilding), one pinned file set per
     platform. Check first that the Mac app may load it (the ad-hoc signature; `build-mac.sh`'s rcodesign path keeps the
     hardened runtime with `disable-library-validation`).
- **Models and voices**: from their Hugging Face repositories at pinned commits (as Whisper's model).
- Changing any file = new pins in `assets.js`.

## When things go wrong

| What | What happens |
|---|---|
| Download fails or a hash doesn't match | The file is deleted, the pop-up says so, Listen can be tried again |
| The model fails partway | What's made plays, then a short closing line ("That's all I could put together."), and the bar says so |
| No piece within 15 s | Stops: "Couldn't write the walkthrough. Try again." |
| The helper crashes | Playback stops with a short message; the next click restarts it |
| ✕, another Listen, the pane switches chats or closes, Edit removes the answer | The model request and the helper's queue stop at once; nothing half-made is saved |

## Spike first (the plan's first task)

Throwaway code under `scripts/listen-spike/`; results in `docs/benchmarks/listen-2026-10-<day>.md`.

1. Runtime ladder step 1: Microsoft's onnxruntime-web in a helper run by Kural's own program
   (`ELECTRON_RUN_AS_NODE`): does it start threads? If not, steps 2 or 3.
2. For Supertonic 3, Kokoro and Piper, on this computer (16 threads) and limited to 4 (`taskset -c 0-3`): model load
   time, time to audio for a 10-word and a 30-word sentence (cold and warm), speed against real time, the helper's
   memory, download size.
3. The same real walkthrough (written by Haiku from a real Kural answer, with Supertonic's tags where they fit) read by
   each engine, saved as WAV files for Adithya to listen to and pick.
4. Bars on 4 threads: warm 10-word sentence ≤ 1.5 s; audio made at least 2× faster than it plays; load ≤ 4 s;
   helper ≤ 700 MB.

The decision (engine, runtime, voice) is written back into this spec before the build starts.

## Tests

- `listen-assets.test.js`: pinned files; a bad hash is deleted (a stand-in server, like `voice-assets`).
- `listen-script.test.js`: `parse()` on streamed chunks, a wrong `for`, text outside pieces, no pieces at all.
- `listen-speech.test.js`: sentences, tag filtering per engine, the pronunciation table, leftover markdown.
- `listen-speaker.test.js`: with `test/fake-tts-worker.js` (crash, timeout, idle stop, warm).
- `listen-chat.test.js`: through the chat host with fakes: audio only to the pane that clicked; one at a time; a saved
  walkthrough replays without a model; a local chat uses its local model; Codex-only = greyed out with the reason;
  Edit, Fork and deleting the chat.
- `listen-page.test.js`: block numbering and re-tagging after a redraw, the queue, Pause, Rewind 5 s across sentences,
  the scroll rule.
- Live: `node test/listen.live.js` (real Haiku and the real engine: first-sound and first-sentence times, speed).

## Docs

`lib/chat/guide.js` and `docs/wiki/` (Listen in the chat page) in the same pull request; a line in `RELEASE_NOTES.md`
under "Not released yet".

## What changed from the first version, and why

| First version | Now | Why |
|---|---|---|
| sherpa-onnx WebAssembly running Kokoro | A spike between three engines and a runtime ladder | sherpa-onnx's Node WASM is single-threaded; its maintainer calls Kokoro there "super slow"; its int8 Kokoro gave silent audio |
| Kokoro or Piper by a guessed thread/memory rule | One engine if it's fast enough everywhere; a rule from measured numbers only if needed | A guess can't tell a slow 8-thread laptop from a fast one |
| espeak-ng (GPL) always | None with Supertonic; a separate GPL program only if Kokoro or Piper wins | Supertonic reads characters |
| Highlight on `.blk[data-b]` | The page numbers the rendered paragraphs, lists, code, tables | One text block is the whole answer |
| Audio messages to every pane | Only to the pane you clicked in | A split chat would have played twice |
| Audio saved as WAV per piece | Only the walkthrough's text, on the message | ~3–5 MB per listened answer; making it again is free |
| "Nothing you hear leaves this computer" | The voice is local; the words come from your AI; a local chat's walkthrough stays local | The answer's text goes to the model that writes the walkthrough |
| A piece at a time to the voice | A sentence at a time; helper warmed on hover | First sound sooner |
