# Mind/Body Foundations Companion

The route at `/reflect/kids-on-the-bus` remains in place so existing links continue to work. The visitor-facing name is now Mind/Body Foundations Companion. Kids on the Bus remains one element inside the broader method, not the name of the whole experience.

The application remains written only. The approved Module 2 coaching prompt, pacing, safety responses, 30-exchange limit, 60-minute limit, and Claude Sonnet 5 effort setting are unchanged.

## Required Render settings

- `ANTHROPIC_API_KEY`
- `COMPANION_ACCESS_CODE`
- `COMPANION_ADMIN_CODE`, a separate code used only for `/admin/mindbody-insights`
- `PRIVATE_TEST_BUDGET_USD=100`
- `REALTIME_DATA_DIR=/var/data/mindbody-companion`, or an equivalent path beneath the Render persistent disk mount

Attach a Render persistent disk at `/var/data` before deployment. The application refuses to start on Render without `REALTIME_DATA_DIR` or `RENDER_DISK_PATH`. This prevents analytics from silently falling back to temporary deployment storage.

The existing `usage-ledger.json` is upgraded in place. It keeps cost entries and structured sitting records together. An older array-shaped ledger is read automatically and converted the next time it is written.

## Retention

- Structured usage records: 365 days by default
- Optionally shared written sittings: 90 days by default
- Optional feedback comments: 90 days by default
- Existing detailed cost and latency entries: 30 days

Optional controls:

- `COMPANION_ANALYTICS_RETENTION_DAYS=365`
- `COMPANION_SHARED_RETENTION_DAYS=90`
- `ANTHROPIC_MODEL=claude-sonnet-5`
- `ANTHROPIC_EFFORT=high`
- `WRITTEN_SESSION_MINUTES=60`
- `WRITTEN_MAX_EXCHANGES=30`

## Weekly Resend report

Set all of these values to enable the weekly report:

- `COMPANION_WEEKLY_REPORT_ENABLED=true`
- `RESEND_API_KEY`
- `COMPANION_REPORT_TO`, Chad's receiving address
- `COMPANION_REPORT_FROM`, a verified Resend sender

The running service checks once per hour and sends no more than one report in seven days. The send date is recorded in the persistent ledger so an application restart does not cause a duplicate report. The protected endpoint `/api/kids-on-the-bus/admin/send-weekly-report` can also send a report deliberately with the separate administrative code.

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

Then verify desktop and mobile layouts, required notice acknowledgment, optional sharing off by default, copy and download, end and clear, feedback, referral tracking, protected dashboard access, structured CSV export, optional sitting deletion, and the absence of microphone or voice controls.
