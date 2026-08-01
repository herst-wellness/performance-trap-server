const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const ORDINARY_MESSAGE =
  'My chest tightened when my sister said I was being selfish again.';

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
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          parsed = {};
        }
        handler(parsed, res);
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

async function postMessage(baseUrl) {
  const response = await fetch(baseUrl + '/api/kids-on-the-bus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'test-access' },
    body: JSON.stringify({ message: ORDINARY_MESSAGE, adultConfirmed: true, history: [] }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

test('Anthropic: a complete response longer than 500 characters reaches the browser without truncation', async (t) => {
  const longText =
    'This part is trying to protect you from feeling erased again, the way you did back then. '.repeat(6);
  assert.ok(longText.length > 500, 'fixture text must exceed 500 characters');

  const mock = await startMockProvider((requestBody, res) => {
    assert.equal(requestBody.max_tokens, 2048, 'first attempt should request the normal allowance');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        content: [{ type: 'text', text: longText }],
        stop_reason: 'end_turn',
        usage: { output_tokens: 300 },
      })
    );
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, {
    COMPANION_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: 'test-key-not-used',
    ANTHROPIC_MODEL: 'test-model-not-used',
    ANTHROPIC_API_BASE_URL: mock.url,
  });
  t.after(() => child.kill());

  const { status, body } = await postMessage('http://127.0.0.1:' + port);
  assert.equal(status, 200);
  assert.equal(body.route, 'continue_reflection');
  assert.equal(body.response, longText.trim());
  assert.ok(body.response.length > 500);
});

test('Anthropic: a truncated first attempt (stop_reason max_tokens) retries once and returns the complete text', async (t) => {
  const partialText = 'This part is trying to protect you from feeling avoid feeling c';
  const completeText =
    'This part is trying to protect you from feeling erased, the way you did back then, and it wants to be seen. '.repeat(5);
  assert.ok(completeText.length > 500);

  let callCount = 0;
  const mock = await startMockProvider((requestBody, res) => {
    callCount += 1;
    if (callCount === 1) {
      assert.equal(requestBody.max_tokens, 2048, 'first attempt uses the normal allowance');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: partialText }],
          stop_reason: 'max_tokens',
          usage: { output_tokens: 2048 },
        })
      );
      return;
    }
    assert.equal(requestBody.max_tokens, 4096, 'retry uses the larger allowance');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        content: [{ type: 'text', text: completeText }],
        stop_reason: 'end_turn',
        usage: { output_tokens: 900 },
      })
    );
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, {
    COMPANION_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: 'test-key-not-used',
    ANTHROPIC_MODEL: 'test-model-not-used',
    ANTHROPIC_API_BASE_URL: mock.url,
  });
  t.after(() => child.kill());

  const { status, body } = await postMessage('http://127.0.0.1:' + port);
  assert.equal(status, 200);
  assert.equal(callCount, 2, 'exactly one retry should have occurred');
  assert.equal(body.response, completeText.trim());
  assert.doesNotMatch(body.response, /avoid feeling c$/);
});

test('Anthropic: a response that stays incomplete after retry never reaches the browser as a fragment', async (t) => {
  const partialText = 'This part is trying to protect you from feeling avoid feeling c';

  const mock = await startMockProvider((requestBody, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        content: [{ type: 'text', text: partialText }],
        stop_reason: 'max_tokens',
        usage: { output_tokens: requestBody.max_tokens },
      })
    );
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, {
    COMPANION_PROVIDER: 'anthropic',
    ANTHROPIC_API_KEY: 'test-key-not-used',
    ANTHROPIC_MODEL: 'test-model-not-used',
    ANTHROPIC_API_BASE_URL: mock.url,
  });
  t.after(() => child.kill());

  const { status, body } = await postMessage('http://127.0.0.1:' + port);
  assert.equal(status, 200);
  assert.notEqual(body.response, partialText);
  assert.doesNotMatch(body.response, /avoid feeling c/);
  assert.match(body.response, /trouble responding|try again later/i);
});

test('OpenAI: an incomplete first attempt retries and returns the complete text', async (t) => {
  const completeText =
    'This part is trying to protect you from feeling erased, the way you did back then, and it wants to be seen. '.repeat(5);
  assert.ok(completeText.length > 500);

  let callCount = 0;
  const mock = await startMockProvider((requestBody, res) => {
    callCount += 1;
    if (callCount === 1) {
      assert.equal(requestBody.max_output_tokens, 2048);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: 'This part is trying to protect you from feeling avoid feeling c',
        })
      );
      return;
    }
    assert.equal(requestBody.max_output_tokens, 4096);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', output_text: completeText }));
  });
  t.after(() => mock.server.close());

  const port = await getOpenPort();
  const child = await startServer(port, {
    COMPANION_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key-not-used',
    OPENAI_MODEL: 'test-model-not-used',
    OPENAI_API_BASE_URL: mock.url,
  });
  t.after(() => child.kill());

  const { status, body } = await postMessage('http://127.0.0.1:' + port);
  assert.equal(status, 200);
  assert.equal(callCount, 2);
  assert.equal(body.response, completeText.trim());
});
