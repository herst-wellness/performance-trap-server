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
const BASE_URL = 'https://practice.herstwellness.com';
const ONE_PAGER_PREFIX = '/book-bonus/one-pagers/';

// SENSE full walk-through, recorded 9/1/26. Served from the same public R2
// bucket as the audiobook pages (AUDIO_BASE_URL in server.js) because R2
// honors range requests, so a listener can scrub inside a 16-minute track;
// the local /audio/ static route sends the whole file and cannot.
const SENSE_AUDIO_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/sense-full-practice.mp3';

// The straw breath as a daily practice, recorded 9/7/26. Sixteen minutes, and
// the only one on this page that sets a breathing rhythm and then holds the
// listener in it, so it is the one people are most likely to scrub around in.
// Same R2 bucket and the same reason: range requests.
const STRAW_AUDIO_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/straw-breath-daily.mp3';

// STEP, recorded 9/4/26 and spaced to sixteen minutes on 9/7/26. The one that
// follows a real moment with a real person, so it asks more of the listener
// than the others and holds the longest silences on this page.
const STEP_AUDIO_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/step-full-practice.mp3';

// The inner critic, recorded 9/7/26. It goes furthest of the four: it ends by
// turning toward the part of the listener that has been taking the criticism,
// so its copy says that plainly rather than selling it as relief.
const CRITIC_AUDIO_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/inner-critic-full-practice.mp3';

// The short straw breath and The Ache, both recorded 9/7/26. The short one is
// the in-the-moment version: pause, find the sensation, name it, three breaths.
// The Ache is the book's central subject and the longest piece here.
const STRAW_SHORT_AUDIO_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/straw-breath-short.mp3';
const ACHE_AUDIO_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/the-ache.mp3';

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
    // /listen/chapter-one. This page carries a handful of inline style
    // attributes (masthead and button spacing), and a
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

// The seven guided audios, in the order they appear. `moment` is the first
// thing a reader sees: the situation the audio is for, in their words rather
// than the method's name. `id` is the jump-link anchor and the localStorage key.
const AUDIOS = [
  { id: 'straw-short',   title: 'The straw breath, short version', moment: 'For the middle of a day.', length: 'Three and a half minutes.', src: STRAW_SHORT_AUDIO_URL,
    copy: 'Pause, find what\'s happening in the belly, give it one word, three breaths. Then back to what you were doing.' },
  { id: 'straw-daily',   title: 'The straw breath, the daily practice', moment: 'For the morning, before the day pulls on you.', length: 'Sixteen minutes.', src: STRAW_AUDIO_URL,
    copy: 'I count you into five in and seven out, then leave you in it.' },
  { id: 'breathing',     title: 'The breathing practice', moment: 'The straw breath, and coming back to the body.', length: 'Twelve minutes.', src: '/audio/onramp-breath-12min.mp3',
    copy: '' },
  { id: 'sense',         title: 'SENSE, the full practice', moment: 'For when something is up and you don\'t know what it is yet.', length: 'Sixteen minutes.', src: SENSE_AUDIO_URL,
    copy: 'Slowing the breath, entering the body, naming, staying, equanimity.' },
  { id: 'step',          title: 'STEP, the full practice', moment: 'For after you went quiet or small around someone.', length: 'Sixteen minutes.', src: STEP_AUDIO_URL,
    copy: 'Bring to mind a moment you went quiet or small around someone, get still, find the trade you were about to make, and find the option that isn\'t say it or swallow it.' },
  { id: 'inner-critic',  title: 'The inner critic', moment: 'For when the voice sounds like the truth.', length: 'Sixteen minutes.', src: CRITIC_AUDIO_URL,
    copy: 'What it thinks you have to become to deserve love, what it\'s protecting, and the part of you that\'s been taking it.' },
  { id: 'the-ache',      title: 'The Ache', moment: 'For the thing you\'ve been getting around.', length: 'Twenty minutes.', src: ACHE_AUDIO_URL,
    copy: 'The one the book is named for. Twenty minutes of not getting around it, with a question first about whether today is the day.' },
];

