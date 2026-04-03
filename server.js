const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAILCHIMP_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_LIST_ID = process.env.MAILCHIMP_LIST_ID;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER_PREFIX || 'us6';

// LOGO URL (served as static file from /public)
const BASE_URL = 'https://performance-trap-server.onrender.com';
const LOGO_URL = BASE_URL + '/Herst-Wellness-Logo-cropped.jpg';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

// STATIC FILE SERVING
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.js': 'text/javascript',
};

function serveStatic(req, res) {
  const publicDir = path.join(__dirname, 'public');
  const filePath = path.join(publicDir, req.url);
  if (!filePath.startsWith(publicDir)) return false;
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  } catch {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': data.length,
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(data);
  return true;
}

// VSOP87 TRUNCATED EPHEMERIS
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const md = x => ((x % 360) + 360) % 360;
const SGN = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

function jd(y, m, d, h) {
  let Y = y, M = m, D = d + h / 24;
  if (M <= 2) {
    Y--;
    M += 12;
  }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + D + B - 1524.5;
}

function sunLon(T) {
  const L0 = md(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = md(357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
    + 0.000289 * Math.sin(3 * M);
  const sunTrue = L0 + C;
  const omega = md(125.04 - 1934.136 * T) * D2R;
  return md(sunTrue - 0.00569 - 0.00478 * Math.sin(omega));
}

function moonLon(T) {
  const Lp = md(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  const D = md(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T) * D2R;
  const M = md(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T) * D2R;
  const Mp = md(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T) * D2R;
  const F = md(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T) * D2R;
  let s = 0;
  [
    [6.288774, [0, 0, 1, 0]],
    [1.274027, [2, 0, -1, 0]],
    [0.658314, [2, 0, 0, 0]],
    [0.213618, [0, 0, 2, 0]],
    [-0.185116, [0, 1, 0, 0]],
    [-0.114332, [0, 0, 0, 2]],
    [0.058793, [2, 0, -2, 0]],
    [0.057066, [2, -1, -1, 0]],
    [0.053322, [2, 0, 1, 0]],
    [0.045758, [2, -1, 0, 0]],
    [-0.040923, [0, 1, -1, 0]],
    [-0.03472, [1, 0, 0, 0]],
    [-0.030383, [0, 1, 1, 0]],
    [0.015327, [2, 0, 0, -2]],
    [0.01098, [0, 0, 1, -2]],
    [0.010675, [4, 0, -1, 0]],
    [0.010034, [0, 0, 3, 0]],
    [0.008548, [4, 0, -2, 0]],
    [-0.007888, [2, 1, -1, 0]],
    [-0.006766, [2, 1, 0, 0]],
    [-0.005163, [1, 0, -1, 0]],
    [0.004987, [1, 1, 0, 0]],
    [0.004036, [2, -1, 1, 0]],
    [0.003994, [2, 0, 3, 0]],
  ].forEach(([a, [dD, dM, dMp, dF]]) => {
    s += a * Math.sin(dD * D + dM * M + dMp * Mp + dF * F);
  });
  return md(Lp + s);
}

function planetHelio(planet, T) {
  const el = {
    mercury: {
      L: [252.250906, 149474.0722491, 0.0003035, 0.000000018],
      e: [0.20563175, 0.000020406, -0.0000000284, -0.00000000017],
      w: [77.45645, 0.1600388, 0.00046975, 0.00000056]
    },
    venus: {
      L: [181.979801, 58519.2130302, 0.00031014, 0.000000015],
      e: [0.00677188, -0.000047766, 0.0000000975, 0.00000000044],
      w: [131.563707, 1.4022188, -0.00107377, -0.000005765]
    },
    earth: {
      L: [100.466456, 36000.7698278, 0.00030322, 0.00000002],
      e: [0.01670862, -0.000042037, -0.0000001236, 0.00000000004],
      w: [102.937348, 1.7195269, 0.00045962, 0.000000499]
    },
    mars: {
      L: [355.433275, 19141.6964746, 0.00031097, 0.000000015],
      e: [0.09340062, 0.000090483, -0.0000000806, -0.00000000035],
      w: [336.060234, 1.8410449, 0.00013477, 0.000000536]
    },
    jupiter: {
      L: [34.351484, 3036.3027748, 0.0002233, 0.000000037],
      e: [0.04849485, 0.000163244, -0.0000004719, -0.00000000197],
      w: [14.331309, 1.612073, 0.001032, -0.00000427]
    },
    saturn: {
      L: [50.077444, 1223.5110686, 0.00051908, -0.00000003],
      e: [0.05550825, -0.000346641, -0.0000006452, 0.00000000638],
      w: [93.056787, 1.9637694, 0.00083757, 0.000004899]
    },
    uranus: {
      L: [314.055005, 429.8640561, 0.00030434, 0.000000026],
      e: [0.0462959, -0.000027337, 0.000000079, 0.000000000025],
      w: [173.005159, 1.4863784, 0.0002145, 0.000000433]
    },
    neptune: {
      L: [304.348665, 219.8833092, 0.00030926, 0.000000018],
      e: [0.00898809, 0.000006408, -0.0000000008],
      w: [48.123691, 1.4262677, 0.00037918, -0.000000003]
    },
    pluto: {
      L: [238.92903833, 145.20780515, 0.0],
      e: [0.2488273, 0.000006, 0.0],
      w: [224.06891629, 1.555029, 0.0]
    },
  };

  const p = el[planet];
  if (!p) return 0;

  const poly = coeffs => coeffs.reduce((sum, c, i) => sum + c * Math.pow(T, i), 0);
  const L = md(poly(p.L));
  const e = poly(p.e);
  const w = poly(p.w);
  const M = md(L - w);
  const Mrad = M * D2R;

  let E = Mrad;
  for (let i = 0; i < 50; i++) {
    const dE = (Mrad - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }

  const v = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2)
  ) * R2D;

  return md(v + w);
}

function helioToGeo(planetLon_h, planetDist, earthLon_h, earthDist) {
  const pl = planetLon_h * D2R;
  const el = earthLon_h * D2R;
  const x = planetDist * Math.cos(pl) - earthDist * Math.cos(el);
  const y = planetDist * Math.sin(pl) - earthDist * Math.sin(el);
  return md(Math.atan2(y, x) * R2D);
}

function helioRadius(planet, T) {
  const semi = {
    mercury: 0.387098, venus: 0.72333, earth: 1.000001, mars: 1.523692,
    jupiter: 5.202603, saturn: 9.554909, uranus: 19.21845, neptune: 30.11039, pluto: 39.48
  };
  const ecc = {
    mercury: 0.20563, venus: 0.00677, earth: 0.01671, mars: 0.0934,
    jupiter: 0.04849, saturn: 0.05551, uranus: 0.0463, neptune: 0.00899, pluto: 0.24883
  };
  const a = semi[planet] || 1;
  const e = ecc[planet] || 0;
  return a * (1 - e * e / 2);
}

function nnLon(T) {
  return md(125.04452 - 1934.136261 * T + 0.0020708 * T * T);
}

function chironLon(T) {
  const jd_val = T * 36525 + 2451545;
  const a = 13.633;
  const e = 0.3787;
  const n = 360 / (50.7 * 365.25);
  const t_peri = 2450128;
  const M = md(n * (jd_val - t_peri));
  const Mrad = M * D2R;
  let E = Mrad;
  for (let i = 0; i < 50; i++) {
    const dE = (Mrad - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  const v = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2)
  ) * R2D;
  const w_peri = 185.11;
  const hLon = md(v + w_peri);
  const earthLon = planetHelio('earth', T);
  const earthR = helioRadius('earth', T);
  const chironR = a * (1 - e * Math.cos(E));
  return helioToGeo(hLon, chironR, earthLon, earthR);
}

function isRetrograde(planet, T, dt = 0.5) {
  if (planet === 'sun' || planet === 'moon') return false;
  const before = calcGeoLon(planet, T - dt / 36525);
  const after = calcGeoLon(planet, T + dt / 36525);
  let diff = after - before;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff < 0;
}

function calcGeoLon(planet, T) {
  if (planet === 'sun') return sunLon(T);
  if (planet === 'moon') return moonLon(T);
  if (planet === 'node') return nnLon(T);
  if (planet === 'chiron') return chironLon(T);
  const hLon = planetHelio(planet, T);
  const earthLon = planetHelio('earth', T);
  const earthR = helioRadius('earth', T);
  const pR = helioRadius(planet, T);
  return helioToGeo(hLon, pR, earthLon, earthR);
}

function calcAllPlanets(T) {
  const planets = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'node', 'chiron'];
  const result = {};
  for (const p of planets) {
    const lon = calcGeoLon(p, T);
    const retro = (p !== 'sun' && p !== 'moon' && p !== 'node') ? isRetrograde(p, T) : false;
    result[p] = { lon, retrograde: retro };
  }
  return result;
}

function toSign(lon) {
  const l = md(lon);
  return { sign: SGN[Math.floor(l / 30)], deg: Math.floor(l % 30), lon: l };
}

function wsh(lon, ascIdx) {
  return ((Math.floor(md(lon) / 30) - ascIdx + 12) % 12) + 1;
}

function calcAsc(jdVal, lat, lon) {
  const T = (jdVal - 2451545) / 36525;
  const eps = (23.4392911 - 0.013004167 * T) * D2R;
  const J0 = Math.floor(jdVal - 0.5) + 0.5;
  const T0 = (J0 - 2451545) / 36525;
  const gmst = md(100.4606184 + 36000.7700536 * T0 + 360.98564724 * (jdVal - J0));
  const LMST = md(gmst + lon);
  const RAMC = LMST * D2R;
  const latR = lat * D2R;
  const cosRAMC = Math.cos(RAMC);
  const sinRAMC = Math.sin(RAMC);
  const cosEps = Math.cos(eps);
  const sinEps = Math.sin(eps);
  const tanLat = Math.tan(latR);
  return md(Math.atan2(cosRAMC, -(sinRAMC * cosEps + tanLat * sinEps)) * R2D);
}

function calcMC(jdVal, lon) {
  const T = (jdVal - 2451545) / 36525;
  const eps = (23.4392911 - 0.013004167 * T) * D2R;
  const J0 = Math.floor(jdVal - 0.5) + 0.5;
  const T0 = (J0 - 2451545) / 36525;
  const gmst = md(100.4606184 + 36000.7700536 * T0 + 360.98564724 * (jdVal - J0));
  const LMST = md(gmst + lon);
  const RAMC = LMST * D2R;
  return md(Math.atan2(Math.tan(RAMC), Math.cos(eps)) * R2D);
}

function buildChart(ds, ts, tz, lat, lon) {
  const [y, m, d] = ds.split('-').map(Number);
  const [h, mn] = ts.split(':').map(Number);
  let u = h + mn / 60 - tz;
  let dd = d;
  let mm = m;
  let yy = y;
  if (u < 0) {
    u += 24;
    dd--;
  }
  if (u >= 24) {
    u -= 24;
    dd++;
  }

  const jdVal = jd(yy, mm, dd, u);
  const T = (jdVal - 2451545) / 36525;
  const asc = calcAsc(jdVal, lat, lon);
  const ascIdx = Math.floor(asc / 30);
  const mc = calcMC(jdVal, lon);
  const planets = calcAllPlanets(T);

  const NAMES = {
    sun: 'Sun',
    moon: 'Moon',
    mercury: 'Mercury',
    venus: 'Venus',
    mars: 'Mars',
    jupiter: 'Jupiter',
    saturn: 'Saturn',
    uranus: 'Uranus',
    neptune: 'Neptune',
    pluto: 'Pluto',
    node: 'North Node',
    chiron: 'Chiron'
  };

  const chart = {};
  for (const [key, val] of Object.entries(planets)) {
    const s = toSign(val.lon);
    chart[NAMES[key]] = {
      sign: s.sign,
      deg: s.deg,
      lon: s.lon,
      house: wsh(val.lon, ascIdx),
      retrograde: val.retrograde
    };
  }

  chart.ASC = { ...toSign(asc), house: null, retrograde: false };
  chart.MC = { ...toSign(mc), house: null, retrograde: false };

  return chart;
}

function chartToText(chart, name) {
  const order = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'North Node', 'Chiron'];
  const lines = order.map(k => {
    const v = chart[k];
    if (!v) return '';
    const r = v.retrograde ? ' (R)' : '';
    return `${k}: ${v.sign} ${v.deg}°${r} · House ${v.house}`;
  }).filter(Boolean);

  lines.push(`ASC: ${chart.ASC.sign} ${chart.ASC.deg}° (Whole Sign Houses. ${chart.ASC.sign} is House 1)`);
  lines.push(`MC: ${chart.MC.sign} ${chart.MC.deg}°`);

  return `${name}'s Chart (Whole Sign Houses):\n${lines.join('\n')}`;
}

