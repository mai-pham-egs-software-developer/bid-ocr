// Picks the Chapter V (Chương V / C5 — technical requirements) file among a bid's
// raw attachments by filename, so OCR only converts that one file per medical bid
// instead of every attachment. Scoring mirrors bid-ai-processor/c5finder.js, which
// runs the same heuristic against already-converted .md files.

// Collapse every run of non-alphanumeric characters to a single space (not an
// underscore) so `\b` word-boundary checks below actually work — an underscore
// is itself a word character, so "chuong_v_pdf" has no boundary after "v".
function normalize(str) {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function scoreFilename(filename) {
    const n = normalize(filename);
    let score = 0;

    if (/chuong ?v\b/.test(n))                     score += 100;
    if (/chuong ?5\b/.test(n))                     score += 100;
    if (/chapter ?v\b/.test(n))                    score += 100;
    if (/chapter ?5\b/.test(n))                    score += 100;
    if (/phu ?luc ?(v\b|5\b)/.test(n))             score += 90;
    if (/\bc ?v\b/.test(n))                        score += 80;
    if (/\bch ?v\b/.test(n))                       score += 80;
    if (/\bc5\b/.test(n))                          score += 80;
    if (/\bch5\b/.test(n))                         score += 80;

    if (/yeu ?cau ?ky ?thuat/.test(n))             score += 70;
    // "Yêu cầu KT" — abbreviating "kỹ thuật" as "KT" is the common real-world
    // filename pattern for this same document (technical requirements), seen
    // far more often in practice than the spelled-out "ky thuat" form.
    if (/yeu ?cau ?kt\b/.test(n))                  score += 70;
    if (/yckt/.test(n))                             score += 70;
    if (/tieu ?chuan ?ky ?thuat/.test(n))          score += 60;
    if (/ky ?thuat/.test(n))                       score += 40;
    if (/technical ?(spec|req)/.test(n))           score += 70;

    if (/thong ?so/.test(n))                       score += 20;
    if (/spec/.test(n))                             score += 15;

    if (/chuong ?(i|1|ii|2|iii|3|iv|4|vi|6|vii|7)\b/.test(n)) score -= 200;
    if (/hop ?dong/.test(n))                       score -= 100;
    if (/chao ?gia/.test(n))                       score -= 100;

    return score;
}

// filenames: array of object keys (or plain filenames) under one bid's folder.
// Returns the best-scoring key, or null if nothing looks like Chapter V.
function pickC5File(filenames) {
    if (!filenames.length) return null;
    const candidates = filenames
        .map(name => ({ name, score: scoreFilename(name) }))
        .sort((a, b) => b.score - a.score);
    return candidates[0].score > 0 ? candidates[0].name : null;
}

module.exports = { pickC5File, scoreFilename };
