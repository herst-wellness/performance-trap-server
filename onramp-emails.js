// The emails of The Performance Trap Practice. One wrapper reproducing the
// Mind/Body Foundations Acuity template exactly (background #FBF7EF,
// Lora/Georgia, 560px column, HERST WELLNESS eyebrow over a #C4A879 rule,
// body #4B4038 16px/1.65, links #7C6C5C, italic sign-off #6B5036, signature
// block), and one function per message, each returning { subject, html,
// text }. The copy is Chad's and is not written here: every place his
// words go is marked [[COPY: name]] so it cannot ship unnoticed. The
// facts the structure carries (access code, links, scorecard numbers) are
// real.
const BASE_URL = 'https://practice.herstwellness.com';
const BOOKING_URL = 'https://chadherst.as.me/integration-and-next-step-session';
const MAILCHIMP_TAG = 'Performance Trap Practice';

// Journal PDFs live at /downloads/on-ramp/week-N/<slug>.pdf. Week 1's three
// are drafted in docs/onramp-journals; the other weeks are placeholders
// until their journals exist.
const JOURNALS = {
  1: [
    { title: "What's Bringing You Here", slug: 'whats-bringing-you-here' },
    { title: 'The Breath in Ordinary Hours', slug: 'the-breath-in-ordinary-hours' },
    { title: 'The Formation of a Reaction', slug: 'the-formation-of-a-reaction' },
  ],
  2: [],
  3: [],
  4: [],
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

function journalLinks(n) {
  const items = JOURNALS[n] || [];
  if (!items.length) return p(placeholder('journals-week-' + n));
  return list(items.map((j) => link(journalUrl(n, j.slug), j.title)));
}

// ── Messages ────────────────────────────────────────────────────
function enroll(record) {
  const body =
    greeting(record) +
    p(placeholder('enroll')) +
    p('Your access code:') +
    p('<strong style="font-family:monospace;font-size:20px;">' + esc(record.code) + '</strong>') +
    p(placeholder('enroll-code-note')) +
    p('Week 1: ' + link(weekUrl(1), weekUrl(1))) +
    p('The three Week 1 journals:', 'margin-bottom:0.5em;') +
    journalLinks(1) +
    p(placeholder('enroll-close')) +
    signOff();
  return message(placeholder('enroll-subject'), body);
}

function yayNayIntro(record, links) {
  const body =
    greeting(record) +
    p(placeholder('yaynay-intro')) +
    p(link(links.yay, 'Yay') + ' &nbsp;&middot;&nbsp; ' + link(links.nay, 'Nay')) +
    signOff();
  const built = message(placeholder('yaynay-intro-subject'), body);
  // The text version doubles as the SMS body, so it stays short.
  built.text = placeholder('yaynay-intro-sms') + ' Yay: ' + links.yay + ' Nay: ' + links.nay;
  return built;
}

function yayNay(record, date, links) {
  const body =
    p('Yay or nay?') +
    p(link(links.yay, 'Yay') + ' &nbsp;&middot;&nbsp; ' + link(links.nay, 'Nay')) +
    p('<span style="font-size:13px;color:#7C6C5C;">About ' + esc(date) + '. Just data.</span>', 'margin:0;');
  const built = message('Yay or nay?', body);
  built.text = 'Yay or nay? Yay: ' + links.yay + ' Nay: ' + links.nay;
  return built;
}

function weekOpen(record, n) {
  const body =
    greeting(record) +
    p(placeholder('week-' + n)) +
    p('Week ' + n + ': ' + link(weekUrl(n), weekUrl(n))) +
    p(placeholder('week-' + n + '-sit-and-journals')) +
    journalLinks(n) +
    signOff();
  return message(placeholder('week-' + n + '-subject'), body);
}

function scorecard(record, w, stats) {
  const body =
    greeting(record) +
    p(placeholder('scorecard-' + w)) +
    list([
      'Days you sat this week: ' + stats.daysSat + ' of 7',
      'Days you answered: ' + stats.daysAnswered + ' of 7',
      'Sits you listened all the way through: ' + stats.sitsCompleted,
      'Longest run of days in a row: ' + stats.longestRun,
      'Days sat since you started: ' + stats.totalDaysSat,
    ]) +
    p(placeholder('scorecard-close')) +
    signOff();
  return message(placeholder('scorecard-subject'), body);
}

function closing(record) {
  const body =
    greeting(record) +
    p(placeholder('closing')) +
    p(link(BOOKING_URL, 'Book your Integration and Next-Step Session')) +
    p(placeholder('closing-close')) +
    signOff();
  return message(placeholder('closing-subject'), body);
}

module.exports = {
  BASE_URL,
  BOOKING_URL,
  JOURNALS,
  MAILCHIMP_TAG,
  closing,
  enroll,
  journalUrl,
  scorecard,
  textFromHtml,
  weekOpen,
  weekUrl,
  wrap,
  yayNay,
  yayNayIntro,
};
