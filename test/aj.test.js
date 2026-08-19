// AJ's single-client companion. It shares the identical deterministic
// safety layer proven on Kids on the Bus, On-Ramp, and MBF, so the same
// 25-case product-safety suite must pass against this route too. Plus
// AJ-specifics: access is gated by its own AJ_ACCESS_CODES, fully separate
// from every other companion's codes in both directions; the page carries
// no other companion's API path; and unlike MBF/On-Ramp, this companion is
// text-only, so there is no Speak button, no mic handling, and no
// transcribe route.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const suitePath = path.join(__dirname, 'module-2-product-safety-evaluation-set.jsonl');
const { TITLE, OPENING, PAGE_PATH, API_PATH, INSTRUCTIONS } = require('../aj.js');
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

test('the AJ route stays disabled until AJ_ACCESS_CODE(S) is set, and no other companion\'s code unlocks it', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_ACCESS_CODE: 'onramp-test-access',
    MBF_ACCESS_CODES: 'mbf-test-access',
  }); // no AJ code
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const noCode = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'anything' },
  });
  assert.equal(noCode.status, 503, 'AJ route must stay off with no AJ code configured');
  const noCodeBody = await noCode.json();
  assert.match(noCodeBody.error, /not enabled/i);

  const mbfCode = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'mbf-test-access' },
  });
  assert.equal(mbfCode.status, 503, 'an MBF code must not enable the AJ route, since the AJ route is unconfigured');

  const onramp = await fetch(baseUrl + WEEKS[1].apiPath, {
    headers: { 'X-Companion-Access': 'onramp-test-access' },
  });
  assert.equal(onramp.status, 200, 'the existing On-Ramp companion must keep working');

  const mbf = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'mbf-test-access' },
  });
  assert.equal(mbf.status, 200, 'the existing MBF companion must keep working');
});

test('an AJ code never unlocks MBF or On-Ramp, and neither of those codes unlocks AJ', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_ACCESS_CODE: 'onramp-real-code',
    MBF_ACCESS_CODES: 'client-a-code',
    AJ_ACCESS_CODE: 'aj-patel',
  });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const ajIntoOnramp = await fetch(baseUrl + WEEKS[1].apiPath, {
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(ajIntoOnramp.status, 401, 'the AJ code must not open the On-Ramp course');

  const ajIntoMbf = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(ajIntoMbf.status, 401, 'the AJ code must not open an MBF module');

  const mbfIntoAj = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'client-a-code' },
  });
  assert.equal(mbfIntoAj.status, 401, 'an MBF client code must not open the AJ route');

  const onrampIntoAj = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'onramp-real-code' },
  });
  assert.equal(onrampIntoAj.status, 401, 'an On-Ramp course code must not open the AJ route');

  const correct = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(correct.status, 200);
});

test('the AJ code matches regardless of case or separators, since it is issued as a name', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { AJ_ACCESS_CODE: 'aj-patel' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const supplied of ['aj-patel', 'AJ Patel', 'aj_patel', 'AJ_PATEL', '  aj   patel  ']) {
    const res = await fetch(baseUrl + API_PATH, {
      headers: { 'X-Companion-Access': supplied },
    });
    assert.equal(res.status, 200, `expected "${supplied}" to match the issued code`);
  }

  const wrong = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'aj-patell' },
  });
  assert.equal(wrong.status, 401, 'a genuinely different code must still be refused');
});

