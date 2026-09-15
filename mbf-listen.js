// The Mind/Body Foundations chapters, read aloud.
//
// A chapter is nine minutes of reading. A client at the end of a working day
// often has the attention for listening and not for reading, so every chapter
// has an audio version alongside the text and the page offers both.
//
// The voice is a computer voice, Kokoro's am_michael, the one Chad uses to read
// his own screen. The pages say so plainly rather than letting a client assume
// it is him. When Chad records a chapter himself the recording replaces the file
// of the same name in the bucket and nothing in here changes.
//
// scripts/generate-reading-audio.py makes the files and writes the list of what
// exists. The bucket is the one the meditations and the audiobook already use.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev';
const PREFIX = '/mbf/readings/';

function loadManifest() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'mbf-reading-audio.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.chapters ? parsed : { chapters: {} };
  } catch (e) {
    return { chapters: {} };
  }
}

const MANIFEST = loadManifest();

function base() {
  const set = String(process.env.MBF_AUDIO_BASE || '').trim();
  return (set || DEFAULT_BASE).replace(/\/+$/, '');
}

// The chapters are files named <module>-<code>-<slug>.md and the audio keeps
// that name, so a file in the bucket can be matched to a chapter by eye.
function stemFor(reading) {
  return reading.file.replace(/\.md$/, '');
}

// "9 minutes" is what a person deciding whether to press play wants. Under a
// minute never happens in these chapters, but it would read as "1 minute"
// rather than "0 minutes" if it did.
function spokenLength(totalSeconds) {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return minutes + (minutes === 1 ? ' minute' : ' minutes');
}

function listenFor(reading) {
  if (!reading) return null;
  const stem = stemFor(reading);
  const entry = MANIFEST.chapters[stem];
  if (!entry) return null;
  return {
    stem,
    seconds: entry.seconds,
    length: spokenLength(entry.seconds),
    href: base() + PREFIX + stem + '.mp3',
    download: '/mbf-reading-audio/' + reading.module + '/' + reading.slug + '.mp3',
    computerVoice: MANIFEST.spoken_by !== 'chad',
  };
}

function hasListen(reading) {
  return Boolean(reading && MANIFEST.chapters[stemFor(reading)]);
}

// A client on a train wants the file on the phone rather than a stream. The
// bucket serves the bytes; this adds the one header that makes a browser save
// it under a name that still means something months later.
const DOWNLOAD_ROUTE = /^\/mbf-reading-audio\/(\d)\/([a-z0-9-]+)\.mp3$/;

async function handleMbfListenRoute(req, res, findReading) {
  const m = DOWNLOAD_ROUTE.exec(String(req.url).split('?')[0]);
  if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const reading = findReading(m[1], m[2]);
  const listen = listenFor(reading);
  if (!listen) return false;

  let upstream;
  try {
    upstream = await fetch(listen.href, {
      method: req.method,
      headers: req.headers.range ? { Range: req.headers.range } : {},
    });
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('The recording could not be fetched just now. Try again in a moment.');
    return true;
  }

  const name = ('Module ' + reading.module + ' - ' + reading.title).replace(/["\\/]/g, '') + '.mp3';
  const headers = {
    'Content-Type': 'audio/mpeg',
    'Content-Disposition': 'attachment; filename="' + name + '"',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  const copy = { 'content-length': 'Content-Length', 'content-range': 'Content-Range', etag: 'ETag' };
  for (const [from, to] of Object.entries(copy)) {
    const v = upstream.headers.get(from);
    if (v) headers[to] = v;
  }
  res.writeHead(upstream.status, headers);
  if (req.method === 'HEAD' || !upstream.body) { res.end(); return true; }
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
  return true;
}

module.exports = { listenFor, hasListen, spokenLength, handleMbfListenRoute, MANIFEST };
