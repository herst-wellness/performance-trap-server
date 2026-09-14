const test = require('node:test');
const assert = require('node:assert');
const { Readable, Writable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const { handleOnrampJournalRoute } = require('../onramp-journal');
const { JOURNALS, allPrompts, DOCS_DIR, findJournal, journalsForWeek } = require('../onramp-journal-content');
const { dropboxPath: mbfDropboxPath } = require('../mbf-delivery');
const { findJournal: findMbfJournal } = require('../mbf-journal-content');

function markdownPromptCount(file) {
  const raw = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
  return (raw.match(/\\field(?:small|medium|large)\b/g) || []).length;
}

function storeWith(records) {
  return { load: async () => ({ version: 1, enrollments: records }) };
}

function request(method, url, headers = {}, body = null) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = {};
  for (const [k, v] of Object.entries(headers)) req.headers[k.toLowerCase()] = v;
  return req;
}

function response() {
  const chunks = [];
  const res = new Writable({
    write(chunk, enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headers = headers;
  };
  res.body = () => Buffer.concat(chunks).toString('utf8');
  res.json = () => JSON.parse(res.body() || '{}');
  return res;
}

async function call(req, helpers) {
  const res = response();
  const handled = await handleOnrampJournalRoute(req, res, helpers);
  return { handled, res };
}

test('the ten On-Ramp journals load and prompt counts match the markdown', () => {
  assert.strictEqual(JOURNALS.length, 10);
  for (const journal of JOURNALS) {
    const prefix = 'week' + journal.week + '-';
    const file = fs.readdirSync(DOCS_DIR).find((name) => name.startsWith(prefix) && name.endsWith(journal.slug + '.md'));
    assert.ok(file, 'missing markdown for ' + journal.slug);
    assert.strictEqual(allPrompts(journal).length, markdownPromptCount(file), journal.slug);
  }
  assert.ok(!findJournal(1, 'the-breath-in-ordinary-hours').listed);
  assert.ok(!findJournal(2, 'staying-in-ordinary-hours').listed);
  assert.ok(!journalsForWeek(1).some((j) => j.slug === 'the-breath-in-ordinary-hours'));
  assert.ok(journalsForWeek(1, { includeHidden: true }).some((j) => j.slug === 'the-breath-in-ordinary-hours'));
});

test('the journal page renders the access gate without leaking prompts', async () => {
  const { handled, res } = await call(request('GET', '/practice/on-ramp/week-2/journal/the-protector'));
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 200);
  const html = res.body();
  assert.match(html, /Your access code/);
  assert.match(html, /Please do not send to Chad\./);
  assert.doesNotMatch(html, /The protector might have loosened/);
});

test('content is gated by the On-Ramp store code and refuses the MBF code', async () => {
  process.env.MBF_ACCESS_CODES = 'mbf-client';
  const store = storeWith([{ code: 'chad-herst', firstName: 'Chad', lastName: 'Herst', email: 'chad@example.com' }]);
  const denied = await call(
    request('GET', '/api/on-ramp/journal/2/the-protector', { 'X-Companion-Access': 'mbf-client' }),
    { store }
  );
  assert.strictEqual(denied.res.statusCode, 401);

  const allowed = await call(
    request('GET', '/api/on-ramp/journal/2/the-protector', { 'X-Companion-Access': 'chad-herst' }),
    { store }
  );
  assert.strictEqual(allowed.res.statusCode, 200);
  assert.strictEqual(allowed.res.json().journal.title, 'The Protector');
  delete process.env.MBF_ACCESS_CODES;
});

test('the On-Ramp Dropbox path lands under the client week folder', () => {
  const saved = process.env.ONRAMP_DROPBOX_ROOT;
  process.env.ONRAMP_DROPBOX_ROOT = '/Clients/Performance Trap Practice';
  const journal = findJournal(2, 'the-protector');
  const target = mbfDropboxPath(journal, 'Chad Herst', new Date('2026-09-13T12:00:00Z'));
  assert.strictEqual(
    target,
    '/Clients/Performance Trap Practice/Chad Herst/Week 2/Week 2 - The Protector - Chad Herst.txt'
  );
  if (saved == null) delete process.env.ONRAMP_DROPBOX_ROOT;
  else process.env.ONRAMP_DROPBOX_ROOT = saved;
});

test('when the opt-out is ticked nothing is delivered', async () => {
  const store = storeWith([{ code: 'chad-herst', firstName: 'Chad', lastName: 'Herst', email: 'chad@example.com' }]);
  const savedFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ access_token: 'token' }) };
  };
  process.env.DROPBOX_APP_KEY = 'key';
  process.env.DROPBOX_APP_SECRET = 'secret';
  process.env.DROPBOX_REFRESH_TOKEN = 'refresh';
  process.env.RESEND_API_KEY = 'resend';
  process.env.MBF_REPORT_FROM = 'practice@example.com';
  process.env.MBF_REPORT_TO = 'chad@example.com';
  const result = await call(
    request(
      'POST',
      '/api/on-ramp/journal/send',
      { 'Content-Type': 'application/json', 'X-Companion-Access': 'chad-herst' },
      JSON.stringify({ week: '2', slug: 'the-protector', optOut: true, answers: { 'the-protector-1': { text: 'Private.' } } })
    ),
    { store }
  );
  assert.strictEqual(result.res.statusCode, 200);
  assert.deepStrictEqual(result.res.json(), { sent: false, optedOut: true });
  assert.strictEqual(calls.length, 0);
  global.fetch = savedFetch;
  delete process.env.DROPBOX_APP_KEY;
  delete process.env.DROPBOX_APP_SECRET;
  delete process.env.DROPBOX_REFRESH_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.MBF_REPORT_FROM;
  delete process.env.MBF_REPORT_TO;
});

