# Agent Review

Before you commit, let an AI read your changes like a reviewer would: bugs, missing checks, things you forgot. Like
Cursor's Agent Review. It only reads. It changes nothing in your files.

## Run it

Open **Source Control** (the branch icon). In its title bar, the **checklist** button is **Review Changes (Quick)**. The
**...** menu next to it has **Review Changes (Deep)**.

| | Quick | Deep |
|---|---|---|
| **Model** | the fastest one of your AI (Haiku for Claude) | the chat's model |
| **Looks at** | your uncommitted changes | your uncommitted changes, more thoroughly |
| **Speed** | the quickest | slower: it takes its time |

"Uncommitted changes" are your staged and unstaged changes and new files git doesn't track yet, in the project's
repository. Pictures and other binary files, files over 200 KB and links are left out. For a
big change the reviewer gets as many whole files as fit and reads the others itself.

## What you get

Each finding shows as a **comment on its line** in the editor: what's wrong and why. Two buttons on it:

- **Fix in Chat** (wand) adds the finding to your chat message as a pill with "Fix this." after it. You press Send.
- **Dismiss** (x) removes the comment.

**Kural: Clear Review Comments** removes all of them.

## Good to know

- The reviewer is a short-lived agent in **Ask** mode: it can read files but not change them or run commands.
- A review costs usage like a chat message. Quick is cheap; use Deep before something important.
- Findings are an AI's opinion: read them, some will be wrong.

See also [[Fix with Kural]] and [[Chat]].
