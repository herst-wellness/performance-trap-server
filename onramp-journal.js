// Web journals for The Performance Trap Practice.
const fs = require('node:fs');
const path = require('node:path');
const { findByCode, defaultStore } = require('./onramp-store');
const { findJournal } = require('./onramp-journal-content');
const { defaultStore: defaultJournalStore, findRecord, upsertRecord } = require('./onramp-journal-store');
const { deliverJournal } = require('./mbf-delivery');

const MAX_BODY_BYTES = 400000;
const PAGE_ROUTE = /^\/practice\/on-ramp\/week-(\d)\/journal\/([a-z0-9-]+)$/;
const CONTENT_ROUTE = /^\/api\/on-ramp\/journal\/(\d)\/([a-z0-9-]+)$/;
const SAVE_PATH = '/api/on-ramp/journal/save';
const SEND_PATH = '/api/on-ramp/journal/send';
const OPT_OUT_NOTE = "What you write here comes to me, unless you tell me not to. We meet for an hour at the end of the four weeks, and that hour is better when I have already read what has been going on with you. It means we don't spend the first twenty minutes catching me up. If you would rather keep it to yourself, tick the box. It won't change anything about the hour, and I won't ask about it.";
const OPT_OUT_LABEL = 'Please do not send to Chad.';

const STYLE = fs.existsSync(path.join(__dirname, 'mbf-journal.css'))
  ? fs.readFileSync(path.join(__dirname, 'mbf-journal.css'), 'utf8')
  : '';

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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clientName(record) {
  return [record && record.firstName, record && record.lastName].filter(Boolean).join(' ').trim();
}

async function recordForRequest(req, store) {
  const code = String(req.headers['x-companion-access'] || '');
  if (!code) return null;
  return findByCode(await store.load(), code);
}

function pdfHrefFor(journal) {
  return '/downloads/on-ramp/week-' + journal.week + '/' + journal.slug + '.pdf';
}

function journalPage(weekNumber, slug, journal) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${esc(journal.title)} | The Performance Trap Practice</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the journal</a>
<main class="shell" id="main">
  <div class="brand"><img src="/Herst-Wellness-Logo-cropped.jpg" alt="Herst Wellness"></div>
  <nav aria-label="Breadcrumb" class="crumbs"><a href="/practice/on-ramp">The Performance Trap Practice</a> &rsaquo; <span>Week ${esc(weekNumber)}</span> &rsaquo; <span aria-current="page">${esc(journal.title)}</span></nav>
  <div class="rule"></div>

  <header class="hero">
    <p class="eyebrow">Journal &middot; Week ${esc(weekNumber)}</p>
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
      <p>This can feel worse before it feels better. Stop whenever you want. What you wrote stays on the page.</p>
      <p class="small">Your answers save in this browser as you type, and come to Chad as you go unless you use the privacy box below.</p>
      <p class="small">If you speak instead of typing, the sound goes to OpenAI to be turned into words. This application keeps no recording. OpenAI may hold it in abuse-monitoring logs for up to 30 days.</p>
      <div class="field">
        <p>${esc(OPT_OUT_NOTE)}</p>
        <label class="choice" for="optOut"><input id="optOut" type="checkbox"> ${esc(OPT_OUT_LABEL)}</label>
      </div>
      <details class="alt">
        <summary>I would rather print it</summary>
        <p>That works. Download the PDF and write by hand.</p>
        <p><a id="pdfLink" href="#">Download the PDF</a></p>
      </details>
    </section>

    <div class="progress card" role="status" aria-live="polite">
      <p id="progressText">Nothing answered yet.</p>
      <p id="saveState" class="small"></p>
    </div>

    <form id="journalForm" novalidate></form>

    <section class="card send" aria-labelledby="sendHeading">
      <h2 id="sendHeading">When you are ready</h2>
      <p>What you write comes to Chad as you go. This button sends it now and marks it done. The privacy box stops all of it.</p>
      <div class="row">
        <button id="sendButton" class="button" type="button">Send to Chad</button>
        <button id="downloadButton" class="button secondary" type="button">Download a copy</button>
      </div>
      <p id="sendStatus" class="status" role="status"></p>
    </section>
  </div>

  <p class="footer">The Performance Trap Practice. Your answers are held in this browser and in Chad's files unless you use the privacy box.</p>
