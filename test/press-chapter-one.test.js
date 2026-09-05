// The /press/chapter-one page exists for podcast producers and press: the
// same Chapter One audio the gated /listen/chapter-one funnel delivers, but
// with no name/email capture in front of it. These tests confirm the page
// serves ungated (no inputs, no signup fetch calls), that it points at the
// real Chapter One audio file, that it stays out of search engines, and that
// the gated funnel page still gates, so adding the press page did not
// accidentally open the public funnel.
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

test('the /press/chapter-one page serves the Chapter One audio with no gate', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/press/chapter-one');
  assert.equal(res.status, 200);
  const body = await res.text();

  // The real audio is present and playable without any signup step.
  assert.match(body, /<audio[^>]+src="[^"]*\/audio\/chapter-one\.mp3"/);
  // No capture: no input fields, no signup endpoints, no unlock button.
  assert.doesNotMatch(body, /<input/i);
  assert.doesNotMatch(body, /chapter-one-audio|general-list-signup|unlock/i);
  // Stays out of search engines like the other listen pages.
  assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
  // Identifies the chapter and offers the review-copy contact.
  assert.match(body, /The Day the Mask Cracked/);
  assert.match(body, /chad@herstwellness\.com/);
});

test('the gated /listen/chapter-one funnel still gates after the press page was added', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/listen/chapter-one');
  assert.equal(res.status, 200);
  const body = await res.text();
  // The funnel keeps its name/email gate and hidden player.
  assert.match(body, /id="gateForm"/);
  assert.match(body, /id="playerWrap" class="player-wrap hidden"/);
});
