#!/usr/bin/env node
// A shape test, not a book.
//
// The real book is made of a client's written journals and companion sittings,
// and none of that exists yet. This borrows real recorded material to answer a
// different question, and a useful one: at real length, with real texture, does
// a chronological run of one person's own words hold together with nobody
// narrating it?
//
// It is not the artifact. Speech is not writing, and a session transcript is
// looser and more circular than a journal will be. What it tests is the reading
// experience, not the mechanics, which need stored records that do not exist.
//
// Read-only over the transcripts. Writes one file wherever you point it.
const fs = require('node:fs');
const path = require('node:path');
const { renderBook } = require('../mbf-book');

const ROOT = '/Users/chadherst/Library/CloudStorage/Dropbox/Otter Transcripts';
const CHAD = /^(Chad Herst|Chad)\s*:/i;
const LABEL = /^([A-Za-z][A-Za-z ()0-9.'-]{0,30})\s*:/;
const META = /^(Title|Date|Otter ID|Otter URL|Otter title|Source|Filed under|Calendar event|Duration|Date note|Transcribed by)\s*:/i;
const TS = /^\[[0-9:]+\]\s*/;

// `solo` takes every turn, for a recording made alone. Otherwise only the turns
// labelled with his name, because in a two-person session the unlabelled ones
// are ambiguous and the one thing this must not do is put somebody else's words
// under his name.
function turnsFrom(text, { solo }) {
  const out = [];
  let mine = solo;
  for (const raw of text.split('\n')) {
    const line = TS.test(raw) ? raw.replace(TS, '') : raw;
    if (META.test(line)) continue;
    const m = LABEL.exec(line);
    let body = line;
    if (m) {
      if (!solo) mine = CHAD.test(line);
      body = line.slice(m[0].length);
    }
    if (!mine) continue;
    const said = body.trim();
    if (said.length > 40) out.push(said);
  }
  return out;
}

function dateFrom(name, text) {
  const inText = /^Date:\s*(\d{4})\/(\d{2})\/(\d{2})/m.exec(text);
  if (inText) return `${inText[1]}-${inText[2]}-${inText[3]}T12:00:00.000Z`;
  const inName = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (inName) return `${inName[1]}-${inName[2]}-${inName[3]}T12:00:00.000Z`;
  return null;
}

function main() {
  const out = process.argv[2];
  const sources = process.argv.slice(3);
  if (!out || !sources.length) {
    console.error('Usage: node scripts/shape-test-from-transcripts.js <out.md> <folder[:solo]> ...');
    process.exit(2);
  }
  const entries = [];
  for (const source of sources) {
    const [folder, mode] = source.split(':');
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const at = dateFrom(name, text);
      if (!at) continue;
      const turns = turnsFrom(text, { solo: mode === 'solo' });
      if (!turns.length) continue;
      entries.push({
        kind: 'journal',
        module: new Date(at).getFullYear(),
        title: mode === 'solo' ? 'Recorded alone' : 'A session',
        at,
        answered: turns.map((t, i) => ({ id: `l${i}`, label: '', text: t })),
      });
    }
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const markdown = renderBook({ clientName: 'Chad Herst', entries, mirrors: [] })
    .replace(/^\*\*\*\*\n\n/gm, '')
    .replace(/\n{4,}/g, '\n\n\n');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, markdown, 'utf8');
  const words = markdown.split(/\s+/).filter(Boolean).length;
  console.log(`${entries.length} recordings, ${words.toLocaleString('en-US')} words.`);
  console.log(out);
}

main();
