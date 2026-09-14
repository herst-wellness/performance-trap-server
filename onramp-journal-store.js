// Where On-Ramp course journals live while people write them.
//
// This mirrors the Mind/Body Foundations journal store, but keeps its own
// storage location and object key. The record helpers are intentionally
// reused from mbf-store.js so the due/delivery semantics stay identical.
const fs = require('node:fs');
const path = require('node:path');
const { signV4 } = require('./onramp-store');
const mbf = require('./mbf-store');

const OBJECT_KEY = 'onramp/journals.json';

const {
  dueForDelivery,
  emptyDoc,
  findRecord,
  recordKey,
  upsertRecord: baseUpsertRecord,
} = mbf;

function normaliseDoc(parsed) {
  if (!parsed || typeof parsed !== 'object') return emptyDoc();
  return { version: 1, journals: Array.isArray(parsed.journals) ? parsed.journals : [] };
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
      if (!res.ok) throw new Error('On-Ramp journal store read failed: HTTP ' + res.status);
      return normaliseDoc(JSON.parse(await res.text()));
    },
    async save(doc) {
      const res = await request('PUT', JSON.stringify(doc, null, 2) + '\n');
      if (!res.ok) throw new Error('On-Ramp journal store write failed: HTTP ' + res.status);
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

function defaultFile(env) {
  if (env.ONRAMP_JOURNAL_DATA_FILE) return env.ONRAMP_JOURNAL_DATA_FILE;
  if (env.MBF_DATA_FILE) return path.join(path.dirname(path.resolve(String(env.MBF_DATA_FILE))), 'onramp-journals.json');
  return path.join(__dirname, 'data', 'onramp-journals.json');
}

function createStore(env = process.env) {
  const cfg = r2Config(env);
  const backend = cfg ? r2Backend(cfg) : fileBackend(path.resolve(String(defaultFile(env))));
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

function upsertRecord(doc, options) {
  const record = baseUpsertRecord(doc, {
    code: options.code,
    clientName: options.clientName,
    moduleNumber: options.week,
    slug: options.slug,
    answers: options.answers,
    finished: options.finished,
    now: options.now,
  });
  record.week = Number(options.week);
  delete record.module;
  if (Object.prototype.hasOwnProperty.call(options, 'optOut')) record.optOut = options.optOut === true;
  return record;
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
