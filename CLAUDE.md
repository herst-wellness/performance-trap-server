# Performance Trap Companion: Claude Code project memory

Last updated: July 31, 2026

## Purpose of this file

This is the project handoff for Claude Code. Read it completely before changing the repository.

Chad Herst is not technical. Explain decisions and results in plain language. Take normal, safe implementation steps without making him operate the terminal. Never expose, print, commit, or paste secret values. Ask Chad only when a choice materially changes the product, privacy, safety, or public experience.

## Permanent writing preference

Never use an em dash in anything written for Chad, in application copy, in prompts, or in generated companion responses. Use a period, comma, colon, parentheses, or a simple hyphen.

## Permanent communication rule: talk to Chad like he has no coding experience

This overrides normal engineering-update habits for every response about this project, not just the first one.

Lead with what happened and what it means for Chad. Never lead with coding terminology, command counts, internal file locations, or a play-by-play of terminal activity. Do not write things like "ran 2 commands," "branched off main," "npm test passed," or "committed b97f3ee." Translate every technical fact into what it actually means:

- A branch is a protected working copy where changes can be developed without affecting the existing app.
- A commit is a saved checkpoint in the project's history.
- Main is the approved version the live application is normally built from.
- Uncommitted changes are changes on the Mac that have not yet been safely recorded.
- Tests passed means the named automated checks found no problems. Always say what was tested and what was not tested.

Use a technical term only when Chad needs it to make a decision, and define it in plain language in the same sentence.

Structure routine progress updates this way:

- **What I found** - the issue, in ordinary language.
- **What I did** - the result, not the commands.
- **What this means** - whether the existing app is protected, whether anything changed on the live website, and whether the work is safely saved.
- **What you need to do** - usually "Nothing right now." If Chad needs to act, one clear step at a time.
- **What happens next** - one short sentence about the next meaningful outcome.

Always make these five states explicit rather than letting Chad infer which one the work is in: changed only on the Mac; safely recorded as a checkpoint; uploaded to GitHub for review; approved and merged; deployed to the live website.

If a mistake happens, say so plainly and say whether the live application was affected: "I changed the wrong local copy. I corrected it. The live application was not affected."

Keep routine updates short. Do not narrate every command. Interrupt Chad only when he needs to make a genuine product decision, approve a consequential action, or test something he can experience directly, for example reviewing a proposed companion response or looking at a live page. Those moments keep their own clear format; they are not "routine updates" to compress.

## Product goal

We built a private, branded, non-persistent web companion for the Module 2 Kids on the Bus exercise from Chad's Mind:Body Foundations training.

The companion is an awareness and preparation tool. It helps an adult explore one emotionally activating moment, notice the bodily impact, recognize a protective part, and understand what may be at stake. It is not Chad, therapy, medical care, diagnosis, crisis support, or an autonomous replacement for coaching.

The next goal has two parts:

1. Add more of Chad's actual coaching repertoire, grounded only in his transcripts. Initial areas are encouraging breath, titrating feeling tones, tuning into the trade, expanding options, and the circular returns among story, sensation, and parts.
2. Add an oral experience. The recommended first version is controlled push-to-talk speech input and spoken output while retaining the existing Claude companion and deterministic safety controls.

Deepen the coaching method before building fully realtime speech. Voice will make the experience more intimate, but the move library is what will make it more like Chad.

## Repository and deployment

- GitHub repository: `https://github.com/herst-wellness/performance-trap-server`
- Live private prototype: `https://performance-trap-server.onrender.com/reflect/kids-on-the-bus`
- Hosting: Render
- Main branch deployed commit reported by Render: `667e9dd5f2d057463e37315e344434eebc140b55`
- The companion pull request was merged into `main`.
- A local working copy currently exists at:
  `/Users/chadherst/Documents/Codex/2026-07-29/dude-these-emails-are-such-great/work/performance-trap-server`

Before working, inspect the actual repository and synchronize safely:

```bash
git status --short
git fetch origin
git checkout main
git pull --ff-only
npm test
```

Do not discard local or user changes. Do not force push. Work on a new feature branch and open a pull request. Preserve all unrelated server behavior.

## Existing server behavior that must be preserved

`server.js` is an established Node HTTP server that also contains:

- the Performance Trap astrology chart and reading engine;
- Mailchimp signup and tagging;
- Resend nurture email behavior;
- `/listen/*` audio pages;
- `/book` audiobook player;
- `/reading`;
- `/tts`;
- `/expand`;
- `/optin`;
- `/health`; and
- static file serving from `public/`.

The companion was added surgically. Do not rewrite the whole server or remove unrelated features.

## Companion implementation

Important repository files:

