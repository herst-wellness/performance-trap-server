'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadClaudeInstructions } = require('../server');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'written-app.js'), 'utf8');
const adminApp = fs.readFileSync(path.join(root, 'public', 'admin.js'), 'utf8');
const preservedVoiceApp = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const prompt = loadClaudeInstructions();
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const mainServerSource = fs.readFileSync(path.join(root, '..', 'server.js'), 'utf8');
const companionEntry = fs.readFileSync(path.join(root, '..', 'companion.js'), 'utf8');

test('canonical coaching assets are self-contained and retain their approved fingerprints', () => {
  const assets = [
    ['companion-prompt.txt', '611576fe33b5681bd776c0b5bfc7c0044e6ff674fac467e5178db4cf6ef62f0e'],
    ['companion-safety-overlay.txt', '023e23cb6fe0cac90d376278cd69aa64f06014ea84324604d668a04de90c9372']
  ];
  for (const [filename, expected] of assets) {
    const contents = fs.readFileSync(path.join(root, 'canonical', 'module2', filename));
    assert.equal(crypto.createHash('sha256').update(contents).digest('hex'), expected);
  }
  assert.match(serverSource, /path\.join\(ROOT, 'canonical', 'module2', 'companion-prompt\.txt'\)/);
  assert.match(serverSource, /path\.join\(ROOT, 'canonical', 'module2', 'companion-safety-overlay\.txt'\)/);
  assert.doesNotMatch(serverSource, /performance-trap-server-module2/);
});

test('the main server preserves every existing feature and delegates the namespaced companion before removing its voice query', () => {
  assert.match(companionEntry, /require\('\.\/kids-on-the-bus\/server'\)/);
  assert.ok(mainServerSource.indexOf('initializeCompanion()') < mainServerSource.indexOf('http.createServer'));
  assert.ok(mainServerSource.indexOf('handleCompanionRoute(req, res)') < mainServerSource.indexOf("req.url = req.url.split('?')[0]"));
  assert.match(mainServerSource, /req\.url === '\/book'/);
  assert.match(mainServerSource, /req\.url === '\/health'/);
  assert.match(mainServerSource, /req\.url === '\/reading'/);
});

