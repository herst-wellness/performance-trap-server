// The Mind/Body Foundations journals as web pages instead of PDFs.
//
// What changes for the client: no Dropbox link, no download, no word
// processor, no attachment, no email. They open one link, answer the same
// questions the PDF asks, typing or speaking, and press Send. Their work
// saves in their own browser as they go, so closing the tab loses nothing.
//
// What stays: the questions are verbatim from Chad's PDFs, and the PDF path
// is still there for anyone who prefers it. They download the document,
// fill it in, and upload it here rather than attaching it to an email.
//
// What Chad changed on 2026-09-13: the journal no longer waits for the
// client to press anything. The page saves to his storage as they write,
// and the ticker in mbf-schedule.js keeps a file in his Dropbox folder up
// to date with wherever they have got to. Pressing Finished still matters,
// it tells him the work is done and sends the client their own copy, but he
// no longer depends on it. The page says all of this in plain words before
// anyone writes a line.
//
// A structural sibling of mbf.js rather than an extension of it, for the
// same reason mbf.js is a sibling of onramp.js: the companion carries a
// deterministic safety layer that must stay independently readable, and
// this page never talks to a language model at all.
const fs = require('node:fs');
const path = require('node:path');
const { findJournal, journalsForModule } = require('./mbf-journal-content');
const { defaultStore, findRecord, upsertRecord } = require('./mbf-store');
const {
  deliverJournal,
  clientNameFromCode,
  dropboxConfigured,
  dropboxPath,
  safeSegment,
  uploadBytesToDropbox,
} = require('./mbf-delivery');

const MAX_BODY_BYTES = 400000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const PAGE_ROUTE = /^\/practice\/mbf\/module-(\d)\/journal\/([a-z0-9-]+)$/;
const CONTENT_ROUTE = /^\/api\/mbf\/journal\/(\d)\/([a-z0-9-]+)$/;
const SAVE_PATH = '/api/mbf/journal/save';
const SEND_PATH = '/api/mbf/journal/send';
const UPLOAD_PATH = '/api/mbf/journal/upload';

// ── Access, shared shape with mbf.js ────────────────────────────
const crypto = require('node:crypto');

