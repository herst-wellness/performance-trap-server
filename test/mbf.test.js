// Eight Mind/Body Foundations module companions, each replacing that
// module's written journal. They share the identical deterministic safety
// layer proven on Kids on the Bus and On-Ramp, so the same 25-case
// product-safety suite must pass against every one of the eight routes.
// Plus MBF specifics: access is gated by its own MBF_ACCESS_CODES, kept
// fully separate from the On-Ramp course's codes in both directions (an
// On-Ramp customer must never reach a real client's module companion, and
// vice versa); each module's page talks to its own API path; each module's
// prompt is grounded in that module's real journal and carries no other
// module's material; speaking works the same way it does on On-Ramp.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const suitePath = path.join(__dirname, 'module-2-product-safety-evaluation-set.jsonl');
const { MODULES, INDEX_PATH } = require('../mbf.js');
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

test('every module route stays disabled until MBF_ACCESS_CODES is set, and neither companion unlocks the other', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' }); // no MBF code
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const mod of Object.values(MODULES)) {
    const res = await fetch(baseUrl + mod.apiPath, {
      headers: { 'X-Companion-Access': 'onramp-test-access' },
    });
    assert.equal(res.status, 503, mod.apiPath + ' must stay off with no MBF code configured');
    const body = await res.json();
    assert.match(body.error, /not enabled/i);
  }

  const onramp = await fetch(baseUrl + WEEKS[1].apiPath, {
    headers: { 'X-Companion-Access': 'onramp-test-access' },
  });
  assert.equal(onramp.status, 200, 'the existing On-Ramp companion must keep working');
});

test('an MBF code never unlocks On-Ramp, and an On-Ramp code never unlocks MBF', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_ACCESS_CODE: 'onramp-real-code',
    MBF_ACCESS_CODES: 'client-a-code,client-b-code',
  });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const mbfIntoOnramp = await fetch(baseUrl + WEEKS[1].apiPath, {
    headers: { 'X-Companion-Access': 'client-a-code' },
  });
  assert.equal(mbfIntoOnramp.status, 401, 'an MBF client code must not open the On-Ramp course');

  const onrampIntoMbf = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'onramp-real-code' },
  });
  assert.equal(onrampIntoMbf.status, 401, 'an On-Ramp course code must not open a real client\'s module');

  const correct = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'client-a-code' },
  });
  assert.equal(correct.status, 200);
});

test('a client name code matches regardless of case or spacing, since codes are now issued as names', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { MBF_ACCESS_CODES: 'danny-lowenthal' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const supplied of ['danny-lowenthal', 'Danny Lowenthal', 'DANNY-LOWENTHAL', '  danny   lowenthal  ']) {
    const res = await fetch(baseUrl + MODULES[1].apiPath, {
      headers: { 'X-Companion-Access': supplied },
    });
    assert.equal(res.status, 200, `expected "${supplied}" to match the issued code`);
  }

  const wrongPerson = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'danny-lowenthall' },
  });
  assert.equal(wrongPerson.status, 401, 'a genuinely different code must still be refused');
});

test('one MBF client code does not unlock the module if another client\'s code is revoked', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { MBF_ACCESS_CODES: 'still-valid-code' }); // client-b removed
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const revoked = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'client-b-code' },
  });
  assert.equal(revoked.status, 401, 'a revoked client code must be refused without affecting others');

  const stillValid = await fetch(baseUrl + MODULES[1].apiPath, {
    headers: { 'X-Companion-Access': 'still-valid-code' },
  });
  assert.equal(stillValid.status, 200);
});

test('the index and all eight module pages serve their own copy, and each page talks to its own API path', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { MBF_ACCESS_CODES: 'mbf-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const index = await fetch(baseUrl + INDEX_PATH);
  assert.equal(index.status, 200);
  const indexHtml = await index.text();
  for (const mod of Object.values(MODULES)) {
    assert.match(indexHtml, new RegExp(mod.pagePath.replace(/[/-]/g, '\\$&')));
  }

  for (const mod of Object.values(MODULES)) {
    const page = await fetch(baseUrl + mod.pagePath);
    assert.equal(page.status, 200, mod.pagePath);
    assert.match(page.headers.get('cache-control') || '', /no-store/i);
    const html = await page.text();
    assert.ok(html.includes(mod.title), mod.pagePath + ' title');
    assert.ok(html.includes(mod.opening), mod.pagePath + ' opening question');
    assert.ok(html.includes(mod.apiPath), mod.pagePath + ' must call its own API');
    assert.ok(!html.includes('/api/kids-on-the-bus'), mod.pagePath + ' must not call the Kids on the Bus API');
    assert.ok(!html.includes("'/api/on-ramp/"), mod.pagePath + ' must not call any On-Ramp API');
    // Every other module's page path must be absent, so one module's HTML
    // can never accidentally embed a link or fetch target into another.
    for (const other of Object.values(MODULES)) {
      if (other === mod) continue;
      assert.ok(!html.includes(other.apiPath), mod.pagePath + ' must not reference ' + other.apiPath);
    }
    assert.match(html, /Your access code/);
    assert.doesNotMatch(html, /—/);
    assert.doesNotMatch(html, /googletagmanager|google-analytics/i);
  }
});

