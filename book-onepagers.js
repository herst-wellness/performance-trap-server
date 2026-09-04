// The five book-bonus one-pagers, pulled verbatim from the "Try This"
// sections of the book's five Part Two chapters. No paraphrase: every word
// in whereFits / whenHits / steps is copied from the chapter PDFs.
// The "If You Lead, Coach, or Support Others" sections are left out on
// purpose -- the book-bonus page promises these are "for the moment itself,
// not for study."

const ONE_PAGERS = [
  {
    slug: 'overwhelm',
    chapter: 'Chapter Ten',
    title: 'Overwhelm',
    whereFits: "This is the first step in SENSE. It’s what you do when you can feel the overwhelm taking over. You’re not trying to fix the situation yet. You’re just settling your system enough to see what’s actually happening.",
    whenHits: "It usually doesn’t start with a clear thought. It starts in the body. Your chest tightens. Your breath shortens. Your vision narrows. The mind wants to fix it, but that only makes things worse. You’re not just overwhelmed by the situation. You’re overwhelmed that you’re overwhelmed.",
    steps: [
      { letter: 'S', name: 'Slow the Breath', body: "Start with the breath. Slow it down. This is your anchor. Use the straw breath to interrupt the panic. Inhale through the nose, then purse your lips like you’re blowing out through a straw, and exhale slowly. If it helps, count it out: five in, seven out. You’re signaling your nervous system that you’re safe, even if the deadline is still there." },
      { letter: 'E', name: 'Enter the Body', body: "Get out of the story and into the physical sensations. Shift your attention to your lower ribs and upper belly region. Picture your diaphragm like a small parachute, expanding on the inhale and floating back up on the exhale. Give your mind this one physical job, so it stops spinning." },
      { letter: 'N', name: 'Name the Quality', body: "Once the breath settles a little, name what you’re noticing. Is your chest still tight? Is your stomach in knots? Just name the quality. Tight. Heavy. Buzzing. You’re still not fixing anything. You’re acknowledging what’s happening in there, so you don’t have to fight it." },
      { letter: 'S', name: 'Stay', body: "Let the counting go and let your breath find its natural rhythm. Don’t go back into the problem yet. Just stay with the rise and fall of the breath for ten more breaths, offering this feeling your steady attention. You aren’t trying to make the overwhelm go away. You’re waiting for the signal to be received." },
      { letter: 'E', name: 'Equanimity', body: "When you stop fighting the overwhelm, you might notice the physical sensation gets louder for a moment. That’s okay. Widen your attention to make room for it. Don’t try to solve the tightness. Don’t try to breathe it away. Watch the sensation shift into heat or tingling. You’re not trying to force the water to be still; you’re building the capacity to hold the wave." },
    ],
  },
  {
    slug: 'inner-critic',
    chapter: 'Chapter Eleven',
    title: 'The Inner Critic',
    whereFits: "You’ve already grounded yourself with the breath. Now the next step in SENSE is getting out of your head and into direct contact with what’s actually happening on the inside. At this point, insight isn’t what helps. It’s precision that helps. Presence that helps. You aren’t trying to argue with the critic. You’re trying to change your relationship with it.",
    whenHits: "It doesn’t show up with a name tag saying, “Hi, I’m the Inner Critic.” It just feels like the truth. It feels like you really are behind, broken, or about to be exposed as not as confident as people think. The instinct is to fight it, argue with it, or work harder to appease it. But the goal isn’t to silence the voice. The goal is to create separation from the voice, to stay in the body, and keep contact with what’s happening without getting completely identified with what it’s saying.",
    steps: [
      { letter: 'S', name: 'Slow the breath', body: "Start by slowing the breath. If you did the Overwhelm “Try This,” it’s the same move here. The Inner Critic runs on speed. It wants you to react, explain, fix, and prove. Before you engage with any of that, you need to steady yourself. You need a little space between you and that voice. Take at least three deliberate breaths. Inhale slowly. Exhale even slower. You aren’t trying to relax. You’re interrupting the reflex to believe what it’s saying." },
      { letter: 'E', name: 'Enter the body', body: "Don’t debate the critic. Don’t answer it. Just drop the story and go straight into sensation. There’s often a mirror reflection between what the critic is saying and what’s happening inside your body. See if you can locate it. Look in the throat, the chest, the belly. Notice where it lands. If you don’t find it in one clear spot, soften your awareness to include the body as a whole, and see if you can sense the overarching tone throughout. You’re not analyzing. You’re locating how the critic’s message is showing up in your body." },
      { letter: 'N', name: 'Name it', body: "Then name the quality, not the story. The quality: tight, heavy, hot, numb, buzzing, foggy, shut down, unsafe. Give it a simple label. That naming is what helps you get a little more separation from it. It reminds you that you’re the one noticing the feeling, not the feeling itself." },
      { letter: 'S', name: 'Stay with it', body: "Once you’ve named what’s happening in your body, stay with it. No story or fixing. This is the U-turn from the narrative in your head to the sensation in your body. The critic wants a solution. The body asks for contact. Tightness doesn’t need a solution right now. It needs to be felt. You might drop a question into the body: What are you trying to prevent? What do you not want to happen? Then wait for it to respond." },
      { letter: 'E', name: 'Equanimity', body: "The critic wants you to contract, to shrink away from the shame or the fear. Equanimity is the refusal to shrink. It’s the act of widening the container. If the shame feels hot, let it be hot. If your stomach drops, let it drop. Don’t try to solve the situation, and don’t see if the charge is draining yet. This part doesn’t want to be solved. It’s asking to be allowed. You’re building the capacity to feel the verdict hitting your body without believing the story it’s telling you." },
    ],
  },
  {
    slug: 'emptiness',
    chapter: 'Chapter Twelve',
    title: 'Emptiness',
    whereFits: "When everything settles, and the emptiness is still there, try this. You’ve already slowed the breath. You’ve already made contact with the sensation in the body. Now the next step is staying. And I want to be clear about what I mean by that. You don’t need to analyze what you’re feeling. You don’t need to understand where it came from. You don’t need to figure out how to fix it. You’re learning how to stay with it long enough for your system to register: I’m not alone in here anymore. Because that’s what emptiness really is. It’s not the absence of feeling. It’s feeling numb, alone, and disconnected from yourself all at the same time.",
    whenHits: "On the outside, everything is working. The life is built. The pressure is off. And still, you feel flat in the body. It can feel like a numbness that makes even good things feel distant. The instinct is to override it or go looking for a reason you feel that way. But the shift starts when you stop trying to solve it and instead turn toward it.",
    steps: [
      { letter: 'S-E-N', name: 'Slow, Enter, Name', body: "Start with the first three moves you’ve practiced: Slow the breath, Enter the body, and Name the quality. In the state of emptiness, this can feel counterintuitive because there isn’t a loud sensation screaming for attention." },
      { letter: 'S', name: 'Stay', body: "This is the move that’s hardest to make. The mind will go, Okay, great, how do we fix this? But that question is the same escape hatch, just dressed up as problem-solving. Instead, stay with the sensation for a few breaths. Don’t fight it. Don’t try to get rid of it. Just keep contact with it. You’re waiting for the receiver to come back online." },
      { letter: 'E', name: 'Equanimity', body: "Often, when we stop running, we hit a wall of numbness. The mind says, “I feel nothing, I’m stuck.” Equanimity here means keeping the numbness company. Don’t try to force a feeling. Offer it steady attention. Just sit next to the blankness. Is it heavy? Is it gray? Is it static? Treat the numbness as a valid guest rather than a problem to solve." },
      { letter: '', name: 'Go Deeper', body: "If you want to go one layer deeper, ask: Who’s the one still carrying all of this? Don’t rush the answer. Just notice what happens when you ask it. A lot of the time, the feeling shifts from something is wrong with me to there’s a younger part of me in here that hasn’t been met. And that’s the whole point. You’re not trying to erase the emptiness. You’re trying to stop abandoning yourself inside of it." },
    ],
  },
  {
    slug: 'self-abandonment',
    chapter: 'Chapter Thirteen',
    title: 'Self-Abandonment',
    whereFits: "SENSE is how you stop overriding the implicit channel. It repairs the relationship with yourself by listening to the signals you learned to ignore: the freeze, the sting, the tightening. STEP is how you take that inner repair into the world to revise the old contract. The double bind traps you in a binary. You feel you must either dominate the moment or disappear to keep the peace. STEP creates a third option. It allows you to stay in relationship with the other person without leaving yourself behind.",
    whenHits: "It often hits right after a sharp message, like a text, a comment, or a look, and the reflex kicks in fast. You either want to defend yourself, or you want to take full responsibility just to make the tension stop. You feel the urge to fix the dynamic immediately, even if it means swallowing what you actually feel. That is the moment this is for.",
    steps: [
      { letter: 'S', name: 'Still', body: "Put the phone down. Not forever, but just for a beat. Don’t explain yet. Don’t write the paragraph. Don’t rush into fix-it mode, because when that critique lands, the body often freezes or it starts sprinting. It wants to do something right now so the discomfort goes away. Instead, you interrupt that. You take one breath, just one, and remind yourself: I don’t need to fix this right now. If the urgency feels unbearable, name it for what it is: a protector, a part of you trying to earn safety by being quick, competent, or agreeable. Then take another breath." },
      { letter: 'T', name: 'Tune In to the Trade', body: "Ask yourself: What’s the cost of this trade? What am I giving up right now to keep the peace? This forces the hidden contract into view. You aren’t just deciding what to do. You’re acknowledging that the price of being easy is your own reality." },
      { letter: 'E', name: 'Expand Options', body: "Stress creates a binary. Either you fight, defend, attack, or you submit. Maybe you cave in or try to fix it. Expand Options means finding the third option that’s neither. For example, you don’t have to explain yourself or attack them. You can say, “I need to think about that.” You’re refusing to let the binary drive the bus." },
      { letter: 'P', name: 'Practice', body: "Speak the implicit. The double bind trained you to live in a split. You feel the no in your body, which is the implicit channel, but you act out the yes to keep the peace. That’s the explicit channel. Practice is the act of ending that split. It isn’t just about changing your behavior. It’s about verbalizing the reality your body already knows. Until you speak the implicit truth out loud, the trap stays in place. You might say, “I’ve thought about it, and I’m not willing to take that on,” or “I notice I’m rushing to fix this, and I need to pause,” or “I can own my part, but I’m not going to carry the weight for both of us.” The goal isn’t to win a fight. It’s to break the silence. You’re taking the truth of your nervous system and finally bringing it into the relationship." },
    ],
  },
  {
    slug: 'pressure-to-perform',
    chapter: 'Chapter Fourteen',
    title: 'The Pressure to Perform',
    whereFits: "This is for that specific moment when the email lands, the stage lights go on, or the opportunity feels like a threat. In that split second, the trap narrows your world down to two bad options. Either you force it, or you pull back.",
    whenHits: "The instinct is to tighten up, push harder, and hope your body cooperates. You override the signal to get the outcome. But the shift happens when you stop overriding and actually listen to what your body is telling you.",
    steps: [
      { letter: 'S', name: 'Still', body: "When the pressure to perform hits, your body treats the deadline like a threat. It says, If I don’t do this right now, I’m not going to be safe. Still is the moment you catch that and interrupt it. This isn’t just put the phone down. It’s refusing to let the doer take over. It’s choosing a pause before you act, so you can feel what’s happening in your body and stop the automatic override. You’re proving to your nervous system that you can be here without rushing, without performing, and without making a promise you can’t keep." },
      { letter: 'T', name: 'Tune In to the Trade', body: "In that stillness, look at the deal on the table. The performance trap asks you to treat your body as secondary. The bargain is simple. You give up your vitality, your aliveness, in exchange for approval, momentum, or control. Ask yourself: What am I about to sacrifice to make this happen? Scan the body. Buzzing in the legs, a rigid band around the ribs, heat, tightness? That’s not just nerves. That’s the early cost showing up. Name the transaction. If you do it this way, what does it cost you physically? And can you afford that cost right now?" },
      { letter: 'E', name: 'Expand Options', body: "Stress creates a binary. It says you only have two options. Push through and burn out, or quit and fail. Expand options is where you find the third choice. Action without hiding. Ask yourself: Is there a way to do this work without overriding my body? Can you do the task without the tension? Can you give the presentation without pretending you aren’t nervous? Can you send the email as a person rather than as a professional? You’re looking for the move that allows you to stay in the relationship without leaving yourself behind." },
      { letter: 'P', name: 'Practice', body: "Take one small action from that new place. The old habit relied on you hiding your stress. Practice reverses that by saying what’s actually true. It might be by saying, “I need a minute to think about this,” instead of an automatic yes. It might be admitting “I’m feeling a little tense about this launch,” instead of acting like you have it all under control. The goal isn’t to be perfect. The goal is to stop hiding the effort it takes to be you." },
    ],
  },
];

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function onePagerCardHtml(page) {
  const stepsHtml = page.steps.map((s) => {
    const label = s.letter ? `${escapeHtml(s.letter)}. ${escapeHtml(s.name)}` : escapeHtml(s.name);
    return `<li><strong>${label}:</strong> ${escapeHtml(s.body)}</li>`;
  }).join('\n      ');

  return `  <div class="card onepager">
    <p class="small" style="margin:0 0 4px">${escapeHtml(page.chapter)}</p>
    <h2 style="margin-top:0">${escapeHtml(page.title)}</h2>
    <p><strong>Where this fits:</strong> ${escapeHtml(page.whereFits)}</p>
    <p><strong>When it shows up:</strong> ${escapeHtml(page.whenHits)}</p>
    <p><strong>Try it now:</strong></p>
    <ol>
      ${stepsHtml}
    </ol>
  </div>`;
}

