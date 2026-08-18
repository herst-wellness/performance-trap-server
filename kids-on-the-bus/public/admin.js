'use strict';

(function () {
  const el = (id) => document.getElementById(id);
  const ui = {
    login: el('adminLogin'), dashboard: el('dashboard'), code: el('adminCode'), open: el('openDashboard'),
    message: el('adminMessage'), metrics: el('metrics'), funnelMetrics: el('funnelMetrics'), topicBars: el('topicBars'),
    invitationBars: el('invitationBars'), evidenceBars: el('evidenceBars'),
    referralBars: el('referralBars'), deviceBars: el('deviceBars'), rows: el('sessionRows'), weekly: el('weeklyPreview'),
    topicFilter: el('topicFilter'), referralFilter: el('referralFilter'), deviceFilter: el('deviceFilter'),
    statusFilter: el('statusFilter'), feedbackFilter: el('feedbackFilter'), errorFilter: el('errorFilter'),
    stageFilter: el('stageFilter'), startDate: el('startDate'), endDate: el('endDate'), csv: el('downloadCsv'), funnelCsv: el('downloadFunnelCsv'),
    sharedList: el('sharedList'), sharedReview: el('sharedReview'), sharedTitle: el('sharedTitle'),
    sharedTurns: el('sharedTurns'), deleteShared: el('deleteShared')
  };
  const state = { code: '', data: null, selectedShared: '' };

  function authHeaders() {
    return { 'Content-Type': 'application/json', 'X-Companion-Admin-Code': state.code };
  }

  async function api(path, body) {
    const response = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body || {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The protected request was not accepted.');
    return data;
  }

  function option(select, value) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = value;
    select.appendChild(item);
  }

  function fillFilters() {
    const sessions = state.data.sessions;
    const unique = (values) => Array.from(new Set(values.filter(Boolean))).sort();
    unique(sessions.flatMap((row) => [row.primaryTopic, ...(row.secondaryTopics || [])])).forEach((value) => option(ui.topicFilter, value));
    unique(sessions.map((row) => row.referral?.utmSource || row.referral?.referringPage || 'Direct or unknown')).forEach((value) => option(ui.referralFilter, value));
    unique(sessions.map((row) => row.device?.category || 'Unknown')).forEach((value) => option(ui.deviceFilter, value));
    Object.entries(state.data.processEvidenceLabels).forEach(([key, label]) => {
      const item = document.createElement('option'); item.value = key; item.textContent = label; ui.stageFilter.appendChild(item);
    });
  }

  function feedbackAverage(row) {
    const values = row.feedback?.ratings || [];
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
  }

  function hasErrors(row) {
    return Number(row.serverErrors || 0) + Number(row.browserErrors || 0) + Number(row.emptyResponses || 0) + Number(row.responseFailures || 0) + Number(row.voiceTranscriptionFailures || 0) + Number(row.voiceClientFailures || 0) > 0;
  }

  function filteredSessions() {
    const start = ui.startDate.value ? Date.parse(`${ui.startDate.value}T00:00:00`) : null;
    const end = ui.endDate.value ? Date.parse(`${ui.endDate.value}T23:59:59`) : null;
    return state.data.sessions.filter((row) => {
      const at = Date.parse(row.startedAt);
      const topics = [row.primaryTopic, ...(row.secondaryTopics || [])];
      const referral = row.referral?.utmSource || row.referral?.referringPage || 'Direct or unknown';
      const status = row.completed ? 'completed' : row.abandoned ? 'abandoned' : row.endedAt ? 'ended' : 'active';
      const feedback = feedbackAverage(row);
      if (start && at < start) return false;
      if (end && at > end) return false;
      if (ui.topicFilter.value && !topics.includes(ui.topicFilter.value)) return false;
      if (ui.referralFilter.value && referral !== ui.referralFilter.value) return false;
      if (ui.deviceFilter.value && row.device?.category !== ui.deviceFilter.value) return false;
      if (ui.statusFilter.value && status !== ui.statusFilter.value) return false;
      if (ui.feedbackFilter.value === 'none' && feedback != null) return false;
      if (/^[3-5]$/.test(ui.feedbackFilter.value) && (feedback == null || feedback < Number(ui.feedbackFilter.value))) return false;
      if (ui.errorFilter.value === 'yes' && !hasErrors(row)) return false;
      if (ui.errorFilter.value === 'no' && hasErrors(row)) return false;
      if (ui.stageFilter.value && Number(row.processEvidence?.[ui.stageFilter.value] || 0) === 0) return false;
      return true;
    });
  }

  function median(values) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function countBy(rows, valuesForRow) {
    const counts = {};
    rows.forEach((row) => valuesForRow(row).filter(Boolean).forEach((value) => { counts[value] = (counts[value] || 0) + 1; }));
    return Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  }

  function metric(label, value) {
    const card = document.createElement('div'); card.className = 'metric';
    const name = document.createElement('span'); name.textContent = label;
    const number = document.createElement('strong'); number.textContent = value;
    card.append(name, number); return card;
  }

  function renderMetrics(rows) {
    const completed = rows.filter((row) => row.completed).length;
    const abandoned = rows.filter((row) => row.abandoned).length;
    const durations = rows.map((row) => Number(row.durationSeconds || 0)).filter((value) => value > 0);
    const exchanges = rows.map((row) => Number(row.companionResponses || 0));
    const responseTimes = rows.flatMap((row) => row.responseTimesMs || []);
    const feedback = rows.map(feedbackAverage).filter((value) => value != null);
    const cost = rows.reduce((sum, row) => sum + Number(row.estimatedCostUsd || 0), 0);
    const conversions = rows.reduce((sum, row) => sum + Number(row.conversionClicks || 0), 0);
    const voiceStarts = rows.reduce((sum, row) => sum + Number(row.voiceRecordingStarts || 0), 0);
    const voiceSuccesses = rows.reduce((sum, row) => sum + Number(row.voiceTranscriptionSuccesses || 0), 0);
    const voiceFailures = rows.reduce((sum, row) => sum + Number(row.voiceTranscriptionFailures || 0), 0);
    const voiceClientFailures = rows.reduce((sum, row) => sum + Number(row.voiceClientFailures || 0), 0);
    const microphoneDenials = rows.reduce((sum, row) => sum + Number(row.microphoneDenials || 0), 0);
    const voiceCorrections = rows.reduce((sum, row) => sum + Number(row.voiceTranscriptCorrections || 0), 0);
    const voiceSeconds = rows.reduce((sum, row) => sum + Number(row.voiceRecordedSeconds || 0), 0);
    const transcriptionTimes = rows.flatMap((row) => row.transcriptionTimesMs || []);
    const cards = [
      ['Total sittings', rows.length], ['Completion rate', rows.length ? `${Math.round(completed / rows.length * 100)}%` : '0%'],
      ['Abandonment rate', rows.length ? `${Math.round(abandoned / rows.length * 100)}%` : '0%'],
      ['Average duration', durations.length ? `${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 60)} min` : '0 min'],
      ['Average exchanges', exchanges.length ? (exchanges.reduce((a, b) => a + b, 0) / exchanges.length).toFixed(1) : '0'],
      ['Median exchanges', median(exchanges).toFixed(1)], ['Average response', responseTimes.length ? `${(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length / 1000).toFixed(1)} sec` : '0 sec'],
      ['Slowest response', responseTimes.length ? `${(Math.max(...responseTimes) / 1000).toFixed(1)} sec` : '0 sec'],
      ['Errors', rows.filter(hasErrors).length], ['Retries', rows.reduce((sum, row) => sum + Number(row.chargeableRetries || 0), 0)],
      ['Safety activations', rows.reduce((sum, row) => sum + Number(row.safetyActivations || 0), 0)],
      ['Feedback average', feedback.length ? (feedback.reduce((a, b) => a + b, 0) / feedback.length).toFixed(1) : 'No responses'],
      ['Estimated cost', `$${cost.toFixed(3)}`], ['Conversion clicks', conversions],
      ['Voice recordings', voiceStarts], ['Voice transcripts', voiceSuccesses],
      ['Voice success rate', voiceSuccesses + voiceFailures ? `${Math.round(voiceSuccesses / (voiceSuccesses + voiceFailures) * 100)}%` : 'No attempts'],
      ['Average recording', voiceSuccesses + voiceFailures ? `${(voiceSeconds / (voiceSuccesses + voiceFailures)).toFixed(1)} sec` : '0 sec'],
      ['Median transcription', transcriptionTimes.length ? `${(median(transcriptionTimes) / 1000).toFixed(1)} sec` : '0 sec'],
      ['Transcription failures', voiceFailures], ['Browser voice failures', voiceClientFailures],
      ['Microphone denials', microphoneDenials], ['Edited transcripts', voiceCorrections],
      ['Returning browsers', rows.filter((row) => row.returningBrowser).length], ['Active now', rows.filter((row) => !row.endedAt).length],
      ['Estimated abandonment point', (() => { const pairs = countBy(rows.filter((row) => row.abandoned), (row) => { const keys = Object.keys(state.data.processEvidenceLabels).filter((key) => Number(row.processEvidence?.[key] || 0) > 0); return [keys.length ? state.data.processEvidenceLabels[keys[keys.length - 1]] : 'Before participant evidence of a specific situation']; }); return pairs[0]?.[0] || 'Not enough data'; })()]
    ];
    ui.metrics.replaceChildren(...cards.map(([label, value]) => metric(label, value)));
  }

  function renderFunnel() {
    const funnel = state.data.funnel || {};
    const startupProblems = Number(funnel.configurationBlocks || 0) + Number(funnel.sessionStartErrors || 0) + Number(funnel.browserErrorsBeforeStart || 0);
    const cards = [
      ['Page visits', funnel.pageVisits || 0],
      ['Begin attempts', funnel.beginAttempts || 0],
      ['Sessions started', funnel.trackedStarts || 0],
      ['Began writing', funnel.beganWriting || 0],
      ['Completed', funnel.completed || 0],
      ['Visit to start', `${Number(funnel.visitToStartRate || 0).toFixed(1)}%`],
      ['Start to writing', `${Number(funnel.startToWritingRate || 0).toFixed(1)}%`],
      ['Left before starting', funnel.pageExitsBeforeStart || 0],
      ['Startup problems', startupProblems]
    ];
    ui.funnelMetrics.replaceChildren(...cards.map(([label, value]) => metric(label, value)));
  }

  function renderBars(container, pairs, total) {
    container.replaceChildren();
    const maximum = Math.max(1, ...pairs.map((pair) => pair[1]));
    pairs.slice(0, 12).forEach(([label, count]) => {
      const row = document.createElement('div'); row.className = 'bar-row';
      const name = document.createElement('span'); name.textContent = label;
      const track = document.createElement('div'); track.className = 'bar-track';
      const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.width = `${Math.max(3, count / maximum * 100)}%`;
      const number = document.createElement('span'); number.className = 'bar-count'; number.textContent = total ? `${count}` : String(count);
      track.appendChild(fill); row.append(name, track, number); container.appendChild(row);
    });
    if (!pairs.length) { const empty = document.createElement('p'); empty.textContent = 'No data for these filters.'; container.appendChild(empty); }
  }

  function renderRows(rows) {
    ui.rows.replaceChildren();
    rows.slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).forEach((row) => {
      const tr = document.createElement('tr');
      const status = row.completed ? 'Completed' : row.abandoned ? 'Abandoned' : row.endedAt ? 'Ended' : 'Active';
      const values = [row.sessionReference, new Date(row.startedAt).toLocaleString(), status, `${Math.round(Number(row.durationSeconds || 0) / 60)} min`, row.companionResponses, row.primaryTopic, row.device?.category || 'Unknown', hasErrors(row) ? 'Yes' : 'No', feedbackAverage(row)?.toFixed(1) || 'None'];
      values.forEach((value) => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
      ui.rows.appendChild(tr);
    });
  }

  function render() {
    const rows = filteredSessions();
    renderMetrics(rows);
    renderBars(ui.topicBars, countBy(rows, (row) => [row.primaryTopic, ...(row.secondaryTopics || [])]), rows.length);
    renderBars(ui.invitationBars, countBy(rows, (row) => Object.entries(row.processInvitations || {}).filter((pair) => Number(pair[1]) > 0).map(([key]) => state.data.processInvitationLabels[key] || key)), rows.length);
    renderBars(ui.evidenceBars, countBy(rows, (row) => Object.entries(row.processEvidence || {}).filter((pair) => Number(pair[1]) > 0).map(([key]) => state.data.processEvidenceLabels[key] || key)), rows.length);
    renderBars(ui.referralBars, countBy(rows, (row) => [row.referral?.utmSource || row.referral?.referringPage || 'Direct or unknown']), rows.length);
    renderBars(ui.deviceBars, countBy(rows, (row) => [row.device?.category || 'Unknown']), rows.length);
    renderRows(rows);
  }

  function renderSharedList() {
    ui.sharedList.replaceChildren();
    const records = state.data.sharedSittings || [];
    records.forEach((record) => {
      const item = document.createElement('div'); item.className = 'shared-item';
      const details = document.createElement('p'); details.textContent = `${record.sessionReference}. ${record.turnCount} turns. Delete after ${new Date(record.deleteAfter).toLocaleDateString()}.`;
      const button = document.createElement('button'); button.className = 'button secondary'; button.type = 'button'; button.textContent = 'Review shared sitting';
      button.addEventListener('click', () => openShared(record.sessionReference));
      item.append(details, button); ui.sharedList.appendChild(item);
    });
    if (!records.length) { const empty = document.createElement('p'); empty.textContent = 'No optionally shared sittings are stored.'; ui.sharedList.appendChild(empty); }
  }

  async function openShared(reference) {
    const data = await api('/api/kids-on-the-bus/admin/shared-sitting', { sessionReference: reference, deliberateReview: true });
    state.selectedShared = reference;
    ui.sharedTitle.textContent = `${reference}. Permission given for product research only.`;
    ui.sharedTurns.replaceChildren();
    data.sitting.turns.forEach((turn) => {
      for (const [label, text] of [['User', turn.user], ['Companion', turn.companion]]) {
        const card = document.createElement('div'); card.className = 'shared-turn';
        const speaker = document.createElement('strong'); speaker.textContent = label;
        const content = document.createElement('span'); content.textContent = text;
        card.append(speaker, content); ui.sharedTurns.appendChild(card);
      }
    });
    ui.sharedReview.classList.remove('hidden');
  }

  async function deleteShared() {
    if (!state.selectedShared) return;
    if (!window.confirm(`Delete shared sitting ${state.selectedShared}? This cannot be undone.`)) return;
    await api('/api/kids-on-the-bus/admin/shared-sitting/delete', { sessionReference: state.selectedShared });
    state.data.sharedSittings = state.data.sharedSittings.filter((record) => record.sessionReference !== state.selectedShared);
    state.selectedShared = '';
    ui.sharedReview.classList.add('hidden');
    renderSharedList();
  }

  async function openDashboard() {
    ui.message.textContent = '';
    state.code = ui.code.value.trim();
    if (!state.code) { ui.message.textContent = 'Enter the separate administrative code.'; return; }
    ui.open.disabled = true;
    try {
      state.data = await api('/api/kids-on-the-bus/admin/insights');
      ui.login.classList.add('hidden'); ui.dashboard.classList.remove('hidden');
      ui.weekly.srcdoc = state.data.weeklyReportHtml;
      fillFilters(); renderSharedList(); renderFunnel(); render();
    } catch (error) {
      ui.message.textContent = error.message;
      ui.open.disabled = false;
    }
  }

  async function downloadCsv() {
    const response = await fetch('/api/kids-on-the-bus/admin/export.csv', { method: 'POST', headers: authHeaders(), body: '{}' });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'mind-body-foundations-companion-structured-usage.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  async function downloadFunnelCsv() {
    const response = await fetch('/api/kids-on-the-bus/admin/export-visits.csv', { method: 'POST', headers: authHeaders(), body: '{}' });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'mind-body-foundations-companion-funnel.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  ui.open.addEventListener('click', openDashboard);
  ui.code.addEventListener('keydown', (event) => { if (event.key === 'Enter') openDashboard(); });
  [ui.topicFilter, ui.referralFilter, ui.deviceFilter, ui.statusFilter, ui.feedbackFilter, ui.errorFilter, ui.stageFilter, ui.startDate, ui.endDate].forEach((control) => control.addEventListener('change', render));
  ui.csv.addEventListener('click', downloadCsv);
  ui.funnelCsv.addEventListener('click', downloadFunnelCsv);
  ui.deleteShared.addEventListener('click', deleteShared);
})();
