// The four On-Ramp weekly companions share the Kids on the Bus
// deterministic safety layer, so the identical 25-case product-safety
// suite must pass against every weekly route. Plus On-Ramp specifics: all
// routes disabled until ONRAMP_ACCESS_CODE is set (and never unlocked by
// the Kids on the Bus code), each week's page carries its own copy and
// talks to its OWN API path (a real bug in the first build: the page still
// pointed at the Kids on the Bus API), week prompts are scoped to their
// week's moves, and the raised ceilings + empty-response retry from the
// 28-case evaluation are configured.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');

const suitePath = path.join(__dirname, 'module-2-product-safety-evaluation-set.jsonl');
const { WEEKS, INDEX_PATH } = require('../onramp.js');
const { ONE_PAGERS } = require('../book-onepagers.js');

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

test('every weekly route stays disabled until ONRAMP_ACCESS_CODE is set, and the Kids on the Bus code never unlocks it', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {}); // no ONRAMP_ACCESS_CODE
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const week of Object.values(WEEKS)) {
    const res = await fetch(baseUrl + week.apiPath, {
      headers: { 'X-Companion-Access': 'test-access' },
    });
    assert.equal(res.status, 503, week.apiPath);
    const body = await res.json();
    assert.match(body.error, /not enabled/i);
  }

  const kotb = await fetch(baseUrl + '/reflect/kids-on-the-bus');
  assert.equal(kotb.status, 200, 'the existing companion page must keep working');
});

test('the index and all four weekly pages serve their own copy, and each page talks to its own API path', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const audio = await fetch(baseUrl + '/audio/onramp-breath-12min.mp3', { method: 'GET' });
  assert.equal(audio.status, 200, 'the breathing recording must be served');
  assert.match(audio.headers.get('content-type') || '', /audio\/mpeg/);
  audio.body && audio.body.cancel && audio.body.cancel();

  const index = await fetch(baseUrl + INDEX_PATH);
  assert.equal(index.status, 200);
  const indexHtml = await index.text();
  for (const week of Object.values(WEEKS)) {
    assert.match(indexHtml, new RegExp(week.pagePath.replace(/[/-]/g, '\\$&')));
  }

  for (const week of Object.values(WEEKS)) {
    const page = await fetch(baseUrl + week.pagePath);
    assert.equal(page.status, 200, week.pagePath);
    assert.match(page.headers.get('cache-control') || '', /no-store/i);
    const html = await page.text();
    assert.ok(html.includes(week.title), week.pagePath + ' title');
    assert.ok(html.includes(week.opening), week.pagePath + ' opening question');
    assert.ok(html.includes(week.apiPath), week.pagePath + ' must call its own API');
    assert.ok(!html.includes('/api/kids-on-the-bus'), week.pagePath + ' must not call the Kids on the Bus API');
    assert.ok(!html.includes('/api/on-ramp\''), week.pagePath + ' must not call the retired single-app API');
    assert.match(html, /Your access code/);
    assert.doesNotMatch(html, /googletagmanager|google-analytics/i);
    assert.doesNotMatch(html, /—/);
    // Chad removed the consent checkboxes and country selector on 8/16;
    // the informational scope line and the breath recording replace them.
    assert.doesNotMatch(html, /adultCheck|scopeCheck|id="country"/, week.pagePath + ' must not carry the removed consent controls');
    assert.ok(html.includes('/audio/onramp-breath-12min.mp3'), week.pagePath + ' must offer the 12-minute breathing recording');
    assert.match(html, /not therapy, medical care, diagnosis, or crisis support/);
  }
});

