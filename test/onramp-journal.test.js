// The Week 1 journal sitting and the pre-session brief (performance-trap
// docs/65, 9/10/26). The model is a local stand-in for the Anthropic
// Messages API (ANTHROPIC_API_BASE_URL) that returns a fixed text and
// remembers every request; Resend is a local stub too. Nothing here
// reaches a real service.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const store = require('../onramp-store.js');
const schedule = require('../onramp-schedule.js');
const brief = require('../onramp-brief.js');
const onramp = require('../onramp.js');
const { lessonContentHtml } = require('../onramp-course.js');

const EM_DASH = String.fromCharCode(0x2014);
const STUB_TEXT = 'Thank you for sending that. Beautiful writing. Read this one back: "my chest is tight before every meeting." What happens in the body as you read it?';
const BRIEF_TEXT = 'What brought them\n\nIn her words: "I am tired of bracing before every meeting."\n\nWhere it lives in the body\n\nThe chest. The word she landed on was tight.';
// A 1 by 1 transparent PNG.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JOURNAL_TEXT = "I came to this because I am tired of bracing before every meeting. When I sit with it now my chest is tight and my jaw is set. If the feeling could talk it would say: do not let them see you slip.";
// The older one-journal form, still accepted and still keyed by journal.
const FIRST_TURN = "Journal: What's Bringing You Here\n\n" + JOURNAL_TEXT;
// The week form (docs/65 revision): every journal brought, each under its
// own heading, in one message.
const BREATH_TEXT = 'The invite landed and my toes curled. The story was: I am being laid off.';
const WEEK_TURN = "Journals, Week 1\n\n## What's Bringing You Here\n" + JOURNAL_TEXT + '\n\n## The Formation of a Reaction\n' + BREATH_TEXT;
const METHOD_LINE = 'One sitting for the week, and the opening comes from the writing';

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

