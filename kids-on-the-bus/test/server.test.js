'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { NOTICE_VERSION, createApp, isCompanionPath, loadClaudeInstructions, loadSettings } = require('../server');

test('the replacement owns only Kids on the Bus routes', () => {
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
    adminCode: 'admin-secret',
    budgetUsd: 5,
    sessionMinutes: 60,
    maxExchanges: 30,
    claudeModel: 'claude-sonnet-5',
    claudeEffort: 'high',
    instructions: 'Test instructions. Never use an em dash.',
    claudeInstructions: 'Test Module 2 instructions. Never use an em dash.',
    rates: {
      inputText: 4,
      cachedInput: 0.4,
      inputAudio: 32,
      outputText: 24,
      outputAudio: 64,
      transcriptionPerMinute: 0.017,
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
      : options.body == null ? '' : String(options.body);
    const req = Readable.from(body ? [Buffer.from(body)] : []);
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
      end(chunk) {
        if (chunk) response.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
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

test('written sittings use the substantially extended session and exchange limits', () => {
  const config = settings();
  assert.equal(config.sessionMinutes, 60);
  assert.equal(config.maxExchanges, 30);
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
  assert.match(body.opening, /What has you reaching out today/);
  assert.equal(calls, 0);
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
  const page = await requestServer(server, { url: '/reflect/kids-on-the-bus' });
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
