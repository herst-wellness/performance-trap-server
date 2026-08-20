// The Vivian Reply: Chad's own thinking companion for one decision, built
// as a structural sibling of aj.js. It shares the identical deterministic
// safety layer proven on Kids on the Bus, On-Ramp, MBF, and AJ, so the
// same 25-case product-safety suite must pass against this route too.
// Plus its own specifics: access is gated by VIVIAN_REPLY_ACCESS_CODE(S),
// fully separate from every other companion's codes in both directions;
// the page carries no other companion's API path; and it carries the
// Speak button with its own transcribe route, the Email me this button
// with its own send route, and the bottom I'm finished now control.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const suitePath = path.join(__dirname, 'module-2-product-safety-evaluation-set.jsonl');
const { TITLE, OPENING, PAGE_PATH, API_PATH, SEND_PATH, INSTRUCTIONS, sendNotesToChad } = require('../vivian-reply.js');
const { API_PATH: AJ_API_PATH } = require('../aj.js');
const { MODULES } = require('../mbf.js');
const { WEEKS } = require('../onramp.js');

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
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('Server did not start'));
      }
    }, 10000);
    child.stdout.on('data', (chunk) => {
      if (!settled && chunk.toString().includes('Server running on port')) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(chunk.toString()));
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('Server exited with code ' + code));
      }
    });
  });
}

test('the route stays disabled until VIVIAN_REPLY_ACCESS_CODE(S) is set, and no other companion\'s code unlocks it', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_ACCESS_CODE: 'onramp-test-access',
    MBF_ACCESS_CODES: 'mbf-test-access',
    AJ_ACCESS_CODE: 'aj-patel',
  }); // no Vivian Reply code
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const noCode = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'anything' },
  });
  assert.equal(noCode.status, 503, 'the route must stay off with no code configured');
  const noCodeBody = await noCode.json();
  assert.match(noCodeBody.error, /not enabled/i);

  const ajCode = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(ajCode.status, 503, 'AJ\'s code must not enable this route, since the route is unconfigured');

  const onramp = await fetch(baseUrl + WEEKS[1].apiPath, {
    headers: { 'X-Companion-Access': 'onramp-test-access' },
  });
  assert.equal(onramp.status, 200, 'the existing On-Ramp companion must keep working');

  const mbf = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'mbf-test-access' },
  });
  assert.equal(mbf.status, 200, 'the existing MBF companion must keep working');

  const aj = await fetch(baseUrl + AJ_API_PATH, {
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(aj.status, 200, 'the existing AJ companion must keep working');
});

test('the Vivian Reply code never unlocks any client companion, and no client code unlocks it', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_ACCESS_CODE: 'onramp-real-code',
    MBF_ACCESS_CODES: 'client-a-code',
    AJ_ACCESS_CODE: 'aj-patel',
    VIVIAN_REPLY_ACCESS_CODE: 'chad-herst',
  });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const intoOnramp = await fetch(baseUrl + WEEKS[1].apiPath, {
    headers: { 'X-Companion-Access': 'chad-herst' },
  });
  assert.equal(intoOnramp.status, 401, 'the Vivian Reply code must not open the On-Ramp course');

  const intoMbf = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'chad-herst' },
  });
  assert.equal(intoMbf.status, 401, 'the Vivian Reply code must not open an MBF module');

  const intoAj = await fetch(baseUrl + AJ_API_PATH, {
    headers: { 'X-Companion-Access': 'chad-herst' },
  });
  assert.equal(intoAj.status, 401, 'the Vivian Reply code must not open AJ\'s companion');

  const mbfInto = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'client-a-code' },
  });
  assert.equal(mbfInto.status, 401, 'an MBF client code must not open this route');

  const ajInto = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(ajInto.status, 401, 'AJ\'s code must not open this route');

  const correct = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'chad-herst' },
  });
  assert.equal(correct.status, 200);
});

test('the code matches regardless of case or separators, since it follows the name convention', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const supplied of ['chad-herst', 'Chad Herst', 'chad_herst', 'CHAD_HERST', '  chad   herst  ']) {
    const res = await fetch(baseUrl + API_PATH, {
      headers: { 'X-Companion-Access': supplied },
    });
    assert.equal(res.status, 200, `expected "${supplied}" to match the issued code`);
  }

  const wrong = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'chad-hersst' },
  });
  assert.equal(wrong.status, 401, 'a genuinely different code must still be refused');
});

