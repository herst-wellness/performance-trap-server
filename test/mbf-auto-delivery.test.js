// The part Chad asked for on 2026-09-13: a journal reaches him without the
// client pressing anything, and without him asking.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { handleMbfJournalRoute } = require('../mbf-journal');
const { createStore, dueForDelivery, findRecord, upsertRecord, emptyDoc } = require('../mbf-store');
const { deliverDue } = require('../mbf-schedule');
const { handleDropboxSetupRoute, exchangeCode, forgetCachedCredentials } = require('../mbf-dropbox-setup');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbf-auto-'));
  return createStore({ MBF_DATA_FILE: path.join(dir, 'journals.json') });
}

function startServer(handler) {
  const server = http.createServer(async (req, res) => {
    if (await handler(req, res)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function request(server, p, options = {}) {
  return fetch('http://127.0.0.1:' + server.address().port + p, options);
}

test('a save with no send reaches the store, and comes back on the next visit', async (t) => {
  const server = await startServer(handleMbfJournalRoute);
  t.after(() => server.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbf-auto-'));
  process.env.MBF_DATA_FILE = path.join(dir, 'journals.json');
  process.env.MBF_ACCESS_CODES = 'danny-lowenthal';

  const saved = await request(server, '/api/mbf/journal/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'danny-lowenthal' },
    body: JSON.stringify({ module: '1', slug: 'your-turning-point', answers: { 'tp-1': { text: 'Half a thought.' } } }),
  });
  assert.strictEqual(saved.status, 200);

  // What the page asks for when the client opens it again, anywhere.
  const reopened = await request(server, '/api/mbf/journal/1/your-turning-point', {
    headers: { 'X-Companion-Access': 'danny-lowenthal' },
  });
  const data = await reopened.json();
  assert.strictEqual(data.saved.answers['tp-1'].text, 'Half a thought.');
  assert.strictEqual(data.saved.finishedAt, null);
  delete process.env.MBF_DATA_FILE;
});

test('a save carrying its code in the body is accepted, because a closing tab cannot set a header', async (t) => {
  const server = await startServer(handleMbfJournalRoute);
  t.after(() => server.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbf-auto-'));
  process.env.MBF_DATA_FILE = path.join(dir, 'journals.json');
  process.env.MBF_ACCESS_CODES = 'danny-lowenthal';

  const ok = await request(server, '/api/mbf/journal/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: '1', slug: 'about-you', answers: { health: { text: 'six' } }, code: 'danny-lowenthal' }),
  });
  assert.strictEqual(ok.status, 200);

  const wrong = await request(server, '/api/mbf/journal/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: '1', slug: 'about-you', answers: {}, code: 'somebody-else' }),
  });
  assert.strictEqual(wrong.status, 401);
  delete process.env.MBF_DATA_FILE;
});

test('nothing is written out while the client is still typing', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  const doc = emptyDoc();
  upsertRecord(doc, {
    code: 'danny-lowenthal',
    clientName: 'Danny Lowenthal',
    moduleNumber: 1,
    slug: 'about-you',
    answers: { health: { text: 'six' } },
    now: new Date('2026-09-13T11:55:00Z'),
  });
  assert.strictEqual(dueForDelivery(doc, { now, quietMinutes: 20 }).length, 0);
});

test('a journal left alone for twenty minutes is written out', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  const doc = emptyDoc();
  upsertRecord(doc, {
    code: 'danny-lowenthal',
    clientName: 'Danny Lowenthal',
    moduleNumber: 1,
    slug: 'about-you',
    answers: { health: { text: 'six' } },
    now: new Date('2026-09-13T11:30:00Z'),
  });
  assert.strictEqual(dueForDelivery(doc, { now, quietMinutes: 20 }).length, 1);
});

test('finished goes out at once, without waiting for the quiet period', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  const doc = emptyDoc();
  upsertRecord(doc, {
    code: 'danny-lowenthal',
    clientName: 'Danny Lowenthal',
    moduleNumber: 1,
    slug: 'about-you',
    answers: { health: { text: 'six' } },
    finished: true,
    now: new Date('2026-09-13T11:59:00Z'),
  });
  assert.strictEqual(dueForDelivery(doc, { now, quietMinutes: 20 }).length, 1);
});