- `companion.js`: page, API route, provider calls, access control, deterministic safety routing, non-persistent session UI, copy/download/clear behavior.
- `companion-prompt.txt`: approved Module 2 coaching prompt, version 0.5.
- `companion-safety-overlay.txt`: crisis, privacy, prompt-injection, and retention policy.
- `test/companion.test.js`: running application test.
- `test/module-2-product-safety-evaluation-set.jsonl`: 25 product-safety cases.
- `public/Herst-Wellness-Logo-cropped.jpg`: existing brand asset.
- `server.js`: imports `handleCompanionRoute` and gives it the first opportunity to handle companion routes.
- `package.json`: `npm test` runs `node --test test/*.test.js`.

Routes:

- Page: `GET /reflect/kids-on-the-bus`
- Companion API: `POST /api/kids-on-the-bus`

The server removes the query string before route matching. Preserve that behavior.

## Environment variables

The live Render service uses these names:

- The public written companion does not require `COMPANION_ACCESS_CODE`. The separate administrative reporting code remains required.
- `COMPANION_PROVIDER=anthropic`
- `COMPANION_MODEL=claude-sonnet-5`
- `ANTHROPIC_API_KEY`: already configured as a secret.
- `OPENAI_API_KEY`: already configured for other server features and may be used for the first voice layer.

Other existing Mailchimp, Resend, and application variables must remain untouched.

Never put actual values in source code, tests, documentation, logs, screenshots, or chat. Never expose an ordinary API key to browser JavaScript.

## Current verification status

### Coaching fidelity

The approved version 0.5 coaching prompt was evaluated on 22 transcript-grounded cases.

- Three consecutive isolated runs passed 22 of 22 cases.
- No critical failures.
- No diagnosis, privacy disclosure, trauma invention, Chad impersonation, or em dashes.
- Cases were scored for fidelity, pacing, safety, and voice.

Key artifacts are in:

`/Users/chadherst/Documents/Codex/2026-07-29/dude-these-emails-are-such-great/outputs`

Especially:

- `module-2-evaluation-set.jsonl`
- `module-2-evaluation-rubric.md`
- `module-2-companion-v0.5-validation-report.md`
- `module-2-companion-v0.5-run-3.json`
- `module-2-companion-v0.5-scorecard-run-3.jsonl`
- `module-2-circular-invitation-families.md`
- `module-2-interactive-review-log.md`
- `module-2-guardrail-review-log.md`

Do not silently rewrite these approved cases. Add new cases separately and preserve regression coverage.

### Product safety

There are 25 synthetic hazard cases:

- 8 crisis and autonomy cases;
- 6 privacy cases;
- 6 prompt-injection cases; and
- 5 data-retention cases.

The current repository test starts the actual server and sends all 25 cases through its API. Safety cases are intercepted by deterministic controls before the coaching model. As of July 31, 2026, `npm test` passes all 25 cases locally.

Passing this automated suite is not a clinical, legal, privacy, or security certification.

Before any new private tester is invited, still verify:

- the actual Anthropic retention configuration and the accuracy of the provider notice;
- that application and Render logs contain no journal content;
- browser network traffic sends journal content only to the intended server and provider;
- session clearing and deletion language are accurate;
- crisis routing thresholds and fixed copy receive qualified clinical review;
- privacy notice, consent, and health-data obligations receive qualified legal/privacy review; and
- a kill switch and incident owner exist.

## Nonnegotiable product boundaries

1. The deployed companion must not access the raw transcript RAG.
2. It must not reveal, retrieve, confirm, or compare another client's information.
3. It must have no Dropbox, Gmail, browser, file, RAG, marketing, or other outbound tools.
4. Urgent crisis and medical routes bypass the coaching model and return reviewed fixed copy.
5. Version 1 is for adults who confirm they are at least 18.
6. The application does not save the journal or response after the session.
7. Journal content must not enter analytics, advertising, session replay, marketing profiles, error reports, URLs, email, or ordinary logs.
8. Copy and download are controlled by the user. Nothing is automatically sent to Chad.
9. Never call the interaction confidential, privileged, HIPAA-compliant, or instantly deleted everywhere.
10. Do not diagnose, prescribe, interpret trauma, recover memories, lead exposure, reparent, or push through flooding.
11. Do not promise that a provider retains nothing unless the production account has verified retention controls.
12. The tool may say it is based on Chad's method. It must never say, imply, or role-play that it is Chad.

## Chad's coaching method

The method is circular, not a questionnaire and not a fixed sequence.

### The central arc

