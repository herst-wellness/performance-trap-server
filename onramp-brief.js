// The brief Chad reads before an Integration and Next-Step Session
// (performance-trap docs/64 and 65, 9/10/26). With the person's consent the
// journal sittings are kept on their enrollment record; on day 28, or on
// demand from the admin route, the saved writing, the exchanges, and the
// practice numbers are assembled into one input, the model writes the
// brief from onramp-brief-prompt.txt, and it is emailed to Chad in the
// Mind/Body Foundations wrapper. Without consent the input carries only
// the practice numbers.
const fs = require('node:fs');
const path = require('node:path');
const yaynay = require('./onramp-yaynay');
const emails = require('./onramp-emails');

const BRIEF_TO = 'chad@herstwellness.com';
const BRIEF_PROMPT = fs.readFileSync(path.join(__dirname, 'onramp-brief-prompt.txt'), 'utf8').trim();
const BRIEF_MAX_TOKENS = 2500;
const JOURNAL_PREFIX = 'Journal: ';
const JOURNALS_PREFIX = 'Journals, Week ';
const JOURNAL_HEADING = '## ';

function removeEmDashes(text) {
  return String(text || '').replace(/\u2014/g, ',').trim();
}

// The first turn of a saved sitting in the older one-journal form is
// "Journal: <title>", a blank line, then the writing.
function splitJournalTurn(content) {
  const s = String(content || '');
  const firstLine = s.split('\n')[0];
  if (!firstLine.startsWith(JOURNAL_PREFIX)) return { title: '', text: s.trim() };
  return { title: firstLine.slice(JOURNAL_PREFIX.length).trim(), text: s.slice(firstLine.length).trim() };
}

// The week form (docs/65 revision): "Journals, Week 1", then each journal
// the person brought under a "## <title>" heading. Returns the journals in
// the order they were brought.
function splitWeekTurn(content) {
  const s = String(content || '');
  const lines = s.split('\n');
  const m = /^Journals, Week (\d+)/.exec(lines[0] || '');
  if (!m) return null;
  const journals = [];
  let current = null;
  for (const line of lines.slice(1)) {
    if (line.startsWith(JOURNAL_HEADING)) {
      current = { title: line.slice(JOURNAL_HEADING.length).trim(), lines: [] };
      journals.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return {
    week: Number(m[1]),
    journals: journals.map((j) => ({ title: j.title, text: j.lines.join('\n').trim() })),
  };
}

function isWeekTurn(content) {
  return String(content || '').startsWith(JOURNALS_PREFIX);
}

function weekOfKey(key) {
  const m = /^week-(\d)(?:\/|$)/.exec(String(key || ''));
  return m ? Number(m[1]) : null;
}

function fullName(record) {
  return [record.firstName, record.lastName].filter(Boolean).join(' ').trim() || 'there';
}

function buildBriefInput(record) {
  const lines = [];
  lines.push('PERSON');
  lines.push('First name: ' + (record.firstName || 'unknown'));
  lines.push('Enrolled: ' + String(record.enrolledAt || '').slice(0, 10));
  lines.push('');
  lines.push('PRACTICE NUMBERS');
  for (let w = 1; w <= 4; w += 1) {
    const s = yaynay.scorecard(record, w);
    lines.push('Week ' + w + ': days sat ' + s.daysSat + ' of 7, sits finished ' + s.sitsCompleted + ', journals done ' + s.journalsDone + ' of 3');
  }
  lines.push('');
  lines.push('JOURNAL SITTINGS');
  const sessions = record.journalSessions || {};
  const keys = Object.keys(sessions).sort();
  if (!keys.length) lines.push('No journal sittings were saved. The person did not tick the box, or brought nothing to the sittings.');
  for (const key of keys) {
    const session = sessions[key] || {};
    const history = Array.isArray(session.history) ? session.history : [];
    const firstContent = history.length ? history[0].content : '';
    const when = session.updatedAt ? ', ' + String(session.updatedAt).slice(0, 10) : '';
    lines.push('');
    if (isWeekTurn(firstContent)) {
      // One sitting for the week: every journal brought, each under its
      // own title, then the one exchange.
      const split = splitWeekTurn(firstContent);
      const week = split.week || weekOfKey(key);
      lines.push('--- Week ' + week + ' journal sitting' + when + ' ---');
      lines.push('THE WRITING:');
      if (!split.journals.length) lines.push('(nothing)');
      split.journals.forEach((j, i) => {
        if (i > 0) lines.push('');
        lines.push('[' + j.title + ']');
        lines.push(j.text || '(nothing)');
      });
    } else {
      const first = splitJournalTurn(firstContent);
      const title = session.journalTitle || first.title || key;
      const week = weekOfKey(key);
      lines.push('--- ' + title + (week ? ' (Week ' + week + ')' : '') + when + ' ---');
      lines.push('THE WRITING:');
      lines.push(first.text || '(nothing)');
    }
    lines.push('');
    lines.push('THE EXCHANGE:');
    if (history.length < 2) lines.push('(no exchange)');
    for (const turn of history.slice(1)) {
      if (!turn || typeof turn.content !== 'string') continue;
      lines.push((turn.role === 'assistant' ? 'Companion: ' : 'Person: ') + turn.content.trim());
    }
  }
  return lines.join('\n');
}

async function generateBrief(record, env = process.env) {
  const model = env.COMPANION_MODEL || env.ANTHROPIC_MODEL;
  if (!env.ANTHROPIC_API_KEY || !model) throw new Error('The brief needs ANTHROPIC_API_KEY and a model');
  const url = env.ANTHROPIC_API_BASE_URL || 'https://api.anthropic.com/v1/messages';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      system: BRIEF_PROMPT,
      messages: [{ role: 'user', content: buildBriefInput(record) }],
      max_tokens: BRIEF_MAX_TOKENS,
    }),
  });
  if (!response.ok) throw new Error('Brief request failed: HTTP ' + response.status);
  const payload = await response.json();
  const text = Array.isArray(payload.content)
    ? payload.content.filter((item) => item.type === 'text' && item.text).map((item) => item.text).join('\n').trim()
    : '';
  if (!text) throw new Error('Brief request returned no text');
  return removeEmDashes(text);
}

// The brief as paragraphs. A short line on its own (a heading) is set bold.
function briefHtml(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const isHeading = !block.includes('\n') && block.length < 70 && !/[.?!]$/.test(block);
      const inner = emails.esc(block).replace(/\n/g, '<br>');
      return emails.p(isHeading ? '<strong>' + inner + '</strong>' : inner, isHeading ? 'margin-top:1.2em;' : '');
    })
    .join('');
}

function briefSubject(record) {
  return 'Before your session with ' + fullName(record) + ': the month in brief';
}

async function sendBrief(record, text, helpers = {}) {
  if (typeof helpers.sendEmail !== 'function') throw new Error('No email sender for the brief');
  const subject = briefSubject(record);
  const body =
    emails.p(emails.esc(fullName(record)) + ', code ' + emails.esc(record.code || '') + ', ' + emails.esc(record.email || '') + '.') +
    briefHtml(text);
  const result = await helpers.sendEmail(BRIEF_TO, subject, emails.wrap(body));
  return { ok: Boolean(result && result.ok), subject, chars: String(text || '').length };
}

module.exports = {
  BRIEF_MAX_TOKENS,
  BRIEF_PROMPT,
  BRIEF_TO,
  briefHtml,
  briefSubject,
  buildBriefInput,
  generateBrief,
  sendBrief,
  splitJournalTurn,
  splitWeekTurn,
};
