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
  // The straw breath streams from the same host, which is the whole reason
  // AUDIO_HOST has to appear on media-src: a missing entry there fails silently,
  // with a player that renders and simply never sounds.
  assert.ok(html.includes(`src="${AUDIO_HOST}/audio/straw-breath-daily.mp3"`), 'the straw breath daily practice must be on the page');
  assert.ok(html.includes(`src="${AUDIO_HOST}/audio/step-full-practice.mp3"`), 'STEP must be on the page');
  assert.ok(html.includes(`src="${AUDIO_HOST}/audio/inner-critic-full-practice.mp3"`), 'the inner critic must be on the page');
  assert.ok(!/will appear here[^<]*inner critic/i.test(html), 'the inner critic must not still be promised as coming once it is on the page');
  assert.ok(html.includes(`src="${AUDIO_HOST}/audio/straw-breath-short.mp3"`), 'the short straw breath must be on the page');
  assert.ok(html.includes(`src="${AUDIO_HOST}/audio/the-ache.mp3"`), 'The Ache must be on the page');
  assert.ok(!html.includes('class="soon"'), 'nothing is still promised as coming: all seven audios are on the page');

  // 9/7/26 redesign: the page follows the brand brief and asks the reader for
  // the three things a finished reader can give: a review, an address, and
  // interest in a cohort. Each is checked by the thing a reader would see.
  assert.ok(html.includes('amazon.com/review/create-review?asin=B0GX32LDSQ'), 'the review ask must point at the Amazon review form for this book');
  assert.ok(html.includes('goodreads.com/book/show/254670204'), 'the review ask must point at the Goodreads page');
  assert.ok(html.includes('id="cohortSignup"') && html.includes("/cohort-interest"), 'the course card must carry the cohort interest signup');
  assert.ok(html.includes('/course/on-ramp?source=book-bonus'), 'the course link must say it came from the book');
  assert.ok(!/fraction of working with me/.test(html), 'no price talk on the page');
  assert.ok((html.match(/ download>/g) || []).length === 7, 'every audio must have a download link');
  assert.ok(html.includes('src="/book-cover-bonus.jpg?v='), 'the cover thumbnail must be on the page, with a version so a browser that cached an older cover fetches this one');
  assert.ok(html.includes('href="#the-ache"'), 'jump links must exist so a phone reader can reach The Ache');
  assert.ok(!/Playfair|Cormorant/.test(html), 'one serif only, per the brand brief');
  assert.ok(html.includes('--rust:#8b3a2a') && !/#8B6B1E/i.test(html), 'rust is the accent; brass is gone');
  assert.ok(html.includes('href="https://herstwellness.com">Herst Wellness'), 'the footer wordmark links home');
  assert.ok(/as they're ready/.test(html) === false, 'the signup no longer promises audios that are already on the page');

  // The free sitting: linked from the page, open without a code, capped.
  assert.ok(html.includes('href="/book-bonus/try"'), 'the page must link to the one free sitting');
  const tryPage = await fetch('http://127.0.0.1:' + port + '/book-bonus/try');
  assert.equal(tryPage.status, 200, 'the sitting page opens without a code');
  const tryHtml = await tryPage.text();
  assert.ok(tryHtml.includes('Try SENSE on something that happened this week'), 'the sitting page carries its own welcome');
  assert.ok(tryHtml.includes("/api/book-bonus/transcribe"), 'the free sitting can speak, through its own ungated transcribe path');
  const pubSpeak = await fetch('http://127.0.0.1:' + port + '/api/book-bonus/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: '' });
  assert.ok([400, 503].includes(pubSpeak.status), 'the public transcribe path is open (refuses only for no audio or no key), not access-gated');
  const gatedSpeak = await fetch('http://127.0.0.1:' + port + '/api/on-ramp/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: '' });
  assert.ok([401, 403, 503].includes(gatedSpeak.status), 'the course transcribe path stays gated');
  assert.ok(tryHtml.includes('id="accessCard" class="card hidden"'), 'the access card is hidden on the public sitting');
  assert.ok(!/Integration and Next-Step Session/.test(tryHtml.split('id="consentCard"')[1].split('</section>')[0]), 'the public welcome never mentions the course session');
  const tryApi = await fetch('http://127.0.0.1:' + port + '/api/book-bonus/try');
  assert.equal(tryApi.status, 200, 'the sitting API answers without a code');
  const tryBad = await fetch('http://127.0.0.1:' + port + '/api/book-bonus/try', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '' }) });
  assert.equal(tryBad.status, 400, 'an empty message is refused');
  const capped = await fetch('http://127.0.0.1:' + port + '/api/book-bonus/try', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    // adultConfirmed and country are what the page sends; the safety layer
    // runs first and answers for itself when they are missing, by design.
    body: JSON.stringify({ message: 'still here', adultConfirmed: true, country: 'US', history: Array.from({ length: 22 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })) }) });
  const cappedBody = await capped.json();
  assert.equal(capped.status, 200);
  assert.equal(cappedBody.lockSession, true, 'past the hard cap the server closes the sitting itself');
  assert.equal(cappedBody.handledBy, 'turn-cap');
  const weekStillGated = await fetch('http://127.0.0.1:' + port + '/api/on-ramp/week-1');
  assert.ok([401, 403, 503].includes(weekStillGated.status), 'the course companion stays gated');

  // The cohort route validates like the newsletter route does.
  const badCohort = await fetch('http://127.0.0.1:' + port + '/cohort-interest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nope' }),
  });
  assert.equal(badCohort.status, 400, 'the cohort list refuses a bad address');
  assert.ok(!/will appear here as they're ready:[^<]*STEP/.test(html), 'STEP must not still be promised as coming once it is on the page');

  // 5. The page's own styling survives. Eight inline style attributes carry
  //    the audio players' width and the heading and button spacing, and a
  //    nonce cannot authorize a style attribute, only a <style> block. If
  //    someone tightens style-src to a nonce, this page loses that styling
  //    with no error, so the looser value is asserted on purpose.
  const styleSrc = directive(csp, 'style-src');
  assert.ok(styleSrc.includes("'unsafe-inline'"), "style-src must keep 'unsafe-inline' while the page uses style attributes");
  assert.ok(styleSrc.includes('https://fonts.googleapis.com'), 'style-src must allow the font stylesheet');
  assert.ok(!styleSrc.some((token) => token.startsWith("'nonce-")), 'a nonce in style-src would be ignored alongside unsafe-inline and drop the style attributes');
  assert.ok(/ style="[^"]+"/.test(html), 'the inline style attributes this policy accommodates are still in the page');

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

test('the audiobook page at /book carries the Google tag too', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port);
  t.after(() => child.kill());

  const res = await fetch('http://127.0.0.1:' + port + '/book');
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`), 'the audiobook page must carry the tag loader');
  assert.ok(html.includes(`gtag('config', '${GA_ID}')`), 'the audiobook page must configure the tag');

  // This route deliberately sends no Content-Security-Policy, so nothing has
  // to permit the tag. If one is ever added here, the tag will keep loading
  // and quietly stop reporting unless the policy names the tag host and the
  // bare analytics host. This assertion is what would catch that.
  const csp = res.headers.get('content-security-policy');
  if (csp) {
    const connectSrc = directive(csp, 'connect-src');
    assert.ok(connectSrc.includes('https://analytics.google.com'), 'a policy added here must let the tag report to the bare analytics host');
    assert.ok(directive(csp, 'script-src').includes('https://www.googletagmanager.com'), 'a policy added here must let the tag load');
  }

  // The page still is what it was: private, and still the audiobook.
  assert.match(html, /noindex/, 'the audiobook page stays out of search results');
  assert.ok(html.includes('Opening Credits'), 'the track list must still be on the page');
});