test('all four weekly routes pass the full 25-case product-safety suite', { timeout: 120000 }, async (t) => {
  const suite = (await fs.readFile(suitePath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(suite.length, 25);

  const { requiredPatterns, forbiddenPatterns, globalForbidden } = require('./companion-safety-patterns.js');

  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const week of Object.values(WEEKS)) {
    const denied = await fetch(baseUrl + week.apiPath, {
      headers: { 'X-Companion-Access': 'wrong-code' },
    });
    assert.equal(denied.status, 401, week.apiPath + ' wrong code');

    for (const testCase of suite) {
      const response = await fetch(baseUrl + week.apiPath, {
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

      const label = week.apiPath + ' ' + testCase.id;
      assert.equal(response.status, 200, label + ' status');
      const body = await response.json();
      assert.equal(body.route, testCase.expected_route, label + ' route');
      assert.equal(body.handledBy, 'deterministic-control', label + ' control');
      assert.ok(body.response.length > 20, label + ' response length');

      for (const pattern of requiredPatterns[testCase.id] || []) {
        assert.match(body.response, pattern, label + ' missing ' + pattern);
      }
      for (const pattern of forbiddenPatterns[testCase.id] || []) {
        assert.doesNotMatch(body.response, pattern, label + ' included ' + pattern);
      }
      for (const pattern of globalForbidden) {
        assert.doesNotMatch(body.response, pattern, label + ' included ' + pattern);
      }
    }
  }
});

test('every week opens on its own material and closes by attaching the rep to the skill and to their life', () => {
  // The opening the person actually sees must name what this week is
  // about, and the prompt must be told to use that same opening, or the
  // companion drifts back to a generic "what happened today".
  const openingMarkers = {
    1: 'triggered you recently',
    2: 'fix-it mode around or push past',
    3: 'a moment where you felt something was off',
    4: 'feeling stuck today',
  };
  for (const n of [1, 2, 3, 4]) {
    const opening = WEEKS[n].opening;
    assert.ok(opening.includes(openingMarkers[n]), 'week ' + n + ' opening must name the week material');
    const flat = WEEKS[n].instructions.replace(/\s+/g, ' ').replace(/[‘’]/g, "'");
    const head = opening.replace(/\s+/g, ' ').split(/[.?]/)[0].trim();
    assert.ok(flat.includes(head), 'week ' + n + ' prompt must carry the same standing opening');
  }

  // Week 1's opening is a two-beat: the trigger question, then the body
  // question, one at a time.
  assert.ok(WEEKS[1].instructions.includes('Where do you notice that in your body?'),
    'week 1 must carry the standing second move into the body');

  // The close is the part that turns a conversation into a practice, so
  // all four weeks must carry the three beats and the reason for them.
  for (const n of [1, 2, 3, 4]) {
    const p = WEEKS[n].instructions;
    assert.ok(p.includes('Close by making the rep usable'), 'week ' + n + ' close intent');
    assert.ok(p.includes('What they got from today'), 'week ' + n + ' asks what landed');
    assert.ok(p.includes('What they learned about the move itself'), 'week ' + n + ' asks about the move');
    assert.ok(p.includes('Where it goes next'), 'week ' + n + ' asks where it applies');
    assert.ok(p.includes('reach for when the pressure is real'), 'week ' + n + ' states why');
    // And it must stay a practice, not a quiz.
    assert.ok(p.includes('Never grade the answers'), 'week ' + n + ' must not grade');
    assert.ok(p.includes("\"I don't know\" is a complete answer"), 'week ' + n + ' allows not knowing');
  }

  // Each week names its own move at the close, not a generic one.
  const closingMove = {
    1: 'leaving the story and coming back to the body',
    2: 'staying with something instead of fixing it',
    3: 'the trade',
    4: 'meeting a protector with a little less argument',
  };
  for (const n of [1, 2, 3, 4]) {
    const flat = WEEKS[n].instructions.replace(/\s+/g, ' ');
    assert.ok(flat.includes(closingMove[n]), 'week ' + n + ' must name its own move at the close');
  }
});

test('week prompts are scoped to their week and share the core, safety overlay, and evaluation-driven config', () => {
  const w = (n) => WEEKS[n].instructions;

  // Shared spine in all four
  for (const n of [1, 2, 3, 4]) {
    assert.match(w(n), /On-Ramp Daily Practice Companion/, 'week ' + n + ' identity');
    assert.match(w(n), /PRODUCT-SAFETY OVERLAY/, 'week ' + n + ' overlay');
    assert.match(w(n), /straightaways/, 'week ' + n + ' straightaways rule');
    assert.doesNotMatch(w(n), /—/, 'week ' + n + ' no em dashes');
  }

  // Week 1: first half of SENSE only, no titration mechanics, no STEP method
  assert.match(w(1), /first half of SENSE/);
  assert.doesNotMatch(w(1), /## The method: STEP/);
  assert.doesNotMatch(w(1), /Dosing down/);

  // Week 2: full SENSE, still no STEP method section
  assert.match(w(2), /Dosing down/);
  assert.doesNotMatch(w(2), /## The method: STEP/);

  // Weeks 3 and 4: full toolkit
  assert.match(w(3), /## The method: STEP/);
  assert.match(w(4), /## The method: STEP/);
  assert.match(w(4), /Gathering for the Integration and Next-Step Session/);

  // Gating language: meet later-week material, never refuse it
  assert.match(w(1), /never refuse or defer/i);
  assert.match(w(2), /never imply the material was wrong to bring/);

  // Evaluation-driven config
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'onramp.js'), 'utf8');
  assert.match(source, /const NORMAL_OUTPUT_TOKENS = 4096;/);
  assert.match(source, /const RETRY_OUTPUT_TOKENS = 12288;/);
  assert.match(source, /empty_text/, 'the empty-response retry must be present');
  assert.match(source, /ONRAMP_ACCESS_CODE/);
});

test('course pages: public overview, gated lesson content, companion links, and the multi-code enrollment list', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  // Two personal codes via the list, none via the singular variable.
  const child = await startServer(port, { ONRAMP_ACCESS_CODES: 'amber-fox-12, quiet-river-8' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const overview = await fetch(baseUrl + '/course/on-ramp');
  assert.equal(overview.status, 200);
  const overviewHtml = await overview.text();
  assert.match(overviewHtml, /Performance Trap Practice/);
  assert.match(overviewHtml, /week-1/);
  assert.doesNotMatch(overviewHtml, /straw breath/i, 'lesson content must not leak into the public overview');

  for (const n of [1, 2, 3, 4]) {
    const page = await fetch(baseUrl + '/course/on-ramp/week-' + n);
    assert.equal(page.status, 200, 'week ' + n + ' page');
    const html = await page.text();
    assert.match(html, /Enrolled\?/, 'week ' + n + ' page must show the unlock card');
    assert.doesNotMatch(html, /keep the signal silent|straw breath/i, 'lesson content must not be embedded in the page source');
    assert.doesNotMatch(html, /—/);

    const denied = await fetch(baseUrl + '/course/on-ramp/api/week-' + n, {
      headers: { 'X-Companion-Access': 'wrong-code' },
    });
    assert.equal(denied.status, 401, 'week ' + n + ' content denied without a valid code');

    for (const code of ['amber-fox-12', 'quiet-river-8']) {
      const content = await fetch(baseUrl + '/course/on-ramp/api/week-' + n, {
        headers: { 'X-Companion-Access': code },
      });
      assert.equal(content.status, 200, 'week ' + n + ' content with code ' + code);
      const payload = await content.json();
      assert.ok(payload.contentHtml.includes('/practice/on-ramp/week-' + n), 'week ' + n + ' must link its companion');
      assert.ok(!payload.contentHtml.includes('—'), 'week ' + n + ' content must not contain an em dash');
    }

    // The same personal code must unlock the companion too.
    const companion = await fetch(baseUrl + '/api/on-ramp/week-' + n, {
      headers: { 'X-Companion-Access': 'amber-fox-12' },
    });
    assert.equal(companion.status, 200, 'week ' + n + ' companion with a list code');
  }

  // Week 1 content carries the recorded sit; week 4 carries the closing section.
  const w1 = await (await fetch(baseUrl + '/course/on-ramp/api/week-1', { headers: { 'X-Companion-Access': 'amber-fox-12' } })).json();
  assert.ok(w1.contentHtml.includes('/audio/onramp-breath-12min.mp3'));
  const w4 = await (await fetch(baseUrl + '/course/on-ramp/api/week-4', { headers: { 'X-Companion-Access': 'amber-fox-12' } })).json();
  assert.match(w4.contentHtml, /Integration and Next-Step Session/);
});

test('PayPal self-serve enrollment: off by default, and a mocked full checkout issues a working signed code', { timeout: 30000 }, async (t) => {
  const http = require('node:http');

  // A tiny stand-in for PayPal: token, create order, capture as COMPLETED
  // at the configured price.
  const paypalMock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/oauth2/token') {
        res.end(JSON.stringify({ access_token: 'mock-token' }));
      } else if (req.url === '/v2/checkout/orders') {
        res.end(JSON.stringify({ id: 'ORDER-123' }));
      } else if (req.url === '/v2/checkout/orders/ORDER-123/capture') {
        res.end(JSON.stringify({
          status: 'COMPLETED',
          // PayPal returns the amount WITH decimals even when the order was
          // created without them; the mock must mimic that, because a
          // text-equality check against this exact shape once let a real
          // captured payment go uncredited.
          purchase_units: [{ payments: { captures: [{ status: 'COMPLETED', amount: { currency_code: 'USD', value: '299.00' } }] } }],
        }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise((resolve) => paypalMock.listen(0, '127.0.0.1', resolve));
  t.after(() => paypalMock.close());
  const paypalUrl = 'http://127.0.0.1:' + paypalMock.address().port;

  // Without PayPal config: endpoints refuse, overview shows the personal-enrollment text.
  const portOff = await getOpenPort();
  const childOff = await startServer(portOff, { ONRAMP_ACCESS_CODES: 'x-1' });
  t.after(() => childOff.kill());
  const offBase = 'http://127.0.0.1:' + portOff;
  const offCreate = await fetch(offBase + '/course/on-ramp/api/paypal/create-order', { method: 'POST' });
  assert.equal(offCreate.status, 503);
  const offHtml = await (await fetch(offBase + '/course/on-ramp')).text();
  assert.match(offHtml, /Chad sets you up directly/);
  assert.doesNotMatch(offHtml, /paypalButtons/);

  // With full config: the overview offers checkout, and the flow issues a code.
  const portOn = await getOpenPort();
  const childOn = await startServer(portOn, {
    ONRAMP_CODE_SECRET: 'test-code-secret',
    ONRAMP_PRICE_USD: '299',
    PAYPAL_CLIENT_ID: 'mock-client',
    PAYPAL_CLIENT_SECRET: 'mock-secret',
    PAYPAL_BASE_URL: paypalUrl,
  });
  t.after(() => childOn.kill());
  const onBase = 'http://127.0.0.1:' + portOn;

  const onHtml = await (await fetch(onBase + '/course/on-ramp')).text();
  assert.match(onHtml, /Enroll yourself/);
  assert.match(onHtml, /\$299/);
  assert.match(onHtml, /paypalButtons/);
  assert.match(onHtml, /shown only once/);

  const created = await (await fetch(onBase + '/course/on-ramp/api/paypal/create-order', { method: 'POST' })).json();
  assert.equal(created.orderId, 'ORDER-123');

  const captured = await fetch(onBase + '/course/on-ramp/api/paypal/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 'ORDER-123' }),
  });
  assert.equal(captured.status, 200);
  const { accessCode } = await captured.json();
  assert.match(accessCode, /^mb-[a-f0-9]{8}-[a-f0-9]{10}$/);

  // The issued code opens lesson content and the companion, without being
  // in any enrollment list.
  const lesson = await fetch(onBase + '/course/on-ramp/api/week-2', { headers: { 'X-Companion-Access': accessCode } });
  assert.equal(lesson.status, 200);
  const companion = await fetch(onBase + '/api/on-ramp/week-2', { headers: { 'X-Companion-Access': accessCode } });
  assert.equal(companion.status, 200);

  // A tampered code does not.
  const tampered = accessCode.slice(0, -1) + (accessCode.endsWith('0') ? '1' : '0');
  const denied = await fetch(onBase + '/course/on-ramp/api/week-2', { headers: { 'X-Companion-Access': tampered } });
  assert.equal(denied.status, 401);
});

test('speaking is an optional way into the same written box on every week, transcribed by OpenAI and disclosed', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, { ONRAMP_ACCESS_CODE: 'onramp-test-access' });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  for (const week of Object.values(WEEKS)) {
    const page = await fetch(baseUrl + week.pagePath);
    assert.equal(page.status, 200, week.pagePath);
    const html = await page.text();

    // The control exists, starts hidden, and is revealed only where the
    // browser can record, so anywhere else keeps the typed path.
    assert.match(html, /id="speakButton"[^>]*class="button secondary hidden"/, week.pagePath + ' speak button starts hidden');
    assert.ok(html.includes('window.MediaRecorder'), week.pagePath + ' records with MediaRecorder');
    assert.ok(html.includes('window.isSecureContext'), week.pagePath + ' requires a secure context for the microphone');
    assert.ok(html.includes("el('speakButton').classList.remove('hidden')"), week.pagePath + ' reveals the button only when supported');
    assert.ok(html.includes('id="speakStatus"'), week.pagePath + ' has a status region for the microphone');

    // Transcription is OpenAI's, reached through this server's own gated
    // route, and the words land in the existing box rather than auto-sending.
    assert.ok(html.includes("fetch('/api/on-ramp/transcribe'"), week.pagePath + ' posts audio to the transcribe route');
    assert.ok(html.includes("'X-Companion-Access': accessCode"), week.pagePath + ' sends the access code with the audio');
    assert.ok(html.includes('box.value = existing ? existing'), week.pagePath + ' appends the words to the written box');
    assert.ok(!html.includes('webkitSpeechRecognition'), week.pagePath + ' no longer uses the browser recognizer');

    // The microphone is released when recording stops and when a session
    // locks, including the fixed crisis routing.
    assert.ok(html.includes('track.stop();'), week.pagePath + ' releases the microphone tracks');
    assert.ok(html.includes('if (value) stopListening();'), week.pagePath + ' releases the microphone when locked');

    // The person is told plainly where their voice goes.
    assert.match(html, /the sound goes to OpenAI to be turned into words/, week.pagePath + ' discloses who transcribes');
    assert.match(html, /This application keeps no recording\./, week.pagePath + ' discloses retention here');
    assert.match(html, /abuse-monitoring logs for up to 30 days/, week.pagePath + ' discloses provider retention');
    assert.doesNotMatch(html, /—/);

    // The page builds its client script inside a template literal, so a
    // stray escape or interpolation would ship a page that silently fails
    // to run. Parse what the browser would actually receive.
    const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    assert.ok(scripts.length > 0, week.pagePath + ' has a client script');
    const body = scripts[scripts.length - 1].replace(/^<script>/, '').replace(/<\/script>$/, '');
    assert.doesNotThrow(() => new Function(body), week.pagePath + ' client script must parse');
  }
});

test('the transcribe route is gated, bounded, and posts the recording to OpenAI without keeping it', { timeout: 30000 }, async (t) => {
  const http = require('node:http');

  // Stand-in for OpenAI's transcription endpoint. It checks that a real
  // multipart upload arrived with a file and a model, then answers with
  // plain text the way response_format=text does.
  let seen = null;
  const openaiMock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('binary');
      seen = {
        auth: req.headers.authorization || '',
        contentType: req.headers['content-type'] || '',
        hasFilePart: /name="file"; filename="entry\.[a-z0-9]+"/.test(raw),
        model: (raw.match(/name="model"\r\n\r\n([^\r]+)/) || [])[1] || '',
        format: (raw.match(/name="response_format"\r\n\r\n([^\r]+)/) || [])[1] || '',
        carriedAudio: raw.includes('PRETEND-AUDIO-BYTES'),
      };
      res.setHeader('Content-Type', 'text/plain');
      res.end('I snapped at my kid, and then I felt sick about it.');
    });
  });
  await new Promise((resolve) => openaiMock.listen(0, '127.0.0.1', resolve));
  t.after(() => openaiMock.close());
  const mockUrl = 'http://127.0.0.1:' + openaiMock.address().port + '/v1/audio/transcriptions';

  const port = await getOpenPort();
  const child = await startServer(port, {
    ONRAMP_ACCESS_CODE: 'onramp-test-access',
    OPENAI_API_KEY: 'fake-key-for-test',
    OPENAI_TRANSCRIBE_URL: mockUrl,
  });
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;
  const audio = Buffer.from('PRETEND-AUDIO-BYTES');

  // No code, no transcription: otherwise this is a free transcription
  // service for anyone who finds the URL.
  const denied = await fetch(baseUrl + '/api/on-ramp/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: audio,
  });
  assert.equal(denied.status, 401);
  assert.equal(seen, null, 'a refused request must never reach OpenAI');

  // A wrong method is refused before anything else happens.
  const wrongMethod = await fetch(baseUrl + '/api/on-ramp/transcribe', { method: 'GET' });
  assert.equal(wrongMethod.status, 405);

  // A format OpenAI cannot read is refused here rather than forwarded.
  const badType = await fetch(baseUrl + '/api/on-ramp/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip', 'X-Companion-Access': 'onramp-test-access' },
    body: audio,
  });
  assert.equal(badType.status, 415);

  // An empty body is refused rather than billed.
  const empty = await fetch(baseUrl + '/api/on-ramp/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', 'X-Companion-Access': 'onramp-test-access' },
    body: Buffer.alloc(0),
  });
  assert.equal(empty.status, 400);

  // The happy path, including Safari's audio/mp4 recordings.
  for (const type of ['audio/webm;codecs=opus', 'audio/mp4']) {
    seen = null;
    const ok = await fetch(baseUrl + '/api/on-ramp/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': type, 'X-Companion-Access': 'onramp-test-access' },
      body: audio,
    });
    assert.equal(ok.status, 200, type);
    const body = await ok.json();
    assert.equal(body.text, 'I snapped at my kid, and then I felt sick about it.', type);
    assert.match(seen.auth, /^Bearer /, type + ' must authenticate to OpenAI');
    assert.match(seen.contentType, /multipart\/form-data/, type + ' must upload as multipart');
    assert.ok(seen.hasFilePart, type + ' must send a named file part');
    assert.ok(seen.carriedAudio, type + ' must actually carry the recording');
    assert.equal(seen.format, 'text', type + ' must ask for plain text back');
    assert.ok(seen.model.length > 0, type + ' must name a model');
  }

  // Nothing about the audio may be written to disk anywhere in the repo.
  const strays = fsSync.readdirSync(path.join(__dirname, '..'))
    .filter((name) => /\.(webm|mp4|m4a|wav|ogg)$/i.test(name));
  assert.deepEqual(strays, [], 'no recording may be written to disk');
});

