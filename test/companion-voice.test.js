const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function startMockProvider(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => handler(req, Buffer.concat(chunks), res));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function startServer(port, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        COMPANION_ACCESS_CODE: 'test-access',
        COMPANION_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key-not-used',
        OPENAI_MODEL: 'test-model-not-used',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('Server did not start'));
      }
    }, 10000);
    child.stdout.on('data', (chunk) => {
      if (!settled && chunk.toString().includes('Server running on port')) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(chunk.toString()));
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Server exited with code ' + code));
      }
    });
  });
}

test('voice routes require the access code', { timeout: 20000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {});
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const transcribe = await fetch(baseUrl + '/api/kids-on-the-bus/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: Buffer.from('not really audio'),
  });
  assert.equal(transcribe.status, 401);

  const speech = await fetch(baseUrl + '/api/kids-on-the-bus/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  });
  assert.equal(speech.status, 401);
});

test('transcription: rejects unsupported audio type and oversized uploads, never leaks the key', { timeout: 20000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {});
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const badType = await fetch(baseUrl + '/api/kids-on-the-bus/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-Companion-Access': 'test-access' },
    body: Buffer.from('not audio'),
  });
  assert.equal(badType.status, 415);
  const badTypeBody = await badType.text();
  assert.doesNotMatch(badTypeBody, /test-key-not-used/);

  const oversized = await fetch(baseUrl + '/api/kids-on-the-bus/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', 'X-Companion-Access': 'test-access' },
    body: Buffer.alloc(9 * 1024 * 1024, 1),
  });
  assert.equal(oversized.status, 413);
});

test('transcription: success round-trip reaches the transcript, failure falls back cleanly', { timeout: 20000 }, async (t) => {
  let shouldFail = false;
  const mock = await startMockProvider((req, body, res) => {
    if (shouldFail) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream failure' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: 'I noticed my chest tighten during the meeting.' }));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, { OPENAI_TRANSCRIBE_BASE_URL: mock.url });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const ok = await fetch(baseUrl + '/api/kids-on-the-bus/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', 'X-Companion-Access': 'test-access' },
    body: Buffer.from('pretend audio bytes'),
  });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control') || '', /no-store/i);
  const okBody = await ok.json();
  assert.equal(okBody.transcript, 'I noticed my chest tighten during the meeting.');

  shouldFail = true;
  const fail = await fetch(baseUrl + '/api/kids-on-the-bus/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', 'X-Companion-Access': 'test-access' },
    body: Buffer.from('pretend audio bytes'),
  });
  assert.equal(fail.status, 502);
  const failBody = await fail.json();
  assert.match(failBody.error, /try again|writing/i);
});

test('speech: returns playable audio with no-store, rejects overlong text, failure is a clean error', { timeout: 20000 }, async (t) => {
  let shouldFail = false;
  const mock = await startMockProvider((req, body, res) => {
    if (shouldFail) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream failure' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, { OPENAI_TTS_BASE_URL: mock.url });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const ok = await fetch(baseUrl + '/api/kids-on-the-bus/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'test-access' },
    body: JSON.stringify({ text: 'Good. Stay with that for a moment.' }),
  });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control') || '', /no-store/i);
  assert.match(ok.headers.get('content-type') || '', /audio\/mpeg/);
  const audioBuffer = Buffer.from(await ok.arrayBuffer());
  assert.ok(audioBuffer.length > 0);

  const tooLong = await fetch(baseUrl + '/api/kids-on-the-bus/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'test-access' },
    body: JSON.stringify({ text: 'a'.repeat(5000) }),
  });
  assert.equal(tooLong.status, 413);

  shouldFail = true;
  const fail = await fetch(baseUrl + '/api/kids-on-the-bus/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'test-access' },
    body: JSON.stringify({ text: 'Good. Stay with that for a moment.' }),
  });
  assert.equal(fail.status, 502);
});

test('the inline browser script on the page is syntactically valid', { timeout: 20000 }, async (t) => {
  // node --check on this file only validates the server-side code. The
  // entire browser-side script lives inside a template-literal string, so a
  // broken escape sequence there (as happened once) produces no server-side
  // error at all, only a silent failure in the browser. This test catches
  // that class of mistake by extracting exactly what gets served and
  // checking that a JS engine can actually parse it.
  const port = await getOpenPort();
  const child = await startServer(port, {});
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + '/reflect/kids-on-the-bus');
  const html = await page.text();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected an inline <script> block on the page');
  assert.doesNotThrow(() => new Function(match[1]), 'the served browser script must be valid JavaScript');
});

test('the written coaching page never exposes provider keys to the browser', { timeout: 20000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {});
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + '/reflect/kids-on-the-bus');
  const html = await page.text();
  assert.doesNotMatch(html, /test-key-not-used/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|ANTHROPIC_API_KEY/);
  assert.match(html, /Write<\/strong>/);
  assert.match(html, /Speak and listen<\/strong>/);
  assert.match(html, /AI-generated\. It is not Chad speaking\./);
});
