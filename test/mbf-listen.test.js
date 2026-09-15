// The chapters read aloud. A client at the end of a working day often has the
// attention for listening and not for reading, so what matters here is that the
// offer appears on the page, that it never pretends to be Chad's own voice when
// it is not, and that a chapter with no recording yet shows nothing rather than
// a control that fails when pressed.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { listenFor, hasListen, spokenLength, handleMbfListenRoute, MANIFEST } = require('../mbf-listen');
const { findReading, READINGS } = require('../mbf-reading-content');
const { readingPage } = require('../mbf-reading');

const anyRecorded = Object.keys(MANIFEST.chapters || {});

test('the list of recordings names chapters that actually exist', () => {
  const stems = new Set(READINGS.map((r) => r.file.replace(/\.md$/, '')));
  for (const stem of anyRecorded) {
    assert.ok(stems.has(stem), `${stem} has audio but no chapter`);
  }
});

test('a length is said the way a person would say it', () => {
  assert.equal(spokenLength(20), '1 minute');
  assert.equal(spokenLength(60), '1 minute');
  assert.equal(spokenLength(579), '10 minutes');
  assert.equal(spokenLength(3600), '60 minutes');
});

test('a chapter with no recording offers nothing to press', () => {
  const invented = { module: 9, slug: 'nothing-here', file: '09-01-nothing-here.md', title: 'Nothing Here' };
  assert.equal(listenFor(invented), null);
  assert.equal(hasListen(invented), false);
  assert.ok(!readingPage(invented).includes('<audio'), 'no player without a recording');
});

test('the bucket can be pointed somewhere else without touching the code', { skip: anyRecorded.length === 0 ? 'no recordings yet' : false }, () => {
  const before = process.env.MBF_AUDIO_BASE;
  process.env.MBF_AUDIO_BASE = 'https://audio.example/';
  const reading = READINGS.find((r) => hasListen(r));
  const listen = listenFor(reading);
  assert.match(listen.href, /^https:\/\/audio\.example\/mbf\/readings\/[0-9a-z-]+\.mp3$/);
  assert.match(listen.download, /^\/mbf-reading-audio\/\d\/[a-z0-9-]+\.mp3$/);
  if (before === undefined) delete process.env.MBF_AUDIO_BASE;
  else process.env.MBF_AUDIO_BASE = before;
});

test('the page says whose voice it is, and keeps the words on the page', { skip: anyRecorded.length === 0 ? 'no recordings yet' : false }, () => {
  const reading = READINGS.find((r) => hasListen(r));
  const html = readingPage(reading);
  assert.ok(html.includes('<audio id="player"'), 'the chapter should be listenable');
  assert.ok(/computer voice/.test(html), 'a synthetic voice must be named as one');
  assert.ok(html.includes('id="body"'), 'the written chapter stays on the page');
  assert.ok(html.includes('<label for="speed">Speed</label>'), 'the speed control needs a real label');
  assert.ok(html.includes('aria-label="This chapter read aloud"'), 'the player needs a name read aloud');
});

test('the recording can be saved, under a name that means something later', { skip: anyRecorded.length === 0 ? 'no recordings yet' : false }, async (t) => {
  const reading = READINGS.find((r) => hasListen(r));
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, headers: new Map([['content-length', '4']]), body: null };
  };
  const server = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      if (await handleMbfListenRoute(req, res, findReading)) return;
      res.writeHead(404); res.end();
    });
    s.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  t.after(() => { server.close(); global.fetch = realFetch; });

  const head = await new Promise((resolve, reject) => {
    const r = http.request(
      { port, path: '/mbf-reading-audio/' + reading.module + '/' + reading.slug + '.mp3', method: 'HEAD' },
      (res) => resolve({ status: res.statusCode, headers: res.headers })
    );
    r.on('error', reject); r.end();
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers['accept-ranges'], 'bytes', 'scrubbing inside a long chapter needs ranges');
  assert.match(head.headers['content-disposition'], /^attachment; filename="Module \d - .+\.mp3"$/);
  assert.ok(!/["\\/]/.test(head.headers['content-disposition'].split('"')[1].replace('.mp3', '')),
    'the file name must survive a file system');

  const missing = await new Promise((resolve, reject) => {
    const r = http.request({ port, path: '/mbf-reading-audio/3/not-a-chapter.mp3', method: 'HEAD' },
      (res) => resolve(res.statusCode));
    r.on('error', reject); r.end();
  });
  assert.equal(missing, 404);
});

// The script that makes the recordings has to hand the voice something sayable.
// A reader hearing "asterisk" or "hash" would stop trusting the whole thing.
test('the chapters turn into something a voice can read', () => {
  const script = path.join(__dirname, '..', 'scripts', 'generate-reading-audio.py');
  assert.ok(fs.existsSync(script), 'the script that makes the recordings should be in the repository');
  const src = fs.readFileSync(script, 'utf8');
  assert.ok(src.includes('am_michael'), 'the voice should be named in the script');
  assert.ok(src.includes('Mind Body'), 'the slash in Mind/Body would otherwise be spoken');
});
