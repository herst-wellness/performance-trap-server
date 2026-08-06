'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadClaudeInstructions, loadCoachingInstructions } = require('../server');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const turnCoordinator = fs.readFileSync(path.join(root, 'public', 'turn-coordinator.js'), 'utf8');
const relayFidelity = fs.readFileSync(path.join(root, 'public', 'relay-fidelity.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const relayPrompt = loadCoachingInstructions();
const prompt = loadClaudeInstructions();
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const mainServerSource = fs.readFileSync(path.join(root, '..', 'server.js'), 'utf8');
const companionEntry = fs.readFileSync(path.join(root, '..', 'companion.js'), 'utf8');

test('canonical coaching assets are self-contained and retain their approved fingerprints', () => {
  const assets = [
    ['companion-prompt.txt', '0ef7de853bbad8871b4e7b23c637ab47c8cf88812b5f488f7f9a6a09ba7a3c81'],
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
  assert.ok(mainServerSource.indexOf('handleCompanionRoute(req, res)') < mainServerSource.indexOf("req.url = req.url.split('?')[0]"));
  assert.match(mainServerSource, /req\.url === '\/book'/);
  assert.match(mainServerSource, /req\.url === '\/health'/);
  assert.match(mainServerSource, /req\.url === '\/reading'/);
});

test('browser implements one-click session, natural interruption, optional finish, transcript, correction, writing, and clearing', () => {
  assert.match(html, /Begin voice session/);
  assert.match(html, /I'm finished/);
  assert.match(html, /Correct what it heard/);
  assert.match(html, /Use writing/);
  assert.match(html, /End and clear here/);
  assert.match(app, /echoCancellation: true/);
  assert.match(app, /input_audio_buffer\.commit/);
  assert.match(app, /response\.cancel/);
  assert.match(app, /output_audio_buffer\.clear/);
  assert.match(app, /input_audio_transcription\.completed/);
  assert.match(app, /replaceChildren/);
  assert.match(app, /openingGenerationDone/);
  assert.match(app, /openingAudioStopped/);
  assert.match(app, /finishOpeningWhenReady/);
  assert.match(app, /transcriptionAudioSeconds/);
  assert.match(app, /Measured live transcription/);
  assert.match(app, /Claude coaching/);
  assert.doesNotMatch(app, /COACHING_TURN_INSTRUCTIONS/);
  assert.equal((app.match(/instructions:/g) || []).length, 2);
  assert.match(app, /Say exactly this opening question/);
  assert.match(app, /Speak the input text exactly as written/);
  assert.match(app, /\/api\/kids-on-the-bus\/claude-response/);
  assert.match(app, /relayFidelity\.matches/);
  assert.match(app, /Voice fidelity warning/);
  assert.match(app, /FIDELITY_MARKERS/);
  assert.match(app, /The coaching prompt was not verified/);
  assert.match(app, /turnCoordinator\.isCurrent/);
  assert.match(app, /new AbortController/);
  assert.match(app, /abortPendingClaudeRequest/);
  assert.match(app, /output_audio_buffer\.started/);
  assert.match(app, /speechStoppedToAudioMs/);
  assert.match(app, /\/api\/kids-on-the-bus\/latency/);
});

test('the main API key is absent from every browser asset', () => {
  assert.doesNotMatch(`${html}\n${app}\n${turnCoordinator}\n${relayFidelity}`, /OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-server-only-secret|sk-ant-server-only-secret/);
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

test('user-facing prototype copy contains no em dash', () => {
  assert.doesNotMatch(`${html}\n${prompt}\n${relayPrompt}`, /—/);
});
