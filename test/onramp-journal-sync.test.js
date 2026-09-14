// The ten On-Ramp journals exist twice: as markdown in
// performance-trap/docs/onramp-journals (which is also what the printable PDFs
// are built from) and as the data structure in onramp-journal-content.js
// (which is what the web pages render).
//
// That file's header says "Do not edit prompts here by hand. Change the
// markdown source and regenerate." No generator was ever committed, so the
// instruction cannot be followed and the two copies can drift silently: edit
// only the markdown and the site does not change, edit only the JS and the
// PDFs and the source of truth go stale.
//
// A generator is the wrong fix. The JS carries structure the markdown has no
// way to express (prompt ids, long-or-short field kinds, section headings,
// the Dropbox folder and root) and the markdown carries LaTeX the JS has no
// use for. A generator that silently dropped one of those fields would be
// worse than editing both files.
//
// So this checks the invariant instead of trying to produce one file from the
// other: every prompt rendered on the web must appear word for word in the
// markdown. Edit both, and this says so when you forget.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { JOURNALS, DOCS_DIR } = require('../onramp-journal-content.js');

function normalise(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

test('every journal prompt on the web appears word for word in the markdown source', () => {
  if (!fs.existsSync(DOCS_DIR)) {
    // The markdown lives in the sibling writing repo, which is not always
    // checked out beside this one. Nothing to compare against is not a failure.
    return;
  }
  const sources = fs
    .readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      slug: name.replace(/^week\d-\d\d-/, '').replace(/\.md$/, ''),
      text: normalise(fs.readFileSync(path.join(DOCS_DIR, name), 'utf8')),
    }));
  assert.ok(sources.length >= JOURNALS.length, 'a markdown file for every journal');

  const drift = [];
  for (const journal of JOURNALS) {
    const source = sources.find((s) => s.slug === journal.slug);
    assert.ok(source, 'markdown source for ' + journal.slug);
    for (const section of journal.sections || []) {
      for (const prompt of section.prompts || []) {
        if (!prompt.text) continue;
        // The first line is the question itself; the rest is guidance that
        // pandoc may have rewrapped, so compare the line that matters.
        const first = normalise(String(prompt.text).split('\n')[0]);
        if (first && !source.text.includes(first)) {
          drift.push(journal.slug + ' / ' + prompt.id + ': ' + first.slice(0, 80));
        }
      }
    }
  }
  assert.deepEqual(
    drift,
    [],
    'these prompts are on the web but not in the markdown, so one copy was edited without the other:\n  ' +
      drift.join('\n  ')
  );
});
