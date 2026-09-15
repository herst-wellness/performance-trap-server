// Reading pages for Mind/Body Foundations.
//
// The readings used to be PDFs in a Dropbox folder the client downloaded. They
// are pages now, behind the same access code as the journals, so that a client
// has one address for the whole programme rather than a folder for some of it
// and a link for the rest.
//
// Nothing here writes anything. A reading is text, it holds no client material,
// and there is no state to keep.
const { hasAccess } = require('./mbf-journal');
const { findReading, readingsForModule } = require('./mbf-reading-content');

const PAGE_ROUTE = /^\/practice\/mbf\/module-(\d)\/reading\/([a-z0-9-]+)$/;
const CONTENT_ROUTE = /^\/api\/mbf\/reading\/(\d)\/([a-z0-9-]+)$/;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Enough markdown for the chapters and no more: headings, paragraphs, lists,
// block quotes, bold, italic and links. Anything else in the source is prose.
function renderMarkdown(src) {
  const out = [];
  let list = null;
  const inline = (s) =>
    esc(s)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };

  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const n = Math.min(h[1].length + 1, 5); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (/^>\s?/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    const li = line.match(/^[-*]\s+(.*)$/);
    if (li) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (/^-{3,}$/.test(line.trim())) { closeList(); out.push('<hr>'); continue; }
    closeList();
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();
  return out.join('\n');
}

// The first heading is the page title, so it is dropped from the body to avoid
// printing the same line twice.
function bodyWithoutTitle(src) {
  return src.replace(/^#\s+.*$/m, '');
}

function readingPage(reading) {
  const others = readingsForModule(reading.module).filter((r) => r.slug !== reading.slug);
  const more = others.length
    ? '<nav class="more"><p class="label">The rest of this module</p><ul>' +
      others.map((r) => `<li><a href="/practice/mbf/module-${r.module}/reading/${r.slug}">${esc(r.title)}</a></li>`).join('') +
      '</ul></nav>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(reading.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; background:#FBF7EF; color:#4B4038;
         font-family:'Lora',Georgia,'Times New Roman',serif; font-size:19px; line-height:1.7; }
  .wrap { max-width:37rem; margin:0 auto; padding:2.5rem 1.25rem 5rem; }
  .eyebrow { font-size:0.7rem; letter-spacing:0.16em; text-transform:uppercase; color:#7C6C5C; margin:0 0 0.6rem; }
  h1 { font-size:1.9rem; line-height:1.25; margin:0 0 1.6rem; font-weight:600; }
  h2 { font-size:1.25rem; margin:2.2rem 0 0.7rem; font-weight:600; }
  h3 { font-size:1.05rem; margin:1.8rem 0 0.5rem; font-weight:600; }
  p { margin:0 0 1.1em; }
  blockquote { margin:1.4em 0; padding:0 0 0 1.1rem; border-left:2px solid #C4A879; color:#6B5036; font-style:italic; }
  ul { margin:0 0 1.2em; padding-left:1.3rem; } li { margin:0 0 0.45em; }
  hr { border:0; border-top:1px solid #C4A879; margin:2.4rem 0; }
  a { color:#7C6C5C; }
  .card { border:1px solid #C4A879; border-radius:10px; padding:1.1rem 1.25rem; background:#FDFBF6; }
  .card h2 { margin-top:0; }
  label { display:block; font-size:0.85rem; margin:0 0 0.35rem; color:#6B5036; }
  input { font:inherit; font-size:1rem; padding:0.55rem 0.7rem; width:100%; box-sizing:border-box;
          border:1px solid #C4A879; border-radius:7px; background:#fff; color:inherit; }
  button { font:inherit; font-size:1rem; margin-top:0.8rem; padding:0.55rem 1.1rem; cursor:pointer;
           border:1px solid #7C6C5C; border-radius:7px; background:#7C6C5C; color:#FBF7EF; }
  .err { color:#8A3B2E; margin:0.7rem 0 0; }
  .more { margin-top:3rem; padding-top:1.4rem; border-top:1px solid #C4A879; font-size:0.95rem; }
  .label { font-size:0.7rem; letter-spacing:0.16em; text-transform:uppercase; color:#7C6C5C; margin:0 0 0.5rem; }
  .more ul { list-style:none; padding:0; }
  .back { display:inline-block; margin-top:2rem; font-size:0.95rem; }
</style>
</head>
<body>
<div class="wrap">
  <section id="gate" class="card">
    <h2 id="gateHeading" tabindex="-1">Your access code</h2>
    <p>The same code you use for the journals.</p>
    <label for="code">Access code</label>
    <input id="code" type="password" autocomplete="off" spellcheck="false">
    <button id="unlock" type="button">Open</button>
    <p class="err" id="err" hidden></p>
  </section>

  <article id="reading" hidden>
    <p class="eyebrow">Module ${reading.module}${reading.practice ? ' &middot; practice' : ''}</p>
    <h1 id="title" tabindex="-1">${esc(reading.title)}</h1>
    <div id="body"></div>
    ${more}
    <p><a class="back" href="/practice/mbf">All of Mind/Body Foundations</a></p>
  </article>
</div>
<script>
(function(){
  var MODULE = ${reading.module}, SLUG = ${JSON.stringify(reading.slug)};
  var KEY = 'mbf-access';
  function el(id){ return document.getElementById(id); }
  function store(){ try { return window.localStorage; } catch(e) { return null; } }

  async function open(code){
    var response = await fetch('/api/mbf/reading/' + MODULE + '/' + SLUG, {
      headers: { 'X-Companion-Access': code }, cache: 'no-store'
    });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'That code did not work.');
    el('body').innerHTML = data.html;
    el('gate').hidden = true;
    el('reading').hidden = false;
    el('title').focus();
    var s = store(); if (s) { try { s.setItem(KEY, code); } catch(e) {} }
  }

  async function unlock(){
    var code = el('code').value.trim();
    if (!code) { el('err').hidden = false; el('err').textContent = 'Enter your code.'; return; }
    el('unlock').disabled = true;
    try { await open(code); }
    catch (error) { el('err').hidden = false; el('err').textContent = error.message; }
    finally { el('unlock').disabled = false; }
  }

  el('unlock').addEventListener('click', unlock);
  el('code').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); unlock(); } });

  // A reader who has already unlocked something in this browser should not be
  // asked again on every chapter. A stale code just falls back to the box.
  var s = store();
  var saved = s ? (function(){ try { return s.getItem(KEY); } catch(e) { return null; } })() : null;
  if (saved) { open(saved).catch(function(){}); }
})();
</script>
</body>
</html>`;
}

function handleMbfReadingRoute(req, res) {
  const page = PAGE_ROUTE.exec(req.url);
  if (page && req.method === 'GET') {
    const reading = findReading(page[1], page[2]);
    if (!reading) return false;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    res.end(readingPage(reading));
    return true;
  }

  const content = CONTENT_ROUTE.exec(req.url);
  if (content && req.method === 'GET') {
    const reading = findReading(content[1], content[2]);
    const body = JSON.stringify.bind(JSON);
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body(payload));
    };
    if (!reading) { send(404, { error: 'No such reading.' }); return true; }
    const access = hasAccess(req);
    if (!access.ok) {
      send(access.status, {
        error: access.status === 503 ? 'The readings are not open yet. Chad has not issued codes.' : 'That code did not work.',
      });
      return true;
    }
    send(200, { title: reading.title, html: renderMarkdown(bodyWithoutTitle(reading.body)) });
    return true;
  }

  return false;
}

module.exports = { handleMbfReadingRoute, renderMarkdown, readingPage };
