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
  assert.ok(classification.process.specificSituation > 0);
  assert.ok(classification.process.uTurnToExperience > 0);
  assert.doesNotMatch(raw, /Melissa|Acme|failed/i);
});

test('process classification tracks embodiment and parts as structured indicators', () => {
  const classification = classifyTurn({
    message: 'A part of me feels a tight pressure moving from my throat into my chest. Another part is afraid I will be left.',
    response: 'Stay with that tightness. What is this part trying to protect you from?',
    route: 'continue_reflection'
  });
  assert.equal(classification.process.bodySensation, 1);
  assert.equal(classification.process.sensationLocation, 1);
  assert.equal(classification.process.sensationMovement, 1);
  assert.equal(classification.process.partRecognized, 1);
  assert.equal(classification.process.multipleParts, 1);
  assert.equal(classification.process.partProtectionExplored, 1);
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
    process: { specificSituation: 2, bodySensation: 1 },
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
  const csv = sessionsToCsv(sessions);
  assert.match(csv, /MBF-ABCD-2345/);
  assert.match(csv, /Performance pressure/);
  assert.doesNotMatch(csv, /exactEntry|transcript|Melissa/i);
});