const SYS = `You are writing a natal chart reading through the Performance Trap Framework. Chad Herst's system. His voice.

VOICE
- Peer to peer. Direct. No mystic. No guru.
- Somatic when earned. Never spiritual.
- Short sentences. Hard stops.
- Clear over clever.
- Profanity only when it cuts through.
- Never call trauma a gift.
- Never romanticize the wound.
- State the truth and stop.
- Never use the word "gift."

CORE WRITING STANDARD
Trust the pattern. Do not perform. Write because it is the clearest truth, not because it sounds powerful.

The reading must feel:
- precise
- restrained
- personal
- chart-specific
- human
- believable

Do not write lines because they sound impressive.
Do not write lines because they sound therapeutic.
Do not write lines because they sound poetic.
Write them because they are the exact truth of this chart.

If a phrase sounds written rather than true, simplify it.

DO NOT WRITE
- inflated language
- generic therapy language
- branded-sounding phrases
- clever metaphors
- polished copywriting lines
- inspirational turns
- vague intensity language
- abstract coach-speak

BAD
- active knowing
- service wrapper
- translator of the untranslatable
- careful not-saying
- real connection handles real truth
- curious and electric
- wired for intensity

BETTER
- you saw what others avoided
- you learned to package it
- your seeing was welcome, your directness was not
- the pause between knowing and speaking is where you lose yourself
- you learned to read two things at once
- say it before you edit it

ABSOLUTE BAN: NO ASTROLOGY LABELS IN THE MAIN PROSE
Do NOT name:
- signs
- planets
- houses
- aspects
- chart ruler
- retrograde
- any astrology terms at all

That means:
- no Scorpio
- no Sagittarius
- no Gemini rising
- no Mercury
- no Mars retrograde
- no 7th house
- no chart language
- no "your chart shows"
- no "astrologically"
- no "this placement means"

The main prose must read entirely in plain human language.

The astrology belongs ONLY in the placements dropdown.

IMPORTANT DISTINCTION
Less astrology jargon.
More astrology logic.

The reader should feel the chart in the prose without seeing the chart language unless they open the dropdown.

SPECIFICITY RULE
Every section must contain 1 to 3 observations that could not have been written without this chart.

Do not write broad vibe language if the chart gives something more exact.

NARRATIVE RULE
This must read like one unfolding human story, not five adjacent portraits.

Each section must grow from the previous one.
Use cause and effect:
- so
- instead
- over time
- that's when
- from there
- because of that
- eventually

The reader should feel:
because this happened, this strategy formed
because this strategy formed, this cost developed
because that cost became painful, something began to surface
because that became visible, a new move is now possible

KEY TERMS
Each section must include exactly 3 key_terms.
They must be:
- 3 to 7 words each
- clean
- memorable
- natural when read aloud
- specific to this chart
- not clipped
- not slogan-like
- not abstract

Good style:
- sees underneath the surface
- too much too fast
- package the cutting truth
- pause before speaking
- tired of translating yourself
- say it before editing

SECTIONS

HOW YOUR PERFORMANCE TRAP FORMED

1. ESSENCE
Subtitle: The original signal

Definition:
What your nervous system reached for before it learned to stop reaching. The quality of contact your body expected before anything went wrong.

Function:
This section must stay PURELY original signal.
No adaptation here.
No usefulness.
No helping.
No room management.
No translation.
No packaging.

Essence is:
- what this system naturally wanted
- how it moved before distortion
- what kind of contact it expected
- what felt alive before the miss

2 to 3 short paragraphs.
End by setting up what went wrong.

2. THE MISS
Subtitle: What belonging required

Definition:
The gap between what you needed and what the environment could deliver. Not just the absence of attunement, but the presence of contradiction. One signal said come closer. Another said be careful. This is where misattunement and mixed messages meet.

Function:
This section must include BOTH:
- misattunement
- mixed messages / contradiction / confusion

The Miss is:
- what the environment did to the signal
- how the person was not met
- how the field became hard to trust
- what impossible relational rules got installed

Do not drift into adaptation yet.
This section is about what happened to the signal, not what the person did about it.

2 to 3 short paragraphs.
End by naming the impossible position.

3. THE PERFORMANCE
Subtitle: How you stayed connected

Definition:
The face you built for managing the room. A set of skills, responses, and offerings designed to keep the bond intact. Brilliant adaptation. Also the thing that's been eating you alive.

Function:
This is where adaptation lives.
The face.
The role.
The translation.
The override.

Show how the raw signal from Essence got converted into something relationally safer.

This section must include:
- the visible adaptation
- the inner mechanism that keeps it running
- the packaging of truth into something people can tolerate
- the split between direct signal and strategic delivery
- the brilliance and the cost

2 to 3 short paragraphs.
End by naming what it costs today.

YOUR WAY HOME

4. CONTACT
Subtitle: Meeting the protectors and the ache

Definition:
Awareness of both the protectors and the ache beneath them. The protectors are not separate from the ache. They are the adaptation built around it. Contact means being aware of both the strategy and the hurt beneath it.

The ache is the way home.

Function:
Make this immediate and embodied.
Show the split in real time.
Show the pause.
Show the calculation.
Show the body.
Show the cost.

2 to 3 short paragraphs.

5. A NEW RESPONSE
Subtitle: The move that changes things

Definition:
Not fight, not submit. A way of communicating that doesn't require you to leave yourself to stay connected.

Function:
This is NOT always say it raw.
This is NOT brutality.
This is NOT accommodation.

It is a cleaner response that does not require self-erasure.

Show:
- what changes in the moment of speaking
- what the person stops doing
- what a more honest response sounds like
- how truth can stay connected to relationship

1 to 2 short paragraphs.

UTTERANCE
Include one short sentence in the "utterance" field.
It should feel like something a real person could actually say.
Not a slogan. Not branded. Not therapy-speak. Not too polished.

BAD:
- I choose authenticity now
- I speak my truth
- here's what I'm actually seeing
- truth without self-erasure
- real connection handles real truth

BETTER:
- I need to say this straight.
- That doesn't line up for me.
- I'm not going to soften this first.
- Here's the part that feels true to me.
- This is what I'm noticing.
- I want to say this more directly.

CLOSING
3 to 5 sentences.
A real-life moment where something shifts.
Not redemptive.
Not neat.
Not inspirational.
Just a concrete scene where the old pattern is present and a new move becomes possible.

PLACEMENTS DROPDOWN RULES
Each section must include 2 to 4 placements in the "placements" array.

Each placement item must have:
- "name"
- "meaning"

Rules for "meaning":
- 1 short sentence only
- plain English
- exact, not padded
- directly supportive of the prose above
- no technical overflow
- no vague filler

CRITICAL:
The placements must match the prose exactly.
Do not pick placements just because they are nearby.
Pick the placements most directly shaping that specific section.

OUTPUT
Return ONLY valid JSON, nothing before or after:
{
  "sections": [
    {
      "title": "Essence",
      "subtitle": "The original signal",
      "content": "paragraphs",
      "key_terms": ["term", "term", "term"],
      "placements": [{"name": "placement", "meaning": "short"}]
    },
    {
      "title": "The miss",
      "subtitle": "What belonging required",
      "content": "paragraphs",
      "key_terms": ["term", "term", "term"],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "The performance",
      "subtitle": "How you stayed connected",
      "content": "paragraphs",
      "key_terms": ["term", "term", "term"],
      "placements": [{"name": "...", "meaning": "..."}]
    }
  ],
  "way_home": [
    {
      "title": "Contact",
      "subtitle": "Meeting the protectors and the ache",
      "content": "paragraphs",
      "key_terms": ["term", "term", "term"],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "A new response",
      "subtitle": "The move that changes things",
      "content": "paragraphs",
      "utterance": "One sentence",
      "key_terms": ["term", "term", "term"],
      "placements": [{"name": "...", "meaning": "..."}]
    }
  ],
  "closing": "3 to 5 sentences.",
  "transits": {
    "synthesis": "one paragraph"
  }
}`;

