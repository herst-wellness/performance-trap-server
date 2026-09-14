// Quiet delivery of On-Ramp course journals.
//
// The page saves what people have every few seconds. Every ten minutes this
// ticker writes any journal that has changed since its last Dropbox write
// and has been left alone for twenty minutes. Finished journals are handled
// by the page's own send-now request.
const { findJournal } = require('./onramp-journal-content');
const { deliverJournal, dropboxConfigured } = require('./mbf-delivery');
const { defaultStore, dueForDelivery } = require('./onramp-journal-store');

const TICK_MS = 10 * 60 * 1000;
const QUIET_MINUTES = 20;

async function deliverDue({ store = defaultStore(), now = new Date(), quietMinutes = QUIET_MINUTES, fetchImpl = fetch, log = () => {} } = {}) {
  if (!(await dropboxConfigured())) return { written: 0, failed: 0, skipped: 'dropbox-not-connected' };
  const doc = await store.load();
  const due = dueForDelivery(doc, { now, quietMinutes }).filter((record) => record.optOut !== true);
  if (!due.length) return { written: 0, failed: 0 };

  const results = [];
  for (const record of due) {
    const journal = findJournal(record.week || record.module, record.slug);
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
      if (record.optOut === true) continue;
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
  log('On-Ramp journals written to Dropbox: ' + written + ', failed: ' + failed);
  return { written, failed };
}

function startTicker(options = {}) {
  const run = () => {
    deliverDue(options).catch((error) => {
      (options.log || console.error)('On-Ramp journal delivery tick failed: ' + (error && error.message));
    });
  };
  const timer = setInterval(run, options.tickMs || TICK_MS);
  if (timer.unref) timer.unref();
  run();
  return timer;
}

module.exports = { deliverDue, startTicker, QUIET_MINUTES, TICK_MS };
