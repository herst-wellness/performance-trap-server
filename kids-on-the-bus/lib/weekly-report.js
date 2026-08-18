'use strict';

const { aggregateFunnel, aggregateInsights } = require('./analytics');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sessionsBetween(sessions, start, end) {
  return (sessions || []).filter((session) => {
    const at = Date.parse(session.startedAt);
    return Number.isFinite(at) && at >= start && at < end;
  });
}

function visitsBetween(visits, start, end) {
  return (visits || []).filter((visit) => {
    const at = Date.parse(visit.openedAt);
    return Number.isFinite(at) && at >= start && at < end;
  });
}

function changeLine(current, prior, label, suffix = '') {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return '';
  const change = Math.round((current - prior) / Math.abs(prior) * 100);
  if (Math.abs(change) < 20) return '';
  return `${label} ${change > 0 ? 'increased' : 'decreased'} ${Math.abs(change)}%${suffix}.`;
}

function buildWeeklyReport(sessions, now = Date.now(), visits = []) {
  const currentEnd = now;
  const currentStart = currentEnd - 7 * 24 * 60 * 60 * 1000;
  const priorStart = currentStart - 7 * 24 * 60 * 60 * 1000;
  const currentRows = sessionsBetween(sessions, currentStart, currentEnd);
  const priorRows = sessionsBetween(sessions, priorStart, currentStart);
  const currentVisits = visitsBetween(visits, currentStart, currentEnd);
  const priorVisits = visitsBetween(visits, priorStart, currentStart);
  const current = aggregateInsights(currentRows);
  const prior = aggregateInsights(priorRows);
  const currentFunnel = aggregateFunnel(currentVisits, currentRows);
  const priorFunnel = aggregateFunnel(priorVisits, priorRows);
  const significant = [
    changeLine(currentFunnel.pageVisits, priorFunnel.pageVisits, 'Page visits'),
    changeLine(currentFunnel.visitToStartRate, priorFunnel.visitToStartRate, 'Visit-to-start rate'),
    changeLine(current.totalSittings, prior.totalSittings, 'Sittings'),
    changeLine(current.completionRate, prior.completionRate, 'Completion rate'),
    changeLine(current.averageResponseTimeMs, prior.averageResponseTimeMs, 'Average response time'),
    changeLine(current.errors, prior.errors, 'Errors')
  ].filter(Boolean);
  const topTopics = current.topics.slice(0, 3).map(([topic, count]) => `${topic} (${count})`).join(', ') || 'No topic data yet';
  const topInvitations = current.processInvitations.slice(0, 3).map(([stage, count]) => `${stage} (${count})`).join(', ') || 'No companion invitation data yet';
  const topEvidence = current.processEvidence.slice(0, 3).map(([stage, count]) => `${stage} (${count})`).join(', ') || 'No participant evidence data yet';
  const commonAbandonment = current.commonAbandonmentPoint;
  const feedback = current.feedbackAverages.map((value) => value == null ? 'n/a' : value.toFixed(1)).join(', ');
  const dateLabel = `${new Date(currentStart).toLocaleDateString('en-US')} to ${new Date(currentEnd).toLocaleDateString('en-US')}`;
  const subject = `Mind/Body Foundations companion weekly report: ${dateLabel}`;
  const html = `<!doctype html>
<html lang="en"><body style="font-family:Arial,sans-serif;color:#372416;line-height:1.5">
<h1 style="font-family:Georgia,serif">Mind/Body Foundations Companion</h1>
<p><strong>Weekly report:</strong> ${escapeHtml(dateLabel)}</p>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse">
<tr><td>Public page visits</td><td><strong>${currentFunnel.pageVisits}</strong></td></tr>
<tr><td>Begin attempts</td><td><strong>${currentFunnel.beginAttempts}</strong></td></tr>
<tr><td>Tracked sessions started</td><td><strong>${currentFunnel.trackedStarts}</strong></td></tr>
<tr><td>Visit-to-start rate</td><td><strong>${currentFunnel.visitToStartRate}%</strong></td></tr>
<tr><td>Left before starting</td><td><strong>${currentFunnel.pageExitsBeforeStart}</strong></td></tr>
<tr><td>Startup problems</td><td><strong>${currentFunnel.configurationBlocks + currentFunnel.sessionStartErrors + currentFunnel.browserErrorsBeforeStart}</strong></td></tr>
<tr><td>Sittings</td><td><strong>${current.totalSittings}</strong></td></tr>
<tr><td>Completion rate</td><td><strong>${current.completionRate}%</strong></td></tr>
<tr><td>Most common topics, automatically estimated</td><td><strong>${escapeHtml(topTopics)}</strong></td></tr>
<tr><td>Companion process invitations, automatically estimated</td><td><strong>${escapeHtml(topInvitations)}</strong></td></tr>
<tr><td>Participant process evidence, automatically estimated</td><td><strong>${escapeHtml(topEvidence)}</strong></td></tr>
<tr><td>Common abandonment point, estimated from participant evidence</td><td><strong>${escapeHtml(commonAbandonment)}</strong></td></tr>
<tr><td>Average response time</td><td><strong>${(current.averageResponseTimeMs / 1000).toFixed(1)} seconds</strong></td></tr>
<tr><td>Errors</td><td><strong>${current.errors}</strong></td></tr>
<tr><td>Estimated cost</td><td><strong>$${current.estimatedCostUsd.toFixed(3)}</strong></td></tr>
<tr><td>Feedback averages, questions 1 to 5</td><td><strong>${escapeHtml(feedback)}</strong></td></tr>
<tr><td>Conversion clicks</td><td><strong>${current.conversionClicks}</strong></td></tr>
</table>
<h2 style="font-family:Georgia,serif">Changes from the prior week</h2>
<p>${significant.length ? escapeHtml(significant.join(' ')) : 'No significant change was detected.'}</p>
<p style="color:#5C4A38;font-size:13px">Topic and process classifications are automatically estimated and potentially imperfect. A companion invitation is tracked separately from evidence in the participant's response.</p>
<p style="color:#5C4A38;font-size:13px">This report contains structured usage information only. It does not include names, exact entries, quotations, memories, or companion responses.</p>
</body></html>`;
  return { subject, html, summary: current, currentStart, currentEnd };
}

