// The Performance Trap Practice readings, read aloud.
//
// Same arrangement as the Mind/Body Foundations chapters: a piece runs six or
// seven minutes to read, and a person at the end of a working day often has the
// attention for listening and not for reading, so every piece on a week page
// can be listened to instead.
//
// A listener chooses the voice: Michael, the one Chad uses to read his own
// screen, or Heart. Both are computer voices and every piece says so plainly
// rather than letting anyone assume either is him. When Chad records a piece
// himself, his recording becomes a third voice in the same shape.
//
// The pieces are not files on disk. They are <h3> sections inside the week
// HTML in onramp-course.js, so the address of a recording is the week number
// and a slug made from the section heading. That is why the heading is the one
// thing here that must not be edited casually: changing it changes the address
// and silently drops the audio from the page.
const fs = require('node:fs');
const path = require('node:path');
const { pickVoice, spokenLength, voiceSelectHtml, KEYS } = require('./reading-voices');

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

// Which voices this piece has been read in, in the order reading-voices.js
// lists them.
function voicesFor(week, heading) {
  const entry = MANIFEST.chapters[stemFor(week, heading)];
  if (!entry) return [];
  return KEYS.filter((k) => entry[k]);
}

// One piece in one voice. Heart reads about a tenth quicker than Michael, so
// the length depends on the voice and is taken from the recording rather than
// estimated.
function listenFor(week, heading, wantedVoice) {
  const stem = stemFor(week, heading);
  const entry = MANIFEST.chapters[stem];
  if (!entry) return null;
  const voice = pickVoice(Object.keys(entry), wantedVoice);
  if (!voice) return null;
  const said = entry[voice];
  return {
    stem,
    voice,
    voices: voicesFor(week, heading),
    seconds: said.seconds,
    length: spokenLength(said.seconds),
    href: base() + PREFIX + voice + '/' + stem + '.mp3',
    download: '/onramp-reading-audio/' + stem + '.' + voice + '.mp3',
    computerVoice: MANIFEST.spoken_by !== 'chad',
  };
}

function hasListen(week, heading) {
  return voicesFor(week, heading).length > 0;
}

// Every voice this piece has, as the page needs it: addresses and lengths, so
// changing voice does not wait on the server.
function listenAllVoices(week, heading) {
  const out = {};
  for (const voice of voicesFor(week, heading)) {
    const one = listenFor(week, heading, voice);
    out[voice] = { href: one.href, download: one.download, length: one.length };
  }
  return out;
}

// A person listens to these on a train, which is the whole reason the audio
// exists, so the file has to come down to the device under a name that still
// means something months later.
const DOWNLOAD_ROUTE = /^\/onramp-reading-audio\/(week-\d-[a-z0-9-]+?)(?:\.([a-z]+))?\.mp3$/;

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
  const voice = pickVoice(Object.keys(entry), m[2]);
  if (!voice) return false;

  let upstream;
  try {
    upstream = await fetch(base() + PREFIX + voice + '/' + m[1] + '.mp3', {
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
  sectionSlug, stemFor, listenFor, listenAllVoices, voicesFor, hasListen,
  spokenLength, voiceSelectHtml, titleFromStem, handleOnrampListenRoute, MANIFEST,
};
