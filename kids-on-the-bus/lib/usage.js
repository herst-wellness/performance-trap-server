'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { emptyProcess, median } = require('./analytics');

const DEFAULT_RATES = Object.freeze({
  inputText: 4,
  cachedInput: 0.4,
  inputAudio: 32,
  outputText: 24,
  outputAudio: 64,
  transcriptionPerMinute: 0.017,
  claudeInput: 3,
  claudeOutput: 15,
  claudeCacheWrite: 3.75,
  claudeCacheRead: 0.3
});

const SESSION_COUNTERS = new Set([
  'copyButtonUse', 'downloadButtonUse', 'endAndClearButtonUse', 'feedbackFormClicks',
  'conversionClicks', 'browserErrors', 'serverErrors', 'truncatedResponses', 'emptyResponses',
  'responseFailures',
  'voiceRecordingStarts', 'voiceRecordingStops', 'voiceClientFailures', 'microphoneDenials', 'voiceTranscriptCorrections',
  'safetyActivations', 'diagnosisBoundaryActivations', 'crisisActivations', 'userStopRequests',
  'mindbodyPageClick', 'chapterClick', 'bookClick', 'conversationClick', 'emailListClick',
  'consultOfferShown'
]);

const VISIT_COUNTERS = new Set([
  'beginAttempts', 'noticeBlocks', 'configurationBlocks', 'sessionStartErrors',
  'browserErrors', 'pageExitsBeforeStart'
]);

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function wholeNonNegative(value) {
  return Math.round(finiteNonNegative(value));
}

function normalizeUsage(raw = {}) {
  return {
    inputTextTokens: finiteNonNegative(raw.inputTextTokens),
    cachedInputTextTokens: finiteNonNegative(raw.cachedInputTextTokens),
    inputAudioTokens: finiteNonNegative(raw.inputAudioTokens),
    cachedInputAudioTokens: finiteNonNegative(raw.cachedInputAudioTokens),
    outputTextTokens: finiteNonNegative(raw.outputTextTokens),
    outputAudioTokens: finiteNonNegative(raw.outputAudioTokens),
    transcriptionAudioSeconds: finiteNonNegative(raw.transcriptionAudioSeconds),
    claudeInputTokens: finiteNonNegative(raw.claudeInputTokens),
    claudeOutputTokens: finiteNonNegative(raw.claudeOutputTokens),
    claudeCacheWriteTokens: finiteNonNegative(raw.claudeCacheWriteTokens),
    claudeCacheReadTokens: finiteNonNegative(raw.claudeCacheReadTokens)
  };
}

function calculateBreakdown(usage, rates = DEFAULT_RATES) {
  const u = normalizeUsage(usage);
  const uncachedText = Math.max(0, u.inputTextTokens - u.cachedInputTextTokens);
  const uncachedAudio = Math.max(0, u.inputAudioTokens - u.cachedInputAudioTokens);
  const cached = u.cachedInputTextTokens + u.cachedInputAudioTokens;
  const realtimeUsd = (
    uncachedText * rates.inputText +
    uncachedAudio * rates.inputAudio +
    cached * rates.cachedInput +
    u.outputTextTokens * rates.outputText +
    u.outputAudioTokens * rates.outputAudio
  ) / 1_000_000;
  const transcriptionUsd = u.transcriptionAudioSeconds / 60 * rates.transcriptionPerMinute;
  const claudeUsd = (
    u.claudeInputTokens * rates.claudeInput +
    u.claudeOutputTokens * rates.claudeOutput +
    u.claudeCacheWriteTokens * rates.claudeCacheWrite +
    u.claudeCacheReadTokens * rates.claudeCacheRead
  ) / 1_000_000;
  return { realtimeUsd, transcriptionUsd, claudeUsd, totalUsd: realtimeUsd + transcriptionUsd + claudeUsd };
}

function calculateCost(usage, rates = DEFAULT_RATES) {
  return calculateBreakdown(usage, rates).totalUsd;
}