</main>
<script>
(function(){
  var WEEK = ${JSON.stringify(String(weekNumber))};
  var SLUG = ${JSON.stringify(slug)};
  var STORAGE_KEY = 'onramp-journal-' + WEEK + '-' + SLUG;
  var OPT_KEY = '';
  var journal = null;
  var accessCode = '';
  var answers = {};
  var saveTimer = null;
  var serverTimer = null;
  var recorder = null, micStream = null, chunks = [], listeningFor = null;

  function el(id){ return document.getElementById(id); }
  function store(){ try { return window.localStorage; } catch(e) { return null; } }
  function codeKey(code){ return String(code || '').trim().toLowerCase().replace(/[\\s_]+/g, '-'); }

  function load(){
    if (journal && journal.saved && journal.saved.answers) answers = journal.saved.answers;
    var s = store(); if (!s) return;
    try { answers = JSON.parse(s.getItem(STORAGE_KEY + '-' + codeKey(accessCode)) || '{}') || {}; } catch(e) { answers = {}; }
    if (Object.keys(answers).length === 0 && journal && journal.saved && journal.saved.answers) answers = journal.saved.answers;
    try { el('optOut').checked = s.getItem(OPT_KEY) === '1'; } catch(e) {}
    if (journal && journal.saved && journal.saved.optOut === true) el('optOut').checked = true;
  }

  function save(){
    var s = store(); if (!s) return;
    try { s.setItem(STORAGE_KEY + '-' + codeKey(accessCode), JSON.stringify(answers)); el('saveState').textContent = 'Saved on this device.'; }
    catch(e) { el('saveState').textContent = 'This browser will not let the page save your place. Download a copy before you close the tab.'; }
  }

  function saveOptOut(){
    var s = store(); if (!s) return;
    try { s.setItem(OPT_KEY, el('optOut').checked ? '1' : '0'); } catch(e) {}
  }

  async function saveToServer(finished){
    if (!journal) return {};
    try {
      var response = await fetch(finished ? '${SEND_PATH}' : '${SAVE_PATH}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Companion-Access': accessCode },
        cache: 'no-store',
        body: JSON.stringify({ week: WEEK, slug: SLUG, answers: answers, optOut: el('optOut').checked })
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'It did not save.');
      if (!finished) el('saveState').textContent = data.optedOut ? 'Saved on this device. Nothing is going to Chad.' : 'Saved. Chad has this.';
      return data;
    } catch (error) {
      if (!finished) el('saveState').textContent = 'Saved on this device. It has not reached Chad yet, and will when you are back online.';
      throw error;
    }
  }

  function queueSave(){
    el('saveState').textContent = 'Saving.';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
    clearTimeout(serverTimer);
    serverTimer = setTimeout(function(){ saveToServer(false).catch(function(){}); }, 3000);
  }

  function counts(){
    var answered = 0, total = 0;
    journal.sections.forEach(function(sec){
      sec.prompts.forEach(function(p){
        total += 1;
        var a = answers[p.id];
        if (a && String(a.text || '').trim()) answered += 1;
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
      var response = await fetch('/api/on-ramp/transcribe', {
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
    box.rows = p.kind === 'short' ? 3 : p.kind === 'medium' ? 5 : 9;
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
    if (journal.intro) {
      var intro = document.createElement('p');
      intro.textContent = journal.intro;
      el('introText').appendChild(intro);
    }
    var form = el('journalForm');
    form.innerHTML = '';
    journal.sections.forEach(function(sec){
      var section = document.createElement('section');
      section.className = 'card';
      if (sec.heading) {
        var h = document.createElement('h2');
        h.textContent = sec.heading;
        section.appendChild(h);
      }
      sec.prompts.forEach(function(p){ section.appendChild(renderPrompt(p)); });
      form.appendChild(section);
    });
    updateProgress();
  }

  function plainText(){
    var lines = [journal.title, 'The Performance Trap Practice, Week ' + WEEK, ''];
    journal.sections.forEach(function(sec){
      if (sec.heading) { lines.push('', '--- ' + sec.heading.toUpperCase() + ' ---', ''); }
      sec.prompts.forEach(function(p){
        var a = answers[p.id] || {};
        lines.push(p.label);
        if (p.text) lines.push(p.text);
        lines.push('', String(a.text || '').trim() || '(not answered)', '');
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
    var c = counts();
    if (c.answered === 0) { el('sendStatus').textContent = 'There is nothing written yet.'; return; }
    saveOptOut();
    el('sendButton').disabled = true;
    el('sendStatus').textContent = el('optOut').checked ? 'Saving here.' : 'Sending.';
    try {
      clearTimeout(serverTimer);
      var data = await saveToServer(true);
      el('sendStatus').textContent = data.optedOut ? 'Kept here. Nothing was sent to Chad.' : 'Chad has it.';
    } catch (error) {
      el('sendStatus').textContent = (error.message || 'It did not send.') + ' Your writing is still here. Try again, or download a copy.';
    } finally {
      el('sendButton').disabled = false;
    }
  });

  async function unlock(){
    var code = el('accessCode').value.trim();
    if (!code) { el('accessError').hidden = false; el('accessError').textContent = 'Enter your code.'; return; }
    el('unlockButton').disabled = true;
    try {
      var response = await fetch('/api/on-ramp/journal/' + WEEK + '/' + SLUG, {
        headers: { 'X-Companion-Access': code },
        cache: 'no-store'
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'That code did not work.');
      accessCode = code;
      OPT_KEY = 'onramp-journal-optout-' + codeKey(accessCode) + '-' + WEEK + '-' + SLUG;
      journal = data.journal;
      journal.saved = data.saved;
      el('pdfLink').href = data.pdfHref || '#';
      el('accessCard').hidden = true;
      el('journalWrap').hidden = false;
      load();
      render();
      el('introCard').scrollIntoView();
      el('introCard').focus();
    } catch (error) {
      el('accessError').hidden = false;
      el('accessError').textContent = error.message || 'That code did not work.';
    } finally {
      el('unlockButton').disabled = false;
    }
  }

  el('optOut').addEventListener('change', function(){ saveOptOut(); queueSave(); });
  el('unlockButton').addEventListener('click', unlock);
  el('accessCode').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); unlock(); } });
  window.addEventListener('beforeunload', function(){ if (journal) save(); });
})();
</script>
</body>
</html>`;
}

async function handleOnrampJournalRoute(req, res, helpers = {}) {
  const store = helpers.store || defaultStore();
  const journalStore = helpers.journalStore || defaultJournalStore();
  const url = String(req.url || '').split('?')[0];

  const pageMatch = PAGE_ROUTE.exec(url);
  if (pageMatch) {
    const journal = findJournal(pageMatch[1], pageMatch[2]);
    if (!journal) return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(journalPage(pageMatch[1], pageMatch[2], journal));
    return true;
  }

  const contentMatch = CONTENT_ROUTE.exec(url);
  if (contentMatch) {
    const journal = findJournal(contentMatch[1], contentMatch[2]);
    if (!journal) return false;
    const record = await recordForRequest(req, store);
    if (!record) {
      sendJson(res, 401, { error: 'That code did not work.' });
      return true;
    }
    const saved = findRecord(await journalStore.load(), record.code, contentMatch[1], contentMatch[2]);
    sendJson(res, 200, { journal, pdfHref: pdfHrefFor(journal), saved });
    return true;
  }

  if (url === SAVE_PATH) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const record = await recordForRequest(req, store);
      if (!record) {
        sendJson(res, 401, { error: 'That code did not work.' });
        return true;
      }
      const body = await readJsonBody(req);
      const journal = findJournal(body.week, body.slug);
      if (!journal) {
        sendJson(res, 400, { error: 'That journal does not exist.' });
        return true;
      }
      const name = clientName(record);
      let saved = null;
      await journalStore.update((doc) => {
        saved = upsertRecord(doc, {
          code: record.code,
          clientName: name,
          week: journal.week,
          slug: journal.slug,
          answers: body.answers || {},
          optOut: body.optOut === true,
        });
        return doc;
      });
      sendJson(res, 200, { saved: true, optedOut: saved.optOut === true });
    } catch (error) {
      sendJson(res, error.clientStatus || 502, { error: error.message || 'It did not save.' });
    }
    return true;
  }

  if (url === SEND_PATH) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const record = await recordForRequest(req, store);
      if (!record) {
        sendJson(res, 401, { error: 'That code did not work.' });
        return true;
      }
      const body = await readJsonBody(req);
      const journal = findJournal(body.week, body.slug);
      if (!journal) {
        sendJson(res, 400, { error: 'That journal does not exist.' });
        return true;
      }
      const name = clientName(record);
      let saved = null;
      await journalStore.update((doc) => {
        saved = upsertRecord(doc, {
          code: record.code,
          clientName: name,
          week: journal.week,
          slug: journal.slug,
          answers: body.answers || {},
          finished: true,
          optOut: body.optOut === true,
        });
        return doc;
      });
      if (body.optOut === true) {
        sendJson(res, 200, { sent: false, optedOut: true });
        return true;
      }
      const now = new Date();
      const outcome = await deliverJournal({
        code: record.code,
        clientName: name,
        journal: { ...journal, module: journal.week },
        answers: body.answers || {},
        clientEmail: null,
        finished: true,
        now,
      });
      await journalStore.update((doc) => {
        const current = findRecord(doc, record.code, journal.week, journal.slug);
        if (current && current.optOut !== true) {
          current.deliveredAt = now.toISOString();
          current.deliveredPath = outcome.savedTo;
          current.deliveryProblem = null;
        }
        return doc;
      });
      sendJson(res, 200, { sent: true, copiedTo: outcome.copiedTo, savedTo: Boolean(outcome.savedTo) });
    } catch (error) {
      sendJson(res, error.clientStatus || 502, { error: error.message || 'It did not send.' });
    }
    return true;
  }

  return false;
}

module.exports = { handleOnrampJournalRoute, journalPage, pdfHrefFor, OPT_OUT_NOTE, OPT_OUT_LABEL };
