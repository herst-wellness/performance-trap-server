// The drafting pass: their material in, a book out, for Chad to edit.
//
// This is the half that has an opinion. It reads everything one person wrote
// across eight months and writes their story, with their own passages carrying
// every claim, in Chad's voice, structured the way his own book is structured.
//
// It writes a draft and nothing else. Every narration block comes back marked,
// he reads and rewrites each one, and only then does it become an object. That
// is the same arrangement as the inner compass document he writes at Module 6,
// and it is what makes the words his rather than a machine's.
const fs = require('node:fs');
const path = require('node:path');
const { buildBook, narrationBlocks, stripMarkers, theirShare } = require('./mbf-book');

const BRIEF = path.join(__dirname, 'mbf-book-brief.txt');

// A book is long, so the draft needs room. This is not a chat turn.
const MAX_OUTPUT_TOKENS = 32000;

function brief() {
  return fs.readFileSync(BRIEF, 'utf8');
}

async function requestAnthropic(instructions, source, fetchImpl) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.BOOK_MODEL || process.env.COMPANION_MODEL || process.env.ANTHROPIC_MODEL;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set, so no draft can be written.');
  if (!model) throw new Error('No model is configured. Set BOOK_MODEL.');
  const url = process.env.ANTHROPIC_API_BASE_URL || 'https://api.anthropic.com/v1/messages';
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: instructions,
      messages: [{ role: 'user', content: source }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error('The drafting pass failed: ' + response.status + ' ' + detail.slice(0, 300));
  }
  const data = await response.json();
  const text = (data.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  if (!text.trim()) throw new Error('The drafting pass returned nothing.');
  return { text, stopReason: data.stop_reason };
}

// Two things can go wrong that look like success. A draft can run out of room
// and stop mid-book, and a draft can write about somebody instead of from them.
// Both are caught here rather than discovered by Chad halfway down page forty.
function check(markdown, stopReason) {
  const problems = [];
  if (stopReason === 'max_tokens') {
    problems.push('The draft ran out of room and stops mid-book.');
  }
  const share = theirShare(markdown);
  if (share < 0.55) {
    problems.push(
      'Only ' + Math.round(share * 100) + ' per cent of this is their words. ' +
        'A draft that quotes this little has written about them instead of from them.'
    );
  }
  if (!narrationBlocks(markdown).length) {
    problems.push('No narration is marked, so there is nothing for Chad to read and edit.');
  }
  return problems;
}

async function draftBook(code, { fetchImpl = fetch, store } = {}) {
  const material = await buildBook(code, store ? { store } : {});
  if (!material.entries.length) {
    const err = new Error('Nothing written under the code "' + code + '" yet.');
    err.empty = true;
    throw err;
  }
  const { text, stopReason } = await requestAnthropic(brief(), material.source, fetchImpl);
  return {
    clientName: material.clientName,
    words: material.words,
    entries: material.entries.length,
    markdown: text,
    narration: narrationBlocks(text),
    theirShare: theirShare(text),
    problems: check(text, stopReason),
  };
}

module.exports = { brief, check, draftBook, stripMarkers, MAX_OUTPUT_TOKENS };
