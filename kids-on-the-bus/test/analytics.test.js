'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateInsights, classifyTurn, sessionsToCsv } = require('../lib/analytics');

test('topic classification returns controlled tags without copying names or identifying details', () => {
  const classification = classifyTurn({
    message: 'Melissa at Acme told me in the meeting that I failed. I feel ashamed and anxious about my job.',
    response: 'Something about that moment lands hard. Where do you notice it in your body?',
    route: 'continue_reflection'
  });
  const raw = JSON.stringify(classification);
  assert.equal(classification.topics.primary, 'Work');
  assert.ok(classification.topics.secondary.includes('Shame'));
  assert.ok(classification.processEvidence.specificSituation > 0);
  assert.ok(classification.processInvitations.uTurnToExperience > 0);
  assert.doesNotMatch(raw, /Melissa|Acme|failed/i);
});

test('process classification separates companion invitations from participant evidence', () => {
  const classification = classifyTurn({
    message: 'A part of me feels a tight pressure moving from my throat into my chest. Another part protects me so I will not be left.',
    response: 'Stay with that tightness. What is this part trying to protect you from?',
    route: 'continue_reflection'
  });
  assert.equal(classification.processInvitations.stayedWithSensation, 1);
  assert.equal(classification.processInvitations.partProtectionExplored, 1);
  assert.equal(classification.processEvidence.bodySensation, 1);
  assert.equal(classification.processEvidence.sensationLocation, 1);
  assert.equal(classification.processEvidence.sensationMovement, 1);
  assert.equal(classification.processEvidence.partRecognized, 1);
  assert.equal(classification.processEvidence.multipleParts, 1);
  assert.equal(classification.processEvidence.partProtectionExplored, 1);
});

test('a companion question never becomes participant evidence by itself', () => {
  const classification = classifyTurn({
    message: 'I am not sure yet.',
    response: 'Where does that land in your body? Is there a part of you trying to protect you?',
    route: 'continue_reflection'
  });
  assert.equal(classification.processInvitations.bodySensation, 1);
  assert.equal(classification.processInvitations.partRecognized, 1);
  assert.equal(classification.processInvitations.partProtectionExplored, 1);
  assert.equal(classification.processEvidence.bodySensation, 0);
  assert.equal(classification.processEvidence.partRecognized, 0);
  assert.equal(classification.processEvidence.partProtectionExplored, 0);
  assert.equal(classification.processEvidence.unresolvedEnding, 0);
});

test('dashboard aggregation and CSV contain structured information only', () => {
  const sessions = [{
    sessionReference: 'MBF-ABCD-2345',
    startedAt: '2026-08-13T18:00:00.000Z',
    endedAt: '2026-08-13T18:12:00.000Z',
    durationSeconds: 720,
    accessCompleted: true,
    beganWriting: true,
    completed: true,
    abandoned: false,
    companionResponses: 5,
    userEntries: 5,
    averageUserEntryLength: 88,
    longestUserEntryLength: 150,
    primaryTopic: 'Work',
    secondaryTopics: ['Performance pressure'],
    processInvitations: { bodySensation: 1 },
    processEvidence: { specificSituation: 2, bodySensation: 1 },
    responseTimesMs: [1000, 2000],
    estimatedCostUsd: 0.12,
    device: { category: 'Computer' },
    referral: { utmSource: 'newsletter' },
    feedback: { ratings: [5, 4, 4, 5, 3] }
  }];
  const insights = aggregateInsights(sessions);
  assert.equal(insights.totalSittings, 1);
  assert.equal(insights.completionRate, 100);
  assert.equal(insights.medianResponseTimeMs, 1500);
  assert.deepEqual(insights.processInvitations[0], ['Body awareness invited', 1]);
  assert.ok(insights.processEvidence.some(([label]) => label === 'Body sensation identified'));
  const csv = sessionsToCsv(sessions);
  assert.match(csv, /MBF-ABCD-2345/);
  assert.match(csv, /Performance pressure/);
  assert.match(csv, /Body awareness invited/);
  assert.match(csv, /Body sensation identified/);
  assert.doesNotMatch(csv, /exactEntry|transcript|Melissa/i);
});
