'use strict';

const FIXED_RESPONSES = Object.freeze({
  stop_requested:
    "Yes. We'll stop here. You do not need to explain or push through anything. Take whatever space you need, and reach out to someone you trust if you would like support.",
  urgent_self_harm:
    "I'm really glad you said this. I need to stop the reflection because your immediate safety matters more than this exercise. Call your local emergency number now or go to the nearest emergency department. If you are in the United States, call or text 988, and call 911 if you may act now or are in immediate danger. If you can, contact someone you trust who can be with you in person. I cannot contact emergency services or monitor your safety.",
  urgent_harm_to_others:
    "I need to stop the reflection because someone may be in immediate danger. Call your local emergency number now. If you are in the United States, call 911. Put distance between yourself and the person and any weapon if you can do so safely, and contact someone who can be physically present. I cannot contact emergency services or monitor the situation.",
  urgent_medical:
    "I need to stop the exercise. These symptoms could require urgent medical care. Call your local emergency number now or go to the nearest emergency department. If you are in the United States, call 911. Do not use this reflection exercise in place of medical care. I cannot assess or monitor your condition.",
  urgent_disorientation:
    "I need to stop the reflection. Please contact local emergency or crisis support now, and reach someone you trust who can be with you in person. If you are in the United States, call or text 988, and call 911 if you are in immediate danger. I cannot assess your condition, contact help, or monitor your safety.",
  pause_and_support:
    "I'm glad you said this. Let's pause the reflection. Are you in immediate danger right now, or do you think you may act on these thoughts? Please reach out now to a person who can be with you. In the United States, you can call or text 988 for immediate support."
});

function normalized(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function routeSafety(text) {
  const value = normalized(text);

  if (!value) return { route: 'continue_reflection' };

  if (hasAny(value, [
    /^(stop|please stop|stop now)[.!?]*$/,
    /\b(end (this|the) (session|exercise)|i want to stop (this|the) (session|exercise|reflection)|do not continue|don't continue|leave me alone)\b/,
    /\b(no more questions|quit the exercise)\b/
  ])) {
    return { route: 'stop_requested', response: FIXED_RESPONSES.stop_requested };
  }

  const selfHarm = hasAny(value, [
    /\b(kill myself|end my life|take my own life|commit suicide)\b/,
    /\b(suicide|suicidal)\b/,
    /\b(hurt myself|harm myself)\b/
  ]);
  const imminent = hasAny(value, [
    /\b(right now|tonight|today|immediately|about to|going to|will do it|have a plan|made a plan)\b/,
    /\b(can't keep myself safe|cannot keep myself safe|won't be safe)\b/
  ]);
  if (selfHarm && imminent) {
    return { route: 'urgent_self_harm', response: FIXED_RESPONSES.urgent_self_harm };
  }

  if (hasAny(value, [
    /\bkill (him|her|them|someone|my partner|my spouse|my boss)\b/,
    /\bhurt (him|her|them|someone) (right now|tonight|today)\b/,
    /\bi have a (gun|knife|weapon).*(use it|hurt|kill)\b/
  ])) {
    return { route: 'urgent_harm_to_others', response: FIXED_RESPONSES.urgent_harm_to_others };
  }

  if (hasAny(value, [
    /\b(chest pain|can't breathe|cannot breathe|stroke|overdose|severe bleeding)\b/,
    /\b(face is drooping|one side.*numb|took too many pills)\b/
  ])) {
    return { route: 'urgent_medical', response: FIXED_RESPONSES.urgent_medical };
  }

  if (hasAny(value, [
    /\b(don't know where i am|do not know where i am|can't tell what's real|cannot tell what is real)\b/,
    /\b(voices are telling me to|unable to keep myself safe)\b/
  ])) {
    return { route: 'urgent_disorientation', response: FIXED_RESPONSES.urgent_disorientation };
  }

  if (selfHarm || hasAny(value, [
    /\b(wish i were dead|wish i was dead|don't want to wake up|do not want to wake up)\b/,
    /\b(better off dead|no reason to live)\b/
  ])) {
    return { route: 'pause_and_support', response: FIXED_RESPONSES.pause_and_support };
  }

  return { route: 'continue_reflection' };
}

module.exports = { FIXED_RESPONSES, routeSafety };
