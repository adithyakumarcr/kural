# Chat

The chat sits on the right (**Ctrl+L**, **Cmd+L** on a Mac). Ask in plain words; Kural reads your project, changes
files, runs commands and answers. With code selected, Ctrl+L adds it to your message.

## Modes: how much Kural may do

| Mode | What Kural may do |
|---|---|
| **Agent** | edits files and asks before running commands |
| **Auto** | edits files and runs commands without asking |
| **Plan** | writes a plan and changes nothing; **Build it** carries the plan out (**Ctrl+P** switches Plan on/off) |
| **Ask** | only answers |

Every file change shows under the answer: open the before/after, **keep** it or **undo** it.

**Outside your project, Kural asks first.** In every mode the AI reads (and in Agent mode changes) files in your
project without asking. A file anywhere else gets a card first: **Read this file?** or **Change this file?** (Allow /
Skip). Files you attached are fine. That keeps the AI out of your other folders, and on a Mac it means macOS never asks
"Kural would like to access your Documents folder" (or Music, Photos…) unless you said yes to such a file. In Auto mode
nothing asks.

You can change the mode while an answer is running. Agent → Auto: the commands waiting for your OK run at once, and
later ones don't ask. Auto → Agent: Kural asks before the next command. Switching to Plan or Ask (or back) applies from
your next message, because which tools the model has is fixed when it starts.

## The model menu (bottom of the chat)

- **Model.** Claude's **Opus**, **Sonnet** or **Haiku**, **Google Gemini** and **ChatGPT (Codex)** models (see
  [[Google Gemini and ChatGPT]]), or a model **on this computer** (see [[Your Own Model]]). You can switch in the middle of a
  conversation; the new model gets the conversation so far.
- **Intensity.** Low, Medium, High, Max: how much the model thinks before answering (**Ctrl+M / H / O** in the chat for
  Medium / High / Max). Google Gemini's models come in thinking levels; the menu lists each model once and the
  intensity picks its level (the nearest one the model has; a line under the buttons says which it has).
- **Mood.**
  - **Default**: balanced.
  - **Explorer**: looks around and compares options before settling.
  - **Critic**: questions the request and the code, finds flaws.
  - **Learn**: teaches you. It first asks which of the ideas behind your question you already know, explains only the
    ones you don't, then answers the question, and ends with a short question to check you got it.
- **Multiple agents** (Claude models): a team instead of one assistant. See [[Multiple Agents]].

## Adding things to your message

- **@** mentions a file in your sentence.
- **+ → Add files**: files, images, PDFs. You can also paste a screenshot, or hold **Shift** and drag files from Kural's
  own file explorer into the chat. (Dropping files from outside Kural doesn't work: VS Code doesn't pass them on.)
- **+ → Link ticket** (Claude): link a Jira epic, story or task; Kural then knows which ticket you're working on in every
  message, and reads its details from Jira when needed. Needs the Atlassian connector in Claude (claude.ai → Settings →
  Connectors).
- **+ → Pick from a browser**: opens the [[Browser]] to select an element of your app and add it here.
- **+ → Link device**: a Raspberry Pi or another computer over SSH; the AI can then run commands and change files on
  it (see [[Devices]]).
- The file you're looking at is added by itself ("current file"); click its × to leave it out.

## In the answer

- **Thinking.** One steady line above the answer: "Thinking…" with the model's latest thought, then "Thought for 12 s".
  Click it to read all of it.
- **Questions with options.** When a choice is yours, Kural asks with options you can click.
- **Code blocks** have **Copy**, **Insert** (at your cursor) and **Apply** (Kural applies it to the file and you review
  it, like [[Inline Edit]]).
- **Pictures.** Pictures in an answer are shown: a picture file from your project, one the model read, or one an image
  model made. Ask "show me @chart.png" and the chat shows it. Pictures you attach or mention with @ show in your
  message. A picture from the internet shows **Load image** first: loading it would tell that website you read this
  answer.
- **Click a picture** to see it full size in its own tab.
- **Links** to files (`[install.sh](install.sh)`, `[app.js:12](src/app.js#L12)`) and `file.py:12` style references
  open the file at that line; a folder shows in the Explorer. Web links open in Kural's own [[Browser]] tab (so you can
  pick elements of the page).
- **Scrolling.** While an answer streams, the chat follows it. Scroll up to read and it stays where you are;
  **Latest** brings you back down.
- **Stop** (the square button) stops the answer.

## Tabs, history, two chats

- **Tabs**: **+** or **Ctrl+Alt+N** for a new chat; **Ctrl+PageDown / PageUp** to switch; **Ctrl+W** to close.
- **History** (clock button): every chat from every workspace, in full. Search, **pin** chats to the top, delete
  them. A chat from another workspace opens to read; **Open its folder**, or **Continue here** (a new chat here that knows
  the old conversation).
- **Two chats at once**: drag a chat tab out of the Kural panel into the editor area. It opens there, split the way VS
  Code splits editors: drop it on a side of an editor to put it beside, above or below, or in the middle to add it as a
  tab. It shows only that chat (its editor tab is its tab), and the side panel stops listing it until you close the
  editor. Both chats can work at the same time; move it anywhere, even to another screen. It comes back after a restart.
  (Command Palette: **Kural: Open a Chat Beside the Code** does the same with a new chat.)

## Your Claude Code setup

With a Claude model, the chat uses your whole Claude Code setup: MCP servers, connectors, plugins, skills, hooks and
`CLAUDE.md` files. When you add one, Kural reloads Claude in the same conversation. (Setting
`kural.chat.fullClaudeCodeSetup`: off = a faster, minimal setup.) The full Claude Code terminal is one shortcut away:
**Ctrl+Esc**.

## Asking about Kural

Ask the chat "how do I …?" or "can Kural …?": it knows Kural's features. If Kural can't do something, it says so and
gives you the link to ask for it as a feature.
