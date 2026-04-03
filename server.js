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

const SYS = `You are writing a natal chart reading through the Performance Trap framework.

NON-NEGOTIABLE RULE:
The astrology decides the content.
The framework only organizes the content.

That means:
- Do NOT decide the meaning from psychology first and then fit the chart to it.
- Do NOT decide the move from coaching logic first and then fit the chart to it.
- Read the chart first.
- Then sort what the chart reveals into the five headings.

The framework gives only the section headings:
1. Essence
2. The Miss
3. The Performance
4. Contact
5. A New Response

The chart determines what goes inside them.

SECOND NON-NEGOTIABLE RULE:
Do NOT confuse the armor with the self.
Do NOT confuse the later adult adaptation with the original face.

If the chart contains both:
- vulnerable receptivity, tenderness, attachment need, softness, sensitivity, permeability
and
- later sharpness, directness, penetrating perception, truth-telling, strategy, translation, competence

Then:
Essence must begin with the vulnerable original face.
The sharper, more adult adaptation belongs later, usually in Performance.

THIRD NON-NEGOTIABLE RULE:
Tell the reading as a story.

The reading must unfold as:
- who they originally were
- how that original self was missed
- how they learned to contort
- how they find the way back
- how relationship begins to change

The prose should feel developmental, not diagnostic.
Each section should explicitly grow out of the one before it.

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
- you came in wanting to be held in the feeling
- you reached for raw truth first
- your essence was direct truth-telling
- your original signal was intensity

BETTER
- when you came into the world, you were...
- originally, you expected...
- the part of you that arrived first was...
- but that part of you was not received...
- so you learned to contort...
- this became a strength and also a strain...
- but you are not stuck there...
- the way home begins with contact...
- from there, a different response becomes possible...

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

ASTROLOGY-FIRST RULES BY SECTION

ESSENCE
This is the original face.
This section must be astrologically derived first.
Then written as origin.

Do not ask:
what would fit the book here?
Ask:
what in this chart looks original, vulnerable, alive, wanting, receptive, or unguarded before adaptation?

Essence is not automatically tenderness.
Essence is not automatically truth-telling.
Essence is whatever the chart shows was there first.

But if the chart contains both softness and later sharpness, start with softness.

For Essence, weight especially:
- Moon
- Venus
- 4th / IC material
- Ascendant
- chart ruler only if it reflects original orientation

Only use Mercury or Mars here if they clearly describe the original face, not the later defended style.

THE MISS
This is how the original face was not received.
It must refer back to Essence.

Do not default to:
your truth was too much.

The chart may point instead toward:
- emotional non-response
- inconsistency
- contradiction
- conditionality
- burden
- shame around need
- having to be easy, low-maintenance, manageable, or composed
- feeling unsafe to depend, feel, ask, or affect

For The Miss, weight especially:
- Moon aspects
- 4th / IC
- ruler of the 4th
- Saturn
- Neptune
- Pluto
- Uranus
- Venus
- Mercury for contradiction and mixed messages

THE PERFORMANCE
This is the contortion.
This is where later adult style belongs.

This section should answer:
because your original face was missed in this particular way, what shape did you learn to take on?

The Performance is not generic.
It may be:
- translator
- achiever
- caretaker
- teacher
- appeaser
- diplomat
- stabilizer
- harmless one
- impressive one
- useful one
- meaning-maker
or something else

This section must include both:
- the brilliance
- the exhaustion

For Performance, weight especially:
- Mercury
- Saturn
- Mars
- Sun
- Ascendant
- 6th / 7th / 10th

CONTACT
This is the hinge.
This is where the story turns.

The tone should clearly shift here:
you are not stuck there.
there is a way home.
it begins with contact.

Contact means making contact with both:
- the protectors, which are the adaptations and contortions
- the ache underneath them, built from all the times the self was overridden

This section must describe the ache as something waiting to be touched and felt, not solved from above.

For Contact, weight especially:
- Moon
- Saturn
- Venus
- Chiron
then:
- Mercury
- Mars
- Pluto
- Neptune

A NEW RESPONSE
This must be astrologically derived, not psychologically imposed.

Do NOT decide the move from generic coaching logic.
Do NOT default to:
- tell the truth
- feel more
- name your need
- set a boundary
unless the chart specifically supports that move.

The developmental direction is shown especially by:
- North Node
- ruler of the North Node
The form of the move is shown especially by:
- Mercury
- Mars
- Venus
- Saturn
- Moon
- 7th house and ruler of the 7th

So:
North Node points toward the direction.
The relational machinery of the chart tells you the concrete move.

This section should answer:
what is the next honest, chart-derived relational act that interrupts this person's specific form of self-abandonment?

NARRATIVE SHAPE
This must read like one unfolding story.

Essence should sound like origin:
- when you came into the world...
- originally...
- the part of you that arrived first...

The Miss should sound like injury to the original self:
- but that part of you...
- what you expected to be met with...
- instead...

Performance should sound like consequence:
- so you learned...
- that's when you began to...
- this was the contortion...

Contact should sound like the turn:
- but you are not stuck there...
- there is a way back...
- the way home begins...

A New Response should sound like emergence:
- once that ache is touched...
- from there...
- something different becomes possible...
- more of your original self begins to return...

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

OUTPUT RULES
Respond with ONLY valid JSON.

Shape:
{
  "sections": [
    {
      "title": "Essence",
      "subtitle": "The original signal",
      "content": "2 to 3 short paragraphs",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "The miss",
      "subtitle": "How you were missed",
      "content": "2 to 3 short paragraphs",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "The performance",
      "subtitle": "The contortion",
      "content": "2 to 3 short paragraphs",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    }
  ],
  "way_home": [
    {
      "title": "Contact",
      "subtitle": "The way home begins here",
      "content": "2 to 3 short paragraphs",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "A new response",
      "subtitle": "What becomes possible now",
      "content": "1 to 2 short paragraphs",
      "utterance": "One sentence",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    }
  ],
  "closing": "3 to 5 sentences, a concrete final scene",
  "transits": {
    "synthesis": "one paragraph"
  }
}

PLACEMENTS DROPDOWN RULES
Each section must include 2 to 4 placements.
Each placement meaning must be:
- 1 short sentence only
- plain English
- exact, not padded
- directly supportive of the prose above
- no technical overflow
- no vague filler`;