function pruneEntries(entries, now = Date.now(), retentionDays = 30) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => Date.parse(entry.at) >= cutoff);
}

function initialStore(usageEntries = []) {
  return { version: 3, usageEntries, sessions: [], visits: [], reportState: {} };
}

function sanitizeText(value, maximum = 200) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, maximum);
}

function sanitizePath(value) {
  const raw = sanitizeText(value, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return '';
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return '';
  }
}

function normalizeDevice(device = {}) {
  const allowedCategories = new Set(['Phone', 'Tablet', 'Computer', 'Unknown']);
  const allowedScreens = new Set(['Small', 'Medium', 'Large', 'Unknown']);
  const category = sanitizeText(device.category, 20);
  const screenSizeCategory = sanitizeText(device.screenSizeCategory, 20);
  return {
    category: allowedCategories.has(category) ? category : 'Unknown',
    browserFamily: sanitizeText(device.browserFamily, 40) || 'Unknown',
    operatingSystemFamily: sanitizeText(device.operatingSystemFamily, 40) || 'Unknown',
    screenSizeCategory: allowedScreens.has(screenSizeCategory) ? screenSizeCategory : 'Unknown'
  };
}

function normalizeReferral(referral = {}) {
  return {
    referringPage: sanitizePath(referral.referringPage),
    utmSource: sanitizeText(referral.utmSource, 100),
    utmMedium: sanitizeText(referral.utmMedium, 100),
    utmCampaign: sanitizeText(referral.utmCampaign, 100),
    utmContent: sanitizeText(referral.utmContent, 100)
  };
}

function normalizeProcess(value = {}) {
  const normalized = emptyProcess();
  for (const key of Object.keys(normalized)) normalized[key] = wholeNonNegative(value?.[key]);
  return normalized;
}

function normalizeSessionProcess(session) {
  const hadSeparateTracking = Boolean(session.processInvitations || session.processEvidence);
  session.processInvitations = normalizeProcess(session.processInvitations);
  session.processEvidence = normalizeProcess(session.processEvidence);
  if (!hadSeparateTracking && session.process && typeof session.process === 'object') {
    session.legacyCombinedProcessEstimates = normalizeProcess(session.process);
  }
  delete session.process;
  return session;
}

function newSession(record) {
  const startedAt = record.startedAt || new Date().toISOString();
  return {
    sessionReference: sanitizeText(record.sessionReference, 40),
    startedAt,
    lastActivityAt: startedAt,
    endedAt: '',
    durationSeconds: 0,
    noticeAcknowledged: true,
    beganWriting: false,
    completed: false,
    endedIntentionally: false,
    expired: false,
    exchangeLimitReached: false,
    timeLimitReached: false,
    limitReached: false,
    abandoned: false,
    userEntries: 0,
    companionResponses: 0,
    totalUserEntryLength: 0,
    averageUserEntryLength: 0,
    longestUserEntryLength: 0,
    copyButtonUse: 0,
    downloadButtonUse: 0,
    endAndClearButtonUse: 0,
    feedbackFormClicks: 0,
    conversionClicks: 0,
    mindbodyPageClick: 0,
    chapterClick: 0,
    bookClick: 0,
    conversationClick: 0,
    emailListClick: 0,
    claudeModel: sanitizeText(record.claudeModel, 80),
    claudeEffort: sanitizeText(record.claudeEffort, 20),
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    chargeableRetries: 0,
    estimatedCostUsd: 0,
    responseTimesMs: [],
    medianResponseTimeMs: 0,
    slowestResponseMs: 0,
    truncatedResponses: 0,
    emptyResponses: 0,
    serverErrors: 0,
    browserErrors: 0,
    responseFailures: 0,
    voiceRecordingStarts: 0,
    voiceRecordingStops: 0,
    voiceTranscriptionSuccesses: 0,
    voiceTranscriptionFailures: 0,
    voiceClientFailures: 0,
    microphoneDenials: 0,
    voiceTranscriptCorrections: 0,
    voiceRecordedSeconds: 0,
    transcriptionTimesMs: [],
    medianTranscriptionTimeMs: 0,
    slowestTranscriptionMs: 0,
    safetyActivations: 0,
    diagnosisBoundaryActivations: 0,
    crisisActivations: 0,
    userStopRequests: 0,
    referral: normalizeReferral(record.referral),
    device: normalizeDevice(record.device),
    returningBrowser: Boolean(record.returningBrowser),
    topicCounts: {},
    primaryTopic: 'Other',
    secondaryTopics: [],
    processInvitations: emptyProcess(),
    processEvidence: emptyProcess(),
    feedback: null,
    sharedSittingPermission: Boolean(record.sharedSittingPermission),
    consentDate: record.consentDate || '',
    noticeVersion: sanitizeText(record.noticeVersion, 40),
    sharedSittingRetentionDays: wholeNonNegative(record.sharedSittingRetentionDays)
  };
}

