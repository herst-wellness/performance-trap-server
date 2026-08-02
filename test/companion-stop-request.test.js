const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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

function startServer(port) {
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

async function route(baseUrl, message) {
  const response = await fetch(baseUrl + '/api/kids-on-the-bus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': 'test-access' },
    body: JSON.stringify({ message, adultConfirmed: true, history: [], country: 'US' }),
  });
  const body = await response.json();
  return body.route;
}

test('an ordinary sentence containing "stop" does not end the session', { timeout: 20000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  // The real message that incorrectly ended a live session on 2026-08-01.
  assert.equal(
    await route(baseUrl, "That I will be thinking about it and not be able to stop until it's done"),
    'continue_reflection',
    'obsessive-completion language must not be read as a stop request'
  );
  assert.equal(
    await route(baseUrl, 'I feel like I never stop working, even on weekends.'),
    'continue_reflection'
  );
  assert.equal(
    await route(baseUrl, "It's like waiting at a bus stop, not knowing when it'll arrive."),
    'continue_reflection',
    'the app\'s own bus metaphor must not trip the stop control'
  );
  assert.equal(
    await route(baseUrl, "I've been going non-stop all week."),
    'continue_reflection'
  );

  // Genuine stop requests must still work.
  assert.equal(await route(baseUrl, 'Stop.'), 'stop_requested');
  assert.equal(await route(baseUrl, 'Please stop.'), 'stop_requested');
  assert.equal(await route(baseUrl, 'Can we stop here?'), 'stop_requested');
  assert.equal(await route(baseUrl, 'I want to stop.'), 'stop_requested');
  assert.equal(
    await route(baseUrl, 'Stop. I am flooded and I do not want to do this anymore.'),
    'stop_requested',
    'the existing approved safety case must still route correctly'
  );
});
