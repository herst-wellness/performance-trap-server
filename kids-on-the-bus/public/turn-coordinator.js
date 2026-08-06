'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = { createVoiceTurnCoordinator: factory };
  } else {
    root.createVoiceTurnCoordinator = factory;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createVoiceTurnCoordinator() {
  let currentSerial = 0;
  let activeSerial = 0;
  const itemSerials = new Map();

  return {
    reset() {
      currentSerial = 0;
      activeSerial = 0;
      itemSerials.clear();
    },

    speechStarted(itemId) {
      currentSerial += 1;
      activeSerial = currentSerial;
      if (itemId) itemSerials.set(itemId, activeSerial);
      return activeSerial;
    },

    speechStopped(itemId) {
      if (itemId && activeSerial) itemSerials.set(itemId, activeSerial);
      return activeSerial;
    },

    transcriptionCompleted(itemId) {
      let serial = itemId ? itemSerials.get(itemId) : 0;
      if (!serial) serial = activeSerial;
      if (!serial) {
        currentSerial += 1;
        activeSerial = currentSerial;
        serial = currentSerial;
      }
      if (itemId) itemSerials.delete(itemId);
      return serial;
    },

    isCurrent(serial) {
      return Boolean(serial) && serial === currentSerial;
    }
  };
}));
