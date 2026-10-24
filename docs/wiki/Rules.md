# Rules

Rules are instructions for the AI that live in your project: how your code is written, which commands to use, what
never to touch. Kural gives them to the AI so you don't repeat yourself in every chat. Like Cursor's rules.

## Where they live

One Markdown file per rule in **`.kural/rules/`** in your project. Commit them and your team gets them too. Kural also
reads **`.cursor/rules/`**, so rules written for Cursor work here as they are.

Each file starts with a short header between `---` lines:

```markdown
---
description: How we write React components
globs: src/**/*.tsx
alwaysApply: false
---

- Function components only, with hooks.
- Props get a named type, never `any`.
```

| Header | Meaning |
|---|---|
| `description` | What the rule is for. The AI uses it to decide whether a rule matters. |
| `globs` | File patterns the rule belongs to, like `src/**/*.tsx`. |
| `alwaysApply` | `true`: the rule is in every message. |

## The four kinds

| Kind | How you write it | When the AI gets it |
|---|---|---|
| **Always** | `alwaysApply: true` | In the instructions of every chat in this project |
| **Auto attached** | `globs` | With a message that has a matching file in it (@-mentioned, attached or selected), once per chat |
| **Agent requested** | only a `description` | The AI sees the description and reads the rule when it fits the task |
| **Manual** | a header with none of the three filled in | Only when you **@-mention** the rule in your message |

A `.kural/rules/*.md` file with no header at all counts as **Always**: the simplest rule is just text.

## Make one

**Kural: New Rule** (Command Palette) makes a rule file in `.kural/rules/` and opens it, ready to write.
**Kural: Open Rules Folder** opens the folder in the Explorer.

## Changes

Edit a rule and save: a chat that's already running uses the new text with its **next message**, you don't start a
new chat. Rules work with every AI in Kural (Claude, Google Gemini, ChatGPT and models on your computer).

## Good to know

- Keep rules short and specific. A rule that says what to do and why is followed better than a long list.
- A rule is an instruction, not a lock: what the AI may do is still decided by the chat's mode ([[Chat]]).
- Rules are plain files in your project: Kural sends them only to the AI you picked, with your messages.

See also [[Chat]] and [[Settings and Shortcuts]].
