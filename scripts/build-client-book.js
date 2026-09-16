#!/usr/bin/env node
// Assemble one client's book from what they have written.
//
//     node scripts/build-client-book.js <client-code> [--out FILE]
//
// Chad's tool, not a client's. The book is a surprise, so nothing about it is
// announced anywhere a client can see, and he reads the assembled document
// before anybody else does.
//
// It contains no writing but theirs. If it reads oddly in places, that is the
// record rather than a fault in the generator.
const fs = require('node:fs');
const path = require('node:path');
const { buildBook } = require('../mbf-book');

async function main() {
  const args = process.argv.slice(2);
  const code = args.find((a) => !a.startsWith('--'));
  if (!code) {
    console.error('Usage: node scripts/build-client-book.js <client-code> [--out FILE]');
    process.exit(2);
  }
  const outIndex = args.indexOf('--out');
  const book = await buildBook(code);
  if (!book.entries.length) {
    console.error('Nothing written under the code "' + code + '" yet.');
    process.exit(1);
  }
  const target =
    outIndex >= 0 && args[outIndex + 1]
      ? path.resolve(args[outIndex + 1])
      : path.resolve(process.cwd(), 'build', 'books', book.clientName.replace(/[^\w ]+/g, '') + '.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, book.markdown, 'utf8');
  const journals = book.entries.filter((e) => e.kind === 'journal').length;
  const sittings = book.entries.length - journals;
  console.log(
    book.clientName + ': ' + journals + ' journals, ' + sittings + ' sittings, ' +
      book.words.toLocaleString('en-US') + ' words of their own.'
  );
  console.log(target);
}

main().catch((error) => {
  console.error(error && error.message);
  process.exit(1);
});
