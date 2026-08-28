'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { NOTICE_VERSION, createApp, isCompanionPath, loadClaudeInstructions, loadSettings, sittingTimeNote } = require('../server');

test('the replacement owns only Kids on the Bus routes', () => {
  assert.equal(isCompanionPath('/start-anywhere'), true);
  assert.equal(isCompanionPath('/reflect/kids-on-the-bus'), true);
  assert.equal(isCompanionPath('/kids-on-the-bus/app.js'), true);
  assert.equal(isCompanionPath('/api/kids-on-the-bus/config'), true);
  assert.equal(isCompanionPath('/health'), false);
  assert.equal(isCompanionPath('/book'), false);
  assert.equal(isCompanionPath('/reading'), false);
});

test('configured retention cannot exceed the disclosed maximums', () => {
  const configured = loadSettings({
    COMPANION_ANALYTICS_RETENTION_DAYS: '730',
    COMPANION_SHARED_RETENTION_DAYS: '365'
  });
  assert.equal(configured.analyticsRetentionDays, 365);
  assert.equal(configured.sharedRetentionDays, 90);
});

function settings(overrides = {}) {
  return {
    port: 0,
    apiKey: 'sk-server-only-secret',
    anthropicKey: 'sk-ant-server-only-secret',
    openaiKey: 'sk-openai-server-only-secret',
    adminCode: 'admin-secret',
    budgetUsd: 5,
    sessionMinutes: 30,
    maxExchanges: 20,
    claudeModel: 'claude-sonnet-5',
    claudeEffort: 'high',
    instructions: 'Test instructions. Never use an em dash.',
    claudeInstructions: 'Test Module 2 instructions. Never use an em dash.',
    transcriptionModel: 'gpt-transcribe',
    maxAudioBytes: 10 * 1024 * 1024,
    maxAudioDurationMs: 2 * 60 * 1000,
    rates: {
      inputText: 4,
      cachedInput: 0.4,
      inputAudio: 32,
      outputText: 24,
      outputAudio: 64,
      transcriptionPerMinute: 0.0045,
      claudeInput: 3,
      claudeOutput: 15,
      claudeCacheWrite: 3.75,
      claudeCacheRead: 0.3
    },
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'realtime-server-')),
    analyticsRetentionDays: 365,
    sharedRetentionDays: 90,
    weeklyReport: { enabled: false },
    ...overrides
  };
}