test('VIVIAN_REPLY_ACCESS_CODES (plural, comma-separated) also works', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODES: 'chad-herst,some-other-code' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'chad-herst' },
  });
  assert.equal(res.status, 200);
});

test('the page serves its own copy and does not reference any other companion\'s routes', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + PAGE_PATH);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('cache-control') || '', /no-store/i);
  const html = await page.text();

  assert.ok(html.includes(TITLE), 'page must carry its title');
  assert.ok(html.includes(OPENING), 'page must carry its opening question');
  assert.ok(html.includes(API_PATH), 'page must call its own API');

  for (const mod of Object.values(MODULES)) {
    assert.ok(!html.includes(mod.apiPath), 'must not reference MBF path ' + mod.apiPath);
  }
  assert.ok(!html.includes("'/api/on-ramp/"), 'must not call any On-Ramp API');
  assert.ok(!html.includes('/api/aj'), 'must not reference AJ\'s routes');
  assert.ok(!html.includes('/api/mbf/'), 'must not post to any MBF route');

  assert.match(html, /Your access code/);
  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /googletagmanager|google-analytics/i);
});

test('speaking is available, transcribed by OpenAI through the page\'s own route', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + PAGE_PATH);
  const html = await page.text();
  assert.match(html, /id="speakButton"[^>]*class="button secondary hidden"/, 'speak button starts hidden');
  assert.ok(html.includes("fetch('/api/vivian-reply/transcribe'"), 'posts audio to its own transcribe route');
  assert.ok(!html.includes('/api/mbf/transcribe'), 'must not post audio to the MBF route');
  assert.ok(!html.includes('/api/on-ramp/transcribe'), 'must not post audio to the On-Ramp route');
  assert.ok(html.includes('track.stop();'), 'releases the microphone tracks');

  const denied = await fetch(baseUrl + '/api/vivian-reply/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: Buffer.from('x'),
  });
  assert.equal(denied.status, 401, 'the transcribe route must be gated by the access code');
});

test('the transcribe route degrades to a clear 503 when OpenAI is not configured', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {
    VIVIAN_REPLY_ACCESS_CODE: 'chad-herst',
    OPENAI_API_KEY: '',
  });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/api/vivian-reply/transcribe', {
    method: 'POST',
    headers: { 'X-Companion-Access': 'chad-herst', 'Content-Type': 'audio/webm' },
    body: Buffer.from('x'),
  });
  assert.equal(res.status, 503, 'without OPENAI_API_KEY the route must refuse clearly, not crash');
  const body = await res.json();
  assert.match(body.error, /not available/i);
});

