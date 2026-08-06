'use strict';

(function () {
  const el = (id) => document.getElementById(id);
  const turnCoordinator = window.createVoiceTurnCoordinator();
  const relayFidelity = window.voiceRelayFidelity;
  const FIDELITY_MARKERS = [
    'You are only the listening and speaking layer for a private voice experiment.',
    'Claude supplies every coaching response as text.',
    'speak that text exactly'
  ];
  const RELAY_INSTRUCTIONS = 'Speak the input text exactly as written. Do not add, remove, replace, summarize, preface, conclude, or interpret any word. Speak only the supplied text, with grounded warmth and conversational ease.';

  const ui = {
    setupCard: el('setupCard'),
    sessionCard: el('sessionCard'),
    endedCard: el('endedCard'),
    accessCode: el('accessCode'),
    adultConsent: el('adultConsent'),
    beginButton: el('beginButton'),
    setupMessage: el('setupMessage'),
    statusLabel: el('statusLabel'),
    statusDetail: el('statusDetail'),
    breathDot: el('breathDot'),
    transcript: el('transcript'),
    exchangeCount: el('exchangeCount'),
    timeRemaining: el('timeRemaining'),
    finishThoughtButton: el('finishThoughtButton'),
    correctButton: el('correctButton'),
    writingButton: el('writingButton'),
    soundButton: el('soundButton'),
    correctionForm: el('correctionForm'),
    correctionText: el('correctionText'),
    cancelCorrectionButton: el('cancelCorrectionButton'),
    writingForm: el('writingForm'),
    writingText: el('writingText'),
    returnToSpeakingButton: el('returnToSpeakingButton'),
    remoteAudio: el('remoteAudio'),
    endButton: el('endButton'),
    costMessage: el('costMessage'),
    finalCost: el('finalCost'),
    startAgainButton: el('startAgainButton')
  };

  const state = {
    config: null,
    accessCode: '',
    peer: null,
    channel: null,
    media: null,
    microphoneTrack: null,
    sessionId: '',
    exchangeCount: 0,
    transcriptTurns: new Map(),
    history: [],
    latestUserText: '',
    latestUserItemId: '',
    responseActive: false,
    speechActive: false,
    openingPending: true,
    openingGenerationDone: false,
    openingAudioStopped: false,
    writingMode: false,
    ended: false,
    timer: null,
    deadline: 0,
    costUsd: 0,
    realtimeCostUsd: 0,
    transcriptionCostUsd: 0,
    claudeCostUsd: 0,
    speechStartedAtMs: null,
    speechStartedAtClock: null,
    transcriptionReportPromise: null,
    budgetEndPending: false,
    lastBudgetPercent: 0,
    audioContext: null,
    channelOpen: false,
    instructionsVerified: false,
    currentRelay: null,
    latestClaudeLatencyMs: 0,
    activeClaudeRequest: null,
    turnTimings: new Map()
  };

  function setStatus(label, detail, mode) {
    ui.statusLabel.textContent = label;
    ui.statusDetail.textContent = detail || '';
    ui.breathDot.className = `breath-dot ${mode || ''}`.trim();
  }

  function setMicrophone(enabled) {
    if (state.microphoneTrack) state.microphoneTrack.enabled = Boolean(enabled);
    ui.finishThoughtButton.disabled = !enabled || state.ended;
  }

  function selectedVoice() {
    const checked = document.querySelector('input[name="voice"]:checked');
    return checked ? checked.value : 'marin';
  }

  function sendEvent(event) {
    if (!state.channel || state.channel.readyState !== 'open') return false;
    state.channel.send(JSON.stringify(event));
    return true;
  }

  function randomTurnId() {
    const value = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return `turn_${value}`;
  }

  function speakClaudeText(text, transcriptKey, timing) {
    state.currentRelay = {
      expected: text,
      spoken: '',
      transcriptKey,
      responseId: '',
      interrupted: false,
      timing: {
        ...timing,
        relayRequestedAt: performance.now()
      }
    };
    sendEvent({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
        instructions: RELAY_INSTRUCTIONS,
        metadata: { purpose: 'claude_exact_relay' },
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }]
        }]
      }
    });
  }

  function appendOrUpdateTurn(key, role, text, extraClass) {
    if (!text) return;
    let turn = state.transcriptTurns.get(key);
    if (!turn) {
      turn = document.createElement('div');
      turn.className = `turn ${role}${extraClass ? ` ${extraClass}` : ''}`;
      const speaker = document.createElement('span');
      speaker.className = 'speaker';
      speaker.textContent = role === 'user' ? 'You' : 'Companion';
      const content = document.createElement('span');
      content.className = 'turn-text';
      turn.append(speaker, content);
      ui.transcript.appendChild(turn);
      state.transcriptTurns.set(key, turn);
    }
    turn.querySelector('.turn-text').textContent = text;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }

  function updateExchangeDisplay() {
    ui.exchangeCount.textContent = `${state.exchangeCount} of ${state.config.maxExchanges} exchanges`;
  }

  function startClock() {
    state.deadline = Date.now() + state.config.sessionMinutes * 60 * 1000;
    function tick() {
      const remaining = Math.max(0, state.deadline - Date.now());
      const totalSeconds = Math.ceil(remaining / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = String(totalSeconds % 60).padStart(2, '0');
      ui.timeRemaining.textContent = `${minutes}:${seconds} remaining`;
      if (remaining <= 0) {
        appendOrUpdateTurn('time-limit', 'companion', 'This private test has reached its session time limit.');
        endSession({ clear: false, reason: 'The time limit was reached.' });
      }
    }
    tick();
    state.timer = window.setInterval(tick, 1000);
  }

  async function loadConfig() {
    try {
      const response = await fetch('/api/kids-on-the-bus/config', { cache: 'no-store' });
      state.config = await response.json();
      if (!state.config.configured) {
        ui.setupMessage.textContent = 'The private test is built but not yet connected to an API key, access code, and testing budget.';
      }
    } catch {
      ui.setupMessage.textContent = 'The private test server is not responding.';
    }
  }

  function unlockAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      state.audioContext = state.audioContext || new AudioContextClass();
      state.audioContext.resume().catch(function () {});
    } catch {
      // The remote audio element remains the primary playback path.
    }
  }

  function showSoundHelp(error) {
    ui.soundButton.classList.remove('hidden');
    const code = error && error.name ? error.name : 'playback_error';
    console.warn('Realtime audio playback warning:', code);
    setStatus('Sound needs a click', 'Click Enable sound. If the tab has a muted-speaker icon, click that icon too.', 'waiting');
  }

  async function ensureSound() {
    try {
      await ui.remoteAudio.play();
      ui.soundButton.classList.add('hidden');
    } catch (error) {
      showSoundHelp(error);
    }
  }

  async function beginSession() {
    ui.setupMessage.textContent = '';
    if (!state.config) await loadConfig();
    if (!state.config || !state.config.configured) {
      ui.setupMessage.textContent = 'This private test is not ready to connect yet.';
      return;
    }
    if (!ui.adultConsent.checked) {
      ui.setupMessage.textContent = 'Please confirm the private-test notice before beginning.';
      return;
    }
    if (!ui.accessCode.value.trim()) {
      ui.setupMessage.textContent = 'Enter the private access code.';
      return;
    }

    state.accessCode = ui.accessCode.value;
    ui.accessCode.value = '';
    ui.beginButton.disabled = true;
    unlockAudio();
    setStatus('Connecting', 'Your microphone will open after the first question.', 'waiting');
    state.ended = false;
    state.openingPending = true;
    state.openingGenerationDone = false;
    state.openingAudioStopped = false;
    state.channelOpen = false;
    state.instructionsVerified = false;
    state.exchangeCount = 0;
    state.history = [];
    state.currentRelay = null;
    state.latestClaudeLatencyMs = 0;
    state.activeClaudeRequest = null;
    state.turnTimings.clear();
    turnCoordinator.reset();

    try {
      state.media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
      state.microphoneTrack = state.media.getAudioTracks()[0];
      setMicrophone(false);

      state.peer = new RTCPeerConnection();
      state.peer.ontrack = (event) => {
        ui.remoteAudio.srcObject = event.streams[0];
        ensureSound();
      };
      state.peer.onconnectionstatechange = () => {
        const connection = state.peer && state.peer.connectionState;
        if (connection === 'failed' || connection === 'disconnected') {
          setStatus('Connection lost', 'End this session and begin again.', 'waiting');
        }
      };
      state.peer.addTrack(state.microphoneTrack, state.media);
      state.channel = state.peer.createDataChannel('oai-events');
      state.channel.addEventListener('message', handleRealtimeEvent);
      state.channel.addEventListener('open', () => {
        state.channelOpen = true;
        startOpeningWhenVerified();
      });

      const offer = await state.peer.createOffer();
      await state.peer.setLocalDescription(offer);
      const response = await fetch(`/api/kids-on-the-bus/realtime/session?voice=${encodeURIComponent(selectedVoice())}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'X-Companion-Code': state.accessCode
        },
        body: offer.sdp
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({ error: 'The voice connection could not start.' }));
        throw new Error(problem.error || 'The voice connection could not start.');
      }
      state.sessionId = response.headers.get('X-Session-Id') || '';
      const answer = { type: 'answer', sdp: await response.text() };
      await state.peer.setRemoteDescription(answer);

      updateExchangeDisplay();
      ui.setupCard.classList.add('hidden');
      ui.sessionCard.classList.remove('hidden');
      startClock();
    } catch (error) {
      stopMedia();
      ui.beginButton.disabled = false;
      ui.setupMessage.textContent = error.message || 'The private voice session could not start.';
    }
  }

  function startOpening() {
    setStatus('Companion is speaking', 'The microphone will open when the first question is finished.', 'speaking');
    sendEvent({
      type: 'response.create',
      response: {
        input: [],
        output_modalities: ['audio'],
        instructions: `Say exactly this opening question, with grounded warmth and no added words: ${state.config.opening}`
      }
    });
  }

  function startOpeningWhenVerified() {
    if (!state.channelOpen || !state.instructionsVerified || state.ended) return;
    startOpening();
  }

  function handleRealtimeEvent(message) {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }

    switch (event.type) {
      case 'session.created': {
        const effectiveInstructions = String(event.session && event.session.instructions || '');
        const verified = FIDELITY_MARKERS.every((marker) => effectiveInstructions.includes(marker));
        if (!verified) {
          setMicrophone(false);
          setStatus('The coaching prompt was not verified', 'The session was stopped before any coaching began.', 'waiting');
          closeConnection(false);
          return;
        }
        state.instructionsVerified = true;
        startOpeningWhenVerified();
        break;
      }
      case 'input_audio_buffer.speech_started':
        turnCoordinator.speechStarted(event.item_id);
        abortPendingClaudeRequest();
        if (state.currentRelay) state.currentRelay.interrupted = true;
        if (state.responseActive && !state.openingPending) stopRealtimeOutput();
        state.speechActive = true;
        state.speechStartedAtMs = Number.isFinite(Number(event.audio_start_ms)) ? Number(event.audio_start_ms) : null;
        state.speechStartedAtClock = Date.now();
        setStatus('Listening', 'Take your time. Natural pauses are okay.', 'listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        state.speechActive = false;
        turnCoordinator.speechStopped(event.item_id);
        if (event.item_id) {
          state.turnTimings.set(event.item_id, {
            turnId: randomTurnId(),
            source: 'voice',
            speechStoppedAt: performance.now()
          });
        }
        state.transcriptionReportPromise = reportMeasuredTranscription(event);
        setStatus('Listening for the end of your thought', 'You can press I\'m finished if the pause feels too long.', 'waiting');
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (event.item_id && event.delta) {
          const prior = state.transcriptTurns.get(event.item_id);
          const priorText = prior ? prior.querySelector('.turn-text').textContent : '';
          appendOrUpdateTurn(event.item_id, 'user', priorText + event.delta);
        }
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const completedSerial = turnCoordinator.transcriptionCompleted(event.item_id);
        const timing = state.turnTimings.get(event.item_id) || {
          turnId: randomTurnId(),
          source: 'voice'
        };
        timing.transcriptReadyAt = performance.now();
        handleCompletedUserTurn(
          event.transcript || '',
          event.item_id || `user-${Date.now()}`,
          completedSerial,
          timing
        );
        break;
      }
      case 'response.created':
        state.responseActive = true;
        if (state.currentRelay && event.response && event.response.id) {
          state.currentRelay.responseId = event.response.id;
        }
        setStatus('Companion is responding', state.latestClaudeLatencyMs ? `Claude prepared this response in ${(state.latestClaudeLatencyMs / 1000).toFixed(1)} seconds.` : 'The breath circle expands for five seconds and settles for seven.', 'waiting');
        break;
      case 'output_audio_buffer.started':
        if (state.currentRelay && state.currentRelay.timing) {
          state.currentRelay.timing.firstAudioAt = performance.now();
          reportLatency(state.currentRelay.timing);
        }
        setStatus('Companion is speaking', 'You can interrupt naturally if you need to.', 'speaking');
        break;
      case 'output_audio_buffer.stopped':
        if (state.openingPending) {
          state.openingAudioStopped = true;
          finishOpeningWhenReady();
        } else if (state.budgetEndPending) {
          endSession({ clear: false, reason: 'The authorized private-testing budget was reached.' });
        } else if (!state.speechActive && !state.ended) {
          setStatus(state.writingMode ? 'Writing mode' : 'Listening', state.writingMode ? 'Write when you are ready.' : 'Take your time. Natural pauses are okay.', state.writingMode ? '' : 'listening');
        }
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.output_text.delta': {
        if (state.currentRelay) {
          state.currentRelay.spoken += event.delta || '';
          break;
        }
        const key = event.item_id || event.response_id || 'current-companion';
        const prior = state.transcriptTurns.get(key);
        const priorText = prior ? prior.querySelector('.turn-text').textContent : '';
        appendOrUpdateTurn(key, 'companion', priorText + (event.delta || ''));
        break;
      }
      case 'response.output_audio_transcript.done':
      case 'response.output_text.done':
        if (state.currentRelay) {
          state.currentRelay.spoken = event.transcript || event.text || state.currentRelay.spoken;
          break;
        }
        appendOrUpdateTurn(event.item_id || event.response_id || 'current-companion', 'companion', event.transcript || event.text || '');
        break;
      case 'response.done':
        state.responseActive = false;
        handleResponseDone(event.response || {});
        break;
      case 'error':
        console.warn('Realtime event error:', event.error && (event.error.code || event.error.type) || 'unknown');
        setStatus('The voice session hit an error', 'You can switch to writing or end and begin again.', 'waiting');
        break;
      default:
        break;
    }
  }

  async function handleCompletedUserTurn(text, itemId, turnSerial, timing) {
    const cleaned = String(text || '').trim();
    if (!cleaned || state.ended) return;
    state.latestUserText = cleaned;
    state.latestUserItemId = itemId;
    appendOrUpdateTurn(itemId, 'user', cleaned);
    state.history.push({ role: 'user', content: cleaned });
    ui.correctButton.disabled = false;
    if (state.transcriptionReportPromise) {
      await state.transcriptionReportPromise;
      state.transcriptionReportPromise = null;
    }
    if (!turnCoordinator.isCurrent(turnSerial) || state.ended) return;
    await routeAndRespond(cleaned, turnSerial, state.history.slice(0, -1), timing);
  }

  function elapsed(start, end) {
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round(end - start) : null;
  }

  function reportLatency(timing, overrides) {
    if (!timing || !state.sessionId) return;
    const cancelled = Boolean(overrides && overrides.cancelled);
    const reportKey = cancelled ? 'cancelReported' : 'audioReported';
    if (timing[reportKey]) return;
    timing[reportKey] = true;
    fetch('/api/kids-on-the-bus/latency', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Code': state.accessCode
      },
      body: JSON.stringify({
        sessionId: state.sessionId,
        turnId: timing.turnId,
        source: timing.source,
        cancelled,
        speechStoppedToTranscriptMs: elapsed(timing.speechStoppedAt, timing.transcriptReadyAt),
        transcriptToClaudeStartMs: elapsed(timing.transcriptReadyAt, timing.claudeRequestAt),
        claudeHeadersMs: timing.claudeHeadersMs,
        claudeCompleteMs: timing.claudeCompleteMs,
        claudeRoundTripMs: elapsed(timing.claudeRequestAt, timing.claudeResponseAt),
        relayRequestToAudioMs: elapsed(timing.relayRequestedAt, timing.firstAudioAt),
        speechStoppedToAudioMs: elapsed(timing.speechStoppedAt, timing.firstAudioAt)
      })
    }).catch(function () {});
  }

  function abortPendingClaudeRequest() {
    const pending = state.activeClaudeRequest;
    if (!pending) return;
    state.activeClaudeRequest = null;
    pending.controller.abort();
    reportLatency(pending.timing, { cancelled: true });
  }

  async function routeAndRespond(text, turnSerial, history, timingRecord) {
    setStatus('Claude is responding', 'The breath circle expands for five seconds and settles for seven.', 'waiting');
    abortPendingClaudeRequest();
    const timing = timingRecord || {
      turnId: randomTurnId(),
      source: 'writing',
      transcriptReadyAt: performance.now()
    };
    timing.claudeRequestAt = performance.now();
    const controller = new AbortController();
    const requestRecord = { controller, turnSerial, timing };
    state.activeClaudeRequest = requestRecord;
    try {
      const startedAt = performance.now();
      const response = await fetch('/api/kids-on-the-bus/claude-response', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Companion-Code': state.accessCode
        },
        body: JSON.stringify({
          sessionId: state.sessionId,
          message: text,
          history
        })
      });
      const data = await response.json().catch(() => ({ error: 'Claude could not respond.' }));
      timing.claudeResponseAt = performance.now();
      timing.claudeHeadersMs = Number(data.latency && data.latency.headersMs);
      timing.claudeCompleteMs = Number(data.latency && data.latency.completeMs);
      if (!turnCoordinator.isCurrent(turnSerial) || state.ended) return;
      if (!response.ok) throw new Error(data.error || 'Claude could not respond.');
      if (data.budget && data.budget.exhausted && !data.response) {
        setMicrophone(false);
        appendOrUpdateTurn('budget-limit', 'companion', 'The authorized private voice-testing budget has been reached. No new coaching response was started.');
        setStatus('Testing budget reached', 'The voice connection has ended. Written mode in the existing app remains available.', 'waiting');
        closeConnection(false);
        return;
      }
      if (data.route !== 'continue_reflection') {
        stopRealtimeOutput();
        setMicrophone(false);
        appendOrUpdateTurn(`safety-${Date.now()}`, 'companion', data.response, 'safety');
        state.history.push({ role: 'assistant', content: data.response });
        speakFixedSafety(data.response);
        setStatus('Reflection paused', 'This fixed safety response did not come from the coaching model.', 'waiting');
        closeConnection(false);
        return;
      }

      const responseText = String(data.response || '').trim();
      if (!responseText) throw new Error('Claude returned no response.');
      state.latestClaudeLatencyMs = Number(data.latency && data.latency.completeMs || Math.round(performance.now() - startedAt));
      state.claudeCostUsd += Number(data.costBreakdown && data.costBreakdown.claudeUsd || data.responseCostUsd || 0);
      state.costUsd += Number(data.responseCostUsd || 0);
      updateCostMessage(Number(data.budget && data.budget.percentUsed || 0), data.budget && data.budget.exhausted);
      state.exchangeCount += 1;
      updateExchangeDisplay();
      if (state.exchangeCount >= state.config.maxExchanges) {
        setMicrophone(false);
      } else if (!state.writingMode) {
        setMicrophone(true);
      }
      const assistantKey = `claude-${Date.now()}`;
      appendOrUpdateTurn(assistantKey, 'companion', responseText);
      state.history.push({ role: 'assistant', content: responseText });
      speakClaudeText(responseText, assistantKey, timing);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      setMicrophone(false);
      setStatus('Claude could not respond', error.message || 'End this session and try again.', 'waiting');
    } finally {
      if (state.activeClaudeRequest === requestRecord) state.activeClaudeRequest = null;
    }
  }

  function stopRealtimeOutput() {
    if (state.currentRelay) state.currentRelay.interrupted = true;
    if (state.responseActive) sendEvent({ type: 'response.cancel' });
    sendEvent({ type: 'output_audio_buffer.clear' });
    state.responseActive = false;
  }

  function speakFixedSafety(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  function handleResponseDone(response) {
    if (response.id && response.usage) reportUsage(response.id, response.usage);

    if (state.openingPending) {
      state.openingGenerationDone = true;
      finishOpeningWhenReady();
      return;
    }

    if (state.currentRelay && state.currentRelay.responseId && (!response.id || state.currentRelay.responseId === response.id)) {
      const relay = state.currentRelay;
      state.currentRelay = null;
      if (!relay.interrupted && !relayFidelity.matches(relay.expected, relay.spoken)) {
        console.warn('Realtime voice relay changed Claude\'s wording. The written response is authoritative.');
        appendOrUpdateTurn(
          `relay-warning-${response.id || Date.now()}`,
          'companion',
          'Voice fidelity warning: the spoken version changed or omitted some of Claude\'s words. Use the written response above as the accurate response.',
          'safety'
        );
        setStatus('The voice changed some wording', 'The written companion response above is authoritative for this test.', 'waiting');
      }
    }

    if (state.exchangeCount >= state.config.maxExchanges && !state.ended) {
      appendOrUpdateTurn('exchange-limit', 'companion', 'This private test has reached its exchange limit. You can end and clear the session when you are ready.');
      setStatus('Exchange limit reached', 'No new voice turns will be sent.', 'waiting');
      setMicrophone(false);
    }
  }

  function finishOpeningWhenReady() {
    if (!state.openingPending || !state.openingGenerationDone || !state.openingAudioStopped) return;
    state.openingPending = false;
    setMicrophone(true);
    setStatus('Listening', 'Take your time. Natural pauses are okay.', 'listening');
  }

  function extractUsage(usage) {
    const input = usage.input_token_details || {};
    const output = usage.output_token_details || {};
    const cached = input.cached_tokens_details || {};
    const inputAudio = Number(input.audio_tokens || 0);
    const outputAudio = Number(output.audio_tokens || 0);
    const inputText = Number(input.text_tokens != null ? input.text_tokens : Math.max(0, Number(usage.input_tokens || 0) - inputAudio));
    const outputText = Number(output.text_tokens != null ? output.text_tokens : Math.max(0, Number(usage.output_tokens || 0) - outputAudio));
    const cachedAudio = Number(cached.audio_tokens || 0);
    const cachedText = Number(cached.text_tokens != null ? cached.text_tokens : Math.max(0, Number(input.cached_tokens || 0) - cachedAudio));
    return {
      inputTextTokens: inputText,
      cachedInputTextTokens: cachedText,
      inputAudioTokens: inputAudio,
      cachedInputAudioTokens: cachedAudio,
      outputTextTokens: outputText,
      outputAudioTokens: outputAudio
    };
  }

  async function reportUsage(responseId, rawUsage) {
    if (!state.sessionId) return;
    try {
      const result = await fetch('/api/kids-on-the-bus/usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Companion-Code': state.accessCode
        },
        body: JSON.stringify({
          sessionId: state.sessionId,
          usageId: responseId,
          kind: 'realtime',
          usage: extractUsage(rawUsage)
        })
      });
      if (!result.ok) return;
      const data = await result.json();
      if (!data.duplicate) {
        state.realtimeCostUsd += Number(data.costBreakdown && data.costBreakdown.realtimeUsd || data.responseCostUsd || 0);
        state.costUsd += Number(data.responseCostUsd || 0);
      }
      const percent = Number(data.budget && data.budget.percentUsed || 0);
      updateCostMessage(percent, data.budget && data.budget.exhausted);
    } catch {
      ui.costMessage.textContent = 'The content-free cost counter could not update. End the private test until it can be checked.';
      setMicrophone(false);
    }
  }

  function reportMeasuredTranscription(event) {
    if (!state.sessionId || state.speechStartedAtClock == null) return Promise.resolve();
    const endMs = Number.isFinite(Number(event.audio_end_ms)) ? Number(event.audio_end_ms) : null;
    let seconds;
    if (state.speechStartedAtMs != null && endMs != null && endMs >= state.speechStartedAtMs) {
      seconds = (endMs - state.speechStartedAtMs) / 1000;
    } else {
      seconds = (Date.now() - state.speechStartedAtClock) / 1000;
    }
    state.speechStartedAtMs = null;
    state.speechStartedAtClock = null;
    if (!(seconds > 0)) return Promise.resolve();
    const randomPart = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return fetch('/api/kids-on-the-bus/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Code': state.accessCode
      },
      body: JSON.stringify({
        sessionId: state.sessionId,
        usageId: `trans_${randomPart}`,
        kind: 'transcription',
        usage: { transcriptionAudioSeconds: seconds }
      })
    }).then((response) => response.ok ? response.json() : null).then((data) => {
      if (!data || data.duplicate) return;
      state.transcriptionCostUsd += Number(data.costBreakdown && data.costBreakdown.transcriptionUsd || data.responseCostUsd || 0);
      state.costUsd += Number(data.responseCostUsd || 0);
      const percent = Number(data.budget && data.budget.percentUsed || 0);
      updateCostMessage(percent, data.budget && data.budget.exhausted);
    }).catch(() => {
      ui.costMessage.textContent = 'The content-free transcription cost counter could not update. End the private test until it can be checked.';
      setMicrophone(false);
    });
  }

  function updateCostMessage(percent, exhausted) {
    ui.costMessage.textContent = `This session: approximately $${state.costUsd.toFixed(3)}. Claude coaching: $${state.claudeCostUsd.toFixed(3)}. Realtime voice: $${state.realtimeCostUsd.toFixed(3)}. Measured live transcription: $${state.transcriptionCostUsd.toFixed(3)}. Authorized test budget used: ${Number(percent || 0).toFixed(1)}%. No words are in the cost log.`;
    for (const threshold of [50, 75, 90]) {
      if (percent >= threshold && state.lastBudgetPercent < threshold) {
        ui.costMessage.textContent += ` The budget has passed ${threshold}%.`;
      }
    }
    state.lastBudgetPercent = Math.max(state.lastBudgetPercent, Number(percent || 0));
    if (exhausted) {
      state.budgetEndPending = true;
      setMicrophone(false);
    }
  }

  function finishThought() {
    if (state.ended || !state.channel || state.channel.readyState !== 'open') return;
    setStatus('Finishing your thought', 'Waiting for the complete transcript before responding.', 'waiting');
    sendEvent({ type: 'input_audio_buffer.commit' });
  }

  function openCorrection() {
    if (!state.latestUserText) return;
    setMicrophone(false);
    stopRealtimeOutput();
    ui.correctionText.value = state.latestUserText;
    ui.correctionForm.classList.remove('hidden');
    ui.writingForm.classList.add('hidden');
    ui.correctionText.focus();
  }

  async function submitTextTurn(text, options) {
    const cleaned = String(text || '').trim();
    if (!cleaned || state.ended) return;
    stopRealtimeOutput();
    const correction = Boolean(options && options.correction);
    const key = correction && state.latestUserItemId ? state.latestUserItemId : `local-user-${Date.now()}`;
    const previousText = state.latestUserText;
    appendOrUpdateTurn(key, 'user', cleaned);

    let priorHistory;
    if (correction) {
      let correctedIndex = -1;
      for (let index = state.history.length - 1; index >= 0; index -= 1) {
        if (state.history[index].role === 'user' && state.history[index].content === previousText) {
          state.history[index] = { role: 'user', content: cleaned };
          correctedIndex = index;
          break;
        }
      }
      if (correctedIndex >= 0) {
        state.history = state.history.slice(0, correctedIndex + 1);
        priorHistory = state.history.slice(0, correctedIndex);
      } else {
        state.history.push({ role: 'user', content: cleaned });
        priorHistory = state.history.slice(0, -1);
      }
    } else {
      state.history.push({ role: 'user', content: cleaned });
      priorHistory = state.history.slice(0, -1);
    }
    state.latestUserText = cleaned;
    state.latestUserItemId = key;
    const serial = turnCoordinator.speechStarted(key);
    turnCoordinator.speechStopped(key);
    turnCoordinator.transcriptionCompleted(key);
    await routeAndRespond(cleaned, serial, priorHistory, {
      turnId: randomTurnId(),
      source: 'writing',
      transcriptReadyAt: performance.now()
    });
  }

  function enterWritingMode() {
    state.writingMode = true;
    setMicrophone(false);
    ui.writingForm.classList.remove('hidden');
    ui.correctionForm.classList.add('hidden');
    setStatus('Writing mode', 'Your next response will be written. The companion will still speak.', '');
    ui.writingText.focus();
  }

  function returnToSpeaking() {
    state.writingMode = false;
    ui.writingForm.classList.add('hidden');
    if (state.exchangeCount < state.config.maxExchanges) setMicrophone(true);
    setStatus('Listening', 'Take your time. Natural pauses are okay.', 'listening');
  }

  function stopMedia() {
    if (state.media) state.media.getTracks().forEach((track) => track.stop());
    state.media = null;
    state.microphoneTrack = null;
    if (state.peer) state.peer.close();
    state.peer = null;
    state.channel = null;
    ui.remoteAudio.srcObject = null;
  }

  function closeConnection(reportEnd) {
    state.ended = true;
    abortPendingClaudeRequest();
    setMicrophone(false);
    stopMedia();
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
    if (reportEnd && state.sessionId) {
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
  }

  function endSession(options) {
    const clear = options && options.clear !== false;
    const reason = options && options.reason;
    window.speechSynthesis && window.speechSynthesis.cancel();
    closeConnection(true);
    if (!clear) {
      setStatus('Session ended', reason || 'No more audio is being sent.', '');
      ui.finishThoughtButton.disabled = true;
      ui.correctButton.disabled = true;
      ui.writingButton.disabled = true;
      return;
    }
    ui.transcript.replaceChildren();
    state.transcriptTurns.clear();
    ui.sessionCard.classList.add('hidden');
    ui.endedCard.classList.remove('hidden');
    ui.finalCost.textContent = `Calculated cost for this session: approximately $${state.costUsd.toFixed(3)}. The cost record contains usage numbers only.`;
    state.accessCode = '';
  }

  function resetPage() {
    window.location.reload();
  }

  ui.beginButton.addEventListener('click', beginSession);
  ui.finishThoughtButton.addEventListener('click', finishThought);
  ui.correctButton.addEventListener('click', openCorrection);
  ui.writingButton.addEventListener('click', enterWritingMode);
  ui.soundButton.addEventListener('click', ensureSound);
  ui.endButton.addEventListener('click', () => endSession({ clear: true }));
  ui.startAgainButton.addEventListener('click', resetPage);
  ui.cancelCorrectionButton.addEventListener('click', () => {
    ui.correctionForm.classList.add('hidden');
    if (!state.writingMode && state.exchangeCount < state.config.maxExchanges) setMicrophone(true);
  });
  ui.correctionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.correctionText.value;
    ui.correctionForm.classList.add('hidden');
    submitTextTurn(text, { correction: true });
  });
  ui.writingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.writingText.value;
    ui.writingText.value = '';
    submitTextTurn(text);
  });
  ui.returnToSpeakingButton.addEventListener('click', returnToSpeaking);
  window.addEventListener('beforeunload', () => closeConnection(true));

  loadConfig();
})();
