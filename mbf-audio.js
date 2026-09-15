// The Mind/Body Foundations meditations.
//
// The recordings used to live in a Dropbox folder per module, which is why the
// chapters referenced twenty-one of them by folder path and why several of those
// paths had gone dead. They are served from object storage now, so a client has
// one address for the whole programme.
//
// The recordings were mastered to ACX before upload on 2026-09-14. Across the
// twenty-one, whole-file RMS ran from -19 to -55 dBFS, so a client moving from
// one module to the next had to keep reaching for the volume. They now sit
// between -23 and -18 with peaks under -3 and a noise floor under -60, which is
// the ACX window, and they are all 192 kbps mono at 44.1 kHz.
//
// The bucket is the same one the audiobook and book-bonus pages use.
// MBF_AUDIO_BASE overrides it; there is no case where a module page should show
// links that 404, so the default is the real bucket rather than nothing.
const FILES = [
  { module: 2, slug: "aware-15-minutes", title: "Aware (15 minutes)", note: "The daily sit." },
  { module: 2, slug: "aware-20-minutes", title: "Aware (20 minutes)", note: "The daily sit." },
  { module: 2, slug: "aware-30-minutes", title: "Aware (30 minutes)", note: "The daily sit." },
  { module: 2, slug: "intro-to-aware", title: "Intro to Aware", note: "Start here, the once." },
  { module: 3, slug: "be-with", title: "Be With", note: "The daily sit." },
  { module: 3, slug: "be-with-2", title: "Be With #2", note: "The daily sit." },
  { module: 4, slug: "intro-to-equanimous", title: "Intro to Equanimous", note: "Start here, the once." },
  { module: 4, slug: "equanimous-30-minutes-1", title: "Equanimous (30 minutes), first", note: "The daily sit." },
  { module: 4, slug: "equanimous-30-minutes-2", title: "Equanimous (30 minutes), second", note: "The daily sit." },
  { module: 5, slug: "compassion-30-minutes-a", title: "Compassion 30 Minutes a", note: "The daily sit." },
  { module: 5, slug: "compassion-30-minutes-b", title: "Compassion 30 Minutes b", note: "The daily sit." },
  { module: 5, slug: "intro-to-compassion", title: "Intro to Compassion", note: "Start here, the once." },
  { module: 6, slug: "intro-to-module-6", title: "Intro to Module 6", note: "Start here, the once." },
  { module: 6, slug: "gratitude", title: "Gratitude", note: "The daily sit." },
  { module: 6, slug: "gratitude-choice-commitment-30-min-detailed", title: "Gratitude-Choice-Commitment (30 min) detailed", note: "The daily sit." },
  { module: 6, slug: "gratitude-choice-commitment-30-min", title: "Gratitude-Choice-Commitment (30 min)", note: "The daily sit." },
  { module: 7, slug: "conscious-choice-30-minutes", title: "Conscious Choice (30 minutes)", note: "The daily sit." },
  { module: 7, slug: "gratitude-choice-commitment", title: "Gratitude-Choice-Commitment", note: "The daily sit." },
  { module: 8, slug: "daily-meditation-15-minutes", title: "Daily Meditation (15 minutes)", note: "The daily sit." },
  { module: 8, slug: "daily-meditation-30-minutes", title: "Daily Meditation (30 Minutes)", note: "The daily sit." },
  { module: 8, slug: "loving-kindness-16-minutes", title: "Loving-Kindness (16 minutes)", note: "The daily sit." },
];

const DEFAULT_BASE = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev';

function base() {
  const set = String(process.env.MBF_AUDIO_BASE || '').trim();
  return (set || DEFAULT_BASE).replace(/\/+$/, '');
}

// A client who is travelling wants the file on the phone, not a stream. The
// bucket serves the bytes; this route adds the one header that makes a browser
// save it under a name the person will recognise six months later.
const DOWNLOAD_ROUTE = /^\/mbf-audio\/(\d)\/([a-z0-9-]+)\.mp3$/;

function findFile(moduleNumber, slug) {
  return FILES.find((f) => f.module === Number(moduleNumber) && f.slug === slug) || null;
}

async function handleMbfAudioRoute(req, res) {
  const m = DOWNLOAD_ROUTE.exec(String(req.url).split('?')[0]);
  if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const file = findFile(m[1], m[2]);
  if (!file) return false;
  const url = base() + '/mbf/module-' + file.module + '/' + file.slug + '.mp3';
  let upstream;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers: req.headers.range ? { Range: req.headers.range } : {},
    });
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('The recording could not be fetched just now. Try again in a moment.');
    return true;
  }
  const name = ('Module ' + file.module + ' - ' + file.title).replace(/["\\]/g, '') + '.mp3';
  const headers = {
    'Content-Type': 'audio/mpeg',
    'Content-Disposition': 'attachment; filename="' + name + '"',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };
  for (const h of ['content-length', 'content-range', 'etag']) {
    const v = upstream.headers.get(h);
    if (v) headers[h === 'content-range' ? 'Content-Range' : h === 'etag' ? 'ETag' : 'Content-Length'] = v;
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

function audioForModule(moduleNumber) {
  const root = base();
  if (!root) return [];
  return FILES.filter((f) => f.module === Number(moduleNumber)).map((f) => ({
    title: f.title,
    note: f.note,
    href: root + '/mbf/module-' + f.module + '/' + f.slug + '.mp3',
    download: '/mbf-audio/' + f.module + '/' + f.slug + '.mp3',
  }));
}

module.exports = { FILES, audioForModule, handleMbfAudioRoute };
