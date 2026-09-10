// Daily yay or nay for The Performance Trap Practice. One message a day,
// "Yay or nay?", with two one-tap links. Each link carries an HMAC of the
// person's private yayToken over id + date, so nobody can answer for
// someone else. The GET records the answer (last answer wins) and shows a
// small page in the course style. The same answer can arrive by text when
// Twilio is configured; the inbound webhook parses yay/yes/y or nay/no/n
// and matches by phone. The weekly scorecard is computed here too: just
// data, no badges, no streak shaming.
const crypto = require('node:crypto');
const { dayEntry, findById, findByPhone } = require('./onramp-store');
const { addDays, enrollmentDay0, localDateString } = require('./onramp-schedule');

const YAY_PATH = '/course/on-ramp/y';
const YAY_ROUTE = /^\/course\/on-ramp\/y\/(enr_[a-f0-9]{12})\/([a-f0-9]{24})\/(\d{4}-\d{2}-\d{2})\/(yay|nay)$/;
const SMS_INBOUND_PATH = '/course/on-ramp/api/sms-inbound';

// ── Links and answers ───────────────────────────────────────────
function linkToken(record, date) {
  return crypto.createHmac('sha256', String(record.yayToken || '')).update(record.id + date).digest('hex').slice(0, 24);
}

function tokenMatches(expected, supplied) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function yayLinks(record, date, baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '') + YAY_PATH + '/' + record.id + '/' + linkToken(record, date) + '/' + date;
  return { yay: base + '/yay', nay: base + '/nay' };
}

function recordAnswer(record, date, yay, now = new Date()) {
  const entry = dayEntry(record, date);
  entry.yay = Boolean(yay);
  entry.answeredAt = now.toISOString();
  return entry;
}

function parseAnswer(text) {
  const s = String(text || '').trim();
  if (/^(yay|yes|yeah|yep|y)\b/i.test(s)) return true;
  if (/^(nay|no|nope|n)\b/i.test(s)) return false;
  return null;
}

// The date the most recent daily message asked about: today on the
// enrollment day (the intro), otherwise yesterday. If that day is already
// answered, walk back to the nearest unanswered day, else last answer wins.
function mostRecentUnansweredDate(record, now = new Date()) {
  const { tz, day0 } = enrollmentDay0(record);
  const today = localDateString(now, tz);
  const latestAsked = today <= day0 ? day0 : addDays(today, -1);
  let date = latestAsked;
  for (let i = 0; i < 29 && date >= day0; i += 1) {
    const entry = record.days && record.days[date];
    if (!entry || entry.yay === null || entry.yay === undefined) return date;
    date = addDays(date, -1);
  }
  return latestAsked;
}

// ── Scorecard ───────────────────────────────────────────────────
function scorecard(record, week) {
  const { day0 } = enrollmentDay0(record);
  const days = record.days || {};
  const dates = [];
  for (let i = 0; i < 7; i += 1) dates.push(addDays(day0, 7 * (week - 1) + i));
  const satOn = (entry) => Boolean(entry && Array.isArray(entry.listens) && entry.listens.some((l) => l && l.complete));
  let daysSat = 0;
  let sitsStarted = 0;
  let sitsCompleted = 0;
  let longestRun = 0;
  let run = 0;
  for (const date of dates) {
    const entry = days[date];
    if (satOn(entry)) {
      daysSat += 1;
      run += 1;
      if (run > longestRun) longestRun = run;
    } else {
      run = 0;
    }
    if (entry && Array.isArray(entry.listens)) {
      sitsStarted += entry.listens.filter((l) => l && !l.complete).length;
      sitsCompleted += entry.listens.filter((l) => l && l.complete).length;
    }
  }
  const journals = record.journals || {};
  const weekKeys = Object.keys(journals).filter((k) => k.startsWith('week-' + week + '/'));
  const journalsDone = weekKeys.filter((k) => journals[k] && journals[k].done).length;
  const journalsOpened = weekKeys.filter((k) => journals[k] && journals[k].opened).length;
  const totalDaysSat = Object.values(days).filter(satOn).length;
  return { week, dates, daysSat, sitsStarted, sitsCompleted, journalsDone, journalsOpened, longestRun, totalDaysSat };
}

// ── Twilio ──────────────────────────────────────────────────────
function smsConfig(env = process.env) {
  const sid = String(env.TWILIO_ACCOUNT_SID || '');
  const token = String(env.TWILIO_AUTH_TOKEN || '');
  const from = String(env.TWILIO_FROM || '');
  if (!sid || !token || !from) return null;
  return { sid, token, from, baseUrl: String(env.TWILIO_API_BASE_URL || 'https://api.twilio.com') };
}

function channelFor(record, env = process.env) {
  return smsConfig(env) && record.phone ? 'sms' : 'email';
}

async function sendSms(to, body, env = process.env) {
  const cfg = smsConfig(env);
  if (!cfg) return { ok: false, error: 'Twilio is not configured' };
  const form = new URLSearchParams({ To: to, From: cfg.from, Body: body });
  const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/2010-04-01/Accounts/' + encodeURIComponent(cfg.sid) + '/Messages.json', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(cfg.sid + ':' + cfg.token).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) console.error('Twilio send failed: HTTP ' + res.status);
  return { ok: res.ok };
}

