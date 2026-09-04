// The book-bonus page the printed book promises at
// herstwellness.com/book-bonus (Chad maps that URL here from Squarespace).
// Copy follows docs/book-bonus-page.md in the book repo: nothing gated,
// honest about which recordings exist yet, the course as the featured next
// step, one line for the one-on-one work. The email form is an invitation,
// not a gate.
const https = require('https');
const crypto = require('crypto');
const { ONE_PAGERS, ONE_PAGER_BY_SLUG, onePagerPageHtml } = require('./book-onepagers.js');

const BONUS_PATH = '/book-bonus';
const ONE_PAGER_PREFIX = '/book-bonus/one-pagers/';

// SENSE full walk-through, recorded 9/1/26. Served from the same public R2
// bucket as the audiobook pages (AUDIO_BASE_URL in server.js) because R2
// honors range requests, so a listener can scrub inside a 16-minute track;
// the local /audio/ static route sends the whole file and cannot.
const SENSE_AUDIO_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/sense-full-practice.mp3';

// The bucket the SENSE recording streams from. Named separately because the
// Content-Security-Policy below has to list it on media-src: if it is missing
// there, the browser refuses the audio and the player sits silent with no
// error message anywhere. Same shape of failure as the analytics one this
// page's tag was added to fix.
const AUDIO_HOST = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev';

// This is the address printed inside the book, so arrivals here are the ones
// that matter most in October, and an arrival that is not counted on the day
// cannot be recovered afterwards. The property is the same one the rest of the
// site and /listen/chapter-one report to.
const GA_MEASUREMENT_ID = 'G-RGBQ9JX82L';

// The Google tag, in the two halves the browser needs: the loader from
// googletagmanager (allowed by name on script-src) and an inline config block
// (allowed by the per-request nonce). Both must be permitted or the page looks
// instrumented and measures nothing.
function analyticsHead(nonce) {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script nonce="${nonce}">
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_MEASUREMENT_ID}');
</script>`;
}

// A fresh nonce per request, never reused, matching /listen/chapter-one. These
// pages are sent with Cache-Control: no-store, so a cached body can never be
// replayed against a newer header's nonce.
function newNonce() {
  return crypto.randomBytes(16).toString('base64');
}

function pageHeaders(nonce) {
  return {
    ...noStoreHeaders('text/html; charset=utf-8'),
    // Two deliberate choices here, both learned the hard way elsewhere in this
    // repo:
    //
    // connect-src lists the bare host https://analytics.google.com as well as
    // the wildcard. GA4 sends its page_view to https://analytics.google.com/g/collect
    // and a wildcard does not match a bare domain, so without this the tag
    // loads, reports nothing, and looks fine. stats.g.doubleclick.net and
    // www.google.com/g/collect stay blocked on purpose: those are Google
    // Signals advertising pings, not measurement.
    //
    // style-src takes 'unsafe-inline' rather than the nonce used on
    // /listen/chapter-one. This page carries eight inline style attributes
    // (the two audio players' full width, heading and button spacing), and a
    // nonce cannot authorize a style attribute, only a <style> block. A
    // nonce here would silently drop that styling instead of erroring. Styles
    // on this page hold nothing executable and no visitor-supplied content,
    // so the protection that matters, script-src, stays strict.
    'Content-Security-Policy': [
      `default-src 'self'`,
      `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' https://fonts.gstatic.com`,
      `img-src 'self' data:`,
      `media-src 'self' ${AUDIO_HOST}`,
      `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://analytics.google.com`,
      `frame-src 'none'`,
      `frame-ancestors 'none'`,
      `base-uri 'none'`,
      `form-action 'self'`,
    ].join('; '),
  };
}

function noStoreHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
}

