// The Mind/Body Foundations meditations.
//
// The recordings used to live in a Dropbox folder per module, which is why the
// chapters referenced twenty-one of them by folder path and why several of those
// paths had gone dead. They are served from object storage now, so a client has
// one address for the whole programme.
//
// MBF_AUDIO_BASE is the public base URL of the bucket. Without it this returns
// nothing and the module page simply shows no meditations, rather than showing a
// list of links that 404.
const FILES = [
  { module: 2, slug: "aware-15-minutes", title: "Aware (15 minutes)", note: "The daily sit." },
  { module: 2, slug: "aware-20-minutes", title: "Aware (20 minutes)", note: "The daily sit." },
  { module: 2, slug: "aware-30-minutes", title: "Aware (30 minutes)", note: "The daily sit." },
  { module: 2, slug: "intro-to-aware", title: "Intro to Aware", note: "Start here, the once." },
  { module: 3, slug: "be-with", title: "Be With", note: "The daily sit." },
  { module: 3, slug: "be-with-2", title: "Be With #2", note: "The daily sit." },
  { module: 4, slug: "intro-to-equanimous", title: "Intro to Equanimous", note: "Start here, the once." },
  { module: 4, slug: "equanimous-30-minutes-1", title: "Equanimous (30 minutes), first", note: "The daily sit." },
  { module: 4, slug: "equanimous-30-minutes-2", title: "Equanimous (30 minutes), second", note: "The daily sit." },
  { module: 5, slug: "compassion-30-minutes-a", title: "Compassion 30 Minutes a", note: "The daily sit." },
  { module: 5, slug: "compassion-30-minutes-b", title: "Compassion 30 Minutes b", note: "The daily sit." },
  { module: 5, slug: "intro-to-compassion", title: "Intro to Compassion", note: "Start here, the once." },
  { module: 6, slug: "intro-to-module-6", title: "Intro to Module 6", note: "Start here, the once." },
  { module: 6, slug: "gratitude", title: "Gratitude", note: "The daily sit." },
  { module: 6, slug: "gratitude-choice-commitment-30-min-detailed", title: "Gratitude-Choice-Commitment (30 min) detailed", note: "The daily sit." },
  { module: 6, slug: "gratitude-choice-commitment-30-min", title: "Gratitude-Choice-Commitment (30 min)", note: "The daily sit." },
  { module: 7, slug: "conscious-choice-30-minutes", title: "Conscious Choice (30 minutes)", note: "The daily sit." },
  { module: 7, slug: "gratitude-choice-commitment", title: "Gratitude-Choice-Commitment", note: "The daily sit." },
  { module: 8, slug: "daily-meditation-15-minutes", title: "Daily Meditation (15 minutes)", note: "The daily sit." },
  { module: 8, slug: "daily-meditation-30-minutes", title: "Daily Meditation (30 Minutes)", note: "The daily sit." },
  { module: 8, slug: "loving-kindness-16-minutes", title: "Loving-Kindness (16 minutes)", note: "The daily sit." },
];

function base() {
  return String(process.env.MBF_AUDIO_BASE || '').replace(/\/+$/, '');
}

function audioForModule(moduleNumber) {
  const root = base();
  if (!root) return [];
  return FILES.filter((f) => f.module === Number(moduleNumber)).map((f) => ({
    title: f.title,
    note: f.note,
    href: root + '/mbf/module-' + f.module + '/' + f.slug + '.mp3',
  }));
}

module.exports = { FILES, audioForModule };