// A stand-in for the Anthropic Messages API: remembers each request, answers
// with one text block, and can be told to fail for a while.
async function startAnthropicStub(t) {
  const requests = [];
  const state = { fail: false, text: STUB_TEXT };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { body = { raw }; }
      requests.push({ url: req.url, apiKey: req.headers['x-api-key'], version: req.headers['anthropic-version'], body });
      res.setHeader('Content-Type', 'application/json');
      if (state.fail) { res.statusCode = 500; res.end('{"type":"error"}'); return; }
      res.end(JSON.stringify({ id: 'msg_stub', type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: state.text }], usage: { input_tokens: 10, output_tokens: 20 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { url: 'http://127.0.0.1:' + server.address().port + '/v1/messages', requests, state };
}

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

function startServer(port, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        COMPANION_ACCESS_CODE: 'test-access',
        COMPANION_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'anthropic-test-key',
        ANTHROPIC_MODEL: 'test-model',
        ONRAMP_CODE_SECRET: 'journal-secret',
        OPENAI_API_KEY: '',
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

async function tempDataFile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'onramp-journal-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'enrollments.json');
}

async function readDoc(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

// A person already enrolled before the server starts: proves the name code
// works on a fresh process through the store, not through any env list.
async function seedRecord(file, extra) {
  const s = store.createStore({ ONRAMP_DATA_FILE: file });
  const record = store.newRecord({ code: 'ann-lee', email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  Object.assign(record, extra || {});
  await s.update((doc) => { doc.enrollments.push(record); });
  return record;
}

function postJson(url, body, headers) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) });
}

function journalTurn(base, message, history, code) {
  return postJson(base + '/api/on-ramp/journal-1', { message, history, adultConfirmed: true, country: 'US' }, { 'X-Companion-Access': code });
}

// ── The page and the config ─────────────────────────────────────
test('the journal page carries its own copy, no breath card, the journal card, and is not listed as a daily rep', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const file = await tempDataFile(t);
  const child = await startServer(port, { ONRAMP_DATA_FILE: file });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;

  const page = await fetch(base + '/practice/on-ramp/journal-1');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') || '', /connect-src 'self'/);
  const html = await page.text();
  for (const piece of [
    'Week 1: the journal sitting',
    'Bring what you wrote. It reads it back, and the body answers.',
    "Bring what you wrote this week. One journal or both. Type it, paste it, or photograph the handwritten pages.",
    "It's the same companion as the daily rep, built from how I work with people's writing before a session. It's not me, and it's not therapy.",
    'id="keepLine"',
    "You've asked me to read what you write here before your Integration and Next-Step Session, so this sitting is kept for that. You can change that on the Week 1 lesson page.",
    'It keeps nothing after you end.',
    'id="journalCard"',
    'Either one, or both.',
    'Paste or type what you wrote',
    'Add a photo of the page',
    'accept="image/jpeg,image/png,image/webp"',
    'Reading the page',
    "Couldn't read that page, type it instead",
    '>Bring it<',
    'Bring at least one journal.',
    '/api/on-ramp/journal-read',
    "fetch('/api/on-ramp/journal-1'",
    'window.location.search',
    "'onrampJournal:'",
    'localStorage.setItem',
    'localStorage.getItem',
    'function buildJournalMessage(weekNum, parts)',
    'var journalWeek = 1;',
    'data-journal="week-1/whats-bringing-you-here"',
    'data-journal="week-1/the-formation-of-a-reaction"',
    'data-title="What&#39;s Bringing You Here"',
    '<label for="journalText1">What&#39;s Bringing You Here</label>',
    '<label for="journalText2">The Formation of a Reaction</label>',
    'id="journalText1"',
    'id="journalText2"',
    'data-target="journalText2"',
    'The journal sitting</span>',
    'id="speakButton"',
    'id="downloadButton"',
  ]) {
    assert.ok(html.includes(piece), 'journal page carries: ' + piece);
  }
  for (const absent of ['id="breathCard"', 'onramp-breath-12min.mp3', 'A little time to breathe', 'Welcome to the daily rep', 'pauseBreathLoop', 'journalSelect', 'Which journal', 'id="journalText"']) {
    assert.ok(!html.includes(absent), 'journal page must not carry: ' + absent);
  }
  assert.equal((html.match(/>Bring it</g) || []).length, 1, 'one Bring it for both boxes');
  assert.equal((html.match(/>Add a photo of the page</g) || []).length, 2, 'a photo button per box');
  assert.equal((html.match(/class="field journal-box"/g) || []).length, 2, 'two boxes');
  assert.ok(html.includes('<textarea id="journalText1" maxlength="19800"'), 'the two boxes together stay under the first-turn cap');
  assert.ok(!html.includes(EM_DASH), 'no em dash on the journal page');

  // The message the page builds is the exported function, inlined verbatim,
  // so this is the same code the browser runs.
  assert.ok(html.includes(onramp.buildJournalMessage.toString()), 'the page carries the very same builder');
  const parts = (a, b) => [
    { title: "What's Bringing You Here", text: a },
    { title: 'The Formation of a Reaction', text: b },
  ];
  assert.equal(onramp.buildJournalMessage(1, parts('', '  \n')), '', 'all boxes empty: nothing to bring');
  assert.equal(onramp.buildJournalMessage(1, parts(JOURNAL_TEXT + '\n', ' ' + BREATH_TEXT)), WEEK_TURN, 'only the boxes with writing, in order, trimmed');
  assert.equal(onramp.buildJournalMessage(1, parts('', 'Only the second.')), 'Journals, Week 1\n\n## The Formation of a Reaction\nOnly the second.');
  assert.ok(onramp.isJournalFirstTurn(WEEK_TURN) && onramp.isJournalFirstTurn(FIRST_TURN) && !onramp.isJournalFirstTurn('hello'));

  // The daily-rep pages are unchanged in shape and still have the breath card.
  const week1 = await (await fetch(base + '/practice/on-ramp/week-1')).text();
  assert.ok(week1.includes('id="breathCard"') && week1.includes('Welcome to the daily rep') && !week1.includes('id="journalCard"'));
  assert.ok(!week1.includes('pauseBreathLoop'), 'the undefined breath-loop call is gone from the daily rep too');

  const index = await (await fetch(base + '/practice/on-ramp')).text();
  assert.ok(!index.includes('journal-1'), 'the index lists only the daily reps');

  // Config: kept out of WEEKS, its own instruction stack.
  assert.equal(Object.keys(onramp.WEEKS).length, 4);
  const j = onramp.JOURNAL[1];
  assert.equal(j.pagePath, '/practice/on-ramp/journal-1');
  assert.equal(j.apiPath, '/api/on-ramp/journal-1');
  assert.deepEqual(j.journals.map((x) => x.key), ['week-1/whats-bringing-you-here', 'week-1/the-formation-of-a-reaction']);
  assert.ok(j.instructions.includes(METHOD_LINE));
  assert.ok(j.instructions.includes("I'd like\nto start here, but correct me if I'm wrong."), 'the opening is checked with the person');
  assert.ok(j.instructions.includes('They may\nbring any or all of them, under these headings:'));
  assert.ok(j.instructions.includes('This week: Week 1, From the Book to the Body'));
  assert.ok(j.instructions.includes('PRODUCT-SAFETY OVERLAY'));
  assert.ok(j.instructions.indexOf('The journal sitting') < j.instructions.indexOf('This week: Week 1'), 'method before week frame');
  assert.ok(!j.instructions.includes(EM_DASH));
  assert.equal(onramp.JOURNALS_PREFIX, 'Journals, Week ');
  assert.equal(onramp.JOURNAL_FIRST_TURN_CHARS, 40000);
  assert.equal(onramp.journalKeyFor(j, "What's Bringing You Here"), 'week-1/whats-bringing-you-here');
  assert.equal(onramp.journalKeyFor(j, 'Something Else'), 'week-1/something-else');
  assert.equal(onramp.journalTitleOf(FIRST_TURN), "What's Bringing You Here");
  assert.equal(onramp.journalTitleOf('no prefix'), '');
  assert.deepEqual(onramp.journalTitlesOf(WEEK_TURN), ["What's Bringing You Here", 'The Formation of a Reaction']);
  assert.deepEqual(onramp.journalTitlesOf(FIRST_TURN), []);
  assert.deepEqual(onramp.journalSessionFor(j, WEEK_TURN), { key: 'week-1', journalTitles: ["What's Bringing You Here", 'The Formation of a Reaction'] });
  assert.deepEqual(onramp.journalSessionFor(j, FIRST_TURN), { key: 'week-1/whats-bringing-you-here', journalTitle: "What's Bringing You Here" });

  // The writing is never trimmed out of the model's view of the exchange,
  // even when both journals run well past the per-turn limit.
  const long = 'x'.repeat(30000);
  const history = [{ role: 'user', content: 'Journals, Week 1\n\n## T\n' + long }];
  for (let i = 0; i < 20; i += 1) history.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: 'turn ' + i });
  const kept = onramp.cleanHistory(history, { keepFirst: true });
  assert.ok(kept.length === 16 || kept.length === 15);
  assert.equal(kept[0].content.length, 'Journals, Week 1\n\n## T\n'.length + 30000, 'the journals are kept whole, past the per-turn limit');
  assert.equal(onramp.cleanHistory([{ role: 'user', content: 'Journals, Week 1\n\n## T\n' + 'y'.repeat(45000) }], { keepFirst: true })[0].content.length, 40000, 'and capped at the first-turn limit');
  assert.equal(kept[1].role, 'assistant', 'turns still alternate after the journal');
  assert.equal(kept[kept.length - 1].content, 'turn 19');
  const plain = onramp.cleanHistory(history);
  assert.equal(plain.length, 16);
  assert.equal(plain[0].content, 'turn 4', 'the daily rep trims from the front as before');
});