// Twilio signs each webhook: base64(HMAC-SHA1(authToken, url + every POST
// parameter, sorted by name, as name+value with no separators)).
function twilioSignature(authToken, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', authToken).update(data).digest('base64');
}

function validTwilioSignature(authToken, url, params, header) {
  if (!authToken) return true;
  return tokenMatches(twilioSignature(authToken, url, params), String(header || ''));
}

function readFormBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      const params = {};
      for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
      resolve(params);
    });
    req.on('error', reject);
  });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function twiml(message) {
  return '<?xml version="1.0" encoding="UTF-8"?><Response>' + (message ? '<Message>' + escapeXml(message) + '</Message>' : '') + '</Response>';
}

const GOT_IT = { yay: 'Got it. Yay.', nay: 'Got it. Nay. No shame. Just data.' };

// ── Pages ───────────────────────────────────────────────────────
function pageHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  };
}

function shellPage(css, title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${title} | The Performance Trap Practice</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<main class="shell">
  <div class="eyebrow">The Performance Trap Practice</div>
  ${bodyHtml}
  <div class="footer">Herst Wellness</div>
</main>
</body>
</html>`;
}

function answerPage(css, answer, date, otherLink) {
  const heading = answer ? GOT_IT.yay : GOT_IT.nay;
  const other = answer ? 'nay' : 'yay';
  return shellPage(css, heading, `
  <h1>${heading}</h1>
  <p class="sub">Recorded for ${date}.</p>
  <section class="card">
    <p>That's the whole thing for today. Your week's numbers come on the weekend.</p>
    <p class="small">Tapped the wrong one? <a href="${otherLink}">Change it to ${other}</a>.</p>
    <p class="small"><a href="/course/on-ramp">Back to the practice</a></p>
  </section>`);
}

function notFoundPage(css) {
  return shellPage(css, 'Not found', `
  <h1>That link didn't work</h1>
  <section class="card">
    <p>It may have been copied incompletely. Open the day's message again and tap yay or nay from there.</p>
    <p class="small"><a href="/course/on-ramp">Back to the practice</a></p>
  </section>`);
}

// ── Routes ──────────────────────────────────────────────────────
async function handleYayRoute(req, res, { store, css, now = new Date() }) {
  const match = YAY_ROUTE.exec(req.url);
  if (!match || req.method !== 'GET') return false;
  const [, id, token, date, answer] = match;
  let record = null;
  try {
    record = findById(await store.load(), id);
  } catch (error) {
    console.error('On-Ramp yay/nay: store read failed:', error.message);
  }
  if (!record || !tokenMatches(linkToken(record, date), token)) {
    res.writeHead(404, pageHeaders('text/html; charset=utf-8'));
    res.end(notFoundPage(css));
    return true;
  }
  const yay = answer === 'yay';
  try {
    await store.update((doc) => {
      const r = findById(doc, id);
      if (r) recordAnswer(r, date, yay, now);
    });
  } catch (error) {
    console.error('On-Ramp yay/nay: store write failed:', error.message);
    res.writeHead(500, pageHeaders('text/html; charset=utf-8'));
    res.end(shellPage(css, 'Try again', '<h1>Could not save that</h1><section class="card"><p>Give it a minute and tap the link again.</p></section>'));
    return true;
  }
  const links = yayLinks(record, date, '');
  res.writeHead(200, pageHeaders('text/html; charset=utf-8'));
  res.end(answerPage(css, yay, date, yay ? links.nay : links.yay));
  return true;
}

async function handleSmsInbound(req, res, { store, env = process.env, now = new Date() }) {
  if (req.method !== 'POST' || req.url !== SMS_INBOUND_PATH) return false;
  let params;
  try {
    params = await readFormBody(req);
  } catch {
    res.writeHead(400, pageHeaders('text/plain; charset=utf-8'));
    res.end('Bad request');
    return true;
  }
  const url = String(env.TWILIO_WEBHOOK_URL || 'https://' + (req.headers.host || '') + req.url);
  if (!validTwilioSignature(String(env.TWILIO_AUTH_TOKEN || ''), url, params, req.headers['x-twilio-signature'])) {
    res.writeHead(403, pageHeaders('text/plain; charset=utf-8'));
    res.end('Forbidden');
    return true;
  }
  const answer = parseAnswer(params.Body);
  let reply = '';
  try {
    const doc = await store.load();
    const record = findByPhone(doc, params.From);
    if (record && answer !== null) {
      const date = mostRecentUnansweredDate(record, now);
      await store.update((d) => {
        const r = findById(d, record.id);
        if (r) recordAnswer(r, date, answer, now);
      });
      reply = answer ? GOT_IT.yay : GOT_IT.nay;
    } else if (record) {
      reply = 'Just yay or nay is all I need.';
    }
  } catch (error) {
    console.error('On-Ramp sms-inbound: store failed:', error.message);
  }
  res.writeHead(200, pageHeaders('text/xml; charset=utf-8'));
  res.end(twiml(reply));
  return true;
}

module.exports = {
  GOT_IT,
  SMS_INBOUND_PATH,
  YAY_PATH,
  channelFor,
  handleSmsInbound,
  handleYayRoute,
  linkToken,
  mostRecentUnansweredDate,
  parseAnswer,
  recordAnswer,
  scorecard,
  sendSms,
  smsConfig,
  twilioSignature,
  yayLinks,
};
