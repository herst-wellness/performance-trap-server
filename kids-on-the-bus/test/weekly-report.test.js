'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWeeklyReport, sendWithResend } = require('../lib/weekly-report');

test('the weekly report contains structured summaries and no conversation content', () => {
  const now = Date.parse('2026-08-13T20:00:00.000Z');
  const report = buildWeeklyReport([{
    sessionReference: 'MBF-ABCD-2345',
    startedAt: '2026-08-12T18:00:00.000Z',
    completed: true,
    durationSeconds: 600,
    companionResponses: 4,
    primaryTopic: 'Work',
    secondaryTopics: [],
    processInvitations: { bodySensation: 1 },
    processEvidence: { specificSituation: 1 },
    responseTimesMs: [1200],
    voiceRecordingStarts: 1,
    voiceTranscriptionSuccesses: 1,
    voiceTranscriptionFailures: 0,
    voiceRecordedSeconds: 12,
    transcriptionTimesMs: [700],
    estimatedCostUsd: 0.03,
    feedback: { ratings: [5, 4, 4, 5, 3] },
    conversionClicks: 1,
    exactEntry: 'Melissa said something identifiable.'
  }], now, [{
    openedAt: '2026-08-12T17:30:00.000Z',
    beginAttempts: 1,
    sessionStarted: true,
    sessionReference: 'MBF-ABCD-2345',
    pageExitsBeforeStart: 0
  }]);
  assert.match(report.html, /Public page visits<\/td><td><strong>1/);
  assert.match(report.html, /Visit-to-start rate<\/td><td><strong>100%/);
  assert.match(report.html, /Sittings/);
  assert.match(report.html, /Work \(1\)/);
  assert.match(report.html, /Body awareness invited \(1\)/);
  assert.match(report.html, /Specific situation described \(1\)/);
  assert.match(report.html, /automatically estimated and potentially imperfect/i);
  assert.match(report.html, /structured usage information only/i);
  assert.match(report.html, /Voice recordings<\/td><td><strong>1/);
  assert.match(report.html, /Voice transcription success rate<\/td><td><strong>100%/);
  assert.doesNotMatch(report.html, /Melissa|identifiable|MBF-ABCD-2345/);
});

test('Resend receives only the prepared weekly summary', async () => {
  let sent;
  const fetchImpl = async (url, options) => {
    sent = { url, payload: JSON.parse(options.body), authorization: options.headers.Authorization };
    return new Response(JSON.stringify({ id: 'email_123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await sendWithResend({ apiKey: 'resend-secret', from: 'reports@example.com', to: 'chad@example.com' }, {
    subject: 'Weekly report', html: '<p>Structured summary</p>'
  }, fetchImpl);
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.equal(sent.payload.subject, 'Weekly report');
  assert.equal(sent.payload.to[0], 'chad@example.com');
  assert.doesNotMatch(JSON.stringify(sent.payload), /entry|transcript|quotation/i);
});

test('the weekly report carries the current name, not the one it was renamed from', () => {
  const report = buildWeeklyReport([{
    sessionReference: 'MBF-ABCD-2345',
    startedAt: '2026-08-27T13:04:00.000Z',
    completed: false,
    durationSeconds: 1800,
    companionResponses: 11,
    primaryTopic: 'Other',
    secondaryTopics: [],
    processInvitations: {},
    processEvidence: {},
    responseTimesMs: [9789]
  }], Date.parse('2026-08-28T20:00:00.000Z'), []);
  assert.match(report.subject, /Start Anywhere/);
  assert.match(report.html, /<h1[^>]*>Start Anywhere<\/h1>/);
  assert.doesNotMatch(`${report.subject}\n${report.html}`, /Mind\/Body Foundations Companion|Kids on the Bus/i);
});
