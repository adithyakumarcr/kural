# Kural Model Router

Select **Auto → Balance, Cost or Intelligence** in the chat's model menu (Cursor's names for the same three trade-offs). Auto picks the model **and the intensity** for every message. The footer shows the active model, and each answer records the models that handled it and why. Selecting a model manually turns Auto off for that chat.

Open **Model Router** from the status bar, the chat model menu, Kural Settings, or the command **Kural: Model Router**. The panel shows what Auto prefers, how it reads the task (**Native** or **MiniLM**, with a **Download** button when MiniLM's model is missing), the models Auto may pick (click one to turn it on or off; a model past half its usage limit shows how much is used), and the last choice with its reasons. Turning every model off prevents Auto dispatch. Everything else on this page is a setting (`kural.modelRouter.*`).

| Profile | What Auto does | Intensity |
|---|---|---|
| **Balance** (default) | Meets the task's difficulty, then prefers speed; steers away from an AI close to its limit | Low / Medium / High by task size |
| **Cost** | The lightest model that can do the task, on the AI with the most room left. Kural's plans are flat-rate, so what Cost saves is your **usage limits** | One step lower |
| **Intelligence** | The most capable model, even when it's slower or uses more of your limits | One step higher (Max for complex work) |

Older settings and chats saying Balanced, Speed or Quality keep working (they mean Balance, Cost and Intelligence).

Capability checks come first: unavailable models, disallowed models, unsupported images/PDFs, teams, devices and connectors are excluded. Agent requests retain command-approval support. Unknown models start with conservative medium ratings; adjust these with `kural.modelRouter.modelPreferences`. Successful single-model task durations break ties only when all candidates have observations.

## How Auto decides

**What the task is.** The words of your message, and what came with it, like Cursor's "attached context": 4 or more attached files or selections (or more than 40,000 characters) make it one size bigger, 8 or more (or 120,000 characters) two; pasted error output (a stack trace, "TypeError: …", a failed exit code) makes it a review and never "simple"; an element picked in the browser makes it an edit. File names don't count as words ("rename architecture.md" isn't architecture work). The open file always comes along, so it doesn't count.

**Your usage limits.** Kural knows how much of each plan you've used (the AI Usage panel). From half of a limit on, Auto leans away from that model, gently under Intelligence, strongly under Cost. At 98 % it skips the model while another can do the task (the only suitable model is still used). Claude's per-model weekly limits count only for that model (Opus's for Opus).

**The cost of switching.** Another model starts without the prompt cache, and another AI needs the whole conversation handed over, so switching costs more the longer the chat is. Auto stays on the current model unless the task clearly suits another one better, and says "stayed on the current model" when that decided it. It never stays below the task's floor: a complex request still leaves a small model.

**What you did before.** Auto learns from what you do after its answers, per workspace (like Tab Completion learns): you **carry on** with your next message (it was fine), you **pick another model** right after (that one suits such requests better: it leans similar requests its way, and a stronger model you chose raises the floor), or you **undo every change** of the answer (that model didn't manage it). Similar requests share enough words; older lessons fade over months. **Kural: Forget What Model Router Learned (This Workspace)** clears it.

## Choose local assistance

Native policy works immediately. MiniLM is optional and runs through Kural's existing Ollama connection **on this computer**. It does not require routing API keys. Cloud answering models are controlled separately by **Allow cloud answering models**.

| Assistance | How it works | Trade-off |
|---|---|---|
| Native only — default | Rules classify the prompt and apply your ratings/profile | Almost no overhead; limited semantic understanding |
| MiniLM | `all-minilm:22m` compares your request with example requests (6 per label) and ranks snippets using embeddings | Small download (46 MB); similarities are not success probabilities |

Choose **MiniLM** in the panel and click **Download** (or `ollama pull all-minilm:22m`). Selecting MiniLM never downloads it by itself.

MiniLM keeps each half it's sure of (the kind of task, or its size) and Native fills in the other. Explicit words win: when your message says "fix", "rename" or "architecture", that label stays; MiniLM replaces only Native's guesses ("other" when no word matched, "explain" from just "what/how/why", "standard" by default). In the benchmark, the explicit words were right each time the two disagreed, and MiniLM was right on the guesses. Only the task's size changes which model and intensity Auto picks; the kind of task shows in the reason.

Native and MiniLM are the only router choices. Qwen classification, generative ranking and reuse of the Tab Completion model have been removed. Older router settings selecting Qwen or Tab reuse default to Native without starting any helper inference. Tab Completion continues to use its own code models. Qwen 0.5B remains excluded from model choices and downloads; existing Tab settings pointing to it use the recommended 1.5B model instead.

Local assistance accepts loopback Ollama addresses only, rejects redirects and cloud-backed Ollama models, validates outputs, observes Stop, and has one helper operation in flight at a time. The default deadline is 1,500 ms. Missing models, busy helpers, ambiguous MiniLM matches, invalid output and timeouts use native policy. Failed helpers have a 30-second cooldown. MiniLM stays resident for five minutes; inference may compete with local chat/Tab generation.

## Search, context and Tab

Enable each integration in Settings (`kural.modelRouter.search`, `.context`, `.tab`):

- **Search & Ask ranking:** locally retrieve up to 16 candidate snippets, rank them, and show verified file/line locations. Weak or empty matches fall back to the existing AI search. Results are candidates to inspect; they do not constitute a generated explanation. Retrieval is bounded, honors ignore and exclude settings, uses unsaved editor text, and excludes `.env*`, PEM files, dependencies and paths outside the workspace.
- **Retrieve useful chat context:** add up to five ranked optional snippets within a character budget. Explicit attachments, selected context and project instructions remain intact. Native ranking uses lexical relevance; MiniLM uses similarity. Ranking scores are heuristics, not calibrated probabilities.
- **Auto Tab engine selection:** apply native profile and allowlist rules synchronously when Tab's engine is Auto. Speed/Balanced prefer a ready local engine; Quality prefers available Claude unless token efficiency is requested. No classifier or embedding inference runs on the keystroke path. The configured FIM model appears as “Tab only” in the allowlist and is never selected to answer a chat.

Local assistance and automatic chat retrieval are disabled in Restricted Mode. Native selection still observes capabilities and model restrictions.

## Model changes and conversation transfer

Claude can acknowledge a native model change; Kural's local engine can change models before its next inference. Auto reassesses at completed tool boundaries after a tool failure, once per answer, with no pending tools, permissions or live agents. Permission denials and cancellations do not trigger escalation. These changes preserve the provider's existing conversation and completed tool results.

Cross-provider changes happen **between messages**. Kural sends the recorded user instructions, sent context, assistant text, tool calls/results and change records; image/PDF bytes are reattached. Completed operations are marked to avoid blind replay. Missing attachments or a conversation larger than the configured handoff budget (or the estimated local context budget) stop automatic dispatch with an explanation. The unsent draft remains available.

Hidden reasoning and provider caches cannot transfer across providers. Recorded conversation transfer remains subject to the receiving model's context window. Mid-answer cross-provider migration for Codex/Gemini is not implemented; their adapters do not expose a safe pause point.

## Speed evidence and reproduction

**Example requests, 6 October 2026** ([report](../benchmarks/model-router-2026-10-06-examples.json); Apple M5, 16 GB, Ollama, 5,000 ms deadline, same 24-prompt corpus as below). MiniLM got example requests per label, keeps the half it's sure of, and yields to explicit words; Native stopped reading file names as task words.

| | Native before | Native after | MiniLM before | MiniLM after |
|---|---|---|---|---|
| Requests MiniLM decided (not ambiguous) | – | – | 3 / 24 | 20 / 24 |
| Correct kind of task | 17 / 24 | 17 / 24 | 18 / 24 | 20 / 24 |
| Correct size (what changes the model) | 20 / 24 | 21 / 24 | 20 / 24 | 20 / 24 |
| Both correct | 15 / 24 | 16 / 24 | 16 / 24 | 17 / 24 |
| Routing median | 0.002 ms | 0.004 ms | 7.1 ms | 7.2 ms |

A small gain, on a small corpus whose disagreements were used to choose the merge rule: a smoke check, not an accuracy evaluation. The example sentences were written separately, not taken from the corpus. A small language model as the helper (Qwen3 0.6B, below) was not brought back: it was 20 times slower and labelled worse.


The [verification report after removing Qwen](../benchmarks/model-router-2026-10-06-native-minilm.json) contains only Native and MiniLM. The reports below preserve the comparison that led to keeping only Native and MiniLM. Qwen measurements are historical; Qwen is no longer a router option, and the current benchmark runs only Native and MiniLM.

MiniLM (`all-minilm:22m`, 45,960,996 bytes, F16) and Qwen (`qwen3:0.6b`, 522,653,767 bytes, Q4_K_M) were downloaded and tested on 6 October 2026: Linux x64, Intel Core Ultra 7 255H, approximately 30.8 GiB RAM, Node v20.20.2 and Ollama 0.35.0. See the precise environment and per-prompt evidence in the [normal 1,500 ms report](../benchmarks/model-router-2026-10-06-1500ms.json) and [diagnostic 5,000 ms report](../benchmarks/model-router-2026-10-06-5000ms.json).

These numbers measure **routing/ranking overhead**, not complete answer time. The native microbenchmark uses three synthetic answering-model descriptors and excludes editor UI, provider discovery and provider startup. Classification uses 24 hand-labelled synthetic prompts. Ranking uses eight queries against eight preloaded synthetic snippets; ripgrep retrieval and verification are not included. This small smoke corpus does not establish general model accuracy.

| Assistance | Warm routing median / p95 (5 s deadline) | Ranking median / p95 (5 s deadline) | First measured routing request |
|---|---|---|---|
| Native | 0.011 / 0.014 ms | 0.023 / 0.631 ms | 0.093 ms |
| MiniLM | 13.349 / 18.527 ms | 104.584 / 140.351 ms | 583.298 ms, ambiguous; native fallback |
| Qwen3-0.6B — removed | 296.791 / 322.822 ms | 1,942.558 / 3,796.500 ms | 1,800.765 ms |

Routing medians include native fallbacks after attempted classification. MiniLM accepted only 3 of 24 classifications; 21 were ambiguous and retained native labels. Its accepted classification median was 16.015 ms (three samples). Qwen assisted all 24. Cached accepted decisions took 0.276 ms for MiniLM and 0.190 ms for Qwen. Ambiguous classifications are reattempted rather than cached.

| Smoke check | Native | MiniLM with native fallbacks | Qwen — historical |
|---|---|---|---|
| Correct intent labels | 17 / 24 | 18 / 24 | 12 / 24 |
| Correct difficulty labels | 20 / 24 | 20 / 24 | 22 / 24 |
| Both labels correct | 15 / 24 | 16 / 24 | 10 / 24 |
| Expected snippet ranked first, before relevance cutoff | 6 / 8 | 8 / 8 | 2 / 8 |
| Expected snippet first after chat-context cutoff | 0 / 8 | 6 / 8 | 2 / 8 |
| Expected snippet first after Search & Ask cutoff | 0 / 8 | 5 / 8 | 2 / 8 |

Native's strict relevance cutoff rejected these conversational queries; Search & Ask would proceed to its existing AI search. MiniLM is useful for semantic snippet ranking in this corpus, but offers little improvement to task classification. Qwen improved effective difficulty labels while getting more intents wrong and ordering snippets poorly. Native rules retain a complex-task floor and prevent known nontrivial edits/reviews from being downgraded to simple tasks, even when helpers disagree. These measurements support keeping Native as the default and choosing MiniLM when semantic search/context is useful. Qwen was removed from the router after this comparison.

At the normal **1,500 ms deadline**, MiniLM warm routing was 13.061 ms median and ranking 116.431 ms median. Qwen's first request timed out at 1,506.617 ms; its warm routing median was 304.189 ms after the benchmark reset the initial failure cooldown. Ranking then timed out at 1,502.128 ms on its first query, and the seven remaining queries used native cooldown fallbacks. The near-zero median for those fallbacks is not Qwen inference speed. Normal editor behaviour retains the 30-second cooldown after an error. Raising the deadline allows more helper work but also permits longer waits.

The 5-second run made routing with MiniLM about 22 times faster than Qwen and ranking about 19 times faster **on this machine**. Router assistance does not make an answering model intrinsically faster. Semantic search can avoid a generation round trip when candidates pass the cutoff, but full-task speedups and token savings have not been measured. Tab engine selection remains synchronous native policy with no helper inference on keystrokes; these are not Tab generation benchmarks.

Run the offline benchmark:

```sh
node test/router.bench.js
```

Measure installed helpers using only synthetic data, without reading workspace code, downloading anything, restarting Ollama or unloading models:

```sh
node test/router.bench.js --live --samples=24
node test/router.bench.js --live --samples=24 --timeout-ms=5000
```

The first request may already use a resident model; this is not a controlled cold-start measurement. Each warm sample forces inference by clearing its label cache. Cached repeat decisions are measured separately. An initial failure cooldown is reset once before warmup only in the benchmark; subsequent failures retain runtime behaviour. The script reports helper coverage, fallback reasons, classifications, ranking cutoffs and installed weight details. In-editor routing median/p95, accepted helper results, successful local input tokens and fallback counts are displayed in Model Router for the current window.

The router policy and protocol tests use stand-ins. Chat tests exercise actual dispatch, cancellation and checkpoint methods without launching provider CLIs. Retrieval tests use temporary files and real ripgrep. The reset-installer test now intercepts process-control commands: its previous use of real `pkill -x kural` caused the editor to close during tests. It no longer reaches the live editor.

Implementation references: [Ollama embeddings API](https://docs.ollama.com/api/embed), [MiniLM model](https://ollama.com/library/all-minilm), [Apache-2.0 MiniLM weights](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2).
