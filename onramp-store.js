// Enrollment storage for The Performance Trap Practice email spine. One
// small JSON document holds every enrollment (tens of people, not
// thousands). Two backends behind one interface, { load(), save(doc),
// update(fn) }:
//
// - R2 when R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and
//   R2_DATA_BUCKET are all set. Render has no persistent disk, so this is
//   the production path. R2 speaks the S3 API; requests are signed with
//   AWS Signature Version 4 using node:crypto only (no dependency).
// - A local file otherwise (ONRAMP_DATA_FILE, default
//   data/onramp-enrollments.json), written atomically via temp + rename
//   the way kids-on-the-bus/lib/usage.js does. Dev and tests use this.
//
// update(fn) serialises read-modify-write calls in this process so two
// requests landing together cannot clobber each other's write.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OBJECT_KEY = 'onramp/enrollments.json';
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

function emptyDoc() {
  return { version: 1, enrollments: [] };
}

function normaliseDoc(parsed) {
  if (!parsed || typeof parsed !== 'object') return emptyDoc();
  return {
    version: 1,
    enrollments: Array.isArray(parsed.enrollments) ? parsed.enrollments : [],
  };
}

// ── AWS Signature Version 4 ─────────────────────────────────────
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

// RFC 3986 encoding as S3 expects it: unreserved characters stay, the
// slash between path segments stays, everything else is percent-encoded
// in upper-case hex.
function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalPath(pathname) {
  return pathname.split('/').map(encodeRfc3986).join('/') || '/';
}

function canonicalQuery(searchParams) {
  const pairs = [];
  for (const [k, v] of searchParams) pairs.push([encodeRfc3986(k), encodeRfc3986(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => k + '=' + v).join('&');
}

function amzDateString(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Signs one HTTP request. `headers` must already include host and any
// x-amz-* headers the caller wants signed; this adds x-amz-date and
// x-amz-content-sha256 when absent and returns the full header set plus
// the pieces (canonical request, string to sign) that a fixture test can
// check one by one.
function signV4({ method, url, headers = {}, body = '', accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = new Date() }) {
  const target = new URL(url);
  const payloadHash = sha256Hex(body);
  const amzDate = amzDateString(now);
  const dateStamp = amzDate.slice(0, 8);
  const signed = {};
  for (const [k, v] of Object.entries(headers)) signed[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  if (!signed.host) signed.host = target.host;
  if (!signed['x-amz-date']) signed['x-amz-date'] = amzDate;
  if (!signed['x-amz-content-sha256']) signed['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((n) => n + ':' + signed[n] + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(target.pathname),
    canonicalQuery(target.searchParams),
    canonicalHeaders,
    signedHeaders,
    signed['x-amz-content-sha256'],
  ].join('\n');
  const scope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', signed['x-amz-date'], scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization =
    'AWS4-HMAC-SHA256 Credential=' + accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  return {
    headers: { ...signed, authorization },
    canonicalRequest,
    stringToSign,
    signature,
    authorization,
  };
}

// ── R2 backend ──────────────────────────────────────────────────
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
      if (!res.ok) throw new Error('Enrollment store read failed: HTTP ' + res.status);
      return normaliseDoc(JSON.parse(await res.text()));
    },
    async save(doc) {
      const res = await request('PUT', JSON.stringify(doc, null, 2) + '\n');
      if (!res.ok) throw new Error('Enrollment store write failed: HTTP ' + res.status);
    },
  };
}

// ── File backend ────────────────────────────────────────────────
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

// ── Store ───────────────────────────────────────────────────────
function createStore(env = process.env) {
  const cfg = r2Config(env);
  const backend = cfg
    ? r2Backend(cfg)
    : fileBackend(path.resolve(String(env.ONRAMP_DATA_FILE || path.join(__dirname, 'data', 'onramp-enrollments.json'))));
  let chain = Promise.resolve();
  return {
    backend: backend.backend,
    filePath: backend.filePath,
    load: () => backend.load().then((doc) => { refreshKnownCodes(doc); return doc; }),
    save: (doc) => backend.save(doc).then((r) => { refreshKnownCodes(doc); return r; }),
    // Read, let fn change the document (mutate in place or return a new
    // one), write. Calls queue behind each other.
    update(fn) {
      const run = chain.then(async () => {
        const doc = await backend.load();
        const next = (await fn(doc)) || doc;
        await backend.save(next);
        refreshKnownCodes(next);
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

// ── Records ─────────────────────────────────────────────────────
function newRecord({ code, email, firstName, lastName = '', phone = null, timeZone = DEFAULT_TIME_ZONE, source = 'paypal', now = new Date() }) {
  return {
    id: 'enr_' + crypto.randomBytes(6).toString('hex'),
    code,
    email,
    firstName,
    lastName,
    phone: phone || null,
    timeZone,
    enrolledAt: now.toISOString(),
    source,
    sent: {},
    days: {},
    yayToken: crypto.randomBytes(16).toString('hex'),
  };
}

function findById(doc, id) {
  return doc.enrollments.find((r) => r.id === id) || null;
}

function findByCode(doc, code) {
  const wanted = String(code || '');
  return doc.enrollments.find((r) => r.code === wanted) || null;
}

function findByPhone(doc, phone) {
  const wanted = String(phone || '');
  if (!wanted) return null;
  // Latest enrollment wins if the same phone enrolled twice.
  const matches = doc.enrollments.filter((r) => r.phone === wanted);
  return matches.length ? matches[matches.length - 1] : null;
}

function dayEntry(record, date) {
  if (!record.days) record.days = {};
  if (!record.days[date]) record.days[date] = { yay: null, answeredAt: null, listens: [] };
  const entry = record.days[date];
  if (!Array.isArray(entry.listens)) entry.listens = [];
  return entry;
}

// ── Access codes from names ─────────────────────────────────────
// Chad's rule (9/10/26): the access code is the person's first and last
// name, like chad-herst. A second chad-herst becomes chad-herst-2. The
// registry below is what hasAccess() consults, refreshed on every store
// read and write, so a name code works the moment it is issued and after
// a restart as soon as the store has been read once.
const knownCodes = new Set();

function refreshKnownCodes(doc) {
  knownCodes.clear();
  for (const r of (doc && doc.enrollments) || []) if (r && r.code) knownCodes.add(String(r.code));
}

function isEnrolledCode(code) {
  const c = String(code || '');
  return c.length > 0 && knownCodes.has(c);
}

function slugPart(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nameCode(doc, firstName, lastName, taken = []) {
  const base = [slugPart(firstName), slugPart(lastName)].filter(Boolean).join('-') || 'practice-' + crypto.randomBytes(3).toString('hex');
  const used = new Set([...((doc && doc.enrollments) || []).map((r) => r.code), ...taken]);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!used.has(base + '-' + n)) return base + '-' + n;
  return base + '-' + crypto.randomBytes(3).toString('hex');
}

module.exports = {
  isEnrolledCode,
  nameCode,
  refreshKnownCodes,
  slugPart,
  DEFAULT_TIME_ZONE,
  OBJECT_KEY,
  createStore,
  dayEntry,
  defaultStore,
  emptyDoc,
  findByCode,
  findById,
  findByPhone,
  newRecord,
  signV4,
};
