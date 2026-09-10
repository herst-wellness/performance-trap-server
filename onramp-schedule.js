// The email spine schedule for The Performance Trap Practice, plus the
// ticker that sends what is due. Everything is computed from the
// enrollment record's enrolledAt in the enrollee's own time zone:
//
//   enroll          immediately                         email
//   yaynay-intro    day 0, 7:30 pm (or at once if later) text or email
//   yaynay-D        day D (1..28), 7:30 am, about day D-1 text or email
//   scorecard-W     day 7W (W=1..4), 6:00 pm              email
//   week-N          day 7(N-1)+1 (N=2..4), 7:00 am        email
//   closing         day 29, 7:00 am                       email
//
// dueItems() is pure. The ticker (started from server.js only when
// ONRAMP_EMAIL_SPINE=on) loads the store, sends, marks sent, saves. A key
// is never sent twice on purpose; a crash between send and save can
// double-send at most once, which is acceptable at this volume.
const { DEFAULT_TIME_ZONE, findById } = require('./onramp-store');

const TICK_MS = 10 * 60 * 1000;

// ── Time zone helpers (Intl only, no dependency) ────────────────
function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normaliseTimeZone(tz) {
  const s = String(tz || '').trim();
  return s && validTimeZone(s) ? s : DEFAULT_TIME_ZONE;
}

function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateString(date, tz) {
  const p = localParts(date, tz);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day);
}

function tzOffsetMinutes(date, tz) {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// The instant at which a wall-clock time happens in a zone. Two passes so
// a daylight-saving change between the guess and the answer is absorbed.
function zonedInstant(dateStr, hour, minute, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  let offset = tzOffsetMinutes(new Date(guess), tz);
  let instant = guess - offset * 60000;
  const second = tzOffsetMinutes(new Date(instant), tz);
  if (second !== offset) instant = guess - second * 60000;
  return new Date(instant);
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}

// ── Schedule ────────────────────────────────────────────────────
function enrollmentDay0(record) {
  const tz = normaliseTimeZone(record.timeZone);
  return { tz, day0: localDateString(new Date(record.enrolledAt), tz) };
}

function scheduleFor(record) {
  const enrolledAt = new Date(record.enrolledAt);
  const { tz, day0 } = enrollmentDay0(record);
  const items = [{ key: 'enroll', kind: 'email', at: enrolledAt }];
  // No daily ask (Chad, 9/10/26): the recordings and the journals are
  // tracked on the site, and the weekly scorecard reports them.
  for (let w = 1; w <= 4; w += 1) {
    items.push({ key: 'scorecard-' + w, kind: 'email', at: zonedInstant(addDays(day0, 7 * w), 18, 0, tz), week: w });
  }
  for (let n = 2; n <= 4; n += 1) {
    items.push({ key: 'week-' + n, kind: 'email', at: zonedInstant(addDays(day0, 7 * (n - 1) + 1), 7, 0, tz), week: n });
  }
  items.push({ key: 'closing', kind: 'email', at: zonedInstant(addDays(day0, 29), 7, 0, tz) });
  items.sort((a, b) => a.at - b.at);
  return items;
}

function dueItems(record, now = new Date()) {
  const sent = record.sent || {};
  return scheduleFor(record).filter((item) => item.at <= now && !sent[item.key]);
}

// ── Ticker ──────────────────────────────────────────────────────
// Required here rather than at the top: onramp-yaynay uses the date
// helpers above, so a top-level require in both directions would load an
// empty module.
function deliverers() {
  return { yaynay: require('./onramp-yaynay'), emails: require('./onramp-emails') };
}

async function deliver(item, record, ctx) {
  const { yaynay, emails } = deliverers();
  const env = ctx.env || process.env;
  const baseUrl = ctx.baseUrl || emails.BASE_URL;
  let message;
  if (item.key === 'enroll') message = emails.enroll(record);
  else if (item.key === 'yaynay-intro') message = emails.yayNayIntro(record, yaynay.yayLinks(record, item.date, baseUrl));
  else if (item.key.startsWith('yaynay-')) message = emails.yayNay(record, item.date, yaynay.yayLinks(record, item.date, baseUrl));
  else if (item.key.startsWith('scorecard-')) message = emails.scorecard(record, item.week, yaynay.scorecard(record, item.week));
  else if (item.key.startsWith('week-')) message = emails.weekOpen(record, item.week);
  else if (item.key === 'closing') message = emails.closing(record);
  else return false;

  if (item.kind === 'text-or-email' && yaynay.channelFor(record, env) === 'sms') {
    const sms = ctx.sendSms || ((to, body) => yaynay.sendSms(to, body, env));
    try {
      const result = await sms(record.phone, message.text);
      if (result && result.ok) return true;
      ctx.log.error('On-Ramp spine: text failed, falling back to email', item.key);
    } catch (error) {
      ctx.log.error('On-Ramp spine: text failed, falling back to email', item.key, error.message);
    }
  }
  const result = await ctx.sendEmail(record.email, message.subject, message.html);
  return Boolean(result && result.ok);
}

async function runSpineTick(ctx) {
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const log = ctx.log || console;
  const context = { ...ctx, log };
  const doc = await ctx.store.load();
  const done = [];
  for (const record of doc.enrollments) {
    for (const item of dueItems(record, now)) {
      try {
        if (await deliver(item, record, context)) done.push({ id: record.id, key: item.key });
        else log.error('On-Ramp spine: not delivered, will retry', item.key, record.id);
      } catch (error) {
        log.error('On-Ramp spine: delivery error', item.key, record.id, error.message);
      }
    }
  }
  if (done.length) {
    await ctx.store.update((d) => {
      for (const { id, key } of done) {
        const r = findById(d, id);
        if (!r) continue;
        if (!r.sent) r.sent = {};
        r.sent[key] = now.toISOString();
      }
    });
  }
  return done;
}

function startSpineTicker(ctx) {
  const log = ctx.log || console;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const done = await runSpineTick(ctx);
      if (done.length) log.log('On-Ramp spine: sent ' + done.length + ' item(s)');
    } catch (error) {
      log.error('On-Ramp spine tick failed:', error.message);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, ctx.firstDelayMs === undefined ? 5000 : ctx.firstDelayMs);
  const timer = setInterval(tick, ctx.intervalMs || TICK_MS);
  if (first.unref) first.unref();
  if (timer.unref) timer.unref();
  log.log('On-Ramp email spine ticker started (' + (ctx.store.backend || 'unknown') + ' store)');
  return { stop: () => { clearTimeout(first); clearInterval(timer); }, tick };
}

module.exports = {
  TICK_MS,
  addDays,
  dueItems,
  enrollmentDay0,
  localDateString,
  normaliseTimeZone,
  runSpineTick,
  scheduleFor,
  startSpineTicker,
  validTimeZone,
  zonedInstant,
};
