'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SharedSittingStore } = require('../lib/shared-sittings');

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
