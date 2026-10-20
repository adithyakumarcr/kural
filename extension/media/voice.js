// Voice input on the chat page (the host half is lib/voice): the mic beside the wand. Click (or Ctrl+Alt+V) and talk;
// click again to stop (Esc cancels; it stops by itself at 5:00). The page records with MediaRecorder, decodes the
// recording and resamples it to 16 kHz mono at the end (OfflineAudioContext), and sends the samples to Kural in chunks of
// one second; Kural transcribes them with Whisper on this computer and tidies the text up. The result goes into the box at
// the cursor, never sent by itself; Undo puts back what Whisper heard. The first time, the bar asks to download Whisper.
// (No AudioWorklet: loading its module would need a looser script-src in the page's CSP.)
// Loaded by chat.js as a plain script (window.KURAL_VOICE = make) and by the test with require().
(function () {
  const RATE = 16000, CHUNK = 16000, LIMIT_MS = 5 * 60 * 1000;
  const ASK = "Voice input needs Whisper, a speech model that runs on this computer (about 60 MB, once). Nothing you say leaves it.";

  function make(d) {
    // d: el, icon, post(msg), tab() → the shown chat, insertText(text) → the inserted Text node, media {getUserMedia,
    //   MediaRecorder, AudioContext, OfflineAudioContext}, now(), every(fn, ms) → id, stopEvery(id), isMac
    const media = d.media;
    // phase: idle | starting | ask | downloading | recording | sending | transcribing | cleaning | done | error
    const S = { phase: "idle", tabId: null, pct: 0, rec: null, message: "", retry: false, done: null };
    const button = d.el("button", { class: "mic-btn", "aria-label": "Record a voice prompt",
      title: "Talk instead of typing (Ctrl+Alt+V)\nClick, talk, click again. Whisper writes it down on this computer and a quick model tidies it up; it goes into the box for you to check and send.",
      onclick: () => toggle() }, d.icon("mic"));
    const bar = d.el("div", { class: "enh-bar voice-bar hidden", role: "status", "aria-live": "polite" });
    const busy = () => ["sending", "transcribing", "cleaning", "downloading", "starting"].includes(S.phase);
    const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    const close = () => { S.phase = "idle"; S.done = null; render(); };

    function toggle() {
      const t = d.tab();
      if (!t || t.visiting || busy()) return;
      if (S.phase === "recording") return stop();
      if (S.phase === "ask") return;
      S.phase = "starting"; S.tabId = t.id; S.done = null;
      d.post({ type: "voiceStart", tabId: t.id });
      render();
    }

    async function begin() {
      S.phase = "recording";
      const rec = S.rec = { blobs: [], started: d.now(), level: 0, cancelled: false };
      render();
      try {
        rec.stream = await media.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        if (S.rec !== rec) { release(rec); return; }
        rec.recorder = new media.MediaRecorder(rec.stream);
        rec.recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.blobs.push(e.data); };
        rec.recorder.start();
        rec.ctx = new media.AudioContext();
        rec.analyser = rec.ctx.createAnalyser();
        rec.analyser.fftSize = 512;
        rec.ctx.createMediaStreamSource(rec.stream).connect(rec.analyser);
        rec.started = d.now();
        rec.timer = d.every(() => tick(rec), 200);
      } catch (e) {
        release(rec); S.rec = null;
        d.post({ type: "voiceCancel", tabId: S.tabId });
        fail(micError(e));
      }
    }

    function micError(e) {
      const name = (e && e.name) || "";
      if (name === "NotAllowedError" || name === "SecurityError")
        return d.isMac ? "Kural can't use the microphone. Allow Kural in System Settings > Privacy & Security > Microphone, then try again."
          : "The microphone was blocked. Allow Kural to use it, then try again.";
      if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found. Connect one and try again.";
      if (name === "NotReadableError") return "The microphone is busy in another program. Close it there and try again.";
      return `Couldn't start the microphone: ${(e && e.message) || e}`;
    }

    function tick(rec) {
      if (S.rec !== rec || S.phase !== "recording") return;
      if (d.now() - rec.started >= LIMIT_MS) return stop();
      if (rec.analyser) {
        const a = new Uint8Array(rec.analyser.fftSize);
        rec.analyser.getByteTimeDomainData(a);
        let sum = 0;
        for (const v of a) sum += ((v - 128) / 128) ** 2;
        rec.level = Math.min(1, Math.sqrt(sum / a.length) * 4);
      }
      render();
    }

    function release(rec) {
      if (rec.timer != null) d.stopEvery(rec.timer);
      rec.timer = null;
      if (rec.stream) for (const t of rec.stream.getTracks()) t.stop();
      rec.stream = null;
    }

    // Stop: the recording → 16 kHz mono samples → Kural, a second at a time, then voiceStop.
    function stop() {
      const rec = S.rec;
      if (!rec || !rec.recorder) return;
      S.phase = "sending"; render();
      rec.recorder.onstop = async () => {
        release(rec);
        if (rec.cancelled) { closeCtx(rec); return; }
        try {
          const blob = rec.blobs.length === 1 ? rec.blobs[0] : new Blob(rec.blobs, { type: rec.blobs[0] && rec.blobs[0].type });
          const decoded = await rec.ctx.decodeAudioData(await blob.arrayBuffer());
          const off = new media.OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
          const src = off.createBufferSource();
          src.buffer = decoded; src.connect(off.destination); src.start();
          const samples = (await off.startRendering()).getChannelData(0);
          if (rec.cancelled) return;
          for (let i = 0, seq = 0; i < samples.length; i += CHUNK, seq++)
            d.post({ type: "voiceChunk", tabId: S.tabId, seq, samples: Array.from(samples.subarray(i, i + CHUNK)) });
          d.post({ type: "voiceStop", tabId: S.tabId });
          if (S.phase === "sending") { S.phase = "transcribing"; render(); }
        } catch (e) {
          d.post({ type: "voiceCancel", tabId: S.tabId });
          fail(`Couldn't read the recording: ${(e && e.message) || e}`);
        } finally { closeCtx(rec); if (S.rec === rec) S.rec = null; }
      };
      rec.recorder.stop();
    }
    function closeCtx(rec) { try { rec.ctx && rec.ctx.close(); } catch { /* closed */ } }

    // Esc: cancel a recording (nothing is kept), or close the bar. True when it did something.
    function escape() {
      if (S.phase === "recording" || S.phase === "sending") { cancel(); return true; }
      if (["ask", "error", "done"].includes(S.phase)) { close(); return true; }
      return false;
    }
    function cancel() {
      const rec = S.rec;
      if (rec) {
        rec.cancelled = true;
        if (rec.recorder && rec.recorder.state !== "inactive") {
          rec.recorder.onstop = () => { release(rec); closeCtx(rec); };   // (the microphone is let go once it has stopped)
          rec.recorder.stop();
        } else { release(rec); closeCtx(rec); }
      }
      S.rec = null;
      d.post({ type: "voiceCancel", tabId: S.tabId });
      close();
    }
    function fail(message, retry = false) { S.phase = "error"; S.message = message; S.retry = retry; render(); }

    function onState(m) {
      const t = d.tab();
      if (m.tabId !== S.tabId && !(t && m.tabId === t.id)) return;
      S.tabId = m.tabId;
      switch (m.phase) {
        case "ask": S.phase = "ask"; break;
        case "downloading": S.phase = "downloading"; S.pct = m.pct || 0; break;
        case "recording": if (S.phase !== "recording") begin(); return;
        case "transcribing": case "cleaning": S.phase = m.phase; break;
        case "done": {
          const node = d.insertText(m.text);
          S.phase = "done";
          S.done = { node, raw: m.raw, text: m.text, cleaned: !!m.cleaned, why: m.why, model: m.model };
          break;
        }
        case "error": S.phase = "error"; S.message = m.message || "It didn't work."; S.retry = !!m.retry; break;
        default: S.phase = "idle";
      }
      render();
    }

    function undo() {
      const D = S.done;
      if (D && D.node && D.node.isConnected !== false) D.node.data = D.raw;
      close();
    }

    // A recording belongs to its chat: switching tabs cancels it.
    function tabChanged() {
      const t = d.tab();
      if ((S.phase === "recording" || S.phase === "sending" || S.phase === "starting") && (!t || t.id !== S.tabId)) cancel();
      else render();
    }
    // You typed in the box: the "From your voice" note goes.
    function typed() { if (S.phase === "done") close(); }

    function render() {
      const t = d.tab();
      const here = !!t && t.id === S.tabId;
      button.classList.toggle("hidden", !!(t && t.visiting));
      button.classList.toggle("recording", here && S.phase === "recording");
      button.disabled = here && busy();
      button.replaceChildren(d.icon(here && S.phase === "recording" ? "mic-filled" : "mic"));
      const show = here && S.phase !== "idle" && S.phase !== "starting";
      bar.classList.toggle("hidden", !show);
      bar.classList.toggle("err", show && S.phase === "error");
      if (!show) { bar.replaceChildren(); return; }
      const spin = () => d.el("i", { class: "codicon codicon-loading codicon-modifier-spin", "aria-hidden": "true" });
      const text = (s) => d.el("span", { class: "enh-text", title: s }, s);
      const x = () => d.el("button", { class: "cb x", "aria-label": "Close", onclick: () => close() }, d.icon("close"));
      switch (S.phase) {
        case "ask":
          bar.replaceChildren(d.icon("mic"), text(ASK),
            d.el("button", { class: "cb", onclick: () => { S.phase = "downloading"; S.pct = 0; d.post({ type: "voiceDownload", tabId: S.tabId }); render(); } }, "Download"),
            d.el("button", { class: "cb", onclick: () => close() }, "Not now"));
          break;
        case "downloading":
          bar.replaceChildren(spin(), text(`Downloading Whisper… ${S.pct} %`),
            d.el("button", { class: "cb", onclick: () => { d.post({ type: "voiceDownloadStop" }); close(); } }, "Stop"));
          break;
        case "recording": {
          const ms = S.rec ? d.now() - S.rec.started : 0;
          const fill = d.el("span", { class: "voice-level-fill" });
          fill.style.width = `${Math.round((S.rec ? S.rec.level : 0) * 100)}%`;   // (the page's CSP forbids style="" attributes)
          const level = d.el("span", { class: "voice-level", "aria-hidden": "true" }, fill);
          bar.replaceChildren(d.el("span", { class: "voice-dot", "aria-hidden": "true" }), text(`Listening… ${mmss(ms)}`), level,
            d.el("button", { class: "cb", onclick: () => stop() }, "Done"),
            d.el("button", { class: "cb x", "aria-label": "Cancel", title: "Cancel (Esc): nothing is kept", onclick: () => cancel() }, d.icon("close")));
          break;
        }
        case "sending": case "transcribing": bar.replaceChildren(spin(), text("Transcribing…")); break;
        case "cleaning": bar.replaceChildren(spin(), text("Cleaning up…")); break;
        case "done": {
          const D = S.done || {};
          if (D.cleaned) bar.replaceChildren(d.icon("mic"), text(`From your voice · tidied up${D.model ? ` by ${D.model}` : ""} · check it, then send`),
            d.el("button", { class: "cb", title: "Put back exactly what Whisper heard", onclick: () => undo() }, "Undo"), x());
          else bar.replaceChildren(d.icon("mic"), text(`From your voice, as heard (not tidied up${D.why ? `: ${D.why}` : ""})`), x());
          break;
        }
        case "error":
          bar.replaceChildren(d.icon("warning"), text(S.message),
            S.retry && d.el("button", { class: "cb", onclick: () => { S.phase = "downloading"; S.pct = 0; d.post({ type: "voiceDownload", tabId: S.tabId }); render(); } }, "Try again"), x());
          break;
      }
    }

    render();
    return { button, bar, toggle, onState, escape, tabChanged, typed, render };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = make; else window.KURAL_VOICE = make;
})();
