// Where a finished Mind/Body Foundations journal goes when the client
// presses Send.
//
// Three things happen, in this order, and each one is reported separately so
// a client is never told "sent" when only part of it worked:
//
//   1. The journal is written into Chad's Dropbox at
//      <root>/<Client Name>/Module N/<file>.txt, the same folder tree he
//      already keeps by hand. This replaces the email-it-to-Chad step.
//   2. A copy goes to the client's own email. That copy is their archive:
//      this application still stores no journal text, so when Module 6 asks
//      them to look back at Module 2, they look in their own inbox.
//   3. Chad gets a short notice, with no journal content in it, saying whose
//      work landed and where.
//
// If Dropbox is not configured, step 1 is skipped and Chad's notice carries
// the full journal instead, which is exactly today's behaviour. Nothing is
// silently lost.
const DROPBOX_TOKEN_URL = 'https://api.dropbox.com/oauth2/token';
const DROPBOX_UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';

// The client folders live under this path in Chad's Dropbox. The default is
// the tree that already exists. Note the colon: macOS shows a Dropbox
// folder named "Mind/Body Foundations" with a colon locally, and the name
// Dropbox's own API wants must be confirmed against a real listing before
// this goes live. MBF_DROPBOX_ROOT exists so that is a settings change and
// not a code change.
const DEFAULT_ROOT = '/clients/Mind:Body Foundations';

function dropboxConfigured() {
  return Boolean(
    process.env.DROPBOX_APP_KEY &&
      process.env.DROPBOX_APP_SECRET &&
      process.env.DROPBOX_REFRESH_TOKEN
  );
}

