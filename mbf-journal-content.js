// The Mind/Body Foundations journals as structured content rather than
// PDFs. Every prompt here is transcribed verbatim from the module PDFs in
// Chad's Dropbox (MindBodyFoundations/01.*), including its original
// numbering, so a client who has the PDF and a client who uses this page
// are answering exactly the same questions in the same order.
//
// Module 1 only, on purpose: it is the prototype. Modules 2 to 8 follow the
// same shape once Chad has looked at this one.
//
// Prompt kinds:
//   long  a paragraph or more, large box
//   short a line or two
//   agree a yes or no commitment, with room for a note
//
// The audio links are the original Dropbox share links from the PDFs. They
// open Dropbox's own page rather than playing inline, which is the old
// experience carried forward. They should move to Chad's own audio hosting,
// the way the book bonus audio already did.

const ABOUT_YOU = {
  module: 1,
  slug: 'about-you',
  code: '01.01A',
  kind: 'Welcome',
  title: 'About You',
  blurb: 'The wide look at your life as it is right now, the three things you want to work on, and how the two of us will work together.',
  audio: { label: 'Chad’s introduction to Mind/Body Foundations and to this exercise', href: 'https://www.dropbox.com/s/sw7357g8dir2qyd/Q_1a.mp3?dl=0' },
  sections: [
    {
      heading: 'Where you are right now',
      note: 'Seven areas of your life. Rate each one and say what is behind the number.',
      prompts: [
        { id: 'health', kind: 'long', label: 'Health and wellness', text: 'On a scale of one to ten, how satisfied are you with your current health? Are you engaging in regular exercise, maintaining a healthy diet, and getting sufficient sleep to wake up feeling rested?' },
        { id: 'home', kind: 'long', label: 'Your home', text: 'How do you feel about your home life? Do you feel a sense of belonging and connection? Does your home reflect the environment you desire at the end of the day?' },
        { id: 'intimacy', kind: 'long', label: 'Intimacy', text: 'On a scale of one to ten, how would you rate your current satisfaction with love, connection and emotional intimacy? If you feel there is room for improvement, what changes or adjustments could you make to enhance the level of satisfaction and fulfillment in this aspect of your life?' },
        { id: 'family', kind: 'long', label: 'Family', text: 'On a scale of one to ten, how satisfied are you with your family connection? If you believe there is room for improvement, what do you think needs to change in order to enhance that connection?' },
        { id: 'friends', kind: 'long', label: 'Friends', text: 'Rate your level of connection with your friends on a scale of one to ten, considering factors like the frequency of interaction and enjoyment of each other’s company, and reflect on how it could be improved.' },
        { id: 'career', kind: 'long', label: 'Career', text: 'Rate career satisfaction and alignment with authentic self. Describe your experience and the changes you desire.' },
        { id: 'growth', kind: 'long', label: 'Personal growth', text: 'Do you allocate sufficient time for personal growth, allowing yourself to expand your mindset, emotions, and explore diverse ways of being? Are you giving yourself the opportunity to learn and develop? If not, and if you had the luxury of time for exploration, what would you explore?' },
      ],
    },
    {
      heading: 'The three things we will work on',
      note: 'Over six months together we will take on three challenges or obstacles. These are them.',
      prompts: [
        { id: 'challenge-1', kind: 'long', label: 'Challenge or obstacle #1', text: 'During our six-month journey together, we will explore three significant challenges or obstacles that you’re currently encountering. I invite you to share the most crucial challenge or obstacle you wish for us to focus on.' },
        { id: 'challenge-1-detail', kind: 'long', label: 'What it is doing to you', text: 'Please share a concise description of the challenge or obstacle you’re facing and how it’s affecting you. This will help me gain a clear understanding of the situation and why you feel stuck or stymied.' },
        { id: 'challenge-2', kind: 'long', label: 'Challenge or obstacle #2', text: 'Could you please share another significant challenge or obstacle that you’d like us to prioritize and work on?' },
        { id: 'challenge-2-detail', kind: 'long', label: 'How it is getting in the way', text: 'Provide some background on how it is affecting you and getting in the way of your life and well-being.' },
        { id: 'challenge-3', kind: 'long', label: 'Challenge or obstacle #3', text: 'What’s the third and final obstacle or challenge you’d like to focus on in our time together?' },
        { id: 'challenge-3-detail', kind: 'long', label: 'What it costs you', text: 'Describe how this challenge or obstacle is affecting your overall well-being and creating impediments in your life?' },
      ],
    },
    {
      heading: 'What you bring with you',
      prompts: [
        { id: 'prior-work', kind: 'long', label: 'Your path so far', text: 'Could you share a bit about your previous personal growth journey before joining Mind/Body Foundations? This could include experiences like therapy, meditation, influential books, or significant people who’ve guided you.' },
      ],
    },
    {
      heading: 'How we work together',
      prompts: [
        { id: 'support', kind: 'long', label: 'What support looks like', text: 'To effectively be your guide, I need clear expectations. This also helps me maintain a strong, transparent relationship, especially when facing challenges or communication hiccups. What would support look like for you? What expectations do you have of me? What might disappoint you?' },
        { id: 'breakdown', kind: 'long', label: 'When something goes wrong between us', text: 'How would you prefer to communicate if there’s a breakdown in our communication or you’re feeling disappointed with me or the process?' },
        { id: 'behind', kind: 'long', label: 'When you fall behind', text: 'How do you want me to communicate with you when either you’re late in sending in your journaling, or you don’t complete the reading and journaling required for our meeting?' },
      ],
    },
    {
      heading: 'What we are agreeing to',
      note: 'Yes or no to each. Add a note if you want to say more.',
      prompts: [
        { id: 'agree-human', kind: 'agree', label: 'Permission to be human', text: 'Just like anyone, I’m bound to make a few mistakes here and there, despite my best intentions. It’s part of being human. Do I have your permission to be human and occasionally err?' },
        { id: 'agree-say-so', kind: 'agree', label: 'Say so right away', text: 'I’m all about making sure you have the best experience possible. But if something doesn’t quite hit the mark or feels a bit off, would you be willing to have a transparent conversation with me right away?' },
        { id: 'agree-on-time', kind: 'agree', label: 'On time', text: 'Would you be on board with making sure to be on time for all our meetings? It really helps everything run smoothly.' },
        { id: 'agree-48', kind: 'agree', label: 'Forty-eight hours', text: 'Just to set expectations, are you okay with the understanding that if an appointment is cancelled less than 48 hours before the session, there would be a charge for rescheduling that session?' },
        { id: 'agree-not-everything', kind: 'agree', label: 'Not everything gets solved', text: 'Can we agree that while we’re dedicated to helping you overcome challenges, it may not be possible to resolve every single issue within our set time frame? Would you be okay not expecting all your problems to be completely sorted out by the end of this training?' },
        { id: 'agree-no-big-moves', kind: 'agree', label: 'No big moves for now', text: 'Unless you’ve already got some big plans in motion, could we agree that you’ll hold off on making any life-changing decisions until we wrap up this training? You know, like no rushing into or out of marriages, no quitting your job on a whim, or kicking off a new business venture. Does that sound fair?' },
        { id: 'agree-meditation', kind: 'agree', label: 'Daily meditation', text: 'Would you commit to daily meditation, starting with 10 to 12 minutes and eventually building up to 30 minutes?' },
        { id: 'agree-prepared', kind: 'agree', label: 'Come prepared', text: 'Could you promise to come prepared for each of our meetings? It’ll make our time together much more productive.' },
        { id: 'agree-concise', kind: 'agree', label: 'Key points', text: 'If you’ve got stories to tell, could we agree on you giving the key points to keep things concise and save time?' },
        { id: 'agree-interrupt', kind: 'agree', label: 'Being interrupted', text: 'Could we come to an understanding where if I interrupt you or ask you to get to the point, you won’t take it personally? It’s all about keeping our conversation productive.' },
        { id: 'agree-private', kind: 'agree', label: 'Keeping the materials private', text: 'Can we agree that you won’t share the materials from Mind/Body Foundations, like the reading, journaling, and meditation content, with others?' },
      ],
    },
    {
      heading: 'Three insights',
      note: 'Take a moment to share three insights or lessons you’ve gained from this exercise. These could include discoveries about yourself while rating different areas of your life, the challenges or obstacles you wish to overcome, or your expectations of me, the training, and yourself.',
      prompts: [
        { id: 'insight-1', kind: 'short', label: 'Insight #1', text: '' },
        { id: 'insight-2', kind: 'short', label: 'Insight #2', text: '' },
        { id: 'insight-3', kind: 'short', label: 'Insight #3', text: '' },
      ],
    },
  ],
};

