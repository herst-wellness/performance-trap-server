// The book a client has been writing without knowing it.
//
// Eight months of journals and companion sittings, in the order they were
// written, bound as one document and handed over at the end. Chad's idea,
// 2026-09-14. It performs the move the whole programme is built on, on the
// whole programme at once: every word in it was *me* when it was written, and
// in your hands as a book it becomes *a part of me*.
//
// Three rules, and they are the whole design.
//
// **No narration.** Nothing in here is written by an AI or by anybody except
// the client. No summaries, no chapter introductions, no themes drawn out, no
// arc explained, no observations about how far they have come. Chronological
// order, module dividers, their words. The restraint is the point: a
// commentary would hand them somebody else's reading of their own life, which
// is the exact move the programme spent eight months undoing.
//
// **Two mechanical exceptions**, both of which interpret nothing. Dates and
// headings, so a reader can navigate. And mirror pages, where the same
// question asked in Module 1 and again at the end is set down side by side
// with no comment at all. The difference between the two answers is the
// book's only argument, and the client makes it themselves by reading.
//
// **It is a surprise.** Chad's ruling: nothing is announced, there is no
// consent flow, because a coach reading a client's written work is the
// relationship rather than a disclosure. So this runs for him, not for them.
// He reads the assembled book before anybody else sees it.
const { defaultStore } = require('./mbf-store');
const { JOURNALS, findJournal } = require('./mbf-journal-content');
const { clientNameFromCode } = require('./mbf-delivery');

// A question that is asked at the start and again at the end. Answered months
// apart by two different people, and nobody has to say so.
//
// Pairs are declared rather than detected, because a machine guessing at which
// two prompts "mean the same thing" is interpretation, and interpretation is
// the one thing this document does not do.
const MIRRORS = [
  {
    label: 'Where you are',
    first: { module: 1, slug: 'about-you', match: /^\d*\.?\s*where you are/i },
    last: { module: 8, slug: 'your-road-back', match: /look back at your ratings/i },
  },
  {
    label: 'What was bumping into you',
    first: { module: 1, slug: 'about-you', match: /bumping into you/i },
    last: { module: 8, slug: 'heros-journey', match: /through-line/i },
  },
  {
    label: 'What you came to work on',
    first: { module: 1, slug: 'about-you', match: /stuck places you want to work/i },
    last: { module: 8, slug: 'your-road-back', match: /gap between/i },
  },
];

function normaliseCode(code) {
  return String(code).toLowerCase().replace(/[\s_]+/g, '-');
}

// A sitting is a conversation, and half of a conversation with a companion is
// the companion talking. Dropped in whole, the book would be half somebody
// else's words, which breaks the only rule it has.
//
// So a sitting is set the way a published interview is. The companion's turns
// go in small, as the question, and the client's answers are the body text. It
// reads as an interview with themselves, which is close to what it was, and
// every word of substance in it is still theirs.
function turnsFrom(transcript) {
  const turns = [];
  let current = null;
  for (const raw of String(transcript || '').split('\n')) {
    const match = /^(You|Companion):\s?(.*)$/.exec(raw);
    if (match) {
      if (current) turns.push(current);
      current = { who: match[1] === 'You' ? 'client' : 'companion', text: match[2] };
    } else if (current) {
      current.text += '\n' + raw;
    } else if (raw.trim()) {
      // A transcript with no speaker labels at all is treated as theirs, which
      // is the safe direction to be wrong in: it can only ever include their
      // own words, never attribute the companion's to them.
      current = { who: 'client', text: raw };
    }
  }
  if (current) turns.push(current);
  return turns
    .map((t) => ({ ...t, text: t.text.trim() }))
    .filter((t) => t.text);
}

// Everything a client wrote, as one flat list in the order it happened. A
// journal is dated by when they last touched it, a sitting by when it began,
// because that is when each was actually being lived.
function collect(doc, code) {
  const key = normaliseCode(code);
  const entries = [];

  for (const record of doc.journals || []) {
    if (record.code !== key) continue;
    const journal = findJournal(record.module, record.slug);
    if (!journal) continue;
    const answered = answeredPrompts(journal, record.answers);
    if (!answered.length) continue;
    entries.push({
      kind: 'journal',
      module: record.module,
      title: journal.title,
      at: record.finishedAt || record.updatedAt || record.startedAt,
      slug: record.slug,
      answered,
    });
  }

  for (const record of doc.companionSessions || []) {
    if (record.code !== key) continue;
    if (!String(record.transcript || '').trim()) continue;
    entries.push({
      kind: 'sitting',
      module: record.module,
      title: 'A sitting',
      at: record.startedAt,
      transcript: record.transcript,
    });
  }

  entries.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return entries;
}