1. Begin with the story.
2. Stay with the story long enough for the triggering center to become real.
3. Keep an implicit or occasional explicit background question: what is the worst of it?
4. Earn the U-turn from story into genuine bodily sensation.
5. Stay with the sensation. Explore quality, geography, movement, and change without assigning meaning.
6. Let parts emerge only after embodied activation, except when a do-it-right or pleasing part is unmistakably appearing in the live interaction.
7. Give a part enough time to be seen and acknowledged. A reflection may be the entire response.
8. Ask what is worst for that part only after it has been present and witnessed.
9. Return from the part to the body in two beats: invite the recognition to land, pause, then ask what the body notices.
10. Continue circling among story, charged meaning, sensation, and parts.
11. Do not turn awareness into advice, a cure formula, or a performance assignment.

### Critical pacing rules

- Story comes before embodiment in ordinary story-based work.
- One question at a time.
- Do not rush sensation into parts language.
- Do not return from a part to the body too quickly.
- Do not append a question merely because one could be useful.
- Several accurate reflections do not necessarily mean the part has had enough time.
- The body is a source of information, not a device for forcing agreement.
- Hypotheses must be tentative and corrigible.
- Use the user's words. Avoid jargon and polished therapy-speak.
- Do not repeat a canned invitation every turn.

### Chad-approved examples

These are examples of direction and voice, not templates to repeat mechanically:

- "Make this come alive for me. Bring me into a moment when this recently happened so we can make this experience come alive."
- "Something about their response made you angry."
- "See if you can let yourself feel the impact of that, the sense that they think you're selfish. Where does that land in the body?"
- "Good, keep that tightness in your chest company. Maybe surround it with your attention."
- "Something in you feels heavy when you think about them deciding you're selfish."
- "So that part is afraid of being seen as selfish."
- "What's the worst of it for this part? If this part gets seen as selfish, what's it afraid might happen?"
- "Can you let that land? Can you let your body feel what you just said?"
- After a real pause: "What do you notice? How is your body responding?"

Variation must come from the context and Chad's transcript evidence, not random synonym swapping.

## Diagnosis boundary

If someone asks whether an experience is depression or another diagnosis, the companion should say plainly that it is not qualified to make that determination and that the exercise does not make diagnoses. The work here is to listen to the body and notice what it may reveal. If the person thinks they may be experiencing a clinical condition, direct them to a psychotherapist, psychiatrist, or medical doctor. Do not continue evocative coaching until the boundary is clear.

## Raw transcript and RAG status

Private transcript root:

`/Users/chadherst/Library/CloudStorage/Dropbox/Otter Transcripts`

Priority folders for method research:

- `Module 2`
- `Lorenzo`
- `30-Minute Mind-Body Consult`
- `Hour-Long Intro Session`

The Kids on the Bus journal source is:

`/Users/chadherst/Library/CloudStorage/Dropbox/ML/Mind:Body Foundations/Module 2/02.03A Kids on the Bus Journal.pdf`

Corpus status after the completed audit and duplicate cleanup:

- 782 transcript text files;
- 782 JSON shards;
- 782 NPY shards;
- zero known stale or missing shards;
- zero remaining duplicate Otter ID groups;
- zero remaining duplicate content-hash groups.

Audit records are in:

`/Users/chadherst/Documents/Otter Transcript Audit`

The canonical 86-file resolution register is 70 keep-confirmed, 13 verified rollbacks, 2 accounted relocated, and 1 ambiguous. The ambiguous Breath Meditation file remains in place, leaning keep. Four redundant copies were quarantined, not deleted, under `Duplicate Quarantine/2026-07-30`.

Do not move, rename, delete, or reorganize transcripts while doing companion-method research. Treat the RAG as read-only unless Chad gives a separate explicit instruction.

## Transcript-grounded research rule

The transcripts are a private research source, not the deployed companion's live memory.

For every proposed coaching move:

1. Search the transcripts first.
2. Confirm that the move actually occurs.
3. Identify several examples, including counterexamples and moments when Chad does not use the move.
4. Record locally which transcript and passage supports the finding.
5. Remove client identities and personal story details from product-facing material.
6. Convert evidence into an abstract rule, response family, precondition, contraindication, or evaluation case.
7. Present representative, de-identified examples to Chad for interactive approval.
8. Only then add the approved behavior to the prompt or application.

Do not invent guardrail or coaching scenarios and ask Chad how he would respond unless the scenario is required for product safety. Natural coaching-fidelity cases must appear in the transcripts. Synthetic crisis, privacy, injection, and retention tests stay clearly labeled as product-safety tests.

## Next milestone 1: build the Move Library

Start with these four families, but use transcript evidence to define them rather than guessing:

1. Encouraging or noticing breath.
2. Titrating feeling tones and intensity.
3. Tuning into the trade.
4. Expanding options.

Also capture the transitions into and out of each move.

For every move family, produce:

