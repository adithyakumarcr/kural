// Kural's rule for the AI in the browser (Adithya): it never publishes. It never posts, shares, sends or publishes
// anything (a reel, a post, a comment, a message, an email), in any mode, not even when you ask it to. It may go as far as
// a draft: "Save draft" is fine, "Share" is yours to press. No vscode here: page.js asks this file about every click,
// key and dialog before it happens, and control.js uses NETWORK as a second stop on sites where Kural knows the request
// that publishes. test/browser-guard.test.js is the table of what counts.
//
// What a click on an element is (classifyClick):
//   "publish"  never done: Share, Publish, Send, Tweet, Go live, Boost; and Post / Comment / Reply / Schedule when the
//              button belongs to something being written (a caption, a comment box, a composer: `composer`). A plain
//              "Post" in a menu (Instagram's Create → Post) only opens the composer, so it's allowed.
//   "draft"    allowed: Save draft, Save as draft, Finish later (in the languages below), even next to Share.
//   "commit"   asks you first in Agent mode (Auto doesn't ask): Submit, Pay, Buy, Delete, Discard, Sign out, Subscribe…
//   "normal"   anything else: Next, Back, Crop, a menu item, a checkbox…
// Labels are compared in lowercase without punctuation; a phrase must start the label as whole words (or be all of it), so
// "Posts", "Shared with you" and "Postal code" don't count, and "Share now", "Share reel", "Post comment" do. Several
// languages, since a site's buttons are in your language.

