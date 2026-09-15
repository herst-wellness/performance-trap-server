// The reading pages. The chapters moved out of Dropbox, so the two things worth
// proving are that the text is behind the same code as everything else and that
// the prose survives the trip intact.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { handleMbfReadingRoute, renderMarkdown } = require('../mbf-reading');
const { READINGS, findReading, readingsForModule } = require('../mbf-reading-content');
const { audioForModule, FILES } = require('../mbf-audio');

function startServer() {
  const server = http.createServer((req, res) => {
    if (handleMbfReadingRoute(req, res)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

test('every module from 1 to 8 has its readings, and none of them is empty', () => {
  for (let m = 1; m <= 8; m += 1) {
    const readings = readingsForModule(m);
    assert.ok(readings.length > 0, `Module ${m} has no readings`);
    for (const r of readings) {
      assert.ok(r.words > 200, `${r.title} is only ${r.words} words`);
      assert.ok(r.title && !/^\d/.test(r.title), `${r.file} has no title`);
    }
  }
});

test('no two readings in a module share an address', () => {
  const seen = new Set();
  for (const r of READINGS) {
    const key = r.module + '/' + r.slug;
    assert.ok(!seen.has(key), `two readings answer to ${key}`);
    seen.add(key);
  }
});

test('the LaTeX the PDFs needed never reaches a reader', () => {
  for (const r of READINGS) {
    assert.ok(!/\\begin\{|\\field|\\newpage|tikz/i.test(r.body), `${r.title} still carries typesetting commands`);
  }
});

test('the text is behind the same code as the journals', async (t) => {
  const before = process.env.MBF_ACCESS_CODES;
  process.env.MBF_ACCESS_CODES = 'ryan-dolan';
  const server = await startServer();
  const port = server.address().port;
  t.after(() => {
    server.close();
    if (before === undefined) delete process.env.MBF_ACCESS_CODES;
    else process.env.MBF_ACCESS_CODES = before;
  });

  const page = await get(port, '/practice/mbf/module-3/reading/sankharas');
  assert.equal(page.status, 200);
  assert.ok(page.body.includes('Your access code'), 'the page should ask for a code');
  assert.ok(!page.body.includes('A sankhara is a groove'), 'the chapter text must not ship with the page');

  const denied = await get(port, '/api/mbf/reading/3/sankharas', { 'X-Companion-Access': 'wrong' });
  assert.equal(denied.status, 401);

  const allowed = await get(port, '/api/mbf/reading/3/sankharas', { 'X-Companion-Access': 'ryan-dolan' });
  assert.equal(allowed.status, 200);
  const data = JSON.parse(allowed.body);
  assert.equal(data.title, 'Sankharas');
  assert.ok(data.html.includes('groove'), 'the chapter should be in the payload');

  const missing = await get(port, '/api/mbf/reading/3/no-such-thing', { 'X-Companion-Access': 'ryan-dolan' });
  assert.equal(missing.status, 404);
});

test('a reading renders as prose: headings, quotes, lists, emphasis, links', () => {
  const html = renderMarkdown(
    '## A heading\n\nA paragraph with **bold** and *italic* and a [link](https://example.com).\n\n> A quotation.\n\n- one\n- two\n'
  );
  assert.match(html, /<h3>A heading<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<a href="https:\/\/example\.com" rel="noopener">link<\/a>/);
  assert.match(html, /<blockquote>A quotation\.<\/blockquote>/);
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
});

test('a reading cannot smuggle markup into the page', () => {
  const html = renderMarkdown('A line with <script>alert(1)</script> in it.');
  assert.ok(!html.includes('<script>'), 'raw markup must be escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('the bucket can be pointed somewhere else without touching the code', () => {
  const before = process.env.MBF_AUDIO_BASE;
  process.env.MBF_AUDIO_BASE = 'https://audio.example/';
  const live = audioForModule(3);
  assert.ok(live.length > 0);
  for (const a of live) assert.match(a.href, /^https:\/\/audio\.example\/mbf\/module-3\/[a-z0-9-]+\.mp3$/);
  assert.equal(new Set(FILES.map((f) => f.module + '/' + f.slug)).size, FILES.length, 'two recordings share an address');
  if (before === undefined) delete process.env.MBF_AUDIO_BASE;
  else process.env.MBF_AUDIO_BASE = before;
});

// The meditations are served for listening and for keeping. A client on a plane
// has no signal, so the download is not a nicety.
test('a meditation can be downloaded, under a name that means something later', async (t) => {
  const http = require('node:http');
  const { handleMbfAudioRoute, FILES } = require('../mbf-audio');
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      status: 200,
      headers: new Map([['content-length', '4']]),
      body: null,
    };
  };
  const server = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      if (await handleMbfAudioRoute(req, res)) return;
      res.writeHead(404); res.end();
    });
    s.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  t.after(() => { server.close(); global.fetch = realFetch; });

  const head = await new Promise((resolve, reject) => {
    const r = http.request({ port, path: '/mbf-audio/3/be-with.mp3', method: 'HEAD' }, (res) =>
      resolve({ status: res.statusCode, headers: res.headers }));
    r.on('error', reject); r.end();
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-disposition'], 'attachment; filename="Module 3 - Be With.mp3"');
  assert.equal(head.headers['accept-ranges'], 'bytes');
  assert.ok(calls[0].url.endsWith('/mbf/module-3/be-with.mp3'), 'it should read from the bucket');

  const missing = await new Promise((resolve, reject) => {
    const r = http.request({ port, path: '/mbf-audio/3/not-a-sit.mp3', method: 'HEAD' }, (res) =>
      resolve(res.statusCode));
    r.on('error', reject); r.end();
  });
  assert.equal(missing, 404);
  assert.ok(FILES.every((f) => f.title && f.slug), 'every recording needs a name and an address');
});

test('the meditations point at the bucket by default, so a module page never shows a dead link', () => {
  const before = process.env.MBF_AUDIO_BASE;
  delete process.env.MBF_AUDIO_BASE;
  const { audioForModule } = require('../mbf-audio');
  const live = audioForModule(8);
  assert.ok(live.length > 0, 'Module 8 should list its meditations with no configuration at all');
  for (const a of live) {
    assert.match(a.href, /^https:\/\/pub-[a-z0-9]+\.r2\.dev\/mbf\/module-8\//);
    assert.match(a.download, /^\/mbf-audio\/8\/[a-z0-9-]+\.mp3$/);
  }
  if (before !== undefined) process.env.MBF_AUDIO_BASE = before;
});
