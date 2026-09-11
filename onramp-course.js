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
    intro: `Hi, friend. Glad we're doing this. You've read the book, so you know the trap and you know the map, and I'm really glad you didn't stop there. This is the part I love. This week we start putting it in the body, because that's where the trap lives. Slow the breath, and enter the body. That's the whole week, and it's plenty.`,
    video: videoPlaceholder('Welcome. You already have the map.'),
    teaching: `
<h3>Introduction</h3>
<p>I want to tell you why, before the how, because it matters to me that you know what we're going for. At the core of the things you're bumping up against, the work, the relationships, the health, there's a kind of core tenderness, a core anxiety or grief, that we spend a lifetime trying to fix, ignore, or outrun. That's the ache the book is about. Me too, by the way. It stays hidden from us because we can't access it in the head. We have to learn to access it in the body. And the point isn't fixing. If you haven't fixed yourself by now, fixing just becomes one more reason to shame yourself, and we don't do shame here. The point is coming back home to yourself, to what's actually here, because it's trying to show you a new way forward. It's not an error. Over these four weeks, what I'm hoping for you is enough clarity around what's stuck in there that you start to have some freedom to make new choices. Not a total overhaul. Ten percent better. Ten percent better has a lot in it.</p>
<p>Here's how I teach, and how our month will go. When you go to university and prepare for a lecture, you do the reading and the writing first, so you come into the room ready for the real conversation. That's the shape of each week here. Three short pieces to read, on slowing the breath, on entering the body, and on why they matter. Two journals, and you can do one or both. Then you bring what you wrote to the journal sitting, where it gets read back to you and the body gets to answer. The reading prepares the writing, the writing prepares the conversation, and all of it prepares the hour you and I get to spend together at the end. I'm looking forward to that hour already.</p>
<p>Your daily commitment is the sit. Ten to fifteen minutes with this week's breathing recording, most days. If you're just starting, five minutes today is fine. The site keeps track of when you play the recordings and when you mark a journal done, and at the end of the week I'll send you what the week looked like. Just data, and it's yours. Plan on the three pieces early in the week, a piece a day. Do What's Bringing You Here in the first day or two. Do The Formation of a Reaction toward the end of the week, once you've caught a moment or two in real life. If you can only do a few things: sit, read The Breath, and do one journal. That's enough. You're doing great already.</p>
<p>One story before you start, a story I tell almost everyone the first time we sit down together. Start with this: it is not a story about positive thinking.</p>
<p>Two yogis are walking from Varanasi to Rishikesh, a day apart. Varanasi is the ancient city on the Ganges where people go to die. Rishikesh is where you go to find a teacher and study. The first yogi comes upon a farmer at the side of the road and asks him, sir, can you tell me, what are the people like in Rishikesh, where I'm going? And the farmer gets a little reflective and asks him, well, what were the people like in Varanasi, where you've come from? The yogi says, terrible. Liars and cheats. I got pickpocketed. I'm glad to be leaving. And the farmer says, I'm sorry, sir, but I'm afraid the people in Rishikesh are very much the way you found the people in Varanasi. And with a heavy head, the first yogi goes on his way.</p>
<p>The next day the second yogi comes along and asks the farmer the same question. The farmer asks him the same thing back. And this one says, oh, an amazing group of people. The kindest, most thoughtful people I've met. I'm sad to be leaving. And the farmer says, well, fear not, sir. The people in Rishikesh are very much the way you found the people in Varanasi.</p>
<p>So if it's not about positive thinking, what's it about? I'll leave that with you for the week. Here's the part I'll give you. We bring a quality of mind to whatever it is we do. A set of beliefs, some conscious and some not, that inform all of our experience. Those beliefs come from our past. They're your Varanasi. The next meeting, the next conversation, the next time you walk in the door at home, that's your Rishikesh. You know your future is predicated on your past. What you're unaware of is how predicated it is. This week, when something starts to fire, the question is: what am I carrying in right now? Then come back to the body and find out what's actually here. Go sit. I'm right here with you.</p>
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
    sub: "Name what's there. Stay. Equanimity. The second half of SENSE.",
    intro: `Hi, friend. You made it through the first week, and I want you to take that in for a second. Whatever you got to and whatever you didn't, you spent a week turning toward yourself instead of away, and that's not nothing. Last week you practiced getting to the body. Slow the breath, enter, find the sensation, put a word on it. This week you practice staying there, longer than is comfortable, without fixing what you find. Name what's there. Stay. Equanimity. That's the second half of the method, and honestly it's the half that changes things.`,
    video: videoPlaceholder('Staying, instead of fixing'),
    teaching: `
<h3>Introduction</h3>
<p>Here's why this week matters to me. There's some part of you that's wanting to feel like you're enough, and that's the part we have to develop a relationship with, in an embodied way, not a cerebral one. It's wounded, yes. But hidden inside the wounding are your values, your sense of purpose, what's most important to you. So what we're doing this week is sidling up to the part of you that got abandoned, so that it can come online and be an ally instead of running you from the back of the bus. That's what naming, staying, and equanimity are for. I love this part of the work, because it's where people start to feel like they're on their own side.</p>
<p>And a warning, said with care. There will be moments this week when the work gets hard. It'll bring things to the surface. You might feel tired, foggy, or irritable. You might skip the journal or pull away from anything that asks you to slow down and feel. That doesn't mean you're failing or that the work isn't working. In fact, it means something is indeed working. Something is opening, and the parts of you that protect you don't yet know how to let that happen without trying to shut you down. No shame. We don't do shame here.</p>
<p>Same shape as last week. Three pieces to read, one on each move, a piece a day early in the week. Two journals, and you can do one or both. The Protector in the first day or two, after a sit. The Return near the end of the week. Bring what you write to the journal sitting once or twice, whenever there's writing to bring. The sit this week is called Keeping It Company, about fifteen minutes. Sit with it most days. On the days you're jumpy and need to settle first, use the Week 1 breathing recording instead. The point is to sit, not to do the hardest version. A missed day is fine. Begin again the next. If you can only do a few things: sit, read Stay, and do one journal.</p>
<p>One moment before you start, from my own life, because the move this week is one I'm still learning, and I'd rather you know that. A few months ago I was being interviewed for a podcast, late in the conversation, with the book about to come out and more eyes on me than I've had before. Coming into that conversation I was feeling really anxious. And what I said, into the microphone, was this. I still feel anxious, but I'm in relationship to the anxiety here. I'm not overriding it. I feel something in my chest. And then I kept talking.</p>
<p>That's the shift. It's no longer this thing of, when I can once and for all not feel this anymore, when I can finally cut this off. It's, how do I move from this place? How do I breathe from this place? How do I relate from this place? Because the anxiety isn't an error. It's part of what lets us be human with each other. This week is about learning to have it here while you keep going. You've got this, and I've got you.</p>
<h3>Name What's There</h3>
<p>Last week you found where it lives and put a word on it. This week naming goes one step further, in two directions. Toward the one who's noticing, and toward the part that's talking.</p>
<h4>Why name it</h4>
<p>Here's what naming is for. When something painful is running and you don't name it, you become lodged in it. I am this pain. This is all of me. Then you can't distinguish yourself from it. It becomes you, and you keep making choices that undermine what's actually most important to you, because the fear is deciding. Or it runs in the background, unnamed, and it runs you off the road. You do something stupid because you didn't listen to it and at least give it a name. Naming interrupts that. When we can label what's occurring, we're less identified with it. We can stand back from it. A little space opens between you and the heaviness, and that space is where a choice lives.</p>
<p>And there's something else. One of my clients, asked what it was like to name all these parts, said it was like getting to know himself in a more intimate way. That's exactly it. The point of the distinction isn't just to separate. The distinction creates intimacy, the ability to be with, to be related to. When you can appreciate a part's deep concern, how it got formed, what it believes about you, that's how you find your way back into being able to drive the bus. You have to develop an appreciation for this part of yourself. It's counterintuitive, and it's the whole move.</p>
<h4>The one who's noticing</h4>
<p>Being with has two qualities to it. This is Buddhist psychology 101. One quality is that there's awareness, that ability to notice that I'm noticing. If worry arises in the system, that's the beginning. I noticed that I'm getting worried. There's the noticer. That's awareness. The second part is taking that awareness and directing it into the body, noticing where the worry is arising. Is it in the throat? Is it in the chest, or is it in the belly?</p>
<p>Here's why the first part matters. There's one part of you, the strongest part right now, feeling the tension inside. And there's another part, in the background, that is experiencing that, witnessing that. So there's the experience itself, and then there's the one that is experiencing it. Every once in a while, remember that you're the one who is experiencing it rather than just being the experience. You're not totally merged with it. There's a little space between you and it. That's called the space of awareness, and you can toggle back and forth between awareness and the feeling.</p>
<p>The old image for this is the sky. Each thought is like a cloud passing through the sky of awareness. You notice the thought, but you don't identify with it. You're the sky, not the clouds.</p>
<h4>The word, and the check</h4>
<p>Once you're in the body, find a word that captures the essence of what you're touching there. It could be a phrase, an image, even a metaphor. Once you land on it, check it out. See if that word actually captures the whole of the experience. If it doesn't, add another word, or change it altogether, until you land on: yeah, that's it. Then you'll feel an internal yes, or an internal no.</p>
<p>Here's what it sounds like with a client. Tightness in the chest. Give it a quality. Short. Does that capture the whole of it? Probably tight. See if that's actually the word. Check back in with the body. Maybe more heavy. Maybe labored. There we go. Now we're getting closer. Then the word becomes the anchor.</p>
<h4>Sensation, not story</h4>
<p>Pleasant, unpleasant, or neutral? Start there. Then the quality. Heavy, jumpy, tight, hot, buzzy, numb, blank. That's the body's language. What comes next, every time, is the story. I'll have someone start with unpleasant, and then they'll say, and I'm still like, what a jackass. That's the story. The first part is the unpleasant quality. The second part is what a jackass. We're not going to deny the stories. They're real and they need to be unpacked. But we recognize them as stories, not the truth.</p>
<p>So when the story arrives, come back. Just sensation, not content. Follow the sensation. If we stay with the sensation and not with the thought, keep coming back over and over to the sensation, we will often meet, underneath it, the ache. Then our job is to meet the ache. Easy to say. That's the hardest part.</p>
<p>Two questions I ask a lot. What makes it unpleasant? And, where is this feeling familiar? What makes those stories so convincing is that they're familiar. You don't have to dig for that this week. Just notice what it's like to name that it's familiar.</p>
<h4>A part of me</h4>
<p>Sometimes what's loud isn't a sensation. It's a voice. I'm a failure. I have to handle this. Here's the thing about that voice. When it shows up, it doesn't show up with a name tag saying, hi, I'm the inner critic. It just feels like the truth. This is me, this is what I do.</p>
<p>My first therapist gave me an image for this that I still use. Your mind is like a bus full of kids, and each one is a part of you that formed over time to keep you safe and accepted. The perfectionist. The pleaser. The one who gets angry fast. The one who shuts down. The one who feels like a scared six-year-old. When you get triggered, one of those kids runs up to the front of the bus and grabs the wheel. Suddenly you're not responding from your grounded adult self. You're reacting from a younger protective strategy.</p>
<p>So the second kind of naming is this. Notice how the body is responding, and which kid just took the steering wheel of the bus. You don't have to do anything with the answer yet. It gets to be heard and understood. It doesn't get to drive the bus.</p>
<p>And say it the way it's true. When the sentence is, why am I even doing that, reframe it: why does that part of me want to do that? Notice how that's slightly different. A part of me is anxious. A part of me is afraid of what? Part of you, not all of you. This is a big distinction, and it's the one I'll keep making all week. When you're fused with the part, this is who I am. When you can say this is a part of me, not all of me, it doesn't deserve rejection. Not from you.</p>
<p>There's an old line in psychology: name it to tame it. Not that it goes away, or that it's totally tamed. But now you can see the pattern at play. And I'll tell you now, it's not easy to find language for your experience. The more you do it, the more skilled you get.</p>
<h4>Summary</h4>
<ul><li>There's the experience, and there's the one experiencing it. A little space between you and it is the space of awareness. You're the sky, not the clouds.</li><li>Find the word, then check it on the inside. Does it capture the whole of it? An internal yes or no.</li><li>Pleasant, unpleasant, neutral, then the quality. When the story arrives, come back to the sensation.</li><li>When a voice is loud, which kid just took the wheel? A part of me, not all of me.</li><li>Naming doesn't tame it. It gives you space, and the space is where the choice is. Get to know the part and you get the wheel back.</li></ul>
<h4>Action</h4>
<p>Sit with Keeping It Company today. Through the day, when a voice is loud, say it the true way: a part of me is anxious. A part of me has to handle this. Then one word for what's in the body, and the check. That's the rep.</p>
<h3>Stay</h3>
<p>Now the hard one. Last week you found the sensation and put a word on it. This week you keep it company for longer than we normally do.</p>
<h4>Why stay</h4>
<p>I'm teaching you how to stay with whatever is being held in the body for longer durations than we usually manage, because that staying is where, if it's an ache or an anxiety or some part of you that's taken over, it's trying to show you something. It has a concern for you. It's not an error that it's there, and it's not to be fixed. It's aching in there because it's calling you toward something else. If the waves are coming and you're squishing the waves, you cannot hear what the waves are trying to express. Stay, and it reveals a lot more. The old version of you that seemed true was to pick up and go somewhere else. If I stay, I'm going to find out something else about myself.</p>
<p>Here's what happens when you do. If you can stay with the feeling tone in the body for a sustained period, the strong unpleasant feelings eventually settle down, to one degree or another. When they calm down, you feel less need to react to them. And when you're less reactive, your judgments start to change. The mental models you use to predict and stay safe get a little more flimsy, and you start to see the thing that triggered you with a lot more clarity, rather than reacting to what you think you see. And you're building a capacity. Every time you stay, you're showing your system that you won't leave yourself, even when it's unpleasant, particularly when it's unpleasant. Over time that capacity grows, and you can be with more. It doesn't have to be an overhaul of your life. It can be as small as, I'm going to stay with myself for another minute. When you have enough of those little minutes, they add up to a lot of change.</p>
<h4>Why we don't stay</h4>
<p>We don't usually let ourselves stay with these kinds of feelings. We distract ourselves. We go to our heads. Here's where that comes from. When we're kids, when we can't fight back, we can't run, and we can't ask for help, the only thing available to us is to dissociate. It's to leave our bodies. So we learn to go to our heads, to find strategies to win at the game. All of that takes us away from home.</p>
<p>So now, as adults, we get close to something tender, that ache in the heart, and we can stay with it for a second, and the next thing we know, poof, it's gone. Not because we chose to leave. Because leaving is what we learned. And in the story, what actually happens is it proliferates. If you give something your attention, it changes. If you keep distracting yourself, it keeps persisting.</p>
<h4>Keep it company</h4>
<p>The instruction is simple to say. Stay with that. Keep it company with attention, soft, gentle, caring attention. Not to get it to go away, but just to explore it. Then see how it responds to your attention.</p>
<p>Breathe with it. Not to make it go away, but to breathe with it so you can keep it company. Every once in a while chime in: oh, now it's like this. Now it's like this. Like a sponge receiving water. You aren't doing anything to it. You're receiving it.</p>
<p>Try not to go to your head. Go to the feeling. Thoughts will come. Notice the thoughts and come back to the tightness. This is the hard part, and it's unpleasant, and this is how it works. Some part of you will want to go to sleep to it, or shake it off, or fix it. You're not. You're receiving it. It may or may not reveal something in this moment. It is the teaching either way.</p>
<h4>Not gritting your teeth</h4>
<p>I want to make a subtle distinction between waiting it out, which is a passive gritting your teeth while you bear it, and staying at the razor's edge of the sensations to explore them. Waiting it out is enduring. Exploring is different. You really touch it. You feel all the little micro movements in there. Does it have nooks and crannies? Does it move around? Does it have a temperature? You're exploring it like a scientist, and that turns on a different part of the brain. It's boring in rather than gritting your teeth and burying it.</p>
<h4>The dose</h4>
<p>The way you stay safely is in small doses. If it ever gets to be too much, you can always bring your attention into your hands or your feet. And then, when you're ready, you come back to that tender spot. We don't want to overwhelm the system. It's already overwhelmed as it is. So maybe ten seconds touching it, ten seconds letting go. You're giving it enough room to be felt, but not overwhelm the system, and at the same time a little space so you're not completely identified with it. You're watching it change from breath to breath. Not go away. Change.</p>
<p>The hands are the anchor. Feel the warmth, the moisture, the weight, the tingling. You have one place that's safe, and the breath is always there.</p>
<h4>What it's protecting</h4>
<p>When you first turn toward what's been firing, the first thing you meet usually isn't the tender thing. It's a protector. Something hard, something holding on tight. You can think of it as a part of you, and it's protecting something. What's it protecting? What is it afraid might happen if it didn't do this inside of you, if it didn't tighten like this? It needs you to know.</p>
<p>This is the part I want you to hear. It isn't error. It's serving something. Maybe it's not effective. Maybe it sends you into a deeper depression, and we can agree on that. But it's trying something for you, and it's been doing it for probably your whole life. So the move is not to bust through it. We're not going to say it's wrong. When it gets the attention it actually longs for, it settles. It's like a part of you that never got the attention it needed, and this is what it learned in order to survive.</p>
<p>So you offer it a little warmth. I see you. I'm not trying to get rid of you. I promise I will not get rid of you. See how it responds to that. And when you catch yourself hating on it, or hating on yourself for having it, that's fine too. No shame. We don't do shame here.</p>
<h4>What happens</h4>
<p>When we come back to these places, there are first layers of anxiety and overwhelm. I can't touch this, this is too much. But as you stay with it, it starts to settle, and it starts to reveal. It becomes like a flower that starts to open, and there's a tender spot right in the center. Sometimes you'll feel a sigh, or the shoulders drop a little. It's not gone. It's settling for now. Just keeping it company. This is how you build equanimity. Not by conquering it. By staying.</p>
<h4>Summary</h4>
<ul><li>Stay because the feeling has a concern for you and is calling you toward something. When it settles, you react less and see the situation more clearly, and every stay shows your system you won't leave yourself.</li><li>Keep it company: warm attention and a little breath, not to get it to go away, but to explore it and see how it responds.</li><li>Explore, don't endure. The razor's edge, not gritting your teeth.</li><li>Small doses. Touch it, go to the hands or the breath, come back. Don't overwhelm the system.</li><li>The first thing you meet is usually a protector. It's serving something. Ask what it's protecting, offer it warmth, and don't shame it.</li></ul>
<h4>Action</h4>
<p>Do the first journal, The Protector, in the first day or two, after a sit. Through the day, once, when you'd normally reach for the phone, the drink, the spreadsheet, the defensive sentence, stay with whatever you were about to get away from for thirty seconds longer. Then reach if you need to. That thirty seconds is the practice.</p>
<h3>Equanimity</h3>
<p>If staying is making contact, equanimity is how you remain with what you've touched. Equanimity is a funny term. It usually gets translated as non-attachment, which implies no feeling tone, I don't let my feelings get the better of me. But no feeling tone means I'm cut off from what I'm feeling. I'm dissociated. When we're doing embodied work, we are in our feelings. And yet we have this ability, simultaneously, to step back and see that whatever it is has a temporary nature to it. That's the whole of it. Sensitive on one level, composed on another. Present with what's occurring without reacting to it or judging it.</p>
<h4>Why it matters</h4>
<p>Here's what you get for it. When you're in fight or flight, or freeze, or in some form of reactivity, your only options are to run away, to fight, to play dead, or to appease. Those keep you locked in the same patterns over and over again. We're not trying to get the fight or flight to go away. What we're trying to do is see reality on its terms, and then respond to that reality in a nuanced way, to get what you actually want. If you hold that space long enough, the intensity of the feeling tone abates, and when it does, you see things with a lot more clarity and you're less reactive. And on the other side of that, you sense the gap, the space between the stimulus and the response. A little space of choice, to make a new choice. When you're being run by these parts, there is no gap. That gap is what the whole month is for.</p>
<h4>Arises, stays, passes away</h4>
<p>Here's the principle everything this week rests on. Anything in nature arises, stays for a while, and passes away. All life arises, is born, lives for a while, and then dies. Animals, plants, and thoughts and feelings as well. Thoughts arise, they stay for a moment, often a split second, and they pass. Feelings arise, they stay a little longer than thoughts, and eventually they pass away. And yet there's some part of you that has the ability to witness the arising and the passing.</p>
<p>Learning to sit in that witnessing place doesn't erase the sadness, the rage, the bitterness. It's not that they don't matter. But it lets you step back and watch. When I am angry, I am anxious, I am scared, then I and the anxiety are one and the same, and we have no power. When I can say something in me is anxious, there's more fluidity. It can arise, stay, and pass away, and I can be witness to it.</p>
<p>And here's the catch. When we cling or we push away, they stay longer. That's most of our suffering.</p>
<h4>Riding the wave</h4>
<p>The image I've used for this for years is a wave. If you were a surfer, you wouldn't say, oh, this is a bad wave, I don't want this wave. You accept whatever wave comes your way and you ride it all the way to the shore. The feeling is the wave. Your attention is the surfboard. All those tiny sensations, those micro movements in the chest or the belly, that's the wave. Your job is to stay on the board as it crests and falls. Nothing to fix or change.</p>
<p>All sensations, by their nature, don't stay the same. Sometimes they grow more intense, sometimes they ebb, sometimes they go away altogether, and then there are moments of stillness where nothing's happening. Wherever the feeling goes, so does your awareness.</p>
<p>Here's where people mistake the work for done. When you allow what's there to be there, the initial tension softens, and a lot of people stop there. In truth it's only begun. Once that first layer releases, you're in touch with what's underneath, and once you get to the shore there's a different view of the experience. You don't get to that until you do the work, and doing the work is being present with what's there.</p>
<h4>Where the pattern breaks</h4>
<p>Remember the loop from last week: a stimulus, a feeling tone, a story, a reaction, and then the proliferation, the guilt and the replay that make everything bigger. Here's what happens if you follow the feeling tone all the way to the end instead. It quiets down. And when it quiets down, so does the story about what it means. And when there's no story and no feeling tone that goes with it, there's no clinging or aversion, and there's no proliferation, and all that's left is just data. Work to be done. Now, how do I want to handle the work?</p>
<p>If you stop reacting to it, the storyline ends, and you can see the circumstances for what they are. You've created a new pattern, a new sankhara, just by observing, so that you can respond, not from a place of anxiety, but from a place of clarity. Feeling tone is a great place to hang out. It's unpleasant, and it's difficult work, but it's the way.</p>
<h4>Two arrows</h4>
<p>Somewhere this week you'll skip a day, or bail off the wave, or fix and run, and then you'll want to add a second layer, the judgment about having done it. The Buddha talked about two arrows. There's the first arrow you get shot with, and it hurts. And there's the second arrow, the one you put in yourself, and that's what makes you suffer. The first arrow is the disagreement that shuts you down. The second is that I feel guilty and ashamed of myself that it takes me so long to thaw. The second was on me, and it makes it doubly hard to thaw.</p>
<p>So when you catch the second arrow, put it down. Instead: oh, sweetie, I'm so sorry. I know you're suffering. Or, I got you. Or, it looks like you're really upset. What do you need? No shame. We don't do shame here.</p>
<h4>What to expect</h4>
<p>I'll tell you what this looked like for me, so you don't expect fireworks. A few years ago I was waking up one or two nights a week in the middle of the night, one or two in the morning, with a lot of anxiety in the body. Rather than turning away from it, I'd sit up, cross my legs in my bed, and watch it. Sometimes it lasted twenty minutes and I went back to sleep. Sometimes an hour and a half. All the while I was feeling all of it, and at the same time recognizing, okay, this is going to pass, and while it's here, I'm going to learn from it. The good news is that when it comes to visit again, I'm not so freaked out by it.</p>
<p>I'll add the harder version, because it's the truest one. I've had about two years of a bad flare-up of my gut, and it's been two years of staying in and with the pain, and thinking at moments, I don't know if there's any value in this. This feels like a colossal waste of my life force. In the last few months it's started to let up. Not gone, but let up. And with that is coming a clarity: there were hidden gifts in it. A sensitivity. A way of tuning in that I didn't have before. That's what riding the wave to the shore means. On the other side are the gifts, and you don't get them until you do the work.</p>
<p>This process is a lot like picking weeds in a garden. Some weeds are newly grown and you pluck them out easily. Some have been in our lives our whole lives, and those take perhaps a lifetime. When you start, things get better really quickly. And then, over years, you get comfortable with the fact that some things keep coming up, and you develop patience and persistence toward feeling them. It comes back every now and then, but it doesn't last as long, and it has less of the intensity.</p>
<h4>Summary</h4>
<ul><li>Equanimity is not non-attachment. You're in the feeling and, at the same time, you can see that it's temporary.</li><li>Everything arises, stays, and passes away. Clinging and pushing away make it stay longer.</li><li>In reactivity your only options are fight, run, play dead, or appease. Equanimity is how you get the gap between what happens and what you do, and the gap is where the new choice is.</li><li>Follow the feeling tone to the end and the story ends with it. What's left is data. That's a new pattern.</li><li>The second arrow is optional. No shame.</li></ul>
<h4>Action</h4>
<p>Near the end of the week, do the second journal, The Return. Ride one wave on the page with a timer, write what surfaced, and then turn toward whatever is there and say what you'd say to it. Bring it to the journal sitting.</p>`,
    meditation: meditationPlayer('https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/onramp-week2-keeping-it-company.mp3', 'Keeping It Company, recorded by Chad. About fifteen minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>About fifteen minutes with Keeping It Company, eyes closed. On a jumpy day, the Week 1 breathing recording first, or instead. The point is to sit, not to do the hardest version. A missed day is fine. Begin again the next. Check the state before, compare after.</p>
<h4>The staying rhythm</h4>
<p>Touch the sensation for a few breaths. Rest your attention in the hands or the breath. Come back. Ten seconds touching it, ten seconds letting go. You're done with a rep when something settles: a sigh, the shoulders dropping, the breath going deeper on its own.</p>
<h4>Through the day, thirty seconds</h4>
<p>Once a day, when you'd normally reach for the phone, the drink, the spreadsheet, the defensive sentence, stay with whatever you were about to get away from for thirty seconds longer. Then reach if you need to. That thirty seconds is the practice.</p>
<h4>When a voice is loud</h4>
<p>Which kid just took the wheel? Say it the true way: a part of me is anxious. A part of me has to handle it. Then one word for what's in the body, and the check.</p>
<h4>A line a day, if you want one</h4>
<p>What did I stay with today, even for a moment? That's the whole entry. The site already keeps track of the recordings you play and the journals you mark done.</p>`,
    journal: `
<p>Two journals this week, each one a printable sheet. Do one or both. When you finish one, tap Mark done. That's how the weekly note knows. Take a few minutes of breath before either of them, then open your eyes and write. A few paragraphs per prompt is plenty. Don't filter. Don't edit.</p>
<p>Then, once or twice in the week, bring what you've written to the journal sitting. Bring one journal or both. It reads everything, finds the place with the most charge, and checks with you before it starts there. Then it reads a few of your own lines back to you, and you notice what happens in the body as you hear them. If you ticked the box on Week 1, what you bring here is kept for me as well.</p>
<h4>1. The Protector (first day or two, after a sit)</h4>
<p>One moment from the last week or two that still has charge. The body now, as you hold the memory. Then the first thing you meet, which is usually the protection: its shape, its place, its texture, what it would say if it could talk, and which kid it is. Three passes of staying, thirty seconds each, with a line after each. Then what softened, or what's still holding, and one line to carry into the week.</p>
<p><a class="button" href="/downloads/on-ramp/week-2/the-protector.pdf" data-journal="week-2/the-protector" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-2/the-protector">Mark done</button> <a class="button button-quiet" href="${JOURNAL[2].pagePath}?journal=week-2/the-protector">Bring it to the journal sitting</a></p>
<h4>2. The Return (end of the week)</h4>
<p>The same moment, or a fresh one. The body now. Three minutes on the wave with a timer, then what happened: did it move, soften, get sharper before it eased. What surfaced on the other side, if anything. Then the return: write directly to whatever is there, the way you'd speak to a scared kid. What shifted over the week, one move for next week, and my two questions: what's one thing you're taking with you, and what's an open question you're left with?</p>
<p><a class="button" href="/downloads/on-ramp/week-2/the-return.pdf" data-journal="week-2/the-return" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-2/the-return">Mark done</button> <a class="button button-quiet" href="${JOURNAL[2].pagePath}?journal=week-2/the-return">Bring it to the journal sitting</a></p>
<p class="note">Keep what you write. You'll bring a piece of it to your Integration and Next-Step Session at the end of the four weeks.</p>`,
  },
  3: {
    title: 'Week 3: Turning Contact Into Choice',
    sub: 'Still. Tune in to the trade. The third option. This is STEP.',
    intro: `Hi, friend. Two weeks in. The first two were inner work, getting to the body and staying there, and I'm guessing by now you've had at least one moment where you caught something in your body before the story got to it. Hold on to that. This week it goes outward, into your actual conversations. Still. Tune in to the trade. Expand options. Practice. The order matters. You restore contact with yourself first, then you renegotiate the terms with the world. This is the week I get most excited about, because it's where the practice starts to change something in your real life.`,
    video: videoPlaceholder('The third option'),
    teaching: `
<h3>Introduction</h3>
<p>Here's why it can't be skipped. Therapy and spiritual practice are usually only about the inner journey. I'm making the argument that it's not only about the inner journey. It's also about a renegotiation with the world around us, so that our world becomes a reflection of our inner insight. Human beings are in contract with one another, spoken and unspoken, and belonging is itself contractual. The first two weeks were about renegotiating the contract with yourself. This week is the contract with others. If you don't tune in to the trade you keep making, you'll keep going back to do the same inner work over and over, because you're re-traumatizing yourself. At some point you have to say, okay, I'm trading something now. I have to make a choice. I have to see what my options are. And then I actually have to say what's so for me. I know how hard that last part is. It's the part I still practice.</p>
<p>Same shape as before. Three pieces, one on each part of the move, early in the week. Two journals, and you can do one or both. The Trade, once you've caught one moment where the old pull was there. The Third Option, near the end of the week. Bring what you write to the journal sitting once or twice. And the sit this week is Finding the Third Option, about twelve minutes, most days. If you can only do a few things: sit, read The Trade, and do one journal.</p>
<p>One thing to expect, and please hear this kindly. Most days you'll catch the moment only afterward. That counts fully. Nobody gets this in one clean shot. Oh wait, that was a moment I could have turned toward. That noticing is how you start catching it sooner, and I'll be glad to hear about it either way. Go find one moment this week. Be gentle with yourself while you look.</p>
<h3>Still</h3>
<p>The first two weeks were about getting to the body and staying there. This week it goes outward, into your actual conversations. The first move is the pause. Still is pause, not freeze, not avoidance. Just don't answer yet. Notice that you're activated. Come back to the breath, then back to the body. Let the wave of intensity pass. You don't have to wait for it to disappear. You're just not riding it straight into action.</p>
<h4>Why the pause</h4>
<p>Here's the distinction the whole week rests on, the distinction between a reaction and a response. When you're reacting, you have three options available to you. Hit it. Run. Play dead. Fight back, avoid, or shut down and go to sleep. Some of us have a fourth, appease, which is staying safe by being nice, tending to everyone else's needs, forfeiting our own. Those are your only options when you're triggered, and they keep you locked in the same patterns over and over again. When you're responsive, another part of the brain comes online, and you can enact something nuanced, based on what you actually want. You can make jokes, you can play, you can convince, you can maybe listen. You have all sorts of options available to you. It's about enabling your optionality, but you first have to work with your reactivity.</p>
<p>That's what the pause buys you: the space between stimulus and response. Everything you did in the first two weeks sets you up for it. The label model sets you up for the space model. We've been creating a gap, a space of choice, so that we don't have to keep operating out of the conditioning we were given. And then there's the question this week is really about. Now that I have the space, where I'm not reacting anymore, where I can stand back and watch what's happening, what do I do with it? How do I make choices that align with what's most important to me, with what I value and the kind of person I want to be in the world? Responses are where you actually consider the outcome you'd like in a given interaction. Reactions never get there.</p>
<h4>What it costs not to pause</h4>
<p>Here's the chain you already know. A stimulus: you get a message, or you remember you have to do something. A feeling tone: ooh, this is unpleasant. A story: if I don't get this thing done right now, I'm going to screw it up. And the action: I have to put out the fire. Here's the interesting thing. You think that once you put out the fire, then you can be present again. But your presence is only this thin, because the next thing that comes up is the next fire. If you put out that fire, you're going to be looking for the next fire and the next fire and the next fire, and you will exhaust yourself.</p>
<p>The conditioning underneath it usually says: if I don't respond right away, they will lose confidence in me, and if they lose confidence in me, then I'm out of a job, I'm abandoned, I'm on my own, and there's nobody there to save me. Can you hear it? It's all beautifully wrapped into one thing. And it's a story. If you stop reacting to it, the storyline ends. When the storyline ends, the feeling tone ends, and you can see the circumstances for what they are. You've created a new pattern by just observing, so that you can respond, not from a place of anxiety, but from a place of clarity.</p>
<h4>How to do it in the moment</h4>
<p>It's the power of the pause. Throughout the day, you need only three breath pauses. As you're about to go into a meeting, you slow the breath down, particularly the exhale, for three breaths. When you're about to say something, and you can feel yourself about to be triggered, you're going to say something you know will get you into trouble, you take those three breaths. This is called stilling. It's that pause before the stimulus and the response. And then you come back into the body and notice how the body has responded to just those three breaths. One of my clients did it in the room with me and said the feeling was still there, but it felt a couple more steps away. Less all of me.</p>
<p>Here's why three breaths are enough. The breath is the lever to the nervous system. A nice long breath, a little fuller than the way you normally breathe, is signaling to the brain: it's safe here, I can calm down now, I can be completely present. It takes a few breaths to do that. It doesn't take a lot.</p>
<p>Then, in the space, you don't have to respond right away. Let it land. Wait in the space between stimulus and response, and if you stay with it, you'll start to feel what the value or the longing is underneath, the thing that's wanting to be expressed. When there's an urge to figure something out or do something next, make a U-turn back into the body, stay patient with it, and let that be enough. Hang out in the space. It's spacious, actually, that gap. Filled with space and possibility.</p>
<p>When the urge is to write the five-paragraph defensive email explaining why it wasn't your fault, or to apologize profusely and promise the moon, you choose to do neither. You just hold the tension. Write the letter if you need to. Write it as if you're going to send it. Then hold off on sending it. If your pattern is to fix, still is the moment you don't fix. If your pattern is to withdraw, still is the moment you stay put. You're not stonewalling. You're not punishing. You're just refusing to let panic drive the bus.</p>
<h4>Not riding it into action</h4>
<p>The hard part is holding the pause while the wave is still up. I'm here with my kid, and I can feel the urge to write it down and do something, but I'm going to stay present with him while I'm on fire. We learn how to ride the wave of the fire. Buddhism is not a passive process. It's waiting for the right time to make just the right move, as opposed to all the effort we put in and get no results. It's about timing, staying composed, and then, quickly, taking the action with a lot less effort.</p>
<p>I'll give you one of mine. I was in a setting where somebody made a very bad antisemitic remark to me. I could feel every part of me wanting to beat him to a pulp. Instead of running with that, I stayed with the feelings. It was terrible, it was burning, I wanted to blame him and the people who had invited him. And at some point I was able to say, hey, look, what you said really hurt my feelings, I really didn't like the way you handled that. And he understood. That's what's on the other side of the wave: the clarity that's there after an emotional wave passes, where you can see a situation a little more clearly and calmly, without needing to be defensive or reactive.</p>
<h4>Summary</h4>
<ul><li>Reacting gives you three options, hit it, run, play dead, and they keep you in the same pattern. Responding gives you nuance, and the pause is how you get there.</li><li>The pause is the space between stimulus and response. The first two weeks built it. This week you step into it on purpose.</li><li>Not pausing means putting out fire after fire until you're exhausted. Stop reacting and the storyline ends.</li><li>Three breaths before the meeting, or before you say the thing. Don't answer yet. Hold the tension. Don't send it yet.</li><li>Ride the wave out, not into action. What's on the other side is clarity.</li></ul>
<h4>Action</h4>
<p>Sit with Finding the Third Option, this week's recording, most days. Through the day: three breaths before a meeting, a reply, or a conversation, and then don't answer yet. Notice what the body does in the space. Start the first journal, The Trade, after you've caught one moment like that.</p>
<h3>Tune In to the Trade</h3>
<p>The performance trap is the place where you agreed to give up a part of yourself to stay safe. You learn, usually at a very young age, that to stay connected you have to give something up. Maybe you give up honesty to keep the peace. Maybe you give up needs to avoid being a burden. Maybe you give up anger, or softness, because it isn't safe to have it. This isn't a conscious choice. It's subconscious. Nevertheless the choice is: I will suppress my needs and become what you need me to be, so you don't leave. The trap begins the moment we learn that connection is something we have to earn.</p>
<h4>Why tune in to it</h4>
<p>The wound is the place where you traded your inner truth for outer safety. Tuning in forces that hidden deal into the light so you can stop paying the cost. Here's what it costs when you don't. To stay connected, you learn a kind of self-separation. One part of you monitors the room and manages the relationship, while another part works just as hard to mute the body's signals of danger or need. Over time that becomes so automatic that it stops feeling like a strategy and starts feeling like your personality. It works. It keeps the connection. But you stay fine on the outside by leaving yourself on the inside. And the withholding of your own experience becomes a reinforcement of the trap you're stuck in. You have all sorts of ways of overriding the ache, until finally you can't override it anymore. It's gotten too big. Everybody's noticing.</p>
<p>So the move this week is, in its simplest sense, learning how to sense: where am I trading my well-being in a given moment? Where am I trading my truth, my honesty, my well-being, to stay in relationship? Where do I keep trading that? It's catching the moment you're trading your own truth to keep the peace. Tracking those micro movements where you contort yourself, the moments where you withhold what you actually feel to avoid setting someone off. The trade might keep you safe in the short run, but it's costing you your own truth. And tuning in is the moment you start to undo it.</p>
<h4>The double bind</h4>
<p>Here's where the trade comes from. The basis of the work I do is an idea called the double bind. It was originally a theory about schizophrenia, in the early sixties, and as far as that goes it's been debunked, but it maps our everyday traumas. A double bind is when no matter what you do, you can't win.</p>
<p>It goes like this. There's what's said, the explicit channel: you're loved, you're great, you matter to us, my door is always open. And there's the implicit channel, what it actually feels like, what the body picks up. Mama says, I love you, come give me a kiss. That's the verbal channel. But when you go to give her a kiss, she's stiff and trying to get away from you. On a bodily level you feel her pulling away. But because you're dependent on her for your survival, you still give her the kiss, and you start to deny your own bodily experience as a way to survive that situation. And you can't talk about it. So you learn to hear the explicit and override the implicit. You learn to override your own body signals. That's the whole origin of the override.</p>
<p>Imagine a manager who is absolutely overwhelmed. Their eyes are glazed, their cortisol is spiking. But they say, my door is always open, tell me what's wrong. The verbal channel invites you in. The somatic channel screams, I can't handle one more thing. If you believe the words and lean in, you might trigger their rage. If you point out the body language, you risk being a problem. That's what makes it a bind. There's no clean move. So you do the only thing left. You adjust yourself. You shrink your reaction, you manage your tone, you smooth it over. You keep the connection intact, even if it means overriding what you actually feel. If that's familiar, it's because it's not that different from the bind you lived in as a kid.</p>
<h4>The binds people bring</h4>
<p>I hear them every week, and they rhyme. Work really hard, but don't pressure your team. I want you to come forward and tell me, but when you actually tell her it becomes explosive, so you say nothing and live with a low-level resentment and loneliness. If I share myself with you I don't get seen, or I get punished; if I withdraw, at least I can protect myself, but I feel alone. If I follow my passion, I'm cut off from my people. If I follow what they want, I'm cut off from myself. In every one of them the imprint is the same: I don't have a choice, not if I want to stay connected.</p>
<h4>Naming the trade</h4>
<p>Here's how I do it with people. They don't go away completely, these patterns, because they're formed out of a basic trade you believe you have to make in relationship. You trade something for something else. So: see if you can name what the trade is. One client said, what I provide is, I don't share my vulnerable, sad, shameful parts, and in return I get security in the relationship. Then: what's it like to make that trade? He said, honestly, the relationship I get as a result is not as good as it could be, and there's an implicit risk at all times that if I insert this other thing, it goes away. So it's not actually that secure. It just seems secure. That was the hidden lie in it. It implies there's security, and there's not really security.</p>
<p>Then look at the payoff, because there is one. It's costing you your well-being, your relationship, showing up as yourself. And there's a little payoff for holding on to it. Comfort. I get to hold on to comfort, and the cost is I don't get the deep love I'm longing for. I'm choosing comfort over depth, because comfort is more familiar than the depth of the longing.</p>
<p>Don't audit this from your head. Go back into the body and feel the cost. When you name the trade, see that sunken quality in there, and even exaggerate it for a moment, so you really feel what the trade takes. Just naming it, and feeling it, is a break in the narrative. The narrative has been, I can take it. And the truth is, no, you can't take it, and that's honest. If that's the truth, then you have to expand beyond the binary.</p>
<h4>My trade</h4>
<p>I'll tell you mine. After my brother took his life, the unspoken deal in my family was that we couldn't handle another problem. So I traded my own grief and messiness to become the good kid. I became low maintenance. I got good grades. I became the proof that the family was still respectable. The trade was clear: I will suppress my own needs so you don't crumble, and in exchange I get to belong. It's a funny thing being the surviving son. You have to make up for the other one. Even now, decades later, I can feel the trace of that bargain in my body. In exchange for that trade, my own inner life went underground. My needs, my hurt, my anger were buried so deep I forgot they were mine. And I can see that the cost has been undeniable. It's a weight I've carried in my gut.</p>
<p>We have to recognize where we're compromising ourselves. That's the tuning in. Then it's about renegotiating the contract. Not renegotiating it by saying fuck you. It might say: wow, that hurts a lot, and you matter to me, and I want to find a new way. That's the third option, and it's next.</p>
<h4>Summary</h4>
<ul><li>The trade is the place you agreed to give up part of yourself to stay connected. It was subconscious, and it's still running.</li><li>Tuning in drags the hidden deal into the light so you can stop paying. If you don't, you keep re-traumatizing yourself and redoing the same inner work.</li><li>The double bind: what's said versus what the body feels. You learned to hear the explicit and override the implicit.</li><li>Name the trade. What's it like to make it? What's the hidden lie? What's the payoff, and what's the cost? Feel the cost in the body.</li><li>Then renegotiate, without fuck you.</li></ul>
<h4>Action</h4>
<p>Once you've caught one moment where the old pull was there, do the first journal, The Trade. Name the trade in that moment, what it's like to make it, and what it's costing. Bring it to the journal sitting.</p>
<h3>The Third Option</h3>
<p>When we're in fight or flight, it seems like there are only two options. Either I say fuck you, or I totally roll and let you take over my life. Succumb or defend. Acquiesce or escalate. Shut down and withdraw, or pick a fight. And in either case you lose. There's a third option, which we tend not to see from inside fight or flight. The third option is: I can honor you, and I don't have to cut contact with myself to do it. Honoring myself doesn't have to mean dishonoring you.</p>
<h4>Why it matters</h4>
<p>Here's what's at stake. When you're triggered, you have three options available to you: hit it, run, or play dead. When you're settled, you see lots of options. That's the whole reason the first two weeks came first. But seeing the option isn't the end of it. The double bind trains you to live in a split. You feel the no in your body, but you say yes anyway to keep the peace. So you feel one thing in your body and say another thing with your mouth, and you spend your energy managing, softening, timing, editing. You run two tracks at once: the part that's tracking the room to stay safe, and the part that's carrying what you actually feel.</p>
<p>We tend to believe our very survival depends on not saying the thing. But when you say it, that hidden pressure drops. You stop organizing your life around what can't be said. Something in you can unclench, and the energy that was spent managing comes back online. Not because the other person reacts perfectly. Because your system stops doing the double bind math. You come back into one channel, one truth, and from that place you can deal with what's happening instead of managing what can't be said. That's the whole point of this map: closing the gap between what you sense and what you say. Not becoming better. Becoming one person again, instead of splitting into the part that knows and the part that performs.</p>
<h4>The third option is being with</h4>
<p>Start where the first two weeks left you. My body's bracing. I try to override it. I want to think my way out of it. But my back is tight, my throat is constricted, my belly is tense, and that's the truth of the matter. How do I relate to it, rather than override it? Relating to it is not the same as succumbing to it. It doesn't mean turning into a bastard, and it doesn't mean ignoring it either.</p>
<p>So the third option is being with, which is to say: I feel this. I'm giving it the attention it deserves. Can I respond from there? Can I relate to myself and not keep overriding myself or succumbing? Can I stay in relationship? And if I stay in relationship, maybe there's another way of being that can arise out of that. It doesn't have to be dramatic, and it doesn't have to be nothing. The dramatization is not actually feeling. Feeling is literally: I feel this.</p>
<p>Expansion doesn't mean grand solutions. It just means you're no longer locked into the reflex. You might see that you don't have to explain as much, or that you can say less, or that you can ask one clean question instead of defending yourself, or that you can wait. You can do nothing for ten minutes. You can say, let me think about that. You can step away from the phone and come back when your system isn't flooded. You're not stonewalling. You're not punishing. You're just refusing to let panic drive the bus.</p>
<h4>Practice</h4>
<p>Practice is where you take the third option into the real world. It means saying out loud what your body already knows and what you were trained to keep quiet. It's the conversation, the boundary, the clear no, or the moment you stop over-explaining and simply stay honest, even when it's uncomfortable. Do one small thing that breaks the script. It doesn't need to be a big confrontation or the perfect response, just one new move. If you usually write a long explanation, write one sentence. If you usually apologize right away, ask a question instead. If you usually take full responsibility, name one piece that's actually true for you. I hear you. I need a minute. I'll respond when I'm not spun out. Or: I'm open to feedback. I'm just not willing to take responsibility for things that aren't mine.</p>
<p>A request has an extra step that isn't obvious. We have a gripe and we can state it, but all we're asking for is: don't do that. Can you not do that? The "can you not" doesn't give somebody something to do. So we start there, and then we ask ourselves, what do we want from them, and what does that look like, so they could see it in their own mind's eye. It's making clear what you do want.</p>
<p>Then it's not just one honest sentence, it's what comes next. Once you say what's true, you make a small agreement about how you'll handle it going forward, so the relationship stops requiring the old performance. And say it live. This is not an email situation. After the fact, put it in an email if you want. But it's getting on the phone, or into the room, and saying: the way I'm experiencing it is that our relationship is hurting, and I want to find a way forward.</p>
<h4>The measure is not their response</h4>
<p>You may find that the other person cannot meet you, and never will meet you in that need. But not having said it would be a great ache, a missed opportunity. Having said it, and realizing they can't meet you, shows your nervous system that it's possible to stand up for what you value and for your truth, and still hold your ground, no matter what the response is. Whether they understand or not, voicing your truth is a way of breaking the double bind and changing the contract you've been living under. Don't wait. Tell the truth, and trust that your truth is valuable, regardless of how somebody reacts to it. It leads to a new conversation. Holding back the truth only holds back the evolution.</p>
<p>And it's practicing it and living with the consequences when it doesn't go the way you'd hoped. That means not cutting off, either from yourself or from them when they lose it. Staying in the relationship. Staying engaged.</p>
<h4>You'll miss it</h4>
<p>Nobody gets this in one clean shot. Most of us have practiced our defenses for decades, so you'll miss it. You'll over-explain, or go quiet, or say yes when you mean no. Then you'll notice, recover, and try again. That's practice: one small, honest move, repeated until it becomes a new default. Sometimes you'll notice only after you've reacted. That still counts. Oh, wait, that was a moment I could have turned toward. The practice is noticing the next time. And if you catch yourself thinking, if I only notice after the fact then it's too late, that's just another story, another set of beliefs getting overlaid.</p>
<p>For me, practice wasn't a dramatic speech. It was a simple email. After realizing I couldn't do the full video production for the book, I wrote to my friend in marketing and told him the truth: I'm still in on the podcast, but for now, can we start with the audio? I want to see how it feels before I go all in. In that one exchange the rule changed. I wasn't quitting, and I wasn't forcing myself to do something my body didn't want. I was setting a pace my body could actually live with. I've been on interviews shaking, and announced it into the mic: I'm shaking. That's part of the third path.</p>
<p>With each small step, the nervous system begins to trust a new way of being: that safety and belonging don't have to mean abandoning yourself, that you can stay with yourself even when it feels hard, and that moving forward doesn't require leaving yourself behind. If it helps you get one cleaner sentence out, hold one boundary with fewer explanations, or stop one reactive spiral, it did its job.</p>
<h4>Summary</h4>
<ul><li>In fight or flight there are two options, and you lose either way. Settled, there's a third: honor them without cutting contact with yourself.</li><li>The why: you stop running two tracks. One channel, one truth. The gap between what you sense and what you say closes.</li><li>The third option is being with: I feel this, and I can respond from there. Wait, ask one clean question, say less.</li><li>Practice is one small honest move, and then the agreement that comes next. Say what you do want. Say it live.</li><li>The measure is not how they respond. You'll miss it. Noticing afterward counts.</li></ul>
<h4>Action</h4>
<p>Near the end of the week, do the second journal, The Third Option. Take one interaction from this week, find the two options the trap offered, find the trade, and write the one honest sentence you could still say, or could say next time. Bring it to the journal sitting.</p>`,
    meditation: meditationPlayer('https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/onramp-week3-finding-the-third-option.mp3', 'Finding the Third Option, recorded by Chad. About twelve minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>About twelve minutes with Finding the Third Option, eyes closed. On a jumpy day, the breathing recording first. A missed day is fine. Begin again the next.</p>
<h4>Through the day</h4>
<p>Three breaths before a meeting, a reply, or a conversation. Slow the exhale. Then don't answer yet. Notice what the body does in the space.</p>
<h4>The daily rep</h4>
<p>Once a day, run one real interaction through the moves, however small. Pause. Where am I trading my well-being right now? Is there a third option, one that doesn't cut off from me and doesn't cut off from them? One honest sentence, saying what you do want.</p>
<h4>When you miss it</h4>
<p>You will, and noticing after the fact counts fully. Replay it: what was the trade, what was the third option, what's the sentence you could still say. That replay is how you catch the next one sooner.</p>
<h4>A line a day, if you want one</h4>
<p>The trade I noticed, and the small step I took, or wish I had. The site already keeps track of the recordings you play and the journals you mark done.</p>`,
    journal: `
<p>Two journals this week, each one a printable sheet. Do one or both. When you finish one, tap Mark done. Take a few minutes of breath before either of them, then open your eyes and write. Don't filter. Don't edit.</p>
<p>Then, once or twice in the week, bring what you've written to the journal sitting. Bring one journal or both. It reads everything, finds the place with the most charge, checks with you, and reads your own lines back so you can notice what the body does as you hear them. If you ticked the box on Week 1, what you bring here is kept for me as well.</p>
<h4>1. The Trade (once you've caught a moment, after a sit)</h4>
<p>One moment this week where you contorted. The body now. The two channels, what was said and what the body picked up. The trade, named plainly: in exchange for what, I agree to what. What it's like to make that trade, felt in the body. The hidden lie. The payoff and the cost. Where else it has shown up. One line to carry into the week.</p>
<p><a class="button" href="/downloads/on-ramp/week-3/the-trade.pdf" data-journal="week-3/the-trade" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-3/the-trade">Mark done</button> <a class="button button-quiet" href="${JOURNAL[3].pagePath}?journal=week-3/the-trade">Bring it to the journal sitting</a></p>
<h4>2. The Third Option (end of the week)</h4>
<p>One interaction from this week where the old pull was there. The body now. The two options the trap offered you, in your own words. The trade. The third option, even if you only see it now. Then the actual words: one honest sentence, one boundary, or one request that says what you do want. What comes next. What it would mean to have said it regardless of how they respond. And my two questions: what's one thing you're taking with you, and what's an open question you're left with?</p>
<p><a class="button" href="/downloads/on-ramp/week-3/the-third-option.pdf" data-journal="week-3/the-third-option" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-3/the-third-option">Mark done</button> <a class="button button-quiet" href="${JOURNAL[3].pagePath}?journal=week-3/the-third-option">Bring it to the journal sitting</a></p>
<p class="note">Keep what you write. You'll bring a piece of it to your Integration and Next-Step Session at the end of the four weeks.</p>`,
  },
  4: {
    title: 'Week 4: Integration and the Doorway',
    sub: 'The sacred wound, the protectors, and the whole arc. What comes next.',
    intro: `Hi, friend. Last week. Before anything else, I want to say this: however much of it you did, whatever stuck and whatever didn't, you spent four weeks turning toward yourself instead of away. That is not easy, and you did it. There's no new move this week. You have all of them. This week you run the whole arc, SENSE into STEP, on whatever your life hands you. And you get honest about the deeper layer you've been brushing up against all month, and what it would mean to go there. It's a privilege for me that I get to walk this last stretch with you.`,
    video: videoPlaceholder('The last week'),
    teaching: `
<h3>Introduction</h3>
<p>Here's why this last week matters. All month you've been staying with the tightness. Underneath it there's usually something more tender. At the core of the things you came in with is a kind of core tenderness, a core anxiety or grief, that you've spent a lifetime trying to fix, ignore, or outrun. The performance isn't the root. It's a sophisticated coping strategy built to avoid something older and more tender, something I call the sacred wound. The trap is the strategy, and the wound, the ache no success will ever fix, is what all that proving is designed to keep you from feeling. This week is about turning toward it, not to fix it, but because it's the doorway to what's next. And it's about meeting the parts of you that have been guarding it with a little less argument than you've given them so far. I love protectors. I want you to know that going in.</p>
<p>Same shape as before. Three pieces early in the week: the sacred wound, the protectors, and the whole arc and what's next. Two journals, and you can do one or both, but please do the second one whatever else you skip. The Sacred Wound early in the week, after a sit. What You're Taking With You at the end, and that's the one you bring to our hour together. The sit this week is The Sacred Wound, about fourteen minutes. Go slowly. If it's too much on a given day, that's information, not failure. Go back to the breathing recording and come back to it tomorrow.</p>
<p>One more thing to expect. There will be moments this week when it gets hard. It'll bring things to the surface. You might feel tired, foggy, or irritable, and you might want to skip the journal. That doesn't mean you're failing. It means something is indeed working. Something is opening, and the parts of you that protect you don't yet know how to let that happen without trying to shut you down. We don't do shame here. Notice it, and come back. I'm looking forward to sitting down with you. Be well, and go slowly.</p>
<h3>The Sacred Wound</h3>
<p>I'm not pointing to anything supernatural. I'm naming something human and specific. The sacred wound is the somatic imprint of all the ways we've traded ourselves, our needs, and our sense of aliveness in order to belong. It lives in the body, not just the mind. It's the tight chest, the braced jaw, the I'm fine reflex, the constant push to prove.</p>
<h4>Why go there</h4>
<p>Here's the why, and it's the whole reason for the month. At the core of all the things we're bumping up against, the work, the relationships, the health, is a core tenderness, a core anxiety or grief, that we spend a lifetime trying to fix, ignore, outrun. We have all sorts of kids on our bus designed to keep us from accessing it. And the pain it stirs up isn't a mistake. It isn't proof that something's wrong with you. It's your system doing exactly what it's meant to do: alert you. Just like hunger tells you you need food, the hurt, the shame, the emptiness are signs that you abandoned yourself in order to earn love.</p>
<p>No amount of achievement will ever fully quiet that background hum of not-enoughness, because that's not what the ache is asking for. It's not asking to be silenced. It's asking to be met, to be felt. So what makes it sacred is that even though it hurts, it becomes the doorway back to who you were before you learned to compromise yourself to belong. The pain itself isn't sacred. No child deserves to be rejected or hurt. What's sacred is that the part is still looking for what it never got. It keeps hoping. And hidden inside the wounding are your values, your sense of purpose, what's most important to you. The wound doesn't just mark where you hurt. It reveals what you value. I always say the ache is the map home.</p>
<h4>Where it comes from</h4>
<p>It's the part that learned to adapt so it could belong, get loved, or at least avoid getting hurt. It came into the world wanting to feel safe and loved without conditions, and it didn't land in a world like that. So we learned to contort, to go to our heads, to become clever or smarter, and in the process we lost touch with what's actually here in the mind and body. The body is the receptacle, the memory. It remembers the imprint of that compromise. That's the sacred wound: the imprint, the memory of that compromise.</p>
<p>It's a part of us that learned very early that it had to go away in order to get connection. We spend an inordinate amount of energy trying to quiet it, silence it, cut it off, fix it. It never works. It's asking to be attuned to, because it's the part that didn't get the love or attention or care.</p>
<h4>Why the body and not the story</h4>
<p>Understanding it matters, but it won't touch the wound on its own. That part lives in the body. Some of these wounds were laid down before the thinking brain was fully online, and others in moments of overwhelm, when the thinking mind went offline. We might have bits of story, but we don't reach the wound through the stories. We access it through the body, through its feelings. We can talk about our history forever, but if we want to change it, we have to meet it where it lives.</p>
<p>So notice the moment your body goes rigid, the instant you move from feeling to managing. That flicker of tightness isn't energy. It's pressure. It's the part of you asking not to be pushed again. That's the doorway. The chest tightening when a conversation gets uncomfortable. The stomach dropping when someone pulls away and you adjust yourself to stay likable.</p>
<h4>How to approach it</h4>
<p>Gently, and sideways. The protectors are about five or ten steps ahead. They're always aware, because what they're protecting is this wounding, and nothing in the system has been prepared to let us experience that. So we learn to sneak up on that part of ourselves. Not to surprise it. It doesn't want to be met straight on. It wants to be met sideways, to be gotten to know, to be appreciated. And it's hiding all this wisdom.</p>
<p>The goal isn't some dramatic breakthrough. It's to make contact with what's been held there, to touch it, feel it, receive it, acknowledge it. Contact doesn't always feel smooth. Sometimes the first thing that shows up is the old protection. Your mind speeds up, you go blank, you feel heat or nausea. That's the body running the survival program that once kept connection possible. When there's enough steadiness to stay with it, in the small doses you practiced in Week 2, the system starts to update. The breath releases, the shoulders soften, not because you figured it out, but because something deeper got the message: this feeling can be here. We can't meet it with a cold neutrality. We meet it with care. I see you. I'm here. I've got you. What it needs is sustained attention. Not mechanical attention. Attuned attention.</p>
<h4>What happens</h4>
<p>When we come back to these places, if we stay, it reveals an ache, a tenderness, a part of you that has waited all these years. It's not asking to be fixed or improved anymore, but to be felt, to be acknowledged. It asks for care in the form of presence where there was once neglect. And when it gets that, the wound starts to go, ah, it's safe here. I'm held. When we're children and we feel held, we can dance, we can sing, we can play. When we're not held, our job is to be hyper-vigilant. So the shift is: I can feel this part of me. It's scared, it's heavy, it's alone. If I stay with it long enough, it reveals what it wants. It has something to show you. That's when a new kind of choice becomes available. Not a breakthrough or an overhaul. Most often one small step, something that honors what you used to have to hide. A no, a pause, a let me see, or even a yes.</p>
<h4>Mine</h4>
<p>I'll tell you what it was for me. I called all that hard work discipline, but really I was trying to erase the part of me I refused to accept. The boy who was furious that no one really asked how he was, the one who needed more than anyone could give, the part that didn't want to be the wise and calm one holding everyone together. When my brother took his life, the role was set for me. I was to be the good one, the proof that we weren't a broken family. Years later, when I finally had the success I thought would make me feel like enough, my body went into full revolt. My gut was in constant pain. I was barely sleeping. I was more isolated than ever. I couldn't perform my way out of it. And when we finally looked at the knot in my gut, the one that said, I'm holding it together, we weren't just looking at a stomach ache. We were looking at a contract I signed when I was young.</p>
<p>Discovering this hasn't magically resolved everything for me. It hasn't erased my anxiety or stopped me slipping back into performance. What it's given me is a way to meet that old shame and pressure with more presence and kindness, rather than always having to prove something. And now I'm listening for one thing. I'm listening for what the wound wants.</p>
<h4>Summary</h4>
<ul><li>The sacred wound is the imprint, in the body, of every way you traded yourself to belong. The performance is the strategy; the ache is what it's built to avoid.</li><li>It's not an error. It's the system alerting you, and it's asking to be met, not silenced. What's sacred is that it's the doorway back, and your values live inside it.</li><li>You can't reach it through the story. You reach it through the body, at the moment you go from feeling to managing.</li><li>Approach it sideways, in small doses, with care. What it needs is attuned attention.</li><li>When it's met, it softens and shows you what it wants. Then one small step becomes possible.</li></ul>
<h4>Action</h4>
<p>Sit with The Sacred Wound, this week's recording, and go slowly. Early in the week, after a sit, do the first journal, The Sacred Wound. Bring it to the journal sitting.</p>
<h3>The Protectors</h3>
<p>All month, when you turned toward what was firing, the first thing you met was usually the protection. This week we meet it on purpose, and with a little less argument.</p>
<h4>Why meet them this way</h4>
<p>Here's the model. At the core we have our essence, who we are, how we came into the world, what we came in wanting. Then we have protectors that come in, because we realize the world doesn't meet us the way we hoped. So we learn to manage ourselves and the world in a way that keeps us feeling, at the very least, safe. And then we have the sacred wound, the part holding pain that's unprocessed and wanting to be processed. The protectors keep us from the wound until we're ready to turn and face it.</p>
<p>The closer we get to that tenderness, the more the mind distracts. We have all sorts of protectors designed to move away. So we don't make the strategies wrong. We just notice, and we have an appreciation for the strategies. On one level you could say they're a glitch in the system. Or you could say that's how the system stays intact, and how beautiful it is that these parts want to keep you from falling apart. When we hold it like that, we can start to hold tenderness for our own distractibility. Your distraction is there because it doesn't want you to feel this tenderness.</p>
<p>And here's why it matters that you don't fight them. A part of what sends a protector into overdrive isn't just that it's scared. A majority of it is that you hate it. In hating the anxiety and seeing it as weakness, it only makes it worse. There's an old line I attribute to Carl Jung: what you resist persists. If you push it down or push it away, it persists. But what you can be with, in my experience, completely dissolves. I'm not saying it's pleasant. I'm not saying it's easy. But when you turn toward a part and give it its due space, something changes that fighting never gets you.</p>
<h4>What they are</h4>
<p>Your inner critic is a form of self-protection. It has its own intelligence. It doesn't feel very intelligent while it's happening. It feels abusive and yucky. But it's what you learned to do to survive a situation. The critic forms very young, maybe four or five. Imagine your mother yelling at you, and it takes you by surprise. Your critic picks up on it and learns to yell at you before she does, so you don't have to experience that pain again. It modulates your behavior to keep you out of trouble. The strategies aren't stupid. They're useful strategies you learned as a kid. It's just that they're still intact as an adult, and they keep you away from one raw, tender wound. So our stance isn't against the critic. Our stance is to understand its motivation. When we get its motivation, it often gives us access to the vulnerability underneath it.</p>
<h4>How to meet one</h4>
<p>Here's what I do with people. You could think about that part of you, the responsible one, the careful one, the one that goes numb, as a protector. It's protecting something. What's it protecting? What's it afraid might happen if it didn't do this inside of you? Ask it from inside the body and let the body respond. No one's going to pay attention to me. Okay, I hear you. Anything else you're afraid might happen? I'll be alone. Okay. So the worst of it is you'll be stuck and frozen and not know what to do. Then: what's it hoping for? What does it want for you? It's doing this for a reason. It wants something for you.</p>
<p>Sometimes the answer is a child. What I hear when I ask what a careful part is protecting is a six-year-old boy who felt inadequate next to others and is still holding on to show he's just as smart, just as capable. Then let that land in the body. And come right up to the fear without going so close that it wants to run, but close enough that it knows you're right there with it. You let it know it's trying to help you. You acknowledge it. You can even thank it. Appreciate it. It's protecting you.</p>
<p>Here's what changes. When you can appreciate its deep concern, how it got formed, the beliefs it carries about you, it settles. Not all of what it says is valid. But it needs your acknowledgment, and there's a certain percentage that, if you'll acknowledge it, settles down and actually has something brilliant to add. Every time a part comes forward and you acknowledge it, it settles, and then a new part comes forward, and you acknowledge that, and it settles. As they settle, you become more integrated. You feel more of yourself as awareness, but also the wholeness of the bus rather than the fragmented nature of it. The parts that were holding pain become like good members of your council.</p>
<h4>The return</h4>
<p>Underneath the protectors is the one they're protecting. The typical way we deal with that part is judgment and shame. You idiot. Hoping that if I call myself an idiot enough times I won't do that thing again. What's actually needed is: oh, come here. I got you. I'm not leaving you. I'm right here. I know this is really painful. I know you feel so alone. Tell me what you're feeling. That's keeping the pain company with a caring attention, the way a well-resourced parent would with a child who's overwhelmed. We're not saying the parents fucked up. They did the best they could in that circumstance. And now it's your job, at this moment, to take it to the next place.</p>
<p>A young part of you, ten or eleven years old, has been parenting you all these years. That's strange to think about. So it's a commitment to reparent that part. To say: I'm watching out for you. I know you feel not enough, not lovable enough, a failure, whatever the stories are. And I'm not leaving you. I'm not abandoning you. With a client who'd found the child underneath, I'll say it out loud with them: none of that was your fault. You didn't do anything wrong. You were a kid. You were always enough. You might imagine wrapping him in a blanket and holding him close, and watching him finally rest. I'm the one who will protect you now.</p>
<p>Some of this is more than a week can hold, and that's fine. This week's version is small. Name the protector when it shows up. Ask what it's protecting. Thank it. And if the younger part appears, receive it with warmth, in the present, without digging. The deeper work with it has a home in our hour together.</p>
<h4>Summary</h4>
<ul><li>Protectors sit between your essence and your wound. They keep you from the pain until you're ready. They're not the enemy.</li><li>Fighting a part feeds it. What you resist persists. Appreciation is what settles it.</li><li>The critic is protection with its own intelligence, formed young. Our stance is to understand its motivation, not to beat it.</li><li>Ask: what's it protecting, what's it afraid might happen, what does it want for you. Then thank it.</li><li>Underneath is the one it's protecting. I got you. I'm not leaving you. That's the return, and this week's version is small.</li></ul>
<h4>Action</h4>
<p>Through the day, when the reflex to perform, fix, or disappear shows up, meet it with a little less argument. Which protector is this, and what's it protecting? Thank it. Then come back to the body.</p>
<h3>The Whole Arc, and What's Next</h3>
<p>There's no new move this week. You have all of them. This week you run the whole thing on whatever your life hands you, and you look at what's next.</p>
<h4>Why this last week matters</h4>
<p>Here's the honest part first, because it's where most people stumble. When people complete this kind of work they often finish filled with triumph and ease, and then, as soon as the training is over, there's a kind of letdown. It's not because the whole thing was a farce. It's that on the road back you have a new obstacle to overcome, and for some it's the biggest one. It's the challenge of integrating, of making real, the insights you've had. The world around you hasn't changed. You have. And the wisdom you've garnered dies if it's not kept alive through thoughts, words, and actions. That's what this week is for.</p>
<h4>The whole thing as one move</h4>
<p>You don't have to do anything perfectly here. You don't have to remember a sequence. If all you do is slow one exhale and notice one honest sensation, that counts. When you're activated, start there. Slow the breath a little. Notice one sensation, tight, hot, blank, buzzing, and keep going with your day. If you have space for another breath, take it. If not, that moment of contact has already interrupted the reflex. This is the simplest version of the work. Everything else you learned this month is a way to recognize and repeat that move when you need it.</p>
<p>In real life it looks like this. The old pattern starts to fire, the throat tightens, the mind speeds up. You slow the breath. You check the throat and notice the clamp. You don't wait for the sensation to disappear. You wait for one small thing, a little steadiness to come online. That's the pause. Then you tune in to what matters, you see one more option than the default, and you make one simple act that stays true to you. This is how change actually happens. Not in one big leap, and not permanently, but again and again, through small, embodied choices. The nervous system learns it doesn't have to run the show, and the self that's been waiting underneath finally gets met. Relief may follow. Relief isn't the goal. Contact is, and from there, action becomes trustworthy again.</p>
<p>Think of it like this. The trigger is a spinning top. The top is never going to go away. That's not the point. The point is that when the top is spinning with less intensity, you're left with a little space to choose differently. It's not gone. It's just not such a big deal anymore. How do we want to respond anew?</p>
<h4>What changes over time</h4>
<p>I won't overstate it. We're not talking about 100 percent better. We're talking about 10 percent, and 10 percent better has a lot in it. When you start this process, things get better really quickly. That's encouraging. And then, over years, you get comfortable with the fact that some things keep coming up over and over again, and you develop patience and persistence toward feeling them. Some weeds are newly grown and you pluck them out easily. Some have been in your life your whole life, and those take perhaps a lifetime.</p>
<p>What you'll be able to do over time is spot it. To say, oh, this one, this part is taking over. And then to be honest with somebody about it, and to cry if the tears come, and to let it go for a moment, a day, a week, and it'll come back. That's not the point. We're not trying to get to once and for all. Once and for all is a delusion. I still have it, that delusional sense that I can once and for all my life, and I keep waking up to the fact that it isn't so. The ache doesn't ache the way it did ten or twenty years ago, and given the right conditions it can come right back. What changes is that you're not overriding the signals, and when you don't override them, you start to articulate what you need a little sooner, and with a little more kindness.</p>
<p>Here's how I know someone has really changed. They've felt the thing that got triggered in them, fully. They've ridden the wave. And they've begun, in very small ways, to change the contracts in their relationships. They say no where no needs to be said. They say yes when there's a genuine yes. When there's a maybe, they don't move so quickly. They pause and wait for clarity. When someone is really ready to change, it happens, to some degree, spontaneously. It happens because they've done the work.</p>
<h4>Keeping a practice</h4>
<p>Bottom line, the most successful practice is breath work. Five in, seven out through pursed lips, or five and five. It's where I'm actively shifting my nervous system from fight or flight toward rest and digest, because it's from that calm place that I can inhabit a curious mind and observe my thoughts and feelings with openness rather than judgment. I'm less tense, less reactive. So my main suggestion is that you spend at least fifteen minutes a day working with the breath. And the reason we practice in general is so that when we need it, it's quickly and easily available to us. We practice in the straightaways so that when the curves come, we know how to lean in. Practice builds memory in the nervous system. When life gets turbulent, you don't have to think your way through every turn.</p>
<p>Then be a little patient, and persistent, with the integration. You will be tested. The road back is where the practice earns its keep.</p>
<h4>What's next</h4>
<p>We don't end a journey like this one with an exclamation point. As human beings we don't truly end anything with an exclamation point, except maybe when we take our last breath. We end with ellipses, dot dot dot. A true hero's journey is circular. So don't be surprised if you're called to a new adventure. Rather than resisting it, you'll likely say yes, because you'll be able to tread those waters with the tools you've cultivated. That was the point of these four weeks: to give you a set of tools for when the next call comes, so you know how to go into the deep unknown and come out transformed by it. In the cave you fear to enter lies the treasure you seek.</p>
<p>And here's what the month has been pointing at. At the core of the things you came in with, the work, the relationships, the health, is a core tenderness, a core anxiety or grief, that you've spent a lifetime trying to fix, ignore, outrun. What I'm after with people, over a longer arc, is a loving, embodied appreciation for that sacred wound. Sidling up to the part of you that got abandoned, so it can come online and be an ally. And then making new choices that expand you, choices that widen your aperture and bring other human beings into your life in a new way. That's the deeper work, and it's what the hour we'll spend together is for. I don't like to do the sale thing. I'll just say the door is open, and we'll look at what's true for you.</p>
<h4>Summary</h4>
<ul><li>The road back is the hard part: the world hasn't changed, you have, and what you learned dies if you don't live it.</li><li>The whole arc in one move: slow one exhale, notice one honest sensation, wait for a little steadiness, then one act that stays true to you.</li><li>What changes is 10 percent, then patience and persistence. You spot it sooner, you say what you need sooner, you change the contracts in small ways.</li><li>Fifteen minutes of breath a day. Practice in the straightaways so you can lean in when the curves come.</li><li>This ends with dot dot dot. The next call will come, and you'll have the tools. The deeper work is the sacred wound, and the hour together is where we look at it.</li></ul>
<h4>Action</h4>
<p>At the end of the week, do the second journal, What You're Taking With You. Bring it to your Integration and Next-Step Session. That's the one we'll start from.</p>`,
    meditation: meditationPlayer('https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio/onramp-week4-the-sacred-wound.mp3', 'The Sacred Wound, recorded by Chad. About fourteen minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>About fourteen minutes with The Sacred Wound, eyes closed, and go slowly. If it's too much on a given day, that's information, not failure. Sit with the breathing recording instead, and come back to it tomorrow.</p>
<h4>The whole arc, through the day</h4>
<p>Slow one exhale. Notice one honest sensation. Wait for a little steadiness. Then one act that stays true to you. That's the simplest version, and it counts.</p>
<h4>When a protector shows up</h4>
<p>When the reflex to perform, fix, or disappear shows up: which protector is this, and what's it protecting? Thank it. Then come back to the body.</p>
<h4>A line a day, if you want one</h4>
<p>Where did I meet a protector today, and could I be a little kinder to it? The site already keeps track of the recordings you play and the journals you mark done.</p>`,
    journal: `
<p>Two journals this week, each one a printable sheet. Do one or both, and do the second one whatever else you skip. When you finish one, tap Mark done. Take a few minutes of breath before either of them, then open your eyes and write. Don't filter. Don't edit.</p>
<p>Then bring what you've written to the journal sitting. It reads everything, finds the place with the most charge, checks with you, and reads your own lines back so you can notice what the body does as you hear them. If you ticked the box on Week 1, what you bring here is kept for me as well.</p>
<h4>1. The Sacred Wound (early in the week, after a sit)</h4>
<p>A moment you went from feeling to managing. The protector that shows up first, named and thanked. What's underneath it: where, the quality, how old it feels. How it responds to being met with care. What it has been trying to say. What it wants for you. One small step. And one line: what the wound wants, as best you can hear it.</p>
<p><a class="button" href="/downloads/on-ramp/week-4/the-sacred-wound.pdf" data-journal="week-4/the-sacred-wound" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-4/the-sacred-wound">Mark done</button> <a class="button button-quiet" href="${JOURNAL[4].pagePath}?journal=week-4/the-sacred-wound">Bring it to the journal sitting</a></p>
<h4>2. What You're Taking With You (end of the month, for our session)</h4>
<p>Where you started, read back a month later. What the body learned. One moment from the month when you did the thing. What's still running. The part of you you've reclaimed that you never want to lose again. The line: what you're taking with you, what you're leaving behind, what you're saying yes to and no to. What's underneath. Your practice going forward. And my two questions. This is the one you bring to your Integration and Next-Step Session.</p>
<p><a class="button" href="/downloads/on-ramp/week-4/what-youre-taking-with-you.pdf" data-journal="week-4/what-youre-taking-with-you" target="_blank" rel="noopener">Open the journal (PDF)</a> <button type="button" class="button button-quiet" data-journal-done="week-4/what-youre-taking-with-you">Mark done</button> <a class="button button-quiet" href="${JOURNAL[4].pagePath}?journal=week-4/what-youre-taking-with-you">Bring it to the journal sitting</a></p>`,
    closing: `
<h3>Your Integration and Next-Step Session</h3>
<p>You made it through. However much of it you did, whatever stuck and whatever didn't, you spent four weeks turning toward yourself instead of away.</p>
<p>The course ends with one private conversation with me. That session is where the month gets named: the contract you keep signing, where it shows up in your body first, the trade you keep making, and one small next step. It's yours whether or not we ever work together again.</p>
<p>I'll also tell you whether deeper one-on-one work fits where you are, and what it looks like if it does. If it's not the right time, I'll say that too. And if you do continue within 30 days, what you paid for this course is credited toward the coaching.</p>
<p><a class="button" href="https://chadherst.as.me/integration-and-next-step-session">Book your Integration and Next-Step Session</a></p>
<p class="small">Bring your What You're Taking With You journal.</p>`,
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
