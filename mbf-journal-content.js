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

// ── Module 2 ────────────────────────────────────────────────────

const TOP_CHALLENGES = {
  module: 2,
  slug: 'your-top-challenges',
  code: '02.02A',
  kind: 'Journal',
  title: 'Review Your Top Challenges and Obstacles',
  blurb: 'The three things you named at the start, looked at again now that you know more.',
  intro: 'By the time many of my clients get to this stage in our work together, they have a new set of goals or things they’d like to get out of our time together. The original challenges and obstacles they began with aren’t particularly accurate. What follows is an opportunity for you to reassess or reframe the challenges and obstacles you started with in About You. If you are clear that the challenges and obstacles you started with are still true for you, please skip this exercise. If, on the other hand, you want to reconsider, this is your chance.',
  sections: [
    {
      heading: '',
      prompts: [
        { id: 'tc-1', kind: 'long', label: 'The first one', text: 'What is the first challenge or obstacle you want to make sure we work on or address in our time together?' },
        { id: 'tc-1-known', kind: 'long', label: 'How you will know', text: 'How will you know we have succeeded in our work? What specific and measurable goals will you have achieved?' },
        { id: 'tc-2', kind: 'long', label: 'The second one', text: 'Considering the second challenge or obstacle you’d like to focus on. Is the one you stated in About You accurate, or would you like to reframe it? If so, how would you like to do so?' },
        { id: 'tc-2-known', kind: 'long', label: 'How you will know', text: 'Get as specific as possible about how you would know you will have resolved that issue. What will have happened? What would it look like?' },
        { id: 'tc-3', kind: 'long', label: 'The third one', text: 'Going back to the third challenge or obstacle you specified on About You. Is it still the challenge or obstacle you’d like to work on? Would you like a completely new challenge? Or would you like to reframe the current one you’ve stated?' },
        { id: 'tc-3-known', kind: 'long', label: 'What it would be like', text: 'In your mind’s eye, see if you can sense what it would look like or what would be happening in your life, or what it would be like if you resolved that challenge or obstacle. Specifically, what are you hoping for and maybe even expecting from our time together?' },
      ],
    },
  ],
};

const THE_EGO = {
  module: 2,
  slug: 'the-ego',
  code: '02.02B',
  kind: 'Journal',
  title: 'The Ego',
  blurb: 'The rules that decided which parts of you were allowed to show up.',
  intro: 'This exercise is a chance to take a step back and explore the different stages of your life, not by analyzing every detail, but by noticing the patterns and impressions that shaped how you see yourself today. It’s less like flipping through an old photo album and more like tuning into the vibe of those times, the feelings, the roles you played, and the parts of you that came forward or stayed quiet. Try not to overthink this. It’s not about finding the perfect answer but about being curious and open to whatever comes up. As you reflect, you might start to see how the rules you’ve lived by have helped you, protected you, or maybe even held you back. This is about noticing those rules and considering how they’ve shaped your story, so you can decide what still fits with who you are and what no longer does.',
  sections: [
    {
      heading: 'The meditation',
      note: 'Find a quiet, comfortable space where you won’t be disturbed for the next 20 minutes. Make sure you feel warm, cozy, and supported as you settle in. This is your time to relax, reflect, and explore the formation of your ego.',
      audio: { label: 'The meditation on the formation of the ego', href: '' },
      prompts: [],
    },
    {
      heading: 'What you noticed',
      prompts: [
        { id: 'ego-1', kind: 'long', label: 'What stood out', text: 'When you look back at the feelings or sensations that came up during the meditation, what stood out the most? Were there parts of you that felt like they were leading the way or taking charge, and others that were quieter or harder to notice? What does that tell you about how different aspects of yourself have shown up in your life?' },
        { id: 'ego-2', kind: 'long', label: 'The unspoken rules', text: 'What unspoken rules do you think have shaped which parts of you take the lead and which stay in the background? Maybe there were rules about who you needed to be, how you should act, or what parts of you had to stay quiet. Where do you think those rules came from?' },
        { id: 'ego-3', kind: 'long', label: 'Who set them', text: 'How did the people in your life influence the rules about which parts of you were allowed to show up? Think about caregivers, friends, or others who were important at different stages. Did they encourage certain parts of you to step forward, while others had to step back or stay hidden? How do you think their presence, or even their absence, shaped these dynamics?' },
        { id: 'ego-4', kind: 'long', label: 'The pattern across the stages', text: 'Did you notice any patterns or themes about which parts of you have taken the lead across different stages of your life? Maybe some aspects, like the achiever or the caretaker, have always been in charge, while others, like the artist or the dreamer, stayed in the background. What does that reveal about the story you’ve been living?' },
        { id: 'ego-5', kind: 'long', label: 'What got pushed aside', text: 'Were there times when certain parts of you had to take on bigger roles or stay quiet to keep things moving smoothly? Maybe some aspects were pushed aside or kept out of view altogether. Are there parts of you that feel like they’ve been stuck in the background for too long, or parts you’d like to reconnect with?' },
        { id: 'ego-6', kind: 'long', label: 'All of it together', text: 'When you step back and look at all the stages of your life together, what stands out about the rules that decided which parts of you could shine and which stayed hidden? How have these rules shaped the way you see yourself and how you move through the world?' },
        { id: 'ego-7', kind: 'long', label: 'Whose rules they are', text: 'Which of these rules feel like they truly belong to you, and which feel like they came from others, maybe from expectations, past experiences, or fears? What do you notice about how these rules have guided you?' },
        { id: 'ego-8', kind: 'long', label: 'Seeing the rulebook', text: 'If your ego is the rulebook, how does it feel to see it more clearly now? What have you discovered about its purpose, and how might you approach it differently moving forward?' },
      ],
    },
  ],
};

