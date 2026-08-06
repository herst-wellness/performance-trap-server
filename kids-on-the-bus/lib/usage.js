'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RATES = Object.freeze({
  inputText: 4,
  cachedInput: 0.4,
  inputAudio: 32,
  outputText: 24,
  outputAudio: 64,
  transcriptionPerMinute: 0.017,
  claudeInput: 3,
  claudeOutput: 15,
  claudeCacheWrite: 3.75,
  claudeCacheRead: 0.3
});

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeUsage(raw = {}) {
  return {
    inputTextTokens: finiteNonNegative(raw.inputTextTokens),
    cachedInputTextTokens: finiteNonNegative(raw.cachedInputTextTokens),
    inputAudioTokens: finiteNonNegative(raw.inputAudioTokens),
    cachedInputAudioTokens: finiteNonNegative(raw.cachedInputAudioTokens),
    outputTextTokens: finiteNonNegative(raw.outputTextTokens),
    outputAudioTokens: finiteNonNegative(raw.outputAudioTokens),
    transcriptionAudioSeconds: finiteNonNegative(raw.transcriptionAudioSeconds),
    claudeInputTokens: finiteNonNegative(raw.claudeInputTokens),
    claudeOutputTokens: finiteNonNegative(raw.claudeOutputTokens),
    claudeCacheWriteTokens: finiteNonNegative(raw.claudeCacheWriteTokens),
    claudeCacheReadTokens: finiteNonNegative(raw.claudeCacheReadTokens)
  };
}

function calculateBreakdown(usage, rates = DEFAULT_RATES) {
  const u = normalizeUsage(usage);
  const uncachedText = Math.max(0, u.inputTextTokens - u.cachedInputTextTokens);
  const uncachedAudio = Math.max(0, u.inputAudioTokens - u.cachedInputAudioTokens);
  const cached = u.cachedInputTextTokens + u.cachedInputAudioTokens;
  const realtimeUsd = (
    uncachedText * rates.inputText +
    uncachedAudio * rates.inputAudio +
    cached * rates.cachedInput +
    u.outputTextTokens * rates.outputText +
    u.outputAudioTokens * rates.outputAudio
  ) / 1_000_000;
  const transcriptionUsd = u.transcriptionAudioSeconds / 60 * rates.transcriptionPerMinute;
  const claudeUsd = (
    u.claudeInputTokens * rates.claudeInput +
    u.claudeOutputTokens * rates.claudeOutput +
    u.claudeCacheWriteTokens * rates.claudeCacheWrite +
    u.claudeCacheReadTokens * rates.claudeCacheRead
  ) / 1_000_000;
  return { realtimeUsd, transcriptionUsd, claudeUsd, totalUsd: realtimeUsd + transcriptionUsd + claudeUsd };
}

function calculateCost(usage, rates = DEFAULT_RATES) {
  return calculateBreakdown(usage, rates).totalUsd;
}

function pruneEntries(entries, now = Date.now(), retentionDays = 30) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => Date.parse(entry.at) >= cutoff);
}

class UsageLedger {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.budgetUsd = finiteNonNegative(options.budgetUsd);
    this.rates = { ...DEFAULT_RATES, ...(options.rates || {}) };
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

  entries() {
    const current = this.read();
    const pruned = pruneEntries(current, Date.now(), this.retentionDays);
    if (pruned.length !== current.length) this.write(pruned);
    return pruned;
  }

  total() {
    return this.entries().reduce((sum, entry) => sum + finiteNonNegative(entry.costUsd), 0);
  }

  status() {
    const usedUsd = this.total();
    const remainingUsd = Math.max(0, this.budgetUsd - usedUsd);
    return {
      budgetUsd: this.budgetUsd,
      usedUsd,
      remainingUsd,
      percentUsed: this.budgetUsd > 0 ? Math.min(100, usedUsd / this.budgetUsd * 100) : 100,
      exhausted: this.budgetUsd <= 0 || usedUsd >= this.budgetUsd
    };
  }

  add(record) {
    const entries = this.entries();
    const duplicate = entries.find((entry) => entry.usageId === record.usageId);
    if (duplicate) return { duplicate: true, entry: duplicate, status: this.status() };

    const usage = normalizeUsage(record.usage);
    const costBreakdown = calculateBreakdown(usage, this.rates);
    const entry = {
      at: new Date().toISOString(),
      sessionId: String(record.sessionId || ''),
      usageId: String(record.usageId || ''),
      model: String(record.model || 'gpt-realtime-2.1'),
      usage,
      costBreakdown,
      costUsd: costBreakdown.totalUsd
    };
    entries.push(entry);
    this.write(entries);
    return { duplicate: false, entry, status: this.status() };
  }
}

module.exports = {
  DEFAULT_RATES,
  UsageLedger,
  calculateBreakdown,
  calculateCost,
  normalizeUsage,
  pruneEntries
};
