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
const os = require('node:os');
const fsp = require('node:fs');
const pathMod = require('node:path');

// Every test that touches the store gets its own file, so nothing written
// by one test is visible to another and nothing lands in the repository.
function freshStoreFile() {
  const dir = fsp.mkdtempSync(pathMod.join(os.tmpdir(), 'mbf-test-'));
  return pathMod.join(dir, 'journals.json');
}

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

test('the Dropbox path lands in the client module folder, under one stable name', () => {
  const journal = findJournal(1, 'beginners-mind');
  const path = dropboxPath(journal, 'Danny Lowenthal');
  assert.strictEqual(
    path,
    '/clients/Mind:Body Foundations/Danny Lowenthal/Module 1/Module 1 - Beginner’s Mind - Danny Lowenthal.txt'
  );
  // The same client and journal must always resolve to the same file, so
  // the file is updated rather than duplicated as they write.
  assert.strictEqual(dropboxPath(journal, 'Danny Lowenthal'), path);
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
  // An unfinished journal says so, so Chad never mistakes a first pass for
  // the whole thing.
  assert.match(text, /Still being written/);
  assert.match(text, /1 of 5 answered/);
  const done = renderJournalText(journal, {}, 'Danny Lowenthal', new Date('2026-09-13T12:00:00Z'), { finished: true });
  assert.match(done, /Finished 2026-09-13/);
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

test('every prompt in every journal has an id and a label, and ids do not repeat', () => {
  const { JOURNALS } = require('../mbf-journal-content');
  const seen = new Set();
  for (const journal of JOURNALS) {
    assert.ok(journal.title, 'a journal is missing its title');
    assert.ok(journal.slug, 'a journal is missing its slug');
    assert.ok(journal.blurb, journal.slug + ' is missing its blurb');
    assert.ok(journal.sections.length, journal.slug + ' has no sections');
    for (const prompt of allPrompts(journal)) {
      assert.ok(prompt.id, 'a prompt is missing its id');
      assert.ok(prompt.label, 'prompt ' + prompt.id + ' is missing its label');
      assert.ok(!seen.has(prompt.id), 'duplicate prompt id ' + prompt.id);
      seen.add(prompt.id);
    }
  }
});

test('every journal has at least one place to write', () => {
  const { JOURNALS } = require('../mbf-journal-content');
  for (const journal of JOURNALS) {
    assert.ok(allPrompts(journal).length > 0, journal.slug + ' asks nothing');
  }
});

test('modules 2 and 3 are reachable the same way module 1 is', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  process.env.MBF_ACCESS_CODES = 'test-client';
  for (const [moduleNumber, slug] of [[2, 'kids-on-the-bus'], [3, 'formation-of-a-reaction'], [3, 'session-prep-3']]) {
    const page = await request(server, '/practice/mbf/module-' + moduleNumber + '/journal/' + slug);
    assert.strictEqual(page.status, 200, slug + ' has no page');
    const content = await request(server, '/api/mbf/journal/' + moduleNumber + '/' + slug, {
      headers: { 'X-Companion-Access': 'test-client' },
    });
    assert.strictEqual(content.status, 200, slug + ' serves no content');
  }
});

test('no em dash anywhere a client can read it', () => {
  const fs = require('node:fs');
  for (const file of ['mbf-journal.js', 'mbf-journal-content.js', 'mbf-journal.css', 'mbf-delivery.js']) {
    const text = fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
    assert.ok(!text.includes('—'), 'em dash found in ' + file);
  }
});

test('a finished journal goes to Dropbox, to the client, and as a notice to Chad', async () => {
  const { deliverJournal } = require('../mbf-delivery');
  process.env.DROPBOX_APP_KEY = 'key';
  process.env.DROPBOX_APP_SECRET = 'secret';
  process.env.DROPBOX_REFRESH_TOKEN = 'refresh';
  process.env.RESEND_API_KEY = 'resend';
  process.env.MBF_REPORT_FROM = 'practice@example.com';
  process.env.MBF_REPORT_TO = 'chad@example.com';

  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2/token')) {
      return { ok: true, json: async () => ({ access_token: 'token' }) };
    }
    if (url.includes('files/upload')) {
      const arg = JSON.parse(options.headers['Dropbox-API-Arg']);
      return { ok: true, json: async () => ({ path_display: arg.path }) };
    }
    return { ok: true, json: async () => ({ id: 'sent' }) };
  };

  const journal = findJournal(1, 'beginners-mind');
  const outcome = await deliverJournal(
    {
      code: 'danny-lowenthal',
      journal,
      answers: { 'bm-1': { text: 'The loudest story is that I am behind.' } },
      clientEmail: 'danny@example.com',
      finished: true,
      now: new Date('2026-09-13T12:00:00Z'),
    },
    fakeFetch
  );

  assert.strictEqual(outcome.clientName, 'Danny Lowenthal');
  assert.match(outcome.savedTo, /Danny Lowenthal\/Module 1\//);
  assert.strictEqual(outcome.copiedTo, 'danny@example.com');
  assert.strictEqual(outcome.notified, true);
  assert.deepStrictEqual(outcome.problems, []);

  const emails = calls.filter((c) => c.url.includes('resend')).map((c) => JSON.parse(c.options.body));
  assert.strictEqual(emails.length, 2);
  const toClient = emails.find((e) => e.to[0] === 'danny@example.com');
  const toChad = emails.find((e) => e.to[0] === 'chad@example.com');
  // The client's copy carries the writing. Chad's notice does not, because
  // the journal is already in his Dropbox.
  assert.match(toClient.text, /The loudest story is that I am behind\./);
  assert.doesNotMatch(toChad.text, /The loudest story is that I am behind\./);
  assert.match(toChad.text, /1 of 12 prompts answered/);
  assert.match(toChad.subject, /^Danny Lowenthal finished /);

  delete process.env.DROPBOX_APP_KEY;
  delete process.env.DROPBOX_APP_SECRET;
  delete process.env.DROPBOX_REFRESH_TOKEN;
  delete process.env.RESEND_API_KEY;
});

test('without Dropbox, Chad still gets the journal itself', async () => {
  const { deliverJournal } = require('../mbf-delivery');
  delete process.env.DROPBOX_REFRESH_TOKEN;
  process.env.RESEND_API_KEY = 'resend';
  process.env.MBF_REPORT_FROM = 'practice@example.com';
  process.env.MBF_REPORT_TO = 'chad@example.com';
  const sent = [];
  const fakeFetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: 'sent' }) };
  };
  const journal = findJournal(1, 'your-turning-point');
  const outcome = await deliverJournal(
    { code: 'danny-lowenthal', journal, answers: { 'tp-1': { text: 'Work has to change.' } }, clientEmail: null, finished: true },
    fakeFetch
  );
  assert.strictEqual(outcome.savedTo, null);
  assert.strictEqual(outcome.notified, true);
  assert.match(sent[0].text, /Work has to change\./);
  delete process.env.RESEND_API_KEY;
});
