// The journals are generated from the curriculum, and this is what stops them
// drifting back apart.
//
// They drifted badly once. Two Module 3 journals were live that exist nowhere in
// the source files, most of Module 2 was from an earlier version of the
// programme, and not one of the seven Follow-Up journals had ever been built
// even though Chad uses one after every session. The live numbering gave it
// away: Module 3 ran to 03.08 where the current one stops at 03.04A.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JOURNALS, findJournal, allPrompts, journalsForModule } = require('../mbf-journal-content');

const GENERATOR = path.join(__dirname, '..', 'scripts', 'build-mbf-journals.py');
const CURRICULUM = '/Users/chadherst/Library/CloudStorage/Dropbox/ML/Mind:Body Foundations/Module Source Files';

test('the checked-in journals match what the curriculum generates', (t) => {
  if (!fs.existsSync(CURRICULUM)) {
    t.skip('the curriculum is not on this machine');
    return;
  }
  let drifted = false;
  try {
    execFileSync('python3', [GENERATOR, '--check'], { stdio: 'pipe' });
  } catch (error) {
    drifted = true;
  }
  assert.ok(!drifted, 'mbf-journal-content.js has drifted: run python3 scripts/build-mbf-journals.py');
});

test('every module has its journals, and every one of the eight has a Follow-Up or a close', () => {
  for (let m = 1; m <= 8; m += 1) {
    assert.ok(journalsForModule(m).length > 0, `Module ${m} has no journals`);
  }
  for (let m = 1; m <= 7; m += 1) {
    const followUp = journalsForModule(m).some((j) => /follow-?up/i.test(j.title));
    assert.ok(followUp, `Module ${m} has no Follow-Up, and Chad uses one after every session`);
  }
});

test('no journal answers to another journal\'s address', () => {
  const seen = new Set();
  for (const j of JOURNALS) {
    assert.ok(!seen.has(j.slug), `two journals answer to ${j.slug}`);
    seen.add(j.slug);
    assert.equal(findJournal(j.module, j.slug), j);
    assert.equal(findJournal(j.module === 1 ? 2 : 1, j.slug), null, 'a slug must not open under another module');
  }
});

test('every prompt is answerable: it has an id, a box and something to answer', () => {
  const ids = new Set();
  for (const j of JOURNALS) {
    const prompts = allPrompts(j);
    assert.ok(prompts.length > 0, `${j.title} has no prompts`);
    for (const p of prompts) {
      assert.ok(p.id, `${j.title} has a prompt with no id`);
      assert.ok(['short', 'long', 'agree'].includes(p.kind), `${j.title}/${p.id} has kind ${p.kind}`);
      assert.ok(p.text && p.text.length > 20, `${j.title}/${p.id} has no question in it`);
      const key = j.slug + '/' + p.id;
      assert.ok(!ids.has(key), `two prompts share ${key}, so one would overwrite the other`);
      ids.add(key);
    }
  }
});

test('nothing the PDFs needed reaches a client', () => {
  for (const j of JOURNALS) {
    const all = [j.intro, j.blurb, ...allPrompts(j).map((p) => p.text + ' ' + p.label)].join(' ');
    assert.ok(!/\\field|\\newpage|\\begin/.test(all), `${j.title} still carries typesetting commands`);
  }
});

test('the two journals that were live with no source in the curriculum are gone', () => {
  const titles = JOURNALS.map((j) => j.title.toLowerCase());
  for (const orphan of ['our early warning system', 'sensations versus emotions', 'the ego']) {
    assert.ok(!titles.includes(orphan), `${orphan} is live and exists nowhere in the curriculum`);
  }
});