function newVisit(record) {
  return {
    visitId: sanitizeText(record.visitId, 50),
    openedAt: record.openedAt || new Date().toISOString(),
    lastEventAt: record.openedAt || new Date().toISOString(),
    configuredAtOpen: Boolean(record.configuredAtOpen),
    beginAttempts: 0,
    noticeBlocks: 0,
    configurationBlocks: 0,
    sessionStartErrors: 0,
    browserErrors: 0,
    pageExitsBeforeStart: 0,
    sessionStarted: false,
    sessionReference: '',
    referral: normalizeReferral(record.referral),
    device: normalizeDevice(record.device),
    returningBrowser: Boolean(record.returningBrowser)
  };
}

function markSessionActivity(session, now = new Date()) {
  session.lastActivityAt = now.toISOString();
  const provisionallyEnded = Boolean(session.endedAt) && session.abandoned && !session.completed && !session.endedIntentionally;
  if (provisionallyEnded) {
    session.endedAt = '';
    session.abandoned = false;
  }
  return session;
}

function sessionDurationSeconds(session) {
  const startedMs = Date.parse(session.startedAt);
  const endedMs = Date.parse(session.endedAt || session.lastActivityAt || session.startedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return 0;
  return Math.max(0, Math.round((endedMs - startedMs) / 1000));
}

function finalizeSessionMetrics(session) {
  if (!session.lastActivityAt) session.lastActivityAt = session.endedAt || session.startedAt;
  session.durationSeconds = sessionDurationSeconds(session);
  session.voiceRecordingStarts = wholeNonNegative(session.voiceRecordingStarts);
  session.voiceRecordingStops = wholeNonNegative(session.voiceRecordingStops);
  session.voiceTranscriptionSuccesses = wholeNonNegative(session.voiceTranscriptionSuccesses);
  session.voiceTranscriptionFailures = wholeNonNegative(session.voiceTranscriptionFailures);
  session.voiceClientFailures = wholeNonNegative(session.voiceClientFailures);
  session.microphoneDenials = wholeNonNegative(session.microphoneDenials);
  session.voiceTranscriptCorrections = wholeNonNegative(session.voiceTranscriptCorrections);
  session.voiceRecordedSeconds = finiteNonNegative(session.voiceRecordedSeconds);
  session.transcriptionTimesMs = Array.isArray(session.transcriptionTimesMs)
    ? session.transcriptionTimesMs.map(wholeNonNegative).filter((value) => value > 0).slice(-100)
    : [];
  session.medianTranscriptionTimeMs = Math.round(median(session.transcriptionTimesMs));
  session.slowestTranscriptionMs = session.transcriptionTimesMs.length ? Math.max(...session.transcriptionTimesMs) : 0;
  session.averageUserEntryLength = session.userEntries > 0
    ? Math.round(session.totalUserEntryLength / session.userEntries)
    : 0;
  session.medianResponseTimeMs = Math.round(median(session.responseTimesMs || []));
  session.slowestResponseMs = session.responseTimesMs?.length ? Math.max(...session.responseTimesMs) : 0;
  const rankedTopics = Object.entries(session.topicCounts || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([topic]) => topic);
  session.primaryTopic = rankedTopics[0] || 'Other';
  session.secondaryTopics = rankedTopics.slice(1, 4);
  return session;
}

class UsageLedger {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.budgetUsd = finiteNonNegative(options.budgetUsd);
    this.rates = { ...DEFAULT_RATES, ...(options.rates || {}) };
    this.retentionDays = options.retentionDays || 30;
    this.analyticsRetentionDays = options.analyticsRetentionDays || 365;
    this.staleSessionMinutes = options.staleSessionMinutes || 65;
  }

  readStore() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(parsed)) return initialStore(parsed);
      return {
        version: 3,
        usageEntries: Array.isArray(parsed.usageEntries) ? parsed.usageEntries : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        visits: Array.isArray(parsed.visits) ? parsed.visits : [],
        reportState: parsed.reportState && typeof parsed.reportState === 'object' ? parsed.reportState : {}
      };
    } catch (error) {
      if (error.code === 'ENOENT') return initialStore();
      throw error;
    }
  }

  writeStore(store) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  pruneStore(store, now = Date.now()) {
    store.usageEntries = pruneEntries(store.usageEntries, now, this.retentionDays);
    const analyticsCutoff = now - this.analyticsRetentionDays * 24 * 60 * 60 * 1000;
    const staleCutoff = now - this.staleSessionMinutes * 60 * 1000;
    store.sessions = store.sessions.filter((session) => Date.parse(session.startedAt) >= analyticsCutoff);
    store.visits = (store.visits || []).filter((visit) => Date.parse(visit.openedAt) >= analyticsCutoff).slice(-100000);
    for (const session of store.sessions) {
      normalizeSessionProcess(session);
      const lastActivityMs = Date.parse(session.lastActivityAt || session.startedAt);
      if (!session.endedAt && lastActivityMs < staleCutoff) {
        session.endedAt = new Date(Math.max(Date.parse(session.startedAt), lastActivityMs)).toISOString();
        session.abandoned = true;
        session.completed = false;
        session.endedIntentionally = false;
      }
      finalizeSessionMetrics(session);
    }
    return store;
  }

  entries() {
    const current = this.readStore();
    const before = JSON.stringify(current);
    this.pruneStore(current);
    if (JSON.stringify(current) !== before) this.writeStore(current);
    return current.usageEntries;
  }

  sessions() {
    const current = this.readStore();
    const before = JSON.stringify(current);
    this.pruneStore(current);
    if (JSON.stringify(current) !== before) this.writeStore(current);
    return current.sessions.map((session) => finalizeSessionMetrics({ ...session }));
  }

  visits() {
    const current = this.readStore();
    const before = JSON.stringify(current);
    this.pruneStore(current);
    if (JSON.stringify(current) !== before) this.writeStore(current);
    return current.visits.map((visit) => ({ ...visit }));
  }

  total() {
    return this.entries().reduce((sum, entry) => sum + finiteNonNegative(entry.costUsd), 0);
  }

  status() {
    const usedUsd = this.total();
    const remainingUsd = Math.max(0, this.budgetUsd - usedUsd);
    return {
      budgetUsd: this.budgetUsd,
      usedUsd,
      remainingUsd,
      percentUsed: this.budgetUsd > 0 ? Math.min(100, usedUsd / this.budgetUsd * 100) : 100,
      exhausted: this.budgetUsd <= 0 || usedUsd >= this.budgetUsd
    };
  }

  add(record) {
    const store = this.pruneStore(this.readStore());
    const duplicate = store.usageEntries.find((entry) => entry.usageId === record.usageId);
    if (duplicate) return { duplicate: true, entry: duplicate, status: this.status() };

    const usage = normalizeUsage(record.usage);
    const costBreakdown = calculateBreakdown(usage, this.rates);
    const entry = {
      at: new Date().toISOString(),
      sessionId: String(record.sessionId || ''),
      sessionReference: sanitizeText(record.sessionReference, 40),
      usageId: String(record.usageId || ''),
      model: String(record.model || 'gpt-realtime-2.1'),
      usage,
      costBreakdown,
      costUsd: costBreakdown.totalUsd
    };
    store.usageEntries.push(entry);
    const session = store.sessions.find((item) => item.sessionReference === entry.sessionReference);
    if (session) {
      session.inputTokens += usage.claudeInputTokens;
      session.cachedInputTokens += usage.claudeCacheReadTokens;
      session.outputTokens += usage.claudeOutputTokens;
      session.estimatedCostUsd += entry.costUsd;
      session.chargeableRetries += record.retried ? 1 : 0;
      session.truncatedResponses += record.retried ? 1 : 0;
    }
    this.writeStore(store);
    const usedUsd = store.usageEntries.reduce((sum, item) => sum + finiteNonNegative(item.costUsd), 0);
    return {
      duplicate: false,
      entry,
      status: {
        budgetUsd: this.budgetUsd,
        usedUsd,
        remainingUsd: Math.max(0, this.budgetUsd - usedUsd),
        percentUsed: this.budgetUsd > 0 ? Math.min(100, usedUsd / this.budgetUsd * 100) : 100,
        exhausted: this.budgetUsd <= 0 || usedUsd >= this.budgetUsd
      }
    };
  }

  startSession(record) {
    const store = this.pruneStore(this.readStore());
    if (!store.sessions.some((session) => session.sessionReference === record.sessionReference)) {
      store.sessions.push(newSession(record));
      this.writeStore(store);
    }
    return store.sessions.find((session) => session.sessionReference === record.sessionReference);
  }

  startVisit(record) {
    const store = this.pruneStore(this.readStore());
    if (!store.visits.some((visit) => visit.visitId === record.visitId)) {
      store.visits.push(newVisit(record));
      this.writeStore(store);
    }
    return store.visits.find((visit) => visit.visitId === record.visitId);
  }

  recordVisitEvent(visitId, eventName) {
    if (!VISIT_COUNTERS.has(eventName)) return null;
    const store = this.pruneStore(this.readStore());
    const visit = store.visits.find((item) => item.visitId === visitId);
    if (!visit) return null;
    visit[eventName] = wholeNonNegative(visit[eventName]) + 1;
    visit.lastEventAt = new Date().toISOString();
    this.writeStore(store);
    return visit;
  }

  linkVisitToSession(visitId, sessionReference) {
    if (!visitId) return null;
    const store = this.pruneStore(this.readStore());
    const visit = store.visits.find((item) => item.visitId === visitId);
    if (!visit) return null;
    visit.sessionStarted = true;
    visit.sessionReference = sanitizeText(sessionReference, 40);
    visit.lastEventAt = new Date().toISOString();
    this.writeStore(store);
    return visit;
  }

  updateSession(sessionReference, updater) {
    const store = this.pruneStore(this.readStore());
    const session = store.sessions.find((item) => item.sessionReference === sessionReference);
    if (!session) return null;
    updater(session);
    finalizeSessionMetrics(session);
    this.writeStore(store);
    return session;
  }

  recordTurn(sessionReference, record = {}) {
    return this.updateSession(sessionReference, (session) => {
      markSessionActivity(session);
      session.beganWriting = true;
      session.userEntries += 1;
      session.totalUserEntryLength += wholeNonNegative(record.userEntryLength);
      session.longestUserEntryLength = Math.max(session.longestUserEntryLength, wholeNonNegative(record.userEntryLength));
      if (record.hasCompanionResponse) session.companionResponses += 1;
      if (finiteNonNegative(record.responseTimeMs) > 0) session.responseTimesMs.push(wholeNonNegative(record.responseTimeMs));
      for (const topic of [record.topics?.primary, ...(record.topics?.secondary || [])].filter(Boolean)) {
        session.topicCounts[topic] = (session.topicCounts[topic] || 0) + 1;
      }
      for (const [key, value] of Object.entries(record.processInvitations || {})) {
        if (Object.hasOwn(session.processInvitations, key)) session.processInvitations[key] += wholeNonNegative(value);
      }
      for (const [key, value] of Object.entries(record.processEvidence || {})) {
        if (Object.hasOwn(session.processEvidence, key)) session.processEvidence[key] += wholeNonNegative(value);
      }
      if (record.diagnosisBoundary) session.diagnosisBoundaryActivations += 1;
      if (record.safetyActivation) session.safetyActivations += 1;
      if (record.crisisActivation) session.crisisActivations += 1;
      if (record.userStopRequest) session.userStopRequests += 1;
      if (record.emptyResponse) session.emptyResponses += 1;
    });
  }

  recordEvent(sessionReference, eventName) {
    if (!SESSION_COUNTERS.has(eventName)) return null;
    return this.updateSession(sessionReference, (session) => { session[eventName] = wholeNonNegative(session[eventName]) + 1; });
  }

  recordTranscription(sessionReference, record = {}) {
    return this.updateSession(sessionReference, (session) => {
      markSessionActivity(session);
      session.voiceRecordedSeconds = finiteNonNegative(session.voiceRecordedSeconds) + finiteNonNegative(record.audioSeconds);
      if (!Array.isArray(session.transcriptionTimesMs)) session.transcriptionTimesMs = [];
      if (finiteNonNegative(record.responseTimeMs) > 0) session.transcriptionTimesMs.push(wholeNonNegative(record.responseTimeMs));
      if (record.success) session.voiceTranscriptionSuccesses = wholeNonNegative(session.voiceTranscriptionSuccesses) + 1;
      else session.voiceTranscriptionFailures = wholeNonNegative(session.voiceTranscriptionFailures) + 1;
    });
  }

  endSession(sessionReference, reason) {
    return this.updateSession(sessionReference, (session) => {
      const alreadyEndedDeliberately = Boolean(session.endedAt) && (session.completed || session.endedIntentionally);
      if (alreadyEndedDeliberately && (reason === 'page_exit' || reason === 'abandoned')) return;
      if (!session.endedAt) session.endedAt = new Date().toISOString();
      session.completed = reason === 'completed';
      session.endedIntentionally = reason === 'completed' || reason === 'intentional';
      session.expired = reason === 'time_limit';
      session.timeLimitReached = reason === 'time_limit';
      session.exchangeLimitReached = reason === 'exchange_limit';
      session.limitReached = session.timeLimitReached || session.exchangeLimitReached;
      session.abandoned = reason === 'page_exit' || reason === 'abandoned';
      if ((reason === 'time_limit' || reason === 'exchange_limit') && session.processEvidence.appropriateClosing > 0) {
        session.completed = true;
      }
    });
  }

  recordFeedback(sessionReference, ratings, hasComment) {
    return this.updateSession(sessionReference, (session) => {
      session.feedback = {
        submittedAt: new Date().toISOString(),
        ratings: Array.isArray(ratings) ? ratings.slice(0, 5).map((value) => Math.max(1, Math.min(5, wholeNonNegative(value)))) : [],
        hasComment: Boolean(hasComment)
      };
    });
  }

  getReportState() {
    return this.readStore().reportState;
  }

  setReportState(patch) {
    const store = this.pruneStore(this.readStore());
    store.reportState = { ...store.reportState, ...patch };
    this.writeStore(store);
    return store.reportState;
  }
}

module.exports = {
  DEFAULT_RATES,
  UsageLedger,
  calculateBreakdown,
  calculateCost,
  normalizeDevice,
  normalizeReferral,
  normalizeUsage,
  pruneEntries
};
