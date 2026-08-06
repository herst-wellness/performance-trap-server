'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matches, words } = require('../public/relay-fidelity');

test('relay comparison ignores punctuation, capitalization, and curly apostrophes', () => {
  assert.deepEqual(words('Something in you doesn\u2019t want that.'), ['something', 'in', 'you', "doesn't", 'want', 'that']);
  assert.equal(matches('Can you feel that?', 'Can you feel that.'), true);
});

test('relay comparison rejects added, missing, or replaced coaching words', () => {
  assert.equal(matches('Something in you feels tight.', 'Something in you feels very tight.'), false);
  assert.equal(matches('Where does that land?', 'Where does it land?'), false);
  assert.equal(matches('Stay with that tightness.', 'Stay with tightness.'), false);
});
