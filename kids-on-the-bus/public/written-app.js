'use strict';

(function () {
  const el = (id) => document.getElementById(id);
  const ui = {
    setupCard: el('setupCard'),
    sessionCard: el('sessionCard'),
    endedCard: el('endedCard'),
    noticeConsent: el('noticeConsent'),
    researchConsent: el('researchConsent'),
    beginButton: el('beginButton'),
    setupMessage: el('setupMessage'),
    transcript: el('transcript'),
    sessionReference: el('sessionReference'),
    endedReference: el('endedReference'),
    feedbackReference: el('feedbackReference'),
    exchangeCount: el('exchangeCount'),
    timeRemaining: el('timeRemaining'),
    responseForm: el('responseForm'),
    responseText: el('responseText'),
    sendButton: el('sendButton'),
    voiceControls: el('voiceControls'),
    recordButton: el('recordButton'),
    recordButtonLabel: el('recordButtonLabel'),
    voiceStatus: el('voiceStatus'),
    consultOffer: el('consultOffer'),
    statusLabel: el('statusLabel'),
    statusDetail: el('statusDetail'),
    breathDot: el('breathDot'),
    copyButton: el('copyButton'),
    downloadButton: el('downloadButton'),
    endButton: el('endButton'),
    retentionMessage: el('retentionMessage'),
    finalCost: el('finalCost'),
    feedbackForm: el('feedbackForm'),
    feedbackComment: el('feedbackComment'),
    feedbackMessage: el('feedbackMessage'),
    startAgainButton: el('startAgainButton')
  };

  const state = {
    config: null,
    visitId: '',
    referral: null,
    device: null,
    returningBrowser: null,
    sessionId: '',
    sessionReference: '',
    history: [],
    exportTurns: [],
    exchangeCount: 0,
    costUsd: 0,
    ended: false,
    endReported: false,
    deadline: 0,
    timer: null,
    controller: null,
    sharedSitting: false,
    mediaStream: null,
    mediaRecorder: null,
    audioChunks: [],
    recordingStartedAt: 0,
    recordingTimer: null,
    recordingDeadlineTimer: null,
    discardRecording: false,
    transcribing: false,
    transcriptionController: null,
    lastTranscriptValue: '',
    transcriptEdited: false,
    consultOffered: false,
    playbackAudio: null,
    playbackUrl: '',
    playbackButton: null,
    playbackFetching: false
  };

  const MAX_RECORDING_MS = 2 * 60 * 1000;

  function setStatus(label, detail, waiting) {
    ui.statusLabel.textContent = label;
    ui.statusDetail.textContent = detail || '';
    ui.breathDot.className = waiting ? 'breath-dot waiting' : 'breath-dot';
  }

  function setVoiceStatus(message, isError) {
    ui.voiceStatus.textContent = message;
    ui.voiceStatus.className = isError ? 'voice-status error' : 'voice-status';
  }

  function supportedRecordingType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const choices = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    if (typeof MediaRecorder.isTypeSupported !== 'function') return 'audio/webm';
    return choices.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function browserCanRecord() {
    return Boolean(navigator.mediaDevices?.getUserMedia && supportedRecordingType());
  }

  function updateVoiceAvailability() {
    const browserReady = browserCanRecord();
    const serviceReady = Boolean(state.config?.voiceInputAvailable);
    ui.recordButton.disabled = !browserReady || !serviceReady || !state.sessionId || state.ended || state.transcribing || Boolean(state.controller);
    if (!browserReady) setVoiceStatus('Voice input is unavailable in this browser. You can continue by writing.', true);
    else if (state.config && !serviceReady) setVoiceStatus('Voice input is temporarily unavailable. You can continue by writing.', true);
  }

  function clearRecordingTimers() {
    if (state.recordingTimer) window.clearInterval(state.recordingTimer);
    if (state.recordingDeadlineTimer) window.clearTimeout(state.recordingDeadlineTimer);
    state.recordingTimer = null;
    state.recordingDeadlineTimer = null;
  }

  function stopMediaTracks() {
    if (state.mediaStream) state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }

  function resetRecordButton() {
    ui.recordButton.classList.remove('recording');
    ui.recordButton.setAttribute('aria-pressed', 'false');
    ui.recordButtonLabel.textContent = 'Speak your response';
    updateVoiceAvailability();
  }

  function discardVoiceRecording() {
    state.discardRecording = true;
    clearRecordingTimers();
    if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
    stopMediaTracks();
    if (state.transcriptionController) state.transcriptionController.abort();
    state.transcriptionController = null;
    state.transcribing = false;
    resetRecordButton();
  }

  async function transcribeVoice(blob, durationMs) {
    state.transcribing = true;
    state.transcriptionController = new AbortController();
    ui.recordButton.disabled = true;
    ui.sendButton.disabled = true;
    ui.recordButtonLabel.textContent = 'Transcribing...';
    setVoiceStatus('Turning your recording into editable text.', false);
    try {
      const response = await fetch('/api/kids-on-the-bus/transcribe', {
        method: 'POST',
        signal: state.transcriptionController.signal,
        headers: {
          'Content-Type': blob.type || 'audio/webm',
          'X-Companion-Session-Id': state.sessionId,
          'X-Audio-Duration-Ms': String(Math.round(durationMs))
        },
        body: blob
      });
      const data = await response.json();
      if (!response.ok) {
        const problem = new Error(data.error || 'Your recording could not be transcribed.');
        problem.serverReported = true;
        throw problem;
      }
      const transcript = String(data.text || '').trim();
      if (!transcript) throw new Error('No words were detected. Try again or write your response.');
      const existing = ui.responseText.value.trimEnd();
      ui.responseText.value = existing ? `${existing}\n\n${transcript}` : transcript;
      state.lastTranscriptValue = ui.responseText.value;
      state.transcriptEdited = false;
      state.costUsd += Number(data.transcriptionCostUsd || 0);
      setVoiceStatus('Transcript added. Review or edit it before sending.', false);
      ui.responseText.focus();
    } catch (error) {
      if (error.name !== 'AbortError') {
        setVoiceStatus(error.message || 'Your recording could not be transcribed. You can continue by writing.', true);
        if (!error.serverReported) trackEvent('voiceClientFailures');
      }
    } finally {
      state.transcriptionController = null;
      state.transcribing = false;
      state.audioChunks = [];
      state.mediaRecorder = null;
      resetRecordButton();
      if (!state.ended && !state.controller) ui.sendButton.disabled = false;
    }
  }

  function stopVoiceRecording() {
    if (!state.mediaRecorder || state.mediaRecorder.state !== 'recording') return;
    clearRecordingTimers();
    ui.recordButton.disabled = true;
    ui.recordButtonLabel.textContent = 'Transcribing...';
    setVoiceStatus('Recording stopped. Preparing the transcript.', false);
    trackEvent('voiceRecordingStops');
    state.mediaRecorder.stop();
    stopMediaTracks();
  }

  async function startVoiceRecording() {
    if (!state.sessionId || state.ended || state.controller || state.transcribing || !browserCanRecord()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      state.mediaStream = stream;
      state.audioChunks = [];
      state.discardRecording = false;
      const mimeType = supportedRecordingType();
      const recorder = new MediaRecorder(stream, { mimeType });
      state.mediaRecorder = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) state.audioChunks.push(event.data);
      });
      recorder.addEventListener('error', () => {
        clearRecordingTimers();
        stopMediaTracks();
        setVoiceStatus('Recording stopped unexpectedly. You can try again or continue by writing.', true);
        trackEvent('voiceClientFailures');
        resetRecordButton();
        ui.sendButton.disabled = false;
      });
      recorder.addEventListener('stop', () => {
        const durationMs = Math.min(MAX_RECORDING_MS, Math.max(0, Date.now() - state.recordingStartedAt));
        const chunks = state.audioChunks.slice();
        const discarded = state.discardRecording;
        state.discardRecording = false;
        if (discarded) return;
        if (durationMs < 500 || chunks.length === 0) {
          state.audioChunks = [];
          state.mediaRecorder = null;
          setVoiceStatus('No speech was recorded. Try again or continue by writing.', true);
          trackEvent('voiceClientFailures');
          resetRecordButton();
          ui.sendButton.disabled = false;
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        transcribeVoice(blob, durationMs);
      });
      recorder.start();
      state.recordingStartedAt = Date.now();
      ui.recordButton.classList.add('recording');
      ui.recordButton.setAttribute('aria-pressed', 'true');
      ui.recordButtonLabel.textContent = 'Stop recording';
      ui.sendButton.disabled = true;
      trackEvent('voiceRecordingStarts');
      const updateTimer = () => {
        const elapsed = Math.min(MAX_RECORDING_MS, Date.now() - state.recordingStartedAt);
        const totalSeconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        setVoiceStatus(`Recording ${minutes}:${seconds}. Select Stop recording when you are finished.`, false);
      };
      updateTimer();
      state.recordingTimer = window.setInterval(updateTimer, 500);
      state.recordingDeadlineTimer = window.setTimeout(stopVoiceRecording, MAX_RECORDING_MS);
    } catch (error) {
      stopMediaTracks();
      const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
      setVoiceStatus(denied
        ? 'Microphone access was not granted. You can continue by writing.'
        : 'The microphone could not start. You can continue by writing.', true);
      trackEvent(denied ? 'microphoneDenials' : 'voiceClientFailures');
      resetRecordButton();
    }
  }

  function toggleVoiceRecording() {
    if (state.mediaRecorder?.state === 'recording') stopVoiceRecording();
    else startVoiceRecording();
  }

  function revealConsultOffer() {
    if (!ui.consultOffer || state.consultOffered) return;
    state.consultOffered = true;
    ui.consultOffer.classList.remove('hidden');
    trackEvent('consultOfferShown');
    ui.consultOffer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function stopSpeechPlayback() {
    if (state.playbackAudio) {
      state.playbackAudio.onended = null;
      state.playbackAudio.onerror = null;
      state.playbackAudio.pause();
      state.playbackAudio = null;
    }
    if (state.playbackUrl) {
      URL.revokeObjectURL(state.playbackUrl);
      state.playbackUrl = '';
    }
    if (state.playbackButton) {
      state.playbackButton.textContent = 'Hear this';
      state.playbackButton.disabled = state.ended;
      state.playbackButton = null;
    }
    state.playbackFetching = false;
  }

  async function toggleSpeakTurn(button, text) {
    if (state.playbackButton === button && !state.playbackFetching) {
      stopSpeechPlayback();
      return;
    }
    if (state.playbackFetching) return;
    stopSpeechPlayback();
    if (!state.sessionId || state.ended) return;
    state.playbackButton = button;
    state.playbackFetching = true;
    button.disabled = true;
    button.textContent = 'Preparing voice...';
    try {
      const response = await fetch('/api/kids-on-the-bus/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, text })
      });
      if (!response.ok) {
        let message = 'The voice is unavailable right now.';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      state.costUsd += Number(response.headers.get('X-Speech-Cost-Usd') || 0);
      const blob = await response.blob();
      state.playbackUrl = URL.createObjectURL(blob);
      state.playbackAudio = new Audio(state.playbackUrl);
      state.playbackAudio.onended = stopSpeechPlayback;
      state.playbackAudio.onerror = stopSpeechPlayback;
      state.playbackFetching = false;
      button.disabled = false;
      button.textContent = 'Stop';
      await state.playbackAudio.play();
    } catch (error) {
      state.playbackFetching = false;
      stopSpeechPlayback();
      setVoiceStatus(error.message || 'The voice is unavailable right now. You can keep reading.', true);
    }
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
    if (role !== 'user' && state.config?.voicePlaybackAvailable) {
      const speak = document.createElement('button');
      speak.type = 'button';
      speak.className = 'speak-button';
      speak.textContent = 'Hear this';
      speak.addEventListener('click', () => toggleSpeakTurn(speak, text));
      turn.appendChild(speak);
    }
    ui.transcript.appendChild(turn);
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
    state.exportTurns.push({ role: speaker.textContent, text });
  }

  function updateExchangeDisplay() {
    ui.exchangeCount.textContent = `${state.exchangeCount} of ${state.config.maxExchanges} exchanges`;
  }

  function screenCategory() {
    const width = Number(window.screen?.width || window.innerWidth || 0);
    if (!width) return 'Unknown';
    if (width < 640) return 'Small';
    if (width < 1200) return 'Medium';
    return 'Large';
  }

  function deviceContext() {
    const ua = navigator.userAgent || '';
    const tablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
    const phone = !tablet && /Mobi|iPhone|Android/i.test(ua);
    let browserFamily = 'Other';
    if (/Edg\//.test(ua)) browserFamily = 'Edge';
    else if (/OPR\//.test(ua)) browserFamily = 'Opera';
    else if (/Chrome\//.test(ua)) browserFamily = 'Chrome';
    else if (/Firefox\//.test(ua)) browserFamily = 'Firefox';
    else if (/Safari\//.test(ua)) browserFamily = 'Safari';
    let operatingSystemFamily = 'Other';
    if (/Windows/i.test(ua)) operatingSystemFamily = 'Windows';
    else if (/Android/i.test(ua)) operatingSystemFamily = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) operatingSystemFamily = 'iOS or iPadOS';
    else if (/Mac OS X|Macintosh/i.test(ua)) operatingSystemFamily = 'macOS';
    else if (/Linux/i.test(ua)) operatingSystemFamily = 'Linux';
    return {
      category: tablet ? 'Tablet' : phone ? 'Phone' : 'Computer',
      browserFamily,
      operatingSystemFamily,
      screenSizeCategory: screenCategory()
    };
  }

  function referralContext() {
    const params = new URLSearchParams(window.location.search);
    return {
      referringPage: document.referrer,
      utmSource: params.get('utm_source') || '',
      utmMedium: params.get('utm_medium') || '',
      utmCampaign: params.get('utm_campaign') || '',
      utmContent: params.get('utm_content') || ''
    };
  }

  function returningBrowser() {
    try {
      const key = 'herst_mbf_companion_visited';
      const returning = window.localStorage.getItem(key) === '1';
      window.localStorage.setItem(key, '1');
      return returning;
    } catch {
      return false;
    }
  }

  function startClock() {
    state.deadline = Date.now() + state.config.sessionMinutes * 60 * 1000;
    function tick() {
      const remaining = Math.max(0, state.deadline - Date.now());
      const secondsLeft = Math.ceil(remaining / 1000);
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = String(secondsLeft % 60).padStart(2, '0');
      ui.timeRemaining.textContent = `${minutes}:${seconds} remaining`;
      if (remaining <= 0) endSession(false, 'time_limit', 'This sitting has reached its time limit.');
    }
    tick();
    state.timer = window.setInterval(tick, 1000);
  }

  async function loadConfig() {
    try {
      const response = await fetch('/api/kids-on-the-bus/config', { cache: 'no-store' });
      state.config = await response.json();
      if (!state.config.configured) ui.setupMessage.textContent = 'The written companion is not ready yet.';
    } catch {
      ui.setupMessage.textContent = 'The written companion is not responding.';
    } finally {
      await registerVisit();
    }
  }

  async function registerVisit() {
    if (state.visitId) return;
    state.referral ||= referralContext();
    state.device ||= deviceContext();
    if (state.returningBrowser == null) state.returningBrowser = returningBrowser();
    try {
      const response = await fetch('/api/kids-on-the-bus/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referral: state.referral,
          device: state.device,
          returningBrowser: state.returningBrowser
        })
      });
      const data = await response.json();
      if (response.ok) state.visitId = String(data.visitId || '');
    } catch {
      // A reporting problem must never prevent someone from using the companion.
    }
  }

  function trackVisitEvent(eventName, keepalive) {
    if (!state.visitId) return Promise.resolve();
    return fetch('/api/kids-on-the-bus/visit/event', {
      method: 'POST',
      keepalive: Boolean(keepalive),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitId: state.visitId, eventName })
    }).catch(function () {});
  }

  async function beginSession() {
    ui.setupMessage.textContent = '';
    if (!state.config) await loadConfig();
    trackVisitEvent('beginAttempts');
    if (!state.config || !state.config.configured) {
      trackVisitEvent('configurationBlocks');
      return;
    }
    if (!ui.noticeConsent.checked) {
      ui.setupMessage.textContent = 'Please read and acknowledge the information notice before beginning.';
      trackVisitEvent('noticeBlocks');
      return;
    }
    state.sharedSitting = ui.researchConsent.checked;
    ui.beginButton.disabled = true;
    try {
      const response = await fetch('/api/kids-on-the-bus/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acknowledged: true,
          noticeVersion: state.config.noticeVersion,
          shareSitting: state.sharedSitting,
          visitId: state.visitId,
          referral: state.referral,
          device: state.device,
          returningBrowser: state.returningBrowser
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The sitting could not begin.');
      state.sessionId = data.sessionId;
      state.sessionReference = data.sessionReference;
      state.history = [];
      state.exportTurns = [];
      state.exchangeCount = 0;
      state.costUsd = 0;
      state.ended = false;
      state.endReported = false;
      state.lastTranscriptValue = '';
      state.transcriptEdited = false;
      state.consultOffered = false;
      ui.consultOffer.classList.add('hidden');
      updateExchangeDisplay();
      ui.sessionReference.textContent = `Reference ${state.sessionReference}`;
      ui.retentionMessage.textContent = state.sharedSitting
        ? 'You chose to share this sitting for research. It is stored separately for up to 90 days.'
        : 'Herst Wellness keeps structured usage information, not the exact words in this sitting.';
      addTurn('companion', data.opening);
      ui.setupCard.classList.add('hidden');
      ui.sessionCard.classList.remove('hidden');
      setStatus('Respond when you are ready', 'Write, or choose Speak your response when you want the microphone to turn on.', false);
      setVoiceStatus('Or speak one response at a time.', false);
      updateVoiceAvailability();
      startClock();
      ui.responseText.focus();
    } catch (error) {
      ui.setupMessage.textContent = error.message;
      ui.beginButton.disabled = false;
      trackVisitEvent('sessionStartErrors');
    }
  }

  async function submitResponse(event) {
    event.preventDefault();
    const message = ui.responseText.value.trim();
    if (!message || state.ended || state.controller) return;
    if (state.transcriptEdited) trackEvent('voiceTranscriptCorrections');
    state.lastTranscriptValue = '';
    state.transcriptEdited = false;
    ui.responseText.value = '';
    addTurn('user', message);
    const priorHistory = state.history.slice();
    state.history.push({ role: 'user', content: message });
    ui.responseText.disabled = true;
    ui.sendButton.disabled = true;
    ui.recordButton.disabled = true;
    setStatus('The companion is responding', 'The breath circle expands for five seconds and settles for seven.', true);
    state.controller = new AbortController();
    try {
      const response = await fetch('/api/kids-on-the-bus/claude-response', {
        method: 'POST',
        signal: state.controller.signal,
        headers: { 'Content-Type': 'application/json' },
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
        const reason = data.route === 'stop_requested' ? 'stop_requested' : 'safety';
        endSession(false, reason, 'This reflection has paused here. You can copy or download it before clearing the page.');
        return;
      }
      if (data.sittingComplete) revealConsultOffer();
      if (state.exchangeCount >= state.config.maxExchanges) {
        endSession(false, 'exchange_limit', 'This sitting has reached its exchange limit. You can copy or download it before clearing the page.');
        return;
      }
      setStatus('Your turn', 'Write when you are ready.', false);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setStatus('The companion could not respond', error.message, false);
        trackEvent('responseFailures');
      }
    } finally {
      state.controller = null;
      if (!state.ended) {
        ui.responseText.disabled = false;
        ui.sendButton.disabled = false;
        updateVoiceAvailability();
        ui.responseText.focus();
      }
    }
  }

  function sessionFetch(path, body, keepalive) {
    if (!state.sessionId) return Promise.resolve();
    return fetch(path, {
      method: 'POST',
      keepalive: Boolean(keepalive),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, ...body })
    }).catch(function () {});
  }

  function trackEvent(eventName, keepalive) {
    return sessionFetch('/api/kids-on-the-bus/event', { eventName }, keepalive);
  }

  function reportEnd(reason, keepalive) {
    if (!state.sessionId || state.endReported) return;
    state.endReported = true;
    sessionFetch('/api/kids-on-the-bus/session/end', { reason }, keepalive);
  }

  function endSession(clear, reason, message) {
    if (!state.endReported) reportEnd(reason || 'intentional', true);
    state.ended = true;
    stopSpeechPlayback();
    document.querySelectorAll('.speak-button').forEach((button) => { button.disabled = true; });
    discardVoiceRecording();
    if (state.controller) state.controller.abort();
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
    ui.responseText.disabled = true;
    ui.sendButton.disabled = true;
    if (!clear) {
      setStatus('Sitting ended', message || 'No more responses will be sent.', false);
      return;
    }
    ui.transcript.replaceChildren();
    state.history = [];
    state.exportTurns = [];
    ui.sessionCard.classList.add('hidden');
    ui.endedCard.classList.remove('hidden');
    ui.endedReference.textContent = state.sessionReference;
    ui.feedbackReference.textContent = state.sessionReference;
    ui.finalCost.textContent = `Estimated AI cost for this sitting: $${state.costUsd.toFixed(3)}.`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function formattedSitting() {
    const lines = [
      'Mind/Body Foundations Companion',
      `Session reference: ${state.sessionReference}`,
      '',
      ...state.exportTurns.flatMap((turn) => [`${turn.role}:`, turn.text, ''])
    ];
    return lines.join('\n').trim();
  }

  async function copySitting() {
    const text = formattedSitting();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied', 'The sitting is on your clipboard.', false);
      trackEvent('copyButtonUse');
    } catch {
      setStatus('Copy was not available', 'Use Download sitting instead.', false);
    }
  }

  function downloadSitting() {
    const text = formattedSitting();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mindbody-foundations-${state.sessionReference}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    trackEvent('downloadButtonUse');
  }

  async function submitFeedback(event) {
    event.preventDefault();
    ui.feedbackMessage.textContent = '';
    const ratings = Array.from(ui.feedbackForm.querySelectorAll('select')).map((select) => Number(select.value));
    if (ratings.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) {
      ui.feedbackMessage.textContent = 'Please choose a rating for each question.';
      return;
    }
    const response = await fetch('/api/kids-on-the-bus/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, ratings, comment: ui.feedbackComment.value })
    });
    const data = await response.json();
    if (!response.ok) {
      ui.feedbackMessage.textContent = data.error || 'The check-in could not be saved.';
      return;
    }
    ui.feedbackMessage.textContent = 'Thank you. Your check-in was saved.';
    Array.from(ui.feedbackForm.elements).forEach((control) => { control.disabled = true; });
  }

  function clearFromButton() {
    trackEvent('endAndClearButtonUse', true);
    const reason = state.exchangeCount > 0 ? 'completed' : 'intentional';
    endSession(true, reason);
  }

  ui.beginButton.addEventListener('click', beginSession);
  ui.responseForm.addEventListener('submit', submitResponse);
  ui.recordButton.addEventListener('click', toggleVoiceRecording);
  ui.responseText.addEventListener('input', () => {
    if (state.lastTranscriptValue && ui.responseText.value !== state.lastTranscriptValue) state.transcriptEdited = true;
  });
  ui.copyButton.addEventListener('click', copySitting);
  ui.downloadButton.addEventListener('click', downloadSitting);
  ui.endButton.addEventListener('click', clearFromButton);
  ui.feedbackForm.addEventListener('submit', submitFeedback);
  ui.startAgainButton.addEventListener('click', () => window.location.reload());
  document.querySelectorAll('.tracked-link').forEach((link) => {
    link.addEventListener('click', () => trackEvent(link.dataset.event || 'conversionClicks', true));
  });
  function trackBrowserError() {
    if (state.sessionId) trackEvent('browserErrors', true);
    else trackVisitEvent('browserErrors', true);
  }
  window.addEventListener('error', trackBrowserError);
  window.addEventListener('unhandledrejection', trackBrowserError);
  window.addEventListener('beforeunload', () => {
    if (state.mediaRecorder?.state === 'recording') discardVoiceRecording();
    if (state.sessionId && !state.endReported) reportEnd('page_exit', true);
    else if (!state.sessionId) trackVisitEvent('pageExitsBeforeStart', true);
  });
  updateVoiceAvailability();
  loadConfig();
})();