const TURNING_POINT = {
  module: 1,
  slug: 'your-turning-point',
  code: '01.03A',
  kind: 'Journal',
  title: 'Your Turning Point',
  blurb: 'The moment that got you here, and what it is asking of you.',
  intro: 'Life has a way of nudging us, sometimes softly, sometimes with a shove, toward moments we can’t ignore. These turning points, whether they come as quiet whispers or wake-up calls, invite us to stop and take a closer look at where we are and where we’re headed. This journal is designed to help you make sense of those moments, to put words to your experience, and to see what they’re asking of you. Don’t censor yourself, just write whatever comes to mind.',
  sections: [
    {
      heading: '',
      prompts: [
        { id: 'tp-1', kind: 'long', label: 'The feeling', text: 'Take a moment to pause and look at your life as it is right now. Do you feel a quiet whisper, a gentle tug, or maybe even a forceful push, telling you that something needs to change? It might be a faint feeling of restlessness or a heavier sense that you’re carrying too much. What is that feeling trying to say?' },
        { id: 'tp-2', kind: 'long', label: 'What lingers', text: 'Think about your own turning point. Is there a challenge, a question, or a discomfort that keeps lingering, no matter how much you try to ignore it? How does it show up for you, and how would you describe it to someone else?' },
        { id: 'tp-3', kind: 'long', label: 'What holds you back', text: 'What fears or doubts come up as you face this? Do you notice yourself hesitating, pulling back, or finding reasons to stay where you are? What might be hiding beneath those hesitations?' },
        { id: 'tp-4', kind: 'long', label: 'The other side', text: 'Now, imagine what could be on the other side. If you fully stepped into the unknown, what might shift? What do you think could be possible for you by answering the call?' },
        { id: 'tp-5', kind: 'long', label: 'What it is asking', text: 'What does this moment mean for you? Does it feel like a crack opening, a gentle nudge, or something entirely different? How is it asking you to show up in a new way?' },
      ],
    },
  ],
};