const DRAFT = [
  "draft", "save draft", "save as draft", "finish later", "save for later", "keep as draft",
  "entwurf", "als entwurf speichern", "entwurf speichern", "später fertigstellen",
  "brouillon", "enregistrer le brouillon", "enregistrer comme brouillon", "terminer plus tard",
  "borrador", "guardar borrador", "guardar como borrador", "terminar más tarde",
  "rascunho", "salvar rascunho", "guardar rascunho", "salvar como rascunho", "concluir mais tarde",
  "bozza", "salva bozza", "salva come bozza", "termina più tardi",
  "concept", "concept opslaan", "opslaan als concept", "later afmaken",
  "szkic", "zapisz szkic", "zapisz wersję roboczą", "wersja robocza",
  "taslak", "taslağı kaydet", "taslak olarak kaydet",
  "utkast", "spara utkast", "kladde", "gem kladde",
  "черновик", "сохранить черновик", "сохранить как черновик",
  "下書き", "下書きを保存", "草稿", "保存草稿", "儲存草稿", "임시 저장", "임시저장", "초안",
  "मसौदा", "ड्राफ़्ट", "ड्राफ्ट", "வரைவு", "வரைவாகச் சேமி", "draf", "simpan draf", "مسودة", "حفظ كمسودة",
];
// Verbs that publish wherever they are.
const PUBLISH = [
  "share", "share now", "publish", "publish now", "send", "send now", "tweet", "retweet", "repost", "reshare",
  "go live", "start live", "start live video", "boost", "boost post", "boost reel", "promote", "add to story", "add to your story",
  "share to story",
  "teilen", "jetzt teilen", "veröffentlichen", "jetzt veröffentlichen", "senden", "absenden", "abschicken", "live gehen",
  "partager", "publier", "envoyer", "passer en direct", "booster",
  "compartir", "compartir ahora", "publicar", "enviar", "transmitir en vivo", "promocionar",
  "partilhar", "publicar agora", "promover",
  "condividi", "condividere", "pubblica", "pubblicare", "invia", "inviare", "promuovi",
  "delen", "publiceren", "verzenden", "versturen", "verstuur", "verzend",
  "udostępnij", "opublikuj", "wyślij",
  "paylaş", "yayınla", "gönder",
  "dela", "publicera", "skicka", "del", "publicer",
  "поделиться", "опубликовать", "отправить",
  "シェア", "共有", "公開", "送信", "投稿する", "シェアする",
  "分享", "发布", "發佈", "发表", "發表", "发送", "發送",
  "공유", "공유하기", "게시하기", "보내기", "전송",
  "शेयर", "शेयर करें", "प्रकाशित करें", "भेजें", "पोस्ट करें",
  "பகிர்", "பகிரவும்", "வெளியிடு", "அனுப்பு", "அனுப்பவும்", "இடுகையிடு",
  "bagikan", "terbitkan", "kirim",
  "مشاركة", "نشر", "إرسال", "ارسال",
];
// Words that publish only when the button belongs to something being written (see composer).
const PUBLISH_IN_COMPOSER = [
  "post", "post now", "post comment", "post reply", "comment", "reply", "respond", "schedule", "schedule post",
  "posten", "kommentieren", "antworten", "planen",
  "commenter", "répondre", "programmer", "poster",
  "comentar", "responder", "programar",
  "commenta", "rispondi", "programma",
  "plaatsen", "reageren", "beantwoorden", "inplannen",
  "skomentuj", "odpowiedz", "zaplanuj",
  "yorum yap", "yanıtla", "planla",
  "posta", "kommentera", "svara", "schemalägg",
  "комментировать", "ответить", "запланировать",
  "投稿", "コメント", "返信", "予約投稿", "发帖", "評論", "评论", "回复", "回覆", "定时发布",
  "게시", "답글", "댓글", "댓글 달기", "예약",
  "पोस्ट", "टिप्पणी", "जवाब दें",
  "இடுகை", "கருத்து", "பதில்",
  "posting", "komentari", "balas", "jadwalkan",
  "تعليق", "رد", "جدولة",
];
// Asks first in Agent mode: hard to undo, or it sends a form somewhere.
const COMMIT = [
  "submit", "submit form", "submit answers", "submit quiz", "confirm", "pay", "pay now", "buy", "buy now", "purchase", "order", "place order",
  "checkout", "check out", "donate", "subscribe", "unsubscribe", "delete", "delete account", "remove", "discard", "sign out", "log out",
  "logout", "deactivate", "transfer", "book", "book now", "reserve", "accept", "accept all", "agree", "i agree", "sign up", "register", "enroll",
  "cancel subscription",
  "einreichen", "bestätigen", "bezahlen", "kaufen", "jetzt kaufen", "bestellen", "zahlungspflichtig bestellen", "löschen", "entfernen",
  "verwerfen", "abmelden", "abonnieren", "registrieren", "zustimmen", "akzeptieren", "alle akzeptieren",
  "soumettre", "valider", "confirmer", "payer", "acheter", "commander", "supprimer", "abandonner", "se déconnecter", "s'abonner", "accepter",
  "confirmar", "pagar", "comprar", "eliminar", "borrar", "descartar", "cerrar sesión", "suscribirse", "aceptar",
  "conferma", "paga", "acquista", "elimina", "scarta", "esci", "accetta",
  "indienen", "bevestigen", "betalen", "kopen", "verwijderen", "afmelden", "accepteren",
  "prześlij", "potwierdź", "zapłać", "kup", "usuń", "odrzuć", "wyloguj",
  "подтвердить", "оплатить", "купить", "удалить", "выйти",
  "提出", "購入", "削除", "破棄", "ログアウト", "提交", "确认", "购买", "删除", "放弃", "退出登录", "제출", "구매", "삭제", "로그아웃",
  "जमा करें", "सबमिट करें", "पुष्टि करें", "भुगतान करें", "खरीदें", "हटाएं",
  "சமர்ப்பி", "உறுதிப்படுத்து", "செலுத்து", "வாங்கு", "நீக்கு",
  "konfirmasi", "bayar", "beli", "hapus", "keluar",
  "تأكيد", "دفع", "شراء", "حذف",
];
// Text boxes whose Enter sends what's in them (comment, reply, message, chat; "Aa" is Messenger's), and search boxes
// (Enter only searches). Whole words.
const MESSAGE_WORDS = ["comment", "comments", "kommentar", "kommentieren", "commentaire", "comentario", "comentário", "commento", "reactie",
  "komentarz", "yorum", "комментарий", "reply", "antwort", "antworten", "réponse", "respuesta", "resposta", "risposta", "antwoord",
  "odpowiedź", "yanıt", "svar", "ответ", "message", "messages", "nachricht", "mensaje", "mensagem", "messaggio", "bericht", "wiadomość",
  "mesaj", "meddelande", "сообщение", "chat", "tweet", "post", "caption", "bildunterschrift", "beschriftung", "légende", "leyenda",
  "didascalia", "bijschrift", "podpis", "altyazı", "bildtext", "подпись", "aa", "コメント", "メッセージ", "评论", "消息", "댓글", "메시지",
  "टिप्पणी", "संदेश", "கருத்து", "செய்தி", "komentar", "pesan", "تعليق", "رسالة"];
const SEARCH_WORDS = ["search", "suche", "suchen", "rechercher", "recherche", "buscar", "búsqueda", "pesquisar", "pesquisa", "cerca", "zoeken",
  "szukaj", "ara", "sök", "søg", "поиск", "検索", "搜索", "搜尋", "검색", "खोज", "தேடு", "தேடல்", "cari", "بحث", "find", "filter"];

