'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.voiceRelayFidelity = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createVoiceRelayFidelity() {
  function words(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
  }

  function matches(expected, spoken) {
    const left = words(expected);
    const right = words(spoken);
    return left.length === right.length && left.every((word, index) => word === right[index]);
  }

  return { matches, words };
}));