const BEGINNERS_MIND = {
  module: 1,
  slug: 'beginners-mind',
  code: '01.06A',
  kind: 'Journal',
  title: 'Beginner’s Mind',
  blurb: 'One of your challenges, looked at as though you had never seen it before.',
  intro: 'An inquiry into one of your challenges or obstacles using what is known as beginner’s mind.',
  sections: [
    {
      heading: 'The story you are carrying',
      prompts: [
        { id: 'bm-1', kind: 'long', label: 'The loudest story', text: 'Start by bringing to mind the obstacle or challenge you’ve been grappling with. What is the loudest story your mind is spinning about this challenge? What invisible assumptions or subtle fears are shaping how you see it? What truths have you accepted without even realizing it? If you said this story out loud to a trusted friend, how might they challenge or question it?' },
        { id: 'bm-2', kind: 'long', label: 'What it stirs up', text: 'What past experiences, especially ones of failure, rejection, or humiliation, does this situation stir up? How might those old wounds be distorting how you’re seeing things today? Are you reacting to this moment or to echoes of the past?' },
        { id: 'bm-3', kind: 'long', label: 'What you started believing', text: 'Now go deeper. What beliefs did those experiences leave behind? What did you start believing about yourself, about other people, or about the world in general? Finish the sentence: the world is ___, I am ___ in that world.' },
        { id: 'bm-4', kind: 'long', label: 'Where else it shows up', text: 'Where else in your life do you notice this belief showing up, sneaking into your thinking, your relationships, or your self-talk?' },
      ],
    },
    {
      heading: 'What it makes you do',
      prompts: [
        { id: 'bm-5', kind: 'long', label: 'When it takes the wheel', text: 'What do you do when this belief takes the driver’s seat? How does it shape your behavior? Do you overwork, shrink back, over-explain yourself, play small, seek approval, withdraw?' },
        { id: 'bm-6', kind: 'long', label: 'How you talk to yourself', text: 'When it’s running your inner dialogue, how do you talk to yourself? How do you see yourself? Do you judge, push, diminish, or abandon yourself? What words or tone would you never use on a friend, but regularly use on yourself?' },
        { id: 'bm-7', kind: 'long', label: 'What you reach for', text: 'What recurring behaviors or coping strategies come alive when this belief is in play? Maybe you scroll obsessively, people-please, procrastinate, strive for perfection, or numb out. In your hardest moments, what are you reaching for to escape this feeling?' },
      ],
    },
    {
      heading: 'A wider look',
      note: 'Chad’s Beginner’s Mind meditation belongs here, before the questions below.',
      audio: { label: 'The Beginner’s Mind Meditation', href: '' },
      prompts: [
        { id: 'bm-8', kind: 'long', label: 'The neutral outsider', text: 'If a wise, neutral outsider observed your situation, what might they see that you can’t?' },
        { id: 'bm-9', kind: 'long', label: 'If success were not the goal', text: 'What would you try if success wasn’t the goal, but learning and freedom were?' },
        { id: 'bm-10', kind: 'long', label: 'A mystery, not a problem', text: 'If this challenge were a mystery, not a problem to solve, what clues would you follow?' },
        { id: 'bm-11', kind: 'long', label: 'What is different now', text: 'Compared to when you started this reflection, what’s different? Notice any shifts in your thinking, your emotional temperature, or even physical sensations.' },
        { id: 'bm-12', kind: 'long', label: 'One small experiment', text: 'If you approached this challenge with open curiosity, as an experiment rather than a test, how might you navigate it differently? What’s one small, low-stakes experiment you could run?' },
      ],
    },
  ],
};

const JOURNALS = [ABOUT_YOU, TURNING_POINT, BEGINNERS_MIND];

const BY_SLUG = new Map(JOURNALS.map((j) => [j.slug, j]));

function findJournal(moduleNumber, slug) {
  const journal = BY_SLUG.get(String(slug));
  if (!journal || journal.module !== Number(moduleNumber)) return null;
  return journal;
}

function allPrompts(journal) {
  const out = [];
  for (const section of journal.sections) {
    for (const prompt of section.prompts) out.push(prompt);
  }
  return out;
}

function journalsForModule(moduleNumber) {
  return JOURNALS.filter((j) => j.module === Number(moduleNumber));
}

module.exports = { JOURNALS, findJournal, allPrompts, journalsForModule };