// ── The API ─────────────────────────────────────────────────────
test('the journal API is gated, needs the journal first, passes the method and Week 1 frame, and keeps nothing without consent', { timeout: 30000 }, async (t) => {
  const anthropic = await startAnthropicStub(t);
  const file = await tempDataFile(t);
  await seedRecord(file);
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_DATA_FILE: file, ANTHROPIC_API_BASE_URL: anthropic.url });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;

  // The very first request to a fresh server, with a name code held only in the store.
  const denied = await fetch(base + '/api/on-ramp/journal-1', { headers: { 'X-Companion-Access': 'nobody' } });
  assert.equal(denied.status, 401);
  const noCode = await fetch(base + '/api/on-ramp/journal-1');
  assert.equal(noCode.status, 401);
  const info = await fetch(base + '/api/on-ramp/journal-1', { headers: { 'X-Companion-Access': 'ann-lee' } });
  assert.equal(info.status, 200, 'a name code from the store opens the journal API on the first request');
  const infoBody = await info.json();
  assert.equal(infoBody.persistentStorage, false);
  assert.equal(infoBody.provider, 'anthropic');

  // The first turn must be the journal.
  const early = await journalTurn(base, 'hello there', [], 'ann-lee');
  assert.equal(early.status, 400);
  assert.equal((await early.json()).error, 'Bring the journal first.');
  assert.equal(anthropic.requests.length, 0, 'nothing reached the model');

  const first = await journalTurn(base, WEEK_TURN, [], 'ann-lee');
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.response, STUB_TEXT);
  assert.equal(firstBody.handledBy, 'companion-model');
  assert.equal(firstBody.lockSession, false);
  assert.equal(anthropic.requests.length, 1);
  const sent = anthropic.requests[0];
  assert.equal(sent.apiKey, 'anthropic-test-key');
  assert.equal(sent.body.model, 'test-model');
  assert.ok(sent.body.system.includes(METHOD_LINE), 'the journal method is in the system prompt');
  assert.ok(sent.body.system.includes('This week: Week 1, From the Book to the Body'), 'the Week 1 frame is in the system prompt');
  assert.ok(sent.body.system.includes('The person has not agreed to let Chad read this sitting'));
  assert.ok(!sent.body.system.includes('CLOSE NOW'));
  assert.deepEqual(sent.body.messages, [{ role: 'user', content: WEEK_TURN }]);

  // The older one-journal form still opens a sitting.
  const old = await journalTurn(base, FIRST_TURN, [], 'ann-lee');
  assert.equal(old.status, 200);
  assert.deepEqual(anthropic.requests[1].body.messages, [{ role: 'user', content: FIRST_TURN }]);

  // The first turn may run to 40,000 characters (both journals); one
  // more is refused. Later turns keep the ordinary limit.
  const head = 'Journals, Week 1\n\n## The Formation of a Reaction\n';
  const full = head + 'z'.repeat(40000 - head.length);
  assert.equal(full.length, 40000);
  const big = await journalTurn(base, full, [], 'ann-lee');
  assert.equal(big.status, 200, 'a 40,000 character first turn is accepted');
  assert.equal(anthropic.requests[2].body.messages[0].content.length, 40000, 'and reaches the model whole');
  const over = await journalTurn(base, head + 'z'.repeat(41000 - head.length), [], 'ann-lee');
  assert.equal(over.status, 413);
  assert.equal((await over.json()).error, 'The message is too long.');
  const laterOver = await journalTurn(base, 'z'.repeat(12001), [{ role: 'user', content: WEEK_TURN }, { role: 'assistant', content: STUB_TEXT }], 'ann-lee');
  assert.equal(laterOver.status, 413, 'a later turn keeps the ordinary limit');
  assert.equal(anthropic.requests.length, 3, 'neither oversized message reached the model');

  // Later turns: the journals stay first and whole.
  const history = [{ role: 'user', content: WEEK_TURN }, { role: 'assistant', content: STUB_TEXT }];
  const second = await journalTurn(base, 'It gets tighter. Like a hand on my sternum.', history, 'ann-lee');
  assert.equal(second.status, 200);
  assert.equal(anthropic.requests[3].body.messages[0].content, WEEK_TURN);
  assert.equal(anthropic.requests[3].body.messages.length, 3);

  // Soft close at 16 stored turns, hard cap at 24 without a model call.
  const long = [];
  while (long.length < 16) long.push({ role: long.length % 2 === 0 ? 'user' : 'assistant', content: long.length === 0 ? WEEK_TURN : 'turn ' + long.length });
  const soft = await journalTurn(base, 'still here', long, 'ann-lee');
  assert.equal(soft.status, 200);
  const softSystem = anthropic.requests[anthropic.requests.length - 1].body.system;
  assert.ok(softSystem.includes('CLOSE NOW') && softSystem.includes('what are they leaving with, first in the body, then in general'));
  while (long.length < 24) long.push({ role: long.length % 2 === 0 ? 'user' : 'assistant', content: 'turn ' + long.length });
  const before = anthropic.requests.length;
  const hard = await journalTurn(base, 'and more', long, 'ann-lee');
  const hardBody = await hard.json();
  assert.equal(hardBody.lockSession, true);
  assert.equal(hardBody.handledBy, 'turn-cap');
  assert.equal(anthropic.requests.length, before, 'the cap answers without the model');

  // No consent: nothing is written to the record.
  const doc = await readDoc(file);
  const record = store.findByCode(doc, 'ann-lee');
  assert.equal(record.journalSessions, undefined, 'without consent nothing is kept');
  assert.equal(record.consent, undefined);
});

