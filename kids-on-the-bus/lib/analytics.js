'use strict';

const TOPIC_RULES = Object.freeze([
  ['Intimate relationship', /\b(partner|spouse|husband|wife|boyfriend|girlfriend|dating|marriage|relationship|breakup|divorce)\b/g],
  ['Parenting', /\b(parenting|my child|my children|my kid|my kids|son|daughter|school pickup)\b/g],
  ['Family', /\b(family|mother|father|mom|dad|parent|sibling|brother|sister|grandparent)\b/g],
  ['Friendship', /\b(friend|friendship|social circle)\b/g],
  ['Leadership', /\b(leader|leadership|manage my team|my direct report|executive|founder|ceo)\b/g],
  ['Work', /\b(work|job|career|boss|coworker|colleague|office|client|meeting|promotion|deadline)\b/g],
  ['Money', /\b(money|financial|finances|debt|income|salary|rent|mortgage|afford)\b/g],
  ['Health concern', /\b(health|illness|medical|doctor|diagnos|symptom|pain|sick|cancer|hospital)\b/g],
  ['Grief or loss', /\b(grief|grieving|loss|died|death|funeral|miss them|passed away)\b/g],
  ['Conflict', /\b(conflict|fight|argument|argued|confront|disagreement|tension)\b/g],
  ['Overwhelm', /\b(overwhelm|too much|burned out|burnt out|exhausted|swamped|cannot keep up|can't keep up)\b/g],
  ['Performance pressure', /\b(perform|performance|achiev|prove myself|perfect|success|failure|imposter|productive|promotion)\b/g],
  ['Self-criticism', /\b(self-critic|self critic|critical of myself|beat myself up|not good enough|should have|should be)\b/g],
  ['Shame', /\b(shame|ashamed|humiliat|embarrass|disgusted with myself)\b/g],
  ['Fear or anxiety', /\b(fear|afraid|scared|anxiety|anxious|worry|worried|panic|dread|nervous)\b/g],
  ['Anger', /\b(anger|angry|mad|furious|rage|irritat|resent)\b/g],
  ['Loneliness or disconnection', /\b(lonely|loneliness|alone|disconnect|isolat|unseen|not understood)\b/g],
  ['Boundaries', /\b(boundar|say no|saying no|people pleasing|overextend|my limits)\b/g],
  ['Decision-making', /\b(decision|decide|choice|choose|uncertain what to do|indecis)\b/g],
  ['Creativity', /\b(creativ|writing|artist|music|paint|make something)\b/g],
  ['Identity', /\b(identity|who i am|sense of self|myself anymore|belong|authentic)\b/g],
  ['Major life transition', /\b(transition|moving|retire|retirement|new baby|graduat|laid off|new job|career change|menopause)\b/g]
]);

const PROCESS_KEYS = Object.freeze([
  'specificSituation',
  'storyEmotionallyAlive',
  'worstExplored',
  'uTurnToExperience',
  'bodySensation',
  'sensationLocation',
  'sensationQuality',
  'sensationMovement',
  'partRecognized',
  'multipleParts',
  'partProtectionExplored',
  'fearedConsequence',
  'returnedToBody',
  'stayedWithSensation',
  'sensationChanged',
  'newUnderstanding',
  'appropriateClosing',
  'unresolvedEnding'
]);

const PROCESS_INVITATION_LABELS = Object.freeze({
  specificSituation: 'Specific situation invited',
  storyEmotionallyAlive: 'Emotional aliveness invited',
  worstExplored: 'Most difficult aspect invited',
  uTurnToExperience: 'Direct experience invited',
  bodySensation: 'Body awareness invited',
  sensationLocation: 'Sensation location invited',
  sensationQuality: 'Sensation quality invited',
  sensationMovement: 'Sensation movement invited',
  partRecognized: 'Parts awareness invited',
  multipleParts: 'Multiple parts awareness invited',
  partProtectionExplored: 'Protection explored by companion',
  fearedConsequence: 'Feared consequence invited',
  returnedToBody: 'Return to body invited',
  stayedWithSensation: 'Staying with sensation invited',
  sensationChanged: 'Sensation change check invited',
  newUnderstanding: 'New understanding invited',
  appropriateClosing: 'Closing invited',
  unresolvedEnding: 'Unresolved ending named by companion'
});

const PROCESS_EVIDENCE_LABELS = Object.freeze({
  specificSituation: 'Specific situation described',
  storyEmotionallyAlive: 'Emotional response described',
  worstExplored: 'Most difficult aspect identified',
  uTurnToExperience: 'Direct experience described',
  bodySensation: 'Body sensation identified',
  sensationLocation: 'Sensation location identified',
  sensationQuality: 'Sensation quality identified',
  sensationMovement: 'Sensation movement described',
  partRecognized: 'Part recognized',
  multipleParts: 'Multiple parts recognized',
  partProtectionExplored: 'Protective purpose identified',
  fearedConsequence: 'Feared consequence identified',
  returnedToBody: 'Return to body demonstrated',
  stayedWithSensation: 'Staying with sensation demonstrated',
  sensationChanged: 'Change in sensation reported',
  newUnderstanding: 'New understanding expressed',
  appropriateClosing: 'Closing readiness expressed',
  unresolvedEnding: 'Unresolved ending expressed'
});

function occurrences(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function classifyTopics(text) {
  const normalized = String(text || '').toLowerCase();
  const scored = TOPIC_RULES
    .map(([topic, pattern], index) => ({ topic, index, score: occurrences(normalized, pattern) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 4)
    .map((item) => item.topic);
  if (scored.length === 0) scored.push('Other');
  return { primary: scored[0], secondary: scored.slice(1, 4) };
}

function emptyProcess() {
  return Object.fromEntries(PROCESS_KEYS.map((key) => [key, 0]));
}

function classifyProcess(message, response, route = 'continue_reflection') {
  const user = String(message || '').toLowerCase();
  const companion = String(response || '').toLowerCase();
  const invitations = emptyProcess();
  const evidence = emptyProcess();
  const markInvitation = (key, matched) => { if (matched) invitations[key] = 1; };
  const markEvidence = (key, matched) => { if (matched) evidence[key] = 1; };

  markInvitation('specificSituation', /\b(what happened|specific (?:situation|moment)|bring me to|when did|what did .* say|where were you)\b/.test(companion));
  markInvitation('storyEmotionallyAlive', /\b(what was that like|how did that feel|impact on you|feel most alive|stay with the story)\b/.test(companion));
  markInvitation('worstExplored', /what(?:'s| is) the worst|worst of it|most difficult|hardest part/.test(companion));
  markInvitation('uTurnToExperience', /\b(where does that land|notice(?:\s+\w+){0,4}\s+in your body|body (?:notice|feel|respond)|direct experience|inside you)\b/.test(companion));
  markInvitation('bodySensation', /\b(where does that land|in your body|body (?:notice|feel|respond)|physical sensation|what do you notice)\b/.test(companion));
  markInvitation('sensationLocation', /\b(where (?:do you feel|is that|in your body)|location|where does that land)\b/.test(companion));
  markInvitation('sensationQuality', /\b(what (?:is|does) (?:it|that) (?:like|feel like)|quality|sharp|dull|tight|heavy|warm|cold|pressure)\b/.test(companion));
  markInvitation('sensationMovement', /\b(does (?:it|that) move|movement|moving|spread|shift|edge|center|shape|geography)\b/.test(companion));
  markInvitation('partRecognized', /\b(part of you|part of me|something in you|this part|that part|protector|kid on the bus)\b/.test(companion));
  markInvitation('multipleParts', /\b(parts of you|two parts|another part|different parts|both parts)\b/.test(companion));
  markInvitation('partProtectionExplored', /\b(what .* protect|trying to protect|protecting you|keep you safe|trying to keep|what (?:does|would) .* need)\b/.test(companion));
  markInvitation('fearedConsequence', /\b(afraid might happen|fear would happen|what would happen|worst for (?:this|that) part)\b/.test(companion));
  markInvitation('returnedToBody', /\b(let that land|back to (?:your|the) body|body responding|what do you notice now)\b/.test(companion));
  markInvitation('stayedWithSensation', /\b(stay with|keep .* company|give .* attention|still with|as you notice)\b/.test(companion));
  markInvitation('sensationChanged', /\b(has .* changed|anything chang|shift now|same or different|what do you notice now)\b/.test(companion));
  markInvitation('newUnderstanding', /\b(what do you (?:see|understand|realize|notice) now|anything new|what becomes clear)\b/.test(companion));
  markInvitation('appropriateClosing', /\b(good place to pause|let's stop here|we'll stop here|take that with you|enough for now|ready to pause)\b/.test(companion));
  markInvitation('unresolvedEnding', route !== 'continue_reflection' && /\b(unresolved|unfinished|still open)\b/.test(companion));

  markEvidence('specificSituation', /\b(when|yesterday|today|last night|this morning|in the meeting|during|said|happened|moment)\b/.test(user));
  markEvidence('storyEmotionallyAlive', /\b(feel|felt|impact|worst|angry|afraid|ashamed|hurt|sad|tight|heavy|hot|numb)\b/.test(user));
  markEvidence('worstExplored', /\b(the worst|worst part|most difficult|hardest part|what hurts most)\b/.test(user));
  markEvidence('uTurnToExperience', /\b(i notice|inside me|inside my|in my body|right now i feel|as i feel)\b/.test(user));
  markEvidence('bodySensation', /\b(tight|tightness|heavy|heaviness|pressure|tingl|warm|hot|cold|numb|ache|clench|flutter|butterflies|sensation|breath|breathing)\b/.test(user));
  markEvidence('sensationLocation', /\b(chest|throat|jaw|belly|stomach|gut|shoulder|back|neck|head|face|arms?|legs?|hands?|feet|heart)\b/.test(user));
  markEvidence('sensationQuality', /\b(sharp|dull|tight|heavy|hard|soft|warm|hot|cold|numb|dense|light|buzz|tingl|pressure|hollow)\b/.test(user));
  markEvidence('sensationMovement', /\b(move|moving|shift|spread|expand|contract|rise|fall|travel|edge|center|shape|geography)\b/.test(user));
  markEvidence('partRecognized', /\b(part of me|something in me|this part|that part|my protector|kid on the bus)\b/.test(user));
  markEvidence('multipleParts', /\b(parts of me|two parts|another part|different parts|both parts)\b/.test(user));
  markEvidence('partProtectionExplored', /\b(protects? me|protecting me|keeps? me safe|trying to keep me|so (?:i|it) (?:do not|don't|won't)|its purpose|what it needs)\b/.test(user));
  markEvidence('fearedConsequence', /\b(i(?:'m| am) afraid .* (?:will|would|might)|my fear is|then .* would|what would happen is|worst for (?:this|that) part)\b/.test(user));
  markEvidence('returnedToBody', /\b(back in my body|when i return to my body|my body now|i notice .* (?:chest|throat|jaw|belly|stomach|gut|shoulder|back|neck|head|face|arms?|legs?|hands?|feet))\b/.test(user));
  markEvidence('stayedWithSensation', /\b(as i stay with|staying with|sitting with|still with|as i notice|giving .* attention)\b/.test(user));
  markEvidence('sensationChanged', /\b(changed|changing|shifted|softened|eased|stronger|weaker|moved|less tight|more open)\b/.test(user));
  markEvidence('newUnderstanding', /\b(i realize|i realised|i see now|i had not seen|i hadn't seen|that makes sense|i understand|what i notice is)\b/.test(user));
  markEvidence('appropriateClosing', /\b(i(?:'m| am) ready to (?:pause|stop)|good place to pause|enough for now|i want to stop|let's stop)\b/.test(user));
  markEvidence('unresolvedEnding', route !== 'continue_reflection' && /\b(still unresolved|not resolved|still unfinished|i do not know|i don't know|not sure|still confused|still stuck|no change)\b/.test(user));
  return { invitations, evidence };
}

function classifyTurn({ message, response, route }) {
  const process = classifyProcess(message, response, route);
  return {
    topics: classifyTopics(message),
    processInvitations: process.invitations,
    processEvidence: process.evidence,
    diagnosisBoundary: /\b(do i have|am i|is this|could this be).{0,32}\b(depress|anxiety disorder|bipolar|adhd|ptsd|diagnos|mental illness)\b/i.test(String(message || ''))
  };
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentage(numerator, denominator) {
  return denominator > 0 ? Math.round(numerator / denominator * 1000) / 10 : 0;
}

function aggregateInsights(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const completed = rows.filter((row) => row.completed).length;
  const abandoned = rows.filter((row) => row.abandoned).length;
  const durations = rows.map((row) => Number(row.durationSeconds || 0)).filter((value) => value > 0);
  const exchanges = rows.map((row) => Number(row.companionResponses || 0));
  const responseTimes = rows.flatMap((row) => Array.isArray(row.responseTimesMs) ? row.responseTimesMs : []);
  const transcriptionTimes = rows.flatMap((row) => Array.isArray(row.transcriptionTimesMs) ? row.transcriptionTimesMs : []);
  const topicCounts = {};
  const topicCombinations = {};
  const invitationCounts = Object.fromEntries(PROCESS_KEYS.map((key) => [key, 0]));
  const evidenceCounts = Object.fromEntries(PROCESS_KEYS.map((key) => [key, 0]));
  const abandonmentPoints = {};
  const referralCounts = {};
  const deviceCounts = {};
  const feedback = Array.from({ length: 5 }, () => []);
  let estimatedCostUsd = 0;
  let errors = 0;
  let retries = 0;
  let safetyActivations = 0;
  let conversionClicks = 0;
  let voiceRecordingStarts = 0;
  let voiceTranscriptionSuccesses = 0;
  let voiceTranscriptionFailures = 0;
  let voiceClientFailures = 0;
  let microphoneDenials = 0;
  let voiceTranscriptCorrections = 0;
  let voiceRecordedSeconds = 0;
  let speechPlaybacks = 0;
  let speechPlaybackFailures = 0;

  for (const row of rows) {
    const topics = [row.primaryTopic, ...(row.secondaryTopics || [])].filter(Boolean);
    for (const topic of topics) topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    if (topics.length > 1) {
      const key = topics.slice().sort().join(' + ');
      topicCombinations[key] = (topicCombinations[key] || 0) + 1;
    }
    for (const key of PROCESS_KEYS) {
      if (Number(row.processInvitations?.[key] || 0) > 0) invitationCounts[key] += 1;
      if (Number(row.processEvidence?.[key] || 0) > 0) evidenceCounts[key] += 1;
    }
    if (row.abandoned) {
      const demonstrated = PROCESS_KEYS.filter((key) => Number(row.processEvidence?.[key] || 0) > 0);
      const point = demonstrated.length ? PROCESS_EVIDENCE_LABELS[demonstrated[demonstrated.length - 1]] : 'Before participant evidence of a specific situation';
      abandonmentPoints[point] = (abandonmentPoints[point] || 0) + 1;
    }
    const referral = row.referral?.utmSource || row.referral?.referringPage || 'Direct or unknown';
    referralCounts[referral] = (referralCounts[referral] || 0) + 1;
    const device = row.device?.category || 'Unknown';
    deviceCounts[device] = (deviceCounts[device] || 0) + 1;
    if (row.feedback?.ratings) {
      row.feedback.ratings.forEach((value, index) => { if (Number.isFinite(Number(value))) feedback[index].push(Number(value)); });
    }
    estimatedCostUsd += Number(row.estimatedCostUsd || 0);
    errors += Number(row.serverErrors || 0) + Number(row.browserErrors || 0) + Number(row.emptyResponses || 0) + Number(row.responseFailures || 0) + Number(row.voiceTranscriptionFailures || 0) + Number(row.voiceClientFailures || 0);
    retries += Number(row.chargeableRetries || 0);
    safetyActivations += Number(row.safetyActivations || 0);
    conversionClicks += Number(row.conversionClicks || 0);
    voiceRecordingStarts += Number(row.voiceRecordingStarts || 0);
    voiceTranscriptionSuccesses += Number(row.voiceTranscriptionSuccesses || 0);
    voiceTranscriptionFailures += Number(row.voiceTranscriptionFailures || 0);
    voiceClientFailures += Number(row.voiceClientFailures || 0);
    microphoneDenials += Number(row.microphoneDenials || 0);
    voiceTranscriptCorrections += Number(row.voiceTranscriptCorrections || 0);
    voiceRecordedSeconds += Number(row.voiceRecordedSeconds || 0);
    speechPlaybacks += Number(row.speechPlaybacks || 0);
    speechPlaybackFailures += Number(row.speechPlaybackFailures || 0);
  }

  const ranked = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    totalSittings: rows.length,
    started: rows.filter((row) => row.beganWriting).length,
    completed,
    abandoned,
    completionRate: percentage(completed, rows.length),
    abandonmentRate: percentage(abandoned, rows.length),
    averageDurationSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
    averageExchangeCount: exchanges.length ? Math.round(exchanges.reduce((sum, value) => sum + value, 0) / exchanges.length * 10) / 10 : 0,
    medianExchangeCount: median(exchanges),
    averageResponseTimeMs: responseTimes.length ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length) : 0,
    medianResponseTimeMs: Math.round(median(responseTimes)),
    slowestResponseMs: responseTimes.length ? Math.max(...responseTimes) : 0,
    topics: ranked(topicCounts),
    topicCombinations: ranked(topicCombinations),
    commonAbandonmentPoint: ranked(abandonmentPoints)[0]?.[0] || 'Not enough data yet',
    processInvitations: ranked(Object.fromEntries(Object.entries(invitationCounts).map(([key, value]) => [PROCESS_INVITATION_LABELS[key], value]))).filter(([, value]) => value > 0),
    processEvidence: ranked(Object.fromEntries(Object.entries(evidenceCounts).map(([key, value]) => [PROCESS_EVIDENCE_LABELS[key], value]))).filter(([, value]) => value > 0),
    referrals: ranked(referralCounts),
    devices: ranked(deviceCounts),
    feedbackAverages: feedback.map((values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null),
    estimatedCostUsd: Math.round(estimatedCostUsd * 100000) / 100000,
    errors,
    retries,
    safetyActivations,
    conversionClicks,
    voiceInputSittings: rows.filter((row) => Number(row.voiceRecordingStarts || 0) > 0).length,
    voiceRecordingStarts,
    voiceTranscriptionSuccesses,
    voiceTranscriptionFailures,
    voiceClientFailures,
    microphoneDenials,
    voiceTranscriptCorrections,
    speechPlaybacks,
    speechPlaybackFailures,
    voicePlaybackSittings: rows.filter((row) => Number(row.speechPlaybacks || 0) > 0).length,
    voiceTranscriptionSuccessRate: percentage(voiceTranscriptionSuccesses, voiceTranscriptionSuccesses + voiceTranscriptionFailures),
    averageVoiceRecordingSeconds: voiceTranscriptionSuccesses + voiceTranscriptionFailures > 0
      ? Math.round(voiceRecordedSeconds / (voiceTranscriptionSuccesses + voiceTranscriptionFailures) * 10) / 10
      : 0,
    medianTranscriptionTimeMs: Math.round(median(transcriptionTimes)),
    slowestTranscriptionMs: transcriptionTimes.length ? Math.max(...transcriptionTimes) : 0
  };
}

function aggregateFunnel(visits, sessions) {
  const visitRows = Array.isArray(visits) ? visits : [];
  const sessionRows = Array.isArray(sessions) ? sessions : [];
  const sum = (key) => visitRows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const trackedReferences = new Set(visitRows.filter((row) => row.sessionStarted && row.sessionReference).map((row) => row.sessionReference));
  const trackedSessions = sessionRows.filter((row) => trackedReferences.has(row.sessionReference));
  const trackedStarts = trackedReferences.size;
  const beganWriting = trackedSessions.filter((row) => row.beganWriting).length;
  const completed = trackedSessions.filter((row) => row.completed).length;
  return {
    pageVisits: visitRows.length,
    returningVisits: visitRows.filter((row) => row.returningBrowser).length,
    beginAttempts: sum('beginAttempts'),
    noticeBlocks: sum('noticeBlocks'),
    configurationBlocks: sum('configurationBlocks'),
    sessionStartErrors: sum('sessionStartErrors'),
    browserErrorsBeforeStart: sum('browserErrors'),
    pageExitsBeforeStart: sum('pageExitsBeforeStart'),
    trackedStarts,
    beganWriting,
    completed,
    visitToStartRate: percentage(trackedStarts, visitRows.length),
    startToWritingRate: percentage(beganWriting, trackedStarts),
    startToCompletionRate: percentage(completed, trackedStarts)
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sessionsToCsv(sessions) {
  const headers = [
    'sessionReference', 'startedAt', 'endedAt', 'durationSeconds', 'noticeAcknowledged', 'beganWriting',
    'completed', 'endedIntentionally', 'expired', 'limitReached', 'abandoned', 'userEntries',
    'companionResponses', 'averageUserEntryLength', 'longestUserEntryLength', 'estimatedPrimaryTopic',
    'estimatedSecondaryTopics', 'estimatedCompanionInvitations', 'estimatedParticipantEvidence', 'deviceCategory', 'browserFamily', 'operatingSystemFamily', 'screenSizeCategory',
    'referringPage', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'estimatedCostUsd',
    'medianResponseTimeMs', 'slowestResponseMs', 'serverErrors', 'browserErrors', 'responseFailures', 'safetyActivations',
    'diagnosisBoundaryActivations', 'crisisActivations', 'voiceRecordingStarts', 'voiceRecordingStops',
    'voiceTranscriptionSuccesses', 'voiceTranscriptionFailures', 'voiceClientFailures', 'microphoneDenials',
    'voiceTranscriptCorrections', 'voiceRecordedSeconds', 'medianTranscriptionTimeMs', 'slowestTranscriptionMs',
    'speechPlaybacks', 'speechPlaybackFailures',
    'feedbackRatings', 'sharedSittingPermission'
  ];
  const lines = [headers.join(',')];
  for (const row of sessions || []) {
    const values = [
      row.sessionReference, row.startedAt, row.endedAt, row.durationSeconds, row.noticeAcknowledged ?? row.accessCompleted, row.beganWriting,
      row.completed, row.endedIntentionally, row.expired, row.limitReached, row.abandoned, row.userEntries,
      row.companionResponses, row.averageUserEntryLength, row.longestUserEntryLength, row.primaryTopic,
      (row.secondaryTopics || []).join('|'),
      PROCESS_KEYS.filter((key) => Number(row.processInvitations?.[key] || 0) > 0).map((key) => PROCESS_INVITATION_LABELS[key]).join('|'),
      PROCESS_KEYS.filter((key) => Number(row.processEvidence?.[key] || 0) > 0).map((key) => PROCESS_EVIDENCE_LABELS[key]).join('|'),
      row.device?.category, row.device?.browserFamily, row.device?.operatingSystemFamily,
      row.device?.screenSizeCategory, row.referral?.referringPage, row.referral?.utmSource, row.referral?.utmMedium,
      row.referral?.utmCampaign, row.referral?.utmContent, row.estimatedCostUsd, row.medianResponseTimeMs,
      row.slowestResponseMs, row.serverErrors, row.browserErrors, row.responseFailures, row.safetyActivations,
      row.diagnosisBoundaryActivations, row.crisisActivations, row.voiceRecordingStarts, row.voiceRecordingStops,
      row.voiceTranscriptionSuccesses, row.voiceTranscriptionFailures, row.voiceClientFailures, row.microphoneDenials,
      row.voiceTranscriptCorrections, row.voiceRecordedSeconds, row.medianTranscriptionTimeMs, row.slowestTranscriptionMs,
      row.speechPlaybacks, row.speechPlaybackFailures,
      (row.feedback?.ratings || []).join('|'), row.sharedSittingPermission
    ];
    lines.push(values.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function visitsToCsv(visits) {
  const headers = [
    'openedAt', 'configuredAtOpen', 'beginAttempts', 'noticeBlocks', 'configurationBlocks',
    'sessionStartErrors', 'browserErrorsBeforeStart', 'pageExitsBeforeStart', 'sessionStarted',
    'sessionReference', 'returningBrowser', 'deviceCategory', 'browserFamily', 'operatingSystemFamily',
    'screenSizeCategory', 'referringPage', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent'
  ];
  const lines = [headers.join(',')];
  for (const row of visits || []) {
    const values = [
      row.openedAt, row.configuredAtOpen, row.beginAttempts, row.noticeBlocks, row.configurationBlocks,
      row.sessionStartErrors, row.browserErrors, row.pageExitsBeforeStart, row.sessionStarted,
      row.sessionReference, row.returningBrowser, row.device?.category, row.device?.browserFamily,
      row.device?.operatingSystemFamily, row.device?.screenSizeCategory, row.referral?.referringPage,
      row.referral?.utmSource, row.referral?.utmMedium, row.referral?.utmCampaign, row.referral?.utmContent
    ];
    lines.push(values.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  PROCESS_EVIDENCE_LABELS,
  PROCESS_INVITATION_LABELS,
  PROCESS_KEYS,
  TOPIC_RULES,
  aggregateInsights,
  aggregateFunnel,
  classifyProcess,
  classifyTopics,
  classifyTurn,
  emptyProcess,
  median,
  sessionsToCsv,
  visitsToCsv
};
