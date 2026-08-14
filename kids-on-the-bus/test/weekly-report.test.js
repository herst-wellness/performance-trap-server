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
    estimatedCostUsd: 0.03,
    feedback: { ratings: [5, 4, 4, 5, 3] },
    conversionClicks: 1,
    exactEntry: 'Melissa said something identifiable.'
  }], now);
  assert.match(report.html, /Sittings/);
  assert.match(report.html, /Work \(1\)/);
  assert.match(report.html, /Body awareness invited \(1\)/);
  assert.match(report.html, /Specific situation described \(1\)/);
  assert.match(report.html, /automatically estimated and potentially imperfect/i);
  assert.match(report.html, /structured usage information only/i);
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
