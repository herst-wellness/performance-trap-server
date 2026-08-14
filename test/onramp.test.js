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

  const kotb = await fetch(baseUrl + '/api/kids-on-the-bus', {
    headers: { 'X-Companion-Access': 'test-access' },
  });
  assert.equal(kotb.status, 200, 'the existing Kids on the Bus route must keep working');
});

test('the index and all four weekly pages serve their own copy, and each page talks to its own API path', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

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
  assert.match(w(4), /Gathering for the closing session/);

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
