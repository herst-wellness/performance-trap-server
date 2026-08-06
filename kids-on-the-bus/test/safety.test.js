'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routeSafety } = require('../lib/safety');

test('ordinary reflection continues', () => {
  assert.equal(routeSafety('I want to stop worrying about what she thinks of me.').route, 'continue_reflection');
});

test('a direct stop request stops without calling coaching', () => {
  const result = routeSafety('Please stop.');
  assert.equal(result.route, 'stop_requested');
  assert.match(result.response, /stop here/i);
});

test('imminent self-harm language receives fixed urgent routing', () => {
  const result = routeSafety('I have a plan to kill myself tonight.');
  assert.equal(result.route, 'urgent_self_harm');
  assert.match(result.response, /988/);
});

test('passive death language pauses instead of continuing embodiment', () => {
  const result = routeSafety('Sometimes I wish I were dead.');
  assert.equal(result.route, 'pause_and_support');
  assert.match(result.response, /immediate danger/i);
});

test('urgent medical language stops the exercise', () => {
  assert.equal(routeSafety("I have chest pain and can't breathe.").route, 'urgent_medical');
});
