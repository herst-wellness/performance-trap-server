// The emails of The Performance Trap Practice. One wrapper reproducing the
// Mind/Body Foundations Acuity template exactly (background #FBF7EF,
// Lora/Georgia, 560px column, HERST WELLNESS eyebrow over a #C4A879 rule,
// body #4B4038 16px/1.65, links #7C6C5C, italic sign-off #6B5036, signature
// block), and one function per message, each returning { subject, html,
// text }. The copy is Chad's (performance-trap docs/63). Week 2 to 4
// journal names are provisional until those weeks are rebuilt.
const BASE_URL = 'https://practice.herstwellness.com';
const BOOKING_URL = 'https://chadherst.as.me/integration-and-next-step-session';
// Two conversations with Chad: half an hour before Week 1 and a full hour at
// the end. Human contact before a self-paced programme does about as much for
// finishing as contact all the way through, and a reward at the end moves
// nobody who has already stopped (9/14/26 research, performance-trap docs/86).
const OPENING_BOOKING_URL = process.env.ONRAMP_OPENING_BOOKING_URL || 'https://chadherst.as.me/opening-session';
const MAILCHIMP_TAG = 'Performance Trap Practice';

// The journals are writable pages at /practice/on-ramp/week-N/journal/<slug>.
// Eight of the ten also have a printable PDF at
// /downloads/on-ramp/week-N/<slug>.pdf; the two daily logs do not.
const JOURNALS = {
  1: [
    { title: "What's Bringing You Here", slug: 'whats-bringing-you-here' },
    { title: 'One Moment, Mapped', slug: 'one-moment-mapped' },
  ],
  2: [
    { title: 'The Protector', slug: 'the-protector' },
    { title: 'The Return', slug: 'the-return' },
  ],
  3: [
    { title: 'The Trade', slug: 'the-trade' },
    { title: 'The Third Option', slug: 'the-third-option' },
  ],
  4: [
    { title: "What's Still Running", slug: 'whats-still-running' },
    { title: "What You're Taking With You", slug: 'what-youre-taking-with-you' },
  ],
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function placeholder(name) {
  return '[[COPY: ' + name + ']]';
}

function weekUrl(n) {
  return BASE_URL + '/course/on-ramp/week-' + n;
}

function journalUrl(n, slug) {
  return BASE_URL + '/downloads/on-ramp/week-' + n + '/' + slug + '.pdf';
}

// The journals are pages you write in now, not sheets you print, and each
// week names one as the week's (9/14/26). The rest stay on the lesson page.
function journalPageUrl(n, slug) {
  return BASE_URL + '/practice/on-ramp/week-' + n + '/journal/' + slug;
}

const REQUIRED_JOURNAL = {
  1: 'whats-bringing-you-here',
  2: 'the-protector',
  3: 'the-trade',
  4: 'what-youre-taking-with-you',
};

// ── Wrapper ─────────────────────────────────────────────────────
function p(inner, extra) {
  return '<p style="margin:0 0 1em 0;' + (extra || '') + '">' + inner + '</p>';
}

function link(href, label) {
  return '<a href="' + esc(href) + '" style="color:#7C6C5C;">' + esc(label) + '</a>';
}

function list(items) {
  return (
    '<ul style="margin:0 0 1em 0;padding-left:1.5em;">' +
    items.map((item) => '<li style="margin-bottom:0.4em;">' + item + '</li>').join('') +
    '</ul>'
  );
}

function signOff() {
  return '<p style="margin:0;font-style:italic;color:#6B5036;">Chad</p>';
}

function wrap(bodyHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FBF7EF;font-family:'Lora',Georgia,'Times New Roman',serif;">
  <tr>
    <td align="center" style="padding:40px 20px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FBF7EF;">
        <tr>
          <td style="padding-bottom:14px;border-bottom:1px solid #C4A879;">
            <span style="font-family:'Lora',Georgia,serif;font-size:11px;color:#7C6C5C;letter-spacing:2.5px;text-transform:uppercase;">Herst Wellness</span>
          </td>
        </tr>
        <tr>
          <td style="font-family:'Lora',Georgia,serif;color:#4B4038;font-size:16px;line-height:1.65;padding:32px 0 0 0;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding-top:32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:1px solid #C4A879;padding-top:14px;font-family:'Lora',Georgia,serif;line-height:1.55;">
                  <div style="color:#4B4038;font-size:13px;margin-bottom:2px;">Chad Herst</div>
                  <div style="color:#7C6C5C;font-size:12px;margin-bottom:8px;">Coach + author of <em>The Performance Trap</em></div>
                  <div style="color:#7C6C5C;font-size:12px;"><a href="https://herstwellness.com" style="color:#7C6C5C;text-decoration:none;">herstwellness.com</a> &nbsp;&middot;&nbsp; <a href="tel:14156864411" style="color:#7C6C5C;text-decoration:none;">415-686-4411</a></div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Plain-text twin of a body: links become "label (url)", tags go, blank
// lines collapse.
function textFromHtml(bodyHtml) {
  return bodyHtml
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (m, href, label) => (label.trim() === href ? href : label + ' (' + href + ')'))
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|li|ul|div|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function message(subject, bodyHtml) {
  return { subject, html: wrap(bodyHtml), text: textFromHtml(bodyHtml) };
}

function greeting(record) {
  return p('Hi ' + esc(record.firstName || 'there') + ',');
}

// Journals per week: the rebuilt weeks carry two; the placeholders still say three.
function journalCount(n) {
  return (JOURNALS[n] || []).length || 3;
}

function journalLinks(n) {
  const items = JOURNALS[n] || [];
  if (!items.length) return p(placeholder('journals-week-' + n));
  const slug = REQUIRED_JOURNAL[n];
  const required = items.find((j) => j.slug === slug) || items[0];
  return p(link(journalPageUrl(n, required.slug), 'Open ' + required.title));
}

// ── Messages ────────────────────────────────────────────────────
// Copy is Chad's (performance-trap docs/63), built from his Module 1
// Acuity emails and his Breath Practice sheet.
function enroll(record) {
  const body =
    greeting(record) +
    p("Glad we're doing this.") +
    p("<strong>First thing, before the course.</strong> You get two conversations with me, not one. A short one now, before you start, and a full hour at the end once the month is in you. Book the short one here: " + link(OPENING_BOOKING_URL, 'the opening thirty minutes') + ". Pick something in the next week or so. We use it to find out what you're bringing, and to put the practice somewhere in your life where it can survive.") +
    p('Your access code is <strong style="font-family:monospace;font-size:20px;">' + esc(record.code) + '</strong>. It unlocks all four weeks and the practice companion. Save it somewhere you\'ll find it again.') +
    p("Then Week 1 is here: " + link(weekUrl(1), 'Week 1: From the Book to the Body') + ". Open it and sit with the breathing recording before you read anything. Ten minutes is plenty the first time. The reading makes more sense from the other side of a sit.") +
    p("One journal for the week, What's Bringing You Here, in the first day or two. There's a second one on the page if you want it. It isn't a smaller version of the week. One is the week.") +
    p("Two things worth deciding before you start, because they matter more than willpower. <strong>What time of day will you sit</strong>, and <strong>what already happens at that time</strong>. Hooking the sit onto something already in your day, the first coffee, the dog, closing the laptop at night, holds better than deciding to be disciplined about it. You don't have to tell me. Just decide it.") +
    p("And the thing to know before you miss a day. One missed day doesn't matter. A missed week does. Begin again the next one.") +
    p("Last thing. The site keeps track of when you play the recordings and when you tap Mark done on a journal. Not to grade you. At the end of each week I'll send you what the week looked like. No shame either way. It's just data, and it's yours.") +
    signOff();
  return message("You're in. Book your first thirty minutes with me.", body);
}

function yayNayIntro(record, links) {
  const body =
    greeting(record) +
    p("Every morning for the next four weeks you'll get a note from me with one question. Yay or nay? Did you sit yesterday, or didn't you.") +
    p("Tap one. That's the whole job.") +
    p("This work doesn't happen in the reading. It happens in the ten or fifteen minutes a day when you sit down with the breath. The days add up or they don't. This isn't a streak, and nobody is keeping score against you. No shame either way. It's just data.") +
    p("At the end of each week I'll send you what the week looked like: how many days you sat, which sits you listened to. That's yours to look at like anything else that's true about your life.") +
    p("If you miss a day, you didn't fail. Begin again the next one. The drift and the return is the practice.") +
    signOff();
  const built = message('Yay or nay', body);
  // The text version doubles as the SMS body, so it stays short.
  built.text = "Chad here. Every morning for the next four weeks I'll text one question: yay or nay? Did you sit yesterday? Reply YAY or NAY. No shame either way. Just data. The drift and the return is the practice.";
  return built;
}

function yayNay(record, date, links) {
  const first = esc(record.firstName || 'there');
  const body =
    p('Yay or nay, ' + first + '? Did you sit yesterday?') +
    p('<a href="' + esc(links.yay) + '" style="display:inline-block;background:#8B6B1E;color:#FFFFFF;text-decoration:none;padding:12px 28px;border-radius:999px;font-size:15px;">Yay</a>&nbsp;&nbsp;&nbsp;<a href="' + esc(links.nay) + '" style="display:inline-block;border:1px solid #8B6B1E;color:#8B6B1E;text-decoration:none;padding:11px 28px;border-radius:999px;font-size:15px;">Nay</a>') +
    p('No shame either way. Just data.') +
    signOff();
  const built = message('Yay or nay?', body);
  built.text = 'Yay or nay, ' + (record.firstName || 'there') + '? Did you sit yesterday? Reply YAY or NAY, or tap. Yay: ' + links.yay + ' Nay: ' + links.nay + ' No shame either way. Just data.';
  return built;
}

const WEEK_OPEN = {
  2: {
    subject: 'Week 2: staying with it',
    title: 'Week 2: Staying With It',
    paras: [
      "Week 1 was about getting to the body. Slow the breath, enter, find the sensation, put a word on it. This week you stay. Most of us can find the tightness. Very few of us can keep it company for more than a second or two before we're back in the story about it. That's the whole week.",
      "The sit is called Keeping It Company. About fifteen minutes. Sit with it most days. Keep the breathing recording for the days you're jumpy and need to settle first.",
      'One journal this week: The Protector, early in the week, after a sit. There is a second one on the page, The Return, if you want it.',
    ],
  },
  3: {
    subject: 'Week 3: the third option',
    title: 'Week 3: Turning Contact Into Choice',
    paras: [
      'The first two weeks were SENSE. Getting to the body and staying there. This week is STEP, which is what becomes possible once you can stay.',
      "Something lands, and the nervous system hands you two bad choices. Say the true thing and lose the relationship, or keep the peace and lose yourself. Take the call at ten at night, or be the one who let the team down. Most of the time, the two choices are the trap, not the truth. There's a third option the bind told you wasn't available. This week is about finding it, and practicing it in small moments before the big ones.",
      "The sit is Finding the Third Option. About sixteen minutes. Bring a real bind to it, one that's live this week.",
      "One journal this week: The Trade, once you've caught a moment where the old pull was there. The Third Option is on the page if you want it.",
    ],
  },
  4: {
    subject: 'Week 4: the last week',
    title: 'Week 4: Integration and the Doorway',
    paras: [
      "This week pulls it together, and we go a layer deeper than we have. Underneath the tightness you've been learning to stay with, there's usually something more tender. The ache of all the ways you had to override yourself to belong. I call it the sacred wound, and we spend the week with it.",
      "The sit is The Sacred Wound. About fourteen minutes. Go slowly. If it's too much on a given day, that's information, not failure. Go back to the breathing recording and come back to it tomorrow.",
      "One journal: What You're Taking With You, at the end of the week. That is the one I read before we meet, so do it whatever else you skip. What's Still Running is on the page if you want it too.",
    ],
  },
};

function weekOpen(record, n) {
  const w = WEEK_OPEN[n];
  if (!w) throw new Error('No week opener for week ' + n);
  const body =
    greeting(record) +
    p('Week ' + n + ' opens today: ' + link(weekUrl(n), w.title) + '.') +
    w.paras.map((t) => p(t)).join('') +
    ((JOURNALS[n] || []).length ? journalLinks(n) : '') +
    signOff();
  return message(w.subject, body);
}

function scorecardNote(daysSat) {
  if (daysSat >= 5) return "That's a real week. The body knows the difference between reading about this and doing it.";
  if (daysSat >= 2) return "Some days in, some days out. That's most weeks for most people. The days you sat count. So do the days you noticed you didn't.";
  return "Not much sitting this week. No shame. This is the useful kind of data, because the question now isn't whether you're disciplined. It's what got in the way. Look at that the way you'd look at anything in the body. Where does it live? What's it protecting?";
}

function scorecard(record, w, stats) {
  const body =
    greeting(record) +
    p("Here's Week " + w + '.') +
    list([
      'Days you sat, meaning a recording played most of the way through: ' + stats.daysSat + ' of 7',
      'Sits you finished: ' + stats.sitsCompleted + (stats.sitsStarted ? ', and ' + stats.sitsStarted + ' you started and left' : ''),
      'Journals marked done: ' + stats.journalsDone + ' of ' + journalCount(w),
      'Days sat since you started: ' + stats.totalDaysSat,
    ]) +
    p(scorecardNote(stats.daysSat)) +
    p(w < 4 ? 'Tomorrow morning Week ' + (w + 1) + ' opens.' : "Tomorrow morning I'll send a note about the session that closes the month.") +
    signOff();
  return message('Week ' + w + ': what it looked like', body);
}

function closing(record) {
  const body =
    greeting(record) +
    p("Four weeks. Whatever it looked like, you did it, and the month is in your body now in a way it wasn't before.") +
    p("Now the long one. A full hour on Zoom. We talked for half an hour at the start and you told me what you were bringing. This is where we look at what the month did with it: what got easier, what is still asking for attention, and the one thing worth carrying forward.") +
    p('Book it here: ' + link(BOOKING_URL, 'Integration and Next-Step Session') + '. Pick a time in the next two or three weeks, while the month is still close.') +
    p("I'll also tell you whether one-on-one work fits where you are, or whether what you have now is enough to keep going on your own. Either answer is a good one.") +
    p("Before we meet, do the last journal, What You're Taking With You. If you didn't get to everything, bring what you have. We'll work with what's there.") +
    signOff();
  return message('The hour that closes the month', body);
}

module.exports = {
  BASE_URL,
  BOOKING_URL,
  OPENING_BOOKING_URL,
  REQUIRED_JOURNAL,
  journalPageUrl,
  JOURNALS,
  MAILCHIMP_TAG,
  closing,
  enroll,
  esc,
  journalUrl,
  p,
  scorecard,
  textFromHtml,
  weekOpen,
  weekUrl,
  wrap,
  yayNay,
  yayNayIntro,
};
