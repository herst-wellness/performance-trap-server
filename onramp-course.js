// The Mind/Body Foundations On-Ramp course, served from this app instead
// of Squarespace. Four weekly lesson pages built from Chad's build-ready
// course content (drafted July 14, 2026), an overview page, and the same
// per-person access codes that unlock the practice companions. Lesson
// content is delivered only through the code-checked API, not embedded in
// the public page source. Video and most meditation slots are placeholders
// until Chad records them; Week 1's slot carries the recorded 12-minute
// breathing practice.
const { hasAccess, WEEKS, issueSignedCode } = require('./onramp');

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
  };
}

function selfServeEnabled() {
  const p = paypalConfig();
  return Boolean(p.clientId && p.clientSecret && p.priceUsd && process.env.ONRAMP_CODE_SECRET);
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
  if (!res.ok) throw new Error('PayPal auth failed');
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
          description: 'Mind/Body Foundations On-Ramp (four-week course)',
          amount: { currency_code: 'USD', value: p.priceUsd },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error('PayPal order creation failed');
  return (await res.json()).id;
}

async function paypalCaptureOrder(orderId) {
  const p = paypalConfig();
  const token = await paypalToken();
  const res = await fetch(p.baseUrl + '/v2/checkout/orders/' + encodeURIComponent(orderId) + '/capture', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('PayPal capture failed');
  const payload = await res.json();
  const unit = payload.purchase_units && payload.purchase_units[0];
  const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  const amount = capture && capture.amount;
  const completed = payload.status === 'COMPLETED' && capture && capture.status === 'COMPLETED';
  const amountOk = amount && amount.currency_code === 'USD' && amount.value === p.priceUsd;
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
  `<div class="placeholder">A short welcome video from Chad goes here: <em>${label}</em>. Coming soon; the written lesson below carries this week in the meantime.</div>`;

const meditationPlayer = (src, note) =>
  `<p class="small">${note}</p><audio controls preload="none" src="${src}" style="width:100%"></audio>`;

const meditationPlaceholder = (title, minutes) =>
  `<div class="placeholder">Guided audio to come: <em>${title}</em>, about ${minutes} minutes. Until it is recorded, use the written rhythm in the practice card below, or the Week 1 breathing recording.</div>`;

const COURSE_WEEKS = {
  1: {
    title: 'Week 1: From the Book to the Body',
    sub: 'Slow the Breath and Enter the Body. The first half of SENSE.',
    intro: `This week rebuilds one thing: the ability to leave your thoughts and come back to what your body is actually doing. No depth yet. Just contact. Everything else in SENSE and STEP stands on this.`,
    video: videoPlaceholder('Welcome. You already have the map.'),
    teaching: `
<h3>Slow the Breath, Enter the Body</h3>
<p>You can't do any of this work from inside fight-or-flight. The mind that's braced for the next thing can't also feel what's here. So we start where the body actually gives you a lever: the breath.</p>
<h4>S. Slow the Breath</h4>
<p>The practice is called the straw breath. Inhale slowly through the nose for a count of five. Then purse your lips, as if you were breathing out through a straw, and exhale slowly for a count of seven. The longer exhale is the whole point. It isn't about big, deep breaths. It's about a slow, smooth, continuous flow, no strain, no holding.</p>
<p>You aren't trying to relax. You're sending a physiological signal that it's safe to slow down. The long exhale moves the diaphragm in a steady rhythm, which tells the brainstem, through the vagus nerve, that you aren't under attack. Over five to ten minutes, the biology actually shifts. Heart rate eases. The system downshifts. And the parts of you that only come online in a settled state, the curiosity, the ability to feel, come back within reach.</p>
<p>That's why this is first. Not because calm is the goal, but because contact isn't possible without it.</p>
<h4>E. Enter the Body</h4>
<p>Once you've settled, the second move is a U-turn. When you're caught in a story about a feeling, the mind wants to keep talking about it. Entering the body is turning around and going to where the feeling actually lives. Not analyzing why it's there. Just locating it. Throat, chest, belly. Then noticing its quality: tight, hot, heavy, hollow, buzzing, dull.</p>
<p>The story is your mind's interpretation. The body is what's actually happening. Going to the body is how you get underneath the commentary to the thing itself.</p>
<h4>The small rephrase</h4>
<p>There's a linguistic version of the same move, and it's the one to carry into your day. Take the sentence <em>I am anxious</em> and turn it into <em>there's anxiety here</em>. <em>I'm a failure</em> becomes <em>there's self-doubt here</em>. Say both out loud and notice what changes in your body. The first is a verdict. The second is an observation. One says the feeling is you. The other says the feeling is something you're noticing. That small gap, between being the feeling and noticing the feeling, is the whole foundation. Everything we build sits on it.</p>
<p class="note">This week you're practicing three letters of SENSE already: S, E, and the start of N. That's plenty. Stay with it.</p>`,
    meditation: meditationPlayer('/audio/onramp-breath-12min.mp3', 'The breathing practice, recorded by Chad. About twelve minutes. Sit with it most days this week.'),
    practiceCard: `
<h4>Most days this week</h4>
<p>Sit for about ten minutes with the breathing recording above. Eyes closed. Same time each day if you can. If a day gets away from you, that's fine. Begin again the next.</p>
<h4>Through the day, whenever you remember</h4>
<p>Three deliberate straw breaths before a meeting, a hard email, a conversation you've been avoiding. Slow the inhale, lengthen the exhale. No app needed.</p>
<h4>The rephrase</h4>
<p>When you catch yourself thinking <em>I am [anxious, angry, behind, not enough]</em>, turn it into <em>there's [anxiety, anger] here</em>. Notice what changes.</p>
<h4>The two-minute version (for when you're activated)</h4>
<ol>
<li><strong>Slow the Breath.</strong> Three straw breaths. Longer out than in.</li>
<li><strong>Enter the Body.</strong> Drop the story. Where do you feel it? Throat, chest, belly?</li>
<li><strong>Name it.</strong> One word. Tight. Hot. Heavy. Then let it be there for a few breaths.</li>
</ol>
<h4>Your daily log</h4>
<p>One line a day: <em>Where did the old pattern show up today, and what did I do?</em> That's the whole entry. You're building the habit of noticing, nothing more. Skip a day and you start again the next one. No streak, no shame.</p>`,
    journal: `
<h4>The daily line (2 minutes a day)</h4>
<p>At the end of each day, write one sentence: where did the old pattern show up, and what did you do? You don't need to have handled it well. Noticing after the fact still counts. You're training your attention to catch it a little earlier each time. And a missed day isn't a failure. Just begin again when you remember.</p>
<h4>End of week: one real moment (15 minutes)</h4>
<p>Pick one moment from this week when you felt the pull to perform, fix, please, or disappear. Not the biggest one. Just a clear one. Then walk it through on the page:</p>
<ol>
<li>What happened, in a few plain sentences. Who, what, the moment the pressure hit.</li>
<li>Where did you feel it in your body? Throat, chest, belly, somewhere else? What was the quality, tight, hot, heavy, hollow?</li>
<li>What did you automatically do, or want to do? The old move.</li>
<li>Now write the verdict you told yourself: <em>I am ___.</em> Then rewrite it as an observation: <em>There's ___ here.</em> Read both out loud. Note what shifts.</li>
</ol>
<p class="note">Keep it to a few paragraphs. This is practice, not excavation. If something bigger surfaces and wants more room, that's exactly the work we'll talk about in your closing session.</p>`,
  },
  2: {
    title: 'Week 2: Staying With It',
    sub: 'Name, Stay, Equanimity. The second half of SENSE.',
    intro: `Last week you practiced coming back to the body. This week you practice staying there a little longer than is comfortable, without fixing what you find. Still in the straightaways. Still small.`,
    video: videoPlaceholder('Staying, instead of fixing'),
    teaching: `
<h3>Name, Stay, Equanimity</h3>
<h4>N. Name the Quality</h4>
<p>Once you've located a sensation, put a simple word to it. Tight. Hot. Heavy. Hollow. Buzzing. Naming isn't analysis, and it isn't asking the feeling to leave. It just creates a small step back. You go from being the feeling to noticing it. From <em>I am anxious</em> to <em>there's a tightness in my chest</em>. That small distance is where everything else becomes possible. If a part is loud instead of a sensation, name that too: the inner critic, the fixer, the one who wants to check the phone.</p>
<h4>S. Stay</h4>
<p>Staying is turning toward the sensation and letting it be there. Not fixing, not explaining, not shoving it away. The way you do it is with a rhythm, and the rhythm matters more than the effort. Touch the sensation with your attention for about ten seconds. Then come back to the breath, or your hands, or the sound of the room. Rest there a moment. Then return to the sensation.</p>
<p>Touch, let go, return. Touch, let go, return. Small doses. Each pass, the part of you that's braced gets to notice that you aren't going to flood it, and that you aren't going to abandon it either. That's what lets it loosen. Not force. Safety.</p>
<p>You might drop a quiet question into the body: <em>what are you trying to prevent?</em> Then wait. Don't answer from your head. The body replies in its own time, sometimes with a memory, sometimes just by shifting.</p>
<h4>E. Equanimity</h4>
<p>If staying is making contact, equanimity is remaining with what you've touched. It isn't calm, and it isn't a state you achieve. It's the willingness to stop bracing and stop demanding a timeline. Your mind will want to jump in: how long will this last, what's the fix, what am I missing. Equanimity is not answering those. You come back to the body and let the sensation do what it does. Let it peak, let it settle, let it move, let it stay.</p>
<p>And here is the part almost everyone gets backwards at first. You are not building the ability to stay perfectly. You will drift, constantly, into your to-do list and this morning's conversation. That drift is not the failure. Noticing you've left and coming back, that is the practice. Not what happens before or after. The return itself.</p>
<p class="note">This week you have all of SENSE in your hands: Slow the breath, Enter the body, Name, Stay, Equanimity. Practiced on ordinary moments. That's enough.</p>`,
    meditation: meditationPlaceholder('Keeping It Company', 12),
    practiceCard: `
<h4>Most days this week</h4>
<p>Sit about twelve minutes with this week's audio once it's here; until then, sit with the Week 1 breathing recording and practice the staying rhythm on your own. The point is to sit, not to do the hardest version. A missed day is fine. Begin again the next.</p>
<h4>The staying rhythm</h4>
<p>Touch the sensation for about ten seconds. Let go to the breath. Return. Small doses, not endurance. If it gets too big, stay longer with the breath before you go back.</p>
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
<p class="note">A few paragraphs is plenty. This is practice, not excavation. If something deeper opens and wants more room than a straightaway can hold, that's exactly what your closing session is for.</p>`,
  },
  3: {
    title: 'Week 3: Turning Contact Into Choice',
    sub: 'Still, Tune in to the Trade, Expand Options, Practice. This is STEP.',
    intro: `The first two weeks were inner work: coming back to the body and staying there. This week it goes outward, into your actual conversations. This is the week you feel it change something in real life.`,
    video: videoPlaceholder('The third option'),
    teaching: `
<h3>Still, Tune in to the Trade, Expand Options, Practice</h3>
<p>The order matters. You restore contact with yourself first, then you renegotiate the terms with the world. Otherwise you're just running the old performance with better language.</p>
<h4>S. Still</h4>
<p>Under pressure you either push harder or abandon yourself. Still is the pause before either one. It's a short version of everything from the first two weeks: a few breaths, a quick check of what's happening in your body, enough to stop the reflex from driving. You're not stepping away from the person in front of you. You're stepping out of the reflex. A quiet sentence that helps: <em>I don't have to decide this right now.</em></p>
<h4>T. Tune in to the Trade</h4>
<p>This is where the old bind shows up. Part of you wants to stay connected. Another part knows you're about to lose yourself to do it. Name the trade. Ask: <em>what am I about to give up to stay safe or approved of right now? My honesty? My need? My time? My self-respect?</em> Just naming it takes it out of the automatic.</p>
<h4>E. Expand Options</h4>
<p>Stress tells you it's fight or fold. When you've made contact, the view widens and you find it was never only those two. Look for the move that doesn't attack and doesn't abandon you. You can pause. You can ask a question. You can name what's true without escalating. That's the third option: staying connected without selling yourself out.</p>
<h4>P. Practice</h4>
<p>The old contract taught you to keep the signal silent to keep the bond. Practice reverses it. You put into words what your body has been telling you all along. One honest sentence. One boundary. One request. "I'm not ready to agree yet, I need a minute." "I'd rather name this than dance around it." Small and true beats big and strategic.</p>
<p>And you will miss it. Often you'll notice only after you've already reacted. That still counts. These aren't rules to get right. They're a rough map you get better at reading with reps.</p>
<p class="note">You now have both halves: SENSE to come home to yourself, STEP to bring that home into the room. Practiced on ordinary moments. That's the whole toolkit.</p>`,
    meditation: meditationPlaceholder('Rehearsing the Third Option', 11),
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
<li>The two options the trap offered you. Fight or fold, in your own words.</li>
<li>The trade. What would the easy door have cost you?</li>
<li>The third option, even if you only see it now, in hindsight. What could staying-with-yourself-and-them have looked like?</li>
<li>The one small honest thing you did, or could still do. Write the actual sentence.</li>
</ol>
<p class="note">A few paragraphs is plenty. You're getting reps, not writing an essay. If a situation feels too loaded to work alone, that's a good thing to bring to your closing session.</p>`,
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
<p>STEP is the outer half. Still, so the reflex doesn't drive. Tune in to the trade, so you see what you were about to give away. Expand the options, so it's not just fight or fold. Practice, one honest step. That's how you bring the home you found into your relationships.</p>
<h4>What you've been brushing against</h4>
<p>When you stay with a sensation and it softens into something more tender, you're meeting the edge of what the book calls the sacred wound. It's the imprint of all the times you contorted yourself to belong. The reflex to perform, the tightness, the inner critic, those are protectors. They formed around that tender place to keep it safe. They are not your defects. They were your survival, and often they became your gifts.</p>
<p>The deeper work is turning toward that wound with the kindness it never got, so the protectors don't have to work so hard. That's not a straightaway. It's not something to do alone at your kitchen table, and this course didn't ask you to. But it's the real doorway, and you've been standing near it all month. As the book puts it: the ache you've been running from isn't the problem. It's the signal, and it's the way back.</p>
<p class="note">This week, just live the arc. Notice the protectors with a little more kindness. That's the whole assignment.</p>`,
    meditation: meditationPlaceholder('A Kindness Toward the One Who Carried It', 12),
    practiceCard: `
<h4>Most days this week</h4>
<p>Sit with whichever practice from the month served you most. Choosing the one you need is itself part of the practice now. Miss a day, begin again the next.</p>
<h4>The whole arc, in two minutes</h4>
<p><strong>SENSE:</strong> slow the breath, enter the body, name it, stay with it, stop bracing.<br>
<strong>STEP:</strong> still, tune in to the trade, expand the options, one honest step.</p>
<h4>After the four weeks</h4>
<p>You don't need an app or a course to keep this. Three straw breaths and one honest sentence is the whole practice, portable, any time. Come back to the audios whenever you want. They're yours.</p>
<h4>How you'll know it's time for the deeper work</h4>
<p>When the same tender thing keeps showing up under the protector and staying with it alone starts to feel like more than a straightaway. When you want company for it. That's not a setback. That's the doorway, and it's what your closing session is for.</p>
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
<p class="note">Bring this to your closing session. You don't have to write it up neatly. A few honest notes are exactly right.</p>`,
    closing: `
<h3>Let's Talk</h3>
<p>You made it through. However much of it you did, whatever stuck and whatever didn't, you spent four weeks turning toward yourself instead of away.</p>
<p>Now Chad would like to talk with you. One conversation, just the two of you: what this month stirred up, what got easier, and what you touched that might be asking for more room. If it seems right, he'll tell you honestly what it looks like to keep going deeper together. If it's not the right time, he'll tell you that too. There's no pitch. It's a real conversation about where you are.</p>
<div class="placeholder">Booking link for the closing session goes here (Chad's scheduling page). Bring your notes from the reflection above.</div>`,
  },
};

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
<title>${c.title} | Mind/Body Foundations On-Ramp</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
:root{--cream:#F4EDE4;--paper:#FBF7F0;--ink:#352515;--gold:#8B6B1E;--line:#D7C7B3;--soft:#EFE6D8;--danger:#8E2F27}
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
.field input{width:100%;border:1px solid #BCA88E;border-radius:10px;background:#FFFDF9;color:var(--ink);padding:13px 14px;font:16px/1.4 Arial,sans-serif}
.error{color:var(--danger);font:600 14px/1.4 Arial,sans-serif;margin-top:10px}
.hidden{display:none!important}
.nav{display:flex;justify-content:space-between;font:14px/1.4 Arial,sans-serif;margin:18px 0}
.nav a{color:var(--gold)}
.crumbs{font:13px/1.4 Arial,sans-serif;color:#78644F;margin:0 0 16px}
.crumbs a{color:var(--gold);text-decoration:none}
.footer{text-align:center;margin:26px auto 0;color:#78644F;font:13px/1.5 Arial,sans-serif}
ol li{margin-bottom:8px}
</style>
</head>
<body>
<main class="shell">
  <nav class="crumbs"><a href="${COURSE_PATH}">On-Ramp</a> &rsaquo; <span>Week ${weekNum}</span></nav>
  <div class="eyebrow">Mind/Body Foundations On-Ramp</div>
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
    <p>Once a day, bring one real moment to the practice companion. It writes back, tracks what you say, and walks the week's moves with you. Your access code works there too.</p>
    <p><a class="button" href="${companion.pagePath}">Open this week's companion</a></p>
  </section>
  <section class="card"><div class="eyebrow" style="text-align:left">Practice card</div>${c.practiceCard}</section>
  <section class="card"><div class="eyebrow" style="text-align:left">Journal</div>${c.journal}</section>
  ${closing}`;
}

function enrollSection() {
  const p = paypalConfig();
  return `<div id="enroll">
<p><strong>Enroll yourself:</strong> $${p.priceUsd} once, via PayPal or card. Your personal access code appears the moment payment completes. Save it somewhere safe; it is your key to all four weeks and the practice companion.</p>
<div id="paypalButtons"></div>
<div id="enrollDone" style="display:none;background:#EFE6D8;border-left:3px solid #8B6B1E;padding:16px 18px;margin-top:14px">
<p style="margin:0 0 8px"><strong>You're in.</strong> Your access code:</p>
<p id="issuedCode" style="font-size:24px;font-family:monospace;margin:0 0 8px"></p>
<p style="margin:0" class="small">Write it down or screenshot it now; it is shown only once and cannot be looked up later. Then open <a href="${COURSE_PATH}/week-1">Week 1</a>.</p>
</div>
<div id="enrollError" class="small" style="display:none;color:#8E2F27"></div>
<script src="${p.sdkBase}?client-id=${encodeURIComponent(p.clientId)}&currency=USD"></script>
<script>
paypal.Buttons({
  createOrder: function(){
    return fetch('${COURSE_PATH}/api/paypal/create-order', {method:'POST'}).then(function(r){
      if (!r.ok) throw new Error('Could not start checkout');
      return r.json();
    }).then(function(d){ return d.orderId; });
  },
  onApprove: function(data){
    return fetch('${COURSE_PATH}/api/paypal/capture', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({orderId: data.orderID})
    }).then(function(r){ return r.json().then(function(d){ return {ok: r.ok, d: d}; }); })
    .then(function(res){
      if (!res.ok || !res.d.accessCode) throw new Error(res.d.error || 'Payment could not be confirmed');
      document.getElementById('issuedCode').textContent = res.d.accessCode;
      document.getElementById('enrollDone').style.display = 'block';
      document.getElementById('paypalButtons').style.display = 'none';
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
<title>Mind/Body Foundations On-Ramp | Herst Wellness</title>
<style>body{margin:0 auto;max-width:700px;padding:44px 24px 80px;background:#F4EDE4;color:#352515;font-family:Georgia,serif;font-size:19px;line-height:1.6}h1{font-size:32px;margin-bottom:4px}.sub{font-style:italic;color:#6F5438}a{color:#8B6B1E}li{margin-bottom:16px}.small{font-size:14px;color:#715D49;font-family:Arial,sans-serif}.card{background:#FBF7F0;border:1px solid #D7C7B3;border-radius:14px;padding:22px 24px;margin:20px 0}</style>
</head>
<body>
<h1>The Mind/Body Foundations On-Ramp</h1>
<p class="sub">Four weeks that turn the maps from The Performance Trap into muscle memory.</p>
<div class="card">
<p>You read the book, so you have the maps: SENSE for coming back to yourself when the pressure hits, STEP for bringing that back into the room with other people. This course is where the maps become practice. About ten minutes a day, one real moment a day, four weeks, and a closing conversation with Chad at the end.</p>
${selfServeEnabled() ? enrollSection() : '<p>Enrollment is personal: Chad sets you up directly and sends your access code. If you don\'t have one yet, reach out through <a href="https://herstwellness.com">herstwellness.com</a>.</p>'}
</div>
<h2 style="font-size:20px">The four weeks</h2>
<ul>
      ${rows}
</ul>
<p class="small">Herst Wellness. This is a guided practice for adults, not therapy, medical care, diagnosis, or crisis support.</p>
</body>
</html>`;
}

async function handleCourseRoute(req, res) {
  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/paypal/create-order') {
    if (!selfServeEnabled()) { sendJson(res, 503, { error: 'Self-serve enrollment is not enabled.' }); return true; }
    try {
      sendJson(res, 200, { orderId: await paypalCreateOrder() });
    } catch {
      sendJson(res, 502, { error: 'Could not start checkout.' });
    }
    return true;
  }
  if (req.method === 'POST' && req.url === COURSE_PATH + '/api/paypal/capture') {
    if (!selfServeEnabled()) { sendJson(res, 503, { error: 'Self-serve enrollment is not enabled.' }); return true; }
    try {
      const body = await readJsonBody(req);
      if (!body.orderId || typeof body.orderId !== 'string') { sendJson(res, 400, { error: 'Missing order.' }); return true; }
      const result = await paypalCaptureOrder(body.orderId);
      if (!result.completed) { sendJson(res, 402, { error: 'Payment was not completed.' }); return true; }
      sendJson(res, 200, { accessCode: issueSignedCode() });
    } catch {
      sendJson(res, 502, { error: 'Payment could not be confirmed.' });
    }
    return true;
  }

  if (req.method !== 'GET') return false;

  if (req.url === COURSE_PATH) {
    res.writeHead(200, noStoreHeaders('text/html; charset=utf-8'));
    res.end(overviewPage());
    return true;
  }

  const pageMatch = req.url.match(/^\/course\/on-ramp\/week-([1-4])$/);
  if (pageMatch) {
    res.writeHead(200, {
      ...noStoreHeaders('text/html; charset=utf-8'),
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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

module.exports = { COURSE_PATH, COURSE_WEEKS, handleCourseRoute, lessonContentHtml };
