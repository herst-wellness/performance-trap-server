// What a client says to the Foundations companion, kept.
//
// Until now the companion held a session only in the browser and said so on
// the page: nothing saved, no memory carried into the next one. That promise
// was true and it is being changed deliberately, on Chad's instruction
// (2026-09-14), for the same reason the journals changed a day earlier. A
// client's written work in a paid one-to-one programme has always been
// material Chad holds. The companion was the one place it evaporated.
//
// So a session now lands where the journals land: in Chad's own storage as it
// is written, then in the client's folder in his Dropbox. The pages say so
// plainly. Nothing here applies to the public companion, whose no-storage
// promise is untouched.
//
// Sessions live in the same JSON document as the journals, in their own array,
// because they belong to the same client and are delivered by the same ticker.
const { defaultStore } = require('./mbf-store');

function sessionKey(code, moduleNumber, startedAt) {
  return (
    String(code).toLowerCase().replace(/[\s_]+/g, '-') + '|' + moduleNumber + '|' + startedAt
  );
}

function findSession(doc, code, moduleNumber, startedAt) {
  const key = sessionKey(code, moduleNumber, startedAt);
  return (doc.companionSessions || []).find((r) => r.key === key) || null;
}

// One record per sitting. startedAt comes from the browser and stays fixed for
// the life of that sitting, so a session that runs for an hour keeps
// overwriting one record rather than leaving a trail of fragments.
function upsertSession(doc, { code, clientName, moduleNumber, startedAt, transcript, now = new Date() }) {
  if (!Array.isArray(doc.companionSessions)) doc.companionSessions = [];
  let record = findSession(doc, code, moduleNumber, startedAt);
  if (!record) {
    record = {
      key: sessionKey(code, moduleNumber, startedAt),
      code: String(code).toLowerCase().replace(/[\s_]+/g, '-'),
      clientName,
      module: Number(moduleNumber),
      startedAt,
      transcript: '',
      updatedAt: null,
      deliveredAt: null,
      deliveredPath: null,
    };
    doc.companionSessions.push(record);
  }
  record.clientName = clientName || record.clientName;
  if (typeof transcript === 'string') record.transcript = transcript;
  record.updatedAt = now.toISOString();
  return record;
}

// A sitting is ready once it has gone quiet. Somebody mid-conversation should
// not produce a file every thirty seconds, and unlike a journal there is no
// finished button to press: a companion session ends by the person stopping.
function sessionsDue(doc, { now = new Date(), quietMinutes = 20 } = {}) {
  const cutoff = now.getTime() - quietMinutes * 60 * 1000;
  return (doc.companionSessions || []).filter((r) => {
    if (!r.updatedAt || !r.transcript) return false;
    if (r.deliveredAt && r.deliveredAt >= r.updatedAt) return false;
    return new Date(r.updatedAt).getTime() <= cutoff;
  });
}

function renderSessionText(record, moduleTitle, now = new Date()) {
  const lines = [];
  lines.push('Companion session, ' + moduleTitle);
  lines.push(record.clientName || record.code);
  lines.push(new Date(record.startedAt).toLocaleString('en-US'));
  lines.push('');
  lines.push('-'.repeat(60));
  lines.push('');
  lines.push(record.transcript.trim());
  lines.push('');
  lines.push('-'.repeat(60));
  lines.push('Saved ' + now.toLocaleString('en-US') + '.');
  return lines.join('\n');
}

function save({ code, clientName, moduleNumber, startedAt, transcript, store = defaultStore() }) {
  return store.update((doc) => {
    upsertSession(doc, { code, clientName, moduleNumber, startedAt, transcript });
    return doc;
  });
}

module.exports = {
  findSession,
  renderSessionText,
  save,
  sessionKey,
  sessionsDue,
  upsertSession,
};