test('sending uses the store record name and the shared delivery path', async () => {
  const store = storeWith([{ code: 'chad-herst', firstName: 'Chad', lastName: 'Herst', email: 'chad@example.com' }]);
  const savedFetch = global.fetch;
  const savedRoot = process.env.ONRAMP_DROPBOX_ROOT;
  process.env.ONRAMP_DROPBOX_ROOT = '/Clients/Performance Trap Practice';
  process.env.DROPBOX_APP_KEY = 'key';
  process.env.DROPBOX_APP_SECRET = 'secret';
  process.env.DROPBOX_REFRESH_TOKEN = 'refresh';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 'token' }) };
    if (url.includes('files/upload')) {
      const arg = JSON.parse(options.headers['Dropbox-API-Arg']);
      return { ok: true, json: async () => ({ path_display: arg.path }) };
    }
    return { ok: true, json: async () => ({ id: 'sent' }) };
  };
  const result = await call(
    request(
      'POST',
      '/api/on-ramp/journal/send',
      { 'Content-Type': 'application/json', 'X-Companion-Access': 'chad-herst' },
      JSON.stringify({ week: '2', slug: 'the-protector', answers: { 'the-protector-1': { text: 'A charged moment.' } } })
    ),
    { store }
  );
  assert.strictEqual(result.res.statusCode, 200);
  const upload = calls.find((c) => String(c.url).includes('files/upload'));
  const arg = JSON.parse(upload.options.headers['Dropbox-API-Arg']);
  assert.match(arg.path, /^\/Clients\/Performance Trap Practice\/Chad Herst\/Week 2\/Week 2 - The Protector - Chad Herst\.txt$/);
  global.fetch = savedFetch;
  if (savedRoot == null) delete process.env.ONRAMP_DROPBOX_ROOT;
  else process.env.ONRAMP_DROPBOX_ROOT = savedRoot;
  delete process.env.DROPBOX_APP_KEY;
  delete process.env.DROPBOX_APP_SECRET;
  delete process.env.DROPBOX_REFRESH_TOKEN;
});

test('the existing MBF Dropbox path is unchanged', () => {
  const journal = findMbfJournal(1, 'beginners-mind');
  const target = mbfDropboxPath(journal, 'Danny Lowenthal', new Date('2026-09-13T12:00:00Z'));
  assert.strictEqual(
    target,
    '/clients/Mind:Body Foundations/Danny Lowenthal/Module 1/Module 1 - Beginner’s Mind - Danny Lowenthal.txt'
  );
});
