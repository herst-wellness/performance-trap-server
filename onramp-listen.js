// The Performance Trap Practice readings, read aloud.
//
// Same arrangement as the Mind/Body Foundations chapters: a piece runs six or
// seven minutes to read, and a person at the end of a working day often has the
// attention for listening and not for reading, so every piece on a week page
// can be listened to instead.
//
// The voice is a computer voice, Kokoro's am_michael, the one Chad uses to read
// his own screen, and every piece says so plainly rather than letting anyone
// assume it is him. When he records a piece himself the recording replaces the
// file of the same name in the bucket and nothing in here changes.
//
// The pieces are not files on disk. They are <h3> sections inside the week
// HTML in onramp-course.js, so the address of a recording is the week number
// and a slug made from the section heading. That is why the heading is the one
// thing here that must not be edited casually: changing it changes the address
// and silently drops the audio from the page.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev';
const PREFIX = '/onramp/readings/';

function loadManifest() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'onramp-reading-audio.json'), 'utf8');
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

// "One person's story: the wound underneath" becomes
// "one-persons-story-the-wound-underneath".
function sectionSlug(heading) {
  return String(heading)
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stemFor(week, heading) {
  return 'week-' + Number(week) + '-' + sectionSlug(heading);
}

// "7 minutes" is what a person deciding whether to press play wants.
function spokenLength(totalSeconds) {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return minutes + (minutes === 1 ? ' minute' : ' minutes');
}

function listenFor(week, heading) {
  const stem = stemFor(week, heading);
  const entry = MANIFEST.chapters[stem];
  if (!entry) return null;
  return {
    stem,
    seconds: entry.seconds,
    length: spokenLength(entry.seconds),
    href: base() + PREFIX + stem + '.mp3',
    download: '/onramp-reading-audio/' + stem + '.mp3',
    computerVoice: MANIFEST.spoken_by !== 'chad',
  };
}

function hasListen(week, heading) {
  return Boolean(MANIFEST.chapters[stemFor(week, heading)]);
}

// A person listens to these on a train, which is the whole reason the audio
// exists, so the file has to come down to the device under a name that still
// means something months later.
const DOWNLOAD_ROUTE = /^\/onramp-reading-audio\/(week-\d-[a-z0-9-]+)\.mp3$/;

function titleFromStem(stem) {
  const m = /^week-(\d)-(.+)$/.exec(stem);
  if (!m) return stem;
  const words = m[2].split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return 'Week ' + m[1] + ' - ' + words;
}

async function handleOnrampListenRoute(req, res) {
  const m = DOWNLOAD_ROUTE.exec(String(req.url).split('?')[0]);
  if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const entry = MANIFEST.chapters[m[1]];
  if (!entry) return false;

  let upstream;
  try {
    upstream = await fetch(base() + PREFIX + m[1] + '.mp3', {
      method: req.method,
      headers: req.headers.range ? { Range: req.headers.range } : {},
    });
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('The recording could not be fetched just now. Try again in a moment.');
    return true;
  }

  const name = titleFromStem(m[1]).replace(/["\\/]/g, '') + '.mp3';
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

module.exports = {
  sectionSlug, stemFor, listenFor, hasListen, spokenLength,
  titleFromStem, handleOnrampListenRoute, MANIFEST,
};
