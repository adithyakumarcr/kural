# Chat

The chat sits on the right: **Ctrl+L** (**Cmd+L** on a Mac) shows it, and pressing it again hides it. Ask in plain
words; Kural reads your project, changes files, runs commands and answers. With code selected in the editor, Ctrl+L adds
it to your message instead (also while the chat is open).

## Modes: how much Kural may do

| Mode | What Kural may do |
|---|---|
| **Agent** | edits files and asks before running commands |
| **Auto** | edits files and runs commands without asking |
| **Plan** | writes a plan and changes nothing; **Build it** carries the plan out (**Ctrl+P** switches Plan on/off) |
| **Ask** | only answers |
| **Debug** | like Agent, for bugs: adds temporary logging, asks you to reproduce, reads the logs, fixes the cause and removes the logging (see [[Debug Mode]]) |

Every file change shows under the answer: open the before/after, **keep** it or **undo** it. Only your project's files
are listed: a note the AI writes in the temp folder, or Claude Code's own plans and memory (`~/.claude`), aren't.

**The web, in every mode.** Claude, Google Gemini and ChatGPT (Codex) can search the web and read web pages in all four
modes, Plan and Ask too (a plan often needs current docs or versions). Claude and Gemini ask first (Allow, or Allow all
web searches and pages for the rest of the chat), except in Auto: a search changes nothing on your computer, but a web address the AI opens can
carry your project's data away (for example after it read a page with hidden instructions). Codex uses live search (not
its cached copy of the web) without asking; the commands it runs still have no internet. A model on this computer has no
web tools.

**Outside your project, Kural asks first.** In every mode the AI reads (and in Agent mode changes) files in your
project without asking. A file anywhere else gets a card first: **Read this file?** or **Change this file?** (Allow /
Skip). Files you attached are fine. That keeps the AI out of your other folders, and on a Mac it means macOS never asks
"Kural would like to access your Documents folder" (or Music, Photos…) unless you said yes to such a file. In Auto mode
nothing asks, with one exception:

**Your private folders always ask first (Mac).** A command, read or search that goes into your Desktop, Documents,
Downloads, Music, Pictures, Movies or iCloud Drive, or through your whole home folder (`ls ~/*/`, `find ~`), gets a card
in every mode, Auto too, with no "Allow all" ("It looks in your Downloads folder…"): each of those makes macOS ask you
about Kural. A file you attached, and a project you opened inside one of them, don't ask. The AI is also told to ask
you where your project is instead of looking around. ChatGPT (Codex) runs simple read-only commands like `ls` without
asking Kural, so for it only those instructions apply.

**Files that run code later ask too, even in your project** (Agent mode): git hooks, `.vscode/tasks.json`, `package.json`,
`.env`, a Makefile, a Dockerfile, GitHub workflows, shell profiles, `CLAUDE.md`, `.mcp.json`, `.npmrc`, Python/Gradle/
Maven/Cargo build files and editor settings (in any upper/lower case). A page or README the AI reads could try to trick it
into planting one, so writing one gets a card ("This file can make your computer run something later."). The temp folder
isn't writable without asking either.

You can change the mode while an answer is running. Agent → Auto: the commands waiting for your OK run at once (not a
look into your private folders), and later ones don't ask. Auto is unrestricted: nothing asks, also not the dangerous commands below, and the AI ends each
answer with a **What I did** list of the commands it ran and the files it changed, so you can see what happened. In Agent
mode (and after "Allow all") dangerous commands still ask: `sudo`, deleting outside the project
or the whole project, `curl … | sh`, a forced push to main, `git reset --hard`, `git clean -f`, writing into `/etc`,
`/usr` or `~/.ssh`, formatting a disk, shutting down. It's a best-effort check of the command's text, not a sandbox.
Gemini (Antigravity) gets this check through Kural's approval gate (a hook in Antigravity's own settings). "Allow all" covers only the kind of card you gave it on: commands, web searches and pages,
Kural's browser, or one connector's tools. A file outside the project is never covered: it's yes or no each time. It lasts only for the
mode, model and conversation you gave it in: a new mode, another model (also one Auto picks) or a handoff ends it.
In Ask and Plan, connectors can only look things up (and ask first); a connector tool that changes something (a pull
request, a Notion page, a Jira issue) is refused there, also after "Allow all". ChatGPT (Codex) starts Ask and Plan
without your connectors, every mode but Auto without its ChatGPT apps, and every mode (Auto too) without its own browser
and computer use, because Codex doesn't ask Kural before those. The AI uses Kural's browser instead, where it never
publishes anything, in any mode ([[Browser]]); Gemini's own browser asks before every action, in Auto too. Auto → Agent: Kural asks before the next command. Switching to Plan or Ask (or back) applies from
your next message, because which tools the model has is fixed when it starts.

