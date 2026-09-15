// The Performance Trap Practice readings, pulled out as plain text so they can
// be read aloud.
//
// The four week pages are built from HTML held in onramp-course.js, one <h3>
// section per piece, rather than from files on disk the way Mind/Body
// Foundations chapters are. This writes each section out as text a voice can
// read, into build/onramp-readings/, and prints what it found.
//
//   node scripts/extract-onramp-readings.js
//
// Then scripts/generate-reading-audio.py turns those into MP3s:
//
//   ~/.local/share/speak11/venv/bin/python3 scripts/generate-reading-audio.py \
//     --source build/onramp-readings --out build/onramp-audio \
//     --manifest onramp-reading-audio.json
const fs = require('node:fs');
const path = require('node:path');
const { COURSE_WEEKS } = require('../onramp-course');
const { sectionSlug } = require('../onramp-listen');

const OUT = path.join(__dirname, '..', 'build', 'onramp-readings');

// Said aloud, a slash is a slash and an ampersand is an ampersand.
const SPOKEN = [
  [/Mind\/Body/g, 'Mind Body'],
  [/&amp;/g, 'and'],
  [/&nbsp;/g, ' '],
  [/&rsquo;|&#39;/g, '’'],
  [/&ldquo;|&rdquo;|&quot;/g, '"'],
  [/&mdash;/g, ', '],
  [/&hellip;/g, '...'],
];

// The page markup into something sayable. Paragraphs and list items become
// their own lines, which is what gives the voice its pauses; everything else
// that carries no sound comes out.
function toSpeech(html) {
  let s = String(html);
  s = s.replace(/<h3>(.*?)<\/h3>/gs, (m, t) => '\n' + t.trim().replace(/\.$/, '') + '.\n\n');
  s = s.replace(/<h4>(.*?)<\/h4>/gs, (m, t) => '\n' + t.trim().replace(/\.$/, '') + '.\n\n');
  s = s.replace(/<li>(.*?)<\/li>/gs, (m, t) => {
    const line = t.trim();
    return '\n' + line + (/[.!?:;,]$/.test(line) ? '' : '.') + '\n';
  });
  s = s.replace(/<\/(p|blockquote|div|section|ul|ol)>/g, '\n\n');
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<[^>]+>/g, '');
  for (const [pattern, spoken] of SPOKEN) s = s.replace(pattern, spoken);
  s = s.replace(/&amp;/g, 'and').replace(/&lt;/g, '').replace(/&gt;/g, '');
  return s.split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sections(html) {
  return String(html)
    .split('<h3>')
    .slice(1)
    .map((part) => ({
      heading: part.slice(0, part.indexOf('</h3>')),
      html: '<h3>' + part,
    }));
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let count = 0;
  let words = 0;
  for (const week of Object.keys(COURSE_WEEKS)) {
    for (const section of sections(COURSE_WEEKS[week].teaching)) {
      const text = toSpeech(section.html);
      const stem = 'week-' + week + '-' + sectionSlug(section.heading);
      fs.writeFileSync(path.join(OUT, stem + '.txt'), text + '\n', 'utf8');
      const n = text.split(/\s+/).filter(Boolean).length;
      words += n;
      count += 1;
      console.log(String(n).padStart(5) + '  ' + stem);
    }
  }
  console.log(count + ' pieces, ' + words + ' words, written to build/onramp-readings/');
}

main();
