// The Mind/Body Foundations On-Ramp course, served from this app instead
// of Squarespace. Four weekly lesson pages built from Chad's build-ready
// course content (drafted July 14, 2026), an overview page, and the same
// per-person access codes that unlock the practice companions. Lesson
// content is delivered only through the code-checked API, not embedded in
// the public page source. Video and most meditation slots are placeholders
// until Chad records them; Week 1's slot carries the recorded 12-minute
// breathing practice. Week 1 is in the Mind/Body Foundations shape (docs/68,
// 9/11/26): an introduction, three pieces, a practice card, two journals.
const crypto = require('node:crypto');
const { hasAccess, WEEKS, JOURNAL, issueSignedCode, ensureCodeRegistry } = require('./onramp');
const { defaultStore, newRecord, findByCode, dayEntry, nameCode } = require('./onramp-store');
const { normaliseTimeZone, localDateString } = require('./onramp-schedule');
const { handleYayRoute, handleSmsInbound } = require('./onramp-yaynay');
const emails = require('./onramp-emails');
const brief = require('./onramp-brief');

const COURSE_PATH = '/course/on-ramp';

// PayPal configuration, all via environment; PAYPAL_BASE_URL exists for
// tests to point at a mock. Self-serve enrollment is enabled only when
// every piece is present.
function paypalConfig() {
  const env = String(process.env.PAYPAL_ENV || 'sandbox');
  return {
    clientId: String(process.env.PAYPAL_CLIENT_ID || ''),
    clientSecret: String(process.env.PAYPAL_CLIENT_SECRET || ''),
    baseUrl:
      process.env.PAYPAL_BASE_URL ||
      (env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
    sdkBase: 'https://www.paypal.com/sdk/js',
    priceUsd: String(process.env.ONRAMP_PRICE_USD || ''),
    regularPriceUsd: String(process.env.ONRAMP_REGULAR_PRICE_USD || ''),
  };
}

function selfServeEnabled() {
  const p = paypalConfig();
  return Boolean(p.clientId && p.clientSecret && p.priceUsd && process.env.ONRAMP_CODE_SECRET);
}

// Summarizes a PayPal error response as name/issue/debug_id only; never
// any buyer information.
async function paypalErrorSummary(res) {
  try {
    const body = await res.json();
    const issue = body.details && body.details[0] && body.details[0].issue;
    return 'HTTP ' + res.status + ' ' + (body.name || '') + (issue ? ' ' + issue : '') + (body.debug_id ? ' debug_id=' + body.debug_id : '');
  } catch {
    return 'HTTP ' + res.status;
  }
}

async function paypalToken() {
  const p = paypalConfig();
  const res = await fetch(p.baseUrl + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(p.clientId + ':' + p.clientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('PayPal auth failed: HTTP ' + res.status);
  return (await res.json()).access_token;
}

async function paypalCreateOrder() {
  const p = paypalConfig();
  const token = await paypalToken();
  const res = await fetch(p.baseUrl + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: 'The Performance Trap Practice (four-week course)',
          amount: { currency_code: 'USD', value: p.priceUsd },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error('PayPal order creation failed: ' + (await paypalErrorSummary(res)));
  return (await res.json()).id;
}

async function paypalCaptureOrder(orderId) {
  const p = paypalConfig();
  const token = await paypalToken();
  const res = await fetch(p.baseUrl + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('PayPal capture failed: ' + (await paypalErrorSummary(res)));
  const payload = await res.json();
  const unit = payload.purchase_units && payload.purchase_units[0];
  const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  const amount = capture && capture.amount;
  const completed = payload.status === 'COMPLETED' && capture && capture.status === 'COMPLETED';
  // PayPal reports the captured value with decimals ("295.00") while the
  // configured price may be "295"; compare as numbers, never as text. A
  // text comparison here once declared a real captured payment incomplete.
  const amountOk =
    amount &&
    amount.currency_code === 'USD' &&
    Number.isFinite(Number(amount.value)) &&
    Number(amount.value) === Number(p.priceUsd);
  return { completed: Boolean(completed && amountOk) };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function noStoreHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, noStoreHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(payload));
}

const videoPlaceholder = (label) =>
  `<div class="placeholder">A short video from Chad goes here: <em>${label}</em>. Its job is to guide the week's experience in his company, not repeat the written lesson. Coming soon; the written lesson below carries this week in the meantime.</div>`;

// Long sits stream from the R2 bucket (range requests, so a listener can
// scrub). That host MUST be on media-src in the course page policy below;
// if it is missing the player renders and never sounds, with no error.
// data-sit names the recording for listen tracking (the file name without
// its extension); the page script posts play/complete events under it.
const sitName = (src) => String(src).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
const meditationPlayer = (src, note) =>
  `<p class="small">${note}</p><audio controls preload="none" src="${src}" data-sit="${sitName(src)}" style="width:100%"></audio>`;

const meditationPlaceholder = (title, minutes) =>
  `<div class="placeholder">Guided audio to come: <em>${title}</em>, about ${minutes} minutes. Until it is recorded, use the written rhythm in the practice card below, or the Week 1 breathing recording.</div>`;

const COURSE_WEEKS = {
  1: {
    title: 'Week 1: From the Book to the Body',
    sub: "Slow the breath. Enter the body. The first two moves of SENSE, and the ground everything else stands on.",
    intro: `You've read the book, so you know the trap and you know the map. This week we start putting it in the body, because that's where the trap lives. Slow the breath, and enter the body. That's the whole week, and it's plenty.`,
    video: videoPlaceholder('Welcome. You already have the map.'),
    teaching: `
<h3>Introduction</h3>
<p>Here's why, before the how. At the core of the things you're bumping up against, the work, the relationships, the health, there's a kind of core tenderness, a core anxiety or grief, that we spend a lifetime trying to fix, ignore, or outrun. That's the ache the book is about. It stays hidden and mysterious to us because we can't access it in the head. We have to learn how to access it in the body. And the point isn't fixing. If you haven't fixed yourself by now, fixing just becomes another reason to shame yourself. The point is coming back home to yourself, to what's actually here, because it's trying to show you a new way forward. It's not an error. Over four weeks, what we're after is enough clarity around what's stuck in there that you start to have some freedom to make new choices, instead of reacting from an experience that feels unpleasant and never understanding what's bringing you to it. Not a total overhaul. Ten percent better. Ten percent better has a lot in it.</p>
<p>Here's how I teach. When you go to university and prepare for a lecture, you do the reading and the writing first, so that you come into the room ready for the actual discussion. That's the shape of each week here. Three short pieces to read, on slowing the breath, on entering the body, and on why they matter. Two journals, and you can do one or both. Then you bring what you wrote to the journal sitting, where it gets read back to you and the body gets to answer. The reading prepares the writing. The writing prepares the conversation. And all of it prepares the hour you and I will spend together at the end of the four weeks.</p>
<p>Your daily commitment is the sit. Ten to fifteen minutes with this week's breathing recording, most days. If you're just starting, five minutes today is fine. The site keeps track of when you play the recordings and when you mark a journal done, and at the end of the week I'll send you what the week looked like.</p>
<p>Plan on the three pieces early in the week, a piece a day. Do the first journal, What's Bringing You Here, in the first day or two. Do The Formation of a Reaction toward the end of the week, once you've caught a moment or two in real life. Bring what you've written to the journal sitting once or twice, whenever there's writing to bring. If you can only do a few things: sit, read The Breath, and do one journal.</p>
<p>One story before you start, a story I tell almost everyone in the first session. Start with this: it is not a story about positive thinking.</p>
<p>Two yogis are walking from Varanasi to Rishikesh, a day apart. Varanasi is the ancient city on the Ganges where people go to die. Rishikesh is where you go to find a teacher and study. The first yogi comes upon a farmer at the side of the road and asks him, sir, can you tell me, what are the people like in Rishikesh, where I'm going? And the farmer gets a little reflective and asks him, well, what were the people like in Varanasi, where you've come from? The yogi says, terrible. Liars and cheats. I got pickpocketed. I'm glad to be leaving. And the farmer says, I'm sorry, sir, but I'm afraid the people in Rishikesh are very much the way you found the people in Varanasi. And with a heavy head, the first yogi goes on his way.</p>
<p>The next day the second yogi comes along and asks the farmer the same question. The farmer asks him the same thing back. And this one says, oh, an amazing group of people. The kindest, most thoughtful people I've met. I'm sad to be leaving. And the farmer says, well, fear not, sir. The people in Rishikesh are very much the way you found the people in Varanasi.</p>
<p>So if it's not about positive thinking, what's it about? I'll leave that with you for the week. Here's the part I'll give you. We bring a quality of mind to whatever it is we do. A set of beliefs, some conscious and some not, that inform all of our experience. Those beliefs come from our past. They're your Varanasi. The next meeting, the next conversation, the next time you walk in the door at home, that's your Rishikesh. You know your future is predicated on your past. What you're unaware of is how predicated it is. This week, when something starts to fire, the question is: what am I carrying in right now? Then come back to the body and find out what's actually here.</p>
<h3>The Breath</h3>
<p>It took me fifty years and a lot of intense breathing practices to discover that the breath I actually needed, that most of us need, isn't long holds or anything dramatic. It's slow, smooth, continuous breathing. Here's why it comes first, and how to do it.</p>
<h4>Why the breath comes first</h4>
<p>We always start the work like this, and here's the reason. If the mind is agitated, it's very hard to do any work. If the mind is settled, there's a receptivity present, and we can actually do some work. That's not mysticism. It's the natural biology of the body. When the breath is shallow and rapid, you're in fight or flight. When it's slow and smooth, that's what the breath is like in a rested state, so you can mimic that state of consciousness, literally, by working the breath. This is your lever, your tool to work with your nervous system, and you always have access to it. Few of us ever learn how to use it.</p>
<p>What you're going for is bigger than calm. Most of the decisions we make are rooted in the fight or flight response, and the quality of our decisions is governed by an agitated mind. When you're elevated, you can't see your options. When you're settled, there's no rush, there's only clear steps ahead. One of my clients, after ten minutes of this, looked at a problem that had been charged an hour earlier and found it flat. That's where I want you to land: how different the world is from over here. The world view, the experience of life, the choices to be made. I can see how I could get all revved up about something, and I can also see that there are other choices. So this is not the goal of the work. This is the primary work. The goal is to discover what it is, at the deepest level, that's blinding you, and you can't see that from inside the panic. And the reason we practice every day is so that when you need it, it's quickly and easily available.</p>
<h4>The straw breath</h4>
<p>Breathe in through the nose for a count of five. Then purse your lips, like you're blowing out through a straw, and breathe out for a count of seven. Not too much pressure on the lips. Just a little restriction, so the air can't come out all at once. That's what lets the out breath get long.</p>
<p>The longer exhale is the key. This isn't about deep breaths or filling your lungs. It's about the slow, smooth, continuous flow, no strain, no holding. Almost like drinking water through a straw, as smooth and uniform as it comes in and as it goes out. Like silk on the inside. You aren't trying to relax. You're sending a signal to your nervous system that it's safe to slow down.</p>
<p>At the very end of the out breath, draw the belly back toward the spine and get all the air out. Then wait. If you get it just right, the inhale comes in on its own, reflexively, without your pulling it. There's a cleansing to that squeeze. When you've cooked something with garlic and onions and you want to make something lighter in the same pan, you clean the pan. The end of the exhale does that for the system. It's a little unpleasant, and it's where a lot of the release happens.</p>
<h4>What's actually happening in there</h4>
<p>Let me give you a little anatomy, because "just breathe" gets said so often it's become dismissive, and this isn't that.</p>
<p>You have a diaphragm, the muscle that separates the chest from the belly. Picture it as a parachute. The top of the parachute is tied to the pericardium, the muscle that surrounds the heart. The edges go around the lower ribs. When you breathe in, the parachute descends. It presses the contents of the belly down, so the belly expands, and it pulls on the heart. When you breathe out, it rises back up into the chest like a dome. Up and down, all day, every breath.</p>
<p>As it moves, it massages the organs underneath it. The liver, the stomach, the spleen, the intestines. And running right through that parachute is the vagus nerve. It travels from the brainstem down through the lungs, the heart, the gut, and it reports back up. When the exhale is long and smooth, the report it sends is: it's calm in here, safe in here. The system can downshift. Heart rate eases. Blood pressure eases. The parts of you that only come online in a settled state, the curiosity, the ability to feel what's here, come back within reach.</p>
<p>This shift isn't instant. Over five to ten minutes of slow, smooth breathing, the biology changes. If you like the technical name, this kind of slow, paced breathing is what researchers call resonance breathing. You don't need the term.</p>
<h4>Fitting the breath to the state you're in</h4>
<p>Five in and seven out calms the system. That's right when you're jumpy and agitated. But some days you're not jumpy. You're dull and heavy, maybe a little exhausted. On those days you follow the in breath all the way to the end instead. Breathe into the lower belly, the upper belly, the ribs, the center of the chest, and keep the exhale smooth. Longer inhales and shorter exhales pick things up a little. Sometimes even some shorter, quicker breathing helps, for about twenty breaths, and then you let it go and come back into the body. And if you're already even, keep it even.</p>
<p>That's why we start every sit the same way. Notice the quality of mind you're beginning with. Is it calm and clear in there? Jumpy and agitated? Dull and heavy? And notice the breath that goes with it, because the two are correlated. Deep or shallow. Rough or smooth. Fast or slow. Then choose the breath the state actually needs. The point isn't a ratio. The point is that you have a lever, and you're learning how to use it. At the end of the sit, note the quality of mind again and compare. Sometimes the only way to see what shifted is to mark where you started.</p>
<h4>The breath is a mirror for the mind</h4>
<p>People figured this out a long time ago. In the yoga tradition I come from, Krishnamacharya, the teacher nearly every school of modern yoga descends from, taught that the breath is a mirror for the mind. When the breath is scattered, the mind is agitated. When you regulate the breath, lengthening it and smoothing it, the mind steadies with it. In my own practice this is still the piece that works best, fifteen minutes a day, because it's from this calm place that I can inhabit a curious mind, observe my thoughts and feelings with openness rather than judgment, and be less tense and less reactive. Everything else in these four weeks comes after this. Working with the nervous system comes first.</p>
<h4>Summary</h4>
<ul><li>A settled nervous system is where the work becomes possible, and where you can see your options. The breath is the lever, and you always have it.</li><li>The straw breath: in through the nose for five, out through pursed lips for seven, smooth as silk, all the air out, and let the inhale come on its own.</li><li>The diaphragm moves like a parachute, massaging the organs, with the vagus nerve running through it. A long smooth exhale tells the system it's safe.</li><li>Fit the breath to the state: a longer exhale when you're jumpy, a fuller inhale when you're dull, even when you're even.</li><li>Check the quality of mind before and after every sit.</li></ul>
<h4>Action</h4>
<p>Sit with the breathing recording today, ten to fifteen minutes, eyes closed, in a posture that feels upright, feet on the floor. Sitting, not lying down. I don't lie down for sits. Before you press start, check the state you're in. Three straw breaths through the day, before a meeting, a hard email, a conversation you've been putting off.</p>
<h3>Enter the Body</h3>
<p>Here's what usually happens when something lands wrong. A meeting shows up on your calendar you weren't expecting. Before you've even read the invite, your toes curl. Your stomach knots. Your chest tightens. The mind hasn't arrived yet to explain what's happening, but the body has already declared this unpleasant.</p>
<p>Then the mind arrives with the story, and the story wants to keep talking. It wants, above all, to know why. So the second move, once the system has settled some, is a U-turn. You go from your brain and you make a U-turn back into your body.</p>
<h4>Why the body and not the story</h4>
<p>The order goes like this: a stimulus, then a feeling tone, then a story, then a reaction. The feeling tone comes before the story, every time. The story is the mind's interpretation. The body is what's actually happening. And the story wants to globalize it, to say all of me is feeling like this. The body isn't the most pleasant place to be. But it is the place that's the most honest.</p>
<p>Here's what you're hoping to get from going there. If you could see what I'm really doing with people in a session, it's this: let's tap into the wisdom of the body. I could get caught in someone's stories forever. In the body we get direct knowledge of what's actually happening, because the body teaches that. The thing that feels stuck is trying to show you the next path forward. It's confusing, but it's not about fixing the thing that's stuck. It's about listening to it, because it's trying to show you what you value and what's most important to you. It needs you to go through the stuck feeling, to acknowledge it, so you can start to hear what its deeper truth is. I always say the ache is the map home. Your body is always showing you what's next, not your mind. And the body is the place you get to come home to. It remembers the imprint of the compromise you made a long time ago, and as you learn to be with it, you start to make friends with the part that got cut off. All of that is so you can make choices grounded in presence rather than out of fear, in the middle of your life, not on a two-week vacation that never comes.</p>
<p>Here's why the turn is hard. Gabor Maté puts it this way. When we were kids, when we couldn't run, we couldn't fight back, and we couldn't ask for help, the only thing available to us was to dissociate, to leave our bodies and go to our heads. We learned it young, and ever since we tend not to be very curious about our interior experience. We tend to look the other way. So the U-turn is not a trick. It's a reorientation toward the part of you that's slower and more substantial than your thoughts, the part you learned to override.</p>
<h4>Where it lives</h4>
<p>For most of us it lives somewhere in the throat, the chest, or the belly, or a combination. That's the center region. So the first question is never why. It's where. Where is it right now? Throat, chest, belly?</p>
<p>If it's hard to feel, feel the touch of cloth on the skin as the belly rises and falls. If that's hard, put a hand on your belly, or on your chest, and feel the movement under it. If an area is blank and you can't feel much there, that's fine. It just needs practice. If what you find is numbness, stay near it. Underneath numbness there's usually discomfort, and that's information too. And whatever is there, you still have hands, you still have breath, another place to hang out.</p>
<h4>What it's like</h4>
<p>Then the quality. Tight. Heavy. Hot. Hollow. Buzzing. Numb. Find a little bit of language. When you land on a word, check it on the inside. Is that the right word? Does it capture the whole of it? If it's not quite right, add a little nuance, or find the word that does. You'll know when you land on it, because the body gives a little, or the sensation gets a little clearer, and something in you goes, yes, that's it. Pleasant, unpleasant, or neutral? Familiar?</p>
<p>Then you surround it with a little attention, and a little breath, not to break it apart, not to make it go away, just to explore it, and you see how it responds to being noticed. When your attention is in that whole center region, your gut, your upper belly, your solar plexus, you can't entertain the thoughts. It interrupts the storyline. Just keep coming back, over and over again. Sometimes that's the whole meditation.</p>
<p>The body has a kind of inner knowing. It may not express itself in words, but it will express itself in sensations. So when you're in the body and a sentence comes, let it land in the body and notice what the energy does. Say the sentence out loud and watch. That's a question you can ask all day: as I say that, what happens in there? And then the one I ask myself when something has me: how do I move from this place? How do I breathe from this place? How do I relate from this place? Not from where I think I should be. From here.</p>
<h4>Why to what</h4>
<p>The mind will keep asking why. Why am I like this. Why does this always happen. Why is a booby trap. Why keeps you in the story, and the story is where the loop lives. The question that opens things up is what. What's actually happening in the body right now? What's the quality of it? Not what you wish was there, not what you think ought to be there. What's there. That's the whole of it, and it's harder than it sounds, because everything in you was trained to look out, and very little care or attention was ever placed inward.</p>
<h4>A part of me</h4>
<p>There's a way of saying this that you can carry into the rest of your day. Instead of "I'm anxious," try "a part of me is anxious." Instead of "I'm a failure," "a part of me feels like I'm failing." Say both out loud and notice what changes in the body.</p>
<p>When you're identified with a feeling, when the butterflies are you, you only have two options. Push them down or ignore them. Neither works. You're either with the part or inside the part. Being with it is what gives you room to move. This thing that's arising, it's not all of me. It's a part of me. That's the whole foundation of the four weeks, and you're already doing it.</p>
<h4>Summary</h4>
<ul><li>The feeling tone comes before the story. The body is what's actually happening, and it's trying to show you what's next. The ache is the map home.</li><li>The U-turn: from the brain back into the body. Where, throat, chest, belly. Then the quality, then a word, then check the word.</li><li>Blank is fine, numb is information, and you always have hands and breath.</li><li>Not why. What.</li><li>"A part of me is," said out loud, is the same move in words.</li></ul>
<h4>Action</h4>
<p>Do the first journal, What's Bringing You Here, in the first day or two. Take a few minutes of breath before it. Through the day, when something lands, don't go to why. Go to what. Where is it, one word for it, a few breaths right into that spot.</p>
<h3>The Loop, and Where It Opens</h3>
<p>Once you can slow the breath and get to the body, you can see something most people never see: the reaction isn't a choice. It's a track. Here's the track, and where it opens.</p>
<h4>Five steps in a second</h4>
<p>A client of mine, I'll call him Paul, got a meeting invite from his boss with no subject line. Before he'd even read it, his toes curled. That's the first two steps. The contact: something touches the system. The feeling tone: the body's first, wordless response, pleasant, unpleasant, or neutral. For Paul, unpleasant, in the toes and the stomach, before a single thought.</p>
<p>Then the story. An unexpected meeting means I'm being laid off. The story might be right. It might be wrong. The system doesn't care. It reacts to the story as if it were reality. Then the reaction. It happens so fast you don't notice it as a reaction at all. Paul's move was to stay away from the pain: go numb, hide, over-complicate a work project so there's somewhere to put the charge. Another client, I'll call him Raymond, went the other way. When the belly filled with what he called a steel ball, he jimmied up solutions, chased the next thing, worked harder to make the feeling stop. Two flavors of the same loop. One goes away from the feeling. One goes to get something that will make it stop. Neither one touches the thing in the belly. And then the spinning: the replay, the worst cases, the shame, the blame, at three in the morning.</p>
<p>The whole run, from the invite to the spinning, takes about a second.</p>
<p>In Buddhist psychology this loop has a name, a sankhara, a deeply etched pattern of reactivity. The image is a groove, like a line carved into wet concrete that hardened over time. Every time the same kind of trigger lands, you run the same groove, and the groove gets deeper. You don't need the word. What you need is to see that the loop runs through your body before it ever reaches your conscious mind. That's why you can't think your way out of it. By the time you're arguing with the story, the body has already locked in.</p>
<h4>Where the opening is</h4>
<p>By the time you notice the reaction, it's too late. By the time you're arguing with the story, it's too late. The opening is earlier. It's at the feeling tone, the curling toes, the knot, the tightness, which arrive before the story does and sit there for a beat before the reaction runs. That beat is the razor's edge we're learning to stay on. Not by arguing with the thought. By feeling the body before the mind gets there, and staying with it while it's there.</p>
<p>This is what the breath and the body are for. Slowing the breath widens the beat; a settled system gives you a longer moment between the tone and the reaction. Entering the body puts you in the beat instead of in the story. When you can find the tightness while it's still just tightness, before it has become I'm being laid off, you have a choice you didn't have a second ago. Not a big one. Just enough.</p>
<h4>The story is what the mind adds</h4>
<p>Everything you'll practice this week comes down to one instruction: trust the body more than the mind. The sensation is what's actually there. The story is what the mind adds on top. Believe the feelings, not the thoughts. When you feel the toes curl or the stomach knot, that's real. When the sentence arrives, I'm being laid off, I'm lesser than, I'll be forgotten, that's the mind's interpretation, a verdict that's usually older than the situation. It's usually wrong about the specifics and almost always wrong about the verdict it reaches about you.</p>
<p>So the practice this week is to map one loop, end to end, on the page, in your own life. Not to solve it. To see it. Once you can see where you are at each step, you start to notice where the opening was. It's almost always at the body's first response. You'll miss it most of the time at first. That's what the sit is training.</p>
<p>One more thing you'll meet when you start looking. The Buddha talked about being shot by two arrows. The first arrow is the thing itself: the feeling tone, the knot in the stomach when the invite lands. That one you don't get to choose. The second arrow is the one you put in yourself: I shouldn't feel this, what's wrong with me, here we go again. Most of the suffering is the second arrow, and the second arrow is optional. When you catch yourself judging yourself for the reaction, that's the second arrow. Come back to the first one. What's here to notice? And if the loop wakes you at three in the morning, the same instruction holds. Don't go to why. Find where it lives, put a word on it, breathe into it, and let the story wait until morning.</p>
<h4>What changes</h4>
<p>I don't want to overstate what happens. There isn't a moment where you catch the loop once and it's gone forever. That isn't how the body learns. What happens, over weeks, is that the beat gets a little longer and you get there a little sooner. That's the sign. Not that the loop stopped. That you saw it while it was running.</p>
<h4>Summary</h4>
<ul><li>The loop: contact, feeling tone, story, reaction, spinning. About a second.</li><li>Two flavors of reaction: away from the feeling, or after something that will make it stop. Neither touches the body.</li><li>The opening is at the feeling tone, before the story. That's the beat the breath widens and the body puts you in.</li><li>Trust the body more than the mind. Believe the feelings, not the thoughts.</li><li>The first practice is to see the loop, not to fix it.</li></ul>
<h4>Action</h4>
<p>Toward the end of the week, once you've caught a moment or two in real life, do the second journal, The Formation of a Reaction. Pick one moment and walk it through the five steps, then look for where the opening was. Bring it to the journal sitting.</p>`,
    meditation: meditationPlayer('/audio/onramp-breath-12min.mp3', 'The breathing practice, recorded by Chad. About twelve minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>Ten to fifteen minutes with the breathing recording above, eyes closed, in a posture that feels upright, feet on the floor. Sitting, not lying down. If you're just starting, five minutes today is fine. Build up over the week.</p>
<p>Before you start, check the state you're in and let the breath fit it. Jumpy and agitated: five in, seven out. Dull and heavy: follow the in breath all the way to the end, and let the exhale stay smooth. Even already: keep it even. At the end, compare the quality of mind to where you began.</p>
<h4>Through the day</h4>
<p>Three straw breaths before a meeting, a hard email, a conversation you've been putting off. Slow the inhale, lengthen the exhale. You don't need an app for this.</p>
<h4>When something lands</h4>
<p>When you feel the toes curl or the stomach knot: don't go to why. Go to what. Where is it? Throat, chest, belly. One word for it. Then a few breaths right into that spot, and see what it does. If the sentence in your head is "I'm anxious," make it "a part of me is anxious."</p>
<h4>A line a day, if you want one</h4>
<p>Did I sit, and did something land today? Where was it? That's the whole entry. The site already keeps track of the recordings you play and the journals you mark done, so this line is for you, not for me.</p>`,
    journal: `
<p>Two journals this week, each one a printable sheet. Do one or both. When you finish one, tap Mark done. That's how the weekly note knows. Take a few minutes of breath before either of them. Sit with your eyes closed, let the body settle, then open your eyes and write. A few paragraphs per prompt is plenty. Don't filter. Don't edit.</p>
<p>Then, once or twice in the week, bring what you've written to the journal sitting. Bring one journal or both. It reads everything, finds the place with the most charge, and checks with you before it starts there. Then it reads a few of your own lines back to you, and you notice what happens in the body as you hear them, with the breath. That's what I do with people's writing before a session, and this is the closest thing to it between now and ours.</p>
<label class="check"><input type="checkbox" id="journalConsent"> <span>Let Chad read what I write in the journal sittings before our Integration and Next-Step Session.</span></label>
<p class="small">Ticked: what you bring to the journal sittings is kept for Chad to read, and he gets a short brief before your session. Unticked: nothing is kept.</p>
<h4>1. What's Bringing You Here (first day or two)</h4>
<p>You read the book and something in it landed. This one brings that into focus: what's bringing you here, as concretely as you can; what's happening in your body right now as you sit with it; what that feeling would say if it could talk; and, if something older surfaces, the role you learned to play and the unspoken terms. It ends with the two yogis. If it's not a story about positive thinking, what's it about? And what's your Varanasi?</p>
<p><a class="button" href="/downloads/on-ramp/week-1/whats-bringing-you-here.pdf" data-journal="week-1/whats-bringing-you-here" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-1/whats-bringing-you-here">Mark done</button> <a class="button button-quiet" href="${JOURNAL[1].pagePath}?journal=week-1/whats-bringing-you-here">Bring it to the journal sitting</a></p>
<h4>2. The Formation of a Reaction (end of the week)</h4>
<p>Map one moment end to end, the way Paul's calendar invite was mapped above. The trigger. The body's first response, right now, as you hold the memory. The story, quoted as you hear it. The reaction then, and the pull now. The spinning. Then find where the opening was. It closes on the two questions I ask at the end of every session: what's one thing you're taking with you, and what's an open question you're left with?</p>
<p><a class="button" href="/downloads/on-ramp/week-1/the-formation-of-a-reaction.pdf" data-journal="week-1/the-formation-of-a-reaction" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-1/the-formation-of-a-reaction">Mark done</button> <a class="button button-quiet" href="${JOURNAL[1].pagePath}?journal=week-1/the-formation-of-a-reaction">Bring it to the journal sitting</a></p>
<p class="note">Keep what you write. You'll bring a piece of it to your Integration and Next-Step Session at the end of the four weeks.</p>`,
  },
  2: {
    title: 'Week 2: Staying With It',
    sub: 'Name, Stay, Equanimity. The second half of SENSE.',
    intro: `Last week you practiced coming back to the body. This week you practice staying there a little longer than is comfortable, without fixing what you find. Still in the straightaways. Still small.`,
    video: videoPlaceholder('Staying, instead of fixing'),
    teaching: `
<h3>Name, Stay, Equanimity</h3>
<h4>N. Name the Quality</h4>
<p>Once you've located a sensation, put a simple word to it. Tight. Hot. Heavy. Hollow. Buzzing. Name only sensations and qualities, never interpretations. Not "rejected," not "disrespected." Tight. You're training your nervous system with nervous system language. Naming isn't analysis, and it isn't asking the feeling to leave. It just creates a small step back. You go from being the feeling to noticing it. From <em>I am anxious</em> to <em>there's a tightness in my chest</em>. That small distance is where everything else becomes possible. And the word itself matters less than the contact it creates. If the first word isn't quite it, keep going until one lands with a yes: that's the whole of it. If a part is loud instead of a sensation, name that too: the inner critic, the fixer, the one who wants to check the phone.</p>
<h4>S. Stay</h4>
<p>Staying is turning toward the sensation and letting it be there. Not fixing, not explaining, not shoving it away. The way you do it is with a rhythm, and the rhythm matters more than the effort. The breath gives you the rhythm for free: touch the sensation with your attention on the exhale, and let it go on the inhale. Or hold contact for a few breaths, then come back to the breath, or your hands, or the sound of the room. Rest there a moment. Then return.</p>
<p>Touch, let go, return. Touch, let go, return. This has a name, titration. It means you're not flooding yourself with the discomfort. You're touching it in bits and pieces. Each pass, the part of you that's braced gets to notice that you aren't going to flood it, and that you aren't going to abandon it either. That's what lets it loosen. Not force. Safety.</p>
<p>You might drop a quiet question into the body: <em>what are you trying to prevent?</em> Then wait. Don't answer from your head. The body replies in its own time, sometimes with a memory, sometimes just by shifting.</p>
<h4>E. Equanimity</h4>
<p>If staying is making contact, equanimity is remaining with what you've touched. It isn't calm, and it isn't a state you achieve. It's an even-mindedness with whatever arises. You say yes to it rather than resist it. Think of a surfer on a long wave. Surfers don't judge the wave. You're practicing letting the wave be the wave, however it is, while you keep your feet. Your mind will want to jump in: how long will this last, what's the fix, what am I missing. Equanimity is not answering those. You come back to the body and let the sensation do what it does. Let it peak, let it settle, let it move, let it stay.</p>
<p>And you're not waiting for the sensation to vanish. You're watching for it to settle. Often that arrives as a deep sigh, or the shoulders dropping. When you feel that shift, the rep is done.</p>
<p>And here is the part almost everyone gets backwards at first. You are not building the ability to stay perfectly. You will drift, constantly, into your to-do list and this morning's conversation. That drift is not the failure. Noticing you've left and coming back, that is the practice. Not what happens before or after. The return itself.</p>
<p class="note">This week you have all of SENSE in your hands: Slow the breath, Enter the body, Name, Stay, Equanimity. Practiced on ordinary moments. That's enough.</p>`,
    meditation: meditationPlayer('https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/onramp-week2-keeping-it-company.mp3', 'Keeping It Company, recorded by Chad. About fifteen minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>Sit with this week's audio most days. If it feels like too much on a given day, sit with the Week 1 breathing recording instead. The point is to sit, not to do the hardest version. A missed day is fine. Begin again the next.</p>
<h4>The staying rhythm</h4>
<p>Touch the sensation on the exhale. Let it go on the inhale. Return. Small doses, not endurance; the name for this is titration. If it gets too big, touch only on the exhale, and if that's still too much, bring your attention into your hands. And you're done with a rep when something settles: a sigh, the shoulders dropping.</p>
<h4>Through the day, in thirty seconds</h4>
<p>When something fires, a meeting, a text, a pickup line at school: notice the sensation, stay with it for a moment, let attention rest on your breath or hands, come back once. You're telling the body you won't override it this time.</p>
<h4>The two-minute version</h4>
<ol>
<li><strong>Slow the Breath.</strong> Three straw breaths.</li>
<li><strong>Enter the Body.</strong> Where is it? Throat, chest, belly.</li>
<li><strong>Name it.</strong> One word.</li>
<li><strong>Stay.</strong> Keep it company a few breaths. Touch, let go, return.</li>
<li><strong>Equanimity.</strong> Stop bracing. Let it do what it does.</li>
</ol>
<h4>Your daily log</h4>
<p>One line a day: <em>What did I stay with today, even for a moment?</em> That's the whole entry. No streak, no shame. Skip a day and start again the next.</p>`,
    journal: `
<h4>The daily line (2 minutes a day)</h4>
<p>At the end of the day, one sentence: what did you stay with today, even briefly, instead of fixing or pushing away? If the honest answer some days is "nothing, I fixed and ran," write that. Noticing the reflex is itself the practice. A missed day isn't a failure. Begin again when you remember.</p>
<h4>End of week: one thing you stayed with (15 minutes)</h4>
<p>Pick one moment this week when you managed to stay with a feeling for a beat instead of bolting from it. Then walk it through on the page:</p>
<ol>
<li>What was the moment, in a few plain sentences.</li>
<li>Where did you feel it, and what was the quality? Name it the way you'd name it out loud.</li>
<li>What happened as you stayed? Did it shift, soften, get louder, stay the same? All of those are fine answers.</li>
<li>What was harder, the staying, or the letting go and coming back? What did you notice about the return?</li>
</ol>
<p class="note">A few paragraphs is plenty. This is practice, not excavation. If something deeper opens and wants more room than this practice can hold, that's exactly what your Integration and Next-Step Session is for.</p>`,
  },
  3: {
    title: 'Week 3: Turning Contact Into Choice',
    sub: 'Still, Tune in to the Trade, Expand Options, Practice. This is STEP.',
    intro: `The first two weeks were inner work: coming back to the body and staying there. This week it goes outward, into your actual conversations. This is the week you take it into real life.`,
    video: videoPlaceholder('The third option'),
    teaching: `
<h3>Still, Tune in to the Trade, Expand Options, Practice</h3>
<p>The order matters. You restore contact with yourself first, then you renegotiate the terms with the world. Otherwise you're just running the old performance with better language.</p>
<h4>S. Still</h4>
<p>Under pressure you either push harder or abandon yourself. Still is the pause before either one. It's a short version of everything from the first two weeks: a few breaths, a quick check of what's happening in your body, enough to stop the reflex from driving. You're not stepping away from the person in front of you. You're stepping out of the reflex. A quiet sentence that helps: <em>I don't have to decide this right now.</em></p>
<h4>T. Tune in to the Trade</h4>
<p>This is where the old bind shows up. Part of you wants to stay connected. Another part knows you're about to lose yourself to do it. This is an unspoken contract, and nobody else was in the room when you signed it. Name the trade. Ask: <em>what am I about to give up to stay safe or approved of right now? My honesty? My time? My need? My dignity? My rest?</em> And don't audit it from your head. Go back into the body and feel the cost: the sunken quality, the heaviness. You can even let yourself exaggerate it for a second, so you really feel what the trade takes. Just naming it, and feeling it, takes it out of the automatic.</p>
<p>The binds people actually bring, so you can recognize yours. The boss whose door is always open, and who doesn't want to be crossed: say what you see and become the problem, or say nothing and stop respecting yourself. The parent who needs you to be the adult: say no and risk the connection, or keep parenting your parent and disappear. The team that's drowning: say you can't keep carrying it and someone already burnt out picks it up, or keep carrying it and burn out yourself. The job that's grinding you down: leave and lose the money and the security, or stay and keep being ground down. The kids, the work, and the sleep: rest and feel you're letting everyone down, or push and get sick. The partner who wants more closeness when you need room: take the room and feel like you're failing them, or give it up and lose yourself. The parents who can't meet you: keep hoping and get hurt again, or stop hoping and feel like a bad son or daughter. The hard truth with someone you love: say it and risk the peace, or hold it and resent them. Needing help: ask and feel weak, or don't ask and drown alone. And under all of them, the one they share: say what a part of you wants and lose them, or hide it and lose that part.</p>
<h4>E. Expand Options</h4>
<p>Stress tells you it's attack or cave. When you've made contact, the view widens and you find it was never only those two. Look for the move that doesn't attack and doesn't abandon you. You can pause. You can ask a question. You can name what's true without escalating. That's the third option: staying connected without selling yourself out.</p>
<h4>P. Practice</h4>
<p>The old contract taught you to keep the signal silent to keep the bond. Practice reverses it. You put into words what your body has been telling you all along. One honest sentence. One boundary. One request. "I'm not ready to agree yet, I need a minute." "I'd rather name this than dance around it." One action that is true rather than strategic.</p>
<p>And the measure of the step is not how the other person responds. Saying the true thing, even when they can't meet you there, shows your nervous system that it's possible to stand up for what you value and still hold your ground, no matter what comes back. That's what rewrites the contract. Their response is theirs.</p>
<p>And you will miss it. Often you'll notice only after you've already reacted. That still counts. These aren't rules to get right. They're a rough map you get better at reading with reps.</p>
<p class="note">You now have both halves: SENSE to come home to yourself, STEP to bring that home into the room. Practiced on ordinary moments. That's the whole toolkit.</p>`,
    meditation: meditationPlayer('https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/onramp-week3-finding-the-third-option.mp3', 'Finding the Third Option, recorded by Chad. About twelve minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>A short sit, then carry it into the day. If a day gets away from you, no problem. Begin again the next.</p>
<h4>The daily rep</h4>
<p>Once a day, run STEP on one real interaction. It can be tiny, a reply you paused on, a small ask you'd normally swallow. The rep is the point, not the size.</p>
<h4>STEP, in the moment</h4>
<ol>
<li><strong>Still.</strong> A few breaths. Don't ride the wave into the old move. <em>I don't have to decide right now.</em></li>
<li><strong>Tune in to the Trade.</strong> What am I about to give up to stay safe or approved of?</li>
<li><strong>Expand Options.</strong> What move isn't attack and isn't collapse?</li>
<li><strong>Practice.</strong> One honest sentence. One boundary. One question.</li>
</ol>
<h4>When you miss it</h4>
<p>You'll often catch it only afterward. Good. Replay it: what was the trade, what was the third option? That replay is how you catch the next one sooner. Missing is part of the practice, not a failure of it.</p>
<h4>Your daily log</h4>
<p>One line a day: <em>the trade I noticed, and the small step I took (or wish I had).</em> No streak, no shame. Skip a day and start again the next.</p>`,
    journal: `
<h4>The daily line (2 minutes a day)</h4>
<p>At the end of the day, one sentence: what trade did you notice today, and what small step did you take, or wish you had? Catching it after the fact counts fully. A missed day isn't a failure. Begin again when you remember.</p>
<h4>End of week: one interaction, walked through (15 minutes)</h4>
<p>Pick one real interaction from this week, one where the old pull was there. Walk it through:</p>
<ol>
<li>The moment, in a few plain sentences. Who, and what got triggered.</li>
<li>The two options the trap offered you. Attack or cave, in your own words.</li>
<li>The trade. What would the easy door have cost you?</li>
<li>The third option, even if you only see it now, in hindsight. What could staying-with-yourself-and-them have looked like?</li>
<li>The one small honest thing you did, or could still do. Write the actual sentence.</li>
</ol>
<p class="note">A few paragraphs is plenty. You're getting reps, not writing an essay. If a situation feels too loaded to work alone, that's a good thing to bring to your Integration and Next-Step Session.</p>`,
  },
  4: {
    title: 'Week 4: Integration and the Doorway',
    sub: 'The whole arc, and what comes next.',
    intro: `This week you run the whole thing, SENSE into STEP, on your real life. And you get honest about the deeper layer you've been brushing up against, and what it would mean to go there.`,
    video: videoPlaceholder('The last week'),
    teaching: `
<h3>The Whole Arc, and What's Underneath</h3>
<p>Here's the shape of everything you've practiced, in one line: come back from the old panic, restore contact with yourself, then take one small step that doesn't require you to abandon yourself to stay connected.</p>
<p>SENSE is the inner half. Slow the breath so the system settles. Enter the body so you're dealing with what's real and not the story. Name it so there's a little distance. Stay with it in small doses. Let it move without bracing. That's how you come home.</p>
<p>STEP is the outer half. Still, so the reflex doesn't drive. Tune in to the trade, so you see what you were about to give away. Expand the options, so it's not just attack or cave. Practice, one honest step. That's how you bring the home you found into your relationships.</p>
<h4>What you've been brushing against</h4>
<p>When you stay with a sensation and it softens into something more tender, you're meeting the edge of what the book calls the sacred wound. It's the imprint of all the times you contorted yourself to belong. The reflex to perform, the tightness, the inner critic, those are protectors. They formed around that tender place to keep it safe, and they are good at their job: they run about five or ten steps ahead of you, always scanning, because nothing in the system has ever been prepared to let you feel that wound directly. They are not your defects. They were your survival, and often they became your gifts. Even the aliveness in you got co-opted into keeping you safe.</p>
<p>The deeper work is turning toward that wound with the kindness it never got, so the protectors don't have to work so hard. That's not a straightaway. It goes better with company, and this course didn't ask you to do it alone. But it's the real doorway, and you've been standing near it all month. As the book puts it: the ache you've been running from isn't the problem. It's the signal, and it's the way back.</p>
<p class="note">This week, just live the arc. Notice the protectors with a little more kindness. That's the whole assignment.</p>`,
    meditation: meditationPlayer('https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/onramp-week4-the-sacred-wound.mp3', 'The Sacred Wound, recorded by Chad. About fourteen minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>Sit with whichever practice from the month served you most. Choosing the one you need is itself part of the practice now. Miss a day, begin again the next.</p>
<h4>The whole arc, in two minutes</h4>
<p><strong>SENSE:</strong> slow the breath, enter the body, name it, stay with it, stop bracing.<br>
<strong>STEP:</strong> still, tune in to the trade, expand the options, one honest step.</p>
<h4>After the four weeks</h4>
<p>You don't need an app or a course to keep this. Three straw breaths and one honest sentence is the whole practice, portable, any time. Come back to the audios whenever you want. They're yours.</p>
<h4>How you'll know it's time for the deeper work</h4>
<p>When the same tender thing keeps showing up under the protector and staying with it alone starts to feel like more than the daily rep can hold. When you want company for it. That's not a setback. That's the doorway, and it's what your Integration and Next-Step Session is for.</p>
<h4>Your daily log</h4>
<p>One line a day: <em>where did I meet a protector today, and could I be a little kinder to it?</em> No streak, no shame.</p>`,
    journal: `
<h4>The daily line (2 minutes a day)</h4>
<p>One sentence: where did you meet a protector today, and could you meet it with a little less argument? A missed day isn't a failure. Begin again when you remember.</p>
<h4>Looking back over the month (20 minutes)</h4>
<p>Take a little more time with this one. It's also what you'll bring to your session.</p>
<ol>
<li>What's different, if anything, after four weeks? In your body, in a conversation, in how fast you catch yourself. Small is fine.</li>
<li>Which move became most available to you? Which one still feels far away?</li>
<li>When you stayed with something this month, did you ever feel the edge of something more tender underneath? You don't have to describe it. Just note that it's there.</li>
<li>What do you most want from a conversation with me? What would make it worth the time?</li>
</ol>
<p class="note">Bring this to your Integration and Next-Step Session. You don't have to write it up neatly. A few honest notes are exactly right.</p>`,
    closing: `
<h3>Your Integration and Next-Step Session</h3>
<p>You made it through. However much of it you did, whatever stuck and whatever didn't, you spent four weeks turning toward yourself instead of away.</p>
<p>The course ends with one private conversation with me. That session is where the month gets named: the contract you keep signing, where it shows up in your body first, the trade you keep making, and one small next step. It's yours whether or not we ever work together again.</p>
<p>I'll also tell you whether deeper one-on-one work fits where you are, and what it looks like if it does. If it's not the right time, I'll say that too. And if you do continue within 30 days, what you paid for this course is credited toward the coaching.</p>
<p><a class="button" href="https://chadherst.as.me/integration-and-next-step-session">Book your Integration and Next-Step Session</a></p>
<p class="small">Bring your notes from the reflection above.</p>`,
  },
};

// The course look, shared with the yay/nay answer pages in onramp-yaynay.js.
const COURSE_CSS = `:root{--cream:#F4EDE4;--paper:#FBF7F0;--ink:#352515;--gold:#8B6B1E;--line:#D7C7B3;--soft:#EFE6D8;--danger:#8E2F27}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;line-height:1.6}
.shell{width:min(760px,calc(100% - 28px));margin:0 auto;padding:34px 0 70px}
.eyebrow{text-transform:uppercase;letter-spacing:.18em;color:var(--gold);font:600 12px/1.4 Arial,sans-serif;text-align:center}
h1{font-family:'Playfair Display',Georgia,serif;font-size:clamp(28px,5vw,40px);text-align:center;margin:8px 0 4px}
.sub{text-align:center;font-style:italic;color:#6F5438;margin:0 0 26px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:24px 26px;margin:0 0 22px}
.card h2{font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 10px}
h3{font-family:'Playfair Display',Georgia,serif;font-size:21px;margin:4px 0 8px}
h4{font:600 15px/1.4 Arial,sans-serif;color:var(--gold);margin:20px 0 6px}
.small{font:14px/1.5 Arial,sans-serif;color:#715D49}
.note{font-style:italic;color:#6F5438}
.placeholder{padding:16px 18px;background:var(--soft);border-left:3px solid var(--gold);font:14px/1.55 Arial,sans-serif;margin:12px 0}
.button{display:inline-block;border:1px solid var(--gold);background:var(--gold);color:#fff;border-radius:999px;padding:12px 22px;font:600 14px/1 Arial,sans-serif;cursor:pointer;text-decoration:none}
.button-quiet{background:transparent;color:var(--gold)}
.button-quiet.is-done{background:#EFE6D8;border-color:#EFE6D8;color:#5C4A2A;cursor:default}
.check{display:flex;gap:10px;align-items:flex-start;font:15px/1.45 Arial,sans-serif;margin:14px 0 6px;cursor:pointer}.check input{margin-top:4px;flex:none}
.field input{width:100%;border:1px solid #BCA88E;border-radius:10px;background:#FFFDF9;color:var(--ink);padding:13px 14px;font:16px/1.4 Arial,sans-serif}
.error{color:var(--danger);font:600 14px/1.4 Arial,sans-serif;margin-top:10px}
.hidden{display:none!important}
.nav{display:flex;justify-content:space-between;font:14px/1.4 Arial,sans-serif;margin:18px 0}
.nav a{color:var(--gold)}
.crumbs{font:13px/1.4 Arial,sans-serif;color:#78644F;margin:0 0 16px}
.crumbs a{color:var(--gold);text-decoration:none}
.footer{text-align:center;margin:26px auto 0;color:#78644F;font:13px/1.5 Arial,sans-serif}
ol li{margin-bottom:8px}`;

function lessonPageShell(weekNum) {
  const c = COURSE_WEEKS[weekNum];
  const prev = weekNum > 1 ? `<a href="${COURSE_PATH}/week-${weekNum - 1}">&larr; Week ${weekNum - 1}</a>` : `<a href="${COURSE_PATH}">&larr; Overview</a>`;
  const next = weekNum < 4 ? `<a href="${COURSE_PATH}/week-${weekNum + 1}">Week ${weekNum + 1} &rarr;</a>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${c.title} | The Performance Trap Practice</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
${COURSE_CSS}
</style>
</head>
<body>
<main class="shell">
  <nav class="crumbs"><a href="${COURSE_PATH}">The Practice</a> &rsaquo; <span>Week ${weekNum}</span></nav>
  <div class="eyebrow">The Performance Trap Practice</div>
  <h1>${c.title}</h1>
  <p class="sub">${c.sub}</p>

  <section id="unlockCard" class="card">
    <h2>Enrolled?</h2>
    <p>Enter the access code from your enrollment note. It unlocks all four weeks and the practice companion.</p>
    <div class="field"><input id="accessCode" type="password" autocomplete="off" spellcheck="false" aria-label="Access code"></div>
    <p style="margin-top:14px"><button id="unlockButton" class="button">Open the week</button></p>
    <div id="accessError" class="error hidden"></div>
  </section>

  <div id="lessonContent" class="hidden"></div>

  <div class="nav">${prev}<span></span>${next}</div>
  <div class="footer">Herst Wellness</div>
</main>
<script>
(function(){
  var el = function(id){ return document.getElementById(id); };
  var stored = '';
  try { stored = window.sessionStorage.getItem('onrampCode') || ''; } catch (e) {}
  function showError(msg){ var n = el('accessError'); n.textContent = msg; n.classList.toggle('hidden', !msg); }
  // Listen tracking: each sit posts a play event once per page load and a
  // complete event once when playback passes 80 percent. The server keeps
  // it only for enrolled codes; it never blocks playback or the unlock.
  function attachListenTracking(code){
    var players = el('lessonContent').querySelectorAll('audio[data-sit]');
    Array.prototype.forEach.call(players, function(audio){
      var sit = audio.getAttribute('data-sit');
      var played = false, completed = false;
      function post(event){
        try {
          fetch('${COURSE_PATH}/api/listen', {
            method: 'POST', keepalive: true,
            headers: { 'Content-Type': 'application/json', 'X-Companion-Access': code },
            body: JSON.stringify({ sit: sit, event: event })
          }).catch(function(){});
        } catch (e) {}
      }
      audio.addEventListener('play', function(){ if (!played) { played = true; post('play'); } });
      audio.addEventListener('timeupdate', function(){
        if (!completed && audio.duration && audio.currentTime / audio.duration >= 0.8) { completed = true; post('complete'); }
      });
      audio.addEventListener('ended', function(){ if (!completed) { completed = true; post('complete'); } });
    });
    // Journal tracking: opening the PDF and tapping Mark done are recorded
    // the same way, so the weekly note can say which journals got done.
    function postJournal(journal, event, done){
      try {
        return fetch('${COURSE_PATH}/api/journal', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'X-Companion-Access': code },
          body: JSON.stringify({ journal: journal, event: event })
        }).then(function(){ if (done) done(); }).catch(function(){ if (done) done(); });
      } catch (e) { if (done) done(); }
    }
    var links = el('lessonContent').querySelectorAll('a[data-journal]');
    Array.prototype.forEach.call(links, function(a){
      a.addEventListener('click', function(){ postJournal(a.getAttribute('data-journal'), 'opened'); });
    });
    var doneButtons = el('lessonContent').querySelectorAll('button[data-journal-done]');
    Array.prototype.forEach.call(doneButtons, function(b){
      var key = 'onrampJournalDone:' + b.getAttribute('data-journal-done');
      try { if (window.localStorage.getItem(key)) { b.textContent = 'Done'; b.classList.add('is-done'); b.disabled = true; } } catch (e) {}
      b.addEventListener('click', function(){
        b.disabled = true; b.textContent = 'Done'; b.classList.add('is-done');
        try { window.localStorage.setItem(key, '1'); } catch (e) {}
        postJournal(b.getAttribute('data-journal-done'), 'done');
      });
    });
    // Consent for the journal sittings (Week 1 only): shown from the
    // record on load, saved the moment the box changes.
    var consentBox = el('lessonContent').querySelector('#journalConsent');
    if (consentBox) {
      consentBox.disabled = true;
      fetch('${COURSE_PATH}/api/consent', { headers: { 'X-Companion-Access': code }, cache: 'no-store' })
        .then(function(r){ return r.json(); })
        .then(function(d){ consentBox.checked = d.consent === true; })
        .catch(function(){})
        .then(function(){ consentBox.disabled = false; });
      consentBox.addEventListener('change', function(){
        try {
          fetch('${COURSE_PATH}/api/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Companion-Access': code },
            body: JSON.stringify({ consent: consentBox.checked })
          }).catch(function(){});
        } catch (e) {}
      });
    }
  }
  async function unlock(code){
    if (!code) { showError('Enter the access code.'); return; }
    showError('');
    try {
      var response = await fetch('${COURSE_PATH}/api/week-${weekNum}', { headers: { 'X-Companion-Access': code }, cache: 'no-store' });
      if (!response.ok) {
        var data = await response.json().catch(function(){ return {}; });
        throw new Error(data.error || 'Access denied');
      }
      var payload = await response.json();
      el('lessonContent').innerHTML = payload.contentHtml;
      el('lessonContent').classList.remove('hidden');
      el('unlockCard').classList.add('hidden');
      try { window.sessionStorage.setItem('onrampCode', code); } catch (e) {}
      try { attachListenTracking(code); } catch (e) {}
    } catch (error) {
      try { window.sessionStorage.removeItem('onrampCode'); } catch (e) {}
      showError(error.message || 'Access denied');
    }
  }
  el('unlockButton').addEventListener('click', function(){ unlock(el('accessCode').value); });
  el('accessCode').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); unlock(el('accessCode').value); } });
  if (stored) { el('accessCode').value = stored; unlock(stored); }
})();
</script>
</body>
</html>`;
}

function lessonContentHtml(weekNum) {
  const c = COURSE_WEEKS[weekNum];
  const companion = WEEKS[weekNum];
  const closing = c.closing ? `<section class="card">${c.closing}</section>` : '';
  return `
  <section class="card"><p>${c.intro}</p>${c.video}</section>
  <section class="card"><div class="eyebrow" style="text-align:left">This week's lesson</div>${c.teaching}</section>
  <section class="card"><div class="eyebrow" style="text-align:left">The guided sit</div><h3>Most days, about ten minutes</h3>${c.meditation}</section>
  <section class="card"><div class="eyebrow" style="text-align:left">The daily rep</div>
    <h3>Practice with the companion</h3>
    <p>Once a day, bring one real moment to the practice companion. It writes back and walks the week's moves with you, responding to what you write during the sitting. It keeps nothing after you end: no transcript is saved anywhere, and your notes are yours alone to download. Your access code works there too.</p>
    <p><a class="button" href="${companion.pagePath}">Open this week's companion</a></p>
  </section>
  <section class="card"><div class="eyebrow" style="text-align:left">Practice card</div>${c.practiceCard}</section>
  <section class="card"><div class="eyebrow" style="text-align:left">Journal</div>${c.journal}</section>
  ${closing}`;
}

function enrollSection() {
  const p = paypalConfig();
  const priceLine = p.regularPriceUsd
    ? 'founding price $' + p.priceUsd + ' (the regular price will be $' + p.regularPriceUsd + '), for the first small group while the recordings are being finished, in exchange for honest feedback'
    : '$' + p.priceUsd;
  return `<div id="enroll">
<p><strong>Enroll yourself:</strong> ${priceLine}, once, via PayPal or card. Your personal access code, made from your name, appears the moment payment completes and is emailed to you. It is your key to all four weeks and the practice companion.</p>
<p class="small">And if you go on to coaching with me within 30 days of your Integration and Next-Step Session, the full amount you paid here is credited toward it.</p>
<div id="enrollFields" style="margin:14px 0 10px">
<p style="margin:0 0 10px"><label for="enrollFirstName" class="small">First name</label><br><input id="enrollFirstName" type="text" autocomplete="given-name" maxlength="80" required style="width:100%;border:1px solid #BCA88E;border-radius:10px;background:#FFFDF9;color:#352515;padding:12px 14px;font:16px/1.4 Arial,sans-serif"></p>
<p style="margin:0 0 10px"><label for="enrollLastName" class="small">Last name</label><br><input id="enrollLastName" type="text" autocomplete="family-name" maxlength="80" required style="width:100%;border:1px solid #BCA88E;border-radius:10px;background:#FFFDF9;color:#352515;padding:12px 14px;font:16px/1.4 Arial,sans-serif"></p>
<p style="margin:0 0 10px"><label for="enrollEmail" class="small">Email (your access code and the weekly notes go here)</label><br><input id="enrollEmail" type="email" autocomplete="email" maxlength="200" required style="width:100%;border:1px solid #BCA88E;border-radius:10px;background:#FFFDF9;color:#352515;padding:12px 14px;font:16px/1.4 Arial,sans-serif"></p>
</div>
<div id="paypalButtons"></div>
<div id="enrollDone" style="display:none;background:#EFE6D8;border-left:3px solid #8B6B1E;padding:16px 18px;margin-top:14px">
<p style="margin:0 0 8px"><strong>You're in.</strong> Your access code:</p>
<p id="issuedCode" style="font-size:24px;font-family:monospace;margin:0 0 8px"></p>
<p style="margin:0" class="small">Write it down or screenshot it now; it is shown only once here. It is also in the email on its way to you. Then open <a href="${COURSE_PATH}/week-1">Week 1</a>.</p>
</div>
<div id="enrollError" class="small" style="display:none;color:#8E2F27"></div>
<script src="${p.sdkBase}?client-id=${encodeURIComponent(p.clientId)}&currency=USD"></script>
<script>
function enrollDetails(){
  var v = function(id){ return (document.getElementById(id).value || '').trim(); };
  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  return { firstName: v('enrollFirstName'), lastName: v('enrollLastName'), email: v('enrollEmail'), timeZone: tz };
}
function enrollProblem(d){
  if (!d.firstName) return 'Add your first name first.';
  if (!d.lastName) return 'Add your last name too. Your access code is made from your name.';
  if (!d.email || d.email.indexOf('@') < 1 || d.email.indexOf('.', d.email.indexOf('@')) < 0) return 'Add the email address your access code should go to.';
  return '';
}
function showEnrollError(msg){
  var n = document.getElementById('enrollError');
  n.textContent = msg; n.style.display = msg ? 'block' : 'none';
}
paypal.Buttons({
  onClick: function(data, actions){
    var problem = enrollProblem(enrollDetails());
    showEnrollError(problem);
    if (problem) return actions.reject();
    return actions.resolve();
  },
  createOrder: function(){
    var d = enrollDetails();
    return fetch('${COURSE_PATH}/api/paypal/create-order', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d)
    }).then(function(r){
      if (!r.ok) throw new Error('Could not start checkout');
      return r.json();
    }).then(function(d){ return d.orderId; });
  },
  onApprove: function(data){
    var d = enrollDetails();
    d.orderId = data.orderID;
    return fetch('${COURSE_PATH}/api/paypal/capture', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(d)
    }).then(function(r){ return r.json().then(function(d){ return {ok: r.ok, d: d}; }); })
    .then(function(res){
      if (!res.ok || !res.d.accessCode) throw new Error(res.d.error || 'Payment could not be confirmed');
      document.getElementById('issuedCode').textContent = res.d.accessCode;
      document.getElementById('enrollDone').style.display = 'block';
      document.getElementById('paypalButtons').style.display = 'none';
      document.getElementById('enrollFields').style.display = 'none';
      try { window.sessionStorage.setItem('onrampCode', res.d.accessCode); } catch (e) {}
    });
  },
  onError: function(){
    var n = document.getElementById('enrollError');
    n.textContent = 'Something went wrong with checkout. You were not charged unless PayPal shows a completed payment. Try again, or reach out through herstwellness.com.';
    n.style.display = 'block';
  }
}).render('#paypalButtons');
</script>
</div>`;
}

function overviewPage() {
  const rows = [1, 2, 3, 4]
    .map((n) => `<li><a href="${COURSE_PATH}/week-${n}">${COURSE_WEEKS[n].title}</a><br><span class="small">${COURSE_WEEKS[n].sub}</span></li>`)
    .join('\n      ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>The Performance Trap Practice | Herst Wellness</title>
<style>body{margin:0 auto;max-width:700px;padding:44px 24px 80px;background:#F4EDE4;color:#352515;font-family:Georgia,serif;font-size:19px;line-height:1.6}h1{font-size:32px;margin-bottom:4px}.sub{font-style:italic;color:#6F5438}a{color:#8B6B1E}li{margin-bottom:16px}.small{font-size:14px;color:#715D49;font-family:Arial,sans-serif}.card{background:#FBF7F0;border:1px solid #D7C7B3;border-radius:14px;padding:22px 24px;margin:20px 0}</style>
</head>
<body>
<h1>The Performance Trap Practice</h1>
<p class="sub">The four-week practice that goes with the book.</p>
<div class="card">
<p><strong>You already know the pattern. The text you fired back, the yes you didn't mean, the meeting where you went quiet. This is four weeks of practice, about ten minutes a day, so you can catch it in your body a little earlier each time and have a different response available when the pressure is real.</strong></p>
<p>The book ends with the ache as a doorway. This is the walking through: SENSE for coming back to yourself when the pressure hits, STEP for bringing that back into the room with other people. One real moment a day, four weeks, and a private Integration and Next-Step Session with me at the end. That session is where the month gets named: the contract you keep signing, where it shows up in your body first, the trade you keep making, and what you might try next. It's yours whether or not we ever work together again.</p>
${selfServeEnabled() ? enrollSection() : '<p>Enrollment is personal: Chad sets you up directly and sends your access code. If you don\'t have one yet, reach out through <a href="https://herstwellness.com">herstwellness.com</a>.</p>'}
<h2 style="font-size:19px;margin-top:26px">If it turns out not to be for you</h2>
<p>Within the first 14 days, <a href="https://herstwellness.com/contact">write to me</a>, and I'll refund the whole thing. You don't need a reason, and there's no form to fill out. All I ask is that you stop using the course and the companion once the refund goes through.</p>
<p>After two weeks, I cannot provide a refund.</p>
</div>
<h2 style="font-size:20px">The four weeks</h2>
<ul>
      ${rows}
</ul>
<p class="small">Herst Wellness. This is a guided practice for adults, not therapy, medical care, diagnosis, or crisis support.</p>
</body>
</html>`;
}

// ── Enrollment details ──────────────────────────────────────────
// Phone numbers become E.164 (+14155551234) or are dropped: ten digits
// are taken as US, eleven starting with 1 likewise, a leading + with 8 to
// 15 digits is kept as given.
function normalisePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (s.startsWith('+') && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function validateEnrollment(body) {
  const firstName = String(body.firstName || '').trim().slice(0, 80);
  const lastName = String(body.lastName || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 200);
  if (!firstName) return { ok: false, error: 'Missing first name.' };
  if (!lastName) return { ok: false, error: 'Missing last name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Missing or invalid email.' };
  return {
    ok: true,
    firstName,
    lastName,
    email,
    phone: normalisePhone(body.phone),
    timeZone: normaliseTimeZone(body.timeZone),
  };
}

// Creates the record, sends the enrollment email, adds the person to
// Mailchimp with the course tag, and returns the code. Nothing after the
// code is issued may lose the buyer: a failed store write or email is
// logged loudly and the code is still returned.
async function enrollPerson(details, source, helpers, store) {
  // The code is the person's name (chad-herst), made unique against the
  // store inside the same write that saves the record. If the store is
  // down the buyer still gets a code: a signed one, which needs no store.
  let record = null;
  let stored = false;
  try {
    await store.update((doc) => {
      const code = nameCode(doc, details.firstName, details.lastName);
      record = newRecord({ code, email: details.email, firstName: details.firstName, lastName: details.lastName, phone: details.phone, timeZone: details.timeZone, source });
      doc.enrollments.push(record);
    });
    stored = true;
  } catch (error) {
    record = newRecord({ code: issueSignedCode(), email: details.email, firstName: details.firstName, lastName: details.lastName, phone: details.phone, timeZone: details.timeZone, source });
    console.error('ON-RAMP ENROLLMENT NOT STORED for ' + record.email + ' (' + source + '); signed code ' + record.code + ' was issued instead:', error.message);
  }
  if (helpers.sendEmail) {
    try {
      const mail = emails.enroll(record);
      const result = await helpers.sendEmail(record.email, mail.subject, mail.html);
      if (result && result.ok) {
        const at = new Date().toISOString();
        record.sent.enroll = at;
        if (stored) await store.update((doc) => { const r = findByCode(doc, record.code); if (r) r.sent.enroll = at; });
      } else {
        console.error('ON-RAMP ENROLLMENT EMAIL NOT SENT for ' + record.id + ' (' + source + '); code issued, spine will retry');
      }
    } catch (error) {
      console.error('ON-RAMP ENROLLMENT EMAIL FAILED for ' + record.id + ' (' + source + '):', error.message);
    }
  }
  if (process.env.MAILCHIMP_API_KEY && helpers.addToMailchimp) {
    try {
      await helpers.addToMailchimp(record.email, (record.firstName + ' ' + record.lastName).trim());
      if (helpers.tagSubscriber) helpers.tagSubscriber(record.email, emails.MAILCHIMP_TAG);
    } catch (error) {
      console.error('On-Ramp enrollment: Mailchimp failed:', error.message);
    }
  }
  return { accessCode: record.code, id: record.id };
}

function adminCodeMatches(req) {
  const expected = String(process.env.COMPANION_ADMIN_CODE || '');
  const supplied = String(req.headers['x-admin-code'] || '');
  if (!expected) return { ok: false, status: 503 };
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return { ok: a.length === b.length && crypto.timingSafeEqual(a, b), status: 401 };
}

async function handleCourseRoute(req, res, helpers = {}) {
  const store = helpers.store || defaultStore();
  // hasAccess() in onramp.js checks name codes through the store's
  // registry; awaiting the warm-up means a name code works on the first
  // request after a restart.
  await ensureCodeRegistry(store);

  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/paypal/create-order') {
    if (!selfServeEnabled()) { sendJson(res, 503, { error: 'Self-serve enrollment is not enabled.' }); return true; }
    try {
      const details = validateEnrollment(await readJsonBody(req));
      if (!details.ok) { sendJson(res, 400, { error: details.error }); return true; }
      sendJson(res, 200, { orderId: await paypalCreateOrder() });
    } catch (error) {
      console.error('On-Ramp checkout create-order:', error.message);
      sendJson(res, 502, { error: 'Could not start checkout.' });
    }
    return true;
  }
  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/paypal/capture') {
    if (!selfServeEnabled()) { sendJson(res, 503, { error: 'Self-serve enrollment is not enabled.' }); return true; }
    try {
      const body = await readJsonBody(req);
      if (!body.orderId || typeof body.orderId !== 'string') { sendJson(res, 400, { error: 'Missing order.' }); return true; }
      const details = validateEnrollment(body);
      if (!details.ok) { sendJson(res, 400, { error: details.error }); return true; }
      const result = await paypalCaptureOrder(body.orderId);
      if (!result.completed) {
        console.error('On-Ramp checkout capture: order not completed (status/amount mismatch)');
        sendJson(res, 402, { error: 'Payment was not completed.' });
        return true;
      }
      const enrolled = await enrollPerson(details, 'paypal', helpers, store);
      sendJson(res, 200, { accessCode: enrolled.accessCode });
    } catch (error) {
      console.error('On-Ramp checkout capture:', error.message);
      sendJson(res, 502, { error: 'Payment could not be confirmed.' });
    }
    return true;
  }
  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/admin/enroll') {
    const admin = adminCodeMatches(req);
    if (!admin.ok) { sendJson(res, admin.status, { error: admin.status === 503 ? 'Admin enrollment is not enabled.' : 'Not authorised.' }); return true; }
    if (!process.env.ONRAMP_CODE_SECRET) { sendJson(res, 503, { error: 'ONRAMP_CODE_SECRET is not set.' }); return true; }
    try {
      const details = validateEnrollment(await readJsonBody(req));
      if (!details.ok) { sendJson(res, 400, { error: details.error }); return true; }
      sendJson(res, 200, await enrollPerson(details, 'admin', helpers, store));
    } catch (error) {
      console.error('On-Ramp admin enroll:', error.message);
      sendJson(res, 500, { error: 'Enrollment failed.' });
    }
    return true;
  }
  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/listen') {
    const access = hasAccess(req);
    if (!access.ok) { sendJson(res, access.status, { error: 'That code was not recognized.' }); return true; }
    try {
      const body = await readJsonBody(req);
      const sit = String(body.sit || '').trim().slice(0, 60);
      const event = body.event === 'complete' ? 'complete' : body.event === 'play' ? 'play' : '';
      if (!sit || !event) { sendJson(res, 400, { error: 'Missing sit or event.' }); return true; }
      const code = String(req.headers['x-companion-access'] || '');
      const now = new Date();
      let found = false;
      await store.update((doc) => {
        const record = findByCode(doc, code);
        if (!record) return;
        found = true;
        const today = localDateString(now, normaliseTimeZone(record.timeZone));
        dayEntry(record, today).listens.push({ sit, at: now.toISOString(), complete: event === 'complete' });
      });
      // A manual ONRAMP_ACCESS_CODES entry has no record: nothing stored,
      // same 204 either way so the page never learns which kind it holds.
      if (!found && process.env.ONRAMP_LISTEN_DEBUG) console.log('On-Ramp listen: no record for this code');
      res.writeHead(204, noStoreHeaders('application/json; charset=utf-8'));
      res.end();
    } catch (error) {
      console.error('On-Ramp listen:', error.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'Could not record that.' });
    }
    return true;
  }
  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/journal') {
    const access = hasAccess(req);
    if (!access.ok) { sendJson(res, access.status, { error: 'That code was not recognized.' }); return true; }
    try {
      const body = await readJsonBody(req);
      const journal = String(body.journal || '').trim();
      const event = body.event === 'done' ? 'done' : body.event === 'opened' ? 'opened' : '';
      if (!/^week-[1-4]\/[a-z0-9-]{1,60}$/.test(journal) || !event) { sendJson(res, 400, { error: 'Missing journal or event.' }); return true; }
      const code = String(req.headers['x-companion-access'] || '');
      const now = new Date().toISOString();
      await store.update((doc) => {
        const record = findByCode(doc, code);
        if (!record) return;
        if (!record.journals) record.journals = {};
        if (!record.journals[journal]) record.journals[journal] = {};
        if (!record.journals[journal][event]) record.journals[journal][event] = now;
      });
      res.writeHead(204, noStoreHeaders('application/json; charset=utf-8'));
      res.end();
    } catch (error) {
      console.error('On-Ramp journal:', error.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'Could not record that.' });
    }
    return true;
  }
  // Consent (docs/65): whether the journal sittings are kept for Chad to
  // read before the Integration and Next-Step Session. Set from the Week 1
  // lesson page; read back on every load so the box shows the truth.
  if (req.url === COURSE_PATH + '/api/consent' && (req.method === 'GET' || req.method === 'POST')) {
    const access = hasAccess(req);
    if (!access.ok) { sendJson(res, access.status, { error: 'That code was not recognized.' }); return true; }
    const code = String(req.headers['x-companion-access'] || '');
    try {
      if (req.method === 'GET') {
        const record = findByCode(await store.load(), code);
        sendJson(res, 200, { consent: Boolean(record && record.consent === true) });
        return true;
      }
      const body = await readJsonBody(req);
      if (typeof body.consent !== 'boolean') { sendJson(res, 400, { error: 'consent must be true or false.' }); return true; }
      let found = false;
      await store.update((doc) => {
        const record = findByCode(doc, code);
        if (!record) return;
        found = true;
        record.consent = body.consent;
        record.consentAt = new Date().toISOString();
      });
      // A manual ONRAMP_ACCESS_CODES entry has no record: nothing is kept
      // for it either way, so the answer is always "not kept".
      sendJson(res, 200, { consent: found && body.consent });
    } catch (error) {
      console.error('On-Ramp consent:', error.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'Could not record that.' });
    }
    return true;
  }
  // The brief, on demand: for testing, and for people who book the session
  // before day 28. Generates it now, emails Chad, and marks it sent so the
  // ticker does not send a second one.
  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/admin/brief') {
    const admin = adminCodeMatches(req);
    if (!admin.ok) { sendJson(res, admin.status, { error: admin.status === 503 ? 'Admin routes are not enabled.' : 'Not authorised.' }); return true; }
    try {
      const body = await readJsonBody(req);
      const code = String(body.code || '').trim();
      if (!code) { sendJson(res, 400, { error: 'Missing code.' }); return true; }
      const record = findByCode(await store.load(), code);
      if (!record) { sendJson(res, 404, { error: 'No enrollment with that code.' }); return true; }
      const text = await brief.generateBrief(record);
      const sent = await brief.sendBrief(record, text, helpers);
      if (!sent.ok) { sendJson(res, 502, { error: 'The brief was written but the email did not send.' }); return true; }
      const at = new Date().toISOString();
      await store.update((doc) => { const r = findByCode(doc, code); if (r) { if (!r.sent) r.sent = {}; r.sent.brief = at; } });
      sendJson(res, 200, { ok: true, chars: text.length });
    } catch (error) {
      console.error('On-Ramp admin brief:', error.message);
      if (!res.headersSent) sendJson(res, 502, { error: 'Could not write the brief.' });
    }
    return true;
  }
  if (await handleSmsInbound(req, res, { store })) return true;

  if (req.method !== 'GET') return false;

  if (await handleYayRoute(req, res, { store, css: COURSE_CSS })) return true;

  if (req.url === COURSE_PATH) {
    res.writeHead(200, noStoreHeaders('text/html; charset=utf-8'));
    res.end(overviewPage());
    return true;
  }

  const pageMatch = req.url.match(/^\/course\/on-ramp\/week-([1-4])$/);
  if (pageMatch) {
    res.writeHead(200, {
      ...noStoreHeaders('text/html; charset=utf-8'),
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(lessonPageShell(Number(pageMatch[1])));
    return true;
  }

  const apiMatch = req.url.match(/^\/course\/on-ramp\/api\/week-([1-4])$/);
  if (apiMatch) {
    const access = hasAccess(req);
    if (!access.ok) {
      sendJson(
        res,
        access.status,
        access.status === 503
          ? { error: 'This training is not enabled yet.' }
          : { error: 'That code was not recognized.' }
      );
      return true;
    }
    sendJson(res, 200, { contentHtml: lessonContentHtml(Number(apiMatch[1])) });
    return true;
  }

  return false;
}

module.exports = { COURSE_CSS, COURSE_PATH, COURSE_WEEKS, handleCourseRoute, lessonContentHtml, normalisePhone, validateEnrollment };
