const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { handleOnrampJournalRoute } = require('../onramp-journal');
const enrollmentStore = require('../onramp-store');
const journalStore = require('../onramp-journal-store');
const mbfStore = require('../mbf-store');
const mbfSchedule = require('../mbf-schedule');
const { deliverDue } = require('../onramp-journal-schedule');

function tempFile(prefix, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, name);
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

async function stores() {
  const enrollments = enrollmentStore.createStore({ ONRAMP_DATA_FILE: tempFile('onramp-enroll-', 'enrollments.json') });
  const journals = journalStore.createStore({ ONRAMP_JOURNAL_DATA_FILE: tempFile('onramp-journals-', 'journals.json') });
  const record = enrollmentStore.newRecord({
    code: 'chad-herst',
    email: 'chad@example.com',
    firstName: 'Chad',
    lastName: 'Herst',
    now: new Date('2026-09-13T10:00:00Z'),
  });
  await enrollments.update((doc) => {
    doc.enrollments.push(record);
    return doc;
  });
  return { enrollments, journals };
}

function setDropboxEnv(t) {
  const saved = {
    DROPBOX_APP_KEY: process.env.DROPBOX_APP_KEY,
    DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET,
    DROPBOX_REFRESH_TOKEN: process.env.DROPBOX_REFRESH_TOKEN,
    MBF_REPORT_TO: process.env.MBF_REPORT_TO,
    COMPANION_REPORT_TO: process.env.COMPANION_REPORT_TO,
  };
  process.env.DROPBOX_APP_KEY = 'key';
  process.env.DROPBOX_APP_SECRET = 'secret';
  process.env.DROPBOX_REFRESH_TOKEN = 'refresh';
  delete process.env.MBF_REPORT_TO;
  delete process.env.COMPANION_REPORT_TO;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fakeDropbox(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 'token' }) };
    if (String(url).includes('files/upload')) {
      const arg = JSON.parse(options.headers['Dropbox-API-Arg']);
      assert.strictEqual(arg.mode, 'overwrite');
      return { ok: true, json: async () => ({ path_display: arg.path }) };
    }
    throw new Error('unexpected call to ' + url);
  };
}

test('a save lands in the On-Ramp journal store', async () => {
  const { enrollments, journals } = await stores();
  const result = await call(
    request(
      'POST',
      '/api/on-ramp/journal/save',
      { 'Content-Type': 'application/json', 'X-Companion-Access': 'chad-herst' },
      JSON.stringify({ week: '2', slug: 'the-protector', answers: { 'the-protector-1': { text: 'A charged moment.' } } })
    ),
    { store: enrollments, journalStore: journals }
  );
  assert.strictEqual(result.res.statusCode, 200);
  const doc = await journals.load();
  const record = journalStore.findRecord(doc, 'chad-herst', 2, 'the-protector');
  assert.strictEqual(record.clientName, 'Chad Herst');
  assert.strictEqual(record.answers['the-protector-1'].text, 'A charged moment.');
});

