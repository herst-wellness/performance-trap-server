// The /listen/chapter-one page builds its HTML fresh on every request, so it
// is given a per-request Content-Security-Policy nonce (never a hash) to
// authorize its inline <script>/<style> blocks. These tests confirm the
// policy is actually present, that its nonce genuinely matches the nonce
// stamped onto the inline blocks in that same response body (not just a
// header that looks right in isolation), that two different requests never
// reuse a nonce, and that the page's real functionality (GA4 tag, audio
// element, signup fetch calls) is still intact after the header/nonce work.
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

test('the /listen/chapter-one page carries a Content-Security-Policy whose nonce matches the inline blocks in that same body', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/listen/chapter-one');
  assert.equal(res.status, 200);

  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'response must carry a Content-Security-Policy header');

  const nonceMatch = csp.match(/'nonce-([^']+)'/);
  assert.ok(nonceMatch, 'CSP must include a nonce source');
  const nonce = nonceMatch[1];

  const html = await res.text();
  // The nonce is base64 and can contain regex-special characters (notably
  // "+"), so it must be escaped before being used to build a RegExp -
  // otherwise a nonce containing "+" silently fails to match anything.
  const escapedNonce = nonce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inlineTagCount = (html.match(new RegExp(`nonce="${escapedNonce}"`, 'g')) || []).length;
  assert.equal(inlineTagCount, 3, 'the same nonce from the header must be stamped on all three inline blocks (two <script>, one <style>)');

  // no other headers were dropped in the process
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('referrer-policy'), 'must carry a Referrer-Policy');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'self'/);

  // GA4 sends its page_view hit to the bare host https://analytics.google.com/g/collect,
  // not a subdomain, so a wildcard like https://*.analytics.google.com does not cover it
  // (the literal substring "https://analytics.google.com" does not occur inside
  // "https://*.analytics.google.com", so this assertion only passes when the bare host
  // is listed separately). A test that only checked for the wildcard is what let this
  // bug through the first time: every real GA4 hit was silently refused.
  assert.ok(
    csp.includes('https://analytics.google.com'),
    'connect-src must allow the bare https://analytics.google.com host, since GA4 posts there directly and a wildcard subdomain source does not match a bare host'
  );
});

test('two separate requests to /listen/chapter-one receive two different nonces', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const first = await fetch(baseUrl + '/listen/chapter-one');
  const second = await fetch(baseUrl + '/listen/chapter-one');

  const firstNonce = (first.headers.get('content-security-policy') || '').match(/'nonce-([^']+)'/)[1];
  const secondNonce = (second.headers.get('content-security-policy') || '').match(/'nonce-([^']+)'/)[1];

  assert.notEqual(firstNonce, secondNonce, 'each request must get its own freshly generated nonce');
});

test('the page still carries its GA4 tag, its audio element, and its signup fetch calls', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/listen/chapter-one');
  const html = await res.text();

  assert.ok(html.includes('G-RGBQ9JX82L'), 'GA4 measurement id must still be present');
  assert.ok(html.includes('googletagmanager.com/gtag/js'), 'GA4 script tag must still be present');
  assert.ok(html.includes('<audio'), 'audio element must still be present');
  assert.ok(html.includes("fetch('/chapter-one-audio'"), 'must still post to the chapter-one audio route');
  assert.ok(html.includes("fetch('/general-list-signup'"), 'must still post to the general list signup route');

  // the unlock button trap: a nonce does not cover inline event handlers, so
  // the onclick attribute must be gone and replaced with a real listener
  // inside a nonced script block, or the button would silently stop working
  // once the policy is enforced.
  assert.ok(!html.includes('onclick="unlockAudio()"'), 'inline onclick handler must be removed, not merely nonce-covered (nonces do not cover inline handlers)');
  assert.ok(html.includes('id="unlockButton"'), 'button must carry an id for a real event listener to attach to');
  assert.match(html, /getElementById\('unlockButton'\)\.addEventListener\('click', unlockAudio\)/, 'unlock must be wired as a real event listener, not an inline handler');

  // the map link is a plain outbound anchor, not a loaded resource, so it must
  // not have been given any CSP allowance
  assert.ok(html.includes('href="https://map.herstwellness.com"'), 'the map link itself must still be present');
  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(!csp.includes('map.herstwellness.com'), 'the map link is only a link, not a loaded resource, so it must not appear anywhere in the CSP');
});

test('the page carries no raw style="..." attributes, since a <style> nonce does not cover inline style attributes on other elements', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/listen/chapter-one');
  const html = await res.text();

  // A CSP nonce on a <style> block only authorizes that block; it does NOT
  // extend to style="..." attributes elsewhere in the markup (those are a
  // separate style-src-attr sink). Any such attribute left in this page
  // would be silently stripped by the browser once the policy applies,
  // which for #playerWrap and #nextWrap would mean the gated audio and
  // "join the launch team" sections would incorrectly show up before the
  // reader has entered their email. Everything that used to be a style
  // attribute here must be a class hooked into the nonced stylesheet instead.
  assert.ok(!/style="/.test(html), 'no element in this route may carry a raw style="..." attribute');
});
