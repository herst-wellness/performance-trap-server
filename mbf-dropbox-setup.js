// The one-time Dropbox connection, done by Chad in a browser rather than by
// anyone editing settings.
//
// Dropbox will not let an application write into an account until a human
// with that account signs in and says yes. That approval comes back as a
// short-lived code, which is traded once for a refresh token: a long-lived
// key that lets the server keep writing without Chad ever signing in again.
//
// There is no app secret anywhere in this. The first version asked Chad to
// paste one and he could not follow it, which was a fair verdict on the
// design rather than on him. This uses PKCE instead: the server invents a
// long random string, sends Dropbox only a one-way hash of it, and proves
// ownership later by producing the original. Nothing secret has to be
// carried by a person, typed into a form, or stored in settings.
//
// What is left for Chad is one code he already knows and one button. The
// app key is not a secret. It is a public identifier, the way a shop's
// street address is public while its safe combination is not, and it
// travels in the sign-in URL by design. It can be set once and remembered,
// passed in the page's own address, or held in settings.
//
// The refresh token is written straight into the journal store and is never
// shown on screen, never logged, and never sent anywhere.
const crypto = require('node:crypto');
const { defaultStore } = require('./mbf-store');

const SETUP_PATH = '/practice/mbf/connect-dropbox';
const START_PATH = '/practice/mbf/connect-dropbox/start';
const RETURN_PATH = '/practice/mbf/connect-dropbox/done';
const CHECK_PATH = '/practice/mbf/connect-dropbox/check';

// Held in memory between the redirect out to Dropbox and the return: the
// app key and the one-time verifier this sign-in will have to produce. If
// the server restarts in the middle, Chad presses the button again.
const pending = new Map();

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PKCE: a long random string, and the one-way hash of it that Dropbox is
// given up front. Only whoever holds the original can finish the sign-in,
// which is what an app secret used to prove.
function newVerifier() {
  return base64url(crypto.randomBytes(48));
}