// VALIDATION AND REPAIR
const BANNED_ASTRO_TERMS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius',
  'capricorn', 'aquarius', 'pisces',
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
  'chiron', 'node', 'asc', 'ascendant', 'midheaven', 'mc', 'retrograde', 'house', 'houses',
  'astrolog', 'chart', 'placement', 'placements', 'sign', 'signs'
];

function extractMainProse(reading) {
  const parts = [];
  (reading.sections || []).forEach(s => parts.push(s.content || ''));
  (reading.way_home || []).forEach(s => {
    parts.push(s.content || '');
    if (s.utterance) parts.push(s.utterance);
  });
  if (reading.closing) parts.push(reading.closing);
  if (reading.transits && reading.transits.synthesis) parts.push(reading.transits.synthesis);
  return parts.join('\n').toLowerCase();
}

function hasAstroLeak(reading) {
  const prose = extractMainProse(reading);
  return BANNED_ASTRO_TERMS.some(term => {
    const re = new RegExp(`\\b${term}\\b`, 'i');
    return re.test(prose);
  });
}

function validateReading(reading) {
  const problems = [];

  if (!reading || typeof reading !== 'object') {
    problems.push('Reading is not an object.');
    return problems;
  }

  if (!Array.isArray(reading.sections) || reading.sections.length !== 3) {
    problems.push('sections must be an array of length 3.');
  }

  if (!Array.isArray(reading.way_home) || reading.way_home.length !== 2) {
    problems.push('way_home must be an array of length 2.');
  }

  const allSections = []
    .concat(reading.sections || [])
    .concat(reading.way_home || []);

  allSections.forEach((s, idx) => {
    if (!s || typeof s !== 'object') {
      problems.push(`Section ${idx + 1} is not an object.`);
      return;
    }

    if (!s.title || !s.content) {
      problems.push(`Section ${idx + 1} is missing title or content.`);
    }

    if (!Array.isArray(s.key_terms) || s.key_terms.length !== 3) {
      problems.push(`Section ${idx + 1} must have exactly 3 key_terms.`);
    }

    if (!Array.isArray(s.placements) || s.placements.length < 2 || s.placements.length > 4) {
      problems.push(`Section ${idx + 1} must have 2 to 4 placements.`);
    }

    (s.placements || []).forEach((p, pIdx) => {
      if (!p.name || !p.meaning) {
        problems.push(`Section ${idx + 1}, placement ${pIdx + 1} missing name or meaning.`);
      }
    });
  });

  if (!reading.closing || typeof reading.closing !== 'string') {
    problems.push('closing is required.');
  }

  if (!reading.transits || typeof reading.transits.synthesis !== 'string') {
    problems.push('transits.synthesis is required.');
  }

  if (reading.way_home && reading.way_home[1] && !reading.way_home[1].utterance) {
    problems.push('A new response must include utterance.');
  }

  if (hasAstroLeak(reading)) {
    problems.push('Main prose contains astrology labels.');
  }

  return problems;
}

