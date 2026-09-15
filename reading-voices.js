// The two voices a listener can choose between, and the small pieces of that
// choice both programmes need to say the same way.
//
// Chad reads his own screen with Kokoro's am_michael and named af_heart as the
// other one he likes, so those are the two. The key is what a page and the
// bucket call the voice. The Kokoro name lives in the script that makes the
// files and never reaches a page.
//
// Adding a third is a row here plus a generation run. Chad's own recordings,
// when he makes them, become a voice like any other: a `chad` row, a folder of
// files, and the pages stop saying a computer read it.
const VOICES = [
  {
    key: 'michael',
    label: 'Michael',
    note: 'A man’s voice, lower and unhurried.',
    computer: true,
  },
  {
    key: 'heart',
    label: 'Heart',
    note: 'A woman’s voice, lighter and a little quicker.',
    computer: true,
  },
];

const DEFAULT_VOICE = 'michael';
const KEYS = VOICES.map((v) => v.key);

function voiceByKey(key) {
  return VOICES.find((v) => v.key === key) || null;
}

// What a listener asked for, if it exists for this reading; otherwise whatever
// does, in the order above. A reading recorded in only one voice still plays.
function pickVoice(available, wanted) {
  const have = Array.isArray(available) ? available : Object.keys(available || {});
  if (wanted && have.includes(wanted)) return wanted;
  if (have.includes(DEFAULT_VOICE)) return DEFAULT_VOICE;
  return have.find((k) => KEYS.includes(k)) || null;
}

// "9 minutes" is what a person deciding whether to press play wants. Under a
// minute would read as "0 minutes" without the floor.
function spokenLength(totalSeconds) {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return minutes + (minutes === 1 ? ' minute' : ' minutes');
}

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The picker, with a real label, listing only the voices that exist for the
// readings on this page. One voice means no choice to offer, so nothing is
// rendered: a dropdown with one item is furniture.
function voiceSelectHtml(id, availableKeys, chosen) {
  const offered = VOICES.filter((v) => availableKeys.includes(v.key));
  if (offered.length < 2) return '';
  const options = offered
    .map((v) => `<option value="${v.key}"${v.key === chosen ? ' selected' : ''}>` +
      `${escapeAttr(v.label)}, ${escapeAttr(v.note.replace(/\.$/, '').toLowerCase())}</option>`)
    .join('');
  return `<label for="${id}">Voice</label><select id="${id}">${options}</select>`;
}

module.exports = {
  VOICES, DEFAULT_VOICE, KEYS,
  voiceByKey, pickVoice, spokenLength, voiceSelectHtml,
};
