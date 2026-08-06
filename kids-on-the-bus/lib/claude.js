'use strict';

const NORMAL_OUTPUT_TOKENS = 2048;
const RETRY_OUTPUT_TOKENS = 4096;
const MAX_AUTHORIZED_HISTORY_MESSAGES = 30;
const ALLOWED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function normalizeClaudeEffort(value, fallback = 'high') {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_EFFORTS.has(normalized) ? normalized : fallback;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-MAX_AUTHORIZED_HISTORY_MESSAGES)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 6000) }));
}

function textFromPayload(payload) {
  if (!payload || !Array.isArray(payload.content)) return '';
  return payload.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .replace(/\u2014/g, ',')
    .trim();
}

async function requestClaude(options, maxTokens) {
  const startedAt = performance.now();
  const response = await options.fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: options.signal,
    headers: {
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model,
      system: [{
        type: 'text',
        text: options.instructions,
        cache_control: { type: 'ephemeral' }
      }],
      messages: [
        ...cleanHistory(options.history),
        { role: 'user', content: options.message }
      ],
      output_config: { effort: normalizeClaudeEffort(options.effort) },
      max_tokens: maxTokens
    })
  });
  const headersAt = performance.now();
  if (!response.ok) {
    throw Object.assign(new Error('Claude could not generate the coaching response.'), { statusCode: 502 });
  }
  const payload = await response.json();
  const completedAt = performance.now();
  const text = textFromPayload(payload);
  if (!text) throw Object.assign(new Error('Claude returned no coaching response.'), { statusCode: 502 });
  const usage = payload.usage || {};
  return {
    text,
    incomplete: payload.stop_reason === 'max_tokens' || payload.stop_reason === 'model_context_window_exceeded',
    stopReason: payload.stop_reason || '',
    usage: {
      claudeInputTokens: Number(usage.input_tokens || 0),
      claudeOutputTokens: Number(usage.output_tokens || 0),
      claudeCacheWriteTokens: Number(usage.cache_creation_input_tokens || 0),
      claudeCacheReadTokens: Number(usage.cache_read_input_tokens || 0)
    },
    latency: {
      headersMs: Math.round(headersAt - startedAt),
      completeMs: Math.round(completedAt - startedAt)
    }
  };
}

async function generateClaudeResponse(options) {
  let result = await requestClaude(options, NORMAL_OUTPUT_TOKENS);
  let retried = false;
  if (result.incomplete) {
    retried = true;
    const firstUsage = result.usage;
    const retry = await requestClaude(options, RETRY_OUTPUT_TOKENS);
    if (retry.incomplete) {
      throw Object.assign(new Error('Claude response remained incomplete after one retry.'), { statusCode: 502 });
    }
    result = {
      ...retry,
      usage: Object.fromEntries(
        Object.keys(firstUsage).map((key) => [key, Number(firstUsage[key] || 0) + Number(retry.usage[key] || 0)])
      ),
      latency: {
        headersMs: result.latency.headersMs + retry.latency.headersMs,
        completeMs: result.latency.completeMs + retry.latency.completeMs
      }
    };
  }
  return { ...result, retried };
}

module.exports = {
  MAX_AUTHORIZED_HISTORY_MESSAGES,
  cleanHistory,
  generateClaudeResponse,
  normalizeClaudeEffort,
  textFromPayload
};
