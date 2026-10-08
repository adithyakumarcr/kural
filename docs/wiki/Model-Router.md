# Kural Model Router

Select **Auto → Balance, Cost or Intelligence** in the chat's model menu (Cursor's names for the same three trade-offs). For every message Auto picks the model **and the intensity** from the AIs you set up: **Claude, Google Gemini and ChatGPT (Codex)**. Models on this computer (Ollama) are never picked by Auto; pick them yourself in the menu. Each answer shows the model; hover over that line for the reasons. Selecting a model manually turns Auto off for that chat.

Open **Model Router** from its icon in the status bar (two arrows in boxes; the hover says Model Router and which step reads your requests), the chat model menu, Kural Settings, or the command **Kural: Model Router**. The panel shows what reads your requests as a slider from **Faster** to **Quality** with four steps, **Native**, **MiniLM**, **Granite** and **Qwen3** (the panel names the step you're on; **Download** appears when a helper's model is missing; the info button explains each). That's all the panel has. The profile is picked only in the chat's model menu. There's no list of models to choose from: Auto always uses every cloud model of the AIs you set up (the info box says so).

| Profile | What Auto does | Intensity |
|---|---|---|
| **Balance** (default) | A model that fits the task: light for quick questions, balanced for normal work, the most capable for complex work | Low / Medium / High by task size |
| **Cost** | The lightest model that can do it; the most capable only for complex work. Reading and explaining use light models, code changes a balanced one. Saves your **usage limits** (Kural's plans are flat-rate) | One step lower |
| **Intelligence** | One step more capable than the task needs; a quick question still uses a cheaper model than the top one | One step higher (Max for complex work) |

What each profile asks for, by task size (1 light, 2 balanced, 3 most capable):

| | simple | standard | complex |
|---|---|---|---|
| Cost | 1 | 1 (read/explain) or 2 (edit/review) | 3 |
| Balance | 1 | 2 | 3 |
| Intelligence | 2 | 3 | 3 |

Auto then takes the **lightest model that has that level**. Levels come from the model's name and the description its program gives: Claude Haiku, Gemini Flash and Codex's "fast and affordable" models are light; Sonnet and most models balanced; Opus, Gemini Pro and models described as "most capable", "frontier" or "flagship" the most capable. Models described as "legacy" or "older" lose close calls. Adjust a level with `kural.modelRouter.modelPreferences`. When no model of the needed level is set up, Auto uses the most capable one there is and says so.

Older settings and chats saying Balanced, Speed or Quality keep working (they mean Balance, Cost and Intelligence). Capability checks come first: models that aren't set up, and ones that can't take the request's images or PDFs, a team, a device, connectors or (in Agent mode) commands, are left out.

## How Auto decides

**What the task is.** How much work the request is (simple, standard, complex) and what kind (search, explain, edit, review, other), read by Kural's word classifier and, if you choose one, a helper model (below). Then what came with it, like Cursor's "attached context": 4 or more attached files or selections (or more than 40,000 characters) make it one size bigger, 8 or more (or 120,000 characters) two; pasted error output (a stack trace, "TypeError: …", a failed exit code) makes it a review and never "simple"; a long message isn't a quick question. The open file always comes along, so it doesn't count.

**Your usage limits.** Kural knows how much of each plan you've used (the AI Usage panel). From half of a limit on, Auto leans away from that model, gently under Intelligence, strongly under Cost. **From 80 %** (a Session or Weekly limit) it moves to another AI you set up, in every profile and even in a long conversation, more firmly as the limit gets closer; leaving Claude it takes ChatGPT (Codex) first, then Google Gemini (which can't ask before a command); the level the task needs still holds. At 98 % it skips the model while another can do the task (the only suitable model is still used). Claude's per-model weekly limits count only for that model (Opus's for Opus). The reason says so ("left Claude: 91% of its limit used").

