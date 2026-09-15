// The book is made of a client's own words and nothing else, so the tests that
// matter most are the ones about what must never appear in it.
const test = require('node:test');
const assert = require('node:assert');

const { buildBook, collect, renderBook, mirrorPages, answeredPrompts } = require('../mbf-book');
const { findJournal } = require('../mbf-journal-content');

function storeWith(doc) {
  return { load: async () => JSON.parse(JSON.stringify(doc)) };
}

function promptIds(module, slug, n = 2) {
  const journal = findJournal(module, slug);
  const ids = [];
  for (const section of journal.sections || []) {
    for (const prompt of section.prompts || []) {
      if (prompt.kind === 'agree') continue;
      ids.push(prompt.id);
      if (ids.length >= n) return ids;
    }
  }
  return ids;
}

function sampleDoc() {
  const [a1] = promptIds(1, 'about-you', 1);
  const [t1] = promptIds(1, 'turning-point', 1);
  return {
    journals: [
      {
        code: 'jane-doe', module: 1, slug: 'turning-point',
        answers: { [t1]: { text: 'The knot in my gut on the Tuesday.' } },
        startedAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-02T10:00:00.000Z',
      },
      {
        code: 'jane-doe', module: 1, slug: 'about-you',
        answers: { [a1]: { text: 'I am forty-four and something is wrong.' } },
        startedAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z',
      },
      {
        code: 'someone-else', module: 1, slug: 'about-you',
        answers: { [a1]: { text: 'Not Jane, must never appear.' } },
        startedAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z',
      },
    ],
    companionSessions: [
      {
        code: 'jane-doe', module: 2, startedAt: '2026-03-01T10:00:00.000Z',
        transcript: 'You: the critic started before I sat down.',
        updatedAt: '2026-03-01T10:40:00.000Z',
      },
    ],
  };
}

test('it holds one client and never another', async () => {
  const book = await buildBook('jane-doe', { store: storeWith(sampleDoc()) });
  assert.match(book.markdown, /forty-four/);
  assert.doesNotMatch(book.markdown, /must never appear/);
});

test('it runs in the order things were written, not the order of the curriculum', async () => {
  const book = await buildBook('jane-doe', { store: storeWith(sampleDoc()) });
  assert.ok(
    book.markdown.indexOf('forty-four') < book.markdown.indexOf('knot in my gut'),
    'About You was written first and comes first'
  );
  assert.ok(
    book.markdown.indexOf('knot in my gut') < book.markdown.indexOf('critic started'),
    'the sitting came later and comes later'
  );
});

test('companion sittings are in it, not only journals', async () => {
  const book = await buildBook('jane-doe', { store: storeWith(sampleDoc()) });
  assert.match(book.markdown, /critic started before I sat down/);
});

test('an unanswered prompt leaves no trace', () => {
  const journal = findJournal(1, 'about-you');
  const [first, second] = promptIds(1, 'about-you', 2);
  const out = answeredPrompts(journal, { [first]: { text: 'said this' }, [second]: { text: '   ' } });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'said this');
});

test('the working agreements stay out, because a contract is not writing', () => {
  const journal = findJournal(1, 'about-you');
  const agreePrompt = (journal.sections || [])
    .flatMap((s) => s.prompts || [])
    .find((p) => p.kind === 'agree');
  if (!agreePrompt) return;
  const out = answeredPrompts(journal, { [agreePrompt.id]: { agree: true } });
  assert.ok(!out.some((p) => p.id === agreePrompt.id));
});

test('nothing in the document is written by anybody but the client', () => {
  const markdown = renderBook({
    clientName: 'Jane Doe',
    entries: [
      { kind: 'journal', module: 1, title: 'About You', at: '2026-01-02T10:00:00.000Z',
        answered: [{ id: 'q1', label: 'Where you are', text: 'I am forty-four.' }] },
    ],
    mirrors: [],
  });
  // Everything in it is either the client's words, a heading, a date, or a rule.
  const narration = /\b(you have come|notice how|this shows|what stands out|over time you|your journey|clearly|remarkable|progress)\b/i;
  assert.doesNotMatch(markdown, narration);
});

// Every declared pair must actually resolve against the live journals. A
// mirror that silently fails to find its prompt is the worst outcome here: the
// book still builds, still looks finished, and quietly has no argument in it.
test('every declared mirror finds both of its prompts in the real journals', () => {
  const { MIRRORS } = require('../mbf-book');
  const doc = { journals: [], companionSessions: [] };
  const idFor = (module, slug, match) => {
    const journal = findJournal(module, slug);
    for (const section of journal.sections || []) {
      for (const prompt of section.prompts || []) {
        if (prompt.kind !== 'agree' && match.test(prompt.label)) return prompt.id;
      }
    }
    return null;
  };
  for (const mirror of MIRRORS) {
    for (const [spec, when] of [[mirror.first, '2026-01-02T10:00:00.000Z'], [mirror.last, '2026-09-02T10:00:00.000Z']]) {
      const id = idFor(spec.module, spec.slug, spec.match);
      assert.ok(id, mirror.label + ' has no prompt matching ' + spec.match + ' in module ' + spec.module + ' ' + spec.slug);
      let record = doc.journals.find((r) => r.module === spec.module && r.slug === spec.slug);
      if (!record) {
        record = { code: 'jane-doe', module: spec.module, slug: spec.slug, answers: {}, updatedAt: when };
        doc.journals.push(record);
      }
      record.answers[id] = { text: when < '2026-05' ? 'early answer' : 'late answer' };
    }
  }
  const pages = mirrorPages(doc, 'jane-doe');
  assert.equal(pages.length, MIRRORS.length, 'every mirror renders');

  const markdown = renderBook({ clientName: 'Jane Doe', entries: [], mirrors: pages });
  assert.match(markdown, /early answer/);
  assert.match(markdown, /late answer/);
  // The two answers sit side by side and nothing is said about the difference.
  assert.doesNotMatch(markdown, /\b(compare|notice|shifted|changed|growth|whereas|contrast)\b/i);
});

test('a client with nothing written produces nothing rather than an empty book', async () => {
  const book = await buildBook('nobody', { store: storeWith(sampleDoc()) });
  assert.equal(book.entries.length, 0);
});

test('collect is stable when the store is empty', () => {
  assert.deepEqual(collect({}, 'jane-doe'), []);
});
