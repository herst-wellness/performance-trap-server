'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_AUTHORIZED_HISTORY_MESSAGES, cleanHistory, createMarkerScrubber, generateClaudeResponse, normalizeClaudeEffort, streamClaude, textFromPayload } = require('../lib/claude');
const { Readable } = require('node:stream');

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

test('Claude preserves the entire longest authorized written sitting', () => {
  const history = Array.from({ length: 72 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `turn-${index + 1}`
  }));
  const cleaned = cleanHistory(history);
  assert.equal(MAX_AUTHORIZED_HISTORY_MESSAGES, 60);
  assert.equal(cleaned.length, 60);
  assert.equal(cleaned[0].content, 'turn-13');
  assert.equal(cleaned[59].content, 'turn-72');
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

const MARKER = '[[SITTING COMPLETE]]';

function scrubAll(chunks) {
  const scrubber = createMarkerScrubber(MARKER);
  let out = '';
  for (const chunk of chunks) out += scrubber.push(chunk);
  out += scrubber.flush();
  return { out, seen: scrubber.markerSeen };
}

test('the completion marker never reaches the reader, however the stream is chopped up', () => {
  const whole = scrubAll(['Take that with you. ', MARKER]);
  assert.equal(whole.out, 'Take that with you. ');
  assert.equal(whole.seen, true);

  const split = scrubAll(['Take that with you. [[SITT', 'ING COMP', 'LETE]]']);
  assert.equal(split.out, 'Take that with you. ', 'a marker split across three deltas still never appears');
  assert.equal(split.seen, true);

  const midText = scrubAll(['Before ', MARKER, ' after']);
  assert.equal(midText.out, 'Before  after');
  assert.equal(midText.seen, true);

  const plain = scrubAll(['Nothing to hide here.']);
  assert.equal(plain.out, 'Nothing to hide here.');
  assert.equal(plain.seen, false);

  const oneChar = scrubAll(MARKER.split(''));
  assert.equal(oneChar.out, '', 'even one character at a time');
  assert.equal(oneChar.seen, true);
});

test('a partial marker is held back rather than shown and taken away again', () => {
  const scrubber = createMarkerScrubber(MARKER);
  const source = 'Stay with that. [[SITTING';
  const released = scrubber.push(source);
  assert.doesNotMatch(released, /\[/, 'nothing that could still become a marker is released');
  assert.ok(source.startsWith(released), 'what is released is always a prefix of what arrived');
  assert.equal(released.length, source.length - (MARKER.length - 1), 'exactly one marker-length tail is withheld');
  assert.equal(released + scrubber.flush(), source, 'the withheld tail arrives when the stream ends');
});

test('a streamed response reports its own text, usage, and truncation', async () => {
  const frames = [
    { type: 'message_start', message: { usage: { input_tokens: 12, cache_read_input_tokens: 900 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'What happens' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: ' in your chest—right then?' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } }
  ];
  const body = Readable.from(frames.map((f) => Buffer.from(`event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`)));
  const pieces = [];
  const result = await streamClaude({
    apiKey: 'k', model: 'claude-sonnet-5', effort: 'high', instructions: 'i', message: 'm', history: [],
    fetchImpl: async (url, init) => {
      assert.equal(JSON.parse(init.body).stream, true);
      assert.equal(JSON.parse(init.body).max_tokens, 4096, 'streaming asks for the larger ceiling up front');
      return { ok: true, status: 200, body };
    }
  }, (piece) => { pieces.push(piece); });
  assert.equal(pieces.join(''), 'What happens in your chest,right then?');
  assert.doesNotMatch(result.text, /—/, 'em dashes are replaced as the text streams');
  assert.equal(result.usage.claudeInputTokens, 12);
  assert.equal(result.usage.claudeCacheReadTokens, 900);
  assert.equal(result.usage.claudeOutputTokens, 30);
  assert.equal(result.incomplete, false);
  assert.equal(result.retried, false);
});
