'use strict';

const NORMAL_OUTPUT_TOKENS = 2048;
const RETRY_OUTPUT_TOKENS = 4096;
// Enough to preserve the entire longest authorized written sitting.
const MAX_AUTHORIZED_HISTORY_MESSAGES = 60;
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
      system: [
        {
          type: 'text',
          text: options.instructions,
          cache_control: { type: 'ephemeral' }
        },
        // The wind-down note is appended after the cached block so the long
        // instructions stay cacheable while the note varies per turn.
        ...(options.contextNote ? [{ type: 'text', text: String(options.contextNote) }] : [])
      ],
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


// Holds back the tail of the stream so a completion marker split across two
// deltas can never reach the reader, and removes any whole marker before the
// text in front of it is released.
function createMarkerScrubber(marker) {
  const hold = Math.max(0, String(marker).length - 1);
  let pending = '';
  let found = false;
  return {
    push(chunk) {
      pending += chunk;
      let index = pending.indexOf(marker);
      while (index !== -1) {
        found = true;
        pending = pending.slice(0, index) + pending.slice(index + marker.length);
        index = pending.indexOf(marker);
      }
      if (pending.length <= hold) return '';
      const release = pending.slice(0, pending.length - hold);
      pending = pending.slice(pending.length - hold);
      return release;
    },
    flush() {
      let index = pending.indexOf(marker);
      while (index !== -1) {
        found = true;
        pending = pending.slice(0, index) + pending.slice(index + marker.length);
        index = pending.indexOf(marker);
      }
      const release = pending;
      pending = '';
      return release;
    },
    get markerSeen() {
      return found;
    }
  };
}

function cleanDelta(text) {
  return String(text).replace(/\u2014/g, ',');
}

// One streamed request. Uses the larger token ceiling from the start: once a
// delta has reached the reader it cannot be taken back, so the retry-on-
// truncation path that the buffered call relies on is not available here.
async function streamClaude(options, onText) {
  const startedAt = performance.now();
  const response = await options.fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: options.signal,
    headers: {
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({
      model: options.model,
      system: [
        { type: 'text', text: options.instructions, cache_control: { type: 'ephemeral' } },
        ...(options.contextNote ? [{ type: 'text', text: String(options.contextNote) }] : [])
      ],
      messages: [
        ...cleanHistory(options.history),
        { role: 'user', content: options.message }
      ],
      output_config: { effort: normalizeClaudeEffort(options.effort) },
      max_tokens: RETRY_OUTPUT_TOKENS,
      stream: true
    })
  });
  const headersAt = performance.now();
  if (!response.ok || !response.body) {
    throw Object.assign(new Error('Claude could not generate the coaching response.'), { statusCode: 502 });
  }
  const usage = { claudeInputTokens: 0, claudeOutputTokens: 0, claudeCacheWriteTokens: 0, claudeCacheReadTokens: 0 };
  let stopReason = '';
  let full = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      let event;
      try {
        event = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === 'message_start') {
        const started = event.message?.usage || {};
        usage.claudeInputTokens += Number(started.input_tokens || 0);
        usage.claudeCacheWriteTokens += Number(started.cache_creation_input_tokens || 0);
        usage.claudeCacheReadTokens += Number(started.cache_read_input_tokens || 0);
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const piece = cleanDelta(event.delta.text || '');
        full += piece;
        if (piece) await onText(piece);
      } else if (event.type === 'message_delta') {
        usage.claudeOutputTokens += Number(event.usage?.output_tokens || 0);
        stopReason = event.delta?.stop_reason || stopReason;
      } else if (event.type === 'error') {
        throw Object.assign(new Error('Claude could not finish the coaching response.'), { statusCode: 502 });
      }
    }
  }
  const completedAt = performance.now();
  const text = full.trim();
  if (!text) throw Object.assign(new Error('Claude returned no coaching response.'), { statusCode: 502 });
  return {
    text,
    incomplete: stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded',
    stopReason,
    usage,
    retried: false,
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
  createMarkerScrubber,
  generateClaudeResponse,
  streamClaude,
  normalizeClaudeEffort,
  textFromPayload
};
