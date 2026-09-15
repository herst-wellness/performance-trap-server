// The Performance Trap Practice readings, read aloud. The pieces are not files
// on disk, they are sections inside the week HTML, so the thing most worth
// proving is that the address of a recording still matches the heading it
// belongs to. A renamed heading silently drops the audio from the page, and
// nothing else would notice.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const {
  sectionSlug, stemFor, listenFor, hasListen, spokenLength,
  titleFromStem, handleOnrampListenRoute, MANIFEST,
} = require('../onramp-listen');
const { COURSE_WEEKS, lessonContentHtml } = require('../onramp-course');

function sections(html) {
  return String(html).split('<h3>').slice(1).map((p) => p.slice(0, p.indexOf('</h3>')));
}

const recorded = Object.keys(MANIFEST.chapters || {});
const skipUntilRecorded = recorded.length === 0 ? 'no recordings yet' : false;

test('a heading becomes an address a person could read', () => {
  assert.equal(sectionSlug('The Breath'), 'the-breath');
  assert.equal(sectionSlug("One person's story: the wound underneath"), 'one-persons-story-the-wound-underneath');
  assert.equal(sectionSlug('The Loop, and Where It Opens'), 'the-loop-and-where-it-opens');
  assert.equal(stemFor(3, 'Tune In to the Trade'), 'week-3-tune-in-to-the-trade');
});

test('every recording belongs to a piece that is still on a week page', () => {
  const live = new Set();
  for (const week of Object.keys(COURSE_WEEKS)) {
    for (const heading of sections(COURSE_WEEKS[week].teaching)) live.add(stemFor(week, heading));
  }
  for (const stem of recorded) {
    assert.ok(live.has(stem), `${stem} has audio but no piece: a heading was renamed`);
  }
});

test('two pieces never share an address', () => {
  const seen = new Set();
  for (const week of Object.keys(COURSE_WEEKS)) {
    for (const heading of sections(COURSE_WEEKS[week].teaching)) {
      const stem = stemFor(week, heading);
      assert.ok(!seen.has(stem), `two pieces answer to ${stem}`);
      seen.add(stem);
    }
  }
});

test('a length is said the way a person would say it', () => {
  assert.equal(spokenLength(30), '1 minute');
  assert.equal(spokenLength(420), '7 minutes');
});

test('a saved file is named for the piece it is', () => {
  assert.equal(titleFromStem('week-3-the-third-option'), 'Week 3 - The Third Option');
});

test('a piece with no recording offers nothing to press', () => {
  assert.equal(listenFor(1, 'A Heading That Does Not Exist'), null);
  assert.equal(hasListen(1, 'A Heading That Does Not Exist'), false);
});

test('the week page offers the pieces aloud, and keeps the words', { skip: skipUntilRecorded }, () => {
  const week = Number(recorded[0].split('-')[1]);
  const html = lessonContentHtml(week, '');
  assert.ok(html.includes('data-reading='), 'the pieces should be listenable');
  assert.ok(/computer voice/.test(html), 'a synthetic voice must be named as one');
  assert.ok(/own recording of this one is coming/.test(html), 'and his own must be promised');
  assert.ok(html.includes('<h3>'), 'the written pieces stay on the page');
  assert.ok(html.includes('Download it to listen on the go'), 'the download has to say what it is for');
});

test('one speed governs the readings and leaves the guided sit alone', { skip: skipUntilRecorded }, () => {
  const week = Number(recorded[0].split('-')[1]);
  const html = lessonContentHtml(week, '');
  assert.ok(html.includes('id="readingSpeed"'), 'the week needs one speed control');
  assert.equal((html.match(/id="readingSpeed"/g) || []).length, 1, 'exactly one, not one per piece');
  assert.ok(html.includes('<label for="readingSpeed">'), 'the control needs a real label');
  // The sit keeps its own player and is never given a reading marker.
  assert.ok(!/data-sit="[^"]*"[^>]*data-reading/.test(html), 'a guided sit must not be sped up');
});

test('speeding a reading up never lifts the pitch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'onramp-course.js'), 'utf8');
  assert.ok(src.includes('audio.preservesPitch = true'), 'the pitch switch must be asked for, not assumed');
  assert.ok(src.includes('audio.webkitPreservesPitch = true'), 'older Safari spells it differently');
  assert.ok(src.includes("audio.addEventListener('ratechange', keepPitch)"),
    'a browser that resets the switch must be corrected');
});

test('the speed a person picks carries between the Practice and Foundations', () => {
  const course = fs.readFileSync(path.join(__dirname, '..', 'onramp-course.js'), 'utf8');
  const mbf = fs.readFileSync(path.join(__dirname, '..', 'mbf-reading.js'), 'utf8');
  assert.ok(course.includes("'herst-listen-speed'"), 'the Practice should use the shared key');
  assert.ok(mbf.includes("'herst-listen-speed'"), 'and Foundations the same one');
});

test('a reading can be carried off the page, and a missing one is not offered', { skip: skipUntilRecorded }, async (t) => {
  const stem = recorded[0];
  const realFetch = global.fetch;
  global.fetch = async () => ({ status: 200, headers: new Map([['content-length', '4']]), body: null });
  const server = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      if (await handleOnrampListenRoute(req, res)) return;
      res.writeHead(404); res.end();
    });
    s.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  t.after(() => { server.close(); global.fetch = realFetch; });

  const head = await new Promise((resolve, reject) => {
    const r = http.request({ port, path: '/onramp-reading-audio/' + stem + '.mp3', method: 'HEAD' },
      (res) => resolve({ status: res.statusCode, headers: res.headers }));
    r.on('error', reject); r.end();
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers['accept-ranges'], 'bytes', 'scrubbing a long piece needs ranges');
  assert.match(head.headers['content-disposition'], /^attachment; filename="Week \d - .+\.mp3"$/);

  const missing = await new Promise((resolve, reject) => {
    const r = http.request({ port, path: '/onramp-reading-audio/week-9-nothing.mp3', method: 'HEAD' },
      (res) => resolve(res.statusCode));
    r.on('error', reject); r.end();
  });
  assert.equal(missing, 404);
});

test('the week pages still allow the bucket to be played from', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'onramp-course.js'), 'utf8');
  const csp = src.split('\n').find((line) => line.includes('Content-Security-Policy') && line.includes('media-src'));
  assert.ok(csp, 'the lesson page must set a policy that names where media may come from');
  assert.ok(/media-src[^;]*r2\.dev/.test(csp), 'the bucket must be allowed or every player is silently blocked');
});
