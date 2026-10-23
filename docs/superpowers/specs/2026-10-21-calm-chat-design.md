# Calm chat: answers that are easy to read, thinking you can follow, questions you answer by clicking — design

Date: 2026-10-21. Asked for by Adithya. Shaped in a brainstorming session with mockups (the visual companion); the full
chat mockup was approved ("Amazing!").

## Why

Long answers are hard to read today. Every heading is 13 px like the text (`media/chat.css:136`), only two colors are used
(purple and grey; green, red, yellow and blue exist but only for the +/− of changed files), and there are no quotes,
callouts, nested lists or checklists. The AI's thinking is one italic line. When the AI asks you something in its answer
(Superpowers does this a lot), you have to type the answer.

## Decided with Adithya (21 Oct 2026)

| Question | Answer |
|---|---|
| The look | **A · Calm reading**: real headings, the point first in a box, roomy text, color only where it means something. Not cards (B), not folding (C). |
| Hardest to read today | Long explanations and plans. |
| Thinking | **T2 · Timeline**: each thought between the steps it took (read, searched, edited, ran). Grows to about 14 lines, then scrolls inside, following the newest line. |
| Raw or summary | Show exactly what the AI sends, as it arrives. Kural never summarizes thinking (no extra AI call). Claude only sends a summary (Anthropic never gives out raw thinking): shown as is, marked "Claude's summary". Raw where the AI sends raw. |
| Answering a question | **Pick, then Send**: a click picks an option (several where allowed), the picks stay on the question, nothing is sent until you press the chat's Send; you can add a note in the box. |
| Not sure what to pick | **Ask about the question** on the question itself: the AI answers there and asks again, changed if your question changed something. The earlier version stays one click away. |

Not in this version: cards (B), folding long answers (C), charts, raw thinking for Claude (not possible), thinking for
Gemini (Antigravity doesn't pass it on), a setting to hide thinking.

## What you see

**Answers (Calm reading)**
- Headings: `#` 16 px, `##` 14.5 px with a thin line under it, `###` 13.5 px semibold, `####` 13 px semibold muted. Text in
  a softer color than headings, line height 1.68.
- **The point first**: when the answer's first paragraph starts with a bold label and a colon (`**Goal:**`, `**Done:**`,
  `**In short:**`, any 1–4 words), it's drawn as a box with that label on top (purple bar, light purple tint).
