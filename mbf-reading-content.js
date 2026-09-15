// The Mind/Body Foundations readings, as web pages.
//
// The chapters live as markdown in ./mbf-readings, one file per reading, named
// <module>-<code>-<slug>.md. They are copied from the curriculum in Dropbox,
// with Modules 1 to 3 taking the rewritten versions from the voice pass. Keeping
// them as files rather than as strings in here means a corrected chapter is a
// file copy, and a diff shows what actually changed in the prose.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'mbf-readings');

// A practice doc is the written instructions for a meditation. It sits with the
// readings rather than the journals, and the module page groups it with its audio.
const PRACTICE = /^(02b|03b|04b|02c|05a)$/;

function titleFrom(body, fallback) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function load() {
  let files = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
  } catch (e) {
    return [];
  }
  return files.map((file) => {
    const m = file.match(/^(\d\d)-(\d\d[a-z]?)-(.+)\.md$/);
    if (!m) return null;
    const body = fs.readFileSync(path.join(DIR, file), 'utf8');
    return {
      module: Number(m[1]),
      code: m[2].toUpperCase(),
      slug: m[3],
      file,
      title: titleFrom(body, m[3]),
      practice: PRACTICE.test(m[2]),
      words: body.split(/\s+/).filter(Boolean).length,
      body,
    };
  }).filter(Boolean);
}

const READINGS = load();
const BY_KEY = new Map(READINGS.map((r) => [r.module + '/' + r.slug, r]));

function findReading(moduleNumber, slug) {
  return BY_KEY.get(Number(moduleNumber) + '/' + slug) || null;
}

function readingsForModule(moduleNumber) {
  return READINGS.filter((r) => r.module === Number(moduleNumber));
}

module.exports = { READINGS, findReading, readingsForModule };
