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

**The web, in every mode.** Claude, Google Gemini and ChatGPT (Codex) can search the web and read web pages in all four
modes, Plan and Ask too (a plan often needs current docs or versions), without asking: it changes nothing on your
computer. Codex uses live search (not its cached copy of the web); the commands it runs still have no internet. A model
on this computer has no web tools.

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

- **How it worked: one dropdown.** Everything the AI did on the way (its thoughts, the files it read, its searches,
  commands, edits, permissions you answered, and the short notes it wrote between them) is one line above the answer:
  "Worked for 34 s · 2 thoughts, 3 reads, 1 command". While it works the line says what it's doing now. Click it to see
  every step. What needs you (a permission card, a question), agents' cards, the team's messages and pictures stay in
  sight, outside it.
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
Sonnet's 1,000,000 tokens). Hover it for the numbers and for this chat's tokens: how many the AI read (and how many of
those came from the cache, which is cheap) and wrote. Near full, the AI starts summarising or forgetting the oldest
parts: a new chat starts empty. Every AI's tokens per day are in the AI Usage panel ([[Account and Updates]]).

## Tabs, history, two chats

- **Tabs**: **+** or **Ctrl+Alt+N** for a new chat; **Ctrl+PageDown / PageUp** to switch; **Ctrl+W** to close.
- **Fork from here**: hover a message and click the branch icon after the answer finishes (or stop it first).
  A new chat contains the recorded conversation through that message: messages, attached context, and tool results.
  Earlier images and PDFs are sent again with your next message if their files are still available. It keeps your
  model, intensity, mode, mood and linked context. The original chat stays intact; current project files stay as they
  are. File-change cards inherited from the original can be reviewed, but **Keep**, **Undo** and **Restore code** in
  the fork act only on its own changes. Both chats are saved in History. Forking a chat in its own editor opens
  another editor beside it.
- **History** (clock button): every chat from every workspace, in full. Search, **pin** chats to the top, delete
  them. A chat from another workspace opens to read; **Open its folder**, or **Continue here** (a new chat here that knows
  the old conversation).
- **Two chats at once**: drag a chat tab out of the Kural panel into the editor area. It opens there, split the way VS
  Code splits editors: drop it on a side of an editor to put it beside, above or below, or in the middle to add it as a
  tab. It shows only that chat (its editor tab is its tab), and the side panel stops listing it until you close the
  editor. Both chats can work at the same time; move it anywhere, even to another screen. It comes back after a restart.
  (Command Palette: **Kural: Open a Chat Beside the Code** does the same with a new chat.)
- **Back to the panel**: the button in that chat editor's title bar, **Move Chat Back to the Kural Panel** (also on its
  tab's right-click menu): the editor closes and the side panel shows the chat among its tabs. Closing the editor tab
  also puts it back among the side panel's tabs.

## Commit messages in Source Control

In the Source Control panel, the sparkle button in the commit message box (and in the panel's title bar) writes a
commit message for you: from your staged changes, or all changes when nothing is staged, in the style of your recent
commits, with the chat's model. Edit it if you like and commit as usual.

## Your Claude Code setup

With a Claude model, the chat uses your whole Claude Code setup: MCP servers, connectors, plugins, skills, hooks and
`CLAUDE.md` files. When you add one, Kural reloads Claude in the same conversation. (Setting
`kural.chat.fullClaudeCodeSetup`: off = a faster, minimal setup.) The full Claude Code terminal is one shortcut away:
**Ctrl+Esc**.

## Asking about Kural

Ask the chat "how do I …?" or "can Kural …?": it knows Kural's features. If Kural can't do something, it says so and
gives you the link to ask for it as a feature.