test('a journal already written out and not touched since is left alone', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  const doc = emptyDoc();
  const record = upsertRecord(doc, {
    code: 'danny-lowenthal',
    clientName: 'Danny Lowenthal',
    moduleNumber: 1,
    slug: 'about-you',
    answers: { health: { text: 'six' } },
    now: new Date('2026-09-13T11:00:00Z'),
  });
  record.deliveredAt = new Date('2026-09-13T11:05:00Z').toISOString();
  assert.strictEqual(dueForDelivery(doc, { now, quietMinutes: 20 }).length, 0);
  // One more word from the client and it is due again.
  upsertRecord(doc, {
    code: 'danny-lowenthal',
    clientName: 'Danny Lowenthal',
    moduleNumber: 1,
    slug: 'about-you',
    answers: { health: { text: 'six, and tired' } },
    now: new Date('2026-09-13T11:30:00Z'),
  });
  assert.strictEqual(dueForDelivery(doc, { now, quietMinutes: 20 }).length, 1);
});

test('the ticker writes to Dropbox and marks the record, sending no email', async () => {
  const store = freshStore();
  const now = new Date('2026-09-13T12:00:00Z');
  await store.update((doc) => {
    doc.dropbox = { appKey: 'k', appSecret: 's', refreshToken: 'r', connectedAt: now.toISOString() };
    upsertRecord(doc, {
      code: 'danny-lowenthal',
      clientName: 'Danny Lowenthal',
      moduleNumber: 1,
      slug: 'your-turning-point',
      answers: { 'tp-1': { text: 'Something has to change.' } },
      now: new Date('2026-09-13T11:20:00Z'),
    });
    return doc;
  });
  forgetCachedCredentials();

  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push(url);
    if (url.includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 't' }) };
    if (url.includes('files/upload')) {
      const arg = JSON.parse(options.headers['Dropbox-API-Arg']);
      assert.strictEqual(arg.mode, 'overwrite');
      return { ok: true, json: async () => ({ path_display: arg.path }) };
    }
    throw new Error('unexpected call to ' + url);
  };

  const { loadCredentials } = require('../mbf-dropbox-setup');
  await loadCredentials(store);

  const result = await deliverDue({ store, now, fetchImpl: fakeFetch });
  assert.strictEqual(result.written, 1);
  assert.ok(!calls.some((u) => u.includes('resend')), 'a quiet save must not email anybody');

  const doc = await store.load();
  const record = findRecord(doc, 'danny-lowenthal', 1, 'your-turning-point');
  assert.ok(record.deliveredAt);
  assert.match(record.deliveredPath, /Danny Lowenthal\/Module 1\//);
  assert.strictEqual(record.deliveryProblem, null);
  forgetCachedCredentials();
});

test('the ticker does nothing at all before Dropbox is connected', async () => {
  const store = freshStore();
  forgetCachedCredentials();
  await store.update((doc) => {
    upsertRecord(doc, {
      code: 'danny-lowenthal',
      clientName: 'Danny Lowenthal',
      moduleNumber: 1,
      slug: 'about-you',
      answers: { health: { text: 'six' } },
      now: new Date('2026-09-13T11:00:00Z'),
    });
    return doc;
  });
  const result = await deliverDue({
    store,
    now: new Date('2026-09-13T12:00:00Z'),
    fetchImpl: async () => { throw new Error('nothing should be called'); },
  });
  assert.strictEqual(result.skipped, 'dropbox-not-connected');
});

test('the connect page asks for nothing but the admin code', async (t) => {
  const store = freshStore();
  const server = await startServer((req, res) => handleDropboxSetupRoute(req, res, { store }));
  t.after(() => server.close());
  process.env.MBF_ADMIN_CODE = 'let-me-in';

  const page = await request(server, '/practice/mbf/connect-dropbox?key=app-key');
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /Your admin code/);
  // Nothing to find, copy or paste: the words that defeated Chad in the
  // first version must not be on the page.
  assert.doesNotMatch(html, /App secret/i);
  assert.doesNotMatch(html, /Redirect URIs/);

  const refused = await request(server, '/practice/mbf/connect-dropbox/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ admin: 'wrong', key: 'app-key' }).toString(),
    redirect: 'manual',
  });
  assert.strictEqual(refused.status, 401);
  delete process.env.MBF_ADMIN_CODE;
});

test('the right admin code sends Chad to Dropbox, proving itself without a secret', async (t) => {
  const store = freshStore();
  const server = await startServer((req, res) => handleDropboxSetupRoute(req, res, { store }));
  t.after(() => server.close());
  process.env.MBF_ADMIN_CODE = 'let-me-in';

  const response = await request(server, '/practice/mbf/connect-dropbox/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ admin: 'let-me-in', key: 'app-key' }).toString(),
    redirect: 'manual',
  });
  assert.strictEqual(response.status, 302);
  const location = response.headers.get('location');
  assert.match(location, /^https:\/\/www\.dropbox\.com\/oauth2\/authorize\?/);
  // offline is what makes the connection last past one sitting.
  assert.match(location, /token_access_type=offline/);
  assert.match(location, /client_id=app-key/);
  // PKCE: Dropbox gets the one-way hash, never the original.
  assert.match(location, /code_challenge_method=S256/);
  const challenge = new URL(location).searchParams.get('code_challenge');
  assert.ok(challenge && challenge.length > 20, 'no code challenge was sent');
  assert.doesNotMatch(location, /secret/i);
});