test('browser offers controlled push-to-talk transcription without restoring realtime voice', () => {
  assert.match(html, /Begin written reflection/);
  assert.match(html, /Speak your response/);
  assert.match(html, /review, edit, or delete it before sending/);
  assert.match(html, /audio is sent through Herst Wellness's server to OpenAI for transcription/);
  assert.match(html, /Audio is never saved to the Herst Wellness analytics store/);
  assert.doesNotMatch(html, /Begin voice session|Voice session|remoteAudio/);
  assert.match(html, /written-app\.js/);
  assert.match(html, /End and clear here/);
  assert.match(html, /Copy sitting/);
  assert.match(html, /Download sitting/);
  assert.match(app, /replaceChildren/);
  assert.match(app, /\/api\/kids-on-the-bus\/claude-response/);
  assert.match(app, /\/api\/kids-on-the-bus\/transcribe/);
  assert.match(app, /getUserMedia/);
  assert.match(app, /new MediaRecorder/);
  assert.match(app, /MAX_RECORDING_MS = 2 \* 60 \* 1000/);
  assert.match(app, /new AbortController/);
  assert.doesNotMatch(app, /RTCPeerConnection|speechSynthesis|remoteAudio|realtime\/session/);
  assert.match(preservedVoiceApp, /getUserMedia/);
  assert.match(preservedVoiceApp, /RTCPeerConnection/);
});

test('the companion is framed as Mind/Body Foundations with notice and optional sharing off by default', () => {
  assert.match(html, /Mind\/Body Foundations Companion/);
  assert.match(html, /How your information is used/i);
  assert.match(html, /Your exact written conversation will not be saved/);
  assert.match(html, /structured usage information, without the exact words of your sitting, for up to 12 months/);
  assert.match(html, /Back to Mind\/Body Foundations/);
  assert.match(html, /I give Herst Wellness permission to save this written sitting/);
  assert.doesNotMatch(html, /id="researchConsent"[^>]*checked/);
  assert.doesNotMatch(`${html}\n${app}`, /completely private|private written|private test/i);
  assert.doesNotMatch(`${html}\n${app}`, /access code|X-Companion-Code|Early access/i);
});

test('completion offers three intentional next steps with clear newsletter disclosure', () => {
  assert.ok(html.indexOf('Explore further with Chad') < html.indexOf('Get Chapter One'));
  assert.ok(html.indexOf('Get Chapter One') < html.indexOf('Explore Foundations'));
  assert.match(html, /When you enter your email, you will also receive Chad's newsletter\. Unsubscribe at any time\./);
  assert.match(html, /data-event="conversationClick" href="https:\/\/chadherst\.as\.me\/30-minute-consult-chad-herst"/);
  assert.match(html, /data-event="chapterClick" href="https:\/\/performance-trap-server\.onrender\.com\/listen\/chapter-one"/);
  assert.match(html, /data-event="mindbodyPageClick" href="https:\/\/herstwellness\.com\/mind-body-foundations"/);
  assert.doesNotMatch(html, /data-event="emailListClick"/);
});

test('browser submits the notice version supplied by the server configuration', async () => {
  const listeners = new Map();
  const elements = new Map();
  const makeElement = () => ({
    addEventListener(event, handler) { listeners.set(`${this.id}:${event}`, handler); },
    append() {},
    appendChild() {},
    classList: { add() {}, remove() {} },
    disabled: false,
    focus() {},
    id: '',
    checked: false,
    scrollHeight: 0,
    scrollTop: 0,
    textContent: '',
    value: ''
  });
  const document = {
    body: { appendChild() {} },
    createElement() { return makeElement(); },
    getElementById(id) {
      if (!elements.has(id)) {
        const element = makeElement();
        element.id = id;
        elements.set(id, element);
      }
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    referrer: ''
  };
  const requests = [];
  const serverNoticeVersion = 'server-provided-test-version';
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/config')) {
      return {
        ok: true,
        json: async () => ({
          configured: true,
          maxExchanges: 30,
          noticeVersion: serverNoticeVersion,
          sessionMinutes: 60
        })
      };
    }
    if (url.endsWith('/visit')) {
      return { ok: true, json: async () => ({ visitId: 'visit-id' }) };
    }
    if (url.endsWith('/session')) {
      return {
        ok: true,
        json: async () => ({ sessionId: 'session-id', sessionReference: 'MBF-TEST-TEST', opening: 'Opening' })
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const window = {
    addEventListener() {},
    clearInterval() {},
    innerWidth: 1200,
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { search: '' },
    screen: { width: 1200 },
    scrollTo() {},
    setInterval() { return 1; }
  };
  vm.runInNewContext(app, {
    AbortController,
    Blob,
    Date,
    document,
    fetch,
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'test' },
    URL,
    URLSearchParams,
    window
  });
  await new Promise((resolve) => setImmediate(resolve));
  elements.get('noticeConsent').checked = true;
  await listeners.get('beginButton:click')();
  const submitted = requests.find((request) => request.url.endsWith('/session'));
  assert.equal(JSON.parse(submitted.options.body).noticeVersion, serverNoticeVersion);
  assert.equal(JSON.parse(submitted.options.body).visitId, 'visit-id');
  assert.equal('X-Companion-Code' in submitted.options.headers, false);
  assert.doesNotMatch(app, /const NOTICE_VERSION\s*=/);
});

test('voice input stops the microphone, inserts editable text, and never auto-sends', async () => {
  const listeners = new Map();
  const elements = new Map();
  const makeElement = () => ({
    addEventListener(event, handler) { listeners.set(`${this.id}:${event}`, handler); },
    append() {},
    appendChild() {},
    classList: { add() {}, remove() {} },
    disabled: false,
    focus() {},
    id: '',
    checked: false,
    scrollHeight: 0,
    scrollTop: 0,
    setAttribute(name, value) { this[name] = value; },
    textContent: '',
    value: ''
  });
  const document = {
    body: { appendChild() {} },
    createElement() { return makeElement(); },
    getElementById(id) {
      if (!elements.has(id)) {
        const element = makeElement();
        element.id = id;
        elements.set(id, element);
      }
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    referrer: ''
  };
  let stoppedTracks = 0;
  const stream = { getTracks: () => [{ stop() { stoppedTracks += 1; } }] };
  class FakeMediaRecorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
    constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; this.listeners = {}; }
    addEventListener(event, handler) { this.listeners[event] = handler; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.listeners.dataavailable({ data: new Blob([new Uint8Array(1024)], { type: this.mimeType }) });
      this.listeners.stop();
    }
  }
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/config')) return { ok: true, json: async () => ({ configured: true, voiceInputAvailable: true, maxExchanges: 30, noticeVersion: 'voice-test', sessionMinutes: 60 }) };
    if (url.endsWith('/visit')) return { ok: true, json: async () => ({ visitId: 'visit-id' }) };
    if (url.endsWith('/session')) return { ok: true, json: async () => ({ sessionId: 'session-id', sessionReference: 'MBF-VOICE-TEST', opening: 'Opening' }) };
    if (url.endsWith('/event')) return { ok: true, json: async () => ({ recorded: true }) };
    if (url.endsWith('/transcribe')) return { ok: true, json: async () => ({ text: 'I notice pressure in my chest.', transcriptionCostUsd: 0.0001 }) };
    if (url.endsWith('/claude-response')) return { ok: true, json: async () => ({ route: 'continue_reflection', response: 'Stay with that pressure.', responseCostUsd: 0.001 }) };
    throw new Error(`Unexpected request: ${url}`);
  };
  const window = {
    addEventListener() {},
    clearInterval() {},
    clearTimeout() {},
    innerWidth: 1200,
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { search: '' },
    screen: { width: 1200 },
    scrollTo() {},
    setInterval() { return 1; },
    setTimeout() { return 2; }
  };
  vm.runInNewContext(app, {
    AbortController,
    Blob,
    Date,
    document,
    fetch,
    MediaRecorder: FakeMediaRecorder,
    navigator: {
      clipboard: { writeText: async () => {} },
      mediaDevices: { getUserMedia: async () => stream },
      userAgent: 'test'
    },
    URL,
    URLSearchParams,
    window
  });
  await new Promise((resolve) => setImmediate(resolve));
  elements.get('noticeConsent').checked = true;
  await listeners.get('beginButton:click')();
  listeners.get('recordButton:click')();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 550));
  listeners.get('recordButton:click')();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const transcriptionRequest = requests.find((request) => request.url.endsWith('/transcribe'));
  assert.ok(transcriptionRequest);
  assert.equal(transcriptionRequest.options.headers['X-Companion-Session-Id'], 'session-id');
  assert.equal(transcriptionRequest.options.headers['Content-Type'], 'audio/webm');
  assert.equal(stoppedTracks, 1);
  assert.equal(elements.get('responseText').value, 'I notice pressure in my chest.');
  assert.equal(requests.some((request) => request.url.endsWith('/claude-response')), false);

  elements.get('responseText').value += ' Edited.';
  listeners.get('responseText:input')();
  await listeners.get('responseForm:submit')({ preventDefault() {} });
  assert.equal(requests.some((request) => request.url.endsWith('/claude-response')), true);
  const events = requests.filter((request) => request.url.endsWith('/event')).map((request) => JSON.parse(request.options.body).eventName);
  assert.ok(events.includes('voiceRecordingStarts'));
  assert.ok(events.includes('voiceRecordingStops'));
  assert.ok(events.includes('voiceTranscriptCorrections'));
});

