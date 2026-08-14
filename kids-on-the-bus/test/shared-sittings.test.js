'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DAILY_PRUNE_INTERVAL_MS, SharedSittingStore } = require('../lib/shared-sittings');

function expireFeedback(store, reference) {
  const filePath = store.feedbackPath(reference);
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  record.deleteAfter = '2020-01-02T00:00:00.000Z';
  fs.writeFileSync(filePath, JSON.stringify(record));
}

test('an optionally shared sitting records consent metadata and stays separate from usage statistics', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-sitting-'));
  const store = new SharedSittingStore(directory, { retentionDays: 90 });
  store.begin({ sessionReference: 'MBF-ABCD-2345', consentDate: '2026-08-13T18:00:00.000Z', noticeVersion: '2026-08-13-v1' });
  store.appendTurn('MBF-ABCD-2345', 'My exact entry.', 'The exact companion response.');
  const sitting = store.read('MBF-ABCD-2345');
  assert.equal(sitting.researchPermission, true);
  assert.equal(sitting.publicQuotationPermission, false);
  assert.equal(sitting.retentionDays, 90);
  assert.equal(sitting.turns[0].user, 'My exact entry.');
  assert.match(store.transcriptPath('MBF-ABCD-2345'), /shared-sittings/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('Chad can delete an optionally shared sitting and its feedback comment', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-sitting-'));
  const store = new SharedSittingStore(directory, { retentionDays: 90 });
  store.begin({ sessionReference: 'MBF-EFGH-6789', noticeVersion: '2026-08-13-v1' });
  store.saveFeedbackComment('MBF-EFGH-6789', 'A feedback comment.');
  assert.equal(store.delete('MBF-EFGH-6789'), true);
  assert.equal(store.read('MBF-EFGH-6789'), null);
  assert.equal(store.readFeedback('MBF-EFGH-6789'), null);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('automatic retention pruning deletes expired shared sittings and comments at startup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-sitting-'));
  const store = new SharedSittingStore(directory, { retentionDays: 90 });
  store.begin({ sessionReference: 'MBF-JKLM-2345', consentDate: '2020-01-01T00:00:00.000Z', noticeVersion: '2026-08-13-v2' });
  store.saveFeedbackComment('MBF-JKLM-2345', 'An expired feedback comment.');
  expireFeedback(store, 'MBF-JKLM-2345');

  let scheduledInterval = 0;
  store.startAutomaticPruning({
    now: () => Date.parse('2026-08-13T20:00:00.000Z'),
    setIntervalFn(callback, intervalMs) {
      scheduledInterval = intervalMs;
      return { callback, unref() {} };
    }
  });

  assert.equal(scheduledInterval, DAILY_PRUNE_INTERVAL_MS);
  assert.equal(fs.existsSync(store.transcriptPath('MBF-JKLM-2345')), false);
  assert.equal(fs.existsSync(store.feedbackPath('MBF-JKLM-2345')), false);
  store.stopAutomaticPruning({ clearIntervalFn() {} });
  fs.rmSync(directory, { recursive: true, force: true });
});

test('daily retention pruning removes newly expired material without a visitor or administrator action', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-sitting-'));
  const store = new SharedSittingStore(directory, { retentionDays: 90 });
  let dailyPrune;
  store.startAutomaticPruning({
    now: () => Date.parse('2026-08-13T20:00:00.000Z'),
    setIntervalFn(callback) {
      dailyPrune = callback;
      return { unref() {} };
    }
  });
  store.begin({ sessionReference: 'MBF-NPQR-6789', consentDate: '2020-01-01T00:00:00.000Z', noticeVersion: '2026-08-13-v2' });
  store.saveFeedbackComment('MBF-NPQR-6789', 'Another expired feedback comment.');
  expireFeedback(store, 'MBF-NPQR-6789');

  dailyPrune();

  assert.equal(fs.existsSync(store.transcriptPath('MBF-NPQR-6789')), false);
  assert.equal(fs.existsSync(store.feedbackPath('MBF-NPQR-6789')), false);
  store.stopAutomaticPruning({ clearIntervalFn() {} });
  fs.rmSync(directory, { recursive: true, force: true });
});