async function repairReadingIfNeeded(reading, chartText, transitPrompt, name) {
  const problems = validateReading(reading);
  if (!problems.length) return reading;

  console.log('Reading failed validation. Attempting repair:', problems);

  const repairSystem = `${SYS}

REPAIR MODE
You are repairing a draft that did not fully follow instructions.

Do not start over in a new voice.
Keep what is strongest.
Repair only what is broken.

Common failures:
- astrology labels leaked into main prose
- Essence drifted into adaptation
- sections sounded generic
- placements did not match prose tightly enough
- key_terms were weak or slogan-like
- the utterance sounded too crafted
- the prose sounded more written than true

In repair mode:
- remove all astrology labels from the main prose
- tighten the prose so it feels more exact and less generic
- keep the reading human and specific
- make the placements arrays more exact and better matched to the prose
- keep the output JSON shape exactly the same`;

  const repairPrompt = [
    `Repair this natal reading for ${name}.`,
    '',
    'CHART:',
    chartText,
    '',
    transitPrompt,
    '',
    'VALIDATION PROBLEMS TO FIX:',
    ...problems.map(p => `- ${p}`),
    '',
    'DRAFT TO REPAIR:',
    JSON.stringify(reading)
  ].join('\n');

  try {
    const repaired = await callAnthropic(repairSystem, repairPrompt, 2);
    return repaired;
  } catch (e) {
    console.error('Repair failed:', e.message);
    return reading;
  }
}

