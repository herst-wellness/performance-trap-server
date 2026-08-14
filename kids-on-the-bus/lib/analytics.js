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

const PROCESS_LABELS = Object.freeze({
  specificSituation: 'Specific situation described',
  storyEmotionallyAlive: 'Story became emotionally alive',
  worstExplored: 'What is the worst of it explored',
  uTurnToExperience: 'U-turn toward direct experience',
  bodySensation: 'Body sensation identified',
  sensationLocation: 'Sensation location identified',
  sensationQuality: 'Sensation quality explored',
  sensationMovement: 'Sensation movement or geography explored',
  partRecognized: 'A part recognized',
  multipleParts: 'More than one part recognized',
  partProtectionExplored: 'What a part protects explored',
  fearedConsequence: 'Feared consequence explored',
  returnedToBody: 'Attention returned to the body',
  stayedWithSensation: 'Stayed with a sensation',
  sensationChanged: 'Change in sensation reported',
  newUnderstanding: 'New understanding reached',
  appropriateClosing: 'Appropriate closing reached',
  unresolvedEnding: 'Ended with something unresolved'
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
  const combined = `${user}\n${companion}`;
  const process = emptyProcess();
  const mark = (key, matched) => { if (matched) process[key] = 1; };

  mark('specificSituation', /\b(when|yesterday|today|last night|this morning|in the meeting|during|said|happened|moment)\b/.test(user));
  mark('storyEmotionallyAlive', /\b(feel|felt|impact|worst|angry|afraid|ashamed|hurt|sad|tight|heavy|hot|numb)\b/.test(user));
  mark('worstExplored', /what(?:'s| is) the worst|worst of it|most difficult|hardest part/.test(combined));
  mark('uTurnToExperience', /\b(where does that land|notice(?:\s+\w+){0,4}\s+in your body|body (?:notice|feel|respond)|direct experience|inside you)\b/.test(companion));
  mark('bodySensation', /\b(tight|tightness|heavy|heaviness|pressure|tingl|warm|hot|cold|numb|ache|clench|flutter|butterflies|sensation|body|breath|breathing)\b/.test(user));
  mark('sensationLocation', /\b(chest|throat|jaw|belly|stomach|gut|shoulder|back|neck|head|face|arms?|legs?|hands?|feet|heart)\b/.test(user));
  mark('sensationQuality', /\b(sharp|dull|tight|heavy|hard|soft|warm|hot|cold|numb|dense|light|buzz|tingl|pressure|hollow)\b/.test(user));
  mark('sensationMovement', /\b(move|moving|shift|spread|expand|contract|rise|fall|travel|edge|center|shape|geography)\b/.test(combined));
  mark('partRecognized', /\b(part of me|something in me|this part|that part|protector|kid on the bus)\b/.test(combined));
  mark('multipleParts', /\b(parts of me|two parts|another part|different parts|both parts)\b/.test(combined));
  mark('partProtectionExplored', /\b(protect|protecting|keep you safe|trying to keep|what it needs)\b/.test(combined));
  mark('fearedConsequence', /\b(afraid might happen|fear would happen|then .* would|worst for (?:this|that) part|what would happen)\b/.test(combined));
  mark('returnedToBody', /\b(let that land|back to (?:your|the) body|body responding|what do you notice now)\b/.test(companion));
  mark('stayedWithSensation', /\b(stay with|keep .* company|give .* attention|still with|as you notice)\b/.test(companion));
  mark('sensationChanged', /\b(changed|changing|shifted|softened|eased|stronger|weaker|moved|less tight|more open)\b/.test(user));
  mark('newUnderstanding', /\b(i realize|i realised|i see now|i had not seen|i hadn't seen|that makes sense|i understand|what i notice is)\b/.test(user));
  mark('appropriateClosing', /\b(good place to pause|let's stop here|we'll stop here|take that with you|enough for now)\b/.test(companion));
  mark('unresolvedEnding', route !== 'continue_reflection' && !process.appropriateClosing);
  return process;
}

function classifyTurn({ message, response, route }) {
  return {
    topics: classifyTopics(message),
    process: classifyProcess(message, response, route),
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
  const topicCounts = {};
  const topicCombinations = {};
  const processCounts = Object.fromEntries(PROCESS_KEYS.map((key) => [key, 0]));
  const abandonmentPoints = {};
  const referralCounts = {};
  const deviceCounts = {};
  const feedback = Array.from({ length: 5 }, () => []);
  let estimatedCostUsd = 0;
  let errors = 0;
  let retries = 0;
  let safetyActivations = 0;
  let conversionClicks = 0;

  for (const row of rows) {
    const topics = [row.primaryTopic, ...(row.secondaryTopics || [])].filter(Boolean);
    for (const topic of topics) topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    if (topics.length > 1) {
      const key = topics.slice().sort().join(' + ');
      topicCombinations[key] = (topicCombinations[key] || 0) + 1;
    }
    for (const key of PROCESS_KEYS) if (Number(row.process?.[key] || 0) > 0) processCounts[key] += 1;
    if (row.abandoned) {
      const reached = PROCESS_KEYS.filter((key) => Number(row.process?.[key] || 0) > 0);
      const point = reached.length ? PROCESS_LABELS[reached[reached.length - 1]] : 'Before a specific situation';
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
    errors += Number(row.serverErrors || 0) + Number(row.browserErrors || 0) + Number(row.emptyResponses || 0);
    retries += Number(row.chargeableRetries || 0);
    safetyActivations += Number(row.safetyActivations || 0);
    conversionClicks += Number(row.conversionClicks || 0);
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
    processStages: ranked(Object.fromEntries(Object.entries(processCounts).map(([key, value]) => [PROCESS_LABELS[key], value]))),
    referrals: ranked(referralCounts),
    devices: ranked(deviceCounts),
    feedbackAverages: feedback.map((values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null),
    estimatedCostUsd: Math.round(estimatedCostUsd * 100000) / 100000,
    errors,
    retries,
    safetyActivations,
    conversionClicks
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sessionsToCsv(sessions) {
  const headers = [
    'sessionReference', 'startedAt', 'endedAt', 'durationSeconds', 'accessCompleted', 'beganWriting',
    'completed', 'endedIntentionally', 'expired', 'limitReached', 'abandoned', 'userEntries',
    'companionResponses', 'averageUserEntryLength', 'longestUserEntryLength', 'primaryTopic',
    'secondaryTopics', 'deviceCategory', 'browserFamily', 'operatingSystemFamily', 'screenSizeCategory',
    'referringPage', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'estimatedCostUsd',
    'medianResponseTimeMs', 'slowestResponseMs', 'serverErrors', 'browserErrors', 'safetyActivations',
    'diagnosisBoundaryActivations', 'crisisActivations', 'feedbackRatings', 'sharedSittingPermission'
  ];
  const lines = [headers.join(',')];
  for (const row of sessions || []) {
    const values = [
      row.sessionReference, row.startedAt, row.endedAt, row.durationSeconds, row.accessCompleted, row.beganWriting,
      row.completed, row.endedIntentionally, row.expired, row.limitReached, row.abandoned, row.userEntries,
      row.companionResponses, row.averageUserEntryLength, row.longestUserEntryLength, row.primaryTopic,
      (row.secondaryTopics || []).join('|'), row.device?.category, row.device?.browserFamily, row.device?.operatingSystemFamily,
      row.device?.screenSizeCategory, row.referral?.referringPage, row.referral?.utmSource, row.referral?.utmMedium,
      row.referral?.utmCampaign, row.referral?.utmContent, row.estimatedCostUsd, row.medianResponseTimeMs,
      row.slowestResponseMs, row.serverErrors, row.browserErrors, row.safetyActivations,
      row.diagnosisBoundaryActivations, row.crisisActivations, (row.feedback?.ratings || []).join('|'),
      row.sharedSittingPermission
    ];
    lines.push(values.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  PROCESS_KEYS,
  PROCESS_LABELS,
  TOPIC_RULES,
  aggregateInsights,
  classifyProcess,
  classifyTopics,
  classifyTurn,
  emptyProcess,
  median,
  sessionsToCsv
};