test('dashboard copy separates estimated companion invitations from estimated participant evidence', () => {
  assert.match(adminHtml, /Companion invited this step/);
  assert.match(adminHtml, /Participant demonstrated this step/);
  assert.match(adminHtml, /Automatically estimated from participant responses and potentially imperfect/);
  assert.doesNotMatch(adminHtml, /Process stages reached/);
  assert.match(adminApp, /processInvitations/);
  assert.match(adminApp, /processEvidence/);
});

test('administrative secrets are not present in browser source', () => {
  assert.match(adminHtml, /separate administrative code/i);
  assert.doesNotMatch(`${adminHtml}\n${adminApp}`, /COMPANION_ADMIN_CODE|private-code|admin-secret|RESEND_API_KEY/);
});

test('the main API key is absent from every browser asset', () => {
  assert.doesNotMatch(`${html}\n${app}`, /OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-server-only-secret|sk-ant-server-only-secret/);
});

test('coaching prompt starts with story, earns embodiment, welcomes memory, and stays circular', () => {
  assert.match(prompt, /The initial entry has an order: hear the story, make a moment live, and earn the first U-turn into the body/);
  assert.match(prompt, /what(?:'s| is) the worst of it/i);
  assert.match(prompt, /A childhood memory or an earlier scene may arise on its own/);
  assert.match(prompt, /It is circular, not a sequence to finish/);
  assert.match(prompt, /reflection can be the entire response/i);
  assert.match(prompt, /Some accounts are not a past moment at all/);
  assert.match(prompt, /When the user spontaneously names an emotion while telling the story/);
  assert.match(prompt, /After the first sensation appears, stay with it/);
});

test('user-facing written copy contains no em dash', () => {
  assert.doesNotMatch(`${html}\n${app}\n${adminHtml}\n${adminApp}\n${prompt}`, /—/);
});

test('the sitting carries a consult offer that stays hidden until the sitting closes well', () => {
  assert.match(html, /id="consultOffer" class="consult-offer hidden"/);
  assert.match(html, /href="https:\/\/chadherst\.as\.me\/30-minute-consult-chad-herst"/);
  assert.match(html, /Explore further with Chad/);
  assert.match(html, /most of the time goes into exploring what your body is holding/);
  assert.doesNotMatch(html, /No pitch, no script/);
  assert.doesNotMatch(html, /you're body|you are body/);
  assert.match(html, /Nothing from this sitting goes with it\./);

  assert.match(app, /if \(data\.sittingComplete\) revealConsultOffer\(\);/);
  assert.match(app, /ui\.consultOffer\.classList\.add\('hidden'\)/);
  assert.doesNotMatch(app, /SITTING COMPLETE/);

  assert.match(prompt, /\[\[SITTING COMPLETE\]\]/);
  assert.match(prompt, /Do not make this offer at all if the sitting ended early/);
  assert.match(prompt, /Never claim an outcome/);
});

test('the companion offers its own read before the consult, and hands it back to be checked', () => {
  assert.match(prompt, /Your read, offered and checked/);
  assert.match(prompt, /Go back to how they opened/);
  assert.match(prompt, /as a reading, not a verdict/);
  assert.match(prompt, /Hand it back for checking/);
  assert.match(prompt, /Does that land\?/);
  assert.match(prompt, /Never diagnose, never\s+name a condition/);
  assert.match(prompt, /skip this move rather than manufacturing one|say that plainly and skip\s+this move/);
  assert.match(prompt, /keep your own reading out of the summary itself/);
  assert.doesNotMatch(prompt, /Do not add an interpretation or new exercise/);
  assert.ok(prompt.indexOf('Your read, offered and checked') < prompt.indexOf('The next step, and the close'),
    'the read is offered before the consult, not after');
});