test('all eight module routes pass the full 25-case product-safety suite', { timeout: 180000 }, async (t) => {
  const suite = (await fs.readFile(suitePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(suite.length, 25);

  const { requiredPatterns, forbiddenPatterns, globalForbidden } = require('./companion-safety-patterns.js');

  const port = await getOpenPort();
  const child = await startServer(port, { MBF_ACCESS_CODES: 'mbf-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const mod of Object.values(MODULES)) {
    const denied = await fetch(baseUrl + mod.apiPath, {
      headers: { 'X-Companion-Access': 'wrong-code' },
    });
    assert.equal(denied.status, 401, mod.apiPath + ' wrong code');

    for (const testCase of suite) {
      const response = await fetch(baseUrl + mod.apiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Companion-Access': 'mbf-test-access',
        },
        body: JSON.stringify({
          message: testCase.user_message,
          adultConfirmed: testCase.id !== 'PS-C08',
          country: testCase.user_context && testCase.user_context.country,
          history: [],
        }),
      });

      const label = mod.apiPath + ' ' + testCase.id;
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
  }
});

test('module prompts are grounded in that module\'s own real journal and carry no other module\'s material', () => {
  // Prompt files wrap prose at 80 columns, so a phrase spanning two source
  // lines contains a newline where running text would have a space.
  // Normalize whitespace before substring checks so a wrap point can't
  // masquerade as a missing sentence.
  const p = (n) => MODULES[n].instructions.replace(/\s+/g, ' ');

  // Shared spine in all eight.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.ok(p(n).includes('Ask, never invent'), 'module ' + n + ' core epistemic rule');
    assert.ok(p(n).includes('Close by making the rep usable') === false, 'MBF close is its own text, not the On-Ramp close');
    assert.ok(p(n).includes('What genuinely calls for Chad, live, not this page'), 'module ' + n + ' carries the referral section');
    assert.ok(p(n).includes('PRODUCT-SAFETY OVERLAY'), 'module ' + n + ' carries the safety overlay');
    assert.ok(p(n).includes('Never use an em dash'), 'module ' + n + ' bans em dashes');
  }

  // Each module's own real, journal-specific vocabulary must be present,
  // and must not leak into a module it doesn't belong to.
  const signature = {
    1: 'Turn it around',
    2: 'Which kid took the wheel',
    3: 'Titration, three passes',
    4: 'the want you buried',
    5: 'sacred wound',
    6: 'topic sentence',
    7: 'aperture',
    8: "hero's journey",
  };
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.ok(p(n).toLowerCase().includes(signature[n].toLowerCase()), 'module ' + n + ' must carry its own signature vocabulary');
    for (const other of [1, 2, 3, 4, 5, 6, 7, 8]) {
      if (other === n) continue;
      assert.ok(!p(n).toLowerCase().includes(signature[other].toLowerCase()),
        'module ' + n + ' must not carry module ' + other + '\'s signature vocabulary (' + signature[other] + ')');
    }
  }

  // Module 6's real live vocabulary must correct the curriculum's own
  // unsupported claim, not repeat it: "STEP" and "the trade" may be named
  // only to say the pivot doesn't happen, never instructed as this
  // module's actual content.
  assert.ok(p(6).includes('grain of salt'), 'module 6 must flag the curriculum claim as unreliable');
  assert.ok(p(6).includes('essentially never happens'), 'module 6 must state plainly that the trade pivot is not real');
  assert.doesNotMatch(p(6), /catch the trade|watch for the trade|ask about the trade|name the trade/i);

  // Module 8 must never let the companion speak as Chad or invent detail
  // beyond what the client themselves references from the printed reading.
  assert.match(p(8), /never speak as though you are Chad/i);
  assert.match(p(8), /never add detail to/i);
});

test('speaking is available on every module, transcribed by OpenAI through the MBF-specific route', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { MBF_ACCESS_CODES: 'mbf-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const mod of Object.values(MODULES)) {
    const page = await fetch(baseUrl + mod.pagePath);
    const html = await page.text();
    assert.match(html, /id="speakButton"[^>]*class="button secondary hidden"/, mod.pagePath + ' speak button starts hidden');
    assert.ok(html.includes("fetch('/api/mbf/transcribe'"), mod.pagePath + ' posts audio to the MBF transcribe route');
    assert.ok(!html.includes('/api/on-ramp/transcribe'), mod.pagePath + ' must not post audio to the On-Ramp route');
    assert.ok(html.includes('track.stop();'), mod.pagePath + ' releases the microphone tracks');
  }

  const denied = await fetch(baseUrl + '/api/mbf/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: Buffer.from('x'),
  });
  assert.equal(denied.status, 401, 'the MBF transcribe route must be gated by an MBF code');
});

test('the consent copy is written for an ongoing client relationship, not a course', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { MBF_ACCESS_CODES: 'mbf-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + MODULES[1].pagePath);
  const html = await page.text();
  assert.match(html, /replaces the written journal/);
  assert.match(html, /your real sessions with him/);
  // This is not the On-Ramp course, so its course-specific naming should
  // not appear on an MBF page.
  assert.ok(!html.includes('Integration and Next-Step Session'));
  assert.ok(!html.includes('four-week'));
});
