// The Performance Trap Practice email spine: enrollment capture with the
// buyer's details, the JSON enrollment store (file backend here, R2 signer
// checked against a published known answer), the day-by-day schedule in
// the enrollee's own time zone, the one-tap yay/nay links, listen
// tracking from the lesson pages, and the ticker that sends what is due.
// Resend is pointed at a local stub through RESEND_API_BASE_URL; nothing
// here reaches a real mail, PayPal, Mailchimp or Twilio service.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const store = require('../onramp-store.js');
const schedule = require('../onramp-schedule.js');
const yaynay = require('../onramp-yaynay.js');
const emails = require('../onramp-emails.js');
const { normalisePhone, validateEnrollment } = require('../onramp-course.js');

function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function startServer(port, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        COMPANION_ACCESS_CODE: 'test-access',
        COMPANION_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key-not-used',
        OPENAI_MODEL: 'test-model-not-used',
        MAILCHIMP_API_KEY: '',
        ONRAMP_EMAIL_SPINE: '',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill(); reject(new Error('Server did not start')); }
    }, 10000);
    child.stdout.on('data', (chunk) => {
      if (!settled && chunk.toString().includes('Server running on port')) { settled = true; clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', (chunk) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(chunk.toString())); }
    });
    child.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Server exited with code ' + code)); }
    });
  });
}

// A stand-in for Resend that remembers every message it was asked to send.
async function startResendStub(t) {
  const sent = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      sent.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 'stub-' + sent.length }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { url: 'http://127.0.0.1:' + server.address().port, sent };
}

async function startPaypalMock(t) {
  const calls = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/oauth2/token') res.end(JSON.stringify({ access_token: 'mock-token' }));
      else if (req.url === '/v2/checkout/orders') res.end(JSON.stringify({ id: 'ORDER-9' }));
      else if (req.url === '/v2/checkout/orders/ORDER-9/capture') {
        res.end(JSON.stringify({
          status: 'COMPLETED',
          purchase_units: [{ payments: { captures: [{ status: 'COMPLETED', amount: { currency_code: 'USD', value: '299.00' } }] } }],
        }));
      } else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { url: 'http://127.0.0.1:' + server.address().port, calls };
}

async function tempDataFile(t, name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'onramp-spine-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, name || 'enrollments.json');
}

async function readDoc(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function postJson(url, body, headers) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) });
}

// ── Store ───────────────────────────────────────────────────────
test('store: the file backend round-trips, starts empty, and update() calls queue and merge', async (t) => {
  const file = await tempDataFile(t);
  const s = store.createStore({ ONRAMP_DATA_FILE: file });
  assert.equal(s.backend, 'file');
  assert.deepEqual(await s.load(), { version: 1, enrollments: [] });

  const a = store.newRecord({ code: 'mb-a', email: 'a@example.com', firstName: 'A', timeZone: 'America/New_York' });
  const b = store.newRecord({ code: 'mb-b', email: 'b@example.com', firstName: 'B', phone: '+14155550100' });
  await Promise.all([
    s.update((doc) => { doc.enrollments.push(a); }),
    s.update((doc) => { doc.enrollments.push(b); }),
  ]);
  const doc = await s.load();
  assert.equal(doc.enrollments.length, 2, 'two concurrent updates both land');
  assert.equal(store.findByCode(doc, 'mb-a').id, a.id);
  assert.equal(store.findByPhone(doc, '+14155550100').id, b.id);
  assert.equal(store.findById(doc, 'nope'), null);
  assert.match(a.id, /^enr_[a-f0-9]{12}$/);
  assert.equal(a.yayToken.length, 32);
  assert.equal(b.timeZone, 'America/Los_Angeles');
  const written = await fs.readFile(file, 'utf8');
  assert.ok(written.endsWith('\n'));
  const leftovers = (await fs.readdir(path.dirname(file))).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'atomic write leaves no temp file behind');
});

