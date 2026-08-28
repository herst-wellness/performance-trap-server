# Mind/Body Foundations Companion

The page lives at `/start-anywhere`. The old route at `/reflect/kids-on-the-bus` permanently redirects there, carrying any query string with it, so the Squarespace button on `/try-mind-body-foundations` and links already handed out keep working. The visitor-facing name is Start Anywhere, taken from the companion's own opening line. Kids on the Bus remains one element inside the broader method, and must never appear in visitor-facing copy or addresses.

The application remains text-led and adds optional push-to-talk transcription for individual responses. Visitors can review, edit, or delete a transcript before sending it through the same approved Module 2 coaching and safety path. As of 2026-08-21 the fixed opening asks what has been going on in the visitor's last few days (the companion then finds and follows the thread that carries weight), sittings default to a 20-exchange, 30-minute limit, and the server sends the model a wind-down note when a sitting nears its limit.

The approved Squarespace heading is `EXPERIENCE MIND/BODY FOUNDATIONS`. Use Mind/Body Foundations consistently in the website section, companion, dashboard, reports, and metadata.

## Required Render settings

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`, used server-side only for bounded audio transcription
- `COMPANION_ADMIN_CODE`, a separate code used only for `/admin/mindbody-insights`
- `PRIVATE_TEST_BUDGET_USD=100`
- `REALTIME_DATA_DIR=/var/data/mindbody-companion`, or an equivalent path beneath the Render persistent disk mount

Attach a Render persistent disk at `/var/data` before deployment. The application refuses to start on Render without `REALTIME_DATA_DIR` or `RENDER_DISK_PATH`. This prevents analytics from silently falling back to temporary deployment storage.

The public companion does not require a visitor access code. `COMPANION_ADMIN_CODE` still protects the reporting dashboard and exports.

## Keeping your own testing out of the numbers

Open the companion once with `?internal=1` on the end of the address. That browser is marked from then on, and every visit and sitting it makes is tagged as testing rather than as a real visitor. The mark survives reloads and new sittings because it is stored in the browser itself. To clear it, open the page once with `?internal=0`.

Tagged visits and sittings are left out of the insights page, the funnel, and the weekly email by default. Nothing is deleted. The insights page shows how many were left out, its "My own testing" filter can put them back or show only them, and the sitting export carries an `internalTesting` column.

Use a different browser or a private window to see the companion the way a real visitor does.

Records made before the mark existed can be tagged after the fact. `POST /api/kids-on-the-bus/admin/mark-internal` with the administrative code and `{"before": "<ISO date>"}` tags every visit and sitting that started before that moment, and returns how many it touched. Sending `{"before": "<ISO date>", "internal": false}` puts them back. Nothing is deleted either way, so a record wrongly tagged is always recoverable.

The existing `usage-ledger.json` is upgraded in place. It keeps content-free page visits, funnel events, cost entries, and structured sitting records together. An older array-shaped ledger is read automatically and converted the next time it is written.

## Retention

- Structured usage records: 365 days by default
- Content-free page visit and start-funnel records: 365 days by default
- Optionally shared written sittings: 90 days by default
- Optional feedback comments: 90 days by default
- Existing detailed cost and latency entries: 30 days

Shared sittings and written feedback comments are pruned when the server starts, every 24 hours while it remains running, and immediately before shared material is listed or opened. The running service does not wait for a visitor sitting or an administrator dashboard action.

Optional controls:

- `COMPANION_ANALYTICS_RETENTION_DAYS=365`
- `COMPANION_SHARED_RETENTION_DAYS=90`
- `ANTHROPIC_MODEL=claude-sonnet-5`
- `ANTHROPIC_EFFORT=high`
- `WRITTEN_SESSION_MINUTES=30`
- `WRITTEN_MAX_EXCHANGES=20`
- `OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe`
- `OPENAI_TRANSCRIPTION_PER_MINUTE=0.0045`

If `WRITTEN_SESSION_MINUTES` or `WRITTEN_MAX_EXCHANGES` are explicitly set in Render, they override the shortened defaults above and must be updated or removed there for the shorter sitting to take effect.

Voice recordings are limited to two minutes and 10 MB. The server holds audio in memory only long enough to send it to the transcription service and return the transcript. It does not write audio to disk, logs, analytics, shared sittings, or reports. A transcript is not sent to the coaching path until the visitor reviews it and selects Send.

## Weekly Resend report

Set all of these values to enable the weekly report:

- `COMPANION_WEEKLY_REPORT_ENABLED=true`
- `RESEND_API_KEY`
- `COMPANION_REPORT_TO`, Chad's receiving address
- `COMPANION_REPORT_FROM`, a verified Resend sender

The running service checks once per hour and sends no more than one report in seven days. The report includes page visits, begin attempts, tracked starts, pre-start exits, startup problems, sitting outcomes, reliability, and feedback. Topic and process classifications in the dashboard and report are automatically estimated and potentially imperfect. Companion invitations are tracked separately from participant-response evidence. The send date is recorded in the persistent ledger so an application restart does not cause a duplicate report. The protected endpoint `/api/kids-on-the-bus/admin/send-weekly-report` can also send a report deliberately with the separate administrative code.

## Persistence verification before deployment

The automated tests recreate the ledger from the same disk directory and confirm that structured records and optional sitting permissions survive a server process restart. Before public deployment, also complete this Render check:

1. Start a test sitting and note its session reference.
2. Confirm it appears in the protected dashboard.
3. Restart the service and confirm the same reference remains.
4. deploy the reviewed branch and confirm the same reference remains.
5. Restart the service process once more and confirm the same reference remains.

Do not deploy if any reference disappears. That means the configured directory is not attached to the Render persistent disk.

## Verification

Run:

```sh
npm run check
npm test
```

Then verify desktop and mobile layouts, no visitor code field or request header, required notice acknowledgment, optional sharing off by default, microphone permission denial, recording start and stop, the two-minute limit, transcription insertion without automatic submission, transcript correction, text-only fallback, copy and download, end and clear, feedback, page-visit and funnel tracking, voice analytics, referral tracking, protected dashboard access, both CSV exports, optional sitting deletion, and immediate microphone shutdown when a sitting ends or the page closes.

## Closing a sitting

`WRITTEN_SESSION_MINUTES` (default 30) is the hard wall. `WRITTEN_CLOSE_MINUTES`
(default 25) is when the sitting actually closes, and it is always forced to at
least a minute inside the wall.

Past the closing minute, or on the last allowed exchange, the companion is told
that this is its final response and to close in it. That turn is recorded as a
completed sitting whether or not the model remembers to emit its completion
marker, and the browser ends the sitting on it rather than letting the clock run
out. The visible countdown runs to the closing minute and then reads "closing
after your next response"; the hard wall stays as a silent backstop for someone
who walks away mid-sitting.

## Streaming

The browser asks for a stream by sending `stream: true` on the turn request,
and the server answers with server-sent events: `delta` for each piece of
text, then one `done` carrying the route, cost, budget and completion, or one
`failed` if the response died after the headers were already out. A browser
that does not ask for a stream still gets the whole response as JSON, and the
page falls back to that on its own.

Two things the streamed path does differently. It asks for the larger token
ceiling from the start, because the buffered path's retry-on-truncation
cannot be used once text has reached the reader and cannot be taken back. And
it holds back a tail the length of the completion marker, so a marker split
across two deltas can never be shown and then removed.

Safety routing is unaffected: it runs on the visitor's own message before
Claude is called at all, so nothing streamed can get past it.

`X-Accel-Buffering: no` is set on the stream. Without it a proxy will buffer
the whole response and the streaming is invisible.