test('the book-bonus page serves its promises: field-guide PDF, breath audio, course link, no gating', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {});
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  const page = await fetch(baseUrl + '/book-bonus');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /The practices, in one place/);
  assert.match(html, /Everything here is free\. No forms, no catch\./);
  assert.ok(html.includes('/downloads/practices-in-one-place.pdf'));
  assert.ok(html.includes('/audio/onramp-breath-12min.mp3'));
  assert.ok(html.includes('/course/on-ramp'), 'the course must be the featured next step');
  assert.match(html, /being recorded/i, 'unrecorded audios must still be named honestly');
  assert.doesNotMatch(html, /—/);
  assert.doesNotMatch(html, /googletagmanager|google-analytics/i);
  assert.doesNotMatch(html, /Being made now/, 'the one-pagers are live, not a placeholder anymore');
  for (const p of ONE_PAGERS) {
    assert.ok(html.includes(`/book-bonus/one-pagers/${p.slug}`), `bonus page must link to the ${p.slug} one-pager`);
  }

  const pdf = await fetch(baseUrl + '/downloads/practices-in-one-place.pdf');
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
  pdf.body && pdf.body.cancel && pdf.body.cancel();

  const badSignup = await fetch(baseUrl + '/book-bonus-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  assert.equal(badSignup.status, 400);
});

test('the five book-bonus one-pagers serve verbatim Try This content, no gating', { timeout: 30000 }, async (t) => {
  const port = await getOpenPort();
  const child = await startServer(port, {});
  t.after(() => child.kill());
  const baseUrl = 'http://127.0.0.1:' + port;

  assert.equal(ONE_PAGERS.length, 5, 'one per Part Two chapter');

  for (const p of ONE_PAGERS) {
    const res = await fetch(baseUrl + '/book-bonus/one-pagers/' + p.slug);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(p.title));
    assert.match(html, /Where this fits:/);
    assert.match(html, /When it shows up:/);
    assert.match(html, /Try it now:/);
    assert.ok(html.includes('/book-bonus'), 'must link back to the bonus page');
    assert.doesNotMatch(html, /—/);
    for (const step of p.steps) {
      assert.ok(html.includes(step.body), `${p.slug} must carry ${step.name} verbatim`);
    }
  }

  const missing = await fetch(baseUrl + '/book-bonus/one-pagers/not-a-real-chapter');
  assert.equal(missing.status, 404);
});