**When an answer hits a limit.** If an answer stops because its AI reached a usage limit ("usage limit reached", "you've hit your session limit", too many requests…), Auto doesn't just fail: the same request goes on right away with another AI, which gets the conversation and what the stopped answer had already done (its steps are marked as done, so they aren't repeated). The stopped answer stays, with a note ("Claude reached its usage limit here. Auto carried on with ChatGPT (Codex) below."), and Auto avoids that AI until its limit resets. A model you picked yourself keeps its error (pick another one, or Auto).

**The cost of switching.** Another model starts without the prompt cache, and another AI needs the whole conversation handed over, so the current model and AI win close calls, more so the longer the chat (up to 80 % of a limit). They never win against what the task needs, or against a lighter model that's enough: a complex request still leaves a light model, and a quick question still leaves Opus.

**What you did before.** Auto learns from what you do after its answers, per workspace (like Tab Completion learns): you **carry on** with your next message (it was fine), you **pick another model** right after (that one suits such requests better: it leans similar requests its way, and a stronger model you chose raises the level needed), or you **undo every change** of the answer (that model didn't manage it). Similar requests share enough words; older lessons fade over months. **Kural: Forget What Model Router Learned (This Workspace)** clears it.

## What reads your requests

| Choice | What it is | Sizes read right | Time per request | Download |
|---|---|---|---|---|
| **Native** (default) | Kural's own word classifier: a linear model on the words and word pairs, trained on 270 labelled requests (`lib/router/examples.json`) | 74 % | 0.01 ms | none |
| **MiniLM** | `all-minilm:22m` through Ollama, blended with Native | 82 % | 8 ms | 46 MB |
| **Granite** | IBM's `granite-embedding:30m`, blended with Native | 87 % | 8 ms | 63 MB |
| **Qwen3** | `qwen3-embedding:0.6b`, blended with Native | 90 % | 49 ms | 640 MB |

Measured with 10-fold cross-validation on the 270 labelled requests (every request read with only the other 90 % as examples), on an Apple M5, routing as the chat calls it (`ModelRouter.route`). The keyword rules Native used before read only 53 % right. A helper compares the request with the labelled examples: each size's examples are averaged into one point, and the request's closeness to each becomes a probability, blended half and half with Native's. The averages are computed once per helper (one batch of embeddings: 1.5 s for Granite, 12 s for Qwen3, in the background) and saved, so routing is one embedding. Until a helper is ready, Native decides.

Move the slider to a helper's step and click **Download** (or `ollama pull granite-embedding:30m`). Selecting one never downloads it by itself. Helpers accept loopback Ollama addresses only, reject redirects and cloud-backed Ollama models, observe Stop, and run one at a time; a failed helper has a 30-second cooldown, and Native decides meanwhile.

**Why embeddings and not a small language model (like Cursor's or Arch-Router).** Cursor's router is a classifier trained on 600,000 real requests; that data isn't public. Research shows simple nearest-neighbour routers over embeddings match trained routers ([Rethinking Predictive LLM Routing](https://arxiv.org/html/2505.12601)), and that's what the helpers do. A language model reading the request was measured too: `qwen3:4b` got 41 of 45 right but took 351 ms; `qwen3:1.7b` (the size of [Arch-Router-1.5B](https://huggingface.co/katanemo/Arch-Router-1.5B), whose licence is research-only) got 34 of 45 in 241 ms. Both are over the 200 ms budget and the smaller one is less accurate than the embedding helpers. Full numbers: [the 7 October report](../benchmarks/model-router-2026-10-07-classifiers.json).

## Search, context and Tab

Enable each integration in Settings (`kural.modelRouter.search`, `.context`, `.tab`):

- **Search & Ask ranking:** locally retrieve up to 16 candidate snippets, rank them, and show verified file/line locations. Weak or empty matches fall back to the existing AI search. Results are candidates to inspect; they do not constitute a generated explanation. Retrieval is bounded, honors ignore and exclude settings, uses unsaved editor text, and excludes `.env*`, PEM files, dependencies and paths outside the workspace.
- **Retrieve useful chat context:** add up to five ranked optional snippets within a character budget. Explicit attachments, selected context and project instructions remain intact. Native ranking uses lexical relevance; MiniLM uses similarity. Ranking scores are heuristics, not calibrated probabilities.
- **Auto Tab engine selection:** when Tab's engine is Auto, the profile setting (`kural.modelRouter.profile`) picks one engine synchronously: Cost and Balance prefer a ready local engine; Intelligence prefers available Claude unless token efficiency is requested. No classifier or embedding inference runs on the keystroke path. Tab's own local model is never selected to answer a chat.

Local assistance and automatic chat retrieval are disabled in Restricted Mode. Native selection still observes capabilities and model restrictions.

## Model changes and conversation transfer

Claude can acknowledge a native model change; Kural's local engine can change models before its next inference. Auto reassesses at completed tool boundaries after a tool failure, once per answer, with no pending tools, permissions or live agents. Permission denials and cancellations do not trigger escalation. These changes preserve the provider's existing conversation and completed tool results.

Cross-provider changes (Claude ↔ Gemini ↔ Codex ↔ your own model) happen **between messages**, by Auto or when you pick a model of another AI yourself. The new AI gets a record of the conversation: your instructions, the context you sent, the answers' text, messages you added while it worked, tool calls and their results, the files changed and how, errors, the plan it's working from and its to-do list; pictures and PDFs are attached again. Completed operations are marked so they aren't repeated blindly. Checked with a real Claude taking over a conversation another model started: it knew the earlier facts, the file the other model had created, and the rule you had given; and in every direction with stand-ins for each program (`test/handoff-fakes.test.js`).

**Long conversations are compacted, not cut.** The record has to fit the next model: the handoff budget (`kural.modelRouter.handoffChars`, 120,000 characters), or for a model on this computer what fits about half its context (`kural.localModels.contextLength`). A longer record is compacted step by step: the newest turns stay word for word; older ones keep their beginning and end (long texts, file contents, tool results are shortened in the middle), then only the steps' names and targets; at the very end the oldest turns become a list of what you asked. Every request you made, every file changed and every attachment stays in it, and the plan and to-do list are kept whole. (It's done by rules, not by a model: instant, offline, and it never invents anything.) Since a shortened record loses details, Auto only hands over a conversation that needs compacting (or whose earlier picture is gone) when the chat's AI is at 80 % of a limit or more; otherwise it picks again **within the current AI**, whose own conversation keeps everything (the reason says "stayed with this AI").

**Switching accounts.** Log out of an AI, log in again, or switch its account (Kural Settings, or outside Kural): its chats go on with what they knew. Claude Code keeps conversations on this computer, so a Claude chat simply continues (if its conversation can't be reopened, a new one starts that's given the record). ChatGPT (Codex) and Google Gemini chats start a new conversation that gets the record with your next message.

Hidden reasoning and provider caches cannot transfer across providers. Mid-answer cross-provider migration for Codex/Gemini is not implemented; their adapters do not expose a safe pause point (an answer that stops on a usage limit goes on elsewhere, see above).

## Measuring it yourself

```sh
node test/router-eval.js                    # every installed helper: cross-validated accuracy and embedding time
node test/router-eval-blend.js granite-embedding:30m qwen3-embedding:0.6b   # blended with the word classifier
node test/router-latency.js                 # choosing a model end to end, Native and each installed helper
node scripts/train-router.js                # after changing examples.json: retrains the word classifier
```

Nothing is downloaded by these scripts: helpers that aren't installed are skipped. `test/router-words.test.js` fails when `words-model.json` is out of date with the examples. The labelled requests are written for Kural (not taken from a benchmark), and the same folds chose the blend settings, so the blended numbers are slightly optimistic; they measure reading a request's size, not answer quality.

Earlier reports (6 October: MiniLM matched 8 example sentences and accepted only 3 of 24 requests; a generative Qwen3 0.6B helper was tried and removed) are kept in `docs/benchmarks/` for history.