test('AJ_ACCESS_CODES (plural, comma-separated) also works', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { AJ_ACCESS_CODES: 'aj-patel,some-other-code' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + API_PATH, {
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(res.status, 200);
});

test('the AJ page serves its own copy and does not reference any other companion or the transcribe route', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { AJ_ACCESS_CODE: 'aj-patel' });
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
  assert.ok(!html.includes('/api/mbf/transcribe'), 'must not reference the MBF transcribe route');
  assert.ok(!html.includes('/api/aj/transcribe'), 'must not reference an AJ transcribe route');
  assert.ok(!html.includes('/api/on-ramp/transcribe'), 'must not reference the On-Ramp transcribe route');
  assert.ok(!/id="speakButton"/.test(html), 'must not include a Speak button');
  assert.ok(!/MediaRecorder/.test(html), 'must not include recorder handling');
  assert.ok(!/getUserMedia/.test(html), 'must not include mic permission handling');

  assert.match(html, /Your access code/);
  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /googletagmanager|google-analytics/i);
});

test('a request to the AJ transcribe path is not handled by this route (falls through)', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { AJ_ACCESS_CODE: 'aj-patel' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/api/aj/transcribe', {
    method: 'POST',
    headers: { 'X-Companion-Access': 'aj-patel', 'Content-Type': 'audio/webm' },
    body: Buffer.from('x'),
  });
  // No route in the server handles this path, so it should fall through to
  // whatever the server's default (non-companion) response is, not the
  // deliberately AJ-shaped 401/503/200 responses the API path itself gives.
  assert.notEqual(res.status, 200, '/api/aj/transcribe must not be treated as a valid AJ API call');
});

test('the AJ route passes the full 25-case product-safety suite', { timeout: 180000 }, async (t) => {
  const suite = (await fs.readFile(suitePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(suite.length, 25);

  const { requiredPatterns, forbiddenPatterns, globalForbidden } = require('./companion-safety-patterns.js');

  const port = await getOpenPort();
  const child = await startServer(port, { AJ_ACCESS_CODE: 'aj-patel' });
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
        'X-Companion-Access': 'aj-patel',
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

test('the AJ prompt is grounded in the shared safety spine and in AJ\'s own real vocabulary', () => {
  // Prompt files wrap prose at 80 columns, so a phrase spanning two source
  // lines contains a newline where running text would have a space.
  const p = INSTRUCTIONS.replace(/\s+/g, ' ');

  assert.ok(p.includes('Ask, never invent'), 'core epistemic rule');
  assert.ok(p.includes('What genuinely calls for Chad, live, not this page'), 'referral section');
  assert.ok(p.includes('PRODUCT-SAFETY OVERLAY'), 'safety overlay');
  assert.ok(p.includes('Never use an em dash'), 'em dash ban');

  // AJ's own real, method-specific vocabulary must be present.
  assert.ok(p.toLowerCase().includes('brain fog'), 'must carry AJ\'s own term "brain fog"');
  assert.ok(p.includes('Feel normal'), 'must carry AJ\'s own term "feel normal"');
  assert.ok(p.includes('Pot committed'), 'must carry AJ\'s own term "pot committed"');
  assert.ok(p.includes('shame spiral'), 'must carry AJ\'s own term "shame spiral"');
  // Words that belonged to Chad, not AJ, were removed after a transcript
  // re-read; they must not creep back in as though they were AJ's own.
  assert.ok(!p.toLowerCase().includes('purgatory'), 'Purgatory was Chad\'s word, not AJ\'s');
  assert.ok(!p.toLowerCase().includes('slippery'), 'slippery was Chad\'s word, not AJ\'s');
});

test('the consent copy frames an ongoing client relationship, not a course, and there is no memory between sittings', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { AJ_ACCESS_CODE: 'aj-patel' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + PAGE_PATH);
  const html = await page.text();
  assert.match(html, /your own sessions with Chad/);
  assert.match(html, /your real sessions with him/);
  assert.match(html, /keeps no memory between sittings/);
  assert.ok(!html.includes('Integration and Next-Step Session'));
  assert.ok(!html.includes('four-week'));
});

test('DELETE acknowledges clearing with no stored journal, matching the other companions', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { AJ_ACCESS_CODE: 'aj-patel' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + API_PATH, {
    method: 'DELETE',
    headers: { 'X-Companion-Access': 'aj-patel' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cleared, true);
});
