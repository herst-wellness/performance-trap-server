'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LatencyLedger } = require('../lib/latency');

test('latency ledger stores timing numbers and no coaching content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-latency-'));
  const file = path.join(directory, 'latency-ledger.json');
  const ledger = new LatencyLedger(file);
  const entry = ledger.add({
    sessionId: 'session-private',
    turnId: 'turn_random123',
    source: 'voice',
    effort: 'medium',
    cancelled: false,
    speechStoppedToTranscriptMs: 612.4,
    claudeCompleteMs: 3999.6,
    speechStoppedToAudioMs: 5712.2,
    message: 'This must never be stored.',
    response: 'Neither may this.'
  });
  assert.equal(entry.speechStoppedToTranscriptMs, 612);
  assert.equal(entry.claudeCompleteMs, 4000);
  assert.equal(entry.speechStoppedToAudioMs, 5712);
  const raw = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /never be stored|Neither may this/);
  fs.rmSync(directory, { recursive: true, force: true });
});
