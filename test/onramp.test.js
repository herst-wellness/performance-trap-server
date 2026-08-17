// The four On-Ramp weekly companions share the Kids on the Bus
// deterministic safety layer, so the identical 25-case product-safety
// suite must pass against every weekly route. Plus On-Ramp specifics: all
// routes disabled until ONRAMP_ACCESS_CODE is set (and never unlocked by
// the Kids on the Bus code), each week's page carries its own copy and
// talks to its OWN API path (a real bug in the first build: the page still
// pointed at the Kids on the Bus API), week prompts are scoped to their
// week's moves, and the raised ceilings + empty-response retry from the
// 28-case evaluation are configured.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const suitePath = path.join(__dirname, 'module-2-product-safety-evaluation-set.jsonl');
const { WEEKS, INDEX_PATH } = require('../onramp.js');

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

test('every weekly route stays disabled until ONRAMP_ACCESS_CODE is set, and the Kids on the Bus code never unlocks it', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {}); // no ONRAMP_ACCESS_CODE
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const week of Object.values(WEEKS)) {
    const res = await fetch(baseUrl + week.apiPath, {
      headers: { 'X-Companion-Access': 'test-access' },
    });
    assert.equal(res.status, 503, week.apiPath);
    const body = await res.json();
    assert.match(body.error, /not enabled/i);
  }

  const kotb = await fetch(baseUrl + '/reflect/kids-on-the-bus');
  assert.equal(kotb.status, 200, 'the existing companion page must keep working');
});

test('the index and all four weekly pages serve their own copy, and each page talks to its own API path', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const audio = await fetch(baseUrl + '/audio/onramp-breath-12min.mp3', { method: 'GET' });
  assert.equal(audio.status, 200, 'the breathing recording must be served');
  assert.match(audio.headers.get('content-type') || '', /audio\/mpeg/);
  audio.body && audio.body.cancel && audio.body.cancel();

  const index = await fetch(baseUrl + INDEX_PATH);
  assert.equal(index.status, 200);
  const indexHtml = await index.text();
  for (const week of Object.values(WEEKS)) {
    assert.match(indexHtml, new RegExp(week.pagePath.replace(/[/-]/g, '\\$&')));
  }

  for (const week of Object.values(WEEKS)) {
    const page = await fetch(baseUrl + week.pagePath);
    assert.equal(page.status, 200, week.pagePath);
    assert.match(page.headers.get('cache-control') || '', /no-store/i);
    const html = await page.text();
    assert.ok(html.includes(week.title), week.pagePath + ' title');
    assert.ok(html.includes(week.opening), week.pagePath + ' opening question');
    assert.ok(html.includes(week.apiPath), week.pagePath + ' must call its own API');
    assert.ok(!html.includes('/api/kids-on-the-bus'), week.pagePath + ' must not call the Kids on the Bus API');
    assert.ok(!html.includes('/api/on-ramp\''), week.pagePath + ' must not call the retired single-app API');
    assert.match(html, /Private prototype/);
    assert.doesNotMatch(html, /googletagmanager|google-analytics/i);
    assert.doesNotMatch(html, /—/);
    // Chad removed the consent checkboxes and country selector on 8/16;
    // the informational scope line and the breath recording replace them.
    assert.doesNotMatch(html, /adultCheck|scopeCheck|id="country"/, week.pagePath + ' must not carry the removed consent controls');
    assert.ok(html.includes('/audio/onramp-breath-12min.mp3'), week.pagePath + ' must offer the 12-minute breathing recording');
    assert.match(html, /not therapy, medical care, diagnosis, or crisis support/);
  }
});

test('all four weekly routes pass the full 25-case product-safety suite', { timeout: 120000 }, async (t) => {
  const suite = (await fs.readFile(suitePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(suite.length, 25);

  const { requiredPatterns, forbiddenPatterns, globalForbidden } = require('./companion-safety-patterns.js');

  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const week of Object.values(WEEKS)) {
    const denied = await fetch(baseUrl + week.apiPath, {
      headers: { 'X-Companion-Access': 'wrong-code' },
    });
    assert.equal(denied.status, 401, week.apiPath + ' wrong code');

    for (const testCase of suite) {
      const response = await fetch(baseUrl + week.apiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Companion-Access': 'onramp-test-access',
        },
        body: JSON.stringify({
          message: testCase.user_message,
          adultConfirmed: testCase.id !== 'PS-C08',
          country: testCase.user_context && testCase.user_context.country,
          history: [],
        }),
      });

      const label = week.apiPath + ' ' + testCase.id;
      assert.equal(response.status, 200, label + ' status');
      const body = await response.json();
      assert.equal(body.route, testCase.expected_route, label + ' route');
      assert.equal(body.handledBy, 'deterministic-control', label + ' control');
      assert.ok(body.response.length > 20, label + ' response length');

      for (const pattern of requiredPatterns[testCase.id] || []) {
        assert.match(body.response, pattern, label + ' missing ' + pattern);
      }
      for (const pattern of forbiddenPatterns[testCase.id] || []) {
        assert.doesNotMatch(body.response, pattern, label + ' included ' + pattern);
      }
      for (const pattern of globalForbidden) {
        assert.doesNotMatch(body.response, pattern, label + ' included ' + pattern);
      }
    }
  }
});