// The live server matches routes on the path alone and cuts the query
// string off req.url before any handler sees it, keeping the whole address
// on req.originalUrl. The first version of this page read req.url, found
// no key in production, and told Chad it did not know which Dropbox app to
// use even though his link carried one. This starts the server the way
// server.js does so the cut actually happens.
test('the key in the link survives the server cutting the query string off', async (t) => {
  const store = freshStore();
  const server = await startServer(async (req, res) => {
    req.originalUrl = req.url;
    req.url = req.url.split('?')[0];
    return handleDropboxSetupRoute(req, res, { store });
  });
  t.after(() => server.close());
  const saved = process.env.MBF_DROPBOX_APP_KEY;
  delete process.env.MBF_DROPBOX_APP_KEY;
  process.env.MBF_ADMIN_CODE = 'let-me-in';
  forgetCachedCredentials();

  const page = await request(server, '/practice/mbf/connect-dropbox?key=link-carried-key');
  const html = await page.text();
  assert.match(html, /name="key" value="link-carried-key"/, 'the key from the link did not reach the form');
  assert.doesNotMatch(html, /does not know which Dropbox app/);

  // With nothing to go on, it should still say so rather than guess.
  const bare = await request(server, '/practice/mbf/connect-dropbox');
  assert.match(await bare.text(), /does not know which Dropbox app/);

  if (saved) process.env.MBF_DROPBOX_APP_KEY = saved;
  delete process.env.MBF_ADMIN_CODE;
});

test('the app key is remembered, so a later visit needs no link', async (t) => {
  const store = freshStore();
  const server = await startServer((req, res) => handleDropboxSetupRoute(req, res, { store }));
  t.after(() => server.close());
  await store.update((doc) => {
    doc.dropbox = { appKey: 'remembered-key', refreshToken: 'r', connectedAt: '2026-09-13T00:00:00Z' };
    return doc;
  });
  forgetCachedCredentials();
  const page = await request(server, '/practice/mbf/connect-dropbox');
  const html = await page.text();
  assert.match(html, /remembered-key/);
  assert.match(html, /already connected/);
  forgetCachedCredentials();
});

test('the approval is traded for a lasting key by producing the original string', async () => {
  let sent = null;
  const token = await exchangeCode(
    { code: 'approval', appKey: 'k', verifier: 'the-original-string', redirectUri: 'https://example.com/done' },
    async (url, options) => {
      sent = options;
      assert.strictEqual(url, 'https://api.dropbox.com/oauth2/token');
      assert.match(options.body, /grant_type=authorization_code/);
      assert.match(options.body, /code_verifier=the-original-string/);
      assert.match(options.body, /client_id=k/);
      return { ok: true, json: async () => ({ refresh_token: 'lasting-key', access_token: 'short' }) };
    }
  );
  assert.strictEqual(token, 'lasting-key');
  // No Basic authorization header, because there is no secret to put in one.
  assert.ok(!sent.headers.Authorization, 'a secret was sent after all');
});

test('a refused approval does not save anything', async () => {
  await assert.rejects(
    exchangeCode(
      { code: 'bad', appKey: 'k', verifier: 'v', redirectUri: 'https://example.com/done' },
      async () => ({ ok: false, json: async () => ({}) })
    ),
    /would not complete/
  );
});

test('renewing access on a PKCE connection sends the app key, not a secret', async () => {
  const store = freshStore();
  await store.update((doc) => {
    doc.dropbox = { appKey: 'app-key', refreshToken: 'lasting-key', connectedAt: '2026-09-13T00:00:00Z' };
    return doc;
  });
  forgetCachedCredentials();
  const { loadCredentials } = require('../mbf-dropbox-setup');
  await loadCredentials(store);

  const { uploadBytesToDropbox } = require('../mbf-delivery');
  let tokenCall = null;
  await uploadBytesToDropbox('/somewhere/file.txt', Buffer.from('hello'), async (url, options) => {
    if (url.includes('oauth2/token')) {
      tokenCall = options;
      return { ok: true, json: async () => ({ access_token: 'short' }) };
    }
    return { ok: true, json: async () => ({ path_display: '/somewhere/file.txt' }) };
  });
  assert.ok(!tokenCall.headers.Authorization, 'a Basic secret was sent');
  assert.match(tokenCall.body, /client_id=app-key/);
  assert.match(tokenCall.body, /grant_type=refresh_token/);
  forgetCachedCredentials();
});