## The model menu (bottom of the chat)

- **Model.** **Auto** (the [[Model Router]] picks a model for each message), Claude's **Opus**, **Sonnet** or **Haiku**,
  **Google Gemini** and **ChatGPT (Codex)** models (see [[Google Gemini and ChatGPT]]), or a model **on this computer**
  (see [[Your Own Model]]). Only the AIs you've set up are listed; set one up in Get started or Kural Settings. A model
  on this computer is listed once you've downloaded one that can chat. You can switch in the middle of a
  conversation, also to another AI: the new model gets the conversation so far. Long chats get an overview that fits
  the next model and a complete local record it can read for earlier details. Switching an AI's account carries that
  record over too.
- **The gear.** Each section heading in the menu (Auto · Model Router, Claude, Google Gemini, ChatGPT (Codex), On this
  computer) has a gear button. Auto's opens the Model Router panel; the others open that AI's page in Kural Settings
  (where its connectors are, its switch points near a limit, its login). There is no "Configure Model Router…" item any more: use
  the gear.
- **Intensity.** Low, Medium, High, Max: how much the model thinks before answering (**Ctrl+M / H / O** in the chat for
  Medium / High / Max). Google Gemini's models come in thinking levels; the menu lists each model once and the
  intensity picks its level (the nearest one the model has; a line under the buttons says which it has).
