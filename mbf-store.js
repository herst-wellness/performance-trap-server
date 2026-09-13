// Where a Mind/Body Foundations journal lives while it is being written.
//
// This is a change of promise, made deliberately on Chad's instruction
// (2026-09-13): a client's journal used to exist only in their own browser
// until they chose to send it. It now saves to Chad's own storage as they
// write, so that whatever they have done reaches him without their having
// to remember to press anything, and without him having to ask. The pages
// say so plainly. The public companion's no-storage promise is untouched;
// this applies only to the journals of paying one-to-one clients, whose
// written work Chad has always held.
//
// One small JSON document holds every in-progress journal. Six clients,
// eight modules, a handful of journals each: tens of records, not
// thousands. Same two backends as the On-Ramp store, R2 in production and
// a local file in development, and the AWS request signing is borrowed
// from there rather than written twice.
const fs = require('node:fs');
const path = require('node:path');
const { signV4 } = require('./onramp-store');

const OBJECT_KEY = 'mbf/journals.json';

function emptyDoc() {
  return { version: 1, journals: [] };
}

function normaliseDoc(parsed) {
  if (!parsed || typeof parsed !== 'object') return emptyDoc();
  const doc = { version: 1, journals: Array.isArray(parsed.journals) ? parsed.journals : [] };
  // The Dropbox connection Chad makes in his browser lives in the same
  // document. It has to survive a read, or every restart would forget it.
  if (parsed.dropbox && typeof parsed.dropbox === 'object') doc.dropbox = parsed.dropbox;
  return doc;
}

function r2Config(env) {
  const accountId = String(env.R2_ACCOUNT_ID || '');
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '');
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '');
  const bucket = String(env.R2_DATA_BUCKET || '');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = String(env.R2_ENDPOINT || 'https://' + accountId + '.r2.cloudflarestorage.com');
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

function r2Backend(cfg) {
  const objectUrl = cfg.endpoint.replace(/\/$/, '') + '/' + cfg.bucket + '/' + OBJECT_KEY;
  async function request(method, body) {
    const signed = signV4({
      method,
      url: objectUrl,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body || '',
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    });
    const headers = { ...signed.headers };
    delete headers.host;
    return fetch(objectUrl, { method, headers, body: body || undefined });
  }
  return {
    backend: 'r2',
    async load() {
      const res = await request('GET');
      if (res.status === 404) return emptyDoc();
      if (!res.ok) throw new Error('Journal store read failed: HTTP ' + res.status);
      return normaliseDoc(JSON.parse(await res.text()));
    },
    async save(doc) {
      const res = await request('PUT', JSON.stringify(doc, null, 2) + '\n');
      if (!res.ok) throw new Error('Journal store write failed: HTTP ' + res.status);
    },
  };
}

function fileBackend(filePath) {
  return {
    backend: 'file',
    filePath,
    async load() {
      try {
        return normaliseDoc(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      } catch (error) {
        if (error.code === 'ENOENT') return emptyDoc();
        throw error;
      }
    },
    async save(doc) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = filePath + '.' + process.pid + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, filePath);
    },
  };
}

function createStore(env = process.env) {
  const cfg = r2Config(env);
  const backend = cfg
    ? r2Backend(cfg)
    : fileBackend(path.resolve(String(env.MBF_DATA_FILE || path.join(__dirname, 'data', 'mbf-journals.json'))));
  let chain = Promise.resolve();
  return {
    backend: backend.backend,
    filePath: backend.filePath,
    load: () => backend.load(),
    save: (doc) => backend.save(doc),
    update(fn) {
      const run = chain.then(async () => {
        const doc = await backend.load();
        const next = (await fn(doc)) || doc;
        await backend.save(next);
        return next;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

let shared = null;
function defaultStore() {
  if (!shared) shared = createStore(process.env);
  return shared;
}

// One record per client per journal. The key is the three of them together,
// so a client working through Module 1 has three records and each is
// written to its own file in Dropbox.
function recordKey(code, moduleNumber, slug) {
  return String(code).toLowerCase().replace(/[\s_]+/g, '-') + '|' + moduleNumber + '|' + slug;
}

function findRecord(doc, code, moduleNumber, slug) {
  const key = recordKey(code, moduleNumber, slug);
  return (doc.journals || []).find((r) => r.key === key) || null;
}

function upsertRecord(doc, { code, clientName, moduleNumber, slug, answers, finished, now = new Date() }) {
  if (!Array.isArray(doc.journals)) doc.journals = [];
  let record = findRecord(doc, code, moduleNumber, slug);
  if (!record) {
    record = {
      key: recordKey(code, moduleNumber, slug),
      code: String(code).toLowerCase().replace(/[\s_]+/g, '-'),
      clientName,
      module: Number(moduleNumber),
      slug,
      startedAt: now.toISOString(),
      answers: {},
      updatedAt: null,
      finishedAt: null,
      deliveredAt: null,
      deliveredPath: null,
      deliveryProblem: null,
    };
    doc.journals.push(record);
  }
  record.clientName = clientName || record.clientName;
  if (answers) record.answers = answers;
  record.updatedAt = now.toISOString();
  if (finished) record.finishedAt = now.toISOString();
  return record;
}

// A record is ready for Dropbox when it has been written to since the last
// delivery, and either the client said they were finished or they have
// stopped typing for a while. The quiet period keeps Chad's folder from
// filling with half sentences while somebody is mid-thought.
function dueForDelivery(doc, { now = new Date(), quietMinutes = 20 } = {}) {
  const cutoff = now.getTime() - quietMinutes * 60 * 1000;
  return (doc.journals || []).filter((r) => {
    if (!r.updatedAt) return false;
    if (r.deliveredAt && r.deliveredAt >= r.updatedAt) return false;
    if (r.finishedAt && (!r.deliveredAt || r.deliveredAt < r.finishedAt)) return true;
    return new Date(r.updatedAt).getTime() <= cutoff;
  });
}

module.exports = {
  OBJECT_KEY,
  createStore,
  defaultStore,
  dueForDelivery,
  emptyDoc,
  findRecord,
  recordKey,
  upsertRecord,
};
