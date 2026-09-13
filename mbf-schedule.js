// The quiet delivery of Mind/Body Foundations journals.
//
// A client writes. The page saves what they have to Chad's storage every
// few seconds. This ticker, every ten minutes, looks for any journal that
// has been added to since it was last written out and that the person has
// stopped touching for twenty minutes, and writes it into Chad's Dropbox
// folder, over the top of the previous version. The result is that Chad's
// folder always holds the current state of everybody's work, without the
// client ever pressing anything and without him asking.
//
// A journal the client marks finished is written immediately by the page's
// own request, not here, so "I am done" is not left waiting on a timer.
const { findJournal } = require('./mbf-journal-content');
const { deliverJournal, dropboxConfigured } = require('./mbf-delivery');
const { defaultStore, dueForDelivery } = require('./mbf-store');

const TICK_MS = 10 * 60 * 1000;
const QUIET_MINUTES = 20;

async function deliverDue({ store = defaultStore(), now = new Date(), quietMinutes = QUIET_MINUTES, fetchImpl = fetch, log = () => {} } = {}) {
  // Until Chad has connected Dropbox there is nowhere to put anything, and
  // marking every journal as failed every ten minutes would be noise.
  if (!(await dropboxConfigured())) return { written: 0, failed: 0, skipped: 'dropbox-not-connected' };
  const doc = await store.load();
  const due = dueForDelivery(doc, { now, quietMinutes });
  if (!due.length) return { written: 0, failed: 0 };

  const results = [];
  for (const record of due) {
    const journal = findJournal(record.module, record.slug);
    if (!journal) continue;
    try {
      const outcome = await deliverJournal(
        {
          code: record.code,
          clientName: record.clientName,
          journal,
          answers: record.answers,
          finished: false,
          now,
        },
        fetchImpl
      );
      results.push({ key: record.key, path: outcome.savedTo, problem: null });
    } catch (error) {
      results.push({ key: record.key, path: null, problem: error.message || 'unknown' });
    }
  }

  await store.update((current) => {
    for (const result of results) {
      const record = (current.journals || []).find((r) => r.key === result.key);
      if (!record) continue;
      if (result.path) {
        record.deliveredAt = now.toISOString();
        record.deliveredPath = result.path;
        record.deliveryProblem = null;
      } else {
        record.deliveryProblem = result.problem;
      }
    }
    return current;
  });

  const written = results.filter((r) => r.path).length;
  const failed = results.length - written;
  log('MBF journals written to Dropbox: ' + written + ', failed: ' + failed);
  return { written, failed };
}

// Started from server.js only when MBF_AUTO_DELIVERY is on, the same shape
// as the On-Ramp email spine's switch, so the behaviour can be turned off
// without a code change.
function startTicker(options = {}) {
  const run = () => {
    deliverDue(options).catch((error) => {
      (options.log || console.error)('MBF delivery tick failed: ' + (error && error.message));
    });
  };
  const timer = setInterval(run, options.tickMs || TICK_MS);
  if (timer.unref) timer.unref();
  run();
  return timer;
}

module.exports = { deliverDue, startTicker, QUIET_MINUTES, TICK_MS };