// Where the review ask points. Amazon and Goodreads links cannot carry a
// source tag, so these stay plain. The ASIN is the Kindle record; Amazon's
// review form accepts it for every format of the same book.
const AMAZON_REVIEW_URL = 'https://www.amazon.com/review/create-review?asin=B0GX32LDSQ';
const GOODREADS_URL = 'https://www.goodreads.com/book/show/254670204-the-performance-trap';

function audioBlock(a) {
  return `    <div class="track" id="${a.id}">
      <p class="moment"><strong>${a.title}.</strong> ${a.moment} ${a.length}${a.copy ? ' ' + a.copy : ''}</p>
      <audio controls preload="none" data-key="${a.id}" src="${a.src}"></audio>
      <p class="small"><a href="${a.src}" download>Download</a> to keep it on your phone.</p>
    </div>`;
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
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@500&display=swap" rel="stylesheet">
<style>
/* The palette and type are the brand brief's, docs/13-design-brief.md in the
   book repo: one warm serif for everything a person reads, a sans only for
   tiny markers and buttons, rust as the single accent, paper on tan, warm
   brown-black ink and never pure black. */
:root{--tan:#efe9e0;--paper:#faf7f2;--ink:#1f1c1a;--body:#2a2724;--rust:#8b3a2a;--smoke:#8a847f;--line:#dcd3c6}
*{box-sizing:border-box}
body{margin:0;background:var(--tan);color:var(--body);font-family:'EB Garamond',Georgia,serif;font-size:19px;line-height:1.6}
.shell{width:min(720px,calc(100% - 28px));margin:0 auto;padding:44px 0 80px}
h1,h2{font-family:'EB Garamond',Georgia,serif;color:var(--ink);font-weight:600}
h1{font-size:clamp(32px,5vw,44px);line-height:1.15;margin:0 0 6px}
h2{font-size:24px;margin:0 0 8px}
.masthead{display:flex;gap:22px;align-items:flex-start;margin-bottom:6px}
.masthead img{width:96px;height:auto;flex:0 0 96px;border:1px solid var(--line)}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:24px 26px;margin:0 0 20px}
.eyebrow{font:500 12px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--smoke);margin:0 0 10px}
.small{font-size:15px;color:var(--smoke);margin:4px 0 0}
.jump{font-size:16px;color:var(--smoke);margin:0 0 18px;line-height:1.9}
.jump a{white-space:nowrap}
.track{padding:16px 0;border-top:1px solid var(--line)}
.track:first-of-type{border-top:0}
.moment{margin:0 0 8px}
audio{width:100%;display:block}
.button{display:inline-block;border:1px solid var(--rust);background:var(--rust);color:#faf7f2;border-radius:999px;padding:12px 22px;font:600 14px/1 Inter,Helvetica,Arial,sans-serif;cursor:pointer;text-decoration:none}
.button.quiet{background:transparent;color:var(--rust)}
input{border:1px solid #c9bda9;border-radius:10px;background:#fffdf9;color:var(--body);padding:12px 14px;font:16px/1.4 Georgia,serif;width:100%;max-width:340px}
a{color:var(--rust)}
em{color:var(--rust);font-style:italic}
ul li{margin-bottom:8px}
.footer{text-align:center;margin:26px auto 0;font:13px/1.5 Inter,Helvetica,Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase}
.footer a{color:var(--smoke);text-decoration:none}
@media (max-width:520px){.masthead{gap:16px}.masthead img{width:72px;flex-basis:72px}h2{font-size:22px}}
</style>
</head>
<body>
<main class="shell">
  <div class="masthead">
    <img src="/book-cover-bonus.jpg" alt="The Performance Trap, front cover" width="96">
    <div>
      <h1>The practices, in one place.</h1>
      <p style="margin:0">If you're here, you've probably read the book, or you're somewhere in the middle of it. Either way, welcome. This page holds the tools from Part Two so you don't have to flip back through chapters to find them.</p>
    </div>
  </div>
  <p>Everything here is free. No forms, no catch.</p>

  <div class="card">
    <p class="eyebrow">Listen</p>
    <h2>The guided audios</h2>
    <p>Reading a practice and doing one are different things. These are me walking you through it, so you can close your eyes and follow along. If you don't know where to start: the short straw breath if you have three minutes, SENSE if you have sixteen.</p>
    <p class="jump">Jump to: ${AUDIOS.map((a) => `<a href="#${a.id}">${a.title.replace(', the daily practice', ' (daily)').replace(', short version', ' (short)').replace(', the full practice', '')}</a>`).join(' · ')}</p>
    <p class="small">Each one can be downloaded, so you can listen without a signal. The players remember where you stopped.</p>
${AUDIOS.map(audioBlock).join('\n')}
  </div>

  <div class="card">
    <p class="eyebrow">Read</p>
    <h2>The one-pagers</h2>
    <p>Each Part Two practice on a single page. Where it fits, when it hits, and the steps. These are for the moment itself, not for study.</p>
    <ul>
      ${ONE_PAGERS.map((p) => `<li><a href="${ONE_PAGER_PREFIX}${p.slug}">${p.title}</a></li>`).join('\n      ')}
    </ul>
  </div>

  <div class="card">
    <p class="eyebrow">Print</p>
    <h2>The field guide</h2>
    <p>The appendix from the book as a PDF. SENSE, STEP, and the short versions of both. Print it if that helps. Some people keep it in a desk drawer.</p>
    <p><a class="button" href="/downloads/practices-in-one-place.pdf">Download the practices PDF</a></p>
  </div>

  <div class="card">
    <p class="eyebrow">One ask</p>
    <h2>If the book helped</h2>
    <p>A short review on Amazon or Goodreads is what lets the next person like you find it. A sentence or two about what it was like to read is plenty.</p>
    <p><a class="button" href="${AMAZON_REVIEW_URL}">Review it on Amazon</a> <a class="button quiet" href="${GOODREADS_URL}" style="margin-left:8px">Or on Goodreads</a></p>
  </div>

  <div class="card">
    <p class="eyebrow">Keep them</p>
    <h2>Want these in your inbox?</h2>
    <p>I'll send you one email with all seven audios and the five one-pagers as links, so you have them on your phone and don't have to remember this address. You'll also get my newsletter: short stories that hopefully help remind you who you were before the performance.</p>
    <p>If it's not yours, absolutely no problem. Just unsubscribe.</p>
    <p><input id="bonusEmail" type="email" placeholder="Your email" aria-label="Your email"> <button id="bonusSignup" class="button" style="margin-top:10px">Send them to me</button></p>
    <p id="bonusSignupNote" class="small"></p>
  </div>

  <div class="card">
    <p class="eyebrow">Go further</p>
    <h2>If you want to go further</h2>
    <p>The book shows you the pattern. These practices help you meet it. And some people want more than that. They want help staying with what they found long enough for something to change.</p>
    <p>That's <a href="/course/on-ramp?source=book-bonus">The Performance Trap Practice</a>: four weeks, about ten minutes a day, one real moment a day, with a written practice companion that works with what you bring, and a private session with me at the end.</p>
    <p>I'm also thinking about running it as a group. If doing this alongside a few other people interests you, this is the list I'll write to first.</p>
    <p><input id="cohortEmail" type="email" placeholder="Your email" aria-label="Your email for the cohort list"> <button id="cohortSignup" class="button" style="margin-top:10px">Tell me when a cohort forms</button></p>
    <p id="cohortSignupNote" class="small"></p>
    <p>And if you already know you want to work with me directly, that's <a href="https://herstwellness.com/mind-body-foundations">Mind/Body Foundations</a>. Bi-weekly sessions, built around what's alive in you.</p>
  </div>

  <p>That's the whole page. Take the tools. Use them badly at first. That's how it goes.</p>
  <div class="footer"><a href="https://herstwellness.com">Herst Wellness</a></div>
</main>
<script nonce="${nonce}">
(function(){
  function wire(inputId, buttonId, noteId, path, done){
    document.getElementById(buttonId).addEventListener('click', async function(){
      var note = document.getElementById(noteId);
      var email = document.getElementById(inputId).value.trim();
      if (!email || email.indexOf('@') < 0) { note.textContent = 'Enter your email address.'; return; }
      this.disabled = true;
      try {
        var res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) });
        if (!res.ok) throw new Error();
        note.textContent = done;
      } catch (e) {
        note.textContent = 'That did not go through. Try again, or reach out through herstwellness.com.';
        this.disabled = false;
      }
    });
  }
  wire('bonusEmail', 'bonusSignup', 'bonusSignupNote', '/book-bonus-signup', "Sent. Check your inbox in a minute. The tools above are yours either way.");
  wire('cohortEmail', 'cohortSignup', 'cohortSignupNote', '/cohort-interest', "You're on the list. I'll write when there's something to say.");

  // These are sixteen to twenty minute meditations and people stop halfway.
  // Remember where each one was, per track, in this browser only. Storage can
  // be absent or throw (private windows, blocked site data), so every touch is
  // guarded and the page works the same with nothing stored.
  var players = document.querySelectorAll('audio[data-key]');
  for (var i = 0; i < players.length; i++) (function(p){
    var key = 'book-bonus:' + p.getAttribute('data-key');
    var t = 0;
    try { t = parseFloat(localStorage.getItem(key) || '0'); } catch (e) {}
    if (t > 5) p.addEventListener('loadedmetadata', function(){ if (t < p.duration - 5) p.currentTime = t; }, { once: true });
    p.addEventListener('timeupdate', function(){ try { if (p.currentTime > 5) localStorage.setItem(key, String(Math.floor(p.currentTime))); } catch (e) {} });
    p.addEventListener('ended', function(){ try { localStorage.removeItem(key); } catch (e) {} });
  })(players[i]);
})();
</script>
</body>
</html>`;
}

// The one email a signup earns: every link on the page, in Georgia and rust,
// no images, per the brand brief's rule for places custom fonts cannot load.
function welcomeEmailHtml() {
  const li = (href, text) => `<li style="margin:0 0 8px"><a href="${href}" style="color:#8b3a2a">${text}</a></li>`;
  return `<div style="font-family:Georgia,serif;font-size:17px;line-height:1.6;color:#2a2724;max-width:560px">