const ONE_PAGER_BY_SLUG = Object.fromEntries(ONE_PAGERS.map((p) => [p.slug, p]));

// headExtra is injected verbatim into <head>. The caller owns it: book-bonus.js
// passes the Google tag plus the inline config script carrying that request's
// nonce, so the one-pagers are measured the same way the page above them is.
function onePagerPageHtml(page, headExtra = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(page.title)}: the one-pager | The Performance Trap</title>
${headExtra}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
:root{--cream:#F4EDE4;--paper:#FBF7F0;--ink:#352515;--gold:#8B6B1E;--line:#D7C7B3;--soft:#EFE6D8}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;line-height:1.6}
.shell{width:min(680px,calc(100% - 28px));margin:0 auto;padding:32px 0 80px}
h1{font-family:'Playfair Display',Georgia,serif;font-size:clamp(28px,5vw,38px);margin:0 0 4px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:26px 28px;margin:20px 0}
.small{font:14px/1.5 Arial,sans-serif;color:#715D49}
a{color:var(--gold)}
.crumb{font:14px/1.5 Arial,sans-serif;color:#715D49;margin:0 0 18px}
ol{margin:0;padding-left:22px}
ol li{margin-bottom:12px}
.footer{text-align:center;margin:26px auto 0;color:#78644F;font:13px/1.5 Arial,sans-serif}
</style>
</head>
<body>
<main class="shell">
  <p class="crumb"><a href="/book-bonus">The practices, in one place</a> &rsaquo; ${escapeHtml(page.title)}</p>
  <p class="small" style="margin:0 0 4px">${escapeHtml(page.chapter)}</p>
  <h1>${escapeHtml(page.title)}</h1>
  <div class="card">
    <p><strong>Where this fits:</strong> ${escapeHtml(page.whereFits)}</p>
    <p><strong>When it shows up:</strong> ${escapeHtml(page.whenHits)}</p>
    <p><strong>Try it now:</strong></p>
    <ol>
      ${page.steps.map((s) => {
        const label = s.letter ? `${escapeHtml(s.letter)}. ${escapeHtml(s.name)}` : escapeHtml(s.name);
        return `<li><strong>${label}:</strong> ${escapeHtml(s.body)}</li>`;
      }).join('\n      ')}
    </ol>
  </div>
  <p class="small"><a href="/book-bonus">&larr; Back to the practices</a></p>
</main>
</body>
</html>`;
}

module.exports = { ONE_PAGERS, ONE_PAGER_BY_SLUG, onePagerCardHtml, onePagerPageHtml, escapeHtml };
