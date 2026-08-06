'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceTurnCoordinator } = require('../public/turn-coordinator');

test('a newer spoken fragment makes an earlier pending reply stale', () => {
  const turns = createVoiceTurnCoordinator();
  const first = turns.speechStarted('first');
  turns.speechStopped('first');
  assert.equal(turns.transcriptionCompleted('first'), first);
  assert.equal(turns.isCurrent(first), true);

  const second = turns.speechStarted('second');
  assert.equal(turns.isCurrent(first), false);
  turns.speechStopped('second');
  assert.equal(turns.transcriptionCompleted('second'), second);
  assert.equal(turns.isCurrent(second), true);
});

test('out-of-order transcripts retain their own speech serials', () => {
  const turns = createVoiceTurnCoordinator();
  const first = turns.speechStarted('first');
  turns.speechStopped('first');
  const second = turns.speechStarted('second');
  turns.speechStopped('second');

  assert.equal(turns.transcriptionCompleted('first'), first);
  assert.equal(turns.isCurrent(first), false);
  assert.equal(turns.transcriptionCompleted('second'), second);
  assert.equal(turns.isCurrent(second), true);
});