test('week prompts are scoped to their week and share the core, safety overlay, and evaluation-driven config', () => {
  const w = (n) => WEEKS[n].instructions;

  // Shared spine in all four
  for (const n of [1, 2, 3, 4]) {
    assert.match(w(n), /On-Ramp Daily Practice Companion/, 'week ' + n + ' identity');
    assert.match(w(n), /PRODUCT-SAFETY OVERLAY/, 'week ' + n + ' overlay');
    assert.match(w(n), /straightaways/, 'week ' + n + ' straightaways rule');
    assert.doesNotMatch(w(n), /—/, 'week ' + n + ' no em dashes');
  }

  // Week 1: first half of SENSE only, no titration mechanics, no STEP method
  assert.match(w(1), /first half of SENSE/);
  assert.doesNotMatch(w(1), /## The method: STEP/);
  assert.doesNotMatch(w(1), /Dosing down/);

  // Week 2: full SENSE, still no STEP method section
  assert.match(w(2), /Dosing down/);
  assert.doesNotMatch(w(2), /## The method: STEP/);

  // Weeks 3 and 4: full toolkit
  assert.match(w(3), /## The method: STEP/);
  assert.match(w(4), /## The method: STEP/);
  assert.match(w(4), /Gathering for the Integration and Next-Step Session/);

  // Gating language: meet later-week material, never refuse it
  assert.match(w(1), /never refuse or defer/i);
  assert.match(w(2), /never imply the material was wrong to bring/);

  // Evaluation-driven config
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'onramp.js'), 'utf8');
  assert.match(source, /const NORMAL_OUTPUT_TOKENS = 4096;/);
  assert.match(source, /const RETRY_OUTPUT_TOKENS = 12288;/);
  assert.match(source, /empty_text/, 'the empty-response retry must be present');
  assert.match(source, /ONRAMP_ACCESS_CODE/);
});

test('course pages: public overview, gated lesson content, companion links, and the multi-code enrollment list', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  // Two personal codes via the list, none via the singular variable.
  const child = await startServer(port, { ONRAMP_ACCESS_CODES: 'amber-fox-12, quiet-river-8' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const overview = await fetch(baseUrl + '/course/on-ramp');
  assert.equal(overview.status, 200);
  const overviewHtml = await overview.text();
  assert.match(overviewHtml, /Performance Trap Practice/);
  assert.match(overviewHtml, /week-1/);
  assert.doesNotMatch(overviewHtml, /straw breath/i, 'lesson content must not leak into the public overview');

  for (const n of [1, 2, 3, 4]) {
    const page = await fetch(baseUrl + '/course/on-ramp/week-' + n);
    assert.equal(page.status, 200, 'week ' + n + ' page');
    const html = await page.text();
    assert.match(html, /Enrolled\?/, 'week ' + n + ' page must show the unlock card');
    assert.doesNotMatch(html, /keep the signal silent|straw breath/i, 'lesson content must not be embedded in the page source');
    assert.doesNotMatch(html, /—/);

    const denied = await fetch(baseUrl + '/course/on-ramp/api/week-' + n, {
      headers: { 'X-Companion-Access': 'wrong-code' },
    });
    assert.equal(denied.status, 401, 'week ' + n + ' content denied without a valid code');

    for (const code of ['amber-fox-12', 'quiet-river-8']) {
      const content = await fetch(baseUrl + '/course/on-ramp/api/week-' + n, {
        headers: { 'X-Companion-Access': code },
      });
      assert.equal(content.status, 200, 'week ' + n + ' content with code ' + code);
      const payload = await content.json();
      assert.ok(payload.contentHtml.includes('/practice/on-ramp/week-' + n), 'week ' + n + ' must link its companion');
      assert.ok(!payload.contentHtml.includes('—'), 'week ' + n + ' content must not contain an em dash');
    }

    // The same personal code must unlock the companion too.
    const companion = await fetch(baseUrl + '/api/on-ramp/week-' + n, {
      headers: { 'X-Companion-Access': 'amber-fox-12' },
    });
    assert.equal(companion.status, 200, 'week ' + n + ' companion with a list code');
  }

  // Week 1 content carries the recorded sit; week 4 carries the closing section.
  const w1 = await (await fetch(baseUrl + '/course/on-ramp/api/week-1', { headers: { 'X-Companion-Access': 'amber-fox-12' } })).json();
  assert.ok(w1.contentHtml.includes('/audio/onramp-breath-12min.mp3'));
  const w4 = await (await fetch(baseUrl + '/course/on-ramp/api/week-4', { headers: { 'X-Companion-Access': 'amber-fox-12' } })).json();
  assert.match(w4.contentHtml, /Integration and Next-Step Session/);
});

test('PayPal self-serve enrollment: off by default, and a mocked full checkout issues a working signed code', { timeout: 30000 }, async (t) => {
  const http = require('node:http');

  // A tiny stand-in for PayPal: token, create order, capture as COMPLETED
  // at the configured price.
  const paypalMock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/oauth2/token') {
        res.end(JSON.stringify({ access_token: 'mock-token' }));
      } else if (req.url === '/v2/checkout/orders') {
        res.end(JSON.stringify({ id: 'ORDER-123' }));
      } else if (req.url === '/v2/checkout/orders/ORDER-123/capture') {
        res.end(JSON.stringify({
          status: 'COMPLETED',
          // PayPal returns the amount WITH decimals even when the order was
          // created without them; the mock must mimic that, because a
          // text-equality check against this exact shape once let a real
          // captured payment go uncredited.
          purchase_units: [{ payments: { captures: [{ status: 'COMPLETED', amount: { currency_code: 'USD', value: '299.00' } }] } }],
        }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise((resolve) => paypalMock.listen(0, '127.0.0.1', resolve));
  t.after(() => paypalMock.close());
  const paypalUrl = 'http://127.0.0.1:' + paypalMock.address().port;

  // Without PayPal config: endpoints refuse, overview shows the personal-enrollment text.
  const portOff = await getOpenPort();
  const childOff = await startServer(portOff, { ONRAMP_ACCESS_CODES: 'x-1' });
  t.after(() => childOff.kill());
  const offBase = 'http://127.0.0.1:' + portOff;
  const offCreate = await fetch(offBase + '/course/on-ramp/api/paypal/create-order', { method: 'POST' });
  assert.equal(offCreate.status, 503);
  const offHtml = await (await fetch(offBase + '/course/on-ramp')).text();
  assert.match(offHtml, /Chad sets you up directly/);
  assert.doesNotMatch(offHtml, /paypalButtons/);

  // With full config: the overview offers checkout, and the flow issues a code.
  const portOn = await getOpenPort();
  const childOn = await startServer(portOn, {
    ONRAMP_CODE_SECRET: 'test-code-secret',
    ONRAMP_PRICE_USD: '299',
    PAYPAL_CLIENT_ID: 'mock-client',
    PAYPAL_CLIENT_SECRET: 'mock-secret',
    PAYPAL_BASE_URL: paypalUrl,
  });
  t.after(() => childOn.kill());
  const onBase = 'http://127.0.0.1:' + portOn;

  const onHtml = await (await fetch(onBase + '/course/on-ramp')).text();
  assert.match(onHtml, /Enroll yourself/);
  assert.match(onHtml, /\$299/);
  assert.match(onHtml, /paypalButtons/);
  assert.match(onHtml, /shown only once/);

  const created = await (await fetch(onBase + '/course/on-ramp/api/paypal/create-order', { method: 'POST' })).json();
  assert.equal(created.orderId, 'ORDER-123');

  const captured = await fetch(onBase + '/course/on-ramp/api/paypal/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 'ORDER-123' }),
  });
  assert.equal(captured.status, 200);
  const { accessCode } = await captured.json();
  assert.match(accessCode, /^mb-[a-f0-9]{8}-[a-f0-9]{10}$/);

  // The issued code opens lesson content and the companion, without being
  // in any enrollment list.
  const lesson = await fetch(onBase + '/course/on-ramp/api/week-2', { headers: { 'X-Companion-Access': accessCode } });
  assert.equal(lesson.status, 200);
  const companion = await fetch(onBase + '/api/on-ramp/week-2', { headers: { 'X-Companion-Access': accessCode } });
  assert.equal(companion.status, 200);

  // A tampered code does not.
  const tampered = accessCode.slice(0, -1) + (accessCode.endsWith('0') ? '1' : '0');
  const denied = await fetch(onBase + '/course/on-ramp/api/week-2', { headers: { 'X-Companion-Access': tampered } });
  assert.equal(denied.status, 401);
});