const KIDS_ON_THE_BUS = {
  module: 2,
  slug: 'kids-on-the-bus',
  code: '02.04B',
  kind: 'Journal',
  title: 'The Kids on the Bus',
  blurb: 'One stuck place, the parts that took the wheel, and what each of them was protecting.',
  audio: { label: 'Chad’s introduction to this journal', href: 'https://www.dropbox.com/s/k84gjs3zqyd8s86/Q_1.mp3?dl=0' },
  sections: [
    {
      heading: 'The story',
      audio: { label: 'Before you write', href: 'https://www.dropbox.com/s/1dzjyb2k2bmq01n/Q_2.mp3?dl=0' },
      prompts: [
        { id: 'kb-story', kind: 'long', label: 'The story you are carrying', text: 'In an unfiltered way, please share the story you are carrying about that stuck or reactive place.' },
      ],
    },
    {
      heading: 'Label the parts',
      note: 'See 02.04c, Who’s Driving the Bus, for the list to choose from.',
      prompts: [
        { id: 'kb-part-1', kind: 'short', label: 'Part 1', text: '' },
        { id: 'kb-part-2', kind: 'short', label: 'Part 2', text: '' },
        { id: 'kb-part-3', kind: 'short', label: 'Part 3', text: '' },
        { id: 'kb-part-4', kind: 'short', label: 'Part 4', text: '' },
      ],
    },
    {
      heading: 'Aware',
      audio: { label: 'Before you write', href: 'https://www.dropbox.com/s/cn3byedgc7iti1o/Q_7.mp3?dl=0' },
      prompts: [
        { id: 'kb-aware', kind: 'long', label: 'Standing apart from them', text: 'Describe what it’s like to distinguish yourself from the parts you labeled above.' },
      ],
    },
    {
      heading: 'Beginner’s mind with Part 1',
      prompts: [
        { id: 'kb-1-word', kind: 'long', label: 'A word for it', text: 'Find a word, image or phrase that matches what it is that you feel in there.' },
        { id: 'kb-1-why', kind: 'long', label: 'What makes it so', text: 'What from the story above makes you feel this way?' },
        { id: 'kb-1-where', kind: 'long', label: 'Where else', text: 'Where else do these feelings, these sensations show up in my life? Where else have I felt this way?' },
        { id: 'kb-1-afraid', kind: 'long', label: 'What it fears', text: 'What is this part afraid might happen if it did not do this inside you?' },
      ],
    },
    {
      heading: 'Part 2',
      prompts: [
        { id: 'kb-2-feel', kind: 'long', label: 'What it feels', text: 'Describe what this part is feeling.' },
        { id: 'kb-2-why', kind: 'long', label: 'What makes it so', text: 'What about the story above makes it feel this way?' },
        { id: 'kb-2-where', kind: 'long', label: 'Where else', text: 'Where else in your life does this part get triggered?' },
        { id: 'kb-2-afraid', kind: 'long', label: 'What it fears', text: 'What is this part afraid might happen?' },
      ],
    },
    {
      heading: 'Part 3',
      prompts: [
        { id: 'kb-3-feel', kind: 'long', label: 'What it feels', text: 'What Part 3 feels like.' },
        { id: 'kb-3-why', kind: 'long', label: 'What makes it so', text: 'What makes it this way?' },
        { id: 'kb-3-where', kind: 'long', label: 'Where else', text: 'Where else in your life does this part get triggered?' },
        { id: 'kb-3-wants', kind: 'long', label: 'What it wants', text: 'What is this part wanting or trying to prevent?' },
      ],
    },
    {
      heading: 'Closing',
      prompts: [
        { id: 'kb-anything-else', kind: 'long', label: 'Anything else', text: 'Naming anything else that wants to come.' },
        { id: 'kb-remember', kind: 'long', label: 'What to remember', text: 'Naming any insights or anything you’d like to remember.' },
      ],
    },
  ],
};

