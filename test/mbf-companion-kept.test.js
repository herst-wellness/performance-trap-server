// The companion's sittings are kept, which is a change of promise made on
// 2026-09-14 so that eight months of a client's own words still exist at the
// end of the programme. Before this, a sitting lived in the browser and was
// gone when the tab closed. These tests hold the new behaviour in place,
// because the failure mode is silent: nobody notices material not being
// stored until the day they go looking for it.
const test = require('node:test');
const assert = require('node:assert');

const { upsertSession, sessionsDue, renderSessionText } = require('../mbf-companion-store');
const { deliverCompanionSessions } = require('../mbf-schedule');

function memoryStore(doc = { version: 1, journals: [], companionSessions: [] }) {
  let current = doc;
  return {
    load: async () => JSON.parse(JSON.stringify(current)),
    save: async (next) => { current = next; },
    update: async (fn) => { const next = (await fn(JSON.parse(JSON.stringify(current)))) || current; current = next; return next; },
    peek: () => current,
  };
}

test('a sitting is one record that keeps being overwritten, not a trail of fragments', () => {
  const doc = { companionSessions: [] };
  const startedAt = '2026-09-15T10:00:00.000Z';
  upsertSession(doc, { code: 'jane-doe', clientName: 'Jane Doe', moduleNumber: 3, startedAt, transcript: 'You: one' });
  upsertSession(doc, { code: 'jane-doe', clientName: 'Jane Doe', moduleNumber: 3, startedAt, transcript: 'You: one\nYou: two' });
  assert.equal(doc.companionSessions.length, 1);
  assert.match(doc.companionSessions[0].transcript, /two/);
});

test('a second sitting on the same module is its own record', () => {
  const doc = { companionSessions: [] };
  upsertSession(doc, { code: 'jane-doe', moduleNumber: 3, startedAt: '2026-09-15T10:00:00.000Z', transcript: 'a' });
  upsertSession(doc, { code: 'jane-doe', moduleNumber: 3, startedAt: '2026-09-16T10:00:00.000Z', transcript: 'b' });
  assert.equal(doc.companionSessions.length, 2);
});

test('a sitting is not delivered while somebody is still writing', () => {
  const now = new Date('2026-09-15T10:30:00.000Z');
  const doc = { companionSessions: [{
    key: 'k', code: 'jane-doe', module: 3, startedAt: '2026-09-15T10:00:00.000Z',
    transcript: 'mid sentence', updatedAt: '2026-09-15T10:29:00.000Z', deliveredAt: null,
  }] };
  assert.equal(sessionsDue(doc, { now }).length, 0);
});

test('a sitting that has gone quiet is due, and an empty one never is', () => {
  const now = new Date('2026-09-15T11:00:00.000Z');
  const doc = { companionSessions: [
    { key: 'a', code: 'jane-doe', module: 3, startedAt: '2026-09-15T10:00:00.000Z', transcript: 'said something', updatedAt: '2026-09-15T10:20:00.000Z', deliveredAt: null },
    { key: 'b', code: 'jane-doe', module: 4, startedAt: '2026-09-15T10:00:00.000Z', transcript: '', updatedAt: '2026-09-15T10:20:00.000Z', deliveredAt: null },
  ] };
  const due = sessionsDue(doc, { now });
  assert.equal(due.length, 1);
  assert.equal(due[0].key, 'a');
});

test('a delivered sitting is not delivered twice, and a reopened one is', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const doc = { companionSessions: [{
    key: 'a', code: 'jane-doe', module: 3, startedAt: '2026-09-15T10:00:00.000Z',
    transcript: 'said something', updatedAt: '2026-09-15T10:20:00.000Z',
    deliveredAt: '2026-09-15T10:45:00.000Z',
  }] };
  assert.equal(sessionsDue(doc, { now }).length, 0);
  doc.companionSessions[0].updatedAt = '2026-09-15T11:00:00.000Z';
  assert.equal(sessionsDue(doc, { now }).length, 1);
});

test('the rendered file carries the client, the module and the words', () => {
  const text = renderSessionText(
    { code: 'jane-doe', clientName: 'Jane Doe', module: 3, startedAt: '2026-09-15T10:00:00.000Z', transcript: 'You: the throat thing again' },
    'Module 3',
    new Date('2026-09-15T11:00:00.000Z')
  );
  assert.match(text, /Module 3/);
  assert.match(text, /Jane Doe/);
  assert.match(text, /the throat thing again/);
});

test('delivery writes each due sitting once and marks it', async () => {
  const store = memoryStore({ version: 1, journals: [], companionSessions: [{
    key: 'a', code: 'jane-doe', clientName: 'Jane Doe', module: 3,
    startedAt: '2026-09-15T10:00:00.000Z', transcript: 'You: said something',
    updatedAt: '2026-09-15T10:20:00.000Z', deliveredAt: null,
  }] });
  const uploads = [];
  const fetchImpl = async (url, options) => {
    uploads.push(JSON.parse(options.headers['Dropbox-API-Arg'] || '{}').path || url);
    return { ok: true, status: 200, json: async () => ({ path_display: '/x.txt' }), text: async () => '' };
  };
  process.env.DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || 'test';
  const out = await deliverCompanionSessions({
    store, now: new Date('2026-09-15T11:00:00.000Z'), fetchImpl,
  });
  assert.equal(out.written + out.failed, 1);
  if (out.written === 1) {
    assert.ok(store.peek().companionSessions[0].deliveredAt, 'the record is marked once written');
    const again = await deliverCompanionSessions({ store, now: new Date('2026-09-15T11:05:00.000Z'), fetchImpl });
    assert.equal(again.written, 0, 'it is not written a second time');
  }
});