test('consent round-trips from the lesson page, and with consent the journal exchange is kept on the record', { timeout: 30000 }, async (t) => {
  const anthropic = await startAnthropicStub(t);
  const file = await tempDataFile(t);
  await seedRecord(file);
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_DATA_FILE: file, ANTHROPIC_API_BASE_URL: anthropic.url, ONRAMP_ACCESS_CODES: 'manual-code-1' });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;
  const headers = { 'X-Companion-Access': 'ann-lee' };

  const unauth = await fetch(base + '/course/on-ramp/api/consent', { headers: { 'X-Companion-Access': 'wrong' } });
  assert.equal(unauth.status, 401);
  const initial = await (await fetch(base + '/course/on-ramp/api/consent', { headers })).json();
  assert.deepEqual(initial, { consent: false });
  const bad = await postJson(base + '/course/on-ramp/api/consent', { consent: 'yes' }, headers);
  assert.equal(bad.status, 400);
  const on = await postJson(base + '/course/on-ramp/api/consent', { consent: true }, headers);
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { consent: true });
  assert.deepEqual(await (await fetch(base + '/course/on-ramp/api/consent', { headers })).json(), { consent: true });
  let record = store.findByCode(await readDoc(file), 'ann-lee');
  assert.equal(record.consent, true);
  assert.match(record.consentAt, /^\d{4}-\d{2}-\d{2}T/);

  // A manual env code has no record: never kept, and the answer says so.
  const manual = await postJson(base + '/course/on-ramp/api/consent', { consent: true }, { 'X-Companion-Access': 'manual-code-1' });
  assert.deepEqual(await manual.json(), { consent: false });
  assert.equal((await readDoc(file)).enrollments.length, 1);

  // The journal API now reports the storage truthfully and keeps the exchange.
  const info = await (await fetch(base + '/api/on-ramp/journal-1', { headers })).json();
  assert.equal(info.persistentStorage, true);
  const first = await journalTurn(base, WEEK_TURN, [], 'ann-lee');
  assert.equal(first.status, 200);
  assert.ok(anthropic.requests[0].body.system.includes('The person has agreed to let Chad read this sitting'));
  record = store.findByCode(await readDoc(file), 'ann-lee');
  const key = 'week-1';
  assert.ok(record.journalSessions && record.journalSessions[key], 'the sitting is kept under the week key');
  assert.deepEqual(record.journalSessions[key].journalTitles, ["What's Bringing You Here", 'The Formation of a Reaction'], 'the titles come from the headings');
  assert.equal(record.journalSessions[key].journalTitle, undefined);
  assert.match(record.journalSessions[key].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(record.journalSessions[key].history, [
    { role: 'user', content: WEEK_TURN },
    { role: 'assistant', content: STUB_TEXT },
  ]);

  const history = [{ role: 'user', content: WEEK_TURN }, { role: 'assistant', content: STUB_TEXT }];
  const reply = 'It gets tighter. Like a hand on my sternum.';
  const second = await journalTurn(base, reply, history, 'ann-lee');
  assert.equal(second.status, 200);
  record = store.findByCode(await readDoc(file), 'ann-lee');
  assert.equal(record.journalSessions[key].history.length, 4, 'each turn replaces the whole exchange');
  assert.equal(record.journalSessions[key].history[2].content, reply);
  assert.equal(record.journalSessions[key].history[3].content, STUB_TEXT);

  // A first turn past the ordinary limit is kept whole on the record too.
  const head = 'Journals, Week 1\n\n## The Formation of a Reaction\n';
  const full = head + 'z'.repeat(40000 - head.length);
  assert.equal((await journalTurn(base, full, [], 'ann-lee')).status, 200);
  const afterFull = await journalTurn(base, 'still here', [{ role: 'user', content: full }, { role: 'assistant', content: STUB_TEXT }], 'ann-lee');
  assert.equal(afterFull.status, 200);
  record = store.findByCode(await readDoc(file), 'ann-lee');
  assert.equal(record.journalSessions[key].history[0].content.length, 40000, 'the long first turn is stored whole');
  assert.deepEqual(record.journalSessions[key].journalTitles, ['The Formation of a Reaction']);

  // Coming back later in the week and bringing more is a fresh sitting that
  // replaces the week's saved one: the latest sitting is what the brief sees.
  const again = await journalTurn(base, WEEK_TURN.replace(BREATH_TEXT, 'She asked and I said yes before I had checked.'), [], 'ann-lee');
  assert.equal(again.status, 200);
  record = store.findByCode(await readDoc(file), 'ann-lee');
  assert.deepEqual(Object.keys(record.journalSessions), [key], 'one saved sitting per week');
  assert.deepEqual(record.journalSessions[key].journalTitles, ["What's Bringing You Here", 'The Formation of a Reaction']);
  assert.equal(record.journalSessions[key].history.length, 2, 'the earlier exchange is replaced');

  // The older one-journal form is still kept under its own journal key, so
  // nothing already saved breaks; the week sitting stays.
  const breath = await journalTurn(base, 'Journal: The Breath in Ordinary Hours\n\n' + 'Mon yay. Tue nay.', [], 'ann-lee');
  assert.equal(breath.status, 200);
  record = store.findByCode(await readDoc(file), 'ann-lee');
  assert.deepEqual(Object.keys(record.journalSessions).sort(), [key, 'week-1/the-breath-in-ordinary-hours']);
  assert.equal(record.journalSessions['week-1/the-breath-in-ordinary-hours'].journalTitle, 'The Breath in Ordinary Hours');
  assert.equal(record.journalSessions['week-1/the-breath-in-ordinary-hours'].journalTitles, undefined);

  // Untick: the box is honoured at once, and what was kept stays until Chad reads it.
  await postJson(base + '/course/on-ramp/api/consent', { consent: false }, headers);
  const third = await journalTurn(base, 'more', [...history, { role: 'user', content: reply }, { role: 'assistant', content: STUB_TEXT }], 'ann-lee');
  assert.equal(third.status, 200);
  record = store.findByCode(await readDoc(file), 'ann-lee');
  assert.equal(record.journalSessions[key].history.length, 2, 'nothing more is written once the box is unticked');
  assert.equal((await (await fetch(base + '/api/on-ramp/journal-1', { headers })).json()).persistentStorage, false);
});

