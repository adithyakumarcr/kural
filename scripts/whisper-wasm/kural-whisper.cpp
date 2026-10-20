// Kural's voice input: whisper.cpp as WebAssembly (built by scripts/whisper-wasm/build.sh, run by
// extension/lib/voice/whisper-worker.js). Three calls, all from JavaScript:
//   init(modelBytes: Uint8Array) -> bool       loads the (already trained) model once, from bytes: no file system
//   transcribe(samples: Float32Array, threads) -> string   16 kHz mono, English; the segments' text joined
//   free()
// Modelled on whisper.cpp's bindings/javascript/emscripten.cpp, which prints the text instead of returning it.
#include "whisper.h"

#include <emscripten.h>
#include <emscripten/bind.h>

#include <string>
#include <vector>

static struct whisper_context * g_ctx = nullptr;

static bool init(const emscripten::val & bytes) {
    if (g_ctx) return true;
    std::vector<uint8_t> buf = emscripten::convertJSArrayToNumberVector<uint8_t>(bytes);
    whisper_context_params cparams = whisper_context_default_params();
    g_ctx = whisper_init_from_buffer_with_params(buf.data(), buf.size(), cparams);
    return g_ctx != nullptr;
}

static std::string transcribe(const emscripten::val & audio, int threads) {
    if (!g_ctx) return "";
    std::vector<float> pcm = emscripten::convertJSArrayToNumberVector<float>(audio);
    whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.print_realtime = false;
    p.print_progress = false;
    p.print_timestamps = false;
    p.print_special = false;
    p.translate = false;
    p.language = "en";
    p.no_timestamps = true;
    p.n_threads = threads > 0 ? threads : 1;
    if (whisper_full(g_ctx, p, pcm.data(), (int) pcm.size()) != 0) return "";
    std::string out;
    const int n = whisper_full_n_segments(g_ctx);
    for (int i = 0; i < n; i++) out += whisper_full_get_segment_text(g_ctx, i);
    return out;
}

static void release() {
    if (g_ctx) { whisper_free(g_ctx); g_ctx = nullptr; }
}

EMSCRIPTEN_BINDINGS(kural_whisper) {
    emscripten::function("init", &init);
    emscripten::function("transcribe", &transcribe);
    emscripten::function("free", &release);
}
