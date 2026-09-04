// The book-bonus page is the address printed inside the printed book, and the
// only page on this server that asks a visitor to type anything. Two things
// were added to it on 9/4/26 and both are easy to break silently, so both are
// asserted here rather than left to a manual check:
//
//   1. The Google tag, because an arrival in October that is not counted on
//      the day cannot be recovered afterwards.
//   2. A Content-Security-Policy, because this is the one page here that takes
//      an email address.
//
// The failure this suite exists to catch is the one from item 48 of the site
// punch list: a tag that loads correctly and is then refused when it tries to
// send its data, so the page looks instrumented all day and measures nothing.
// Checking that a script is allowed to LOAD is not the same as checking that
// its data is allowed to LEAVE. Both are checked below, and so is the audio
// host, because a media-src that omits it leaves the player silent with no
// error anywhere.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const { ONE_PAGERS } = require('../book-onepagers.js');

const GA_ID = 'G-RGBQ9JX82L';
const AUDIO_HOST = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev';

function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
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
      if (!settled) { settled = true; child.kill(); reject(new Error('Server did not start')); }
    }, 10000);
    child.stdout.on('data', (chunk) => {
      if (!settled && chunk.toString().includes('Server running on port')) {
        settled = true; clearTimeout(timer); resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(chunk.toString())); }
    });
    child.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Server exited with code ' + code)); }
    });
  });
}

// Turns "script-src 'self' 'nonce-abc' https://x" into ["'self'", "'nonce-abc'", "https://x"]
function directive(csp, name) {
  const found = csp.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(name + ' '));
  assert.ok(found, `the policy must set ${name}; got: ${csp}`);
  return found.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

function nonceFrom(tokens, name) {
  const value = tokens.find((t) => t.startsWith("'nonce-"));
  assert.ok(value, `${name} must carry a nonce; got: ${tokens.join(' ')}`);
  return value.slice("'nonce-".length, -1);
}

test('the /book-bonus page carries the Google tag AND a policy that lets the tag load, report, and play its audio', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());

  const res = await fetch('http://127.0.0.1:' + port + '/book-bonus');
  assert.equal(res.status, 200);
  const html = await res.text();
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'the response must carry a Content-Security-Policy header');

  // 1. The tag is on the page at all.
  assert.ok(html.includes(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`), 'the tag loader must be on the page');
  assert.ok(html.includes(`gtag('config', '${GA_ID}')`), 'the tag must be configured with the measurement id');

  // 2. The policy lets it load: the loader's host by name, the inline config
  //    block by a nonce that matches the one in the header for this request.
  const scriptSrc = directive(csp, 'script-src');
  assert.ok(scriptSrc.includes('https://www.googletagmanager.com'), 'script-src must allow the tag loader host');
  const nonce = nonceFrom(scriptSrc, 'script-src');
  assert.ok(html.includes(`<script nonce="${nonce}">`), 'the inline blocks must carry this response\'s nonce');
  const nonced = html.split(`<script nonce="${nonce}">`).length - 1;
  assert.equal(nonced, 2, 'both inline scripts (the tag config and the signup handler) must be authorized');

  // 3. The policy lets its data LEAVE. GA4 posts its page_view to the bare
  //    host analytics.google.com, which the wildcard does not match. This is
  //    the assertion that would have caught item 48.
  const connectSrc = directive(csp, 'connect-src');
  assert.ok(connectSrc.includes('https://analytics.google.com'), 'connect-src must list the bare analytics host, not only the wildcard');
  assert.ok(connectSrc.includes('https://www.google-analytics.com'), 'connect-src must allow the collection host');
  assert.ok(connectSrc.includes("'self'"), 'connect-src must still allow the signup post to this server');
  assert.ok(!connectSrc.includes('https://stats.g.doubleclick.net'), 'Google Signals ad pings stay blocked');

  // 4. The recordings still play. A media-src without this host leaves the
  //    player silent and prints nothing.
  const mediaSrc = directive(csp, 'media-src');
  assert.ok(mediaSrc.includes(AUDIO_HOST), 'media-src must allow the recordings bucket');
  assert.ok(mediaSrc.includes("'self'"), 'media-src must allow the recordings served from this server');
  assert.ok(html.includes(`src="${AUDIO_HOST}/audio/sense-full-practice.mp3"`), 'the SENSE recording must still be on the page');
  assert.ok(html.includes('src="/audio/onramp-breath-12min.mp3"'), 'the breathing recording must still be on the page');

  // 5. The page's own styling survives. Eight inline style attributes carry
  //    the audio players' width and the heading and button spacing, and a
  //    nonce cannot authorize a style attribute, only a <style> block. If
  //    someone tightens style-src to a nonce, this page loses that styling
  //    with no error, so the looser value is asserted on purpose.
  const styleSrc = directive(csp, 'style-src');
  assert.ok(styleSrc.includes("'unsafe-inline'"), "style-src must keep 'unsafe-inline' while the page uses style attributes");
  assert.ok(styleSrc.includes('https://fonts.googleapis.com'), 'style-src must allow the font stylesheet');
  assert.ok(!styleSrc.some((token) => token.startsWith("'nonce-")), 'a nonce in style-src would be ignored alongside unsafe-inline and drop the style attributes');
  assert.ok(/<h2 style="margin-top:0">/.test(html), 'the inline style attributes this policy accommodates are still in the page');

  // 6. The protections that were already there are still there.
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  assert.ok(directive(csp, 'frame-ancestors').includes("'none'"));
  assert.ok(directive(csp, 'form-action').includes("'self'"));

  // 7. The signup still works end to end, and is still not a gate.
  assert.ok(html.includes('id="bonusEmail"'), 'the email field must still be on the page');
  const bad = await fetch('http://127.0.0.1:' + port + '/book-bonus-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  assert.equal(bad.status, 400, 'the signup must still reject a malformed address');
});

test('a fresh nonce is issued per request and never reused', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());

  const first = await fetch('http://127.0.0.1:' + port + '/book-bonus');
  const second = await fetch('http://127.0.0.1:' + port + '/book-bonus');
  const nonces = [first, second].map((r) => nonceFrom(directive(r.headers.get('content-security-policy'), 'script-src'), 'script-src'));
  assert.notEqual(nonces[0], nonces[1], 'two requests must not share a nonce');

  // And each body must match its OWN header, not the other one's.
  const bodies = [await first.text(), await second.text()];
  assert.ok(bodies[0].includes(`nonce="${nonces[0]}"`), 'the first body must carry the first header\'s nonce');
  assert.ok(!bodies[0].includes(`nonce="${nonces[1]}"`), 'the first body must not carry the second header\'s nonce');
});

test('the five one-pagers under /book-bonus are measured and protected the same way', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());

  for (const page of ONE_PAGERS) {
    const res = await fetch('http://127.0.0.1:' + port + '/book-bonus/one-pagers/' + page.slug);
    assert.equal(res.status, 200, page.slug);
    const html = await res.text();
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, `${page.slug} must carry a Content-Security-Policy header`);

    assert.ok(html.includes(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`), `${page.slug} must carry the tag loader`);
    const nonce = nonceFrom(directive(csp, 'script-src'), 'script-src');
    assert.ok(html.includes(`<script nonce="${nonce}">`), `${page.slug}'s inline config must carry this response's nonce`);
    assert.ok(directive(csp, 'connect-src').includes('https://analytics.google.com'), `${page.slug} must allow the tag's data to leave`);
    assert.ok(html.includes('/book-bonus'), `${page.slug} must still link back to the practices page`);
  }
});