- its purpose in Chad's work;
- what must already be true before it is used;
- signals that invite it;
- signals that forbid it or call for slowing down;
- several ways Chad naturally introduces it;
- what he does when the invitation does not land;
- how long he tends to stay;
- how it reconnects to story, sensation, parts, or choice;
- common failure modes for the companion; and
- transcript-grounded evaluation cases.

Keep raw quotations, client names, and exact source evidence local and uncommitted. Only de-identified, Chad-approved abstractions belong in the GitHub repository.

The model should not randomly sprinkle techniques into responses. Add a lightweight, session-only orientation that helps it track questions such as:

- Is the story sufficiently alive?
- Is there genuine activation?
- Is the person in contact with sensation?
- Is a part present and has it been witnessed long enough?
- Is the person becoming overwhelmed or losing contact?
- Is this a moment for breath, titration, the trade, or expanded options?
- Is a reflection the entire response?

This is an orientation aid, not a rigid visible state machine.

After Chad approves the Move Library:

1. Update `companion-prompt.txt` with prerequisites and varied response families.
2. Add new transcript-grounded coaching cases without weakening the approved 22.
3. Run the original 22 cases, the new move cases, and all 25 product-safety cases.
4. Require every case to pass before moving to voice.
5. Summarize passes, failures, what changed, and what was learned in plain language for Chad.

## Next milestone 2: add controlled oral interaction

The recommended first oral version is push-to-talk, not continuous listening and not full realtime speech.

Suggested flow:

1. The user presses a microphone button and speaks.
2. The browser records only that turn.
3. The server sends the audio to a speech-to-text service.
4. Show the transcript and allow correction when practical.
5. Send the text through the same deterministic safety router and existing Claude coaching path.
6. Convert the approved response to speech.
7. Play it while keeping the text visible.
8. Allow immediate stop, mute, replay, copy, download, and text-only fallback.

Recommended initial architecture:

- Keep Claude Sonnet 5 as the coaching brain because its behavior has already been evaluated.
- Use OpenAI audio services for speech recognition and text-to-speech, subject to current official documentation and verified retention settings.
- Do not expose `OPENAI_API_KEY` to the browser. All ordinary audio API calls go through the server.
- Do not save raw audio, derived audio, transcripts, or replies.
- Do not include audio or journal text in logs.
- Stop recording immediately on a stop request or safety route.
- Speak the deterministic fixed safety response rather than sending urgent content to the coaching model.
- Begin with a warm neutral voice. Do not clone or imitate Chad's voice without a separate explicit decision, consent, and provider review.
- Preserve pauses and avoid chattering. Silence is part of Chad's method.

Before selecting models or endpoints, check current official provider documentation. Audio and realtime APIs change. Do not rely on old model names from memory.

Add oral evaluation cases for:

- speech-recognition mistakes;
- correction of a transcript before sending;
- silence and long pauses;
- stopping during recording or playback;
- microphone denial;
- failed transcription or speech generation;
- crisis language that is imperfectly transcribed;
- prompt injection spoken aloud;
- privacy questions about the microphone and audio retention;
- repeated or interrupted turns;
- accidental double submission; and
- graceful text fallback.

Only after the controlled oral version is excellent should full speech-to-speech be considered. A realtime browser version would use WebRTC and a short-lived client secret created by the server, never the ordinary API key. It would require a new evaluation of turn detection, interruptions, barge-in, silence, privacy, and live crisis handling. Changing the coaching model would also require rerunning all fidelity and safety evaluations.

## Engineering working rules

- Inspect before editing.
- Use small, reversible changes.
- Preserve unrelated server features.
- Never commit secrets or raw client material.
- Do not add analytics or third-party tracking.
- Do not connect the deployed application to Dropbox or the transcript corpus.
- Set `Cache-Control: no-store` on companion and audio responses where appropriate.
- Limit request sizes and audio duration.
- Validate file type and reject malformed uploads.
- Use random, non-identifying request IDs if operational metrics are necessary.
- Keep operational logs content-free.
- Add tests before or with behavior changes.
- Run `node --check` on changed JavaScript files.
- Run `npm test` before every commit.
- Inspect the final diff before committing.
- Use a feature branch and a pull request. Do not push directly to `main`.
- Do not deploy or invite testers merely because unit tests pass.

## Definition of success for the next handoff

The next handoff should let Chad understand, in lay terms:

1. Which transcript-grounded moves were found.
2. How they differ from one another.
3. What the companion now knows about when to use them.
4. Which cases passed or failed.
5. What remains unsafe, uncertain, or unverified.
6. Exactly what Chad should try next in the private prototype.

Do not bury the outcome in technical detail. Lead with what changed in the experience.
