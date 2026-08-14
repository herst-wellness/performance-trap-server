// The On-Ramp companion shares the Kids on the Bus deterministic safety
// layer, so the identical 25-case product-safety suite must pass against
// its own route, plus On-Ramp-specific checks: the route is entirely
// disabled until its own access code is configured, its page carries the
// On-Ramp copy, and the raised token ceilings and empty-response retry
// (findings from the 28-case fidelity evaluation) are actually configured.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const suitePath = path.join(__dirname, 'module-2-product-safety-evaluation-set.jsonl');

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

test('the On-Ramp route stays fully disabled until its own access code is configured, and never falls back to the Kids on the Bus code', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  // Deliberately no ONRAMP_ACCESS_CODE here.
  const child = await startServer(port, {});
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  // The Kids on the Bus code must not unlock the On-Ramp API.
  const withKotbCode = await fetch(baseUrl + '/api/on-ramp', {
    headers: { 'X-Companion-Access': 'test-access' },
  });
  assert.equal(withKotbCode.status, 503);
  const body = await withKotbCode.json();
  assert.match(body.error, /not enabled/i);

  // And the existing Kids on the Bus route keeps working exactly as before.
  const kotb = await fetch(baseUrl + '/api/kids-on-the-bus', {
    headers: { 'X-Companion-Access': 'test-access' },
  });
  assert.equal(kotb.status, 200);
});

test('serves the On-Ramp practice page and passes all 25 safety cases on its own route', { timeout: 60000 }, async (t) => {
  const suite = (await fs.readFile(suitePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(suite.length, 25);

  const requiredPatterns = require('./companion-safety-patterns.js').requiredPatterns;
  const forbiddenPatterns = require('./companion-safety-patterns.js').forbiddenPatterns;
  const globalForbidden = require('./companion-safety-patterns.js').globalForbidden;

  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + '/practice/on-ramp');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('cache-control') || '', /no-store/i);
  const html = await page.text();
  assert.match(html, /The Daily Rep/);
  assert.match(html, /On-Ramp/);
  assert.match(html, /Private prototype/);
  assert.match(html, /closing session/);
  assert.doesNotMatch(html, /Kids on the Bus/);
  assert.doesNotMatch(html, /googletagmanager|google-analytics/i);
  assert.doesNotMatch(html, /—/);

  const denied = await fetch(baseUrl + '/api/on-ramp', {
    headers: { 'X-Companion-Access': 'wrong-code' },
  });
  assert.equal(denied.status, 401);

  for (const testCase of suite) {
    const response = await fetch(baseUrl + '/api/on-ramp', {
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

    assert.equal(response.status, 200, testCase.id + ' status');
    const body = await response.json();
    assert.equal(body.route, testCase.expected_route, testCase.id + ' route');
    assert.equal(body.handledBy, 'deterministic-control', testCase.id + ' control');
    assert.equal(typeof body.response, 'string');
    assert.ok(body.response.length > 20, testCase.id + ' response length');

    for (const pattern of requiredPatterns[testCase.id] || []) {
      assert.match(body.response, pattern, testCase.id + ' missing ' + pattern);
    }
    for (const pattern of forbiddenPatterns[testCase.id] || []) {
      assert.doesNotMatch(body.response, pattern, testCase.id + ' included ' + pattern);
    }
    for (const pattern of globalForbidden) {
      assert.doesNotMatch(body.response, pattern, testCase.id + ' included ' + pattern);
    }
  }
});

test('On-Ramp config carries the evaluation findings: raised ceilings, empty-response retry, its own prompt', () => {
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'onramp.js'), 'utf8');
  assert.match(source, /const NORMAL_OUTPUT_TOKENS = 4096;/);
  assert.match(source, /const RETRY_OUTPUT_TOKENS = 12288;/);
  assert.match(source, /empty_text/, 'the empty-response retry must be present');
  assert.match(source, /onramp-prompt\.txt/);
  assert.match(source, /ONRAMP_ACCESS_CODE/);

  const prompt = fsSync.readFileSync(path.join(__dirname, '..', 'onramp-prompt.txt'), 'utf8');
  assert.match(prompt, /On-Ramp Daily Practice Companion/);
  assert.match(prompt, /SENSE/);
  assert.match(prompt, /STEP/);
  assert.doesNotMatch(prompt, /—/, 'no em dashes in the prompt');
  assert.doesNotMatch(prompt, /^# On-Ramp Daily Practice Companion - prototype system prompt/m, 'the version-history header must be stripped from the deployed prompt');
});