// ── Module 3 ────────────────────────────────────────────────────

const FORMATION_OF_A_REACTION = {
  module: 3,
  slug: 'formation-of-a-reaction',
  code: '03.03A',
  kind: 'Journal',
  title: 'The Formation of a Reaction',
  blurb: 'One reactive moment, slowed down far enough to see each step of it.',
  intro: 'When something sets us off, it’s not just our brain going on autopilot. It’s like one of the kids on our internal bus jumps into the driver’s seat and floors it. These protective parts learned a long time ago how to keep us safe. They shut things down, lash out, try to please, or disappear altogether. They mean well. But they’re following outdated maps drawn in moments of fear and pain. The trouble is, those maps don’t belong to the present. So when your partner criticizes you or your boss drops a passive-aggressive comment, you’re not just responding to them. You’re reacting to every other time you felt small, unseen, attacked, or like you didn’t matter. Your body knows before your mind does. Your chest tightens. Your breath goes shallow. Your thoughts spiral. I’m wrong. I have to fix this. I need to get out. These aren’t random. They’re the echoes of old survival strategies kicking in. They’re fast, automatic, and familiar. This is what the Buddhist tradition calls a sankhara, a patterned loop of reactivity, the moment when the kids on the bus come alive again. Here is how it unfolds. Contact is when something lands: a look, a tone, a comment. Feeling tone, vedana, is the body’s immediate response: tight chest, hot face, sinking stomach. Interpretation, sanya, is the story that forms: I’m failing, they’re against me, I’m not safe. Reaction, sankhara, is the move you make: the shutdown, the lashing out, or the ways you appease, numb, or run. Suffering, dukkha, is what lingers: shame, blame, resentment, or exhaustion. These are your parts, your kids, leaping into action. One panics. One pleases. One explodes. One hides. None of them are wrong. They’re just doing what they were built to do: protect you. It’s not chaos. It’s a system. And awareness lets you step into that system, not to shut it down or push it away, but to slow it down enough to see what’s really happening. Each moment in the cycle, whether it is contact, sensation, story, reaction, or aftermath, is a place where you can take the wheel back. A place to step in as awareness. A place to shift the pattern. A place to rewire what used to be automatic so that the kids don’t have to keep driving your life.',
  sections: [
    {
      heading: 'The moment itself',
      prompts: [
        { id: 'fr-spark', kind: 'long', label: 'Start with the spark', text: 'Think of a recent moment when you got reactive or unsettled. It could be a conversation, a comment, a situation that threw you off. Try choosing a moment that connects to a core challenge or pattern you’ve been working with in Mind/Body Foundations. What happened? Who was there? What was said or done? Describe the moment clearly, like a scene you could replay.' },
        { id: 'fr-body', kind: 'long', label: 'Drop into the body', text: 'What was the first thing your body did in response? What sensations showed up right away? Did you feel tightness, heat, fluttering, pressure, freezing, or numbness? Write down what you felt physically. Afterward, notice: when that sensation showed up, which kid is generating these sensations?' },
        { id: 'fr-interpretation', kind: 'long', label: 'Notice the interpretation', text: 'What does this part believe? What are they making the trigger mean? Are they thinking, I’m not safe, they’re against me, I’m not enough, or I always mess this up? What are they afraid might happen?' },
        { id: 'fr-reaction', kind: 'long', label: 'How that kid reacted', text: 'What is the automatic reaction? Try to identify the part that takes the wheel when the previous one feels those sensations and makes the interpretations. Is it the angry kid, the fixer, the frozen one, the appeaser, the one who just wanted to vanish? Give them a name if it helps. Try to figure out which part inside is reacting.' },
        { id: 'fr-others', kind: 'long', label: 'Who else showed up', text: 'Do any other parts show up? Do you notice a shaming part, a frustrated part, guilt or sadness? What is this part trying to protect?' },
      ],
    },
    {
      heading: 'Staying with it',
      prompts: [
        { id: 'fr-be-with', kind: 'long', label: 'Be with the sensation', text: 'Set a timer for three minutes. Bring your attention to where you feel the strongest sensations. Is it your chest, belly, throat, shoulders, or somewhere else entirely? Stay with those sensations without trying to fix, change, or push them away. Notice if a specific part is there, a kid on the bus who got overwhelmed or scared. Keep them company. You don’t need to say anything. Just sit beside them.' },
        { id: 'fr-shift', kind: 'long', label: 'Observe the shift', text: 'As you stay with the feeling, what starts to change? Do the sensations soften, move, get louder, or quieter? Notice how that kid responds to your attention. What do they need? What happens when they’re not alone with it?' },
        { id: 'fr-pause', kind: 'long', label: 'Imagine the pause', text: 'If you could pause right before the kid took over, what would you have needed in that moment? What could you say to that part to help it feel safe? What support would have helped you stay grounded?' },
      ],
    },
    {
      heading: 'Rewire the story',
      note: 'What does this part usually believe about you, others, or the world? Now, what could you gently offer instead? What three new truths might this part not know yet, but is ready to hear, not to fix it, just to offer a new path.',
      prompts: [
        { id: 'fr-truth-1', kind: 'short', label: 'New truth #1', text: '' },
        { id: 'fr-truth-2', kind: 'short', label: 'New truth #2', text: '' },
        { id: 'fr-truth-3', kind: 'short', label: 'New truth #3', text: '' },
      ],
    },
    {
      heading: 'Looking back',
      prompts: [
        { id: 'fr-learned', kind: 'long', label: 'What you learned', text: 'What did you learn about the part that showed up and the story it was carrying? How did being with the sensation shift your relationship to that part, or to the moment itself? What does this practice teach you about how to care for yourself, not by judging or fixing, but by offering presence, patience, and curiosity when you need it most?' },
      ],
    },
  ],
};

