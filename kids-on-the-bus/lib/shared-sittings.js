'use strict';

const fs = require('node:fs');
const path = require('node:path');

function safeReference(value) {
  const reference = String(value || '');
  if (!/^MBF-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference)) throw new Error('Invalid session reference.');
  return reference;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

class SharedSittingStore {
  constructor(dataDir, options = {}) {
    this.transcriptDir = path.join(dataDir, 'shared-sittings');
    this.feedbackDir = path.join(dataDir, 'feedback-comments');
    this.retentionDays = options.retentionDays || 90;
  }

  transcriptPath(reference) {
    return path.join(this.transcriptDir, `${safeReference(reference)}.json`);
  }

  feedbackPath(reference) {
    return path.join(this.feedbackDir, `${safeReference(reference)}.json`);
  }

  begin(record) {
    const reference = safeReference(record.sessionReference);
    const consentDate = new Date(record.consentDate || Date.now()).toISOString();
    const sitting = {
      sessionReference: reference,
      consentDate,
      noticeVersion: String(record.noticeVersion || ''),
      retentionDays: this.retentionDays,
      deleteAfter: new Date(Date.parse(consentDate) + this.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      researchPermission: true,
      publicQuotationPermission: false,
      turns: []
    };
    atomicWrite(this.transcriptPath(reference), sitting);
    return sitting;
  }

  appendTurn(reference, userText, companionText) {
    const filePath = this.transcriptPath(reference);
    const sitting = readJson(filePath);
    if (!sitting || !sitting.researchPermission) return null;
    sitting.turns.push({
      at: new Date().toISOString(),
      user: String(userText || '').slice(0, 12000),
      companion: String(companionText || '').slice(0, 12000)
    });
    atomicWrite(filePath, sitting);
    return sitting;
  }

  saveFeedbackComment(reference, comment) {
    const value = String(comment || '').trim().slice(0, 1000);
    if (!value) return null;
    const saved = {
      sessionReference: safeReference(reference),
      submittedAt: new Date().toISOString(),
      retentionDays: this.retentionDays,
      deleteAfter: new Date(Date.now() + this.retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      comment: value
    };
    atomicWrite(this.feedbackPath(reference), saved);
    return saved;
  }

  read(reference) {
    this.prune();
    return readJson(this.transcriptPath(reference));
  }

  readFeedback(reference) {
    this.prune();
    return readJson(this.feedbackPath(reference));
  }

  delete(reference) {
    const files = [this.transcriptPath(reference), this.feedbackPath(reference)];
    let deleted = false;
    for (const filePath of files) {
      try {
        fs.unlinkSync(filePath);
        deleted = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return deleted;
  }

  listMetadata() {
    this.prune();
    let names = [];
    try {
      names = fs.readdirSync(this.transcriptDir);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return names
      .filter((name) => /^MBF-[A-Z0-9]{4}-[A-Z0-9]{4}\.json$/.test(name))
      .map((name) => readJson(path.join(this.transcriptDir, name)))
      .filter(Boolean)
      .map((sitting) => ({
        sessionReference: sitting.sessionReference,
        consentDate: sitting.consentDate,
        noticeVersion: sitting.noticeVersion,
        deleteAfter: sitting.deleteAfter,
        turnCount: Array.isArray(sitting.turns) ? sitting.turns.length : 0
      }));
  }

  prune(now = Date.now()) {
    for (const directory of [this.transcriptDir, this.feedbackDir]) {
      let names = [];
      try {
        names = fs.readdirSync(directory);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const filePath = path.join(directory, name);
        const record = readJson(filePath);
        if (record && Date.parse(record.deleteAfter) <= now) fs.unlinkSync(filePath);
      }
    }
  }
}

module.exports = { SharedSittingStore, safeReference };
