'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

test('browser offers a written-only sitting while preserving the former voice implementation in source', () => {
  assert.match(html, /Begin written reflection/);
  assert.match(html, /Nothing is listening/);
  assert.doesNotMatch(html, /Begin voice session|Voice session|microphone|remoteAudio/);
  assert.match(html, /written-app\.js/);
  assert.match(html, /End and clear here/);
  assert.match(html, /Copy sitting/);
  assert.match(html, /Download sitting/);
  assert.match(app, /replaceChildren/);
  assert.match(app, /\/api\/kids-on-the-bus\/claude-response/);
  assert.match(app, /new AbortController/);
  assert.doesNotMatch(app, /getUserMedia|RTCPeerConnection|speechSynthesis|remoteAudio|realtime\/session/);
  assert.match(preservedVoiceApp, /getUserMedia/);
  assert.match(preservedVoiceApp, /RTCPeerConnection/);
});

test('the companion is framed as Mind Body Foundations with notice and optional sharing off by default', () => {
  assert.match(html, /Mind\/Body Foundations Companion/);
  assert.match(html, /How your information is used/i);
  assert.match(html, /Your exact written conversation will not be saved/);
  assert.match(html, /Back to Mind\/Body Foundations/);
  assert.match(html, /I give Herst Wellness permission to save this written sitting/);
  assert.doesNotMatch(html, /id="researchConsent"[^>]*checked/);
  assert.doesNotMatch(`${html}\n${app}`, /completely private|private written|private test/i);
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
