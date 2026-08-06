# Kids on the Bus replacement

This folder contains the private native-voice Kids on the Bus companion that replaces the previous written and record-send-listen versions at `/reflect/kids-on-the-bus`.

The rest of `performance-trap-server` remains unchanged. The existing astrology, book, audio, email, signup, health, and static-file routes continue to be handled by the main server.

## Runtime architecture

- Claude Sonnet 5 at high effort is the coaching brain.
- OpenAI Realtime listens, transcribes, and speaks Claude's exact response.
- OpenAI Realtime has no coaching discretion.
- The approved Module 2 prompt and safety overlay are fingerprinted under `canonical/module2/`.
- The transcript RAG is not connected to the deployed application.

## Required Render settings

The page can load without these settings, but a voice session cannot begin until all are present:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `COMPANION_ACCESS_CODE`
- `PRIVATE_TEST_BUDGET_USD`

For Chad's current private test, the chosen access code is `kids`. The remaining authorized testing amount on August 6, 2026 is approximately `$1.92`. Confirm the current ledger before setting a new deployment budget. Do not silently reset the authorized total to `$5` on every deployment.

Optional controls:

- `ANTHROPIC_MODEL=claude-sonnet-5`
- `ANTHROPIC_EFFORT=high`
- `REALTIME_SESSION_MINUTES=20`
- `REALTIME_MAX_EXCHANGES=12`
- `REALTIME_DATA_DIR` for a persistent private ledger location

The usage and latency ledgers contain numbers and random identifiers only. They never contain session speech, transcripts, coaching responses, memories, names, or email addresses.

## Verification

Run:

```sh
npm run check
npm test
```

Do not expose the page to another tester until the deployed route has passed a Chad-only smoke test.
