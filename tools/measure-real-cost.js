// Local-only dev tool. Runs one real written session and one real voice
// session end to end against the actual companion code, using real provider
// keys, and captures the content-free usage logs each call already emits.
//
// Never commit a key. This script reads them from two local files that stay
// out of git (see .gitignore): .anthropic-test-key and .openai-test-key,
// each containing nothing but the raw key, no quotes, no newline required.
// Delete both files immediately after a run.
//
// Usage from the repository root:
//   node tools/measure-real-cost.js
//
// Output: prints progress to the console and writes two files under
// tools/output/ (gitignored) with the raw usage-log lines for each session,
// one JSON object per line, so a later pass can total them against current
// provider pricing without needing to rerun real calls.

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function readKey(filename, label) {
  const p = path.join(ROOT, filename);
  if (!fs.existsSync(p)) {
    console.error(`Missing ${label} key file at ${p}.`);
    console.error(`Create it with a one-time terminal paste, never by typing the key into chat:`);
    console.error(`  read -s -p "Paste your ${label} key, then press Return: " k && printf '%s' "$k" > "${p}" && unset k`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8').trim();
}

const anthropicKey = readKey('.anthropic-test-key', 'Anthropic');
const openaiKey = readKey('.openai-test-key', 'OpenAI');

const { spawn } = require('node:child_process');

const PORT = 5931;
const BASE = 'http://127.0.0.1:' + PORT;
const ACCESS = 'real-cost-check';

const usageLines = [];

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        COMPANION_ACCESS_CODE: ACCESS,
        COMPANION_PROVIDER: 'anthropic',
        COMPANION_MODEL: 'claude-sonnet-5',
        COMPANION_ANTHROPIC_API_KEY: anthropicKey,
        COMPANION_OPENAI_API_KEY: openaiKey,
        COMPANION_TTS_VOICE: 'onyx',
        COMPANION_VOICE_ENABLED: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      text.split('\n').forEach((line) => {
        if (line.includes('[companion] usage')) usageLines.push(line.trim());
      });
      if (!settled && text.includes('Server running on port')) {
        settled = true;
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write('[server stderr] ' + chunk));
    setTimeout(() => { if (!settled) reject(new Error('server did not start')); }, 8000);
  });
}

async function sendWritten(message, history) {
  const res = await fetch(BASE + '/api/kids-on-the-bus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': ACCESS },
    body: JSON.stringify({ message, history, adultConfirmed: true, country: 'US', interactionMode: 'written' }),
  });
  const data = await res.json();
  if (typeof data.response !== 'string' || data.response.includes('having trouble responding')) {
    throw new Error('Real Anthropic call failed: ' + JSON.stringify(data));
  }
  return data.response;
}

async function sendVoiceTurn(userText, history, voiceSession) {
  const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: userText, response_format: 'mp3' }),
  });
  if (!ttsRes.ok) throw new Error('Stand-in audio generation failed: ' + (await ttsRes.text()));
  const audioBuf = Buffer.from(await ttsRes.arrayBuffer());

  const transcribeRes = await fetch(BASE + '/api/kids-on-the-bus/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/mpeg', 'X-Companion-Access': ACCESS, 'X-Voice-Session': voiceSession },
    body: audioBuf,
  });
  const transcribeData = await transcribeRes.json();
  if (!transcribeRes.ok) throw new Error('Real transcription failed: ' + JSON.stringify(transcribeData));
  const transcript = transcribeData.transcript;

  const coachRes = await fetch(BASE + '/api/kids-on-the-bus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': ACCESS },
    body: JSON.stringify({ message: transcript, history, adultConfirmed: true, country: 'US', interactionMode: 'voice' }),
  });
  const coachData = await coachRes.json();
  if (coachData.response.includes('having trouble responding')) {
    throw new Error('Real Anthropic call failed mid voice-turn: ' + JSON.stringify(coachData));
  }

  const speechRes = await fetch(BASE + '/api/kids-on-the-bus/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Companion-Access': ACCESS },
    body: JSON.stringify({ text: coachData.response }),
  });
  if (!speechRes.ok) throw new Error('Real speech generation failed: ' + (await speechRes.text()));
  await speechRes.arrayBuffer();

  return { transcript, response: coachData.response };
}

const TURNS = [
  "I've been putting off a hard conversation with a coworker for two weeks.",
  "Every time I think about bringing it up my stomach tightens.",
  "It's tight, right under my ribs.",
  "It gets tighter when I imagine her getting defensive.",
  "I think it's protecting me from the conversation going badly.",
  "It's afraid I'll lose the friendship over it.",
  "The critic says I'm making too big a deal of this.",
  "Maybe just that I don't have to have all the words ready before I start.",
  "I think I want to carry forward that I don't need to have it perfectly planned.",
];

(async () => {
  console.log('Verifying keys against the real APIs before running a full session...');
  const anthropicCheck = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', system: 'test', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
  });
  if (!anthropicCheck.ok) {
    console.error('Anthropic key check failed:', anthropicCheck.status, await anthropicCheck.text());
    process.exit(1);
  }
  console.log('Anthropic key is valid.');

  const openaiCheck = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + openaiKey } });
  if (!openaiCheck.ok) {
    console.error('OpenAI key check failed:', openaiCheck.status, await openaiCheck.text());
    process.exit(1);
  }
  console.log('OpenAI key is valid.');

  const child = await startServer();

  console.log('=== WRITTEN SESSION ===');
  let history = [];
  for (const turn of TURNS) {
    const response = await sendWritten(turn, history);
    history.push({ role: 'user', content: turn });
    history.push({ role: 'assistant', content: response });
  }
  const writtenMarker = usageLines.length;
  console.log('written turns complete, usage lines so far:', writtenMarker);

  console.log('=== VOICE SESSION ===');
  let voiceHistory = [];
  const voiceSession = 'real-measurement-session';
  for (const turn of TURNS) {
    const result = await sendVoiceTurn(turn, voiceHistory, voiceSession);
    voiceHistory.push({ role: 'user', content: result.transcript });
    voiceHistory.push({ role: 'assistant', content: result.response });
  }
  console.log('voice turns complete, total usage lines:', usageLines.length);

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'usage-written.jsonl'),
    usageLines.slice(0, writtenMarker).map((l) => l.replace('[companion] usage ', '')).join('\n')
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'usage-voice.jsonl'),
    usageLines.slice(writtenMarker).map((l) => l.replace('[companion] usage ', '')).join('\n')
  );
  console.log('Wrote tools/output/usage-written.jsonl and tools/output/usage-voice.jsonl');

  child.kill();
  console.log('Done. Delete .anthropic-test-key and .openai-test-key now.');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
