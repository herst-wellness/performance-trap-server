'use strict';

(function () {
  const API = '/api/kids-on-the-bus/admin';
  const ui = {};
  ['gate', 'code', 'open', 'gateMessage', 'tool', 'leftEffort', 'rightEffort', 'conversation',
    'message', 'ask', 'restart', 'status', 'pair', 'firstText', 'secondText', 'reveal', 'revealText', 'tallyText']
    .forEach((id) => { ui[id] = document.getElementById(id); });

  const state = { code: '', history: [], pairId: '', pending: null };

  function post(path, body) {
    return fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Companion-Admin-Code': state.code },
      body: JSON.stringify(body)
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'That did not work.');
      return data;
    });
  }

  function addToConversation(role, text) {
    const line = document.createElement('p');
    line.className = `turn ${role}`;
    const who = document.createElement('strong');
    who.textContent = role === 'user' ? 'Person: ' : 'Companion: ';
    line.append(who, document.createTextNode(text));
    ui.conversation.appendChild(line);
  }

  ui.open.addEventListener('click', async () => {
    state.code = ui.code.value.trim();
    if (!state.code) return;
    ui.gateMessage.textContent = 'Checking.';
    try {
      // A deliberately invalid pair: it is rejected for its efforts if the code
      // is good, and for the code if it is not.
      await post('/compare', { message: 'check', leftEffort: 'high', rightEffort: 'high' });
    } catch (error) {
      if (/administrative code/i.test(error.message)) {
        ui.gateMessage.textContent = 'That code was not accepted.';
        return;
      }
    }
    ui.gateMessage.textContent = '';
    ui.gate.classList.add('hidden');
    ui.tool.classList.remove('hidden');
    ui.code.value = '';
    ui.message.focus();
  });

  ui.ask.addEventListener('click', async () => {
    const message = ui.message.value.trim();
    if (!message) return;
    if (ui.leftEffort.value === ui.rightEffort.value) {
      ui.status.textContent = 'Pick two different effort levels.';
      return;
    }
    ui.ask.disabled = true;
    ui.pair.classList.add('hidden');
    ui.reveal.classList.add('hidden');
    ui.status.textContent = 'Asking both. This takes as long as the slower one.';
    try {
      const data = await post('/compare', {
        message,
        history: state.history,
        leftEffort: ui.leftEffort.value,
        rightEffort: ui.rightEffort.value
      });
      state.pairId = data.pairId;
      state.pending = { message, first: data.first.text, second: data.second.text };
      ui.firstText.textContent = data.first.text;
      ui.secondText.textContent = data.second.text;
      ui.pair.classList.remove('hidden');
      ui.status.textContent = 'Read both, then pick. Timings are shown after you choose.';
      state.pending.seconds = { first: data.first.seconds, second: data.second.seconds };
    } catch (error) {
      ui.status.textContent = error.message;
    } finally {
      ui.ask.disabled = false;
    }
  });

  ui.pair.addEventListener('click', async (event) => {
    const choice = event.target?.dataset?.choice;
    if (!choice || !state.pairId) return;
    try {
      const data = await post('/compare/choose', { pairId: state.pairId, choice });
      const seconds = state.pending.seconds;
      ui.revealText.textContent = choice === 'tie'
        ? `No difference. First was ${data.first} at ${seconds.first}s, second was ${data.second} at ${seconds.second}s.`
        : `You picked ${data.chosen}. First was ${data.first} at ${seconds.first}s, second was ${data.second} at ${seconds.second}s.`;
      const counts = Object.entries(data.tally).filter(([, value]) => value > 0)
        .map(([key, value]) => `${key}: ${value}`).join(', ');
      ui.tallyText.textContent = counts ? `So far. ${counts}.` : '';
      ui.reveal.classList.remove('hidden');
      ui.pair.classList.add('hidden');

      // The chosen reply becomes the history both sides continue from.
      const kept = choice === 'second' ? state.pending.second : state.pending.first;
      addToConversation('user', state.pending.message);
      addToConversation('companion', kept);
      state.history.push({ role: 'user', content: state.pending.message });
      state.history.push({ role: 'assistant', content: kept });
      ui.message.value = '';
      ui.message.focus();
      state.pairId = '';
    } catch (error) {
      ui.status.textContent = error.message;
    }
  });

  ui.restart.addEventListener('click', () => {
    state.history = [];
    state.pairId = '';
    state.pending = null;
    ui.conversation.replaceChildren();
    ui.pair.classList.add('hidden');
    ui.reveal.classList.add('hidden');
    ui.message.value = '';
    ui.status.textContent = 'Fresh conversation. The running tally is kept.';
    ui.message.focus();
  });
})();