test('the Week 1 lesson carries the consent box and a Bring it link per journal; other weeks do not', () => {
  const w1 = lessonContentHtml(1);
  assert.ok(w1.includes('id="journalConsent"'));
  assert.ok(w1.includes('Let Chad read what I write in the journal sittings before our Integration and Next-Step Session.'));
  assert.ok(w1.includes('Ticked: what you bring to the journal sittings is kept for Chad to read, and he gets a short brief before your session. Unticked: nothing is kept.'));
  assert.ok(w1.indexOf('id="journalConsent"') < w1.indexOf('1. What&#39;s Bringing You Here') || w1.indexOf('id="journalConsent"') < w1.indexOf("1. What's Bringing You Here"), 'the box sits above the journals');
  for (const key of ['week-1/whats-bringing-you-here', 'week-1/the-formation-of-a-reaction']) {
    assert.ok(w1.includes('href="/practice/on-ramp/journal-1?journal=' + key + '">Bring it to the journal sitting</a>'), 'Bring it link for ' + key);
  }
  assert.equal((w1.match(/Bring it to the journal sitting/g) || []).length, 3);
  assert.ok(!w1.includes(EM_DASH));
  for (const n of [2, 3, 4]) {
    const html = lessonContentHtml(n);
    assert.ok(!html.includes('journalConsent') && !html.includes('journal-1'), 'week ' + n + ' has no journal sitting yet');
  }
});

// ── Reading a photographed page ─────────────────────────────────
test('journal-read is gated, sends the photo to the model as an image block, returns the text, and bounds the size', { timeout: 60000 }, async (t) => {
  const anthropic = await startAnthropicStub(t);
  anthropic.state.text = 'I came here because [crossed out: I was told to] I wanted to. The meeting [?] tight.';
  const file = await tempDataFile(t);
  await seedRecord(file);
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_DATA_FILE: file, ANTHROPIC_API_BASE_URL: anthropic.url });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;
  const send = (body, type, code) => fetch(base + '/api/on-ramp/journal-read', {
    method: 'POST',
    headers: { 'Content-Type': type, ...(code ? { 'X-Companion-Access': code } : {}) },
    body,
  });

  assert.equal((await send(TINY_PNG, 'image/png')).status, 401);
  assert.equal((await send(TINY_PNG, 'image/png', 'wrong')).status, 401);
  assert.equal((await fetch(base + '/api/on-ramp/journal-read')).status, 405);
  assert.equal((await send(TINY_PNG, 'image/gif', 'ann-lee')).status, 415);
  assert.equal((await send(Buffer.alloc(0), 'image/png', 'ann-lee')).status, 400);
  assert.equal(anthropic.requests.length, 0, 'none of those reached the model');

  const ok = await send(TINY_PNG, 'image/png', 'ann-lee');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { text: anthropic.state.text });
  assert.equal(anthropic.requests.length, 1);
  const req = anthropic.requests[0];
  assert.equal(req.apiKey, 'anthropic-test-key');
  assert.equal(req.body.model, 'test-model');
  assert.equal(req.body.system, undefined);
  const content = req.body.messages[0].content;
  assert.equal(req.body.messages[0].role, 'user');
  assert.equal(content[0].type, 'image');
  assert.deepEqual(content[0].source, { type: 'base64', media_type: 'image/png', data: TINY_PNG.toString('base64') });
  assert.equal(content[1].type, 'text');
  assert.equal(content[1].text, 'Transcribe the handwriting on this journal page exactly as written, in reading order, including crossed-out words in [brackets] and a [?] where a word is unreadable. Return only the transcription.');

  // JPEG with a charset suffix is fine too.
  const jpeg = await send(TINY_PNG, 'image/jpeg; charset=binary', 'ann-lee');
  assert.equal(jpeg.status, 200);
  assert.equal(anthropic.requests[1].body.messages[0].content[0].source.media_type, 'image/jpeg');

  // A model failure is a plain error, never a crash.
  anthropic.state.fail = true;
  const failed = await send(TINY_PNG, 'image/png', 'ann-lee');
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error, "Couldn't read that page, type it instead.");
  anthropic.state.fail = false;

  // 7 MB is over the 6 MB line: refused, and the model never sees it. The
  // server drops the connection as it does for an oversized recording, so
  // the client sees either the 413 or a closed connection.
  const before = anthropic.requests.length;
  let big = null;
  try { big = await send(Buffer.alloc(7 * 1024 * 1024, 1), 'image/png', 'ann-lee'); } catch { big = null; }
  assert.ok(big === null || big.status === 413, 'an oversized photo is refused');
  assert.equal(anthropic.requests.length, before, 'the oversized photo never reached the model');

  // The server is still healthy afterwards.
  const after = await send(TINY_PNG, 'image/png', 'ann-lee');
  assert.equal(after.status, 200);
});

