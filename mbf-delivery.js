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

// Credentials come from the connection Chad made in his browser, which is
// kept in the journal store, and fall back to settings for anyone running
// this locally. Reading them is a store read, so everything that needs them
// is async.
async function dropboxCredentials() {
  const { loadCredentials } = require('./mbf-dropbox-setup');
  const stored = await loadCredentials();
  if (stored && stored.refreshToken) return stored;
  if (process.env.DROPBOX_APP_KEY && process.env.DROPBOX_REFRESH_TOKEN) {
    return {
      appKey: process.env.DROPBOX_APP_KEY,
      appSecret: process.env.DROPBOX_APP_SECRET || '',
      refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
    };
  }
  return null;
}

async function dropboxConfigured() {
  return Boolean(await dropboxCredentials());
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

// One stable name per client per journal. The file is overwritten as the
// client writes, so Chad's folder holds the current state of the work
// rather than a pile of dated fragments, and the file itself says whether
// it is finished.
// A journal from another programme carries its own folder label, its own
// Dropbox root and its own programme name. When it does not, this is
// Mind/Body Foundations and nothing here changes.
function folderLabelFor(journal) {
  return journal.folderLabel || 'Module ' + journal.module;
}

function rootFor(journal) {
  const own =
    (journal.rootEnv ? process.env[journal.rootEnv] : '') || journal.defaultRoot || '';
  return String(own || process.env.MBF_DROPBOX_ROOT || DEFAULT_ROOT).replace(/\/$/, '');
}

function journalFileName(journal, clientName) {
  return safeSegment(folderLabelFor(journal) + ' - ' + journal.title + ' - ' + clientName) + '.txt';
}

function dropboxPath(journal, clientName) {
  return (
    rootFor(journal) +
    '/' +
    safeSegment(clientName) +
    '/' +
    safeSegment(folderLabelFor(journal)) +
    '/' +
    journalFileName(journal, clientName)
  );
}

// ── The document itself ─────────────────────────────────────────
// Plain text, prompt then answer, in the journal's own order. Plain text
// because it reads correctly in a screen reader, searches in an inbox, and
// opens on anything, which a PDF does none of well.
function renderJournalText(journal, answers, clientName, now, state = {}) {
  const counts = answeredCount(journal, answers);
  const lines = [];
  lines.push(journal.title);
  lines.push(
    (journal.programLabel || 'Mind/Body Foundations') +
      ', ' +
      folderLabelFor(journal) +
      (journal.code ? ', ' + journal.code : '')
  );
  lines.push(clientName);
  lines.push(
    state.finished
      ? 'Finished ' + now.toISOString().slice(0, 10)
      : 'Still being written. This is where it stood on ' + now.toISOString().slice(0, 10) + '.'
  );
  lines.push(counts.answered + ' of ' + counts.total + ' answered.');
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
  const creds = await dropboxCredentials();
  if (!creds) throw new Error('Dropbox is not connected.');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(creds.refreshToken),
  });
  // A connection made with PKCE has no secret, so the app key goes in the
  // form. An older connection that still carries a secret keeps using it.
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (creds.appSecret) {
    headers.Authorization =
      'Basic ' + Buffer.from(String(creds.appKey) + ':' + String(creds.appSecret)).toString('base64');
  } else {
    body.set('client_id', String(creds.appKey));
  }
  const response = await fetchImpl(DROPBOX_TOKEN_URL, { method: 'POST', headers, body: body.toString() });
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
      // Overwrite: one file per journal that keeps up with the client's
      // writing, rather than a new copy every time they pause.
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true }),
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

// Removing a file again, used only by the connection test so that proving
// the connection works leaves nothing behind in Chad's folders.
async function deleteFromDropbox(path, fetchImpl = fetch) {
  const token = await dropboxAccessToken(fetchImpl);
  const response = await fetchImpl('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  return response.ok;
}

// Writes a small file into the folder the journals go to, then removes it.
// If this works, a real journal will land: it is the same account, the same
// permission, and the same folder.
async function testDropboxConnection(fetchImpl = fetch) {
  const root = String(process.env.MBF_DROPBOX_ROOT || DEFAULT_ROOT).replace(/\/$/, '');
  const path = root + '/Connection test ' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
  const written = await uploadBytesToDropbox(
    path,
    Buffer.from('This file was written to check that the journal pages can reach this folder. It removes itself.\n', 'utf8'),
    fetchImpl
  );
  let removed = false;
  try {
    removed = await deleteFromDropbox(written, fetchImpl);
  } catch (error) {
    removed = false;
  }
  return { path: written, removed };
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
// Two shapes, one function.
//
// While a journal is being written, only the Dropbox file is updated, over
// and over, quietly. Chad can open it at any point and read where the
// person has got to. No email goes out for that, because an email every
// time somebody pauses would be worse than useless.
//
// When the client says they are finished, the file is written once more,
// they get their own copy by email, and Chad gets a short notice telling
// him it is done. Only then.
async function deliverJournal(options, fetchImpl = fetch) {
  const { code, journal, answers, clientEmail, finished } = options;
  const now = options.now || new Date();
  const clientName = options.clientName || clientNameFromCode(code);
  const text = renderJournalText(journal, answers, clientName, now, { finished });
  const counts = answeredCount(journal, answers);
  const chadTo = process.env.MBF_REPORT_TO || process.env.COMPANION_REPORT_TO || '';
  const outcome = { clientName, savedTo: null, copiedTo: null, notified: false, problems: [] };

  if (await dropboxConfigured()) {
    try {
      outcome.savedTo = await uploadToDropbox(dropboxPath(journal, clientName), text, fetchImpl);
    } catch (error) {
      outcome.problems.push('dropbox');
    }
  }

  if (!finished) {
    // An in-progress save that could not reach Dropbox is not an error the
    // client should see. It stays unmarked in the store and the ticker
    // tries again on its next pass.
    if (!outcome.savedTo) {
      const err = new Error('Dropbox did not take the file.');
      err.clientStatus = 502;
      throw err;
    }
    return outcome;
  }

  if (clientEmail) {
    try {
      await sendEmail(
        {
          to: clientEmail,
          subject: 'Your copy: ' + journal.title + ' (Module ' + journal.module + ')',
          text:
            'Here is your own copy of the journal you just finished. Keep this email. Later modules ask you to look back at what you wrote earlier, and this is where you will find it.\n\n' +
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
          subject: clientName + ' finished ' + journal.title + ' (Module ' + journal.module + ')',
          text:
            clientName +
            ' marked ' +
            journal.title +
            ', Module ' +
            journal.module +
            ', finished.\n' +
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
  deleteFromDropbox,
  testDropboxConnection,
  dropboxCredentials,
  uploadBytesToDropbox,
  dropboxConfigured,
  dropboxPath,
  journalFileName,
  renderJournalText,
  answeredCount,
  deliverJournal,
  safeSegment,
};