- **Callouts** (GitHub's alert syntax, so saved plans look right on GitHub too): `> [!NOTE]` blue "Note", `> [!TIP]` green
  "Tip", `> [!IMPORTANT]` purple "Important", `> [!WARNING]` amber "Watch out", `> [!CAUTION]` red "Risk". A title after
  the marker (`> [!WARNING] Two windows`) replaces the label. A plain `>` quote: grey bar, muted text.
- **Steps with their files**: a numbered list gets round numbers; an item that starts with a file (`` `media/chat.js` `` or
  `**media/chat.js**`, then `:` or ` — `) shows the file as a chip that opens it.
- Lists nest (two levels), `- [ ]` / `- [x]` show as checkboxes, `~~text~~` is struck through.
- **Tables**: a column whose cells are all numbers (`0.4 s`, `1,968`, `12%`, `$4.00`, `+18`) is right-aligned with even
  digits; the separator row's own alignment wins. A cell that is only a status word gets an icon and a color:
  passed / pass / ok / success / done → green check; failed / fail / error / broken → red cross; yes → green check;
  no → grey cross (not red: "Breaking change: No" isn't bad news).
- Code cards, the files-changed card and permission cards keep what they do; only the look follows Calm reading.
- Kural Dark and Kural Light; text at least 4.5:1 against its background, also on the tinted callouts.

**Thinking: the timeline** (replaces today's "Working…" dropdown, `media/chat.js` `stepsNode`)
- One timeline per part of an answer: thoughts (normal 13 px text, not italic; a bold first line stays bold) and steps
  (Read, Searched, Edited +18 −3, Ran npm test · you allowed it · passed), each step clickable for its details.
- The header: "Working… 12 s" while it runs, then "Worked for 41 s · 3 thoughts, 2 reads, 3 edits, 1 command", plus a tag
  saying what the thinking is: "Claude's summary", "ChatGPT's summary" or "raw".
- At about 14 lines (300 px) it scrolls inside and follows the newest line. Scroll up inside it and it stops following;
  a **Latest** button takes you back. It never folds by itself while you watch (that jump is why it's one line today).
  - *Changed 22 Oct 2026 (issue #104, Adithya):* while it runs it may grow as tall as the chat (not 300 px), and when that
    part of the answer is done it folds to its header, so the answer comes up under it. The one jump this makes, at the
    end, is the point. Your own open/fold click still wins.
- When a chat is opened or redrawn, the timelines of earlier answers start folded to their header; click to open.

**Questions: pick, then Send**
- The question card (when the AI asks with AskUserQuestion) and options the AI writes at the end of its answer both
  become clickable rows: a round mark for one choice, a square for several, "Recommended" on the one the AI marked.
- A click picks or un-picks. Above the chat box: "Your answer: Calm reading, Fold-first (press Send)"; the box's hint
  becomes "Add a note (optional), then press Send"; Send lights up. Send answers every open question you picked in, in
  one go, with the note. The card has no Submit button any more (Skip stays).
- After answering, the question keeps your picks visible (the others faded), so you can see later what you chose.
- **Ask about this question**: a box under the options ("Which one matters most?"). The AI answers right there, then the
  question shows again, changed if needed, tagged "Updated after your question"; "The question before you asked"
  opens the old version.

## How it works (decided in this doc: check these)

**1. What the AIs are told** (`lib/chat/prompts.js` `FORMAT`, which every mode of every AI already gets). About 120 more
tokens per request:
- Start a long answer with its point: a paragraph beginning with a bold label (`**Goal:**`, `**Done:**`, `**In short:**`).
- Use `##` headings for the parts of a long answer; keep paragraphs short.
- For something to note, a tip, a warning or a risk use `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!CAUTION]`; only
  when it matters.
- When you ask the user to choose in text, end the answer with the question, then the options, one per line: a numbered
  list when one answer fits, `- [ ]` lines when several may; add "(Recommended)" to the one you'd pick.
- Plan mode's "a one-sentence goal" becomes "start with **Goal:** and one sentence".

**2. The renderer** (new `media/markdown.js`, out of `chat.js`, which has grown to ~2,000 lines). `parse(src)` turns the
text into plain block objects; `render(blocks)` builds the page with `el()` only. Nothing the AI writes becomes HTML (as
today: links, pictures and code keep going through `inline()`'s placeholders). Streaming: a block that isn't finished
yet (an open quote or list at the end of a running answer) is drawn as it is and redrawn on the next frame, like today.
- **Options at the end of an answer** count only when the answer has finished and its last two blocks are: a paragraph
  that ends with `?`, or ends with `:` and has a `?` in it ("Which one first? Pick any:"), then a list of 2–6 items,
  each at most 120 characters. Without a `?` it's an ordinary list (a plan's "Next steps:" stays text). Numbered list = one choice,
  `- [ ]` = several. Item text: the bold part (or the part before ` — ` / `: `) is the label, the rest the description.
  A finished answer whose last line is an English yes/no question ("Want me to…?", "Should I…?", "Shall I…?", "Do you
  want…?") gets "Yes" / "No" buttons. Everything else stays text, as today.

**3. Answering** (new `media/choices.js`, like `side.js`/`listen.js`: a factory the page calls; `lib/chat/index.js`)
- The picks live on the page (per question; a redraw keeps them, as `b._sel` does today) and are saved with the message.
- A question card: Send posts `answer` with `{answers, note}`; the backend appends the note to each answer
  ("Only if I was at the bottom. Note: keep it simple") before `askUser` resolves, exactly as `updatedInput.answers` goes
  today.
- Options in the answer: Send sends a normal message whose text is the question and the picks ("Which ones should I
  design? Calm reading, Fold-first") plus the note; the message keeps `picks` so the page shows them as chips. Handoffs,
  History and Fork see the plain text.
- **Ask about a question card**: the page posts `answer` with `{ask: "…"}`. The backend resolves the AskUserQuestion call
  with an answer that says: the user hasn't chosen yet and asks "…"; answer briefly, then ask the question again with
  AskUserQuestion, changed if your answer changes the options. The old card's state becomes `asked`. When the next
  question card of the same answer arrives, the page draws it in the old card's place: the old one folds into "The
  question before you asked", the AI's short answer sits on the new card, tagged "Updated after your question".
- **Ask about options in an answer**: a normal message: "About your question "…": <what you asked>. Answer it, then ask
  the question again, changed if needed." The next answer's options replace the old ones, which stop being clickable.
- Claude, Codex (its questions already become Kural's card: `lib/ai/codex.js:976`) and models on this computer ask with
  the card; Gemini has none, its questions come as options in the answer (above). So everything works for all four AIs.

**4. The timeline** (`media/chat.js`; `media/listen.js`)
- Same blocks as today's steps group (thinking, tools, answered permissions, text between steps), new markup and CSS.
- Follow and **Latest** inside the timeline work like the chat's own `stick` and "Latest" button.
- The source tag comes from the chat's AI: `claude:` → "Claude's summary", `ollama:` → "raw", `codex:` → "ChatGPT's
  summary", or "raw" when Codex sent raw reasoning for that answer.
- `lib/ai/codex.js`: prefer raw reasoning when Codex sends it (today the summary wins, `codex.js:841`): raw for an item
  drops that item's summary; if the summary came first it stays (never both). Whether Codex needs
  `show_raw_agent_reasoning` to send raw for open models is checked with a real Codex (not installed here).
- Listen's `kindOf` learns the new blocks (summary box, callouts, quotes, nested lists), so walkthroughs still point at the
  right part. Side chat, Add to chat and quoting work on any text in the answer, as now.

## Files

| File | Change |
|---|---|
| `extension/media/markdown.js` (new) | The renderer: parse + render, the recognition rules above |
| `extension/media/choices.js` (new) | Pick, then Send; the line above the box; Ask about this question |
| `extension/media/timeline.js` (new) | The thinking timeline: header, items, scrolling, Latest |
| `extension/media/chat.js` | Uses both; the timeline; the card without Submit; Send answers picks |
| `extension/media/chat.css` | Calm reading, callouts, tables, the timeline, questions |
| `extension/media/listen.js` | `kindOf` for the new blocks |
| `extension/lib/chat/index.js` | Loads the two scripts; `answer` with a note or an ask; `picks` on messages |
| `extension/lib/chat/prompts.js` | The formatting rules |
| `extension/lib/ai/codex.js` | Raw reasoning first |
| `extension/lib/chat/guide.js`, `docs/wiki/Chat.md`, `RELEASE_NOTES.md` | The new chat (under "Not released yet": 1.2.1-beta.1 is tagged) |

## Testing

- `test/markdown-render.test.js`: each rule on the small fake DOM the Listen test uses (summary box, callouts and their
  titles, quotes, nested and task lists, number columns, status words, file chips, options found or not found, a
  running answer's unfinished blocks), plus the old markdown cases and nothing the AI writes turning into HTML.
- `test/choices-page.test.js`: pick, un-pick, several questions at once, the line above the box, Send with and without a
  note, ask about a card and about options, picks kept after a redraw and after answering.
- `test/chat-questions.test.js`: the backend answers AskUserQuestion with the note, and with an ask (fake Claude).
- `test/codex.test.js`: raw reasoning wins, never both. `test/listen-page.test.js`: the new blocks are numbered.
- Contrast: the callout and status colors in both themes (4.5:1).
- In the app: `./install.sh --ext`, a real Claude chat in Agent and Plan mode (a long answer, a question card, options in
  text, Ask about it), the same with a model on this computer (raw thinking), Kural Light.