- **Preference** (called mood before).
  - **Default**: balanced.
  - **Explorer**: looks around and compares options before settling.
  - **Critic**: questions the request and the code, finds flaws.
  - **Learn**: teaches you. It first asks which of the ideas behind your question you already know, explains only the
    ones you don't, then answers the question, and ends with a short question to check you got it.
    **Lesson pages**: in Learn, ask it to *explain it on a webpage* (or "show me as slides") and the AI builds a short
    slide deck: one idea per slide, diagrams and small animations, very few words. It opens in Kural's browser beside
    the chat, and the Explorer and the terminal close so the screen is just the chat and the lesson. Move with the
    arrow keys, Space, the dots or the buttons; some slides build up step by step. The AI teaches it in the chat, slide
    by slide. Select text on the page, or click a highlighted visual, and press **Add to chat**: it goes into your
    message (nothing is sent until you send), so you can ask about exactly that part. When the AI changes a slide the
    page reloads by itself. Lesson pages need Agent or Auto mode (the AI writes the page; in Plan and Ask it explains in
    the chat). They're kept privately in Kural's storage (not in your project), served only to this computer, can't load
    anything from the internet, and are deleted with the chat.
  - **Your own**: **Add your own…** (at the end of the row) opens **Kural Settings → Preferences**. One has a
    name, a one-line hint (shown when you point at it) and instructions for the AI. What works best: who the AI should
    be and how it works with you ("Work like a pair programmer sitting next to me"), concrete behaviors (what to do
    first, what to always or never do), the tone and length you want, when to ask you and when to decide, all in a few
    sentences. Start from an example (Pair programmer, Strict reviewer, Explain like I'm new) and change it. Edit or
    delete them there too; a chat whose preference you deleted gets the first one in the menu. They're saved in your
    settings (`kural.chat.moods`), so **Export settings** takes them along.
  - **Remove the built-in ones you don't use**, Default too: **Kural Settings → Preferences**, the **×** on one.
    **Restore** brings it back. The menu always keeps at least one, and a new chat starts with the first one left (setting
    `kural.chat.hiddenMoods`).
  - Changing the preference (or the mode) in the middle of a chat applies from your next message: Kural tells the AI what
    changed along with it.
- **Parallel agents** (Claude, ChatGPT and Gemini models): **Split big tasks** splits a request between agents that work
  at the same time on a model you pick, each in its own copy of the project; Kural merges their work. See [[Parallel Agents]].

## Adding things to your message

- **@** mentions a file in your sentence.
- **Enhance prompt** (the wand beside Send): turns a rough request into a clear prompt before you send it. See
  [Enhance prompt](#enhance-prompt) below.
- **Voice** (the mic beside the wand, **Ctrl+Alt+V**): talk instead of typing. See [Voice input](#voice-input) below.
- **Listen** (the speaker under a finished answer): Kural explains the answer out loud. See [Listen](#listen) below.
- **/** at the start of your message lists your skills and commands (Claude models): your plugins' skills, such as
  Superpowers' `/superpowers:brainstorming`, your own skills and commands, and Claude Code's like `/code-review`. Type
  to filter (by name or what it does), **Tab** or **Enter** puts it in, then write what it's for and send. It needs
  **Use my Claude Code setup** on (Kural Settings → Claude). Claude Code's commands that only work on its own screen
  (`/model`, `/config`, `/mcp`…) aren't listed: Kural has its own way for those (the model menu, Kural Settings).
- **Your shortcuts** (every AI): a name that stands for a text you write once, like `/pr-summary` or `/test`.
  - Make them in **Kural Settings → Shortcuts**: a name (lowercase letters, digits and `-`) and what it stands for (up
    to 4,000 characters). With none yet, the "/" list ends with **Make a shortcut…**.
  - Type **/** at the start of your message or after a space anywhere ("hi! please do /pr-summary"), pick it, and it
    goes in as a chip. Point at the chip to see its text.
  - The AI gets your message as you wrote it, plus what each shortcut stands for. History and the tab's title show
    `/pr-summary`. Typed by hand as a whole word, a shortcut counts too.
  - Yours come first in the list and win over a Claude skill with the same name. In the middle of a message the list
    shows only your shortcuts (Claude runs a skill only at the start).
  - They're kept in your user settings (`kural.chat.shortcuts`) for every project; a project's settings can't add one.
- **Text from the chat**: select part of an answer (or of a message you sent) and click **Add to chat** beside it. It goes
  into your message as a quote (its first words; point at it to read it all), and the AI gets the whole selected text
  (up to 8,000 characters) with your message.
- **+ → Add files**: files, images, PDFs. You can also paste a screenshot, or hold **Shift** and drag files from Kural's
  own file explorer into the chat. (Dropping files from outside Kural doesn't work: VS Code doesn't pass them on.)
- **+** has only **Add files** and **Link device** now. *Link ticket* and *Pick from a browser* were taken out: a Jira
  ticket linked before keeps its chip (× unlinks it), and the [[Browser]]'s own inspect button adds an element of your
  app to the chat.
- **+ → Link device**: a Raspberry Pi or another computer over SSH; the AI can then run commands and change files on
  it (see [[Devices]]).
- The composer shows only context you choose. Attach a file with **@** or **+ → Add files**; opening it does not attach it.

## Voice input

Click the **mic** beside the wand (or press **Ctrl+Alt+V**, on a Mac **Cmd+Alt+V**), say what you want, and click it
again. The line above the box shows a red dot, the time and how loud it hears you; **Esc** cancels and nothing is kept.
It stops by itself after 5 minutes.

1. **Whisper** writes down what you said, on this computer and offline. The first time, Kural asks to download it
   ("Voice input needs Whisper, a speech model that runs on this computer (about 60 MB, once). Nothing you say leaves
   it."): **Download** or **Not now**. It understands English.
2. The **quickest model** you have (Claude Haiku, or Gemini's lightest, or your own model) tidies it up: it removes
   "um", "ahm", repeated words and false starts, and fixes grammar and punctuation. It keeps your words, the order and
   every code, file and command name, and adds nothing. Without an AI set up, or if it takes over 15 seconds, the plain
   transcript is used and the line says why.
3. The text goes into the box **at the cursor**. Nothing is sent by itself: check it and press Send. **Undo** puts back
   exactly what Whisper heard.

## Listen

Point at a finished answer and click the **speaker** (beside Fork from here). Kural talks you through the answer like a
friend explaining it, with some enthusiasm: a short walkthrough of the main points, about a minute or two for a 300–500 word answer, while the
part it's explaining is **highlighted** in the answer and kept on screen. Code is explained ("this checks whether the
token runs out within a minute"), never read out symbol by symbol.

- **It starts at once.** A short opener plays right away ("Alright, let me walk you through this."), and the walkthrough
  follows while the rest is still being made, as one voice: short sentences of the same part are spoken together, and
  the silence the voice leaves around each clip is trimmed, so there's only a short natural pause between sentences.
- **The player** sits just above the chat box, so it stays in view while you scroll: **Pause/Play**, **Rewind 5 s** (also
  back into the sentence before), the **speed** and **✕**, with three lines of what's being said (the sentence before,
  the one now, the next). There's no slider. The speaker button again also stops it. If you scroll the chat yourself,
  it stops scrolling for you (the highlight still moves) until you press Play or Rewind.
- **Speed**: 0.5x, 0.75x, 1x, 1.25x, 1.5x or 2x. The voice itself speaks faster or slower, so it never sounds like a
  chipmunk; a change takes effect from the sentence being spoken. The speed you pick becomes your default.
- **The voice is made on this computer**, offline (Supertonic 3). The first click asks to download it: about 430 MB,
  once (the voice and Microsoft's ONNX Runtime). Every file is checked against the size and SHA-256 Kural expects.
- **The words** come from the chat's quickest model (Claude Haiku, or Gemini's lightest), which reads the answer. A chat
  on your own model uses that model, so nothing leaves the computer. ChatGPT (Codex) can't be used for this: with only
  ChatGPT set up, the speaker is greyed out and says why.
- **Listening again is instant**: the walkthrough's text is kept with the answer (and goes with it into a fork); the
  audio isn't saved, it's made again on this computer.
- One answer plays at a time. The sound plays only in the place you clicked (with the chat open twice, in one of them);
  showing another chat there, closing it, or editing an earlier message stops it.
- English only for now. Available on Linux x64, Apple Silicon Macs and Windows x64.

| | |
|---|---|
| Where it runs | Whisper (base.en) in a helper process of Kural, on your CPU. On a 16-core laptop: about 2.5 s for a short prompt, 4.5 s for half a minute of speech. |
| What leaves the computer | Nothing you say. Only the written text goes to the quick model for the tidy-up, like any message. |
| The download | whisper.cpp built for Kural (from this repository's release `whisper-wasm-1.9.5`) and the model from Hugging Face, each checked against a fixed SHA-256. Kept in Kural's data; **Remove Kural's Data** deletes it. |
| On a Mac | macOS asks once for the microphone, at the first recording. If you said no: System Settings > Privacy & Security > Microphone, allow Kural. |

## Enhance prompt

Write what you want, roughly ("the seam stuff is slow, make it faster"), and press the **wand** beside Send. A quicker
model looks through the open project and rewrites your request into a prompt the chat's model can work with:

- the goal, and where it fits: **Constraints**, **Expected output**, **Success criteria** (only what you asked for or
  the project's own conventions; nothing made up),
- **Relevant context**: pointers to the files, folders and functions that matter, each with a reason
  (`` `src/api/client.ts` (`request()`): every call goes through it ``). Kural checks that every pointed-to file exists
  and removes any that don't,
- **Open questions**: what's unclear, instead of a guess.

An already clear request barely changes: you get the same words plus the pointers. It keeps your language.

While it works, the line above the box says what it's doing, in plain words: "Sonnet 5.5: Searching the code for
planSeam", "Sonnet 5.5: Reading src/weld/seam.ts". **Stop** ends it. When it's done, the new prompt replaces your text
(files you mentioned with @ stay) and **Undo** puts back what you had. Nothing is sent by itself: check it, change it,
then press Send.

| The chat's AI | Who enhances |
|---|---|
| Claude | Claude Sonnet 5.5 |
| ChatGPT (Codex) | Codex's middle "workhorse" model (for example GPT-6.1-Sol) |
| Google Gemini | Gemini's Flash model, at a high thinking level |
| A model on this computer | the first of the above that's set up |

**What it may do:** read only. It lists folders, searches text and reads files inside the open project, and nothing
else: no commands, no changes, no web. Files that may hold secrets are never read, searched or listed (`.env`, keys and
certificates, `credentials*`, `*secret*`, `.npmrc`, `.git`, `.ssh`…; `.env.example` is fine). Links that point outside
the project are refused. What it reads is treated as data, so a comment in a file telling it to do something is
ignored; if the new prompt points to such a file, Kural adds a warning to that pointer (and the line above the box says
so), so the model that does the work is told too. Each click has a budget: at most 20 looks at the project and 150 seconds (Claude also stops at its own turn and
cost limits). It needs an open project, and Claude, ChatGPT (Codex) or Google Gemini set up.

**What it costs:** one extra run of a mid-size model per click, about 5-15 seconds and a few looks at the project. It
counts toward that AI's usage limit like any chat message.

## Side chat

Select text in an answer and press **Ask**. A small box opens right under that answer with your selection quoted. Type a
question and press Enter: a fast model answers in the box (Haiku, or the lightest Gemini model, or your own
model if that is all you have). Ask more in the same box and it remembers the side conversation.

- It is separate from the chat: the chat's AI never sees it, it is not a turn, and you can ask while the main answer is
  still running.
- Esc or the cross closes the box. With questions in it, it folds into one line, "Side chat · 2 questions", that opens
  again. It is saved with the answer.
- It only answers: no tools, no changes to your files. Stop ends an answer that is running.
- **Add to chat** under a side answer puts that question and answer into your message as a quote.

## In the answer

- **Calm reading.** Answers have real headings, roomy text, and color only where it means something. An answer that
  starts with its point (`**Done:** …`, `**Goal:** …`, `**In short:** …`) shows it in a box on top. Callouts use
  GitHub's alerts, so a saved plan looks the same on GitHub: `> [!NOTE]` blue **Note**, `> [!TIP]` green **Tip**,
  `> [!IMPORTANT]` purple **Important**, `> [!WARNING]` amber **Watch out**, `> [!CAUTION]` red **Risk**. Also quotes,
  nested lists, checkboxes, ~~struck-out~~ text, and numbered steps whose file is a chip that opens it. Tables line up
  number columns on the right and color status words: passed green, failed red, No grey ("Breaking change: No" isn't
  bad news). Kural asks every AI to write this way; an answer that doesn't still reads fine.
- **Diagrams.** A ` ```mermaid ` block in an answer (a flowchart, sequence, class, state or ER diagram, a pie chart, a
  Gantt chart…) is drawn as the diagram as soon as the block is complete. **Code** shows its text (and **Diagram** the
  picture again), **Copy** copies the code, and a click on the diagram opens it full size in its own tab. When Mermaid
  can't draw one, the block shows why, with its code. Diagrams are drawn on your computer by
  [Mermaid](https://mermaid.js.org), which comes with Kural; nothing is sent anywhere. A diagram is only a picture: links
  written in it don't open.

### Thinking: one timeline

Everything the AI did on the way is one timeline above the answer: its thoughts in readable text, between the steps
it took (Read, Searched, Edited +18 −3, Ran npm test · passed). Click a step to see all of it.

- The header says "Working… 12 s" while it works, then "Worked for 34 s · 2 thoughts, 3 reads, 1 command", and what the
  thinking is: **Claude's summary**, **ChatGPT's summary** or **raw**. Anthropic and OpenAI only send a summary of their
  models' thinking, never the raw thinking. Kural shows it as it comes and summarizes nothing itself. Models on your
  computer (Qwen3, DeepSeek-R1, gpt-oss) and open models through Codex send their raw thinking, word by word. Gemini
  (Antigravity) passes no thinking on.
- While it works it grows as tall as the chat, then scrolls inside, following the newest line. Scroll up in it to
  read and it stays there; **Latest** brings you back to the newest line.
- When it's done it folds to its header ("Worked for 34 s · …") and the answer comes up under it. Click the header to
  open it again; if you opened or folded it yourself, that stays. Earlier answers' timelines are folded too.
- What needs you (a permission card, a question), agents' cards and pictures stay outside it.

### Answering a question: pick, then Send

When the AI asks you something (a question card, or options at the end of its answer: a question, then a numbered
list, `- [ ]` lines when several may be picked, or a yes/no question), the options are buttons.

- A click picks an option; a second click un-picks it. Pick several where the question allows it.
- Your picks stay on the question, and the line above the box shows "Your answer … (press Send)". Nothing is sent until
  you press **Send** (or Enter). What you type in the box goes with your answer as a note.
- A card has no Submit button: the chat's Send answers it. **Skip** stays, and **Other…** takes your own words.
- After you answer, a question card becomes one line in the timeline, in its place: "You answered · Which database?
  Postgres" (or "Skipped the question"), so the AI's next steps follow it. Options at the end of an answer keep your
  picks (the others fade), so you can see later what you chose.
- Only the last answer of a chat that isn't working can be answered; older ones show what was picked.
- **Ask about this question.** Not sure what to pick? Type your question in the box under the options and press
  **Ask**. The AI that asked answers right there, then asks again, changed if your question changed something
  ("Updated after your question"). **The question before you asked** opens the old one.
- **Code blocks** have **Copy**, **Insert** (at your cursor) and **Apply** (Kural applies it to the file and you review
  it, like [[Inline Edit]]).
- **Pictures.** Pictures in an answer are shown: a picture file from your project, one the model read, or one an image
  model made. Ask "show me @chart.png" and the chat shows it. Pictures you attach or mention with @ show in your
  message. A picture from the internet shows **Load image** first: loading it would tell that website you read this
  answer.
- **Click a picture** to see it full size in its own tab.
- **Links** to files (`[install.sh](install.sh)`, `[app.js:12](src/app.js#L12)`) and `file.py:12` style references
  open the file at that line; a folder shows in the Explorer. When the answer gives only a file's name
  (`devices.test.js`) or a path from inside another folder, Kural finds that file in your project (not in
  `node_modules`); if several files have that name, it asks which one. Web links open in Kural's own [[Browser]] tab
  (so you can pick elements of the page).
- **Scrolling.** While an answer streams, the chat follows it. Scroll up to read and it stays where you are;
  **Latest** brings you back down.
- **Stop** (the square button, or Esc) stops the answer.
- **In the Explorer**, as it works: a file the AI reads turns **blue** for a moment, a file it changes turns **yellow**
  until its answer ends (a dot beside the name; hover says "Kural is reading this" / "Kural is changing this"). Every
  chat's work shows. What a command touches isn't shown (Kural can't tell). The colors are theme colors
  (`kural.explorer.reading`, `kural.explorer.changing` in `workbench.colorCustomizations`); the setting
  `kural.explorer.showAIActivity` turns it off.

## Notifications

When an answer is done, or it needs you (a command or a file to allow, a question, a plan to build, an error, a
login), Kural shows a system notification, like any app: "Fix the login is done" with the answer's first sentence, or
"Fix the login needs your OK: Run this command? npm test". Click it to go to that chat. By default it only does this
while you're not looking: Kural's window isn't in front, or that chat isn't on screen. Parallel agents' answer notifies
once, when all of them are done (and when the plan waits for your OK); Stop doesn't notify (that was you). Each chat has one notification at a time, and it
goes away when you answer in Kural or open the chat.

Setting `kural.notifications`: **whenAway** (the default), **always**, or **off**.

On a Mac, Kural sends the notification with the system's own notification command, so it shows as **Script Editor**:
macOS silently dropped the app's own notifications. If none shows, go to System Settings → Notifications, allow
**Script Editor** and **Kural**, and turn off Focus and Do Not Disturb. **Kural: Test Notification** (Command Palette)
sends one now and says how it was sent. Kural's log (**Kural: Show Log**) says why each notification was or wasn't
sent. On Ubuntu, Kural uses `notify-send` (package `libnotify-bin`).

## Your Mac stays awake while a chat works

While any chat is working (an answer, parallel agents), the Mac doesn't go to sleep by itself, so a long job isn't
paused halfway. The screen can still turn off, and closing the lid still sleeps it. When every chat is done, the Mac
sleeps as usual again. Setting `kural.chat.keepAwake` (on by default) turns this off. macOS only for now.

## Sending while it works (a queue)

Pressing **Enter** while an answer is running doesn't stop it. Your message goes into a queue, shown above the input
box ("Queued: Kural adds it at its next step"), and the AI takes it in as soon as it can:

- **Into the same answer.** After the command, edit or search it's doing, the AI reads your message and carries on with
  it. The answer shows it where it arrived: **You added this while it worked**, then what it did after that. Claude,
  ChatGPT (Codex) and models on your computer do this.
- **As your next message.** If the answer ends before there was a step to add it at (a short answer with no commands),
  your message is answered right after, as a new message. Google Gemini always does this.

While it works and you've typed something, the button next to **Stop** sends it (Enter does the same). **Stop** (or
Esc) stops the answer, and any queued message it hasn't read yet goes back into the input box, so nothing is lost.

## Going back: edit a message, restore the code

Hover a message you sent for two buttons:

- **Edit** puts it back in the input box (with its @ mentions); change it and send. It replaces that message and
  everything after it, and the AI continues from the conversation before it (it doesn't remember the replaced part).
  If answers after it changed files, Kural asks whether the code goes back too (**Restore Code** / **Keep Code**).
  **Cancel** (or Esc) leaves editing.
- **Restore code** puts back every file the AI changed after that message, as it was before it (like Cursor's
  checkpoints). The conversation stays; those changes show as Undone. Kural asks first, and says if you edited one of
  those files yourself since (your edits go too). What commands changed (installs, generated files) isn't undone.

Kural keeps a checkpoint of each file before the AI changes it, on your computer, for 30 days: restoring works after
a restart and after you pressed **Keep**.

## Context and tokens

Next to the send button, a small ring shows how full the conversation's context window is (for example 5 % of
Sonnet's 1,000,000 tokens). **Click it to open AI Usage.** Hover it for **tokens in context / context capacity** and
**tokens consumed** in this chat (read plus written). Near full, the AI starts summarising or forgetting the oldest
parts: a new chat starts empty. Every AI's tokens per day are in the AI Usage panel ([[Account and Updates]]).

## Tabs, history, two chats

- **The tab line** has all the chat's buttons (the panel's title bar has none of its own): **+** (new chat), **Split**,
  the clock (**History**), the gear (**Kural Settings**) and **…** (Get started, Check for updates, What's new).
- **Tabs**: **+** or **Ctrl+Alt+N** for a new chat; **Ctrl+PageDown / PageUp** to switch; **Ctrl+W** to close. A chat
  you haven't used for 10 minutes and that isn't on screen lets its AI program go (to save memory; at most two idle ones
  stay ready); it starts again in the same conversation when you open it or send to it, in a second or two.
- **Fork from here**: hover a message and click the branch icon after the answer finishes (or stop it first).
  A new chat contains the recorded conversation through that message: messages, attached context, and tool results.
  Earlier images and PDFs are sent again with your next message if their files are still available. It keeps your
  model, intensity, mode, mood and linked context. The original chat's conversation stays intact. If answers after
  that message changed files, Kural first asks whether the code goes back too: **Restore Code** puts those files back
  as they were at that message (in the original chat those changes then show as Undone), **Keep Code** leaves your
  files as they are now; closing the question doesn't fork. File-change cards inherited from the original can be
  reviewed, but **Keep**, **Undo** and **Restore code** in the fork act only on its own changes. Both chats are saved
  in History. Forking a chat in its own editor opens another editor beside it; in a column of the panel, among the tabs.
- **History** (clock button): every chat from every workspace, in full. Search, **pin** chats to the top, delete
  them. A chat from another workspace opens to read; **Open its folder**, or **Continue here** (a new chat here that knows
  the old conversation).
- **A chat beside the code**: drag a chat tab out of the Kural panel and let go in the editor area. It opens there, in
  an editor group beside the one you're in (VS Code's own drop zones don't light up for it: a web page inside VS Code,
  like the chat, can't hand a drag to the editor; move its editor tab afterwards to put it above or below). It shows
  only that chat (its editor tab is its tab), and the side panel stops listing it until you close the editor. Both
  chats can work at the same time; move it anywhere, even to another screen. It comes back after a restart.
  (Command Palette: **Kural: Open a Chat Beside the Code** does the same with a new chat.)
- **Chats side by side in the panel** (also when it's full screen: the **Maximize** button on the panel's title bar):
  drag a tab onto the left or right side of the chat (the side lights up: **Split left** / **Split right**), or press
  the **Split** button beside **+** for a new chat next to it. Up to four, when the panel is wide enough (in a narrow
  panel, Split opens the new chat beside the code instead). Each extra chat has its title and **×** above it: × puts it
  back among the tabs. Drag a title to move that chat: to a side of another one, onto another one (it shows there
  instead), onto the first column (back among the tabs), or out of the panel (beside the code). Drag the line between
  two to give one more room. When the panel gets too narrow for them side by side, they stack above each other. The
  layout comes back after a restart.
- **Back to the panel**: the button in that chat editor's title bar, **Move Chat Back to the Kural Panel** (also on its
  tab's right-click menu): the editor closes and the side panel shows the chat among its tabs. Closing the editor tab
  also puts it back among the side panel's tabs.

## Commit messages in Source Control

In the Source Control panel, the sparkle button in the commit message box (and in the panel's title bar) writes a
short commit message for you (at most 200 characters: a subject line, and a line or two more only when needed): from
your staged changes, or all changes when nothing is staged, in the style of your recent commits, with the chat's model.
Edit it if you like and commit as usual.

## Your Claude Code setup

With a Claude model, the chat uses your whole Claude Code setup: MCP servers, connectors, plugins, skills, hooks and
`CLAUDE.md` files. You manage the connectors in Kural, not in a terminal:

1. **Extensions → Connectors** (the third tab of the Extensions side bar, **Ctrl+Shift+X**; or **Kural: Show Connectors**,
   or **Open Connectors** on Claude's page in Kural Settings). It shows the chat's AI's connectors; **Connectors for**
   at the top picks Claude or ChatGPT.
2. **Add connector.** Search, or pick one from Popular.
3. **Add.** Fill in a token or a folder only if it asks. On a Mac and Linux Kural keeps the token in a private file and the
   connector reads it when it starts, so other programs on your computer never see it. A result from the public MCP directory (not one of the Popular ones) first shows the exact
   command or address it will run, since nobody checked it: add it only if you trust it.
4. **Sign in**, if the connector needs your account. A terminal opens: type `/mcp`, pick the connector, then Authenticate.

Connectors are added for all your projects, and your chats continue. **Add one by hand** at the bottom of the list takes a
command or a web address. **Remove** is the trash icon; connectors from claude.ai are removed on claude.ai, and a
plugin's connector goes with its plugin (Extensions → Plugins).

**On** turns a connector off or on **everywhere in Kural**: untick it and Kural's chats of that AI (in every project)
don't use it; its tools are hidden from the AI. It still connects in the background, and `claude` or `codex` in a
terminal still has it. Chats pick the change up when they're not busy, in the same conversation.

Small options under Claude's connectors (and on Claude's page in Kural Settings): **Use my Claude Code setup
(connectors, plugins, skills)** is the checkbox (setting `kural.chat.fullClaudeCodeSetup`); off = a faster, minimal
setup. **Reload** starts Claude again.

The model menu no longer shows the setup. The full Claude Code terminal is one shortcut away: **Ctrl+Esc**.

## Asking about Kural

Ask the chat "how do I …?" or "can Kural …?": it knows Kural's features. If Kural can't do something, it says so and
gives you the link to ask for it as a feature.
