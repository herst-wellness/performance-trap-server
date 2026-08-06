'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createApp, isCompanionPath, loadClaudeInstructions, sessionConfiguration } = require('../server');

test('the replacement owns only Kids on the Bus routes', () => {
  assert.equal(isCompanionPath('/reflect/kids-on-the-bus'), true);
  assert.equal(isCompanionPath('/kids-on-the-bus/app.js'), true);
  assert.equal(isCompanionPath('/api/kids-on-the-bus/config'), true);
  assert.equal(isCompanionPath('/health'), false);
  assert.equal(isCompanionPath('/book'), false);
  assert.equal(isCompanionPath('/reading'), false);
});

function settings(overrides = {}) {
  return {
    port: 0,
    apiKey: 'sk-server-only-secret',
    anthropicKey: 'sk-ant-server-only-secret',
    accessCode: 'private-code',
    budgetUsd: 5,
    sessionMinutes: 20,
    maxExchanges: 12,
    model: 'gpt-realtime-2.1',
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
    ...overrides
  };
}

function requestServer(server, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body == null ? '' : String(options.body);
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

test('Realtime session is full model, native audio, low semantic VAD, and no automatic reply before safety', () => {
  const config = sessionConfiguration(settings(), 'cedar');
  assert.equal(config.model, 'gpt-realtime-2.1');
  assert.deepEqual(config.output_modalities, ['audio']);
  assert.equal(config.audio.output.voice, 'cedar');
  assert.equal(config.audio.input.turn_detection.type, 'semantic_vad');
  assert.equal(config.audio.input.turn_detection.eagerness, 'low');
  assert.equal(config.audio.input.turn_detection.create_response, false);
  assert.equal(config.audio.input.turn_detection.interrupt_response, true);
  assert.equal(config.audio.input.transcription.model, 'gpt-live-transcribe');
  assert.equal(config.audio.input.transcription.delay, 'low');
  assert.deepEqual(config.tools, []);
  assert.equal(config.tracing, null);
});

test('voice test refuses an unreviewed change to the authoritative Module 2 prompt', () => {
  const changedPrompt = path.join(os.tmpdir(), `changed-module2-${Date.now()}.txt`);
  fs.writeFileSync(changedPrompt, 'You are the Module 2 Reflection Companion. Changed without review.');
  assert.throws(
    () => loadClaudeInstructions({ MODULE2_FIDELITY_PROMPT_PATH: changedPrompt }),
    /has changed and must be reviewed/
  );
  fs.rmSync(changedPrompt, { force: true });
});

test('private usage defaults stay within the authorized session and exchange ceilings', () => {
  const config = settings();
  assert.equal(config.sessionMinutes, 20);
  assert.ok(config.sessionMinutes <= 30);
  assert.equal(config.maxExchanges, 12);
  assert.ok(config.maxExchanges <= 15);
});

test('browser cannot start a session without the private access code', async () => {
  const appSettings = settings();
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const response = await requestServer(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      url: '/api/kids-on-the-bus/realtime/session',
      body: 'v=0\r\n'
  });
  assert.equal(response.status, 401);
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('server sends API key only to OpenAI and returns SDP without exposing it', async () => {
  const appSettings = settings();
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, session: JSON.parse(options.body.get('session')) };
    return new Response('v=0\r\nanswer', { status: 200, headers: { 'Content-Type': 'application/sdp' } });
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const response = await requestServer(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', 'X-Companion-Code': 'private-code' },
      url: '/api/kids-on-the-bus/realtime/session?voice=marin',
      body: 'v=0\r\noffer'
  });
  assert.equal(response.status, 200);
  assert.equal(response.body, 'v=0\r\nanswer');
  assert.doesNotMatch(response.body, /sk-server-only-secret/);
  assert.equal(captured.url, 'https://api.openai.com/v1/realtime/calls');
  assert.equal(captured.options.headers.Authorization, 'Bearer sk-server-only-secret');
  assert.equal(captured.session.model, 'gpt-realtime-2.1');
  fs.rmSync(appSettings.dataDir, { recursive: true, force: true });
});

test('zero private budget blocks voice while the page remains available', async () => {
  const appSettings = settings({ budgetUsd: 0 });
  const server = createApp({ settings: appSettings, fetchImpl: async () => { throw new Error('must not call'); } });
  const page = await requestServer(server, { url: '/reflect/kids-on-the-bus' });
  assert.equal(page.status, 200);
  const session = await requestServer(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', 'X-Companion-Code': 'private-code' },
      url: '/api/kids-on-the-bus/realtime/session',
      body: 'v=0\r\n'
  });
  assert.equal(session.status, 503);
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
    if (url.includes('/v1/realtime/calls')) {
      return new Response('v=0\r\nanswer', { status: 200, headers: { 'Content-Type': 'application/sdp' } });
    }
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
    headers: { 'Content-Type': 'application/sdp', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/realtime/session?voice=marin',
    body: 'v=0\r\noffer'
  });
  const sessionId = session.headers['X-Session-Id'];
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
  const fetchImpl = async (url) => {
    if (url.includes('/v1/realtime/calls')) {
      return new Response('v=0\r\nanswer', { status: 200, headers: { 'Content-Type': 'application/sdp' } });
    }
    claudeCalls += 1;
    throw new Error('Claude must not be called');
  };
  const server = createApp({ settings: appSettings, fetchImpl });
  const session = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/realtime/session',
    body: 'v=0\r\noffer'
  });
  const response = await requestServer(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Code': 'private-code' },
    url: '/api/kids-on-the-bus/claude-response',
    body: JSON.stringify({
      sessionId: session.headers['X-Session-Id'],
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
    if (url.includes('/v1/realtime/calls')) {
      return new Response('v=0\r\nanswer', { status: 200, headers: { 'Content-Type': 'application/sdp' } });
    }
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
      headers: { 'Content-Type': 'application/sdp', 'X-Companion-Code': 'private-code' },
      url: '/api/kids-on-the-bus/realtime/session',
      body: 'v=0\r\noffer'
    });
    const requestBody = JSON.stringify({
      sessionId: session.headers['X-Session-Id'],
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
