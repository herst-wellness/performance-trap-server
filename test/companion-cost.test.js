const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

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

function startMockProvider(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(raw || '{}');
        } catch {
          parsed = {};
        }
        handler(req, parsed, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
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
        COMPANION_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'test-key-not-used',
        ANTHROPIC_MODEL: 'test-model-not-used',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('Server did not start'));
      }
    }, 10000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (!settled && stdout.includes('Server running on port')) {
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
    child.stdoutBuffer = () => stdout;
  });
}

const ORDINARY_MESSAGE = 'I noticed my jaw tighten when my sister brought up the holidays.';

async function postMessage(baseUrl) {
  return fetch(baseUrl + '/api/kids-on-the-bus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'test-access' },
    body: JSON.stringify({ message: ORDINARY_MESSAGE, adultConfirmed: true, history: [] }),
  });
}

test('the fixed instructions are sent as a cached block, journal content never is', { timeout: 20000 }, async (t) => {
  let capturedBody = null;
  const mock = await startMockProvider((req, body, res) => {
    capturedBody = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: 'Good. Stay with that for a moment.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 20, cache_creation_input_tokens: 480, cache_read_input_tokens: 0 },
    }));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, { ANTHROPIC_API_BASE_URL: mock.url });
  t.after(() => child.kill());

  const response = await postMessage('http://127.0.0.1:' + port);
  assert.equal(response.status, 200);

  assert.ok(Array.isArray(capturedBody.system), 'system must be an array of blocks to support cache_control');
  assert.equal(capturedBody.system.length, 1);
  assert.equal(capturedBody.system[0].cache_control.type, 'ephemeral');
  assert.match(capturedBody.system[0].text, /Module 2 Reflection Companion/);

  // Only the fixed instructions block carries cache_control. The user's
  // message is a separate, uncached message.
  const userMessage = capturedBody.messages.find((m) => m.role === 'user');
  assert.equal(userMessage.content, ORDINARY_MESSAGE);
  assert.equal(userMessage.cache_control, undefined);
});

test('prompt-cache read and write tokens are recorded in content-free usage logs', { timeout: 20000 }, async (t) => {
  const mock = await startMockProvider((req, body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: 'Good. Stay with that for a moment.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 40, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 },
    }));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, { ANTHROPIC_API_BASE_URL: mock.url });
  t.after(() => child.kill());

  await postMessage('http://127.0.0.1:' + port);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const stdout = child.stdoutBuffer();
  assert.doesNotMatch(stdout, /jaw tighten|holidays/);
  assert.match(stdout, /"cacheReadTokens":900/);
  assert.match(stdout, /"cacheWriteTokens":0/);
});

test('COMPANION_THINKING=disabled sends thinking:disabled; default leaves it unset', { timeout: 20000 }, async (t) => {
  let capturedBody = null;
  const mock = await startMockProvider((req, body, res) => {
    capturedBody = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: 'Good. Stay with that for a moment.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 40, output_tokens: 20 },
    }));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, { ANTHROPIC_API_BASE_URL: mock.url, COMPANION_THINKING: 'disabled' });
  t.after(() => child.kill());

  await postMessage('http://127.0.0.1:' + port);
  assert.deepEqual(capturedBody.thinking, { type: 'disabled' });
});

test('without COMPANION_THINKING set, no thinking parameter is sent at all', { timeout: 20000 }, async (t) => {
  let capturedBody = null;
  const mock = await startMockProvider((req, body, res) => {
    capturedBody = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: 'Good. Stay with that for a moment.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 40, output_tokens: 20 },
    }));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, { ANTHROPIC_API_BASE_URL: mock.url });
  t.after(() => child.kill());

  await postMessage('http://127.0.0.1:' + port);
  assert.equal(capturedBody.thinking, undefined);
});

test('dedicated companion credentials are used when present, general keys are the fallback', { timeout: 20000 }, async (t) => {
  let capturedKeyHeader = null;
  const mock = await startMockProvider((req, body, res) => {
    capturedKeyHeader = req.headers['x-api-key'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: 'Good. Stay with that for a moment.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 40, output_tokens: 20 },
    }));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, {
    ANTHROPIC_API_BASE_URL: mock.url,
    ANTHROPIC_API_KEY: 'general-key-should-not-be-used',
    COMPANION_ANTHROPIC_API_KEY: 'dedicated-companion-key',
  });
  t.after(() => child.kill());

  await postMessage('http://127.0.0.1:' + port);
  assert.equal(capturedKeyHeader, 'dedicated-companion-key');
});