// Lowercase, no punctuation or symbols (emoji, "…", "→"), spaces collapsed. Letters and marks of every script stay.
function norm(s) {
  return String(s || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
}
// Scripts without spaces between words (Japanese, Chinese, and Korean's own spacing): a phrase may run into more text.
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
// Does the label start with the phrase (as whole words), or is it the phrase? "Share reel" yes, "Shared" no. A short
// Latin phrase ("del", Danish for share) only counts as the whole label (Spanish "Del mismo autor" is a link).
function startsWith(label, phrase) {
  if (label === phrase) return true;
  if (!label.startsWith(phrase)) return false;
  if (CJK.test(phrase[phrase.length - 1] || "")) return true;
  return phrase.length > 3 && label[phrase.length] === " ";
}
const contains = (text, phrase) => (" " + text + " ").includes(" " + phrase + " ") || (CJK.test(phrase) && text.includes(phrase));
const prep = (list) => list.map(norm).sort((a, b) => b.length - a.length);
const LISTS = { draft: prep(DRAFT), publish: prep(PUBLISH), composer: prep(PUBLISH_IN_COMPOSER), commit: prep(COMMIT) };
const WORDS = { message: new Set(MESSAGE_WORDS.map(norm)), search: new Set(SEARCH_WORDS.map(norm)) };
const hasWord = (text, set) => { const t = norm(text); return t.split(" ").some((w) => set.has(w)) || [...set].some((w) => CJK.test(w) && t.includes(w)); };
// (Long labels are sentences, not buttons: a heading that happens to start with "Share". Only the first 6 words of a label
// count, and a label over 60 characters is only checked for a draft word.)
const FIRST_WORDS = 6;

const match = (label, list) => list.find((p) => startsWith(label, p)) || null;

// One label (a button's text, its aria-label, title or value) → { kind, word }.
//   composer: the element belongs to something being written (an editable field, a video being made, in its dialog or
//   form). Without it, "Post", "Comment", "Reply" and "Schedule" are only a menu item or a tab.
function classifyLabel(text, { composer = false } = {}) {
  const full = norm(text);
  if (!full) return { kind: "normal" };
  const label = full.split(" ").slice(0, FIRST_WORDS).join(" ");
  const draft = LISTS.draft.find((p) => contains(full, p));
  if (draft) return { kind: "draft", word: draft };
  if (full.length > 60) return { kind: "normal" };
  let w = match(label, LISTS.publish);
  if (w) return { kind: "publish", word: w };
  w = match(label, LISTS.composer);
  if (w) return composer ? { kind: "publish", word: w } : { kind: "normal", word: w, ifComposer: true };
  w = match(label, LISTS.commit);
  if (w) return { kind: "commit", word: w };
  return { kind: "normal" };
}

const RANK = { publish: 3, commit: 2, draft: 1, normal: 0 };
// Roles a click on which is a choice (a box, a switch, a slider), not an action: "Share to Facebook" as a switch only
// sets what happens when you (not the AI) press Share later.
const SETTING_ROLES = new Set(["checkbox", "switch", "radio", "slider", "spinbutton", "textbox", "searchbox", "combobox", "tab", "option",
  "menuitemcheckbox", "menuitemradio"]);

// A click: the element under the pointer and every element around it that takes clicks (a span inside a button: the
// button counts). chain: [{ role, labels: [..], composer }] from the element outwards (page.js gathers it). The most
// serious one decides; on one element a draft label wins over the rest ("Save draft" next to an icon called "Share").
// → { kind, word, label } (label: the text that matched, for the message).
function classifyClick(chain) {
  let best = { kind: "normal" };
  for (const el of chain || []) {
    if (!el || SETTING_ROLES.has(String(el.role || "").toLowerCase())) continue;
    let mine = { kind: "normal" };
    for (const label of el.labels || []) {
      const v = classifyLabel(label, { composer: !!el.composer });
      if (v.kind === "draft") { mine = { ...v, label }; break; }
      if (RANK[v.kind] > RANK[mine.kind]) mine = { ...v, label };
    }
    if (RANK[mine.kind] > RANK[best.kind]) best = mine;
  }
  return best;
}

// Pressing a key: Enter (and Space on a button) does what a click would; Enter in a text box can send what's in it.
//   key: { key, modifiers: { alt, ctrl, meta, shift } }. focus: what has the keyboard (page.js):
//   { role, type, multiline, editable, labels: [..], chain: [...] (as for a click, when it's a button or link),
//     form: { submits: [labels…] } | null, composer }
// → { kind, word?, label?, why? }
function classifyKey(key, focus) {
  const k = String((key && key.key) || "");
  const mod = (key && key.modifiers) || {};
  const f = focus || {};
  const enter = k === "Enter" || k === "NumpadEnter";
  if (!enter && k !== " " && k !== "Space") return { kind: "normal" };
  // Space or Enter on a button or link: the same as clicking it.
  if (!f.editable) return f.chain && f.chain.length ? classifyClick(f.chain) : { kind: "normal" };
  if (!enter) return { kind: "normal" };
  const labels = (f.labels || []).join(" · ");
  const first = (f.labels || []).find(Boolean) || "";
  if (f.role === "searchbox" || f.type === "search" || hasWord(labels, WORDS.search)) return { kind: "normal" };
  // Shift+Enter is a new line (chat apps send on plain Enter, mail and composers on Ctrl/Cmd+Enter).
  if (mod.shift && !mod.ctrl && !mod.meta && !mod.alt) return { kind: "normal" };
  // A text box with several lines (a caption, a comment, a message, a post): Enter or Ctrl/Cmd+Enter can send it. A new
  // line is typed with the text instead ("\n" in the text for the type tool).
  if (f.multiline || mod.ctrl || mod.meta || hasWord(labels, WORDS.message))
    return { kind: "publish", word: "enter", label: first || "this text box", why: "enter-sends" };
  // A one-line field in a form: Enter sends the form, which is its submit button's job.
  if (f.form) {
    let best = { kind: "commit", word: "submit", label: "the form", why: "enter-submits" };
    for (const s of f.form.submits || []) {
      const v = classifyLabel(s, { composer: !!f.composer });
      if (v.kind === "publish") return { kind: "publish", word: v.word, label: s, why: "enter-submits" };
      if (v.kind === "draft") best = { kind: "normal" };
    }
    return best;
  }
  return { kind: "commit", word: "enter", label: first || "this field", why: "enter" };
}

// A page's own question (alert / confirm / prompt): saying OK to "Publish this reel?" publishes. Only the verbs that always
// publish count here ("Discard post?" is about a post, it doesn't post one).
function classifyDialog(message, accept) {
  if (!accept) return { kind: "normal" };
  const m = norm(message);
  if (!m) return { kind: "normal" };
  if (LISTS.draft.some((d) => contains(m, d))) return { kind: "draft" };
  const p = LISTS.publish.find((w) => (w.length > 3 || CJK.test(w)) && contains(m, w));
  return p ? { kind: "publish", word: p, label: String(message).slice(0, 120) } : { kind: "normal" };
}

// The requests that publish on sites Kural knows, stopped in the network even if a click got past the labels (a button
// with only an icon, a language not listed above). While Kural's AI works in a tab, these fail there, also for your own
// clicks; when the answer is done, Kural lets go of the tab and you can publish yourself.
// (Instagram's web app publishes a post, a reel, a carousel or a story with POST …/api/v1/media/configure…/, and posts a
// comment with POST …/api/v1/web/comments/<id>/add/: from the community's notes on Instagram's private API, not watched
// on the live site. pattern: for CDP's Fetch.enable; re: checked again before failing a request.)
const NETWORK = [
  { site: "Instagram", pattern: "*instagram.com/api/v1/media/configure*", re: /^https:\/\/([\w-]+\.)*instagram\.com\/api\/v1\/media\/configure/i, what: "publishing a post, reel or story" },
  { site: "Instagram", pattern: "*instagram.com/create/configure*", re: /^https:\/\/([\w-]+\.)*instagram\.com\/create\/configure/i, what: "publishing a post" },
  { site: "Instagram", pattern: "*instagram.com/api/v1/web/comments/*", re: /^https:\/\/([\w-]+\.)*instagram\.com\/api\/v1\/web\/comments\/[^/]+\/add/i, what: "posting a comment" },
  { site: "Instagram", pattern: "*instagram.com/web/comments/*", re: /^https:\/\/([\w-]+\.)*instagram\.com\/web\/comments\/[^/]+\/add/i, what: "posting a comment" },
];
// → the rule a request breaks, or null. (Only requests that send something: a GET never publishes there.)
function blockedRequest(url, method) {
  if (String(method || "GET").toUpperCase() === "GET") return null;
  return NETWORK.find((r) => r.re.test(String(url || ""))) || null;
}

// What the AI is told when Kural stops it.
function refusal(v, site) {
  const what = v.why === "enter-sends" ? `pressing Enter in "${v.label}" can send or post what's in it`
    : v.why === "enter-submits" ? `pressing Enter would press "${v.label}", which publishes`
    : v.why === "dialog" ? `saying OK to "${v.label}" publishes`
    : `"${v.label || v.word}" publishes${site ? ` on ${site}` : ""}`;
  return `Kural stopped this: ${what}, and Kural never lets the AI publish, post, share or send anything, not even when the user asks. ` +
    "Stop here and tell the user what's ready: they can press it themselves. Saving a draft is fine where the site offers one" +
    (v.why === "enter-sends" ? ". (To start a new line in the text, put \\n in the text you type.)" : ".");
}

// (A search box's name: "Search", "Suchen"… For snapshot.js, which doesn't count those as something being written.)
const isSearchLabel = (text) => hasWord(text, WORDS.search);

module.exports = { classifyLabel, classifyClick, classifyKey, classifyDialog, blockedRequest, refusal, isSearchLabel, NETWORK, norm, SETTING_ROLES };
