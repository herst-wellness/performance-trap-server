'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DURATION_FIELDS = [
  'speechStoppedToTranscriptMs',
  'transcriptToClaudeStartMs',
  'claudeHeadersMs',
  'claudeCompleteMs',
  'claudeRoundTripMs',
  'relayRequestToAudioMs',
  'speechStoppedToAudioMs'
];

function duration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function pruneEntries(entries, now = Date.now(), retentionDays = 30) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => Date.parse(entry.at) >= cutoff);
}

class LatencyLedger {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.retentionDays = options.retentionDays || 30;
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  write(entries) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  add(record) {
    const entries = pruneEntries(this.read(), Date.now(), this.retentionDays);
    const entry = {
      at: new Date().toISOString(),
      sessionId: String(record.sessionId || ''),
      turnId: String(record.turnId || ''),
      source: record.source === 'writing' ? 'writing' : 'voice',
      effort: String(record.effort || ''),
      cancelled: Boolean(record.cancelled)
    };
    for (const field of DURATION_FIELDS) entry[field] = duration(record[field]);
    entries.push(entry);
    this.write(entries);
    return entry;
  }
}

module.exports = {
  DURATION_FIELDS,
  LatencyLedger,
  duration,
  pruneEntries
};
