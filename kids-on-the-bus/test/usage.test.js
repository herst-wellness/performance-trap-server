'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UsageLedger, calculateCost } = require('../lib/usage');

test('cost uses current full Realtime text, cached, and audio rates', () => {
  const cost = calculateCost({
    inputTextTokens: 1000,
    cachedInputTextTokens: 500,
    inputAudioTokens: 2000,
    cachedInputAudioTokens: 1000,
    outputTextTokens: 300,
    outputAudioTokens: 4000
  });
  const expected = (500 * 4 + 1000 * 32 + 1500 * 0.4 + 300 * 24 + 4000 * 64) / 1_000_000;
  assert.equal(cost, expected);
});

test('cost includes Claude input, output, cache creation, and cache reads', () => {
  const cost = calculateCost({
    claudeInputTokens: 100,
    claudeOutputTokens: 200,
    claudeCacheWriteTokens: 1000,
    claudeCacheReadTokens: 500
  });
  const expected = (100 * 3 + 200 * 15 + 1000 * 3.75 + 500 * 0.3) / 1_000_000;
  assert.equal(cost, expected);
});

test('ledger stores numbers and identifiers only, never transcript content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'realtime-ledger-'));
  const file = path.join(directory, 'usage.json');
  const ledger = new UsageLedger(file, { budgetUsd: 2 });
  ledger.add({
    sessionId: 'session-random',
    usageId: 'resp_123',
    model: 'gpt-realtime-2.1',
    usage: { inputAudioTokens: 100, outputAudioTokens: 200 }
  });
  const raw = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /"(text|audio|transcript|coachingResponse|memory)"\s*:|Melissa/i);
  assert.match(raw, /inputAudioTokens/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('ledger deduplicates repeated response usage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'realtime-ledger-'));
  const ledger = new UsageLedger(path.join(directory, 'usage.json'), { budgetUsd: 2 });
  const record = { sessionId: 'one', usageId: 'resp_same', usage: { outputAudioTokens: 100 } };
  assert.equal(ledger.add(record).duplicate, false);
  assert.equal(ledger.add(record).duplicate, true);
  assert.equal(ledger.entries().length, 1);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('live transcription is calculated and identified separately', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'realtime-ledger-'));
  const ledger = new UsageLedger(path.join(directory, 'usage.json'), { budgetUsd: 2 });
  const result = ledger.add({
    sessionId: 'one',
    usageId: 'trans_123',
    model: 'gpt-live-transcribe',
    usage: { transcriptionAudioSeconds: 30 }
  });
  assert.equal(result.entry.costBreakdown.realtimeUsd, 0);
  assert.equal(result.entry.costBreakdown.transcriptionUsd, 0.0085);
  assert.equal(result.entry.costUsd, 0.0085);
  fs.rmSync(directory, { recursive: true, force: true });
});