<p>Here they are, so you don't have to remember the address.</p>
<p><strong>The guided audios</strong></p>
<ul style="padding-left:20px">
${AUDIOS.map((a) => li(a.src.startsWith('/') ? BASE_URL + a.src : a.src, `${a.title}. ${a.moment} ${a.length}`)).join('\n')}
</ul>
<p><strong>The one-pagers</strong></p>
<ul style="padding-left:20px">
${ONE_PAGERS.map((p) => li(`${BASE_URL}${ONE_PAGER_PREFIX}${p.slug}`, p.title)).join('\n')}
</ul>
<p>The page itself is at <a href="${BASE_URL}/book-bonus" style="color:#8b3a2a">${BASE_URL.replace('https://', '')}/book-bonus</a>. Use them badly at first. That's how it goes.</p>
<p>Chad</p>
</div>`;
}

function cohortEmailHtml() {
  return `<div style="font-family:Georgia,serif;font-size:17px;line-height:1.6;color:#2a2724;max-width:560px">
<p>You're on the list. If I run The Performance Trap Practice as a group, you'll hear from me before anyone else does.</p>
<p>Chad</p>
</div>`;
}

const WELCOME_SUBJECT = 'The practices, in one place';
const COHORT_SUBJECT = 'When a cohort forms';

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

  // Both signups share one shape: validate, add to Mailchimp, tag, send one
  // email, answer. The tag call is fire-and-forget, as it always was; the
  // email is awaited so a Resend failure is logged, but it never fails the
  // signup, because the address is already on the list by then.
  const signups = {
    '/book-bonus-signup': { tags: ['Book Bonus'], subject: WELCOME_SUBJECT, html: welcomeEmailHtml },
    '/cohort-interest':   { tags: ['Cohort Interest', 'Book Bonus'], subject: COHORT_SUBJECT, html: cohortEmailHtml },
  };
  if (req.method === 'POST' && signups[req.url]) {
    const plan = signups[req.url];
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
        for (const tag of plan.tags) helpers.tagSubscriber(email, tag);
        if (helpers.sendEmail) {
          try { await helpers.sendEmail(email, plan.subject, plan.html()); }
          catch (e) { console.error('Book bonus email error:', e.message); }
        }
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

module.exports = { BONUS_PATH, handleBonusRoute, AUDIOS, welcomeEmailHtml, cohortEmailHtml };