test('store: the SigV4 signer reproduces the AWS published GET Object signature and signs an R2 request', () => {
  // Amazon's worked example (Signature Version 4 examples, GET Object):
  // GET /test.txt from examplebucket with a Range header, at
  // 20130524T000000Z, us-east-1/s3. The signature is published.
  const aws = store.signV4({
    method: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { range: 'bytes=0-9' },
    body: '',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 's3',
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(aws.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(
    aws.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
  );

  // The R2 shape: region auto, service s3, a PUT with a JSON body, host
  // and both x-amz headers signed. Checked against an independent
  // computation of the documented algorithm.
  const body = '{"version":1,"enrollments":[]}\n';
  const now = new Date('2026-09-10T15:04:05Z');
  const url = 'https://abc123.r2.cloudflarestorage.com/performance-trap-data/onramp/enrollments.json';
  const r2 = store.signV4({ method: 'PUT', url, headers: { 'content-type': 'application/json' }, body, accessKeyId: 'r2key', secretAccessKey: 'r2secret', now });
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = [
    'PUT',
    '/performance-trap-data/onramp/enrollments.json',
    '',
    'content-type:application/json',
    'host:abc123.r2.cloudflarestorage.com',
    'x-amz-content-sha256:' + payloadHash,
    'x-amz-date:20260910T150405Z',
    '',
    'content-type;host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', '20260910T150405Z', '20260910/auto/s3/aws4_request', crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const kSigning = h(h(h(h('AWS4r2secret', '20260910'), 'auto'), 's3'), 'aws4_request');
  const expected = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  assert.equal(r2.canonicalRequest, canonical);
  assert.equal(r2.stringToSign, stringToSign);
  assert.equal(r2.signature, expected);
  assert.equal(r2.headers['x-amz-content-sha256'], payloadHash);
  assert.equal(r2.headers['x-amz-date'], '20260910T150405Z');
  assert.equal(r2.headers.host, 'abc123.r2.cloudflarestorage.com');
  assert.match(r2.headers.authorization, /^AWS4-HMAC-SHA256 Credential=r2key\/20260910\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);

  // R2 is chosen only when all four variables are present.
  assert.equal(store.createStore({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_DATA_BUCKET: 'b' }).backend, 'r2');
  assert.equal(store.createStore({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }).backend, 'file');
});

// ── Schedule ────────────────────────────────────────────────────
test('schedule: due items follow the enrollee day by day in their own time zone and never repeat', () => {
  // Enrolled at 8:00 pm Pacific on Sept 10, 2026 (03:00Z on the 11th).
  const record = store.newRecord({ code: 'mb-x', email: 'x@example.com', firstName: 'X', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  const keys = (items) => items.map((i) => i.key);
  assert.deepEqual(keys(schedule.dueItems(record, new Date('2026-09-11T03:00:00Z'))), ['enroll']);

  record.sent.enroll = '2026-09-11T03:00:05Z';
  assert.deepEqual(keys(schedule.dueItems(record, new Date('2026-09-11T03:01:00Z'))), [], 'nothing is returned twice');

  // No daily ask any more: day 1 morning is quiet.
  assert.deepEqual(keys(schedule.dueItems(record, new Date('2026-09-11T14:30:00Z'))), []);

  // Day 7 at 5:59 pm local: not yet. 6 pm local (01:00Z on the 18th): the first scorecard.
  assert.deepEqual(keys(schedule.dueItems(record, new Date('2026-09-18T00:59:00Z'))), []);
  const day7 = schedule.dueItems(record, new Date('2026-09-18T01:00:00Z'));
  assert.deepEqual(keys(day7), ['scorecard-1']);
  assert.equal(day7[0].kind, 'email');
  assert.equal(day7[0].week, 1);
  record.sent['scorecard-1'] = 'x';

  // Day 8, 7:00 local: week-2 opens.
  assert.deepEqual(keys(schedule.dueItems(record, new Date('2026-09-18T13:59:00Z'))), []);
  const day8 = schedule.dueItems(record, new Date('2026-09-18T14:00:00Z'));
  assert.deepEqual(keys(day8), ['week-2']);
  assert.equal(day8[0].kind, 'email');
  assert.equal(day8[0].week, 2);
  record.sent['week-2'] = 'x';
  assert.deepEqual(keys(schedule.dueItems(record, new Date('2026-09-18T14:30:00Z'))), []);

  // The whole run, in order, ends with closing on day 29 at 7:00 local.
  const all = schedule.scheduleFor(record);
  assert.equal(all.length, 1 + 4 + 3 + 1);
  assert.deepEqual(keys(all), ['enroll', 'scorecard-1', 'week-2', 'scorecard-2', 'week-3', 'scorecard-3', 'week-4', 'scorecard-4', 'closing']);
  assert.equal(all[all.length - 1].at.toISOString(), '2026-10-09T14:00:00.000Z');
  assert.equal(all.find((i) => i.key === 'scorecard-4').at.toISOString(), '2026-10-09T01:00:00.000Z');
  assert.equal(all.find((i) => i.key === 'week-4').at.toISOString(), '2026-10-02T14:00:00.000Z');

  // Time zone respected: an Eastern enrollee at 04:00 Pacific on day 8
  // (07:00 Eastern) gets Week 2; a Pacific enrollee at the same instant does not.
  const eastern = store.newRecord({ code: 'mb-e', email: 'e@example.com', firstName: 'E', timeZone: 'America/New_York', now: new Date('2026-09-10T16:00:00Z') });
  const pacific = store.newRecord({ code: 'mb-p', email: 'p@example.com', firstName: 'P', timeZone: 'America/Los_Angeles', now: new Date('2026-09-10T16:00:00Z') });
  for (const r of [eastern, pacific]) { r.sent.enroll = 'x'; r.sent['scorecard-1'] = 'x'; }
  const instant = new Date('2026-09-18T11:00:00Z');
  assert.deepEqual(keys(schedule.dueItems(eastern, instant)), ['week-2']);
  assert.deepEqual(keys(schedule.dueItems(pacific, instant)), []);

  // Daylight saving: a 7:00 local send stays 7:00 local across the change.
  const dst = store.newRecord({ code: 'mb-d', email: 'd@example.com', firstName: 'D', timeZone: 'America/Los_Angeles', now: new Date('2026-10-25T20:00:00Z') });
  const items = schedule.scheduleFor(dst);
  assert.equal(items.find((i) => i.key === 'week-2').at.toISOString(), '2026-11-02T15:00:00.000Z');
  assert.equal(items.find((i) => i.key === 'scorecard-1').at.toISOString(), '2026-11-02T02:00:00.000Z');

  assert.equal(schedule.normaliseTimeZone('Not/AZone'), 'America/Los_Angeles');
  assert.equal(schedule.normaliseTimeZone('Europe/London'), 'Europe/London');
});

// ── Yay/nay links, scorecard, phone and enrollment validation ───
test('yay/nay: links carry a per-person token, answers record last-wins, and the scorecard is just data', () => {
  const record = store.newRecord({ code: 'mb-y', email: 'y@example.com', firstName: 'Y', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  const links = yaynay.yayLinks(record, '2026-09-10', 'https://practice.herstwellness.com');
  assert.match(links.yay, new RegExp('^https://practice\\.herstwellness\\.com/course/on-ramp/y/' + record.id + '/[a-f0-9]{24}/2026-09-10/yay$'));
  assert.equal(links.nay, links.yay.replace(/yay$/, 'nay'));
  const other = store.newRecord({ code: 'mb-z', email: 'z@example.com', firstName: 'Z' });
  other.id = record.id;
  assert.notEqual(yaynay.linkToken(other, '2026-09-10'), yaynay.linkToken(record, '2026-09-10'), 'the token depends on the private yayToken');
  assert.notEqual(yaynay.linkToken(record, '2026-09-11'), yaynay.linkToken(record, '2026-09-10'), 'and on the date');

  yaynay.recordAnswer(record, '2026-09-10', true, new Date('2026-09-11T14:31:00Z'));
  yaynay.recordAnswer(record, '2026-09-10', false, new Date('2026-09-11T14:32:00Z'));
  assert.equal(record.days['2026-09-10'].yay, false, 'last answer wins');
  for (const [d, yay] of [['2026-09-11', true], ['2026-09-12', true], ['2026-09-13', true], ['2026-09-14', false], ['2026-09-15', true]]) yaynay.recordAnswer(record, d, yay);
  store.dayEntry(record, '2026-09-12').listens.push({ sit: 'onramp-breath-12min', at: 'x', complete: true }, { sit: 'onramp-breath-12min', at: 'x', complete: false });
  store.dayEntry(record, '2026-09-20').listens.push({ sit: 'onramp-week2-keeping-it-company', at: 'x', complete: true });
  yaynay.recordAnswer(record, '2026-09-20', true);
  record.journals = { 'week-1/whats-bringing-you-here': { opened: 'x', done: 'x' }, 'week-1/the-breath-in-ordinary-hours': { opened: 'x' }, 'week-2/the-protector': { done: 'x' } };
  store.dayEntry(record, '2026-09-13').listens.push({ sit: 'onramp-breath-12min', at: 'x', complete: true });
  const week1 = yaynay.scorecard(record, 1);
  assert.deepEqual(
    { daysSat: week1.daysSat, sitsStarted: week1.sitsStarted, sitsCompleted: week1.sitsCompleted, journalsDone: week1.journalsDone, journalsOpened: week1.journalsOpened, longestRun: week1.longestRun, totalDaysSat: week1.totalDaysSat },
    { daysSat: 2, sitsStarted: 1, sitsCompleted: 2, journalsDone: 1, journalsOpened: 2, longestRun: 2, totalDaysSat: 3 },
    'a day counts as sat when a recording played most of the way through; answers to the old daily ask do not count'
  );
  assert.deepEqual(week1.dates, ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']);
  const week2 = yaynay.scorecard(record, 2);
  assert.equal(week2.daysSat, 1);
  assert.equal(week2.sitsCompleted, 1);
  assert.equal(week2.journalsDone, 1);

  // Inbound text parsing and the day it lands on.
  assert.equal(yaynay.parseAnswer('Yay!'), true);
  assert.equal(yaynay.parseAnswer('y'), true);
  assert.equal(yaynay.parseAnswer('yes, did it'), true);
  assert.equal(yaynay.parseAnswer('Nay'), false);
  assert.equal(yaynay.parseAnswer('no'), false);
  assert.equal(yaynay.parseAnswer('N'), false);
  assert.equal(yaynay.parseAnswer('maybe'), null);
  assert.equal(yaynay.parseAnswer('Nothing today'), null);
  assert.equal(yaynay.mostRecentUnansweredDate(record, new Date('2026-09-17T15:00:00Z')), '2026-09-16', 'yesterday, unanswered');
  yaynay.recordAnswer(record, '2026-09-16', true);
  assert.equal(yaynay.mostRecentUnansweredDate(record, new Date('2026-09-17T15:00:00Z')), '2026-09-16', 'all answered: last answer wins on the latest asked day');
  assert.equal(yaynay.mostRecentUnansweredDate(record, new Date('2026-09-11T03:30:00Z')), '2026-09-10', 'on enrollment evening the intro asks about day 0');

  assert.equal(yaynay.channelFor(record, {}), 'email');
  assert.equal(yaynay.channelFor({ phone: '+14155550100' }, {}), 'email', 'no Twilio, no text');
  assert.equal(yaynay.channelFor({ phone: '+14155550100' }, { TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b', TWILIO_FROM: '+1' }), 'sms');
  assert.equal(yaynay.channelFor({ phone: null }, { TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b', TWILIO_FROM: '+1' }), 'email');

  assert.equal(normalisePhone('(415) 555-0100'), '+14155550100');
  assert.equal(normalisePhone('1 415 555 0100'), '+14155550100');
  assert.equal(normalisePhone('+44 7700 900123'), '+447700900123');
  assert.equal(normalisePhone('555-0100'), null);
  assert.equal(normalisePhone(''), null);
  assert.equal(validateEnrollment({ firstName: 'A', email: 'not-an-email' }).ok, false);
  assert.equal(validateEnrollment({ firstName: '', email: 'a@b.co' }).ok, false);
  const v = validateEnrollment({ firstName: '  Ann ', email: 'ann@example.com', phone: '415 555 0100', timeZone: 'Bogus/Zone' });
  assert.deepEqual(v, { ok: true, firstName: 'Ann', email: 'ann@example.com', phone: '+14155550100', timeZone: 'America/Los_Angeles' });
});

test('emails: every message uses the Mind/Body Foundations wrapper, carries its facts, and carries no placeholder copy', () => {
  const record = store.newRecord({ code: 'mb-abcd1234-0123456789', email: 'a@example.com', firstName: 'Ann', now: new Date('2026-09-11T03:00:00Z') });
  const links = yaynay.yayLinks(record, '2026-09-10', emails.BASE_URL);
  const all = {
    enroll: emails.enroll(record),
    week2: emails.weekOpen(record, 2),
    scorecard: emails.scorecard(record, 1, yaynay.scorecard(record, 1)),
    closing: emails.closing(record),
  };
  for (const [name, m] of Object.entries(all)) {
    assert.ok(m.subject && m.html && m.text, name + ' has subject, html and text');
    for (const piece of ['background-color:#FBF7EF', "font-family:'Lora',Georgia", 'width="560"', 'border-bottom:1px solid #C4A879', '>Herst Wellness</span>', 'color:#4B4038;font-size:16px;line-height:1.65', 'tel:14156864411', 'Coach + author of <em>The Performance Trap</em>']) {
      assert.ok(m.html.includes(piece), name + ' wrapper carries ' + piece);
    }
    const emDash = String.fromCharCode(0x2014);
    assert.ok(!m.html.includes(emDash) && !m.text.includes(emDash) && !m.subject.includes(emDash), name + ' has no em dash');
  }
  assert.ok(all.enroll.html.includes('mb-abcd1234-0123456789'), 'the enrollment email carries the code');
  assert.ok(all.enroll.html.includes('https://practice.herstwellness.com/course/on-ramp/week-1'));
  assert.ok(all.enroll.html.includes('/downloads/on-ramp/week-1/whats-bringing-you-here.pdf'));
  for (const [name, m] of Object.entries(all)) {
    assert.ok(!m.html.includes('[[COPY') && !m.text.includes('[[COPY') && !m.subject.includes('[[COPY'), name + ' carries no placeholder copy');
  }
  assert.equal(all.enroll.subject, "You're in. Here's your access code.");
  assert.ok(all.enroll.html.includes("Glad we're doing this.") && all.enroll.html.includes('We narrow it together.'), 'the enrollment email is in his register');
  assert.ok(all.enroll.html.includes('font-style:italic;color:#6B5036;">Chad</p>'));
  assert.ok(all.week2.html.includes('/course/on-ramp/week-2') && all.week2.html.includes('Keeping It Company'));
  assert.ok(all.scorecard.html.includes('Days you sat, meaning a recording played most of the way through: 0 of 7') && all.scorecard.html.includes('Not much sitting this week'));
  assert.ok(emails.scorecard(record, 2, { daysSat: 6, sitsStarted: 0, sitsCompleted: 5, journalsDone: 3, longestRun: 6, totalDaysSat: 9 }).html.includes("That's a real week"));
  assert.ok(emails.scorecard(record, 4, { daysSat: 3, sitsStarted: 1, sitsCompleted: 2, journalsDone: 2, longestRun: 2, totalDaysSat: 15 }).html.includes('closes the month'));
  assert.ok(all.closing.html.includes(emails.BOOKING_URL));
  assert.ok(!all.closing.html.includes('badge') && !all.scorecard.html.includes('streak'), 'no badges, no streak shaming');
});

// ── Routes ──────────────────────────────────────────────────────
test('capture refuses a missing email before touching PayPal, admin enroll needs the admin code, and the enrollment email carries the code', { timeout: 30000 }, async (t) => {
  const resend = await startResendStub(t);
  const paypal = await startPaypalMock(t);
  const file = await tempDataFile(t);
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_CODE_SECRET: 'spine-secret',
    ONRAMP_PRICE_USD: '299',
    PAYPAL_CLIENT_ID: 'mock-client',
    PAYPAL_CLIENT_SECRET: 'mock-secret',
    PAYPAL_BASE_URL: paypal.url,
    RESEND_API_BASE_URL: resend.url,
    RESEND_API_KEY: 'resend-test-key',
    COMPANION_ADMIN_CODE: 'admin-pass',
    ONRAMP_DATA_FILE: file,
  });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;

  // No email: 400, and PayPal was never called.
  const noEmail = await postJson(base + '/course/on-ramp/api/paypal/capture', { orderId: 'ORDER-9', firstName: 'Ann' });
  assert.equal(noEmail.status, 400);
  assert.match((await noEmail.json()).error, /email/i);
  const noName = await postJson(base + '/course/on-ramp/api/paypal/create-order', { email: 'ann@example.com' });
  assert.equal(noName.status, 400);
  assert.deepEqual(paypal.calls, [], 'PayPal untouched until the details are valid');

  // The real flow: details, order, capture, code, email, record.
  const buyer = { firstName: 'Ann', email: 'ann@example.com', phone: '(415) 555-0100', timeZone: 'America/New_York' };
  const created = await postJson(base + '/course/on-ramp/api/paypal/create-order', buyer);
  assert.equal(created.status, 200);
  const captured = await postJson(base + '/course/on-ramp/api/paypal/capture', { orderId: 'ORDER-9', ...buyer });
  assert.equal(captured.status, 200);
  const { accessCode } = await captured.json();
  assert.match(accessCode, /^mb-[a-f0-9]{8}-[a-f0-9]{10}$/);

  assert.equal(resend.sent.length, 1, 'one enrollment email went to the Resend stub');
  assert.equal(resend.sent[0].url, '/emails');
  assert.equal(resend.sent[0].auth, 'Bearer resend-test-key');
  assert.deepEqual(resend.sent[0].body.to, ['ann@example.com']);
  assert.equal(resend.sent[0].body.from, 'Chad Herst <chad@herstwellness.com>');
  assert.ok(resend.sent[0].body.html.includes(accessCode), 'the email carries the code');
  assert.ok(resend.sent[0].body.html.includes('Hi Ann,'));

  const doc = await readDoc(file);
  assert.equal(doc.enrollments.length, 1);
  const record = doc.enrollments[0];
  assert.equal(record.code, accessCode);
  assert.equal(record.email, 'ann@example.com');
  assert.equal(record.firstName, 'Ann');
  assert.equal(record.phone, '+14155550100');
  assert.equal(record.timeZone, 'America/New_York');
  assert.equal(record.source, 'paypal');
  assert.ok(record.sent.enroll, 'the enroll key is marked sent so the ticker never repeats it');
  assert.equal(typeof record.yayToken, 'string');

  // The code the email carries opens the lesson.
  const lesson = await fetch(base + '/course/on-ramp/api/week-1', { headers: { 'X-Companion-Access': accessCode } });
  assert.equal(lesson.status, 200);

  // Admin enrollment for comped people.
  const noCode = await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Bo', email: 'bo@example.com' });
  assert.equal(noCode.status, 401);
  const wrongCode = await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Bo', email: 'bo@example.com' }, { 'x-admin-code': 'nope' });
  assert.equal(wrongCode.status, 401);
  const badBody = await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Bo' }, { 'x-admin-code': 'admin-pass' });
  assert.equal(badBody.status, 400);
  const comped = await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Bo', email: 'bo@example.com', phone: 'n/a' }, { 'x-admin-code': 'admin-pass' });
  assert.equal(comped.status, 200);
  const compedBody = await comped.json();
  assert.match(compedBody.accessCode, /^mb-[a-f0-9]{8}-[a-f0-9]{10}$/);
  assert.match(compedBody.id, /^enr_[a-f0-9]{12}$/);
  assert.equal(resend.sent.length, 2);
  assert.ok(resend.sent[1].body.html.includes(compedBody.accessCode));
  const doc2 = await readDoc(file);
  assert.equal(doc2.enrollments.length, 2);
  assert.equal(doc2.enrollments[1].source, 'admin');
  assert.equal(doc2.enrollments[1].phone, null, 'an unusable phone is dropped, not stored');
  assert.equal(doc2.enrollments[1].timeZone, 'America/Los_Angeles');
});

test('admin enroll is off without COMPANION_ADMIN_CODE, and a failing store still returns the code', { timeout: 30000 }, async (t) => {
  const resend = await startResendStub(t);
  const port = await getOpenPort();
  // ONRAMP_DATA_FILE points inside a regular file, so every write fails.
  const blocker = await tempDataFile(t, 'blocker');
  await fs.writeFile(blocker, 'not a directory');
  const child = await startServer(port, {
    ONRAMP_CODE_SECRET: 'spine-secret',
    RESEND_API_BASE_URL: resend.url,
    ONRAMP_DATA_FILE: path.join(blocker, 'enrollments.json'),
  });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;
  const off = await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Bo', email: 'bo@example.com' }, { 'x-admin-code': 'anything' });
  assert.equal(off.status, 503);

  const port2 = await getOpenPort();
  const child2 = await startServer(port2, {
    ONRAMP_CODE_SECRET: 'spine-secret',
    COMPANION_ADMIN_CODE: 'admin-pass',
    RESEND_API_BASE_URL: resend.url,
    ONRAMP_DATA_FILE: path.join(blocker, 'enrollments.json'),
  });
  t.after(() => child2.kill());
  let loud = '';
  child2.stderr.on('data', (c) => { loud += c; });
  const res = await postJson('http://127.0.0.1:' + port2 + '/course/on-ramp/api/admin/enroll', { firstName: 'Bo', email: 'bo@example.com' }, { 'x-admin-code': 'admin-pass' });
  assert.equal(res.status, 200, 'the buyer is never lost: the code still comes back');
  const { accessCode } = await res.json();
  assert.match(accessCode, /^mb-/);
  assert.equal(resend.sent.length, 1, 'and the email with the code still went out');
  await new Promise((r) => setTimeout(r, 100));
  assert.match(loud, /ON-RAMP ENROLLMENT NOT STORED/);
});

test('listen endpoint stores play and complete for an enrolled code; an unknown code is a 204 no-op', { timeout: 30000 }, async (t) => {
  const resend = await startResendStub(t);
  const file = await tempDataFile(t);
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_CODE_SECRET: 'spine-secret',
    ONRAMP_ACCESS_CODES: 'manual-code-1',
    COMPANION_ADMIN_CODE: 'admin-pass',
    RESEND_API_BASE_URL: resend.url,
    ONRAMP_DATA_FILE: file,
  });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;
  const enrolled = await (await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Cy', email: 'cy@example.com', timeZone: 'Europe/London' }, { 'x-admin-code': 'admin-pass' })).json();

  const play = await postJson(base + '/course/on-ramp/api/listen', { sit: 'onramp-breath-12min', event: 'play' }, { 'X-Companion-Access': enrolled.accessCode });
  assert.equal(play.status, 204);
  const complete = await postJson(base + '/course/on-ramp/api/listen', { sit: 'onramp-breath-12min', event: 'complete' }, { 'X-Companion-Access': enrolled.accessCode });
  assert.equal(complete.status, 204);
  const bad = await postJson(base + '/course/on-ramp/api/listen', { sit: 'onramp-breath-12min', event: 'skip' }, { 'X-Companion-Access': enrolled.accessCode });
  assert.equal(bad.status, 400);
  const denied = await postJson(base + '/course/on-ramp/api/listen', { sit: 'x', event: 'play' }, { 'X-Companion-Access': 'wrong' });
  assert.equal(denied.status, 401);
  // Journals: opening the PDF and tapping Mark done are recorded once each.
  const opened = await postJson(base + '/course/on-ramp/api/journal', { journal: 'week-1/whats-bringing-you-here', event: 'opened' }, { 'X-Companion-Access': enrolled.accessCode });
  assert.equal(opened.status, 204);
  const done = await postJson(base + '/course/on-ramp/api/journal', { journal: 'week-1/whats-bringing-you-here', event: 'done' }, { 'X-Companion-Access': enrolled.accessCode });
  assert.equal(done.status, 204);
  const badJournal = await postJson(base + '/course/on-ramp/api/journal', { journal: '../etc', event: 'done' }, { 'X-Companion-Access': enrolled.accessCode });
  assert.equal(badJournal.status, 400);

  const doc = await readDoc(file);
  const record = store.findByCode(doc, enrolled.accessCode);
  const today = schedule.localDateString(new Date(), 'Europe/London');
  assert.ok(record.days[today], 'stored under today in the record\'s own time zone');
  assert.deepEqual(record.days[today].listens.map((l) => [l.sit, l.complete]), [['onramp-breath-12min', false], ['onramp-breath-12min', true]]);
  assert.equal(record.days[today].yay, null);
  assert.ok(record.journals['week-1/whats-bringing-you-here'].opened && record.journals['week-1/whats-bringing-you-here'].done, 'the journal is recorded as opened and done');

  // A manual ONRAMP_ACCESS_CODES entry has no record: 204 and nothing stored.
  const manual = await postJson(base + '/course/on-ramp/api/listen', { sit: 'onramp-breath-12min', event: 'play' }, { 'X-Companion-Access': 'manual-code-1' });
  assert.equal(manual.status, 204);
  const after = await readDoc(file);
  assert.equal(after.enrollments.length, 1);
  assert.equal(after.enrollments[0].days[today].listens.length, 2);
});

test('the yay link records the answer in the course style; a bad token is a 404', { timeout: 30000 }, async (t) => {
  const resend = await startResendStub(t);
  const file = await tempDataFile(t);
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_CODE_SECRET: 'spine-secret',
    COMPANION_ADMIN_CODE: 'admin-pass',
    RESEND_API_BASE_URL: resend.url,
    ONRAMP_DATA_FILE: file,
  });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;
  await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Di', email: 'di@example.com' }, { 'x-admin-code': 'admin-pass' });
  const record = (await readDoc(file)).enrollments[0];
  const links = yaynay.yayLinks(record, '2026-09-10', base);

  const yay = await fetch(links.yay);
  assert.equal(yay.status, 200);
  assert.match(yay.headers.get('content-type'), /text\/html/);
  assert.equal(yay.headers.get('cache-control'), 'no-store, max-age=0');
  const yayHtml = await yay.text();
  assert.ok(yayHtml.includes('<h1>Got it. Yay.</h1>'));
  assert.ok(yayHtml.includes('--cream:#F4EDE4') && yayHtml.includes('Playfair+Display') && yayHtml.includes('class="card"'), 'same look as the course pages');
  assert.ok(yayHtml.includes('The Performance Trap Practice'));
  assert.equal((await readDoc(file)).enrollments[0].days['2026-09-10'].yay, true);

  const nay = await fetch(links.nay);
  assert.equal(nay.status, 200);
  assert.ok((await nay.text()).includes('Got it. Nay. No shame. Just data.'));
  const stored = (await readDoc(file)).enrollments[0].days['2026-09-10'];
  assert.equal(stored.yay, false, 'last answer wins');
  assert.ok(stored.answeredAt);

  const forged = await fetch(links.yay.replace(/\/[a-f0-9]{24}\//, '/' + 'a'.repeat(24) + '/'));
  assert.equal(forged.status, 404);
  const otherDate = await fetch(links.yay.replace('2026-09-10', '2026-09-11'));
  assert.equal(otherDate.status, 404, 'a token is bound to its date');
  const unknown = await fetch(base + '/course/on-ramp/y/enr_000000000000/' + 'b'.repeat(24) + '/2026-09-10/yay');
  assert.equal(unknown.status, 404);
  assert.equal(Object.keys((await readDoc(file)).enrollments[0].days).length, 1, 'nothing else was written');
});

test('inbound SMS: the Twilio signature is checked, yay/nay lands on the most recent unanswered day, TwiML replies', { timeout: 30000 }, async (t) => {
  const resend = await startResendStub(t);
  const file = await tempDataFile(t);
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_CODE_SECRET: 'spine-secret',
    COMPANION_ADMIN_CODE: 'admin-pass',
    RESEND_API_BASE_URL: resend.url,
    ONRAMP_DATA_FILE: file,
    TWILIO_ACCOUNT_SID: 'ACtest',
    TWILIO_AUTH_TOKEN: 'twilio-token',
    TWILIO_FROM: '+15555550000',
    TWILIO_WEBHOOK_URL: 'https://practice.herstwellness.com/course/on-ramp/api/sms-inbound',
  });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;
  await postJson(base + '/course/on-ramp/api/admin/enroll', { firstName: 'Ed', email: 'ed@example.com', phone: '415-555-0199' }, { 'x-admin-code': 'admin-pass' });

  const params = { From: '+14155550199', To: '+15555550000', Body: 'Yay' };
  const form = new URLSearchParams(params).toString();
  const signature = yaynay.twilioSignature('twilio-token', 'https://practice.herstwellness.com/course/on-ramp/api/sms-inbound', params);
  const send = (sig) => fetch(base + '/course/on-ramp/api/sms-inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(sig ? { 'X-Twilio-Signature': sig } : {}) },
    body: form,
  });
  assert.equal((await send('')).status, 403);
  assert.equal((await send('bad')).status, 403);
  const ok = await send(signature);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/xml/);
  assert.equal(await ok.text(), '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Got it. Yay.</Message></Response>');
  const record = (await readDoc(file)).enrollments[0];
  const expectedDate = yaynay.mostRecentUnansweredDate({ ...record, days: {} }, new Date());
  assert.equal(record.days[expectedDate].yay, true);

  // An unknown phone gets an empty response and writes nothing.
  const strangerParams = { From: '+12125550000', To: '+15555550000', Body: 'nay' };
  const strangerSig = yaynay.twilioSignature('twilio-token', 'https://practice.herstwellness.com/course/on-ramp/api/sms-inbound', strangerParams);
  const stranger = await fetch(base + '/course/on-ramp/api/sms-inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': strangerSig },
    body: new URLSearchParams(strangerParams).toString(),
  });
  assert.equal(await stranger.text(), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  assert.equal((await readDoc(file)).enrollments.length, 1);
});

test('the ticker sends what is due once, marks it sent, retries a failed send, and never texts', async (t) => {
  const file = await tempDataFile(t);
  const s = store.createStore({ ONRAMP_DATA_FILE: file });
  const emailed = [];
  const texted = [];
  const ann = store.newRecord({ code: 'mb-ann', email: 'ann@example.com', firstName: 'Ann', phone: '+14155550100', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  const bo = store.newRecord({ code: 'mb-bo', email: 'bo@example.com', firstName: 'Bo', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  ann.sent.enroll = 'already';
  await s.update((doc) => { doc.enrollments.push(ann, bo); });
  const ctx = {
    store: s,
    baseUrl: 'https://practice.herstwellness.com',
    sendEmail: async (to, subject, html) => { emailed.push({ to, subject, html }); return { ok: true }; },
    sendSms: async (to, body) => { texted.push({ to, body }); return { ok: true }; },
    env: { TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b', TWILIO_FROM: '+1' },
    log: { log() {}, error() {} },
    now: new Date('2026-09-11T03:05:00Z'),
  };
  const first = await schedule.runSpineTick(ctx);
  assert.deepEqual(first.map((d) => d.key), ['enroll']);
  assert.equal(texted.length, 0, 'nothing is texted even with Twilio configured and a phone on file');
  assert.equal(emailed.length, 1, 'Bo gets his enrollment email');
  assert.equal(emailed[0].to, 'bo@example.com');
  assert.ok(emailed[0].html.includes('mb-bo'));
  assert.ok(emailed[0].html.includes('keeps track of when you play the recordings'), 'the enrollment email says the recordings and journals are tracked');
  const saved = await s.load();
  assert.ok(store.findById(saved, bo.id).sent.enroll);

  const second = await schedule.runSpineTick(ctx);
  assert.deepEqual(second, [], 'nothing goes twice');

  // Day 1 morning: quiet. No daily ask.
  ctx.now = new Date('2026-09-11T14:30:00Z');
  assert.deepEqual(await schedule.runSpineTick(ctx), []);

  // Day 7, 6 pm local: the scorecard. A send that fails is not marked and comes back next tick.
  ctx.now = new Date('2026-09-18T01:00:00Z');
  ctx.sendEmail = async () => ({ ok: false });
  const failed = await schedule.runSpineTick(ctx);
  assert.deepEqual(failed, []);
  ctx.sendEmail = async (to, subject, html) => { emailed.push({ to, subject, html }); return { ok: true }; };
  const retried = await schedule.runSpineTick(ctx);
  assert.deepEqual(retried.map((d) => d.key), ['scorecard-1', 'scorecard-1']);
  const card = emailed.find((e) => e.subject === 'Week 1: what it looked like');
  assert.ok(card && card.html.includes('Days you sat, meaning a recording played most of the way through: 0 of 7'));
  assert.ok(card.html.includes('Journals marked done: 0 of 3'));
  assert.ok(texted.length === 0);
});


test('lesson pages keep their policy and gain listen tracking; the sits carry data-sit names', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'spine-page-check' });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;
  for (const n of [1, 2, 3, 4]) {
    const page = await fetch(base + '/course/on-ramp/week-' + n);
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("connect-src 'self'"), 'the listen fetch is covered by connect-src self');
    assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"), 'inline page script stays authorised as before');
    const html = await page.text();
    assert.ok(html.includes('/course/on-ramp/api/listen'), 'the page posts listen events');
    assert.ok(html.includes('attachListenTracking(code)'));
    assert.ok(html.includes('>= 0.8'), 'complete fires past 80 percent');
    assert.ok(!html.includes('data-sit="'), 'no sit is named in the public page source (only the gated content carries players)');
    const content = await (await fetch(base + '/course/on-ramp/api/week-' + n, { headers: { 'X-Companion-Access': 'spine-page-check' } })).json();
    assert.match(content.contentHtml, /<audio [^>]*data-sit="onramp-[a-z0-9-]+"/);
  }
  const w1 = await (await fetch(base + '/course/on-ramp/api/week-1', { headers: { 'X-Companion-Access': 'spine-page-check' } })).json();
  assert.ok(w1.contentHtml.includes('data-sit="onramp-breath-12min"'));
  const w2 = await (await fetch(base + '/course/on-ramp/api/week-2', { headers: { 'X-Companion-Access': 'spine-page-check' } })).json();
  assert.ok(w2.contentHtml.includes('data-sit="onramp-week2-keeping-it-company"'));
});
