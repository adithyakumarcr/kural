// Ctrl+K's question, right under the code it's about (Adithya, 22 Oct 2026: not in the bar at the top of the window).
// The box is VS Code's comment widget: a thread of Kural's own comment controller, placed under the selection's last
// line, with an input and two buttons (Edit / Write, Cancel). Enter sends, Shift+Enter is a new line, Esc cancels
// (package.json keybindings, `commentThread == kural-edit`). Nothing is ever posted as a comment: the thread goes as soon
// as you answer. Where the comment widget can't be used (an editor without it), the old input bar at the top asks.
const vscode = require("vscode");
const { log } = require("../log");

const CONTEXT = "kural-edit";
// The input of a comment box (Kural's question, or any other): an editor of its own, not a file you're in.
const isCommentInput = (ed) => !!ed && ed.document.uri.scheme === "comment";

class InlineAsk {
  constructor(context) {
    this.pending = null;   // { thread, resolve, uri }
    this.ctl = null;
    try {
      this.ctl = vscode.comments.createCommentController("kural.inlineEdit", "Kural");
      context.subscriptions.push(this.ctl);
    } catch (e) { log(`inline edit: no comment widget here (${e.message}); the input bar asks instead`); }
    context.subscriptions.push(
      vscode.commands.registerCommand("kural.inlineEdit.submit", (reply) => this.answer(reply, true)),
      vscode.commands.registerCommand("kural.inlineEdit.cancel", (reply) => this.answer(reply, false)),
      // (Another file in front: the question there goes. Not the box's own input: VS Code reports it as the active
      // editor when it takes the keyboard (a "comment:" document), which closed the box the moment it opened.)
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (!this.pending || isCommentInput(ed)) return;
        if (!ed || ed.document.uri.toString() !== this.pending.uri) this.finish(undefined);
      }),
      { dispose: () => this.finish(undefined) });
  }

  // The instruction you typed, or undefined (cancelled). line: the selection's last line (the box opens under it).
  async ask(editor, line, { generating }) {
    const words = generating
      ? { label: "Kural: write code here", placeHolder: "What should Kural write here? (Enter to send, Shift+Enter for a new line)", prompt: "Write code here…" }
      : { label: "Kural: edit the selection", placeHolder: "How should Kural change the selected code? (Enter to send, Shift+Enter for a new line)", prompt: "Edit the selection…" };
    if (!this.ctl) return this.bar(generating);
    this.finish(undefined);   // (a question still open from before)
    let thread;
    try {
      this.ctl.options = { placeHolder: words.placeHolder, prompt: words.prompt };
      thread = this.ctl.createCommentThread(editor.document.uri, new vscode.Range(line, 0, line, 0), []);
      thread.label = words.label;
      thread.contextValue = CONTEXT;
      thread.canReply = true;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    } catch (e) {
      log(`inline edit: couldn't open the box at the selection (${e.message}); the input bar asks`);
      if (thread) thread.dispose();
      return this.bar(generating);
    }
    const answer = new Promise((resolve) => { this.pending = { thread, resolve, uri: editor.document.uri.toString() }; });
    // Its input gets the keyboard (VS Code's own "+ comment" box does that by itself; one made here needs asking).
    try { await thread.reveal(undefined, { focus: vscode.CommentThreadFocus ? vscode.CommentThreadFocus.Reply : 1 }); }
    catch (e) { log(`inline edit: the box couldn't take the focus (${e.message}): click into it`); }
    return answer;
  }

  // The box's buttons (and Enter / Esc): reply = { thread, text } from VS Code, or nothing (Esc).
  answer(reply, ok) {
    const P = this.pending, stray = reply && reply.thread && (!P || reply.thread !== P.thread);
    if (stray) { try { reply.thread.dispose(); } catch { /* gone */ } return; }   // (a box left from before: closed)
    if (!P) return;
    const text = ok && reply && typeof reply.text === "string" ? reply.text.trim() : "";
    this.finish(ok && text ? text : undefined);
  }

  finish(value) {
    const P = this.pending;
    if (!P) return;
    this.pending = null;
    try { P.thread.dispose(); } catch { /* gone */ }
    P.resolve(value);
  }

  // The input bar at the top of the window (the old way).
  bar(generating) {
    return vscode.window.showInputBox({
      title: generating ? "Kural: generate code here" : "Kural: edit selection",
      prompt: generating ? "What should Kural write here?" : "How should Kural change the selected code?",
      placeHolder: generating ? "e.g. a function that converts mm/s to m/min" : "e.g. add input validation and a docstring",
      ignoreFocusOut: true,
    });
  }
}

module.exports = { InlineAsk, CONTEXT, isCommentInput };