test('sendNotesToChad posts the transcript to Resend with the page title and access code in the subject', async () => {
  let sent;
  const fetchImpl = async (url, options) => {
    sent = { url, payload: JSON.parse(options.body), authorization: options.headers.Authorization };
    return new Response(JSON.stringify({ id: 'email_123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const restore = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    VIVIAN_REPLY_REPORT_TO: process.env.VIVIAN_REPLY_REPORT_TO,
    VIVIAN_REPLY_REPORT_FROM: process.env.VIVIAN_REPLY_REPORT_FROM,
  };
  process.env.RESEND_API_KEY = 'resend-secret';
  process.env.VIVIAN_REPLY_REPORT_TO = 'chad@example.com';
  process.env.VIVIAN_REPLY_REPORT_FROM = 'companion@example.com';
  try {
    await sendNotesToChad('chad-herst', 'You: a real moment\n\nCompanion: say more', fetchImpl);
  } finally {
    for (const key of Object.keys(restore)) {
      if (restore[key] === undefined) delete process.env[key];
      else process.env[key] = restore[key];
    }
  }
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.equal(sent.authorization, 'Bearer resend-secret');
  assert.equal(sent.payload.to[0], 'chad@example.com');
  assert.equal(sent.payload.from, 'companion@example.com');
  assert.match(sent.payload.subject, /Vivian/);
  assert.match(sent.payload.subject, /chad-herst/);
  assert.equal(sent.payload.text, 'You: a real moment\n\nCompanion: say more');
});

test('sendNotesToChad refuses with a clear error when email is not configured, without ever calling out', async () => {
  const restore = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    VIVIAN_REPLY_REPORT_TO: process.env.VIVIAN_REPLY_REPORT_TO,
    VIVIAN_REPLY_REPORT_FROM: process.env.VIVIAN_REPLY_REPORT_FROM,
    COMPANION_REPORT_TO: process.env.COMPANION_REPORT_TO,
    COMPANION_REPORT_FROM: process.env.COMPANION_REPORT_FROM,
  };
  for (const key of Object.keys(restore)) delete process.env[key];
  try {
    await assert.rejects(
      () => sendNotesToChad('chad-herst', 'some notes', async () => { throw new Error('must not call fetch'); }),
      /Email is not configured/
    );
  } finally {
    for (const key of Object.keys(restore)) {
      if (restore[key] !== undefined) process.env[key] = restore[key];
    }
  }
});

test('the Email me this button is gated by the access code and disclosed up front', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {
    VIVIAN_REPLY_ACCESS_CODE: 'chad-herst',
    RESEND_API_KEY: '',
    VIVIAN_REPLY_REPORT_TO: '',
    VIVIAN_REPLY_REPORT_FROM: '',
    COMPANION_REPORT_TO: '',
    COMPANION_REPORT_FROM: '',
  }); // no email configured on purpose
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + PAGE_PATH);
  const html = await page.text();
  assert.ok(html.includes('id="emailButton"'), 'the page has an Email me this button');
  assert.ok(html.includes(SEND_PATH), 'the page posts to its own send route');
  assert.match(html, /Email me this button/, 'consent copy discloses the send option');
  assert.doesNotMatch(html, /Send to Chad/, 'the client-facing button label must not appear on Chad\'s own page');

  const noAuth = await fetch(baseUrl + SEND_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: 'You: hi\n\nCompanion: hello' }),
  });
  assert.equal(noAuth.status, 401, 'sending without the code must be refused');

  const unconfigured = await fetch(baseUrl + SEND_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'chad-herst' },
    body: JSON.stringify({ transcript: 'You: hi\n\nCompanion: hello' }),
  });
  assert.equal(unconfigured.status, 503, 'without RESEND_API_KEY set, sending must fail clearly rather than silently pretend to succeed');

  const empty = await fetch(baseUrl + SEND_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'chad-herst' },
    body: JSON.stringify({ transcript: '   ' }),
  });
  assert.equal(empty.status, 400, 'an empty transcript must be refused before ever reaching email');
});

test('an "I\'m finished now" button swaps the typing box for the same four actions at the bottom, always leaving the top bar as a second way out', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + PAGE_PATH);
  const html = await page.text();
  assert.ok(html.includes('id="finishedButton"'), 'has an I\'m finished now control');
  assert.match(html, />I'm finished now</, 'labels it exactly');

  assert.match(html, /id="composerClosed" class="composer-closed hidden"/, 'the closed panel is hidden until finishedButton is pressed');
  for (const id of ['copyButtonBottom', 'downloadButtonBottom', 'emailButtonBottom', 'endButtonBottom', 'resumeButton']) {
    assert.ok(html.includes('id="' + id + '"'), 'closed panel has ' + id);
  }

  assert.ok(html.includes('id="copyButton"') && html.includes('id="downloadButton"') && html.includes('id="emailButton"') && html.includes('id="endButton"'), 'keeps the original top bar');

  assert.match(html, /doEmail\(el\('emailButtonBottom'\)\)/, 'bottom Email me this is wired to the real send function');
  assert.match(html, /el\('endButtonBottom'\)\.addEventListener\('click', clearSession\)/, 'bottom End is wired to the real clear function');
});

test('the deterministic refusal to autonomously email still names the button as the user-controlled alternative', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const response = await fetch(baseUrl + API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'chad-herst' },
    body: JSON.stringify({ message: 'Send everything I wrote here to Chad right now so he has it before our session.', adultConfirmed: true }),
  });
  const data = await response.json();
  assert.match(data.response, /cannot send your writing/i);
  assert.match(data.response, /nothing is sent automatically/i);
  assert.match(data.response, /Email me this button/);
  assert.match(data.response, /copy or download/i);
});