const EARLY_WARNING_SYSTEM = {
  module: 3,
  slug: 'early-warning-system',
  code: '03.04A',
  kind: 'Journal',
  title: 'Our Early Warning System',
  blurb: 'Fight, flight and freeze, and the signals each of them sends before you notice.',
  intro: 'When we get triggered, our body reacts automatically, clenching, tensing, or shutting down, before we even realize it. These fight, flight, and freeze responses are your body’s way of trying to protect you, but without awareness, they can pull you out of balance. This exercise will help you tune into the early signals these states send, those subtle sensations in your throat, chest, and belly, so you can recognize when you’re starting to leave your window of presence. By listening to what these signals are telling you, you can meet them with more curiosity, care, and choice. This is about reclaiming your ability to respond intentionally, staying steady when life feels unsettled.',
  sections: [
    {
      heading: 'Three moments, before the meditation',
      note: 'Hold these moments in mind as you prepare for the meditation. You’ll explore each of these states, noticing how they show up in your body and what they’re trying to tell you.',
      prompts: [
        { id: 'ew-fight', kind: 'long', label: 'Fight', text: 'Think back to a moment when you felt the urge to fight. Maybe someone said or did something that made you feel defensive or angry, like you needed to push back or stand your ground. What triggered this reaction?' },
        { id: 'ew-flight', kind: 'long', label: 'Flight', text: 'Now recall a time when you wanted to escape, when things felt too overwhelming or too much to handle, and you just wanted to get away. What was happening in that moment?' },
        { id: 'ew-freeze', kind: 'long', label: 'Freeze', text: 'Finally, bring to mind a time when you froze, when you felt stuck, unable to move or speak, as though everything slowed down or shut off. What caused this feeling?' },
      ],
    },
    {
      heading: 'The meditation',
      audio: { label: 'The early warning system meditation', href: '' },
      prompts: [],
    },
    {
      heading: 'What your body said',
      prompts: [
        { id: 'ew-fight-body', kind: 'long', label: 'In the fight response', text: 'What did you notice in your throat, chest, and belly during the fight response? Did the sensations, like tightness, heat, or pressure, feel protective? If they could speak, what might they say they’re trying to defend or stand up for?' },
        { id: 'ew-flight-body', kind: 'long', label: 'In the flight response', text: 'What sensations emerged during the flight response? Did you feel fluttering, lightness, or a quickening in your chest? What might these sensations be urging you to escape or avoid?' },
        { id: 'ew-freeze-body', kind: 'long', label: 'In the freeze response', text: 'What sensations showed up during the freeze response? Did you sense heaviness, numbness, or stillness in your body? If these feelings had wisdom, what might they be telling you about safety or shutting down?' },
        { id: 'ew-return', kind: 'long', label: 'Coming back', text: 'When you returned to your window of presence, how did the sensations shift? What did it feel like physically or emotionally to come back to a sense of steadiness and balance?' },
        { id: 'ew-daily', kind: 'long', label: 'Catching it earlier', text: 'How might you practice noticing these early signals in your daily life so you can return to presence more quickly?' },
        { id: 'ew-intention', kind: 'long', label: 'One small intention', text: 'Now that you’ve explored these responses, consider how you can notice these signals earlier in daily life. What simple action, like observing your breath or relaxing your shoulders, can help you pause and return to presence? Write down one small, doable intention to practice this week. Small steps lead to big changes.' },
      ],
    },
  ],
};

