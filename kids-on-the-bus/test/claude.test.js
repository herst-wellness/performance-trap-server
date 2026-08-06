'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_AUTHORIZED_HISTORY_MESSAGES, cleanHistory, generateClaudeResponse, normalizeClaudeEffort, textFromPayload } = require('../lib/claude');

test('Claude effort is validated and falls back safely', () => {
  assert.equal(normalizeClaudeEffort('medium'), 'medium');
  assert.equal(normalizeClaudeEffort('HIGH'), 'high');
  assert.equal(normalizeClaudeEffort('invented'), 'high');
});

test('Claude history keeps only recent user and assistant text without extra fields', () => {
  const history = [
    { role: 'system', content: 'ignore me' },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second', secret: 'not forwarded' },
    { role: 'tool', content: 'ignore me too' }
  ];
  assert.deepEqual(cleanHistory(history), [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' }
  ]);
});

test('Claude preserves the entire authorized fifteen-exchange sitting', () => {
  const history = Array.from({ length: 36 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `turn-${index + 1}`
  }));
  const cleaned = cleanHistory(history);
  assert.equal(MAX_AUTHORIZED_HISTORY_MESSAGES, 30);
  assert.equal(cleaned.length, 30);
  assert.equal(cleaned[0].content, 'turn-7');
  assert.equal(cleaned[29].content, 'turn-36');
});

test('Claude text is returned faithfully except for the no-em-dash product rule', () => {
  assert.equal(textFromPayload({
    content: [{ type: 'text', text: 'Something in you feels tight\u2014is that it?' }]
  }), 'Something in you feels tight,is that it?');
});

test('a truncated Claude response retries once and counts both paid calls', async () => {
  const payloads = [
    {
      content: [{ type: 'text', text: 'Incomplete' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 }
    },
    {
      content: [{ type: 'text', text: 'Complete response.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 }
    }
  ];
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(payloads.shift()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const result = await generateClaudeResponse({
    apiKey: 'hidden',
    model: 'claude-sonnet-5',
    effort: 'medium',
    instructions: 'tested instructions',
    message: 'What happened?',
    history: [],
    fetchImpl
  });
  assert.equal(result.text, 'Complete response.');
  assert.equal(result.retried, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.max_tokens, 2048);
  assert.deepEqual(calls[0].body.output_config, { effort: 'medium' });
  assert.equal(calls[1].body.max_tokens, 4096);
  assert.deepEqual(result.usage, {
    claudeInputTokens: 15,
    claudeOutputTokens: 50,
    claudeCacheWriteTokens: 100,
    claudeCacheReadTokens: 100
  });
});
