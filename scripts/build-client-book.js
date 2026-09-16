#!/usr/bin/env node
// Draft one client's book from what they have written.
//
//     node scripts/build-client-book.js <client-code> [--out FILE] [--source]
//
// Chad's tool, not a client's. It writes a draft, marked so he can see every
// word of narration and rewrite what is not his. Nobody reads it until he has.
//
//   --source   write the raw material instead of drafting, which is what to
//              look at when a draft has gone wrong and you want to know whether
//              the fault is the material or the pass over it.
const fs = require('node:fs');
const path = require('node:path');
const { buildBook } = require('../mbf-book');
const { draftBook, stripMarkers } = require('../mbf-book-draft');

async function main() {
  const args = process.argv.slice(2);
  const code = args.find((a) => !a.startsWith('--'));
  if (!code) {
    console.error('Usage: node scripts/build-client-book.js <client-code> [--out FILE] [--source]');
    process.exit(2);
  }
  const outIndex = args.indexOf('--out');
  const wantSource = args.includes('--source');

  const target = (suffix) =>
    outIndex >= 0 && args[outIndex + 1]
      ? path.resolve(args[outIndex + 1])
      : path.resolve(process.cwd(), 'build', 'books', code + suffix);

  if (wantSource) {
    const material = await buildBook(code);
    if (!material.entries.length) {
      console.error('Nothing written under the code "' + code + '" yet.');
      process.exit(1);
    }
    const file = target('-source.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, material.source, 'utf8');
    console.log(material.entries.length + ' entries, ' + material.words.toLocaleString('en-US') + ' of their words.');
    console.log(file);
    return;
  }

  const draft = await draftBook(code);
  const file = target('-draft.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, draft.markdown, 'utf8');
  fs.writeFileSync(file.replace(/-draft\.md$/, '-clean.md'), stripMarkers(draft.markdown), 'utf8');

  console.log(draft.clientName + ': ' + draft.entries + ' entries in, ' + draft.narration.length + ' narration blocks out.');
  console.log(Math.round(draft.theirShare * 100) + ' per cent of the book is their words.');
  for (const problem of draft.problems) console.log('  ! ' + problem);
  console.log(file);
  console.log(file.replace(/-draft\.md$/, '-clean.md') + '  (markers removed, read this last)');
}

main().catch((error) => {
  console.error(error && error.message);
  process.exit(1);
});