const SENSATIONS_VERSUS_EMOTIONS = {
  module: 3,
  slug: 'sensations-versus-emotions',
  code: '03.06A',
  kind: 'Journal',
  title: 'Sensations Versus Emotions',
  blurb: 'The raw feeling in the body, underneath the name the mind gives it.',
  intro: 'We often experience emotions like anger, fear, or sadness as the truth of what’s happening. But emotions are just stories our brain creates, interpretations layered over the raw sensations we feel in the body. These sensations, like tightness, warmth, or heaviness, are the body’s first signals that something is happening. They show up before the mind labels them as good, bad, or anything in between. The real work begins when we learn to pause, notice those physical signals, and stay with them instead of jumping straight into stories or judgments. By exploring sensations on their own, we can respond to discomfort with more steadiness, presence, and clarity.',
  sections: [
    {
      heading: 'Step 1: Choose an emotionally charged experience',
      prompts: [
        { id: 'se-1', kind: 'long', label: 'The moment', text: 'Think back to a recent moment when you felt a strong emotion, something like anger, sadness, fear, or frustration. What was happening in that moment? Where were you? Who else was there? What made this experience stand out for you? Keep it simple, noting just the facts of the situation without diving into explanations or blame.' },
      ],
    },
    {
      heading: 'Step 2: Separate the emotion from the sensation',
      note: 'Stay with the raw sensation, without naming the emotion or explaining it.',
      prompts: [
        { id: 'se-2', kind: 'long', label: 'Where it lives', text: 'Take a deep breath and bring your attention to your body. Where do you feel this experience the most? Your throat, chest, stomach, or somewhere else? Notice what’s there and describe it as simply as you can: is it tight, heavy, cool, warm, or fluttering?' },
      ],
    },
    {
      heading: 'Step 3: Explore the difference',
      prompts: [
        { id: 'se-3', kind: 'long', label: 'The sensation on its own', text: 'Let go of the story about what happened and focus just on the sensation itself. What does it feel like right now? Pulsing, shifting, steady, or sharp? Does it stay the same, soften, or change as you observe it?' },
        { id: 'se-3b', kind: 'long', label: 'If it could speak', text: 'If it could speak, what might it say? What does it need: your care, attention, or patience?' },
      ],
    },
    {
      heading: 'Step 4: Stay with the sensation',
      prompts: [
        { id: 'se-4', kind: 'long', label: 'Giving it space', text: 'Spend a minute staying with the strongest sensation without judging it. Allow it to be there, without pushing it away or trying to fix it. What happens when you give it space? Does it shift or release, or does it simply wait to be felt?' },
      ],
    },
    {
      heading: 'Step 5: Reflection',
      prompts: [
        { id: 'se-5', kind: 'long', label: 'What changed', text: 'Now return to the emotion you started with. How did focusing on the sensation shift your relationship to it? Did the physical experience feel different from the label or story you gave it? Reflect on what surprised you and how staying with the body kept you more connected to the present moment.' },
      ],
    },
    {
      heading: 'Step 6: Carrying it forward',
      prompts: [
        { id: 'se-6', kind: 'long', label: 'Your intention', text: 'As you close, consider this: next time a strong emotion arises, can you pause and ask, what’s happening in my body right now? Write a simple intention, like: when I feel a strong emotion, I will pause, notice the sensation, and breathe with it.' },
      ],
    },
  ],
};