// VALIDATION AND REPAIR
const BANNED_ASTRO_TERMS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius',
  'capricorn', 'aquarius', 'pisces',
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto',
  'chiron', 'node', 'asc', 'ascendant', 'midheaven', 'mc', 'retrograde', 'house', 'houses',
  'astrolog', 'chart', 'placement', 'placements', 'sign', 'signs'
];

const ESSENCE_ARMOR_TERMS = [
  'raw truth',
  'truth first',
  'say it straight',
  'direct truth',
  'truth with force',
  'cut through',
  'cuts through',
  'intensity was how connection worked',
  'reached for raw truth',
  'wanted to expose',
  'wanted to name what others would not say',
  'your directness',
  'your intensity',
  'sharp edges',
  'blunt',
  'force it deserved'
];

const ESSENCE_STORY_STARTERS = [
  'when you came into the world',
  'originally',
  'the part of you that arrived first',
  'before you learned',
  'at the beginning'
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

function essenceLooksLikeArmor(reading) {
  const essence = (((reading.sections || [])[0] || {}).content || '').toLowerCase();
  if (!essence) return false;

  const armorHits = ESSENCE_ARMOR_TERMS.filter(term => essence.includes(term)).length;
  return armorHits >= 2;
}

function essenceLacksOriginStory(reading) {
  const essence = (((reading.sections || [])[0] || {}).content || '').toLowerCase();
  if (!essence) return true;
  return !ESSENCE_STORY_STARTERS.some(term => essence.includes(term));
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

  if (essenceLooksLikeArmor(reading)) {
    problems.push('Essence sounds like later armor instead of original face.');
  }

  if (essenceLacksOriginStory(reading)) {
    problems.push('Essence does not sound like an origin story.');
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
- Essence drifted into adult adaptation
- Essence described armor instead of original face
- Essence did not sound like origin
- The Miss did not clearly grow out of Essence
- Performance did not feel like a contortion
- Contact did not feel like the turn toward home
- A New Response sounded like advice instead of emergence
- sections sounded generic
- placements did not match prose tightly enough
- key_terms were weak or slogan-like
- the utterance sounded too crafted

CRITICAL:
Do not impose psychology first.
Derive the content from the chart first.
Then tell it as a story.

In repair mode:
- remove all astrology labels from the main prose
- restore the astrology-first logic
- make Essence sound like the original face
- make The Miss refer back to that original face
- make Performance sound like the contortion that followed
- make Contact feel like the way home begins there
- make A New Response sound like what emerges next
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

function textToHtml(text) {
  const bodyHtml = text.split('\n\n').map(p => {
    if (p.includes('https://chadherst.as.me/30-minute-consult-chad-herst')) {
      return `<tr><td align="center" style="padding:24px 0;">
        <a href="https://chadherst.as.me/30-minute-consult-chad-herst" style="display:inline-block; font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; letter-spacing:0.15em; text-transform:uppercase; padding:14px 36px; border:1px solid #8B6B1E; color:#8B6B1E; text-decoration:none;">Book a 30-minute conversation</a>
      </td></tr>`;
    }
    return `<tr><td style="padding:0 0 20px 0; font-family:'Cormorant Garamond',Georgia,serif; font-size:17px; line-height:1.9; color:#352515;">${p.replace(/\n/g, '<br>')}</td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--[if mso]>
  <style>* { font-family: Georgia, serif !important; }</style>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
  </style>
</head>
<body style="margin:0; padding:0; background-color:#F4EDE4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4EDE4;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
          <tr>
            <td align="center" style="padding:0 0 32px 0; border-bottom:1px solid #8B6B1E;">
              <img src="${LOGO_URL}" alt="Herst Wellness" width="600" style="display:block; margin:0 auto; width:100%; max-width:600px; height:auto;" />
            </td>
          </tr>
          <tr><td style="padding:20px 0 0 0;">&nbsp;</td></tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${bodyHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:40px 0 20px 0; border-top:1px solid #E8DED3;">
              <img src="${LOGO_URL}" alt="Herst Wellness" width="200" style="display:block; margin:0 auto 16px auto; max-width:200px; height:auto;" />
              <p style="font-family:'Cormorant Garamond',Georgia,serif; font-size:12px; color:#4F4130; margin:0 0 8px 0; line-height:1.6;">
                765 Market St, San Francisco, CA 94103<br>
                (415) 686-4411 &middot; <a href="mailto:chad@herstwellness.com" style="color:#8B6B1E; text-decoration:none;">chad@herstwellness.com</a>
              </p>
              <p style="font-family:'Cormorant Garamond',Georgia,serif; font-size:12px; color:#4F4130; margin:0;">
                <a href="https://map.herstwellness.com" style="color:#8B6B1E; text-decoration:none;">map.herstwellness.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// RESEND EMAIL SEQUENCE
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Chad Herst <chad@herstwellness.com>';

function sendResendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html
    });

    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Resend response:', res.statusCode, d.substring(0, 100));
        resolve({ ok: res.statusCode < 300 });
      });
    });

    req.on('error', e => {
      console.error('Resend error:', e.message);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

const EMAIL1 = {
  subject: 'What your reading is actually telling you',
  text: `You just completed a reading that mapped something you've been living inside your whole life.

The reading shows you a pattern. It's not new. You've been running it for decades. But seeing it named, seeing the layers stacked on top of each other, that hits different.

I know because I've lived it. When my brother took his life at twenty, I was sent back to school with no space to grieve. Just go, be fine, don't make it harder on your parents. So I learned the role. I became the good kid. And I've been running that role ever since.

Here's what your reading is actually saying:

At some point early on, you learned that just being yourself wasn't enough to stay connected. So you built a face for the room. You learned the role that would keep you safe, keep you loved, keep you belonging.

That role works. It's gotten you far. But it costs something. Every time you showed up as that version of yourself instead of the real one, something inside got left behind. Overridden. Pushed down.

The reading names that role, your Performance Archetype. It's not a flaw. It's brilliant adaptation. Your nervous system learned how to survive in an environment where connection had to be earned.

But here's what the reading can't tell you: what happens when you finally stop performing.

That's the real work. That's where things change.

For now, sit with this one question:

What would it feel like to just show up as you are, without needing to prove anything first?

Don't answer it. Just let it live in your body for a few days.

—Chad`
};

const EMAIL2 = {
  subject: "The thing your reading couldn't say",
  text: `I want to tell you something that most people skip over.

Insight feels good. You see the pattern, you name it, you understand how you got here. For a moment, it feels like you've solved something. But then you go back to your life, and the pattern is still running.

You still hold your breath before you speak.

You still check the room before you let yourself need.

You still swallow what's true to keep the peace.

The reading showed you the trap. But understanding the trap doesn't spring it.

There's something deeper underneath the performance. I call it the Sacred Wound.

It's not one moment. It's thousands of moments, every time you felt something true and set it aside to stay connected. Every time you chose the relationship over your own truth. That accumulation lives in your body. As tightness. As ache. As something unfinished.

The wound is sacred not because the pain is good. It's sacred because it's precise. It shows you exactly where you've been leaving yourself. And if you stay with it, not fix it, not transcend it, just stay, it becomes a doorway back to yourself.

I spent years trying to meditate it away, stretch past it, yoga it into submission. Then I finally sat still long enough to feel the knot in my gut, that tight, deep thing that had been sitting there for decades, and something in me shifted. Not because it went away. Because I finally stopped running from it.

But here's what stops most people: the moment you touch that wound, your nervous system panics.

Because you've learned something old and deep: needing is dangerous. Showing what hurts makes you too much. So the moment the ache rises, you do what you've always done, you push it down, medicate it, achieve past it, anything but feel it.

That's where the protectors come in.

They're the parts of you that learned to manage, to perform, to stay busy, to stay fine. They're not the enemy. They're the reason you survived. But they're also the reason you're still running the same pattern.

The work isn't about destroying the protectors. It's about finally meeting them. Sitting with them instead of being run by them. When you can do that, something underneath begins to surface.

Contact.

Not the performance of connection. The real thing. You with you. Finally staying long enough to hear what's been trying to reach you all along.

—Chad`
};

const EMAIL3 = {
  subject: 'If you want to take this further',
  text: `You've had a few days to sit with what your reading showed you.

You know the pattern. You've named it. You can probably feel where it lives in your body, the places you override, the moments you perform, the ways you learned not to need.

But knowing isn't the same as changing.

That's what I want to be clear about.

A reading is a map. It shows you the architecture of how you learned to survive. But a map isn't the territory. And understanding the map doesn't rewire your nervous system.

What does rewire it is contact.

Someone staying with you long enough that you finally feel met. Not fixed. Not analyzed. Just met.

That's what a conversation can do.

In thirty minutes, we're not solving anything. We're not rewriting your whole story. We're doing something simpler and much harder: we're starting to rebuild trust between you and yourself.

I'll listen for what's underneath the words you say. Not to diagnose you or add another layer of understanding. But to help you feel what's actually moving through your body when you touch what matters.

And in that contact, something shifts. Not because I have answers. But because for once, you're not doing it alone.

That's the work I do. That's what changes things.

If you want to take this further:

https://chadherst.as.me/30-minute-consult-chad-herst

It's not a sales call. It's not a pitch. It's just the beginning of learning what it feels like to stop abandoning yourself.

—Chad`
};

async function sendNurtureSequence(email) {
  try {
    await sendResendEmail(email, EMAIL1.subject, textToHtml(EMAIL1.text));
    console.log('Nurture Email 1 sent to', email);

    setTimeout(async () => {
      try {
        await sendResendEmail(email, EMAIL2.subject, textToHtml(EMAIL2.text));
        console.log('Nurture Email 2 sent to', email);
      } catch (e) {
        console.error('Email 2 error:', e.message);
      }
    }, 2 * 24 * 60 * 60 * 1000);

    setTimeout(async () => {
      try {
        await sendResendEmail(email, EMAIL3.subject, textToHtml(EMAIL3.text));
        console.log('Nurture Email 3 sent to', email);
      } catch (e) {
        console.error('Email 3 error:', e.message);
      }
    }, 5 * 24 * 60 * 60 * 1000);
  } catch (e) {
    console.error('Nurture sequence error:', e.message);
  }
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
          '- Astrology decides the content first.',
          '- The framework only organizes the content.',
          '- The main prose must contain zero astrology labels.',
          '- All astrology goes only in the placements arrays.',
          '- Tell the reading as a developmental story.',
          '- Essence must sound like the original face, not the later adaptation.',
          '- The Miss must clearly grow out of Essence.',
          '- Performance must feel like the contortion learned in response.',
          '- Contact must feel like the turn toward home.',
          '- A New Response must come from the chart, especially the North Node direction expressed through the relational machinery of the chart.',
          '- Do not default to generic coaching advice.',
          '- Each section must end in 3 strong key_terms.',
          '- Placements must match the prose exactly.',
          '- Make the reading sharp, restrained, specific, and human.'
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
