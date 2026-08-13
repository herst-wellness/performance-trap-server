# Kids on the Bus written private test

The live route at `/reflect/kids-on-the-bus` now offers a written-only reflection. Voice testing is paused because early tester feedback showed that automatic turn detection and audio flow interfered with reflective pauses.

The former voice implementation has not been deleted. Its client code, relay checks, timing tools, and tests remain in this repository and in Git history so voice work can resume later without reconstructing it.

The rest of `performance-trap-server` remains unchanged. The astrology, book, audio, email, signup, health, and static-file routes continue to be handled by the main server.

## Current runtime

- Claude Sonnet 5 at high effort remains the coaching brain.
- The approved Module 2 prompt and safety overlay remain fingerprinted under `canonical/module2/`.
- No microphone, transcription, Realtime voice session, or spoken playback is started.
- The written sitting allows 30 exchanges over 60 minutes by default.
- The entire authorized sitting fits within the history sent to Claude.
- The transcript RAG is not connected to the deployed application.

## Required Render settings

- `ANTHROPIC_API_KEY`
- `COMPANION_ACCESS_CODE`
- `PRIVATE_TEST_BUDGET_USD`

`OPENAI_API_KEY` may remain in Render for the other existing Performance Trap features, but Kids on the Bus no longer uses it while voice is paused.

Optional controls:

- `ANTHROPIC_MODEL=claude-sonnet-5`
- `ANTHROPIC_EFFORT=high`
- `WRITTEN_SESSION_MINUTES=60`
- `WRITTEN_MAX_EXCHANGES=30`
- `REALTIME_DATA_DIR` for the existing persistent private cost ledger

The cost ledger contains numbers and random identifiers only. It never contains written responses, coaching responses, memories, names, or email addresses.

## Verification

Run:

```sh
npm run check
npm test
```

After deployment, verify that the page says `Written reflection`, does not request microphone permission, accepts the existing private access code, and clears the on-screen conversation when the sitting ends.