test('the route passes the full 25-case product-safety suite', { timeout: 180000 }, async (t) => {
  const suite = (await fs.readFile(suitePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(suite.length, 25);

  const { requiredPatterns, forbiddenPatterns, globalForbidden } = require('./companion-safety-patterns.js');

  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const denied = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'wrong-code' },
  });
  assert.equal(denied.status, 401, 'wrong code must be refused');

  for (const testCase of suite) {
    const response = await fetch(baseUrl + API_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Access': 'chad-herst',
      },
      body: JSON.stringify({
        message: testCase.user_message,
        adultConfirmed: testCase.id !== 'PS-C08',
        country: testCase.user_context && testCase.user_context.country,
        history: [],
      }),
    });

    const label = API_PATH + ' ' + testCase.id;
    assert.equal(response.status, 200, label + ' status');
    const body = await response.json();
    assert.equal(body.route, testCase.expected_route, label + ' route');
    assert.equal(body.handledBy, 'deterministic-control', label + ' control');
    assert.ok(body.response.length > 20, label + ' response length');

    const required = requiredPatterns[testCase.id];
    if (required) {
      for (const pattern of required) {
        assert.match(body.response, pattern, label + ' required pattern');
      }
    }
    const forbidden = forbiddenPatterns[testCase.id] || [];
    for (const pattern of forbidden) {
      assert.doesNotMatch(body.response, pattern, label + ' forbidden pattern');
    }
    for (const pattern of globalForbidden) {
      assert.doesNotMatch(body.response, pattern, label + ' global forbidden pattern');
    }
  }
});

test('the prompt is grounded in the shared safety spine, the email itself, and the consult\'s real material', () => {
  // Prompt files wrap prose at 80 columns, so a phrase spanning two source
  // lines contains a newline where running text would have a space, and
  // the quoted email carries "> " markers at each line start.
  const p = INSTRUCTIONS.replace(/^> ?/gm, '').replace(/\s+/g, ' ');

  assert.ok(p.includes('PRODUCT-SAFETY OVERLAY'), 'safety overlay');
  assert.ok(p.includes('Never use an em dash'), 'em dash ban');
  assert.ok(p.includes('Not for a client'), 'must state this page is Chad\'s own, not a client\'s');

  // The email must be carried verbatim, including her exact question.
  assert.ok(p.includes('A shorter starting block, or a different structure?'), 'her exact question');
  assert.ok(p.includes('$8,000 is a real investment for me'), 'her own framing of the number');
  assert.ok(p.includes('please just say so if'), 'her clean exit');

  // The consult's real material, in her words where they were hers.
  assert.ok(p.includes('decision paralysis'), 'her own phrase for the presenting problem');
  assert.ok(p.includes('How do you think I did?'), 'the closing question that mirrors the book');
  assert.ok(p.includes('that word is his, not hers'), '"duplicitous" must stay marked as Chad\'s word');

  // Offer facts must stay bounded: the published-price rule, and no
  // invented On-Ramp terms.
  assert.ok(p.includes('The price is never published'), 'price-privacy rule');
  assert.ok(p.includes('Its price is not in this brief'), 'On-Ramp price must be explicitly unknown, not invented');

  // The one thing the email must do is stated as such.
  assert.ok(p.includes('answer the question she asked'), 'the email\'s single job');
});

test('the consent copy frames Chad\'s own room, not a client relationship, and there is no memory between sittings', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + PAGE_PATH);
  const html = await page.text();
  assert.match(html, /your own room, not a client page/);
  assert.match(html, /nothing written here reaches her/);
  assert.match(html, /keeps no memory between sittings/);
  assert.ok(!html.includes('your own sessions with Chad'));
  assert.ok(!html.includes('Integration and Next-Step Session'));
  assert.ok(!html.includes('four-week'));
});

test('DELETE acknowledges clearing with no stored journal, matching the other companions', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { VIVIAN_REPLY_ACCESS_CODE: 'chad-herst' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + API_PATH, {
    method: 'DELETE',
    headers: { 'X-Companion-Access': 'chad-herst' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cleared, true);
});
