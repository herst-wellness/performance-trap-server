'use strict';

(function () {
  const el = (id) => document.getElementById(id);
  const ui = {
    setupCard: el('setupCard'),
    sessionCard: el('sessionCard'),
    endedCard: el('endedCard'),
    accessCode: el('accessCode'),
    adultConsent: el('adultConsent'),
    beginButton: el('beginButton'),
    setupMessage: el('setupMessage'),
    transcript: el('transcript'),
    exchangeCount: el('exchangeCount'),
    timeRemaining: el('timeRemaining'),
    responseForm: el('responseForm'),
    responseText: el('responseText'),
    sendButton: el('sendButton'),
    statusLabel: el('statusLabel'),
    statusDetail: el('statusDetail'),
    breathDot: el('breathDot'),
    endButton: el('endButton'),
    finalCost: el('finalCost'),
    startAgainButton: el('startAgainButton')
  };

  const state = {
    config: null,
    accessCode: '',
    sessionId: '',
    history: [],
    exchangeCount: 0,
    costUsd: 0,
    ended: false,
    deadline: 0,
    timer: null,
    controller: null
  };

  function setStatus(label, detail, waiting) {
    ui.statusLabel.textContent = label;
    ui.statusDetail.textContent = detail || '';
    ui.breathDot.className = waiting ? 'breath-dot waiting' : 'breath-dot';
  }

  function addTurn(role, text, extraClass) {
    const turn = document.createElement('div');
    turn.className = `turn ${role}${extraClass ? ` ${extraClass}` : ''}`;
    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    speaker.textContent = role === 'user' ? 'You' : 'Companion';
    const content = document.createElement('span');
    content.className = 'turn-text';
    content.textContent = text;
    turn.append(speaker, content);
    ui.transcript.appendChild(turn);
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }

  function updateExchangeDisplay() {
    ui.exchangeCount.textContent = `${state.exchangeCount} of ${state.config.maxExchanges} exchanges`;
  }

  function startClock() {
    state.deadline = Date.now() + state.config.sessionMinutes * 60 * 1000;
    function tick() {
      const remaining = Math.max(0, state.deadline - Date.now());
      const secondsLeft = Math.ceil(remaining / 1000);
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = String(secondsLeft % 60).padStart(2, '0');
      ui.timeRemaining.textContent = `${minutes}:${seconds} remaining`;
      if (remaining <= 0) endSession(false, 'This sitting has reached its time limit.');
    }
    tick();
    state.timer = window.setInterval(tick, 1000);
  }

  async function loadConfig() {
    try {
      const response = await fetch('/api/kids-on-the-bus/config', { cache: 'no-store' });
      state.config = await response.json();
      if (!state.config.configured) ui.setupMessage.textContent = 'The private companion is not ready yet.';
    } catch {
      ui.setupMessage.textContent = 'The private companion is not responding.';
    }
  }

  async function beginSession() {
    ui.setupMessage.textContent = '';
    if (!state.config) await loadConfig();
    if (!state.config || !state.config.configured) return;
    if (!ui.adultConsent.checked) {
      ui.setupMessage.textContent = 'Please confirm the notice before beginning.';
      return;
    }
    if (!ui.accessCode.value.trim()) {
      ui.setupMessage.textContent = 'Enter the private access code.';
      return;
    }
    state.accessCode = ui.accessCode.value.trim();
    ui.beginButton.disabled = true;
    try {
      const response = await fetch('/api/kids-on-the-bus/session', {
        method: 'POST',
        headers: { 'X-Companion-Code': state.accessCode }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The sitting could not begin.');
      state.sessionId = data.sessionId;
      state.history = [];
      state.exchangeCount = 0;
      state.costUsd = 0;
      state.ended = false;
      updateExchangeDisplay();
      addTurn('companion', data.opening);
      ui.setupCard.classList.add('hidden');
      ui.sessionCard.classList.remove('hidden');
      setStatus('Write when you are ready', 'Take as much time as you need. There is nothing listening or waiting for you to finish.', false);
      startClock();
      ui.responseText.focus();
    } catch (error) {
      ui.setupMessage.textContent = error.message;
      ui.beginButton.disabled = false;
    }
  }

  async function submitResponse(event) {
    event.preventDefault();
    const message = ui.responseText.value.trim();
    if (!message || state.ended || state.controller) return;
    ui.responseText.value = '';
    addTurn('user', message);
    const priorHistory = state.history.slice();
    state.history.push({ role: 'user', content: message });
    ui.responseText.disabled = true;
    ui.sendButton.disabled = true;
    setStatus('The companion is responding', 'The breath circle expands for five seconds and settles for seven.', true);
    state.controller = new AbortController();
    try {
      const response = await fetch('/api/kids-on-the-bus/claude-response', {
        method: 'POST',
        signal: state.controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Companion-Code': state.accessCode
        },
        body: JSON.stringify({ sessionId: state.sessionId, message, history: priorHistory })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The companion could not respond.');
      const responseText = String(data.response || '').trim();
      if (!responseText) throw new Error('The companion returned no response.');
      addTurn('companion', responseText, data.route === 'continue_reflection' ? '' : 'safety');
      state.history.push({ role: 'assistant', content: responseText });
      state.exchangeCount += 1;
      state.costUsd += Number(data.responseCostUsd || 0);
      updateExchangeDisplay();
      if (data.route !== 'continue_reflection') {
        endSession(false, 'This reflection has paused here.');
        return;
      }
      if (state.exchangeCount >= state.config.maxExchanges) {
        endSession(false, 'This sitting has reached its extended exchange limit.');
        return;
      }
      setStatus('Your turn', 'Write when you are ready.', false);
    } catch (error) {
      if (error.name !== 'AbortError') setStatus('The companion could not respond', error.message, false);
    } finally {
      state.controller = null;
      if (!state.ended) {
        ui.responseText.disabled = false;
        ui.sendButton.disabled = false;
        ui.responseText.focus();
      }
    }
  }

  function reportEnd() {
    if (!state.sessionId) return;
    fetch('/api/kids-on-the-bus/session/end', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Code': state.accessCode
      },
      body: JSON.stringify({ sessionId: state.sessionId })
    }).catch(function () {});
  }

  function endSession(clear, reason) {
    if (!state.ended) reportEnd();
    state.ended = true;
    if (state.controller) state.controller.abort();
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
    ui.responseText.disabled = true;
    ui.sendButton.disabled = true;
    if (!clear) {
      setStatus('Sitting ended', reason || 'No more responses will be sent.', false);
      return;
    }
    ui.transcript.replaceChildren();
    ui.sessionCard.classList.add('hidden');
    ui.endedCard.classList.remove('hidden');
    ui.finalCost.textContent = `Calculated cost for this sitting: approximately $${state.costUsd.toFixed(3)}. The cost record contains usage numbers only.`;
  }

  ui.beginButton.addEventListener('click', beginSession);
  ui.responseForm.addEventListener('submit', submitResponse);
  ui.endButton.addEventListener('click', () => endSession(true));
  ui.startAgainButton.addEventListener('click', () => window.location.reload());
  window.addEventListener('beforeunload', reportEnd);
  loadConfig();
})();