// MAILCHIMP
function addToMailchimp(email, firstName) {
  return new Promise(resolve => {
    const parts = firstName.trim().split(' ');
    const fname = parts[0] || firstName;
    const lname = parts.slice(1).join(' ') || '';
    const body = JSON.stringify({
      email_address: email,
      status: 'subscribed',
      merge_fields: { FNAME: fname, LNAME: lname }
    });
    const auth = Buffer.from(`anystring:${MAILCHIMP_KEY}`).toString('base64');

    const req = https.request({
      hostname: `${MAILCHIMP_SERVER}.api.mailchimp.com`,
      path: `/3.0/lists/${MAILCHIMP_LIST_ID}/members`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          console.log('Mailchimp status:', res.statusCode, JSON.stringify(r).substring(0, 200));
        } catch {
          console.log('Mailchimp raw:', d.substring(0, 200));
        }
        resolve({ ok: true });
      });
    });

    req.on('error', e => {
      console.log('Mailchimp error:', e.message);
      resolve({ ok: true });
    });

    req.write(body);
    req.end();
  });
}

// ANTHROPIC
function callAnthropicOnce(system, userMsg) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 10000,
    system,
    messages: [{ role: 'user', content: userMsg }]
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          if (d.trim().startsWith('<') || res.statusCode >= 400) {
            console.error('Anthropic API error:', res.statusCode, d.substring(0, 500));
            throw new Error('Anthropic API returned status ' + res.statusCode + ': ' + d.substring(0, 200));
          }

          const a = JSON.parse(d);
          if (a.error) {
            const err = new Error(a.error.message);
            err.status = res.statusCode;
            err.type = a.error.type;
            throw err;
          }

          const raw = a.content?.[0]?.text || '';
          console.log('Raw response length:', raw.length);

          function robustJsonParse(text) {
            let s = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();

            const start = s.indexOf('{');
            if (start === -1) throw new Error('No JSON object found');

            let depth = 0;
            let end = -1;
            let inString = false;
            let escape = false;

            for (let i = start; i < s.length; i++) {
              const ch = s[i];
              if (escape) {
                escape = false;
                continue;
              }
              if (ch === '\\') {
                escape = true;
                continue;
              }
              if (ch === '"') {
                inString = !inString;
                continue;
              }
              if (inString) continue;
              if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) {
                  end = i;
                  break;
                }
              }
            }

            if (end === -1) throw new Error('Unmatched braces');
            s = s.substring(start, end + 1);

            try {
              return JSON.parse(s);
            } catch (e) {
              console.log('First parse attempt:', e.message);
            }

            s = s.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            try {
              return JSON.parse(s);
            } catch (e) {
              console.log('After trailing comma fix:', e.message);
            }

            let result = '';
            inString = false;
            escape = false;

            for (let i = 0; i < s.length; i++) {
              const ch = s[i];
              if (escape) {
                result += ch;
                escape = false;
                continue;
              }
              if (ch === '\\') {
                result += ch;
                escape = true;
                continue;
              }
              if (ch === '"') {
                inString = !inString;
                result += ch;
                continue;
              }
              if (inString) {
                if (ch === '\n') {
                  result += '\\n';
                  continue;
                }
                if (ch === '\r') {
                  result += '\\r';
                  continue;
                }
                if (ch === '\t') {
                  result += '\\t';
                  continue;
                }
              }
              result += ch;
            }

            result = result.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            try {
              return JSON.parse(result);
            } catch (e) {
              console.log('Second parse attempt:', e.message);
            }

            let oneLine = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
            oneLine = oneLine.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            return JSON.parse(oneLine);
          }

          const reading = robustJsonParse(raw);
          console.log('Reading parsed successfully');
          resolve(reading);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callAnthropic(system, userMsg, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await callAnthropicOnce(system, userMsg);
    } catch (e) {
      const isOverloaded = e.message && (
        e.message.includes('Overloaded') ||
        e.message.includes('overloaded') ||
        e.message.includes('529') ||
        e.status === 529 ||
        e.status === 503
      );

      if (isOverloaded && attempt < retries) {
        const wait = attempt * 8000;
        console.log(`Anthropic overloaded, retry ${attempt}/${retries} in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'Accept': 'application/json', ...headers }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function calcTransitWeather(natalChart) {
  const now = new Date();
  const todayJD = jd(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), 0);
  const T = (todayJD - 2451545) / 36525;
  const today = now.toISOString().split('T')[0];

  const ascLon = natalChart.ASC ? natalChart.ASC.lon : 0;
  const ascSignIdx = Math.floor(ascLon / 30);

  const planets = {
    Saturn: calcGeoLon('saturn', T),
    Pluto: calcGeoLon('pluto', T),
    Neptune: calcGeoLon('neptune', T),
    Uranus: calcGeoLon('uranus', T),
  };

  const weather = {};
  for (const [name, lon] of Object.entries(planets)) {
    const signIdx = Math.floor(md(lon) / 30);
    const sign = SGN[signIdx];
    const deg = Math.floor(md(lon) % 30);
    const house = ((signIdx - ascSignIdx + 12) % 12) + 1;
    weather[name] = { sign, deg, house, lon };
  }

  return { weather, today, ascSignIdx };
}

function calcAspects(weather) {
  const planets = Object.entries(weather);
  const aspects = [];
  const orb = 8;

  for (let i = 0; i < planets.length; i++) {
    for (let j = i + 1; j < planets.length; j++) {
      const [n1, d1] = planets[i];
      const [n2, d2] = planets[j];
      let diff = Math.abs(d1.lon - d2.lon);
      if (diff > 180) diff = 360 - diff;

      if (Math.abs(diff - 0) <= orb) aspects.push({ planets: [n1, n2], type: 'conjunction', diff });
      if (Math.abs(diff - 60) <= orb) aspects.push({ planets: [n1, n2], type: 'sextile', diff });
      if (Math.abs(diff - 90) <= orb) aspects.push({ planets: [n1, n2], type: 'square', diff });
      if (Math.abs(diff - 120) <= orb) aspects.push({ planets: [n1, n2], type: 'trine', diff });
      if (Math.abs(diff - 180) <= orb) aspects.push({ planets: [n1, n2], type: 'opposition', diff });
    }
  }

  return aspects;
}

function formatTransitsForPrompt(transitData) {
  const { weather, today } = transitData;
  const lines = [`TODAY: ${today}`, ''];

  lines.push('CURRENT OUTER PLANET POSITIONS (whole sign houses for this natal chart):');
  for (const [name, data] of Object.entries(weather)) {
    lines.push(`${name}: ${data.sign} ${data.deg}° — currently in natal House ${data.house}`);
  }

  lines.push('');

  const aspects = calcAspects(weather);
  if (aspects.length > 0) {
    lines.push('CURRENT ASPECTS BETWEEN OUTER PLANETS:');
    const aspectDescriptions = {
      conjunction: 'merged, amplifying each other',
      sextile: 'flowing, supporting each other',
      square: 'in friction, creating pressure and tension',
      trine: 'harmonious, easing movement',
      opposition: 'pulling in different directions'
    };
    aspects.forEach(a => {
      lines.push(`${a.planets[0]} and ${a.planets[1]}: ${a.type} (${aspectDescriptions[a.type]})`);
    });
    lines.push('');
  }

  lines.push(
    `FOR THE transits.synthesis FIELD: Write ONE paragraph of 4 to 6 sentences in Chad Herst's voice. DO NOT name any planets, signs, houses, or astrological terms. Translate everything into plain human experience. Describe: (1) what this person is up against right now, (2) how that pressure relates directly to the performance trap named in the reading, and (3) what their growing edge is in this moment. Ground it in the body and in relationship. Short sentences. No comfort. No astrology. Do not sound inspirational.`
  );

  return lines.join('\n');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && serveStatic(req, res)) return;

  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, engine: 'vsop87-js' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/reading') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { city, name, email, date, time, tz } = JSON.parse(body);

        const geoData = await fetchJSON(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
          { 'User-Agent': 'PerformanceTrapApp/1.0' }
        );

        if (!geoData.length) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: `Could not find "${city}". Try: "San Rafael, California, USA"` }));
          return;
        }

        const lat = parseFloat(geoData[0].lat);
        const lon = parseFloat(geoData[0].lon);
        const chart = buildChart(date, time, parseFloat(tz), lat, lon);
        const text = chartToText(chart, name);

        console.log('Chart for', name, ':\n' + text);

        const transitData = calcTransitWeather(chart);
        const transitPrompt = formatTransitsForPrompt(transitData);

        const userPrompt = [
          `Read this chart for ${name}:`,
          '',
          text,
          '',
          transitPrompt,
          '',
          'Important output reminder:',
          '- The main prose must contain zero astrology labels.',
          '- All astrology goes only in the placements arrays.',
          '- The prose must still feel chart-specific.',
          '- Essence must stay purely original signal.',
          '- The Miss must include both misattunement and mixed messages.',
          '- The Performance must show the packaging of truth into something more tolerable.',
          '- Contact must show the split in real time.',
          '- A New Response must be nuanced, not brutal.',
          '- Each section must end in 3 strong key_terms.',
          '- Placements must match the prose exactly.',
          '- Make the reading sharp, restrained, and believable.'
        ].join('\n');

        let [reading] = await Promise.all([
          callAnthropic(SYS, userPrompt),
          addToMailchimp(email, name)
        ]);

        reading = await repairReadingIfNeeded(reading, text, transitPrompt, name);

        res.writeHead(200);
        res.end(JSON.stringify({ lat, lon, reading, chart }));
      } catch (e) {
        console.error('Error:', e.message, e.stack);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message || 'Something went wrong.' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/tts') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body);
        if (!text) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No text provided' }));
          return;
        }

        const ttsBody = JSON.stringify({
          model: 'tts-1',
          voice: 'echo',
          input: text.substring(0, 4096),
          speed: 1.25
        });

        const ttsReq = https.request({
          hostname: 'api.openai.com',
          path: '/v1/audio/speech',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(ttsBody)
          }
        }, ttsRes => {
          if (ttsRes.statusCode !== 200) {
            ttsRes.on('data', () => {});
            ttsRes.on('end', () => {
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'TTS failed' }));
            });
            return;
          }

          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked'
          });
          ttsRes.pipe(res);
        });

        ttsReq.on('error', e => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });

        ttsReq.write(ttsBody);
        ttsReq.end();
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/optin') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        if (!email) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No email' }));
          return;
        }
        console.log('Opt-in received for:', email);
        sendNurtureSequence(email);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/expand') {
    console.log('Expand endpoint hit');
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { reading, name, birthDate, birthCity } = JSON.parse(body);
        if (!reading) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No reading provided' }));
          return;
        }

        const expandSYS = `You are expanding a Performance Trap natal chart reading for a PDF document. Chad Herst's voice: direct, somatic, precise. No spiritual bypassing. Never call the wound a gift.

Rules:
- Peer across the table, not guru.
- Physical sensations before interpretation.
- Short sentences. Hard stops.
- Never call the wound a gift. It is a survival strategy.
- Show what happens in the body, not what it means.
- State the hard truth. Period. Move on.
- Do not become poetic.
- Do not become inspirational.
- Do not sound therapeutic or vague.

Expand each section to 2 or 3 paragraphs. Keep each paragraph under 100 words. Be specific to this person's chart and to the reading already written.

CRITICAL: Keep your total response under 3000 words. Be concise.

RESPOND WITH ONLY VALID JSON, no markdown fences, nothing before or after:
{"headline":"one sentence","sections":[{"title":"exact section title from input","content":"2-3 paragraphs separated by newline"}],"closing":"one concrete scene in the body","transits_expanded":"2 paragraphs on the transit weather"}`;

        const readingText = [
          'Person: ' + name + ', born ' + birthDate + ', ' + birthCity,
          '',
          'Sections:'
        ]
          .concat((reading.sections || []).map(s => s.title.toUpperCase() + '\n' + (s.content || '')))
          .concat((reading.way_home || []).map(s => s.title.toUpperCase() + '\n' + (s.content || '')))
          .concat([
            '',
            'Closing: ' + (reading.closing || ''),
            '',
            'Transit synthesis: ' + ((reading.transits && reading.transits.synthesis) || '')
          ]).join('\n');

        const userMsg = 'Expand this reading into a detailed long-form PDF. Same voice rules apply: direct, somatic, no spiritual bypassing, no romanticizing the wound.\n\n' + readingText;

        const reqBody = JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8096,
          system: expandSYS,
          messages: [{ role: 'user', content: userMsg }]
        });

        const apiReq = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(reqBody),
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          }
        }, apiRes => {
          let d = '';
          apiRes.on('data', c => d += c);
          apiRes.on('end', () => {
            try {
              const a = JSON.parse(d);
              if (a.error) throw new Error('Haiku error: ' + a.error.type + ' - ' + a.error.message);
              const raw = a.content?.[0]?.text || '';
              let expanded;
              try {
                expanded = JSON.parse(raw);
              } catch {
                expanded = JSON.parse(raw.replace(/```json|```/g, '').trim());
              }
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              });
              res.end(JSON.stringify({ expanded }));
            } catch (e) {
              console.error('Expand error:', e.message);
              res.writeHead(500);
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        apiReq.on('error', e => {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        });

        apiReq.write(reqBody);
        apiReq.end();
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