function requestServer(server, options = {}) {
  return new Promise((resolve, reject) => {
    const isSessionStart = options.method === 'POST' && options.url === '/api/kids-on-the-bus/session';
    const body = options.body == null && isSessionStart
      ? JSON.stringify({ acknowledged: true, noticeVersion: NOTICE_VERSION })
      : options.body == null ? '' : options.body;
    const req = Readable.from(body && body.length !== 0 ? [Buffer.isBuffer(body) ? body : Buffer.from(String(body))] : []);
    req.method = options.method || 'GET';
    req.url = options.url || '/';
    req.headers = Object.fromEntries(
      Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    const response = { status: 200, headers: {}, chunks: [], headersSent: false };
    const res = {
      get headersSent() { return response.headersSent; },
      writeHead(status, headers) {
        response.status = status;
        response.headers = headers || {};
        response.headersSent = true;
      },
      write(chunk) {
        if (chunk) response.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return true;
      },
      get writableEnded() { return response.ended === true; },
      end(chunk) {
        if (chunk) response.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        response.ended = true;
        response.body = Buffer.concat(response.chunks).toString('utf8');
        resolve(response);
      }
    };
    server.emit('request', req, res);
    req.on('error', reject);
  });
}

test('private companion refuses an unreviewed change to the authoritative Module 2 prompt', () => {
  const changedPrompt = path.join(os.tmpdir(), `changed-module2-${Date.now()}.txt`);
  fs.writeFileSync(changedPrompt, 'You are the Module 2 Reflection Companion. Changed without review.');
  assert.throws(
    () => loadClaudeInstructions({ MODULE2_FIDELITY_PROMPT_PATH: changedPrompt }),
    /has changed and must be reviewed/
  );
  fs.rmSync(changedPrompt, { force: true });
});

test('written sittings default to the shortened session and exchange limits', () => {
  const defaults = loadSettings({ ANTHROPIC_API_KEY: 'sk-test' });
  assert.equal(defaults.sessionMinutes, 30);
  assert.equal(defaults.maxExchanges, 20);
});

test('configuration exposes optional voice input without exposing the OpenAI key', async () => {
  const appSettings = settings();
  const server = createApp({ settings: appSettings });
  const config = await requestServer(server, { url: '/api/kids-on-the-bus/config' });
  assert.equal(config.status, 200);
  assert.equal(JSON.parse(config.body).voiceInputAvailable, true);
  assert.doesNotMatch(config.body, /sk-openai|openaiKey|OPENAI_API_KEY/);
  const page = await requestServer(server, { url: '/start-anywhere' });
  assert.match(page.headers['Permissions-Policy'], /microphone=\(self\)/);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('the public browser can start a session without a visitor access code', async () => {
  const appSettings = settings();
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const response = await requestServer(server, {
      method: 'POST',
      url: '/api/kids-on-the-bus/session'
  });
  assert.equal(response.status, 200);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('written session starts without calling the paused voice provider', async () => {
  const appSettings = settings();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('must not call'); };
  const server = createApp({ settings: appSettings, fetchImpl });
  const response = await requestServer(server, {
      method: 'POST',
      url: '/api/kids-on-the-bus/session'
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.ok(body.sessionId);
  assert.match(body.sessionReference, /^MBF-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(body.opening, 'What\'s been going on in your last few days? Start anywhere.');
  assert.equal(calls, 0);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('a bounded recording is transcribed without storing audio or transcript content', async () => {
  const appSettings = settings();
  let upstreamChecked = false;
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer sk-openai-server-only-secret');
    assert.equal(options.body.get('model'), 'gpt-transcribe');
    const file = options.body.get('file');
    assert.equal(file.type, 'audio/webm');
    assert.equal(file.size, 2048);
    upstreamChecked = true;
    return new Response(JSON.stringify({ text: 'I notice a tight feeling in my chest.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const started = await requestServer(server, { method: 'POST', url: '/api/kids-on-the-bus/session' });
  const session = JSON.parse(started.body);
  const response = await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/transcribe',
    headers: {
      'Content-Type': 'audio/webm;codecs=opus',
      'X-Companion-Session-Id': session.sessionId,
      'X-Audio-Duration-Ms': '12500'
    },
    body: Buffer.alloc(2048, 7)
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).text, 'I notice a tight feeling in my chest.');
  assert.equal(upstreamChecked, true);

  const dashboard = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Admin-Code': 'admin-secret' },
    url: '/api/kids-on-the-bus/admin/insights',
    body: '{}'
  });
  const row = JSON.parse(dashboard.body).sessions[0];
  assert.equal(row.voiceTranscriptionSuccesses, 1);
  assert.equal(row.voiceTranscriptionFailures, 0);
  assert.equal(row.voiceRecordedSeconds, 12.5);
  assert.ok(row.medianTranscriptionTimeMs >= 0);
  const stored = fs.readFileSync(path.join(appSettings.dataDir, 'usage-ledger.json'), 'utf8');
  assert.doesNotMatch(stored, /tight feeling|audio\/webm|\u0007/);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('transcription failures are content-free, counted, and preserve the writing fallback', async () => {
  const appSettings = settings();
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'provider detail must stay private' } }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
  const server = createApp({ settings: appSettings, fetchImpl });
  const started = await requestServer(server, { method: 'POST', url: '/api/kids-on-the-bus/session' });
  const session = JSON.parse(started.body);
  const response = await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/transcribe',
    headers: {
      'Content-Type': 'audio/webm',
      'X-Companion-Session-Id': session.sessionId,
      'X-Audio-Duration-Ms': '3000'
    },
    body: Buffer.alloc(1024, 3)
  });
  assert.equal(response.status, 502);
  assert.match(response.body, /continue by writing/i);
  assert.doesNotMatch(response.body, /provider detail|openai/i);
  const dashboard = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Admin-Code': 'admin-secret' },
    url: '/api/kids-on-the-bus/admin/insights',
    body: '{}'
  });
  const row = JSON.parse(dashboard.body).sessions[0];
  assert.equal(row.voiceTranscriptionSuccesses, 0);
  assert.equal(row.voiceTranscriptionFailures, 1);
  assert.equal(row.serverErrors, 0);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('the former Realtime voice-session endpoint is paused', async () => {
  const appSettings = settings();
  let calls = 0;
  const server = createApp({ settings: appSettings, fetchImpl: async () => { calls += 1; } });
  const response = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/realtime/session'
  });
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('zero private budget blocks a written sitting while the page remains available', async () => {
  const appSettings = settings({ budgetUsd: 0 });
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const page = await requestServer(server, { url: '/start-anywhere' });
  assert.equal(page.status, 200);
  const session = await requestServer(server, {
      method: 'POST',
      url: '/api/kids-on-the-bus/session'
  });
  assert.equal(session.status, 503);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('page visits and pre-session funnel events are stored without reflection content', async () => {
  const appSettings = settings();
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const visitResponse = await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/visit',
    body: JSON.stringify({
      referral: { referringPage: 'https://herstwellness.com/mind-body-foundations?private=discarded', utmSource: 'foundations-page' },
      device: { category: 'Phone', browserFamily: 'Safari', operatingSystemFamily: 'iOS or iPadOS', screenSizeCategory: 'Small' },
      returningBrowser: true,
      reflectionText: 'This must never be stored.'
    })
  });
  const visitId = JSON.parse(visitResponse.body).visitId;
  await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/visit/event',
    body: JSON.stringify({ visitId, eventName: 'beginAttempts', reflectionText: 'Still must not be stored.' })
  });
  const started = await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/session',
    body: JSON.stringify({ acknowledged: true, noticeVersion: NOTICE_VERSION, visitId })
  });
  assert.equal(started.status, 200);
  const dashboard = await requestServer(server, {
    method: 'POST', headers: { 'X-Companion-Admin-Code': 'admin-secret' }, url: '/api/kids-on-the-bus/admin/insights', body: '{}'
  });
  const data = JSON.parse(dashboard.body);
  assert.equal(data.funnel.pageVisits, 1);
  assert.equal(data.funnel.beginAttempts, 1);
  assert.equal(data.funnel.trackedStarts, 1);
  assert.equal(data.visits[0].returningBrowser, true);
  assert.equal(data.visits[0].referral.referringPage, 'https://herstwellness.com/mind-body-foundations');
  assert.doesNotMatch(fs.readFileSync(path.join(appSettings.dataDir, 'usage-ledger.json'), 'utf8'), /This must never|Still must never|private=discarded/);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('safety endpoint returns fixed routing without invoking OpenAI', async () => {
  const appSettings = settings();
  let calls = 0;
  const server = createApp({ settings: appSettings, fetchImpl: async () => { calls += 1; } });
  const response = await requestServer(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
      url: '/api/kids-on-the-bus/safety-check',
      body: JSON.stringify({ text: 'I have a plan to kill myself tonight.' })
  });
  const result = JSON.parse(response.body);
  assert.equal(result.route, 'urgent_self_harm');
  assert.equal(calls, 0);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('Claude route uses the exact server-side Module 2 instructions and records content-free cost', async () => {
  const appSettings = settings();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/v1/messages')) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Something about that demand feels tight in you. Where do you notice it?' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 40,
          output_tokens: 18,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 0
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const session = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/session'
  });
  const sessionId = JSON.parse(session.body).sessionId;
  const response = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({
      sessionId,
      message: 'It feels like a demand.',
      history: [{ role: 'user', content: 'Melissa said she had been crying.' }]
    })
  });
  const body = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(body.handledBy, 'claude');
  assert.equal(body.response, 'Something about that demand feels tight in you. Where do you notice it?');
  assert.ok(body.costBreakdown.claudeUsd > 0);
  const claudeCall = calls.find((call) => call.url.includes('/v1/messages'));
  const payload = JSON.parse(claudeCall.options.body);
  assert.equal(claudeCall.options.headers['x-api-key'], 'sk-ant-server-only-secret');
  assert.equal(payload.model, 'claude-sonnet-5');
  assert.deepEqual(payload.output_config, { effort: 'high' });
  assert.equal(payload.system[0].text, appSettings.claudeInstructions);
  assert.deepEqual(payload.system[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(payload.messages, [
    { role: 'user', content: 'Melissa said she had been crying.' },
    { role: 'user', content: 'It feels like a demand.' }
  ]);
  assert.doesNotMatch(response.body, /sk-ant-server-only-secret|Test Module 2 instructions/);
  const ledger = fs.readFileSync(path.join(appSettings.dataDir, 'usage-ledger.json'), 'utf8');
  assert.doesNotMatch(ledger, /Melissa|demand|Something about/);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('fixed crisis routing bypasses Claude inside the combined coaching endpoint', async () => {
  const appSettings = settings();
  let claudeCalls = 0;
  const fetchImpl = async () => {
    claudeCalls += 1;
    throw new Error('Claude must not be called');
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const session = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/session'
  });
  const response = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({
      sessionId: JSON.parse(session.body).sessionId,
      message: 'I have a plan to kill myself tonight.'
    })
  });
  const body = JSON.parse(response.body);
  assert.equal(body.route, 'urgent_self_harm');
  assert.equal(body.handledBy, 'fixed-safety');
  assert.equal(claudeCalls, 0);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('ending an obsolete browser request cancels the upstream Claude request', async () => {
  const appSettings = settings();
  let upstreamStarted;
  const started = new Promise((resolve) => { upstreamStarted = resolve; });
  let upstreamAborted = false;
  const fetchImpl = async (url, options) => {
    if (url.includes('/v1/messages')) {
      upstreamStarted();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          upstreamAborted = true;
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  try {
    const session = await requestServer(server, {
      method: 'POST',
      headers: { 'X-Companion-Code': 'private-code' },
      url: '/api/kids-on-the-bus/session'
    });
    const requestBody = JSON.stringify({
      sessionId: JSON.parse(session.body).sessionId,
      message: 'I started another thought before this answer arrived.'
    });
    const req = Readable.from([Buffer.from(requestBody)]);
    req.method = 'POST';
    req.url = '/api/kids-on-the-bus/claude-response';
    req.headers = {
      'content-type': 'application/json',
      'x-companion-code': 'private-code'
    };
    class MockResponse extends EventEmitter {
      constructor() {
        super();
        this.headersSent = false;
        this.writableEnded = false;
      }
      writeHead() { this.headersSent = true; }
      end() { this.writableEnded = true; }
    }
    const res = new MockResponse();
    server.emit('request', req, res);
    await started;
    res.emit('close');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(upstreamAborted, true);
  } finally {
    fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
  }
});

test('the current information notice must be acknowledged before a sitting begins', async () => {
  const appSettings = settings();
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const response = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/session',
    body: JSON.stringify({ acknowledged: false, noticeVersion: NOTICE_VERSION })
  });
  assert.equal(response.status, 400);
  assert.match(response.body, /acknowledge/i);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('the analytics dashboard requires the separate administrative code', async () => {
  const appSettings = settings();
  const server = createApp({ settings: appSettings });
  const publicCode = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/admin/insights',
    body: '{}'
  });
  assert.equal(publicCode.status, 401);
  const admin = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Admin-Code': 'admin-secret' },
    url: '/api/kids-on-the-bus/admin/insights',
    body: '{}'
  });
  assert.equal(admin.status, 200);
  assert.doesNotMatch(admin.body, /admin-secret|sk-ant-server-only-secret/);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('server startup activates automatic shared-sitting retention pruning', () => {
  const appSettings = settings();
  let started = 0;
  let stopped = 0;
  const sharedStore = {
    prune() {},
    startAutomaticPruning() { started += 1; },
    stopAutomaticPruning() { stopped += 1; }
  };
  const server = createApp({ settings: appSettings, sharedStore });
  assert.equal(started, 1);
  server.emit('close');
  assert.equal(stopped, 1);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('structured records survive a server process restart in the same persistent directory', async () => {
  const appSettings = settings();
  const firstProcess = createApp({ settings: appSettings });
  const started = await requestServer(firstProcess, {
    method: 'POST', headers: { 'X-Companion-Code': 'private-code' }, url: '/api/kids-on-the-bus/session'
  });
  const session = JSON.parse(started.body);
  await requestServer(firstProcess, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/session/end',
    body: JSON.stringify({ sessionId: session.sessionId, reason: 'completed' })
  });

  const restartedProcess = createApp({ settings: appSettings });
  const dashboard = await requestServer(restartedProcess, {
    method: 'POST', headers: { 'X-Companion-Admin-Code': 'admin-secret' }, url: '/api/kids-on-the-bus/admin/insights', body: '{}'
  });
  const saved = JSON.parse(dashboard.body).sessions;
  assert.equal(saved[0].sessionReference, session.sessionReference);
  assert.equal(saved[0].completed, true);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('optional sitting permission saves exact text separately with consent metadata', async () => {
  const appSettings = settings();
  const fetchImpl = async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'Where does that land in your body?' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 8 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const server = createApp({ settings: appSettings, fetchImpl });
  const started = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/session',
    body: JSON.stringify({ acknowledged: true, noticeVersion: NOTICE_VERSION, shareSitting: true })
  });
  const session = JSON.parse(started.body);
  await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({ sessionId: session.sessionId, message: 'This is my separately shared exact entry.' })
  });
  const sharedPath = path.join(appSettings.dataDir, 'shared-sittings', `${session.sessionReference}.json`);
  const shared = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
  const ledger = fs.readFileSync(path.join(appSettings.dataDir, 'usage-ledger.json'), 'utf8');
  assert.equal(shared.noticeVersion, NOTICE_VERSION);
  assert.equal(shared.retentionDays, 90);
  assert.equal(shared.publicQuotationPermission, false);
  assert.match(shared.turns[0].user, /separately shared exact entry/);
  assert.doesNotMatch(ledger, /separately shared exact entry|Where does that land/);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('a sitting that closes well hands back the consult offer, and the marker never reaches the person', async () => {
  const appSettings = settings();
  const closingText = [
    'That distinction is the whole thing this exercise points at.',
    '',
    'This exercise stops here, at recognition. What you are calling deeper digging is the kind of thing that happens with another person. Chad does a thirty minute session where the two of you translate what your body has been trying to tell you, if you want to take what came up today further.',
    '',
    '[[SITTING COMPLETE]]'
  ].join('\n');
  const fetchImpl = async (url) => {
    if (url.includes('/v1/messages')) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: closingText }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 40, output_tokens: 18, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const session = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/session'
  });
  const sessionId = JSON.parse(session.body).sessionId;
  const response = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({ sessionId, message: 'No, that is good.', history: [] })
  });
  const body = JSON.parse(response.body);
  assert.equal(response.status, 200);
  assert.equal(body.sittingComplete, true);
  assert.equal(body.consultUrl, 'https://chadherst.as.me/30-minute-consult-chad-herst');
  assert.doesNotMatch(response.body, /SITTING COMPLETE/);
  assert.ok(body.response.endsWith('if you want to take what came up today further.'));
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('an ordinary mid-sitting turn carries no consult offer', async () => {
  const appSettings = settings();
  const fetchImpl = async (url) => {
    if (url.includes('/v1/messages')) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'Where does that land in the body?' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 40, output_tokens: 18, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const session = await requestServer(server, {
    method: 'POST',
    headers: { 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/session'
  });
  const sessionId = JSON.parse(session.body).sessionId;
  const response = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({ sessionId, message: 'It burns in my chest.', history: [] })
  });
  const body = JSON.parse(response.body);
  assert.equal(body.sittingComplete, false);
  assert.equal(body.consultUrl, '');
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('a sitting near its exchange limit carries an uncached wind-down note after the cached instructions', async () => {
  const appSettings = settings();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/v1/messages')) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'What are you carrying forward from this?' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 40, output_tokens: 18, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const session = await requestServer(server, { method: 'POST', url: '/api/kids-on-the-bus/session' });
  const sessionId = JSON.parse(session.body).sessionId;
  const longHistory = Array.from({ length: 16 }, (unused, index) => [
    { role: 'user', content: `entry ${index}` },
    { role: 'assistant', content: `response ${index}` }
  ]).flat();
  const shortHistory = [{ role: 'user', content: 'entry' }, { role: 'assistant', content: 'response' }];
  for (const history of [shortHistory, longHistory]) {
    await requestServer(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      url: '/api/kids-on-the-bus/claude-response',
      body: JSON.stringify({ sessionId, message: 'It settled.', history })
    });
  }
  const [early, late] = calls.filter((call) => call.url.includes('/v1/messages')).map((call) => JSON.parse(call.options.body));
  assert.equal(early.system.length, 1);
  assert.equal(late.system.length, 2);
  assert.deepEqual(late.system[0].cache_control, { type: 'ephemeral' });
  assert.match(late.system[1].text, /SITTING TIME/);
  assert.match(late.system[1].text, /Compress the closing/);
  assert.equal('cache_control' in late.system[1], false);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('the old address still works, sending people to the new one and keeping their tracking parameters', async () => {
  const appSettings = settings({});
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const bare = await requestServer(server, { url: '/reflect/kids-on-the-bus' });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.Location, '/start-anywhere');
  const tagged = await requestServer(server, { url: '/reflect/kids-on-the-bus?source=companion-page&utm_source=substack' });
  assert.equal(tagged.status, 301);
  assert.equal(tagged.headers.Location, '/start-anywhere?source=companion-page&utm_source=substack');
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('a sitting closes deliberately at the closing minute instead of running into the wall', () => {
  const open = sittingTimeNote({ exchangesRemaining: 14, minutesRemaining: 22, elapsedMinutes: 8, closeMinutes: 25 });
  assert.equal(open.finalTurn, false);
  assert.equal(open.contextNote, '', 'a sitting with room left gets no timing instruction at all');

  const winding = sittingTimeNote({ exchangesRemaining: 9, minutesRemaining: 5, elapsedMinutes: 21, closeMinutes: 25 });
  assert.equal(winding.finalTurn, false);
  assert.match(winding.contextNote, /Begin moving toward closing now/);

  const byClock = sittingTimeNote({ exchangesRemaining: 9, minutesRemaining: 4, elapsedMinutes: 26, closeMinutes: 25 });
  assert.equal(byClock.finalTurn, true, 'past the closing minute, this is the last response');
  assert.match(byClock.contextNote, /final response of the sitting/);
  assert.doesNotMatch(byClock.contextNote, /minutes remain after this response/, 'the final turn does not dangle a next exchange');

  const byExchanges = sittingTimeNote({ exchangesRemaining: 0, minutesRemaining: 18, elapsedMinutes: 6, closeMinutes: 25 });
  assert.equal(byExchanges.finalTurn, true, 'the last allowed exchange also closes deliberately');
});

test('the closing minute always leaves the hard limit as a backstop behind it', () => {
  const base = { ANTHROPIC_API_KEY: 'k', REALTIME_DATA_DIR: os.tmpdir() };
  assert.equal(loadSettings({ ...base }).closeMinutes, 25, 'twenty five by default');
  assert.equal(loadSettings({ ...base }).sessionMinutes, 30);
  const short = loadSettings({ ...base, WRITTEN_SESSION_MINUTES: '10' });
  assert.equal(short.sessionMinutes, 10);
  assert.equal(short.closeMinutes, 9, 'a short sitting still closes before its own wall');
  const explicit = loadSettings({ ...base, WRITTEN_SESSION_MINUTES: '40', WRITTEN_CLOSE_MINUTES: '30' });
  assert.equal(explicit.closeMinutes, 30);
});

function sseUpstream(frames) {
  return Readable.from(frames.map((f) => Buffer.from(`event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`)));
}

function parseSse(body) {
  return body.split('\n\n').filter(Boolean).map((frame) => {
    const lines = frame.split('\n');
    return {
      event: (lines.find((l) => l.startsWith('event:')) || '').slice(6).trim(),
      data: JSON.parse((lines.find((l) => l.startsWith('data:')) || 'data: {}').slice(5).trim())
    };
  });
}

test('a streamed sitting reaches the reader in pieces, and the completion marker never does', async () => {
  const appSettings = settings();
  const server = createApp({
    settings: appSettings,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: sseUpstream([
        { type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 17000 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'That sounds like it took something. ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Carry that with you. [[SITT' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ING COMPLETE]]' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }
      ])
    })
  });
  const started = await requestServer(server, { method: 'POST', url: '/api/kids-on-the-bus/session' });
  const sessionId = JSON.parse(started.body).sessionId;
  const turn = await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({ sessionId, message: 'I said yes again.', history: [], stream: true })
  });

  assert.match(turn.headers['Content-Type'], /text\/event-stream/);
  assert.equal(turn.headers['X-Accel-Buffering'], 'no', 'proxies must not buffer the stream');
  const events = parseSse(turn.body);
  const deltas = events.filter((e) => e.event === 'delta');
  assert.ok(deltas.length > 1, 'the reader gets the response in pieces, not one lump');
  const shown = deltas.map((e) => e.data.text).join('');
  assert.equal(shown, 'That sounds like it took something. Carry that with you. ');
  assert.doesNotMatch(turn.body, /SITTING COMPLETE/, 'the marker never appears anywhere in the stream');

  const done = events.find((e) => e.event === 'done');
  assert.equal(done.data.sittingComplete, true);
  assert.equal(done.data.route, 'continue_reflection');
  assert.ok(done.data.consultUrl.includes('30-minute-consult'));
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('a stream that dies mid-response tells the reader inside the stream', async () => {
  const appSettings = settings();
  const server = createApp({
    settings: appSettings,
    fetchImpl: async () => ({ ok: false, status: 500, body: null })
  });
  const started = await requestServer(server, { method: 'POST', url: '/api/kids-on-the-bus/session' });
  const sessionId = JSON.parse(started.body).sessionId;
  const turn = await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({ sessionId, message: 'Still here.', history: [], stream: true })
  });
  const events = parseSse(turn.body);
  assert.equal(events.some((e) => e.event === 'done'), false);
  assert.equal(events.find((e) => e.event === 'failed').data.error, 'The companion could not finish responding. Please try again.');
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('a browser that does not ask for a stream still gets the whole response at once', async () => {
  const appSettings = settings();
  const server = createApp({
    settings: appSettings,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: 'Say more about that moment.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 }
      })
    })
  });
  const started = await requestServer(server, { method: 'POST', url: '/api/kids-on-the-bus/session' });
  const sessionId = JSON.parse(started.body).sessionId;
  const turn = await requestServer(server, {
    method: 'POST',
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({ sessionId, message: 'I went quiet.', history: [] })
  });
  assert.match(turn.headers['Content-Type'], /application\/json/);
  assert.equal(JSON.parse(turn.body).response, 'Say more about that moment.');
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('the effort comparison is gated, blind, and shuffled, and only reveals after a choice', async () => {
  const appSettings = settings();
  const asked = [];
  const server = createApp({
    settings: appSettings,
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body);
      const effort = payload.output_config.effort;
      asked.push(effort);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: `Answer at ${effort} effort.` }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 }
        })
      };
    }
  });

  const locked = await requestServer(server, {
    method: 'POST', url: '/api/kids-on-the-bus/admin/compare',
    body: JSON.stringify({ message: 'I went quiet again.', leftEffort: 'high', rightEffort: 'medium' })
  });
  assert.equal(locked.status, 401, 'the comparison needs the administrative code');
  assert.equal(asked.length, 0, 'nothing is generated for an unauthorised caller');

  const auth = { 'Content-Type': 'application/json', 'X-Companion-Admin-Code': 'admin-secret' };
  const sameBoth = await requestServer(server, {
    method: 'POST', url: '/api/kids-on-the-bus/admin/compare', headers: auth,
    body: JSON.stringify({ message: 'Anything.', leftEffort: 'high', rightEffort: 'high' })
  });
  assert.equal(sameBoth.status, 400, 'comparing a level against itself is refused');

  const compared = await requestServer(server, {
    method: 'POST', url: '/api/kids-on-the-bus/admin/compare', headers: auth,
    body: JSON.stringify({ message: 'I went quiet again.', leftEffort: 'high', rightEffort: 'medium' })
  });
  const pair = JSON.parse(compared.body);
  assert.deepEqual(asked.slice().sort(), ['high', 'medium'], 'both levels answer the same message');
  assert.ok(pair.pairId);
  const shown = `${pair.first.text}\n${pair.second.text}`;
  assert.match(shown, /Answer at high effort\./);
  assert.match(shown, /Answer at medium effort\./);
  assert.equal('effort' in pair.first, false, 'the page is never told which side is which');
  assert.equal('effort' in pair.second, false);

  const chosen = await requestServer(server, {
    method: 'POST', url: '/api/kids-on-the-bus/admin/compare/choose', headers: auth,
    body: JSON.stringify({ pairId: pair.pairId, choice: 'first' })
  });
  const verdict = JSON.parse(chosen.body);
  assert.equal(verdict.chosen, verdict.first, 'choosing the first reveals what the first was');
  assert.equal(verdict.tally[verdict.first], 1);

  const again = await requestServer(server, {
    method: 'POST', url: '/api/kids-on-the-bus/admin/compare/choose', headers: auth,
    body: JSON.stringify({ pairId: pair.pairId, choice: 'second' })
  });
  assert.equal(JSON.parse(again.body).tally[verdict.first], 1, 'a second click cannot pad the tally');

  const stale = await requestServer(server, {
    method: 'POST', url: '/api/kids-on-the-bus/admin/compare/choose', headers: auth,
    body: JSON.stringify({ pairId: 'not-a-real-pair', choice: 'first' })
  });
  assert.equal(stale.status, 400);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('the comparison page is served, carries no code, and is never indexed', async () => {
  const appSettings = settings();
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const page = await requestServer(server, { url: '/admin/effort-compare' });
  assert.equal(page.status, 200);
  assert.match(page.body, /noindex/);
  assert.doesNotMatch(page.body, /admin-secret/);
  assert.equal(isCompanionPath('/admin/effort-compare'), true);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});
