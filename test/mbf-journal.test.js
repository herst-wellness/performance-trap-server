// The journal pages: access, content, delivery shape. The running server is
// started the way test/mbf.test.js starts it, so these are real requests.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { handleMbfJournalRoute } = require('../mbf-journal');
const { findJournal, allPrompts } = require('../mbf-journal-content');
const {
  clientNameFromCode,
  dropboxPath,
  renderJournalText,
  answeredCount,
} = require('../mbf-delivery');

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (await handleMbfJournalRoute(req, res)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function request(server, path, options = {}) {
  const { port } = server.address();
  return fetch('http://127.0.0.1:' + port + path, options);
}

test('the journal page renders without a code and asks for one', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const response = await request(server, '/practice/mbf/module-1/journal/about-you');
  assert.strictEqual(response.status, 200);
  const html = await response.text();
  assert.match(html, /Your access code/);
  // The questions themselves must not be in the page source: the client
  // agreement in About You is that the materials are not shared.
  assert.doesNotMatch(html, /Challenge or obstacle #1/);
});

test('a journal that does not exist is not handled here', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const response = await request(server, '/practice/mbf/module-1/journal/not-a-journal');
  assert.strictEqual(response.status, 404);
});

test('content needs a valid code', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  process.env.MBF_ACCESS_CODES = 'test-client';

  const denied = await request(server, '/api/mbf/journal/1/about-you', {
    headers: { 'X-Companion-Access': 'wrong-code' },
  });
  assert.strictEqual(denied.status, 401);

  const allowed = await request(server, '/api/mbf/journal/1/about-you', {
    headers: { 'X-Companion-Access': 'Test Client' },
  });
  assert.strictEqual(allowed.status, 200);
  const data = await allowed.json();
  assert.strictEqual(data.journal.title, 'About You');
  assert.ok(allPrompts(data.journal).length > 20);
});

test('with no codes issued at all, nobody gets in', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const saved = process.env.MBF_ACCESS_CODES;
  delete process.env.MBF_ACCESS_CODES;
  delete process.env.MBF_ACCESS_CODE;
  const response = await request(server, '/api/mbf/journal/1/about-you', {
    headers: { 'X-Companion-Access': 'anything' },
  });
  assert.strictEqual(response.status, 503);
  if (saved) process.env.MBF_ACCESS_CODES = saved;
});

test('a code becomes the client folder name', () => {
  assert.strictEqual(clientNameFromCode('danny-lowenthal'), 'Danny Lowenthal');
  assert.strictEqual(clientNameFromCode('Danny Lowenthal'), 'Danny Lowenthal');
  assert.strictEqual(clientNameFromCode('ben-holland-arlen'), 'Ben Holland Arlen');
});

test('an override fixes a folder the code cannot spell', () => {
  process.env.MBF_CLIENT_NAMES = 'ben-holland-arlen=Ben Holland-Arlen';
  assert.strictEqual(clientNameFromCode('ben-holland-arlen'), 'Ben Holland-Arlen');
  delete process.env.MBF_CLIENT_NAMES;
});

test('the Dropbox path lands in the client module folder', () => {
  const journal = findJournal(1, 'beginners-mind');
  const path = dropboxPath(journal, 'Danny Lowenthal', new Date('2026-09-13T12:00:00Z'));
  assert.strictEqual(
    path,
    '/clients/Mind:Body Foundations/Danny Lowenthal/Module 1/Module 1 - Beginner’s Mind - Danny Lowenthal - 2026-09-13.txt'
  );
});

test('the written journal carries every prompt, answered or not', () => {
  const journal = findJournal(1, 'your-turning-point');
  const text = renderJournalText(
    journal,
    { 'tp-1': { text: 'Something has to change at work.' } },
    'Danny Lowenthal',
    new Date('2026-09-13T12:00:00Z')
  );
  assert.match(text, /Something has to change at work\./);
  assert.match(text, /\(not answered\)/);
  assert.match(text, /Your Turning Point/);
});

test('agreements count as answered when yes or no is chosen', () => {
  const journal = findJournal(1, 'about-you');
  const none = answeredCount(journal, {});
  assert.strictEqual(none.answered, 0);
  assert.ok(none.total > 25);
  const some = answeredCount(journal, { 'agree-human': { agree: true }, health: { text: 'six' } });
  assert.strictEqual(some.answered, 2);
  const blank = answeredCount(journal, { health: { text: '   ' } });
  assert.strictEqual(blank.answered, 0);
});

test('sending needs a code and a real journal', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  process.env.MBF_ACCESS_CODES = 'test-client';

  const denied = await request(server, '/api/mbf/journal/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'nope' },
    body: JSON.stringify({ module: '1', slug: 'about-you', answers: {} }),
  });
  assert.strictEqual(denied.status, 401);

  const wrongJournal = await request(server, '/api/mbf/journal/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'test-client' },
    body: JSON.stringify({ module: '1', slug: 'nope', answers: {} }),
  });
  assert.strictEqual(wrongJournal.status, 400);
});

test('uploading without Dropbox connected says so plainly', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  process.env.MBF_ACCESS_CODES = 'test-client';
  delete process.env.DROPBOX_REFRESH_TOKEN;
  const response = await request(server, '/api/mbf/journal/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-Companion-Access': 'test-client',
      'X-Journal-Module': '1',
      'X-Journal-Slug': 'about-you',
      'X-Journal-Filename': 'journal.pdf',
    },
    body: Buffer.from('not really a pdf'),
  });
  assert.strictEqual(response.status, 503);
  const data = await response.json();
  assert.match(data.error, /not connected yet/);
});

test('every prompt has an id and a label, and ids do not repeat', () => {
  const seen = new Set();
  for (const slug of ['about-you', 'your-turning-point', 'beginners-mind']) {
    const journal = findJournal(1, slug);
    for (const prompt of allPrompts(journal)) {
      assert.ok(prompt.id, 'a prompt is missing its id');
      assert.ok(prompt.label, 'prompt ' + prompt.id + ' is missing its label');
      assert.ok(!seen.has(prompt.id), 'duplicate prompt id ' + prompt.id);
      seen.add(prompt.id);
    }
  }
});

test('no em dash anywhere a client can read it', () => {
  const fs = require('node:fs');
  for (const file of ['mbf-journal.js', 'mbf-journal-content.js', 'mbf-journal.css', 'mbf-delivery.js']) {
    const text = fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
    assert.ok(!text.includes('—'), 'em dash found in ' + file);
  }
});
