# Your Own Model

Kural can run a model on your own computer through [Ollama](https://ollama.com): private, free, no account, no
internet. Kural runs it with its own engine (not Claude Code). It reads and edits files, searches your project, asks
before running commands, and you keep or undo each change, like with Claude.

## Set it up

- **Get started** → **Your own model**: Ollama, a model, a test. See [[Getting Started]].
- Or in the chat's model menu: **Find & download models…** searches Ollama's library. It lists only models that can
  chat and use tools (the chat needs tools) and that run on your computer (no cloud-only models), shows how much memory
  each size needs compared to yours, and downloads with a progress bar. You can also use or delete models you have.

Then pick the model under **On this computer** in the model menu. You need Ollama 0.8 or newer.

## Which model?

Bigger is smarter but slower and needs more memory. On a laptop, start with something like `qwen3:8b` (or `qwen3:4b`
with 8 GB of memory). `qwen3-coder:30b` or `gpt-oss:20b` need about 20 GB.

## What uses it

The model you pick in the chat is used for the chat, **Ask**, **Ctrl+K**, **Apply**, commit messages and plain-words
commands in the terminal. [[Tab Completion]] has its own, smaller model (a fill-in-the-middle code model) because it
needs to be fast.

## What needs Claude

- [[Multiple Agents]]
- Claude Code's connectors, MCP servers, plugins and skills
- Linking Jira tickets

## Settings

- `kural.localModels.contextLength` (default 32768): how much text the model can look at once (your conversation, the
  files it read, Kural's instructions). More needs more memory.
- `kural.tabCompletion.ollamaUrl` (default `http://127.0.0.1:11434`): where Ollama runs (also for the chat).