function challengeFor(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// The app key, in order of preference: what a previous connection stored,
// then settings, then whatever the page's own address carried.
async function appKeyFor(store, fromUrl) {
  try {
    const doc = await store.load();
    if (doc && doc.dropbox && doc.dropbox.appKey) return doc.dropbox.appKey;
  } catch (error) {
    // A store that cannot be read falls through to the other two.
  }
  const configured = String(process.env.MBF_DROPBOX_APP_KEY || '').trim();
  if (configured) return configured;
  const given = String(fromUrl || '').trim();
  // A client identifier, nothing more. Checked only so that a stray query
  // string cannot put arbitrary text into the sign-in URL.
  return /^[A-Za-z0-9_-]{5,64}$/.test(given) ? given : '';
}

function adminCode() {
  // The same admin code Chad already uses for the course dashboard, so
  // there is not a second one to keep. MBF_ADMIN_CODE overrides it if he
  // ever wants this one separate.
  return String(process.env.MBF_ADMIN_CODE || process.env.COMPANION_ADMIN_CODE || '').trim();
}

function adminOk(supplied) {
  const expected = adminCode();
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(supplied || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function baseUrl(req) {
  const configured = String(process.env.MBF_BASE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'practice.herstwellness.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + host;
}

function page(title, inner) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#F4EDE4;color:#2A1D10;font:20px/1.65 Georgia,serif}
main{max-width:680px;margin:0 auto;padding:44px 20px 80px}
h1{font-size:32px;line-height:1.2;margin:0 0 16px}
h2{font-size:23px;margin:32px 0 10px}
p,li{margin:0 0 14px}
ol{padding-left:24px}
code{background:#EFE6D8;padding:2px 7px;border-radius:5px;font:16px/1.5 ui-monospace,Menlo,monospace;word-break:break-all}
label{display:block;font-weight:700;font-size:18px;margin:18px 0 6px}
input{width:100%;border:2px solid #A98F6B;border-radius:10px;background:#FFFDF9;color:#2A1D10;padding:14px 15px;font:18px/1.5 -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif}
button{border:2px solid #7A5C14;background:#7A5C14;color:#fff;border-radius:999px;padding:13px 26px;font:700 17px/1 Georgia,serif;cursor:pointer;margin-top:20px}
:focus-visible{outline:3px solid #7A5C14;outline-offset:2px}
.ok{background:#E3EADA;border-left:4px solid #4A6B33;padding:16px 18px;margin:20px 0}
.bad{background:#F1DDD7;border-left:4px solid #7C2620;padding:16px 18px;margin:20px 0}
.note{background:#FBF7F0;border:1px solid #C9B69D;border-radius:12px;padding:18px 20px;margin:20px 0;font-size:18px}
a{color:#7A5C14}
</style>
</head>
<body><main>${inner}</main></body>
</html>`;
}

function setupPage(req, { message, appKey, connectedAt } = {}) {
  const ready = Boolean(appKey);
  const already = connectedAt
    ? '<div class="ok"><p>Dropbox is already connected. You only need to do this again if you disconnect it.</p></div>'
    : '';
  const body = ready
    ? `${already}
<p>Press the button. Dropbox will ask whether Herst Wellness Journals may see and edit your files. Say yes, and it brings you straight back here.</p>
<form method="POST" action="${START_PATH}">
  <input type="hidden" name="key" value="${esc(appKey)}">
  <label for="admin">Your admin code</label>
  <input id="admin" name="admin" type="password" autocomplete="off" required autofocus>
  <button type="submit">Connect Dropbox</button>
</form>
<div class="note"><p>That is the whole thing. There is no key or secret to find, copy, or paste. Nothing is saved to your computer and nothing is shown on screen.</p></div>`
    : `<div class="bad"><p>This page does not know which Dropbox app to use yet. Chad, you should have been sent a link with the app key already in it. Use that link rather than this page on its own.</p></div>`;
  return page(
    'Connect Dropbox',
    `<h1>Connect Dropbox</h1>
<p>This lets your clients' journals write themselves into your own Dropbox folders. It is a one-time thing.</p>
${message || ''}
${body}`
  );
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 20000) {
        reject(new Error('Too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      const params = new URLSearchParams(raw);
      const out = {};
      for (const [k, v] of params) out[k] = v;
      resolve(out);
    });
    req.on('error', reject);
  });
}

async function exchangeCode({ code, appKey, verifier, redirectUri }, fetchImpl = fetch) {
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    client_id: appKey,
    code_verifier: verifier,
  });
  const response = await fetchImpl('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) throw new Error('Dropbox would not complete the connection.');
  const data = await response.json();
  if (!data || !data.refresh_token) throw new Error('Dropbox did not return a lasting key.');
  return data.refresh_token;
}

async function saveCredentials(store, { appKey, refreshToken, account }) {
  await store.update((doc) => {
    doc.dropbox = {
      appKey,
      refreshToken,
      account: account || null,
      connectedAt: new Date().toISOString(),
    };
    return doc;
  });
}

// Read back at request time so a connection made through this page works
// without a restart, and without the keys ever passing through settings.
let cached = null;
async function loadCredentials(store = defaultStore()) {
  if (cached) return cached;
  try {
    const doc = await store.load();
    cached = doc && doc.dropbox && doc.dropbox.refreshToken ? doc.dropbox : null;
  } catch (error) {
    cached = null;
  }
  return cached;
}

function forgetCachedCredentials() {
  cached = null;
}

async function handleDropboxSetupRoute(req, res, { store = defaultStore(), fetchImpl = fetch } = {}) {
  const url = String(req.url || '').split('?')[0];
  const query = new URLSearchParams(String(req.url || '').split('?')[1] || '');

  if (url === SETUP_PATH && req.method === 'GET') {
    const appKey = await appKeyFor(store, query.get('key'));
    const existing = await loadCredentials(store);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(setupPage(req, { appKey, connectedAt: existing ? existing.connectedAt : null }));
    return true;
  }

  if (url === START_PATH && req.method === 'POST') {
    const form = await readForm(req).catch(() => ({}));
    const appKey = await appKeyFor(store, form.key);
    if (!adminOk(form.admin)) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(setupPage(req, { message: '<div class="bad"><p>That admin code did not match. Try it again.</p></div>', appKey }));
      return true;
    }
    if (!appKey) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(setupPage(req, { appKey: '' }));
      return true;
    }
    const state = crypto.randomBytes(16).toString('hex');
    const verifier = newVerifier();
    pending.set(state, { appKey, verifier, at: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60 * 1000) pending.delete(k);
    const redirectUri = baseUrl(req) + RETURN_PATH;
    const authorize =
      'https://www.dropbox.com/oauth2/authorize?' +
      new URLSearchParams({
        client_id: appKey,
        response_type: 'code',
        redirect_uri: redirectUri,
        token_access_type: 'offline',
        code_challenge: challengeFor(verifier),
        code_challenge_method: 'S256',
        state,
      }).toString();
    res.writeHead(302, { Location: authorize, 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }

  if (url === RETURN_PATH && req.method === 'GET') {
    const state = query.get('state') || '';
    const code = query.get('code') || '';
    const entry = pending.get(state);
    pending.delete(state);
    if (!entry || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        page(
          'Connect Dropbox',
          '<h1>That did not finish</h1><p>Dropbox came back without the approval, or too much time passed. Nothing was changed.</p><p><a href="' +
            SETUP_PATH +
            '">Start again</a></p>'
        )
      );
      return true;
    }
    try {
      const refreshToken = await exchangeCode(
        { code, appKey: entry.appKey, verifier: entry.verifier, redirectUri: baseUrl(req) + RETURN_PATH },
        fetchImpl
      );
      await saveCredentials(store, { appKey: entry.appKey, refreshToken });
      forgetCachedCredentials();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        page(
          'Dropbox connected',
          '<h1>Dropbox is connected</h1><div class="ok"><p>From now on, whatever a client writes in their journal appears in their own folder in your Dropbox, and keeps up to date as they write. You do not have to do anything else.</p></div>' +
            '<p>If you ever want to cut the connection, remove the app from <a href="https://www.dropbox.com/account/connected_apps" rel="noopener">your connected apps</a> in Dropbox. The pages keep working; journals just stop appearing in the folders.</p>'
        )
      );
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        page(
          'Connect Dropbox',
          '<h1>Dropbox refused</h1><p>' +
            esc(error.message || 'It did not complete.') +
            '</p><p>The commonest cause is that the redirect address on the Dropbox app page does not match exactly. Check it and try again.</p><p><a href="' +
            SETUP_PATH +
            '">Start again</a></p>'
        )
      );
    }
    return true;
  }

  if (url === CHECK_PATH && req.method === 'GET') {
    if (!adminOk(query.get('admin'))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"no"}');
      return true;
    }
    const creds = await loadCredentials(store);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ connected: Boolean(creds), connectedAt: creds ? creds.connectedAt : null }));
    return true;
  }

  return false;
}

module.exports = {
  handleDropboxSetupRoute,
  loadCredentials,
  forgetCachedCredentials,
  exchangeCode,
  SETUP_PATH,
  RETURN_PATH,
};