// Access codes are issued as the client's own name, "danny-lowenthal", so
// the folder name is recoverable from the code without a second list to
// keep in step. MBF_CLIENT_NAMES overrides one at a time, as
// "code=Folder Name", for anyone whose folder is spelled differently.
function clientNameFromCode(code) {
  const raw = String(code || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const overrides = String(process.env.MBF_CLIENT_NAMES || '')
    .split(',')
    .map((pair) => pair.split('='))
    .filter((parts) => parts.length === 2);
  for (const [key, name] of overrides) {
    if (key.trim().toLowerCase() === raw) return name.trim();
  }
  return raw
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Dropbox rejects these characters in a path. Everything else, including
// spaces and apostrophes, is fine and is left alone so the file reads the
// way Chad's existing files read.
function safeSegment(s) {
  return String(s).replace(/[\\/:?*<>|"]/g, '-').replace(/\s+/g, ' ').trim();
}

function journalFileName(journal, clientName, now) {
  const date = now.toISOString().slice(0, 10);
  return safeSegment(
    'Module ' + journal.module + ' - ' + journal.title + ' - ' + clientName + ' - ' + date
  ) + '.txt';
}

function dropboxPath(journal, clientName, now) {
  const root = String(process.env.MBF_DROPBOX_ROOT || DEFAULT_ROOT).replace(/\/$/, '');
  return (
    root + '/' + safeSegment(clientName) + '/Module ' + journal.module + '/' + journalFileName(journal, clientName, now)
  );
}

// ── The document itself ─────────────────────────────────────────
// Plain text, prompt then answer, in the journal's own order. Plain text
// because it reads correctly in a screen reader, searches in an inbox, and
// opens on anything, which a PDF does none of well.
function renderJournalText(journal, answers, clientName, now) {
  const lines = [];
  lines.push(journal.title);
  lines.push('Mind/Body Foundations, Module ' + journal.module + ', ' + journal.code);
  lines.push(clientName);
  lines.push(now.toISOString().slice(0, 10));
  lines.push('');
  for (const section of journal.sections) {
    if (section.heading) {
      lines.push('');
      lines.push('--- ' + section.heading.toUpperCase() + ' ---');
      lines.push('');
    }
    for (const prompt of section.prompts) {
      const given = answers && answers[prompt.id];
      lines.push(prompt.label);
      if (prompt.text) lines.push(prompt.text);
      lines.push('');
      if (prompt.kind === 'agree') {
        const agreed = given && given.agree;
        lines.push(agreed === true ? 'Yes' : agreed === false ? 'No' : '(not answered)');
        const note = given && String(given.note || '').trim();
        if (note) lines.push(note);
      } else {
        const text = given && typeof given === 'object' ? String(given.text || '') : String(given || '');
        lines.push(text.trim() || '(not answered)');
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function answeredCount(journal, answers) {
  let answered = 0;
  let total = 0;
  for (const section of journal.sections) {
    for (const prompt of section.prompts) {
      total += 1;
      const given = answers && answers[prompt.id];
      if (!given) continue;
      if (prompt.kind === 'agree') {
        if (given.agree === true || given.agree === false) answered += 1;
      } else {
        const text = typeof given === 'object' ? String(given.text || '') : String(given || '');
        if (text.trim()) answered += 1;
      }
    }
  }
  return { answered, total };
}

// ── Dropbox ─────────────────────────────────────────────────────
async function dropboxAccessToken(fetchImpl = fetch) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(process.env.DROPBOX_REFRESH_TOKEN || ''),
  });
  const basic = Buffer.from(
    String(process.env.DROPBOX_APP_KEY || '') + ':' + String(process.env.DROPBOX_APP_SECRET || '')
  ).toString('base64');
  const response = await fetchImpl(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!response.ok) throw new Error('Dropbox would not renew its access.');
  const data = await response.json();
  if (!data || !data.access_token) throw new Error('Dropbox returned no access.');
  return data.access_token;
}

async function uploadBytesToDropbox(path, bytes, fetchImpl = fetch) {
  const token = await dropboxAccessToken(fetchImpl);
  const response = await fetchImpl(DROPBOX_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/octet-stream',
      // autorename keeps a second send from overwriting the first.
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'add', autorename: true, mute: true }),
    },
    body: Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8'),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error('Dropbox would not accept the file.');
    err.detail = detail.slice(0, 400);
    throw err;
  }
  const data = await response.json().catch(() => ({}));
  return data.path_display || path;
}

function uploadToDropbox(path, text, fetchImpl = fetch) {
  return uploadBytesToDropbox(path, Buffer.from(String(text), 'utf8'), fetchImpl);
}

// ── Email ───────────────────────────────────────────────────────
async function sendEmail({ to, subject, text }, fetchImpl = fetch) {
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.MBF_REPORT_FROM || process.env.COMPANION_REPORT_FROM || '';
  if (!apiKey || !from || !to) throw new Error('Email is not configured.');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!response.ok) throw new Error('The email could not be sent.');
  return response.json();
}

// ── The whole delivery ──────────────────────────────────────────
async function deliverJournal(options, fetchImpl = fetch) {
  const { code, journal, answers, clientEmail } = options;
  const now = options.now || new Date();
  const clientName = clientNameFromCode(code);
  const text = renderJournalText(journal, answers, clientName, now);
  const counts = answeredCount(journal, answers);
  const chadTo = process.env.MBF_REPORT_TO || process.env.COMPANION_REPORT_TO || '';
  const outcome = { clientName, savedTo: null, copiedTo: null, notified: false, problems: [] };

  if (dropboxConfigured()) {
    try {
      outcome.savedTo = await uploadToDropbox(dropboxPath(journal, clientName, now), text, fetchImpl);
    } catch (error) {
      outcome.problems.push('dropbox');
    }
  }

  if (clientEmail) {
    try {
      await sendEmail(
        {
          to: clientEmail,
          subject: 'Your copy: ' + journal.title + ' (Module ' + journal.module + ')',
          text:
            'Here is your own copy of the journal you just sent to Chad. Keep this email. Later modules ask you to look back at what you wrote earlier, and this is where you will find it.\n\n' +
            '--------\n\n' +
            text,
        },
        fetchImpl
      );
      outcome.copiedTo = clientEmail;
    } catch (error) {
      outcome.problems.push('client-copy');
    }
  }

  if (chadTo) {
    const landed = outcome.savedTo
      ? 'It is in Dropbox at ' + outcome.savedTo + '.'
      : 'Dropbox is not connected yet, so the journal itself is below.';
    try {
      await sendEmail(
        {
          to: chadTo,
          subject: clientName + ' sent ' + journal.title + ' (Module ' + journal.module + ')',
          text:
            clientName +
            ' finished ' +
            journal.title +
            ', Module ' +
            journal.module +
            '.\n' +
            counts.answered +
            ' of ' +
            counts.total +
            ' prompts answered.\n' +
            landed +
            '\n' +
            (outcome.copiedTo ? 'A copy went to them as well.\n' : '') +
            (outcome.savedTo ? '' : '\n--------\n\n' + text),
        },
        fetchImpl
      );
      outcome.notified = true;
    } catch (error) {
      outcome.problems.push('chad-notice');
    }
  }

  if (!outcome.savedTo && !outcome.notified) {
    const err = new Error('That did not reach Chad.');
    err.clientStatus = 502;
    throw err;
  }
  return outcome;
}

module.exports = {
  clientNameFromCode,
  uploadBytesToDropbox,
  dropboxConfigured,
  dropboxPath,
  journalFileName,
  renderJournalText,
  answeredCount,
  deliverJournal,
  safeSegment,
};
