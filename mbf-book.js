// The book a client has been writing without knowing it.
//
// Eight months of their own words, made into a book about them. Chad's idea,
// 2026-09-14, and corrected by him on 2026-09-15 after he read the first
// attempt: "I am not just collecting things people have said. I am wanting the
// book to tell a story, to have an opinion."
//
// The first version obeyed a rule that no narration appear anywhere. That rule
// produced an archive. It was chronological, it was accurate, every word in it
// was theirs, and it was worth nothing to them, because a person who has just
// finished eight months of work cannot see their own arc and a pile of their
// own entries does not show it to them. The reasoning behind the rule was
// sound and the result was not, and the result is what matters.
//
// So the book has an author. Chad spent eight months with this person and saw
// what they could not see about themselves, and the book says what he saw. The
// opinion is the thing they cannot produce alone and the only reason the object
// is worth having.
//
// What did not change: their words carry every claim. Any assertion about them
// is followed immediately by the passage from their own writing that shows it,
// at length, unedited. The narration is connective tissue and judgment. It is
// never a substitute for the material.
//
// Two stages. The first is deterministic and lives here: gather their material
// in order, attributed, with the prompts that produced it. The second is a
// drafting pass against `mbf-book-brief.txt`, which returns the book with every
// narration block marked so Chad can read and rewrite each one before anybody
// sees it. He edits it the way he edits the inner compass document in Module 6,
// which is the same move at a smaller scale.
//
// It remains a surprise. Nothing is announced and there is no consent flow.
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

// What the drafting pass is given: their material in order, attributed, with
// the prompt that produced each answer, so a draft can quote accurately and
// date anything it claims. This is source, not output. Nobody reads this.
function renderSource({ clientName, entries, mirrors }) {
  const lines = [];
  lines.push('CLIENT: ' + clientName);
  if (entries.length) {
    lines.push('SPAN: ' + longDate(entries[0].at) + ' to ' + longDate(entries[entries.length - 1].at));
  }
  lines.push('');

  for (const entry of entries) {
    lines.push('=== MODULE ' + entry.module + ' | ' + longDate(entry.at) + ' | ' + entry.title + ' ===');
    if (entry.kind === 'sitting') {
      for (const turn of turnsFrom(entry.transcript)) {
        lines.push((turn.who === 'companion' ? 'ASKED: ' : 'THEY WROTE: ') + turn.text.replace(/\n+/g, ' '));
      }
    } else {
      for (const prompt of entry.answered) {
        lines.push('PROMPT: ' + prompt.label);
        lines.push('THEY WROTE: ' + prompt.text);
      }
    }
    lines.push('');
  }

  if (mirrors.length) {
    lines.push('=== THE SAME QUESTION, ASKED TWICE ===');
    for (const page of mirrors) {
      lines.push('QUESTION: ' + page.label);
      lines.push('EARLY: ' + page.first.text);
      lines.push('LATE: ' + page.last.text);
      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}

// Chad reads every word the pass wrote before anybody else does, so the
// narration is marked rather than blended. Stripping the markers is the last
// step, after he has been through it.
const NARRATION = /\{\{CHAD\}\}([\s\S]*?)\{\{\/CHAD\}\}/g;

function narrationBlocks(markdown) {
  return [...String(markdown).matchAll(NARRATION)].map((m) => m[1].trim());
}

function stripMarkers(markdown) {
  return String(markdown).replace(NARRATION, (_, inner) => inner);
}

// A draft that quotes nothing has written about them instead of from them, and
// that is the failure this whole thing exists to avoid. The check is crude on
// purpose: it measures how much of the book is not Chad talking.
function theirShare(markdown) {
  const total = stripMarkers(markdown).split(/\s+/).filter(Boolean).length;
  const his = narrationBlocks(markdown).join(' ').split(/\s+/).filter(Boolean).length;
  if (!total) return 0;
  return (total - his) / total;
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
    source: renderSource({ clientName, entries, mirrors: mirrorPages(doc, code) }),
  };
}

module.exports = {
  MIRRORS,
  answeredPrompts,
  turnsFrom,
  buildBook,
  collect,
  mirrorPages,
  narrationBlocks,
  renderSource,
  stripMarkers,
  theirShare,
};