function validAccessCodes() {
  const list = String(process.env.MBF_ACCESS_CODES || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const single = String(process.env.MBF_ACCESS_CODE || '').trim();
  if (single) list.push(single);
  return list;
}

function normalizeCode(s) {
  return String(s).trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function codeMatches(expected, supplied) {
  const a = Buffer.from(normalizeCode(expected));
  const b = Buffer.from(normalizeCode(supplied));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function suppliedCode(req) {
  return String(req.headers['x-companion-access'] || '');
}

function accessForCode(code) {
  const codes = validAccessCodes();
  if (codes.length === 0) return { ok: false, status: 503 };
  return { ok: codes.some((c) => codeMatches(c, code)), status: 401 };
}

function hasAccess(req) {
  return accessForCode(suppliedCode(req));
}

// ── Small helpers ───────────────────────────────────────────────
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function readBytes(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(new Error('Too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── The page ────────────────────────────────────────────────────
const STYLE = fs.existsSync(path.join(__dirname, 'mbf-journal.css'))
  ? fs.readFileSync(path.join(__dirname, 'mbf-journal.css'), 'utf8')
  : '';

function journalPage(moduleNumber, slug, journal) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${esc(journal.title)} | Mind/Body Foundations</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the journal</a>
<main class="shell" id="main">
  <div class="brand"><img src="/Herst-Wellness-Logo-cropped.jpg" alt="Herst Wellness"></div>
  <nav aria-label="Breadcrumb" class="crumbs"><a href="/practice/mbf">Mind/Body Foundations</a> &rsaquo; <span>Module ${esc(moduleNumber)}</span> &rsaquo; <span aria-current="page">${esc(journal.title)}</span></nav>
  <div class="rule"></div>

  <header class="hero">
    <p class="eyebrow">${esc(journal.kind)} ${esc(journal.code)} &middot; Module ${esc(moduleNumber)}</p>
    <h1>${esc(journal.title)}</h1>
    <p class="sub">${esc(journal.blurb)}</p>
  </header>

  <section id="accessCard" class="card" aria-labelledby="accessHeading">
    <h2 id="accessHeading">Your access code</h2>
    <p>Enter the code Chad gave you.</p>
    <div class="field">
      <label for="accessCode">Access code</label>
      <input id="accessCode" type="password" autocomplete="off" spellcheck="false">
    </div>
    <button id="unlockButton" class="button" type="button">Continue</button>
    <p id="accessError" class="error" role="alert" hidden></p>
  </section>

  <div id="journalWrap" hidden>
    <section class="card intro" id="introCard" aria-labelledby="introHeading">
      <h2 id="introHeading">Before you start</h2>
      <div id="introText"></div>
      <div id="audioSlot"></div>
      <p class="small">Your answers save as you type, both in this browser and to Chad's own files, so you can close this and come back, or start on one device and finish on another. You do not have to send anything. Chad can see wherever you have got to, and would rather have half of it than nothing.</p>
      <details class="alt">
        <summary>I would rather write in Word</summary>
        <p>That works. Download the document, write in it the way you always have, then bring it back here instead of attaching it to an email.</p>
        <p><a id="pdfLink" href="#">Download the document</a></p>
        <div class="field">
          <label for="uploadInput">Upload your finished document</label>
          <input id="uploadInput" type="file" accept=".doc,.docx,.pdf,.pages,.rtf,.txt,.md">
        </div>
        <button id="uploadButton" class="button secondary" type="button">Send this file to Chad</button>
        <p id="uploadStatus" class="status" role="status"></p>
      </details>
    </section>

    <div class="progress card" role="status" aria-live="polite">
      <p id="progressText">Nothing answered yet.</p>
      <p id="saveState" class="small"></p>
    </div>

    <form id="journalForm" novalidate></form>

    <section class="card send" aria-labelledby="sendHeading">
      <h2 id="sendHeading">When you are finished</h2>
      <p>Chad already has what you have written. This button tells him you are done with it, and sends you your own copy to keep, which is what later modules ask you to look back at.</p>
      <div class="field">
        <label for="clientEmail">Your email, for your own copy</label>
        <input id="clientEmail" type="email" autocomplete="email" spellcheck="false">
      </div>
      <div class="row">
        <button id="sendButton" class="button" type="button">I am finished with this journal</button>
        <button id="downloadButton" class="button secondary" type="button">Download a copy</button>
      </div>
      <p id="sendStatus" class="status" role="status"></p>
    </section>
  </div>

  <p class="footer">Mind/Body Foundations. What you write here is kept with the rest of your work in Chad's files, the same as the journals you used to email him. Nobody else sees it.</p>
</main>
<script>
(function(){
  var MODULE = ${JSON.stringify(String(moduleNumber))};
  var SLUG = ${JSON.stringify(slug)};
  var STORAGE_KEY = 'mbf-journal-' + MODULE + '-' + SLUG;
  var EMAIL_KEY = 'mbf-client-email';
  var journal = null;
  var accessCode = '';
  var answers = {};
  var saveTimer = null;
  var serverTimer = null;
  var serverState = 'idle';
  var recorder = null, micStream = null, chunks = [], listeningFor = null;

  function el(id){ return document.getElementById(id); }
  function store(){ try { return window.localStorage; } catch(e) { return null; } }

  function load(){
    var s = store(); if (!s) return;
    try { answers = JSON.parse(s.getItem(STORAGE_KEY) || '{}') || {}; } catch(e) { answers = {}; }
    try { var e2 = s.getItem(EMAIL_KEY); if (e2) el('clientEmail').value = e2; } catch(e) {}
  }

  function save(){
    var s = store(); if (!s) return;
    try { s.setItem(STORAGE_KEY, JSON.stringify(answers)); }
    catch(e) { saveState('This browser will not let the page save your place. Download a copy before you close the tab.'); }
  }

  function saveState(message){
    el('saveState').textContent = message;
  }

  // Two saves, on two clocks. The browser's own copy is instant and is what
  // protects against a closed tab. The copy on Chad's side follows a few
  // seconds later and is what means the client never has to send anything.
  async function saveToServer(){
    if (!journal) return;
    serverState = 'saving';
    try {
      var response = await fetch('${SAVE_PATH}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Companion-Access': accessCode },
        cache: 'no-store',
        body: JSON.stringify({ module: MODULE, slug: SLUG, answers: answers })
      });
      if (!response.ok) throw new Error('save failed');
      serverState = 'saved';
      saveState('Saved. Chad has this.');
    } catch (error) {
      serverState = 'offline';
      saveState('Saved on this device. It has not reached Chad yet, and will when you are back online.');
    }
  }

  function queueSave(){
    saveState('Saving.');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
    clearTimeout(serverTimer);
    serverTimer = setTimeout(saveToServer, 4000);
  }

  function counts(){
    var answered = 0, total = 0;
    journal.sections.forEach(function(sec){
      sec.prompts.forEach(function(p){
        total += 1;
        var a = answers[p.id];
        if (!a) return;
        if (p.kind === 'agree') { if (a.agree === true || a.agree === false) answered += 1; }
        else if (String(a.text || '').trim()) answered += 1;
      });
    });
    return { answered: answered, total: total };
  }

  function updateProgress(){
    var c = counts();
    el('progressText').textContent = c.answered === 0
      ? 'Nothing answered yet. There are ' + c.total + ' questions.'
      : c.answered + ' of ' + c.total + ' answered.';
  }

  function speakSupported(){
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function statusFor(id, message){
    var node = el('speak-status-' + id);
    if (node) node.textContent = message || '';
  }

  function releaseMic(){
    if (micStream) { micStream.getTracks().forEach(function(t){ t.stop(); }); micStream = null; }
    recorder = null;
  }

  function stopListening(){
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch(e) { releaseMic(); } }
  }

  async function transcribe(id){
    var parts = chunks; chunks = [];
    if (!parts.length) { statusFor(id, ''); return; }
    var blob = new Blob(parts, { type: parts[0].type || 'audio/webm' });
    if (!blob.size) { statusFor(id, ''); return; }
    statusFor(id, 'Turning that into words.');
    try {
      var response = await fetch('/api/mbf/transcribe', {
        method: 'POST',
        headers: { 'X-Companion-Access': accessCode, 'Content-Type': blob.type },
        cache: 'no-store',
        body: blob
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Transcription failed');
      var text = String(data.text || '').trim();
      if (!text) { statusFor(id, 'I did not catch anything. Press Speak and try again, or just type.'); return; }
      var box = el('input-' + id);
      box.value = box.value.trim() ? box.value.trim() + ' ' + text : text;
      box.dispatchEvent(new Event('input'));
      statusFor(id, 'Added. Change anything you want.');
      box.focus();
    } catch (error) {
      statusFor(id, 'That did not come through. Press Speak to try again, or just type.');
    }
  }

  async function toggleSpeak(id, button){
    if (listeningFor === id) { stopListening(); return; }
    if (listeningFor) { stopListening(); return; }
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch(e) { statusFor(id, 'Your browser is not letting the microphone through. Allow it in the address bar, or just type.'); return; }
    chunks = [];
    try { recorder = new MediaRecorder(micStream); }
    catch(e) { releaseMic(); statusFor(id, 'Recording is not working in this browser. You can type instead.'); return; }
    recorder.addEventListener('dataavailable', function(ev){ if (ev.data && ev.data.size) chunks.push(ev.data); });
    recorder.addEventListener('stop', function(){
      releaseMic();
      listeningFor = null;
      button.textContent = 'Speak';
      button.setAttribute('aria-pressed', 'false');
      button.classList.remove('speaking');
      transcribe(id);
    });
    listeningFor = id;
    button.textContent = 'Stop speaking';
    button.setAttribute('aria-pressed', 'true');
    button.classList.add('speaking');
    statusFor(id, 'Listening. Take your time, then press Stop speaking.');
    try { recorder.start(); }
    catch(e) { releaseMic(); listeningFor = null; button.textContent = 'Speak'; statusFor(id, 'Recording is not working in this browser. You can type instead.'); }
  }

  function renderPrompt(p){
    var wrap = document.createElement('div');
    wrap.className = 'prompt';
    var saved = answers[p.id] || {};

    if (p.kind === 'agree') {
      var fs = document.createElement('fieldset');
      var lg = document.createElement('legend');
      lg.textContent = p.label;
      fs.appendChild(lg);
      var q = document.createElement('p');
      q.className = 'question';
      q.textContent = p.text;
      fs.appendChild(q);
      var row = document.createElement('div');
      row.className = 'row choices';
      [['Yes', true], ['No', false]].forEach(function(pair){
        var id = 'agree-' + p.id + '-' + (pair[1] ? 'yes' : 'no');
        var lbl = document.createElement('label');
        lbl.className = 'choice';
        lbl.setAttribute('for', id);
        var input = document.createElement('input');
        input.type = 'radio'; input.name = 'agree-' + p.id; input.id = id;
        input.checked = saved.agree === pair[1];
        input.addEventListener('change', function(){
          answers[p.id] = Object.assign({}, answers[p.id], { agree: pair[1] });
          queueSave(); updateProgress();
        });
        lbl.appendChild(input);
        lbl.appendChild(document.createTextNode(' ' + pair[0]));
        row.appendChild(lbl);
      });
      fs.appendChild(row);
      var noteId = 'note-' + p.id;
      var noteLabel = document.createElement('label');
      noteLabel.setAttribute('for', noteId);
      noteLabel.className = 'notelabel';
      noteLabel.textContent = 'Anything you want to add (optional)';
      var note = document.createElement('input');
      note.type = 'text'; note.id = noteId; note.value = saved.note || '';
      note.addEventListener('input', function(){
        answers[p.id] = Object.assign({}, answers[p.id], { note: note.value });
        queueSave();
      });
      fs.appendChild(noteLabel);
      fs.appendChild(note);
      wrap.appendChild(fs);
      return wrap;
    }

    var inputId = 'input-' + p.id;
    var label = document.createElement('label');
    label.setAttribute('for', inputId);
    label.className = 'promptlabel';
    label.textContent = p.label;
    wrap.appendChild(label);
    if (p.text) {
      var question = document.createElement('p');
      question.className = 'question';
      question.id = 'q-' + p.id;
      question.textContent = p.text;
      wrap.appendChild(question);
    }
    var box = document.createElement('textarea');
    box.id = inputId;
    box.rows = p.kind === 'short' ? 3 : 7;
    box.value = saved.text || '';
    if (p.text) box.setAttribute('aria-describedby', 'q-' + p.id);
    box.addEventListener('input', function(){
      answers[p.id] = { text: box.value };
      queueSave(); updateProgress();
    });
    wrap.appendChild(box);

    var tools = document.createElement('div');
    tools.className = 'row tools';
    if (speakSupported()) {
      var speak = document.createElement('button');
      speak.type = 'button';
      speak.className = 'button small-button';
      speak.textContent = 'Speak';
      speak.setAttribute('aria-pressed', 'false');
      speak.setAttribute('aria-label', 'Speak your answer to: ' + p.label);
      speak.addEventListener('click', function(){ toggleSpeak(p.id, speak); });
      tools.appendChild(speak);
    }
    wrap.appendChild(tools);
    var st = document.createElement('p');
    st.className = 'speak-status';
    st.id = 'speak-status-' + p.id;
    st.setAttribute('role', 'status');
    wrap.appendChild(st);
    return wrap;
  }

  function render(){
    el('introText').innerHTML = '';
    if (journal.intro) {
      var intro = document.createElement('p');
      intro.textContent = journal.intro;
      el('introText').appendChild(intro);
    }
    if (journal.audio && journal.audio.href) {
      var a = document.createElement('p');
      var link = document.createElement('a');
      link.href = journal.audio.href;
      link.textContent = journal.audio.label;
      link.rel = 'noopener';
      a.appendChild(link);
      el('audioSlot').appendChild(a);
    }
    var form = el('journalForm');
    form.innerHTML = '';
    journal.sections.forEach(function(sec, i){
      var section = document.createElement('section');
      section.className = 'card';
      if (sec.heading) {
        var h = document.createElement('h2');
        h.textContent = sec.heading;
        section.appendChild(h);
      }
      if (sec.note) {
        var n = document.createElement('p');
        n.className = 'sectionnote';
        n.textContent = sec.note;
        section.appendChild(n);
      }
      if (sec.audio && sec.audio.href) {
        var sa = document.createElement('p');
        var sl = document.createElement('a');
        sl.href = sec.audio.href; sl.textContent = sec.audio.label; sl.rel = 'noopener';
        sa.appendChild(sl);
        section.appendChild(sa);
      }
      sec.prompts.forEach(function(p){ section.appendChild(renderPrompt(p)); });
      form.appendChild(section);
    });
    updateProgress();
  }

  function plainText(){
    var lines = [journal.title, 'Mind/Body Foundations, Module ' + MODULE + ', ' + journal.code, ''];
    journal.sections.forEach(function(sec){
      if (sec.heading) { lines.push('', '--- ' + sec.heading.toUpperCase() + ' ---', ''); }
      sec.prompts.forEach(function(p){
        var a = answers[p.id] || {};
        lines.push(p.label);
        if (p.text) lines.push(p.text);
        lines.push('');
        if (p.kind === 'agree') {
          lines.push(a.agree === true ? 'Yes' : a.agree === false ? 'No' : '(not answered)');
          if (a.note) lines.push(a.note);
        } else {
          lines.push(String(a.text || '').trim() || '(not answered)');
        }
        lines.push('');
      });
    });
    return lines.join('\\n');
  }

  el('downloadButton').addEventListener('click', function(){
    var blob = new Blob([plainText()], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = journal.title.replace(/[^A-Za-z0-9 ]/g, '') + '.txt';
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  });

  el('sendButton').addEventListener('click', async function(){
    var email = el('clientEmail').value.trim();
    try { if (email && store()) store().setItem(EMAIL_KEY, email); } catch(e) {}
    var c = counts();
    if (c.answered === 0) { el('sendStatus').textContent = 'There is nothing written yet.'; return; }
    el('sendButton').disabled = true;
    el('sendStatus').textContent = 'One moment.';
    try {
      var response = await fetch('${SEND_PATH}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Companion-Access': accessCode },
        cache: 'no-store',
        body: JSON.stringify({ module: MODULE, slug: SLUG, answers: answers, clientEmail: email })
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'It did not send.');
      el('sendStatus').textContent = data.copiedTo
        ? 'Done. Chad knows you have finished it, and your own copy is on its way to ' + data.copiedTo + '.'
        : 'Done. Chad knows you have finished it.';
    } catch (error) {
      el('sendStatus').textContent = (error.message || 'That did not go through.') + ' Your writing is safe and Chad still has it. You can try this again, or just leave it.';
    } finally {
      el('sendButton').disabled = false;
    }
  });

  el('uploadButton').addEventListener('click', async function(){
    var file = el('uploadInput').files && el('uploadInput').files[0];
    if (!file) { el('uploadStatus').textContent = 'Choose a file first.'; return; }
    if (file.size > ${MAX_UPLOAD_BYTES}) { el('uploadStatus').textContent = 'That file is too big to send here.'; return; }
    el('uploadButton').disabled = true;
    el('uploadStatus').textContent = 'Sending ' + file.name + '.';
    try {
      var response = await fetch('${UPLOAD_PATH}', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Companion-Access': accessCode,
          'X-Journal-Module': MODULE,
          'X-Journal-Slug': SLUG,
          'X-Journal-Filename': encodeURIComponent(file.name)
        },
        cache: 'no-store',
        body: file
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'It did not send.');
      el('uploadStatus').textContent = 'Chad has it.';
    } catch (error) {
      el('uploadStatus').textContent = (error.message || 'It did not send.') + ' Try again, or email it to Chad the old way.';
    } finally {
      el('uploadButton').disabled = false;
    }
  });

  async function unlock(){
    var code = el('accessCode').value.trim();
    if (!code) { el('accessError').hidden = false; el('accessError').textContent = 'Enter your code.'; return; }
    el('unlockButton').disabled = true;
    try {
      var response = await fetch('/api/mbf/journal/' + MODULE + '/' + SLUG, {
        headers: { 'X-Companion-Access': code },
        cache: 'no-store'
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'That code did not work.');
      accessCode = code;
      journal = data.journal;
      el('pdfLink').href = data.pdfHref || '#';
      el('accessCard').hidden = true;
      el('journalWrap').hidden = false;
      load();
      // What Chad's side holds wins over what this browser holds, so a
      // client who wrote half of it on a laptop opens the phone and finds
      // it there. The browser copy is only the offline safety net.
      if (data.saved && data.saved.answers && Object.keys(data.saved.answers).length) {
        answers = data.saved.answers;
        save();
      }
      render();
      if (data.saved && data.saved.finishedAt) {
        el('sendStatus').textContent = 'You marked this one finished. You can still change it, and Chad will see the change.';
      }
      el('introCard').scrollIntoView();
      el('introCard').focus();
    } catch (error) {
      el('accessError').hidden = false;
      el('accessError').textContent = error.message || 'That code did not work.';
    } finally {
      el('unlockButton').disabled = false;
    }
  }

  el('unlockButton').addEventListener('click', unlock);
  el('accessCode').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); unlock(); } });
  window.addEventListener('beforeunload', function(){ if (journal) save(); });
  // A tab closing or a phone being put down is the commonest end of a
  // sitting, and neither fires a reliable fetch. sendBeacon does.
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState !== 'hidden' || !journal) return;
    clearTimeout(serverTimer);
    var payload = JSON.stringify({ module: MODULE, slug: SLUG, answers: answers, code: accessCode });
    try { navigator.sendBeacon('${SAVE_PATH}?beacon=1', new Blob([payload], { type: 'application/json' })); }
    catch (e) { saveToServer(); }
  });
})();
</script>
</body>
</html>`;
}

// ── Routing ─────────────────────────────────────────────────────
function pdfHrefFor(journal) {
  return '/downloads/mbf/module-' + journal.module + '/' + journal.slug + '.pdf';
}

async function handleMbfJournalRoute(req, res) {
  const url = String(req.url || '').split('?')[0];

  const pageMatch = PAGE_ROUTE.exec(url);
  if (pageMatch) {
    const journal = findJournal(pageMatch[1], pageMatch[2]);
    if (!journal) return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const html = journalPage(pageMatch[1], pageMatch[2], journal);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return true;
  }

  const contentMatch = CONTENT_ROUTE.exec(url);
  if (contentMatch) {
    const journal = findJournal(contentMatch[1], contentMatch[2]);
    if (!journal) return false;
    const access = hasAccess(req);
    if (!access.ok) {
      sendJson(res, access.status, {
        error: access.status === 503 ? 'This journal is not open yet. Chad has not issued codes.' : 'That code did not work.',
      });
      return true;
    }
    let saved = null;
    try {
      const doc = await defaultStore().load();
      const record = findRecord(doc, suppliedCode(req), journal.module, journal.slug);
      if (record) saved = { answers: record.answers || {}, updatedAt: record.updatedAt, finishedAt: record.finishedAt };
    } catch (error) {
      // A store that cannot be read must not stop someone writing. They
      // fall back to whatever their own browser kept.
      saved = null;
    }
    sendJson(res, 200, { journal, pdfHref: pdfHrefFor(journal), saved });
    return true;
  }

  if (url === SAVE_PATH) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      // A page being closed saves through sendBeacon, which cannot set a
      // header, so the code may arrive in the body instead. It is the same
      // credential either way and is checked the same way.
      const code = suppliedCode(req) || String(body.code || '');
      const access = accessForCode(code);
      if (!access.ok) {
        sendJson(res, access.status, { error: 'That code did not work.' });
        return true;
      }
      const journal = findJournal(body.module, body.slug);
      if (!journal) {
        sendJson(res, 400, { error: 'That journal does not exist.' });
        return true;
      }
      await defaultStore().update((doc) => {
        upsertRecord(doc, {
          code,
          clientName: clientNameFromCode(code),
          moduleNumber: journal.module,
          slug: journal.slug,
          answers: body.answers || {},
        });
        return doc;
      });
      sendJson(res, 200, { saved: true });
    } catch (error) {
      sendJson(res, 502, { error: 'That did not save.' });
    }
    return true;
  }

  if (url === SEND_PATH) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const access = hasAccess(req);
    if (!access.ok) {
      sendJson(res, access.status, { error: 'That code did not work.' });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const journal = findJournal(body.module, body.slug);
      if (!journal) {
        sendJson(res, 400, { error: 'That journal does not exist.' });
        return true;
      }
      const code = suppliedCode(req);
      const clientName = clientNameFromCode(code);
      await defaultStore().update((doc) => {
        upsertRecord(doc, {
          code,
          clientName,
          moduleNumber: journal.module,
          slug: journal.slug,
          answers: body.answers || {},
          finished: true,
        });
        return doc;
      });
      const outcome = await deliverJournal({
        code,
        clientName,
        journal,
        answers: body.answers || {},
        clientEmail: String(body.clientEmail || '').trim() || null,
        finished: true,
      });
      const now = new Date().toISOString();
      await defaultStore().update((doc) => {
        const record = findRecord(doc, code, journal.module, journal.slug);
        if (record && outcome.savedTo) {
          record.deliveredAt = now;
          record.deliveredPath = outcome.savedTo;
          record.deliveryProblem = null;
        }
        return doc;
      });
      sendJson(res, 200, { sent: true, copiedTo: outcome.copiedTo, savedTo: Boolean(outcome.savedTo) });
    } catch (error) {
      sendJson(res, error.clientStatus || 502, { error: error.message || 'It did not send.' });
    }
    return true;
  }

  if (url === UPLOAD_PATH) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const access = hasAccess(req);
    if (!access.ok) {
      sendJson(res, access.status, { error: 'That code did not work.' });
      return true;
    }
    try {
      const journal = findJournal(req.headers['x-journal-module'], req.headers['x-journal-slug']);
      if (!journal) {
        sendJson(res, 400, { error: 'That journal does not exist.' });
        return true;
      }
      const bytes = await readBytes(req);
      if (!bytes.length) {
        sendJson(res, 400, { error: 'The file did not arrive.' });
        return true;
      }
      const given = decodeURIComponent(String(req.headers['x-journal-filename'] || 'journal'));
      const clientName = clientNameFromCode(suppliedCode(req));
      const saved = await saveUpload(journal, clientName, given, bytes);
      sendJson(res, 200, { sent: true, savedTo: Boolean(saved) });
    } catch (error) {
      sendJson(res, error.clientStatus || 502, { error: error.message || 'It did not send.' });
    }
    return true;
  }

  return false;
}

// An uploaded document goes to the same Dropbox folder a typed journal goes
// to, under its own name with the date added, so the two paths land in one
// place. Without Dropbox configured the client is told plainly that the
// file route is not open yet rather than being told it arrived.
async function saveUpload(journal, clientName, filename, bytes) {
  if (!(await dropboxConfigured())) {
    const err = new Error('Uploading is not connected yet. Email the file to Chad for now.');
    err.clientStatus = 503;
    throw err;
  }
  const base = dropboxPath(journal, clientName).replace(/[^/]+$/, '');
  const date = new Date().toISOString().slice(0, 10);
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const target = base + safeSegment(stem + ' - ' + clientName + ' - ' + date) + ext;
  return uploadBytesToDropbox(target, bytes);
}

module.exports = { handleMbfJournalRoute, journalPage, hasAccess, pdfHrefFor };
