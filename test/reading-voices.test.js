// The choice between the two voices, and the things about it that would go
// wrong quietly rather than loudly.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { VOICES, DEFAULT_VOICE, KEYS, pickVoice, spokenLength, voiceSelectHtml } = require('../reading-voices');

test('every voice has a key, a name, and a line that means something read aloud', () => {
  for (const v of VOICES) {
    assert.match(v.key, /^[a-z]+$/, 'a key becomes a folder and a file name');
    assert.ok(v.label && v.note, `${v.key} needs a name and a description`);
    assert.ok(/voice/.test(v.note), `${v.key}'s description should say what it sounds like`);
  }
  assert.ok(KEYS.includes(DEFAULT_VOICE), 'the default has to be one of them');
  assert.equal(new Set(KEYS).size, KEYS.length, 'two voices share a key');
});

test('a reading recorded in only one voice still plays', () => {
  assert.equal(pickVoice(['michael'], 'heart'), 'michael', 'asking for a voice that is missing still plays');
  assert.equal(pickVoice(['heart'], 'heart'), 'heart');
  assert.equal(pickVoice(['michael', 'heart'], 'heart'), 'heart');
  assert.equal(pickVoice(['michael', 'heart'], undefined), DEFAULT_VOICE);
  assert.equal(pickVoice([], 'michael'), null, 'nothing recorded means nothing to play');
});

test('a made-up voice never reaches the bucket as a path', () => {
  assert.equal(pickVoice(['michael', 'heart'], '../../etc'), DEFAULT_VOICE);
  assert.equal(pickVoice(['michael', 'heart'], 'chipmunk'), DEFAULT_VOICE);
});

test('a length is said the way a person would say it', () => {
  assert.equal(spokenLength(20), '1 minute');
  assert.equal(spokenLength(579), '10 minutes');
});

test('the picker names each voice in words, and is not shown when there is no choice', () => {
  const html = voiceSelectHtml('readingVoice', ['michael', 'heart'], 'heart');
  assert.ok(html.includes('<label for="readingVoice">'), 'it needs a real label');
  assert.ok(/Michael, a man’s voice/.test(html), 'a bare name tells a listener nothing');
  assert.ok(/Heart, a woman’s voice/.test(html));
  assert.match(html, /<option value="heart" selected>/, 'the chosen voice is the selected one');
  assert.equal(voiceSelectHtml('readingVoice', ['michael'], 'michael'), '',
    'a dropdown with one item in it is furniture');
});

// Both programmes read the same two keys, so a person who sets a voice in one
// finds it already set in the other.
test('voice and speed are remembered under the same names in both programmes', () => {
  const mbf = fs.readFileSync(path.join(__dirname, '..', 'mbf-reading.js'), 'utf8');
  const course = fs.readFileSync(path.join(__dirname, '..', 'onramp-course.js'), 'utf8');
  for (const src of [mbf, course]) {
    assert.ok(src.includes("'herst-listen-voice'"), 'the voice key must be shared');
    assert.ok(src.includes("'herst-listen-speed'"), 'and the speed key too');
  }
});

// Changing voice mid-reading must not send someone back to the beginning. The
// two recordings are the same words at different paces, so the place is kept as
// a fraction rather than as a number of seconds.
test('changing voice keeps the listener where they were', () => {
  const mbf = fs.readFileSync(path.join(__dirname, '..', 'mbf-reading.js'), 'utf8');
  const course = fs.readFileSync(path.join(__dirname, '..', 'onramp-course.js'), 'utf8');
  for (const src of [mbf, course]) {
    assert.ok(/audio\.currentTime \/ audio\.duration/.test(src), 'the place is kept as a fraction');
    assert.ok(/fraction \* audio\.duration/.test(src), 'and restored against the new length');
    assert.ok(/if \(wasPlaying\) audio\.play\(\)/.test(src), 'a reading that was playing keeps playing');
  }
});