async function sendWithResend(settings, report, fetchImpl = fetch) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: settings.from,
      to: [settings.to],
      subject: report.subject,
      html: report.html
    })
  });
  if (!response.ok) throw new Error('The weekly report could not be sent.');
  return response.json();
}

class WeeklyReporter {
  constructor(ledger, settings = {}, fetchImpl = fetch) {
    this.ledger = ledger;
    this.settings = settings;
    this.fetchImpl = fetchImpl;
    this.running = false;
  }

  configured() {
    return Boolean(this.settings.enabled && this.settings.apiKey && this.settings.to && this.settings.from);
  }

  async sendIfDue(force = false) {
    if (!this.configured() || this.running) return { sent: false, reason: 'not_configured_or_running' };
    const state = this.ledger.getReportState();
    const lastSentAt = Date.parse(state.lastWeeklyReportAt || '');
    if (!force && Number.isFinite(lastSentAt) && Date.now() - lastSentAt < 7 * 24 * 60 * 60 * 1000) {
      return { sent: false, reason: 'not_due' };
    }
    this.running = true;
    try {
      const report = buildWeeklyReport(this.ledger.sessions(), Date.now(), this.ledger.visits());
      await sendWithResend(this.settings, report, this.fetchImpl);
      this.ledger.setReportState({ lastWeeklyReportAt: new Date().toISOString(), lastWeeklyReportErrorAt: '' });
      return { sent: true, subject: report.subject };
    } catch (error) {
      this.ledger.setReportState({ lastWeeklyReportErrorAt: new Date().toISOString() });
      throw error;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { WeeklyReporter, buildWeeklyReport, sendWithResend };
