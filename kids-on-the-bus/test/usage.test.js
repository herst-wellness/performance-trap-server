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

test('the extended ledger preserves structured sessions across a process restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbody-ledger-'));
  const file = path.join(directory, 'usage-ledger.json');
  const firstProcess = new UsageLedger(file, { budgetUsd: 100, analyticsRetentionDays: 365 });
  firstProcess.startSession({
    sessionReference: 'MBF-ABCD-2345',
    claudeModel: 'claude-sonnet-5',
    claudeEffort: 'high',
    referral: { referringPage: 'https://herstwellness.com/mind-body-foundations?secret=no' },
    device: { category: 'Computer', browserFamily: 'Safari', operatingSystemFamily: 'macOS', screenSizeCategory: 'Large' }
  });
  firstProcess.recordTurn('MBF-ABCD-2345', {
    userEntryLength: 42,
    hasCompanionResponse: true,
    responseTimeMs: 1200,
    topics: { primary: 'Work', secondary: ['Performance pressure'] },
    processInvitations: { bodySensation: 1 },
    processEvidence: { specificSituation: 1 }
  });
  firstProcess.recordEvent('MBF-ABCD-2345', 'voiceRecordingStarts');
  firstProcess.recordEvent('MBF-ABCD-2345', 'voiceRecordingStops');
  firstProcess.recordTranscription('MBF-ABCD-2345', { audioSeconds: 9.5, responseTimeMs: 800, success: true });
  firstProcess.endSession('MBF-ABCD-2345', 'completed');

  const restartedProcess = new UsageLedger(file, { budgetUsd: 100, analyticsRetentionDays: 365 });
  const saved = restartedProcess.sessions()[0];
  assert.equal(saved.sessionReference, 'MBF-ABCD-2345');
  assert.equal(saved.completed, true);
  assert.equal(saved.primaryTopic, 'Performance pressure');
  assert.equal(saved.userEntries, 1);
  assert.equal(saved.processInvitations.bodySensation, 1);
  assert.equal(saved.processEvidence.specificSituation, 1);
  assert.equal(saved.voiceRecordingStarts, 1);
  assert.equal(saved.voiceRecordingStops, 1);
  assert.equal(saved.voiceTranscriptionSuccesses, 1);
  assert.equal(saved.voiceRecordedSeconds, 9.5);
  assert.equal(saved.medianTranscriptionTimeMs, 800);
  assert.equal(saved.referral.referringPage, 'https://herstwellness.com/mind-body-foundations');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('the ledger preserves content-free public funnel records across a process restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbody-ledger-'));
  const file = path.join(directory, 'usage-ledger.json');
  const firstProcess = new UsageLedger(file, { budgetUsd: 100, analyticsRetentionDays: 365 });
  firstProcess.startVisit({
    visitId: '624c4cde-99af-427b-965d-c7429d7f1350',
    configuredAtOpen: true,
    referral: { referringPage: 'https://herstwellness.com/mind-body-foundations?discard=yes' },
    device: { category: 'Phone', browserFamily: 'Safari', operatingSystemFamily: 'iOS or iPadOS', screenSizeCategory: 'Small' },
    returningBrowser: false,
    exactEntry: 'Never store this text.'
  });
  firstProcess.recordVisitEvent('624c4cde-99af-427b-965d-c7429d7f1350', 'beginAttempts');
  firstProcess.linkVisitToSession('624c4cde-99af-427b-965d-c7429d7f1350', 'MBF-VST1-2345');

  const restartedProcess = new UsageLedger(file, { budgetUsd: 100, analyticsRetentionDays: 365 });
  const saved = restartedProcess.visits()[0];
  assert.equal(saved.beginAttempts, 1);
  assert.equal(saved.sessionStarted, true);
  assert.equal(saved.sessionReference, 'MBF-VST1-2345');
  assert.equal(saved.referral.referringPage, 'https://herstwellness.com/mind-body-foundations');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Never store|discard=yes/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('the extended ledger upgrades the existing array without losing cost records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbody-ledger-'));
  const file = path.join(directory, 'usage-ledger.json');
  fs.writeFileSync(file, JSON.stringify([{ at: new Date().toISOString(), usageId: 'old', costUsd: 1.25 }]));
  const ledger = new UsageLedger(file, { budgetUsd: 100 });
  assert.equal(ledger.entries()[0].usageId, 'old');
  ledger.startSession({ sessionReference: 'MBF-EFGH-6789' });
  const upgraded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(upgraded.version, 3);
  assert.deepEqual(upgraded.visits, []);
  assert.equal(upgraded.usageEntries[0].costUsd, 1.25);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('legacy combined process estimates are not relabeled as participant evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbody-ledger-'));
  const file = path.join(directory, 'usage-ledger.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 2,
    usageEntries: [],
    reportState: {},
    sessions: [{
      sessionReference: 'MBF-JKLM-2345',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      topicCounts: {},
      process: { bodySensation: 2, partRecognized: 1 }
    }]
  }));
  const ledger = new UsageLedger(file, { budgetUsd: 100 });
  const saved = ledger.sessions()[0];
  assert.equal(saved.processEvidence.bodySensation, 0);
  assert.equal(saved.processInvitations.partRecognized, 0);
  assert.equal(saved.legacyCombinedProcessEstimates.bodySensation, 2);
  assert.equal('process' in saved, false);
  fs.rmSync(directory, { recursive: true, force: true });
});