// Only what they actually wrote. An unanswered prompt is not a blank line in
// somebody's book, it is simply not there, and the agreements from About You
// are a contract rather than writing and stay out.
function answeredPrompts(journal, answers) {
  const out = [];
  for (const section of journal.sections || []) {
    for (const prompt of section.prompts || []) {
      if (prompt.kind === 'agree') continue;
      const given = answers && answers[prompt.id];
      const text = given && typeof given === 'object' ? String(given.text || '') : String(given || '');
      if (!text.trim()) continue;
      out.push({ id: prompt.id, label: prompt.label, text: text.trim() });
    }
  }
  return out;
}

function findAnswer(doc, code, spec) {
  const key = normaliseCode(code);
  const record = (doc.journals || []).find(
    (r) => r.code === key && r.module === spec.module && r.slug === spec.slug
  );
  if (!record) return null;
  const journal = findJournal(spec.module, spec.slug);
  if (!journal) return null;
  for (const prompt of answeredPrompts(journal, record.answers)) {
    if (spec.match.test(prompt.label)) return prompt;
  }
  return null;
}

function mirrorPages(doc, code) {
  const pages = [];
  for (const mirror of MIRRORS) {
    const first = findAnswer(doc, code, mirror.first);
    const last = findAnswer(doc, code, mirror.last);
    if (!first || !last) continue;
    pages.push({ label: mirror.label, first, last });
  }
  return pages;
}

function longDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Markdown, because it opens anywhere, reads correctly in a screen reader, and
// goes into a print template without being unpicked first.
function renderBook({ clientName, entries, mirrors, now = new Date() }) {
  const lines = [];
  lines.push('# ' + clientName);
  lines.push('');
  lines.push('*Mind/Body Foundations*');
  lines.push('');
  if (entries.length) {
    lines.push('*' + longDate(entries[0].at) + ' to ' + longDate(entries[entries.length - 1].at) + '*');
    lines.push('');
  }
  lines.push('---');
  lines.push('');

  let module = null;
  for (const entry of entries) {
    if (entry.module !== module) {
      module = entry.module;
      lines.push('');
      lines.push('## Module ' + module);
      lines.push('');
    }
    lines.push('### ' + entry.title);
    const when = longDate(entry.at);
    if (when) {
      lines.push('');
      lines.push('*' + when + '*');
    }
    lines.push('');
    if (entry.kind === 'sitting') {
      for (const turn of turnsFrom(entry.transcript)) {
        if (turn.who === 'companion') {
          lines.push('*' + turn.text.replace(/\n+/g, ' ') + '*');
        } else {
          lines.push(turn.text);
        }
        lines.push('');
      }
      continue;
    }
    for (const prompt of entry.answered) {
      lines.push('**' + prompt.label + '**');
      lines.push('');
      lines.push(prompt.text);
      lines.push('');
    }
  }

  if (mirrors.length) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Then and now');
    lines.push('');
    for (const page of mirrors) {
      lines.push('### ' + page.label);
      lines.push('');
      lines.push('**' + longDate(page.first.at || '') + '**');
      lines.push('');
      lines.push(page.first.text);
      lines.push('');
      lines.push('**Later**');
      lines.push('');
      lines.push(page.last.text);
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

async function buildBook(code, { store = defaultStore(), now = new Date() } = {}) {
  const doc = await store.load();
  const entries = collect(doc, code);
  const clientName = clientNameFromCode(code);
  return {
    clientName,
    entries,
    words: entries.reduce(
      (n, e) =>
        n +
        (e.kind === 'sitting'
          ? turnsFrom(e.transcript).filter((t) => t.who === 'client').map((t) => t.text).join(' ')
          : e.answered.map((p) => p.text).join(' ')
        )
          .split(/\s+/)
          .filter(Boolean).length,
      0
    ),
    markdown: renderBook({ clientName, entries, mirrors: mirrorPages(doc, code), now }),
  };
}

module.exports = {
  MIRRORS,
  answeredPrompts,
  turnsFrom,
  buildBook,
  collect,
  mirrorPages,
  renderBook,
};