const MODULE_3_SESSION_PREP = {
  module: 3,
  slug: 'session-prep-3',
  code: '03.08',
  kind: 'Session prep',
  title: 'Session Prep',
  blurb: 'Where you are before we meet, and one live thing to walk into together.',
  intro: 'Before our next session, please reflect upon the last few weeks.',
  sections: [
    {
      heading: 'Check in',
      prompts: [
        { id: 'sp3-unclear', kind: 'long', label: 'What is unclear', text: 'What content from the readings, meditations, or journaling feels unclear or challenging? Where would you like more guidance?' },
        { id: 'sp3-insights', kind: 'long', label: 'What you have noticed', text: 'What breakthroughs or insights have you noticed, big or small?' },
        { id: 'sp3-stuck', kind: 'long', label: 'Where you got stuck', text: 'Have there been any moments where you felt stuck, reactive, or out of balance? What happened, and what did you learn from it?' },
      ],
    },
    {
      heading: 'For this session',
      note: 'As we move into this session, we’ll be working with sankharas, the deeply ingrained patterns of reactivity that shape how we respond, often without realizing it. These patterns usually form early in life and live in the body, not just the mind.',
      prompts: [
        { id: 'sp3-live', kind: 'long', label: 'A living moment', text: 'Write about a situation or relationship that’s been stirring up reactivity in you. Pick something that feels emotionally charged. Maybe you’ve been more anxious, more controlling, caught in shame, or overwhelmed by worst-case thinking. Maybe your inner critic has been especially loud. Let yourself name the emotion and describe how it moves through your body or your thoughts when it hits. Then describe how you tend to react. Do you shut down. Do you overfunction. Do you disappear into mental loops. Do you go numb. Think of this as a snapshot of a living moment in your internal system that we can walk into together and explore.' },
      ],
    },
  ],
};

const JOURNALS = [
  ABOUT_YOU, TURNING_POINT, BEGINNERS_MIND,
  TOP_CHALLENGES, THE_EGO, KIDS_ON_THE_BUS,
  FORMATION_OF_A_REACTION, EARLY_WARNING_SYSTEM, SENSATIONS_VERSUS_EMOTIONS, MODULE_3_SESSION_PREP,
];

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