test('a journal quiet for twenty minutes is delivered by the ticker', async (t) => {
  setDropboxEnv(t);
  const journals = journalStore.createStore({ ONRAMP_JOURNAL_DATA_FILE: tempFile('onramp-journals-', 'journals.json') });
  await journals.update((doc) => {
    journalStore.upsertRecord(doc, {
      code: 'chad-herst',
      clientName: 'Chad Herst',
      week: 2,
      slug: 'the-protector',
      answers: { 'the-protector-1': { text: 'A charged moment.' } },
      now: new Date('2026-09-13T11:30:00Z'),
    });
    return doc;
  });
  const calls = [];
  const result = await deliverDue({ store: journals, now: new Date('2026-09-13T12:00:00Z'), fetchImpl: fakeDropbox(calls) });
  assert.strictEqual(result.written, 1);
  assert.ok(calls.some((c) => String(c.url).includes('files/upload')));
  const record = journalStore.findRecord(await journals.load(), 'chad-herst', 2, 'the-protector');
  assert.ok(record.deliveredAt);
  assert.match(record.deliveredPath, /Chad Herst\/Week 2\//);
});

test('a journal touched two minutes ago is not delivered', async (t) => {
  setDropboxEnv(t);
  const journals = journalStore.createStore({ ONRAMP_JOURNAL_DATA_FILE: tempFile('onramp-journals-', 'journals.json') });
  await journals.update((doc) => {
    journalStore.upsertRecord(doc, {
      code: 'chad-herst',
      clientName: 'Chad Herst',
      week: 2,
      slug: 'the-protector',
      answers: { 'the-protector-1': { text: 'Still typing.' } },
      now: new Date('2026-09-13T11:58:00Z'),
    });
    return doc;
  });
  const calls = [];
  const result = await deliverDue({ store: journals, now: new Date('2026-09-13T12:00:00Z'), fetchImpl: fakeDropbox(calls) });
  assert.strictEqual(result.written, 0);
  assert.strictEqual(calls.length, 0);
});

test('an opted-out journal is never delivered even when otherwise due', async (t) => {
  setDropboxEnv(t);
  const journals = journalStore.createStore({ ONRAMP_JOURNAL_DATA_FILE: tempFile('onramp-journals-', 'journals.json') });
  await journals.update((doc) => {
    journalStore.upsertRecord(doc, {
      code: 'chad-herst',
      clientName: 'Chad Herst',
      week: 2,
      slug: 'the-protector',
      answers: { 'the-protector-1': { text: 'Private.' } },
      optOut: true,
      now: new Date('2026-09-13T11:00:00Z'),
    });
    return doc;
  });
  const calls = [];
  const result = await deliverDue({ store: journals, now: new Date('2026-09-13T12:00:00Z'), fetchImpl: fakeDropbox(calls) });
  assert.strictEqual(result.written, 0);
  assert.strictEqual(calls.length, 0);
  const record = journalStore.findRecord(await journals.load(), 'chad-herst', 2, 'the-protector');
  assert.strictEqual(record.deliveredAt, null);
});

test('pressing send delivers immediately and marks the journal finished', async (t) => {
  setDropboxEnv(t);
  const savedFetch = global.fetch;
  const calls = [];
  global.fetch = fakeDropbox(calls);
  t.after(() => {
    global.fetch = savedFetch;
  });
  const { enrollments, journals } = await stores();
  const result = await call(
    request(
      'POST',
      '/api/on-ramp/journal/send',
      { 'Content-Type': 'application/json', 'X-Companion-Access': 'chad-herst' },
      JSON.stringify({ week: '2', slug: 'the-protector', answers: { 'the-protector-1': { text: 'Done.' } } })
    ),
    { store: enrollments, journalStore: journals }
  );
  assert.strictEqual(result.res.statusCode, 200);
  assert.strictEqual(result.res.json().sent, true);
  const record = journalStore.findRecord(await journals.load(), 'chad-herst', 2, 'the-protector');
  assert.ok(record.finishedAt);
  assert.ok(record.deliveredAt);
  assert.ok(calls.some((c) => String(c.url).includes('files/upload')));
});

test('the MBF store and schedule are untouched by On-Ramp journal storage', async () => {
  const mbfFile = tempFile('mbf-journals-', 'mbf.json');
  const onramp = journalStore.createStore({ MBF_DATA_FILE: mbfFile });
  const mbf = mbfStore.createStore({ MBF_DATA_FILE: mbfFile });
  await onramp.update((doc) => {
    journalStore.upsertRecord(doc, {
      code: 'chad-herst',
      clientName: 'Chad Herst',
      week: 1,
      slug: 'whats-bringing-you-here',
      answers: { 'whats-bringing-you-here-1': { text: 'Here.' } },
      now: new Date('2026-09-13T11:00:00Z'),
    });
    return doc;
  });
  assert.strictEqual(path.basename(onramp.filePath), 'onramp-journals.json');
  assert.strictEqual((await mbf.load()).journals.length, 0);
  assert.strictEqual(mbfSchedule.QUIET_MINUTES, 20);
  assert.strictEqual(mbfStore.OBJECT_KEY, 'mbf/journals.json');
});