// ── The brief ───────────────────────────────────────────────────
test('buildBriefInput carries the name, the practice numbers by week, each saved sitting as writing plus exchange', () => {
  const record = store.newRecord({ code: 'ann-lee', email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  store.dayEntry(record, '2026-09-12').listens.push({ sit: 'onramp-breath-12min', at: 'x', complete: true });
  store.dayEntry(record, '2026-09-13').listens.push({ sit: 'onramp-breath-12min', at: 'x', complete: true }, { sit: 'onramp-breath-12min', at: 'x', complete: false });
  store.dayEntry(record, '2026-09-20').listens.push({ sit: 'onramp-week2-keeping-it-company', at: 'x', complete: true });
  record.journals = { 'week-1/whats-bringing-you-here': { done: 'x' }, 'week-1/the-breath-in-ordinary-hours': { opened: 'x' } };
  const empty = brief.buildBriefInput(record);
  assert.ok(empty.includes('First name: Ann'));
  assert.ok(empty.includes('Week 1: days sat 2 of 7, sits finished 2, journals done 1 of 3'));
  assert.ok(empty.includes('Week 2: days sat 1 of 7, sits finished 1, journals done 0 of 3'));
  assert.ok(empty.includes('Week 4: days sat 0 of 7'));
  assert.ok(empty.includes('No journal sittings were saved'));

  record.consent = true;
  record.journalSessions = {
    'week-1/whats-bringing-you-here': {
      updatedAt: '2026-09-12T20:00:00.000Z',
      journalTitle: "What's Bringing You Here",
      history: [
        { role: 'user', content: FIRST_TURN },
        { role: 'assistant', content: STUB_TEXT },
        { role: 'user', content: 'It gets tighter.' },
        { role: 'assistant', content: 'Stay with tighter for a breath.' },
      ],
    },
  };
  const input = brief.buildBriefInput(record);
  assert.ok(input.includes("--- What's Bringing You Here (Week 1), 2026-09-12 ---"));
  assert.ok(input.includes('THE WRITING:\n' + JOURNAL_TEXT + '\n'), 'the writing appears without the Journal: header');
  assert.ok(input.includes('Companion: ' + STUB_TEXT));
  assert.ok(input.includes('Person: It gets tighter.'));
  assert.ok(input.includes('Companion: Stay with tighter for a breath.'));
  assert.ok(!input.includes('No journal sittings were saved'));
  assert.deepEqual(brief.splitJournalTurn(FIRST_TURN), { title: "What's Bringing You Here", text: JOURNAL_TEXT });

  // The week shape: one sitting, each journal labelled by its heading.
  record.journalSessions = {
    'week-1': {
      updatedAt: '2026-09-14T20:00:00.000Z',
      journalTitles: ["What's Bringing You Here", 'The Formation of a Reaction'],
      history: [
        { role: 'user', content: WEEK_TURN },
        { role: 'assistant', content: STUB_TEXT },
        { role: 'user', content: 'It gets tighter.' },
      ],
    },
  };
  const weekInput = brief.buildBriefInput(record);
  assert.ok(weekInput.includes('--- Week 1 journal sitting, 2026-09-14 ---'));
  assert.ok(weekInput.includes("THE WRITING:\n[What's Bringing You Here]\n" + JOURNAL_TEXT + '\n\n[The Formation of a Reaction]\n' + BREATH_TEXT + '\n\nTHE EXCHANGE:\nCompanion: ' + STUB_TEXT + '\nPerson: It gets tighter.'), 'each journal under its own title, then the exchange');
  assert.ok(!weekInput.includes('Journals, Week 1') && !weekInput.includes('## '), 'the wire headings are not passed through');
  assert.deepEqual(brief.splitWeekTurn(WEEK_TURN), { week: 1, journals: [{ title: "What's Bringing You Here", text: JOURNAL_TEXT }, { title: 'The Formation of a Reaction', text: BREATH_TEXT }] });
  assert.equal(brief.splitWeekTurn(FIRST_TURN), null);

  // Both shapes on one record (someone who brought a journal the old way
  // before the week sitting existed) are both read, in key order.
  record.journalSessions['week-1/whats-bringing-you-here'] = { updatedAt: '2026-09-12T20:00:00.000Z', journalTitle: "What's Bringing You Here", history: [{ role: 'user', content: FIRST_TURN }, { role: 'assistant', content: STUB_TEXT }] };
  const both = brief.buildBriefInput(record);
  assert.ok(both.indexOf('--- Week 1 journal sitting') < both.indexOf("--- What's Bringing You Here (Week 1)"));
  assert.equal(brief.briefSubject(record), 'Before your session with Ann Lee: the month in brief');
  assert.equal(brief.BRIEF_TO, 'chad@herstwellness.com');
  assert.ok(brief.BRIEF_PROMPT.includes('private brief for Chad Herst'));
  assert.ok(!brief.BRIEF_PROMPT.includes(EM_DASH));
  const html = brief.briefHtml(BRIEF_TEXT);
  assert.ok(html.includes('<strong>What brought them</strong>'));
  assert.ok(html.includes('&quot;I am tired of bracing before every meeting.&quot;'));
});

test('the admin brief route needs the admin code, builds the input from the record, and emails Chad through Resend', { timeout: 30000 }, async (t) => {
  const anthropic = await startAnthropicStub(t);
  anthropic.state.text = BRIEF_TEXT;
  const resend = await startResendStub(t);
  const file = await tempDataFile(t);
  const seeded = await seedRecord(file, {
    consent: true,
    consentAt: '2026-09-11T04:00:00.000Z',
    journalSessions: {
      'week-1': {
        updatedAt: '2026-09-12T20:00:00.000Z',
        journalTitles: ["What's Bringing You Here", 'The Formation of a Reaction'],
        history: [{ role: 'user', content: WEEK_TURN }, { role: 'assistant', content: STUB_TEXT }, { role: 'user', content: 'It gets tighter.' }, { role: 'assistant', content: 'Stay with tighter for a breath.' }],
      },
    },
  });
  const s = store.createStore({ ONRAMP_DATA_FILE: file });
  await s.update((doc) => {
    const r = store.findByCode(doc, 'ann-lee');
    store.dayEntry(r, '2026-09-12').listens.push({ sit: 'onramp-breath-12min', at: 'x', complete: true });
    store.dayEntry(r, '2026-09-14').listens.push({ sit: 'onramp-breath-12min', at: 'x', complete: true });
    r.journals = { 'week-1/whats-bringing-you-here': { done: 'x' } };
  });
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_DATA_FILE: file,
    ANTHROPIC_API_BASE_URL: anthropic.url,
    RESEND_API_BASE_URL: resend.url,
    RESEND_API_KEY: 'resend-test-key',
    COMPANION_ADMIN_CODE: 'admin-pass',
  });
  t.after(() => child.kill());
  const base = 'http://127.0.0.1:' + port;

  assert.equal((await postJson(base + '/course/on-ramp/api/admin/brief', { code: 'ann-lee' })).status, 401);
  assert.equal((await postJson(base + '/course/on-ramp/api/admin/brief', { code: 'ann-lee' }, { 'x-admin-code': 'nope' })).status, 401);
  assert.equal((await postJson(base + '/course/on-ramp/api/admin/brief', {}, { 'x-admin-code': 'admin-pass' })).status, 400);
  assert.equal((await postJson(base + '/course/on-ramp/api/admin/brief', { code: 'nobody' }, { 'x-admin-code': 'admin-pass' })).status, 404);
  assert.equal(anthropic.requests.length, 0);
  assert.equal(resend.sent.length, 0);

  const ok = await postJson(base + '/course/on-ramp/api/admin/brief', { code: 'ann-lee' }, { 'x-admin-code': 'admin-pass' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, chars: BRIEF_TEXT.length });

  assert.equal(anthropic.requests.length, 1);
  const req = anthropic.requests[0];
  assert.equal(req.body.system, brief.BRIEF_PROMPT, 'the brief prompt is the system prompt');
  assert.equal(req.body.max_tokens, 2500);
  assert.equal(req.body.messages.length, 1);
  const input = req.body.messages[0].content;
  assert.ok(input.includes('First name: Ann'));
  assert.ok(input.includes("[What's Bringing You Here]\n" + JOURNAL_TEXT), 'the saved journal text is in the input under its title');
  assert.ok(input.includes('[The Formation of a Reaction]\n' + BREATH_TEXT));
  assert.ok(input.includes('--- Week 1 journal sitting, 2026-09-12 ---'));
  assert.ok(input.includes('Person: It gets tighter.'));
  assert.ok(input.includes('Week 1: days sat 2 of 7, sits finished 2, journals done 1 of 3'), 'the practice numbers are in the input');

  assert.equal(resend.sent.length, 1);
  const mail = resend.sent[0];
  assert.equal(mail.auth, 'Bearer resend-test-key');
  assert.deepEqual(mail.body.to, ['chad@herstwellness.com']);
  assert.equal(mail.body.subject, 'Before your session with Ann Lee: the month in brief');
  assert.ok(mail.body.html.includes('Ann Lee, code ann-lee, ann@example.com.'), 'the first line gives the code and email');
  assert.ok(mail.body.html.includes('<strong>What brought them</strong>'));
  assert.ok(mail.body.html.includes('The word she landed on was tight.'));
  for (const piece of ['background-color:#FBF7EF', "font-family:'Lora',Georgia", 'width="560"', 'tel:14156864411']) {
    assert.ok(mail.body.html.includes(piece), 'the MBF wrapper carries ' + piece);
  }
  assert.ok(!mail.body.html.includes(EM_DASH) && !mail.body.subject.includes(EM_DASH));
  const record = store.findByCode(await readDoc(file), seeded.code);
  assert.match(record.sent.brief, /^\d{4}-\d{2}-\d{2}T/, 'marked sent so the ticker does not send a second one');

  // A model failure is reported, not marked, and does not email.
  anthropic.state.fail = true;
  const failed = await postJson(base + '/course/on-ramp/api/admin/brief', { code: 'ann-lee' }, { 'x-admin-code': 'admin-pass' });
  assert.equal(failed.status, 502);
  assert.equal(resend.sent.length, 1);
});