function bonusPage(nonce) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The practices, in one place | The Performance Trap</title>
${analyticsHead(nonce)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
:root{--cream:#F4EDE4;--paper:#FBF7F0;--ink:#352515;--gold:#8B6B1E;--line:#D7C7B3;--soft:#EFE6D8}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;line-height:1.6}
.shell{width:min(720px,calc(100% - 28px));margin:0 auto;padding:44px 0 80px}
h1{font-family:'Playfair Display',Georgia,serif;font-size:clamp(30px,5vw,42px);margin:0 0 6px}
h2{font-family:'Playfair Display',Georgia,serif;font-size:23px;margin:34px 0 8px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:24px 26px;margin:0 0 20px}
.small{font:14px/1.5 Arial,sans-serif;color:#715D49}
.soon{padding:12px 16px;background:var(--soft);border-left:3px solid var(--gold);font:14px/1.55 Arial,sans-serif;margin:10px 0}
.button{display:inline-block;border:1px solid var(--gold);background:var(--gold);color:#fff;border-radius:999px;padding:12px 22px;font:600 14px/1 Arial,sans-serif;cursor:pointer;text-decoration:none}
input{border:1px solid #BCA88E;border-radius:10px;background:#FFFDF9;color:var(--ink);padding:12px 14px;font:16px/1.4 Arial,sans-serif;width:100%;max-width:340px}
a{color:var(--gold)}
ul li{margin-bottom:8px}
.footer{text-align:center;margin:26px auto 0;color:#78644F;font:13px/1.5 Arial,sans-serif}
</style>
</head>
<body>
<main class="shell">
  <h1>The practices, in one place.</h1>
  <p>If you're here, you've probably read the book, or you're somewhere in the middle of it. Either way, welcome. This page holds the tools from Part Two so you don't have to flip back through chapters to find them.</p>
  <p>Everything here is free. No forms, no catch.</p>

  <div class="card">
    <h2 style="margin-top:0">The field guide</h2>
    <p>The appendix from the book as a PDF. SENSE, STEP, and the two-minute versions of both. Print it if that helps. Some people keep it in a desk drawer.</p>
    <p><a class="button" href="/downloads/practices-in-one-place.pdf">Download the practices PDF</a></p>
  </div>

  <div class="card">
    <h2 style="margin-top:0">The guided audios</h2>
    <p>Reading a practice and doing one are different things. These are me walking you through it, so you can close your eyes and follow along.</p>
    <p><strong>The breathing practice.</strong> Twelve minutes. The straw breath, and coming back to the body.</p>
    <audio controls preload="none" src="/audio/onramp-breath-12min.mp3" style="width:100%"></audio>
    <p><strong>SENSE, the full practice.</strong> Sixteen minutes. Slowing the breath, entering the body, naming, staying, equanimity.</p>
    <audio controls preload="none" src="${SENSE_AUDIO_URL}" style="width:100%"></audio>
    <div class="soon">The rest are being recorded and will appear here as they're ready: STEP, for the moment after contact. The two-minute straw breath. And one for the inner critic, for when the voice sounds like the truth.</div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">The one-pagers</h2>
    <p>Each Part Two practice on a single page. Where it fits, when it hits, and the steps. These are for the moment itself, not for study.</p>
    <ul>
      ${ONE_PAGERS.map((p) => `<li><a href="${ONE_PAGER_PREFIX}${p.slug}">${p.title}</a></li>`).join('\n      ')}
    </ul>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Want these in your inbox?</h2>
    <p>I can send you the audios and the one-pagers as they're ready, so you don't have to remember this URL. You'll also get my newsletter: short stories that hopefully help remind you who you were before the performance.</p>
    <p>If it's not yours, absolutely no problem. Just unsubscribe.</p>
    <p><input id="bonusEmail" type="email" placeholder="Your email" aria-label="Your email"> <button id="bonusSignup" class="button" style="margin-top:10px">Send them to me</button></p>
    <p id="bonusSignupNote" class="small"></p>
  </div>

  <div class="card">
    <h2 style="margin-top:0">If you want to go further</h2>
    <p>The book shows you the pattern. These practices help you meet it. And some people want more than that. They want help staying with what they found long enough for something to change.</p>
    <p>That's <a href="/course/on-ramp">The Performance Trap Practice</a>: four weeks, about ten minutes a day, one real moment a day, with a written practice companion that works with what you bring, and a private session with me at the end. It costs a fraction of working with me one-on-one.</p>
    <p>And if you already know you want to work with me directly, that's <a href="https://herstwellness.com/mind-body-foundations">Mind/Body Foundations</a>. Bi-weekly sessions, built around what's alive in you.</p>
  </div>

  <p>That's the whole page. Take the tools. Use them badly at first. That's how it goes.</p>
  <div class="footer">Herst Wellness</div>
</main>
<script nonce="${nonce}">
document.getElementById('bonusSignup').addEventListener('click', async function(){
  var note = document.getElementById('bonusSignupNote');
  var email = document.getElementById('bonusEmail').value.trim();
  if (!email || email.indexOf('@') < 0) { note.textContent = 'Enter your email address.'; return; }
  this.disabled = true;
  try {
    var res = await fetch('/book-bonus-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) });
    if (!res.ok) throw new Error();
    note.textContent = "You're on the list. The tools above are yours either way.";
  } catch (e) {
    note.textContent = 'That did not go through. Try again, or reach out through herstwellness.com.';
    this.disabled = false;
  }
});
</script>
</body>
</html>`;
}

function handleBonusRoute(req, res, helpers) {
  if (req.method === 'GET' && req.url === BONUS_PATH) {
    const nonce = newNonce();
    res.writeHead(200, pageHeaders(nonce));
    res.end(bonusPage(nonce));
    return true;
  }

  if (req.method === 'GET' && req.url.startsWith(ONE_PAGER_PREFIX)) {
    const slug = req.url.slice(ONE_PAGER_PREFIX.length);
    const page = ONE_PAGER_BY_SLUG[slug];
    if (!page) {
      res.writeHead(404, noStoreHeaders('text/plain; charset=utf-8'));
      res.end('Not found');
      return true;
    }
    const nonce = newNonce();
    res.writeHead(200, pageHeaders(nonce));
    res.end(onePagerPageHtml(page, analyticsHead(nonce)));
    return true;
  }

  if (req.method === 'POST' && req.url === '/book-bonus-signup') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body || '{}');
        if (!email || !email.includes('@')) {
          res.writeHead(400, noStoreHeaders('application/json'));
          res.end(JSON.stringify({ error: 'Invalid email' }));
          return;
        }
        await helpers.addToMailchimp(email, '');
        helpers.tagSubscriber(email, 'Book Bonus');
        res.writeHead(200, noStoreHeaders('application/json'));
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error('Book bonus signup error:', e.message);
        res.writeHead(500, noStoreHeaders('application/json'));
        res.end(JSON.stringify({ error: 'Signup failed' }));
      }
    });
    return true;
  }

  return false;
}

module.exports = { BONUS_PATH, handleBonusRoute };