test('the schedule carries the brief on day 28 at 6:30 pm local only for consenting records, and the ticker writes, sends, marks, and retries it', async (t) => {
  const anthropic = await startAnthropicStub(t);
  anthropic.state.text = BRIEF_TEXT;
  const keys = (items) => items.map((i) => i.key);

  const plain = store.newRecord({ code: 'bo-diaz', email: 'bo@example.com', firstName: 'Bo', lastName: 'Diaz', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  assert.ok(!keys(schedule.scheduleFor(plain)).includes('brief'), 'no consent, no brief');
  const consenting = store.newRecord({ code: 'ann-lee', email: 'ann@example.com', firstName: 'Ann', lastName: 'Lee', timeZone: 'America/Los_Angeles', now: new Date('2026-09-11T03:00:00Z') });
  consenting.consent = true;
  const items = schedule.scheduleFor(consenting);
  assert.deepEqual(keys(items), ['enroll', 'scorecard-1', 'week-2', 'scorecard-2', 'week-3', 'scorecard-3', 'week-4', 'scorecard-4', 'brief', 'closing']);
  const item = items.find((i) => i.key === 'brief');
  assert.equal(item.kind, 'brief');
  assert.equal(item.at.toISOString(), '2026-10-09T01:30:00.000Z', 'day 28 (Oct 8) at 6:30 pm Pacific');
  const declined = { ...consenting, consent: false };
  assert.ok(!keys(schedule.scheduleFor(declined)).includes('brief'));

  // The ticker: everything before the brief already sent.
  const file = await tempDataFile(t);
  const s = store.createStore({ ONRAMP_DATA_FILE: file });
  for (const k of ['enroll', 'scorecard-1', 'week-2', 'scorecard-2', 'week-3', 'scorecard-3', 'week-4', 'scorecard-4']) { consenting.sent[k] = 'x'; plain.sent[k] = 'x'; }
  consenting.journalSessions = { 'week-1/whats-bringing-you-here': { updatedAt: '2026-09-12T20:00:00.000Z', journalTitle: "What's Bringing You Here", history: [{ role: 'user', content: FIRST_TURN }, { role: 'assistant', content: STUB_TEXT }] } };
  await s.update((doc) => { doc.enrollments.push(consenting, plain); });
  const emailed = [];
  const errors = [];
  const ctx = {
    store: s,
    baseUrl: 'https://practice.herstwellness.com',
    sendEmail: async (to, subject, html) => { emailed.push({ to, subject, html }); return { ok: true }; },
    env: { ANTHROPIC_API_KEY: 'anthropic-test-key', ANTHROPIC_MODEL: 'test-model', ANTHROPIC_API_BASE_URL: anthropic.url },
    log: { log() {}, error(...args) { errors.push(args.join(' ')); } },
    now: new Date('2026-10-09T01:29:00Z'),
  };
  assert.deepEqual(await schedule.runSpineTick(ctx), [], 'a minute early: nothing');

  // Due, but the model fails: logged, not marked, retried next tick.
  ctx.now = new Date('2026-10-09T01:30:00Z');
  anthropic.state.fail = true;
  assert.deepEqual(await schedule.runSpineTick(ctx), []);
  assert.ok(errors.some((e) => e.includes('brief')), 'the failure is logged');
  assert.equal(emailed.length, 0);
  assert.equal(store.findById(await s.load(), consenting.id).sent.brief, undefined);

  anthropic.state.fail = false;
  const done = await schedule.runSpineTick(ctx);
  assert.deepEqual(done, [{ id: consenting.id, key: 'brief' }], 'only the consenting record gets a brief');
  assert.equal(emailed.length, 1);
  assert.equal(emailed[0].to, 'chad@herstwellness.com');
  assert.equal(emailed[0].subject, 'Before your session with Ann Lee: the month in brief');
  assert.ok(emailed[0].html.includes('Ann Lee, code ann-lee, ann@example.com.'));
  assert.ok(emailed[0].html.includes('<strong>What brought them</strong>'));
  const modelInput = anthropic.requests[anthropic.requests.length - 1].body.messages[0].content;
  assert.ok(modelInput.includes(JOURNAL_TEXT));
  assert.match(store.findById(await s.load(), consenting.id).sent.brief, /^2026-10-09T01:30/);
  assert.deepEqual(await schedule.runSpineTick(ctx), [], 'never twice');

  // Day 29 morning: closing goes to both, the brief to neither again.
  ctx.now = new Date('2026-10-09T14:00:00Z');
  const closing = await schedule.runSpineTick(ctx);
  assert.deepEqual(closing.map((d) => d.key).sort(), ['closing', 'closing']);
  assert.equal(emailed.filter((e) => e.to === 'chad@herstwellness.com').length, 1);
});

test('no em dash in any of the new copy or code', async () => {
  for (const name of ['onramp.js', 'onramp-course.js', 'onramp-brief.js', 'onramp-schedule.js', 'onramp-emails.js', 'onramp-method-journal.txt', 'onramp-journal-week-1.txt', 'onramp-brief-prompt.txt', path.join('test', 'onramp-journal.test.js')]) {
    const text = await fs.readFile(path.join(__dirname, '..', name), 'utf8');
    assert.ok(!text.includes(EM_DASH), name + ' has no em dash');
  }
});

test('a journal that contains "I\'m done." or "stop" is writing, not a stop request; the safety routes still fire on it', () => {
  const { evaluateDeterministicControls } = require('../onramp.js');
  const base = { adultConfirmed: true, country: 'US', provider: 'anthropic' };
  assert.equal(evaluateDeterministicControls({ ...base, message: "Journal: The Formation of a Reaction\n\nI'm done. I told her to stop.", journalText: true }), null);
  assert.equal(evaluateDeterministicControls({ ...base, message: "Journals, Week 1\n\n## The Formation of a Reaction\nI'm done. I told her to stop.", journalText: true }), null);
  assert.equal(evaluateDeterministicControls({ ...base, message: "I'm done.", journalText: false }).route, 'stop_requested');
  const urgent = evaluateDeterministicControls({ ...base, message: 'Journal: What\'s Bringing You Here\n\nI am going to kill myself tonight.', journalText: true });
  assert.ok(urgent && urgent.route !== 'continue_reflection', 'urgent self-harm in a journal still routes to safety');
});

test('the Week 1 lens (Slow the breath, Enter the body) sits in both the daily rep and the journal sitting, and in no other week', () => {
  const { WEEKS } = require('../onramp.js');
  const onramp = require('../onramp.js');
  const lensLine = 'The lens this week: Slow the breath, Enter the body';
  assert.ok(WEEKS[1].instructions.includes(lensLine), 'Week 1 daily rep carries the lens');
  assert.ok(WEEKS[1].instructions.indexOf(lensLine) < WEEKS[1].instructions.indexOf('## This week: Week 1'), 'lens comes before the week frame');
  for (const n of [2, 3, 4]) assert.ok(!WEEKS[n].instructions.includes(lensLine), 'week ' + n + ' has no Week 1 lens');
  const journal = (onramp.JOURNAL && onramp.JOURNAL[1]) || null;
  if (journal) assert.ok(journal.instructions.includes(lensLine), 'the journal sitting carries the lens');
  assert.ok(WEEKS[1].instructions.includes('oil from a ladle') && WEEKS[1].instructions.includes('U-turn'));
  assert.ok(!WEEKS[1].instructions.includes("beginner's mind question"), 'the lens is the two moves, not beginner\'s mind');
  assert.ok(!WEEKS[1].instructions.includes(String.fromCharCode(0x2014)));
});
