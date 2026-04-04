const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAILCHIMP_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_LIST_ID = process.env.MAILCHIMP_LIST_ID;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER_PREFIX || 'us6';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Chad Herst <chad@herstwellness.com>';

const BASE_URL = 'https://performance-trap-server.onrender.com';
const LOGO_URL = BASE_URL + '/Herst-Wellness-Logo-cropped.jpg';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

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

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const md = x => ((x % 360) + 360) % 360;

function jd(y, m, d, h) {
  let Y = y;
  let M = m;
  let D = d + h / 24;

  if (M <= 2) {
    Y -= 1;
    M += 12;
  }

  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + D + B - 1524.5;
}

function sunLon(T) {
  const L0 = md(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = md(357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
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
    [-0.034720, [1, 0, 0, 0]],
    [-0.030383, [0, 1, 1, 0]],
    [0.015327, [2, 0, 0, -2]],
    [0.010980, [0, 0, 1, -2]],
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
      w: [77.45645, 0.1600388, 0.00046975, 0.00000056],
    },
    venus: {
      L: [181.979801, 58519.2130302, 0.00031014, 0.000000015],
      e: [0.00677188, -0.000047766, 0.0000000975, 0.00000000044],
      w: [131.563707, 1.4022188, -0.00107377, -0.000005765],
    },
    earth: {
      L: [100.466456, 36000.7698278, 0.00030322, 0.000000020],
      e: [0.01670862, -0.000042037, -0.0000001236, 0.00000000004],
      w: [102.937348, 1.7195269, 0.00045962, 0.000000499],
    },
    mars: {
      L: [355.433275, 19141.6964746, 0.00031097, 0.000000015],
      e: [0.09340062, 0.000090483, -0.0000000806, -0.00000000035],
      w: [336.060234, 1.8410449, 0.00013477, 0.000000536],
    },
    jupiter: {
      L: [34.351484, 3036.3027748, 0.00022330, 0.000000037],
      e: [0.04849485, 0.000163244, -0.0000004719, -0.00000000197],
      w: [14.331309, 1.6120730, 0.00103200, -0.000004270],
    },
    saturn: {
      L: [50.077444, 1223.5110686, 0.00051908, -0.000000030],
      e: [0.05550825, -0.000346641, -0.0000006452, 0.00000000638],
      w: [93.056787, 1.9637694, 0.00083757, 0.000004899],
    },
    uranus: {
      L: [314.055005, 429.8640561, 0.00030434, 0.000000026],
      e: [0.04629590, -0.000027337, 0.0000000790, 0.000000000025],
      w: [173.005159, 1.4863784, 0.00021450, 0.000000433],
    },
    neptune: {
      L: [304.348665, 219.8833092, 0.00030926, 0.000000018],
      e: [0.00898809, 0.000006408, -0.0000000008],
      w: [48.123691, 1.4262677, 0.00037918, -0.000000003],
    },
    pluto: {
      L: [238.92903833, 145.20780515, 0.0],
      e: [0.24882730, 0.000006, 0.0],
      w: [224.06891629, 1.555029, 0.0],
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

function helioToGeo(planetLonH, planetDist, earthLonH, earthDist) {
  const pl = planetLonH * D2R;
  const el = earthLonH * D2R;
  const x = planetDist * Math.cos(pl) - earthDist * Math.cos(el);
  const y = planetDist * Math.sin(pl) - earthDist * Math.sin(el);
  return md(Math.atan2(y, x) * R2D);
}

function helioRadius(planet) {
  const semi = {
    mercury: 0.387098,
    venus: 0.723330,
    earth: 1.000001,
    mars: 1.523692,
    jupiter: 5.202603,
    saturn: 9.554909,
    uranus: 19.21845,
    neptune: 30.11039,
    pluto: 39.48,
  };
  const ecc = {
    mercury: 0.20563,
    venus: 0.00677,
    earth: 0.01671,
    mars: 0.09340,
    jupiter: 0.04849,
    saturn: 0.05551,
    uranus: 0.04630,
    neptune: 0.00899,
    pluto: 0.24883,
  };

  const a = semi[planet] || 1;
  const e = ecc[planet] || 0;
  return a * (1 - e * e / 2);
}

function nnLon(T) {
  return md(125.04452 - 1934.136261 * T + 0.0020708 * T * T);
}

function chironLon(T) {
  const jdVal = T * 36525 + 2451545;
  const a = 13.633;
  const e = 0.3787;
  const n = 360 / (50.7 * 365.25);
  const tPeri = 2450128;
  const M = md(n * (jdVal - tPeri));
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

  const wPeri = 185.11;
  const hLon = md(v + wPeri);
  const earthLon = planetHelio('earth', T);
  const earthR = helioRadius('earth');
  const chironR = a * (1 - e * Math.cos(E));

  return helioToGeo(hLon, chironR, earthLon, earthR);
}

function calcGeoLon(planet, T) {
  if (planet === 'sun') return sunLon(T);
  if (planet === 'moon') return moonLon(T);
  if (planet === 'node') return nnLon(T);
  if (planet === 'chiron') return chironLon(T);

  const hLon = planetHelio(planet, T);
  const earthLon = planetHelio('earth', T);
  const earthR = helioRadius('earth');
  const pR = helioRadius(planet);

  return helioToGeo(hLon, pR, earthLon, earthR);
}

function isRetrograde(planet, T, dt = 0.5) {
  if (planet === 'sun' || planet === 'moon' || planet === 'node') return false;
  const before = calcGeoLon(planet, T - dt / 36525);
  const after = calcGeoLon(planet, T + dt / 36525);
  let diff = after - before;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff < 0;
}

function calcAllPlanets(T) {
  const planets = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'node', 'chiron'];
  const result = {};

  for (const p of planets) {
    result[p] = {
      lon: calcGeoLon(p, T),
      retrograde: isRetrograde(p, T),
    };
  }

  result.sun.retrograde = false;
  result.moon.retrograde = false;
  result.node.retrograde = false;

  return result;
}

function toSign(lon) {
  const l = md(lon);
  return { sign: SIGNS[Math.floor(l / 30)], deg: Math.floor(l % 30), lon: l };
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
    dd -= 1;
  }
  if (u >= 24) {
    u -= 24;
    dd += 1;
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
    chiron: 'Chiron',
  };

  const chart = {};
  for (const [key, val] of Object.entries(planets)) {
    const s = toSign(val.lon);
    chart[NAMES[key]] = {
      sign: s.sign,
      deg: s.deg,
      lon: s.lon,
      house: wsh(val.lon, ascIdx),
      retrograde: val.retrograde,
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
    weather[name] = {
      sign: SIGNS[signIdx],
      deg: Math.floor(md(lon) % 30),
      house: ((signIdx - ascSignIdx + 12) % 12) + 1,
      lon,
    };
  }

  return { weather, today };
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
      if (Math.abs(diff - 0) <= orb) aspects.push({ planets: [n1, n2], type: 'conjunction' });
      if (Math.abs(diff - 60) <= orb) aspects.push({ planets: [n1, n2], type: 'sextile' });
      if (Math.abs(diff - 90) <= orb) aspects.push({ planets: [n1, n2], type: 'square' });
      if (Math.abs(diff - 120) <= orb) aspects.push({ planets: [n1, n2], type: 'trine' });
      if (Math.abs(diff - 180) <= orb) aspects.push({ planets: [n1, n2], type: 'opposition' });
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
    aspects.forEach(a => lines.push(`${a.planets[0]} and ${a.planets[1]}: ${a.type}`));
    lines.push('');
  }

  lines.push('FOR THE transits.synthesis FIELD: Write one paragraph of 3 to 5 sentences. No astrology labels in prose. Translate this into human experience. Make it feel like the structure is being audited, loosened, glitched, or exposed.');

  return lines.join('\n');
}

const SYS = `You are writing a natal chart reading through Chad Herst's Performance Trap framework.

The astrology decides the content. The framework only organizes it.

The goal is this:
Keep the clarity and readability of a finished app reading.
But reach much closer to the depth, layering, and internal architecture of a true blueprint.

This reading must not sound like a personality summary.
It must sound like a whole trap.

NON-NEGOTIABLE RULES

1. NO ASTROLOGY LABELS IN THE MAIN PROSE.
Do not name:
- signs
- planets
- houses
- aspects
- retrograde
- chart ruler
- astrology itself

All astrology goes ONLY in the placements arrays.

2. DO NOT FLATTEN THE PERSON INTO ONE TRAIT.
Do not reduce the whole reading to:
- truth-teller
- healer
- translator
- helper
- teacher
- deep feeler
- diplomat
- boundary-setter

A person can have multiple adaptations and multiple layers of defense.
The reading must allow that.

3. ESSENCE MUST NOT BE ADULT ARMOR IN DISGUISE.
Do not let later strengths, social usefulness, or developed gifts masquerade as the earliest self.
Essence must feel earlier, softer, more original, more pre-adaptive.

4. THE CHART DECIDES THE MOVE.
Do not impose generic psychological advice.
The new response must come from the chart, not from a canned therapeutic idea.

5. THIS MUST READ AS BOTH STORY AND STRUCTURE.
It should feel like one unfolding system:
what was there first,
how it was missed,
what contortions formed,
what mask made the trap invisible,
what is starting to crack,
what third option becomes possible.

VOICE
- Direct
- Human
- Restrained
- Clear over clever
- No guru tone
- No therapy jargon
- No inflated spirituality
- Somatic when earned
- Short to medium sentences
- Never call trauma a gift
- Never romanticize the wound

THE READING MUST FEEL LIKE
- one person, not a type
- one trap, not one slogan
- one architecture, not one theme
- one story, not stacked summaries

CRITICAL WRITING STANDARD
Do not summarize too early.
Do not give the conclusion before showing the mechanism.
Do not make the person sound impressive before you make the trap visible.

Less:
- résumé language
- flattering trait language
- polished identity language
- broad giftedness language

More:
- mechanism
- cost
- contradiction
- invisible adaptation
- how one layer formed on top of another
- how the defense became hard to see

SECTION RULES

1. Your essence
Subtitle: The original face
This section must sound like origin.
Use language like:
- when you came into the world
- the part of you that arrived first
- originally
- before anything got reorganized

Weight:
- Moon first
- Venus second
- 4th / IC tone
- Ascendant
- chart ruler if truly original
- Mercury or Sun only if they clearly belong to the original face and not later adaptation

2 short paragraphs only.

2. The miss
Subtitle: How you were missed
This section must show:
- mismatch
- contradiction
- the field's emotional rules
- surface reality versus underground reality
- the impossible lesson that got installed

Weight:
- Moon aspects
- 4th house / IC
- Saturn
- Neptune
- Pluto
- Uranus
- Venus
- Mercury for mixed messages

2 short paragraphs only.

3. The performance, the contortion
Subtitle: What you learned to become
This section must be layered.
Show:
- first contortion
- second contortion if the chart supports it
- brilliance
- cost

Weight:
- Mercury
- Saturn
- Mars
- Sun
- Ascendant
- South Node if relevant
- 6th / 7th / 10th / 11th houses

2 short paragraphs only.

4. The mask you learned
Subtitle: The face that made the trap invisible
This section is distinct from the contortion.
Show:
- why nobody questioned this defense
- why it looked admirable
- how it created distance while looking gifted, wise, warm, or useful

Weight:
- Ascendant
- Sun
- Mercury
- Neptune
- Jupiter
- South Node
- 7th / 10th / 11th house expression

2 short paragraphs only.

5. Contact
Subtitle: The way home begins here
Start with visibility, not inspiration.
Show:
- the structure becoming visible as structure
- protectors revealing themselves as protectors
- ache underneath them

Weight:
- Moon
- Saturn
- Venus
- Chiron
- Mercury
- Mars
- Pluto
- Neptune
- relevant transits

2 short paragraphs only.

6. A new response
Subtitle: What becomes possible now
This must be chart-led.
Frame it as the third option:
not overwhelming the room,
not saving the room through performance,
but less interference, more signal.

Weight:
- North Node
- Mercury
- Mars
- Venus
- Moon
- Saturn
- 7th house
- ruler of the 7th

1 short paragraph plus utterance.

KEY TERMS
Each section must contain exactly 3 key_terms.

PLACEMENTS
Each section must contain 2 to 4 placements.
Each meaning must be one short sentence.
Plain English. Exact. No filler.

CLOSING
3 to 4 sentences.
A real scene.
The old machinery appears.
A new possibility opens.
No neat redemption.

TRANSITS
1 short paragraph.
No astrology labels in the prose.
It should feel like the system is under audit, the mask is glitching, the structure is loosening, or the camouflage is failing.

RESPOND WITH ONLY VALID JSON:
{
  "sections": [
    {
      "title": "Your essence",
      "subtitle": "The original face",
      "content": "...",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "The miss",
      "subtitle": "How you were missed",
      "content": "...",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "The performance, the contortion",
      "subtitle": "What you learned to become",
      "content": "...",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "The mask you learned",
      "subtitle": "The face that made the trap invisible",
      "content": "...",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    }
  ],
  "way_home": [
    {
      "title": "Contact",
      "subtitle": "The way home begins here",
      "content": "...",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    },
    {
      "title": "A new response",
      "subtitle": "What becomes possible now",
      "content": "...",
      "utterance": "...",
      "key_terms": ["...", "...", "..."],
      "placements": [{"name": "...", "meaning": "..."}]
    }
  ],
  "closing": "...",
  "transits": { "synthesis": "..." }
}`;

const BANNED_ASTRO_TERMS = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron', 'node', 'asc', 'ascendant', 'mc', 'midheaven',
  'retrograde', 'house', 'houses', 'chart', 'astrology', 'astrological', 'placement', 'placements'
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
  return BANNED_ASTRO_TERMS.some(term => new RegExp(`\\b${term}\\b`, 'i').test(prose));
}

function validateReading(reading) {
  const problems = [];

  if (!reading || typeof reading !== 'object') problems.push('Reading is not an object.');
  if (!Array.isArray(reading.sections) || reading.sections.length !== 4) problems.push('sections must have length 4.');
  if (!Array.isArray(reading.way_home) || reading.way_home.length !== 2) problems.push('way_home must have length 2.');
  if (!reading.closing) problems.push('closing is required.');
  if (!reading.transits || !reading.transits.synthesis) problems.push('transits.synthesis is required.');
  if (hasAstroLeak(reading)) problems.push('Astrology labels leaked into the prose.');

  const allSections = [].concat(reading.sections || []).concat(reading.way_home || []);
  allSections.forEach((s, idx) => {
    if (!s || typeof s !== 'object') {
      problems.push(`Section ${idx + 1} missing.`);
      return;
    }
    if (!s.title || !s.content) problems.push(`Section ${idx + 1} missing title or content.`);
    if (!Array.isArray(s.key_terms) || s.key_terms.length !== 3) problems.push(`Section ${idx + 1} needs 3 key_terms.`);
    if (!Array.isArray(s.placements) || s.placements.length < 2 || s.placements.length > 4) problems.push(`Section ${idx + 1} needs 2 to 4 placements.`);
  });

  if (reading.way_home && reading.way_home[1] && !reading.way_home[1].utterance) {
    problems.push('A new response needs an utterance.');
  }

  return problems;
}

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
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
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
  } catch {}

  s = s.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
  try {
    return JSON.parse(s);
  } catch {}

  const oneLine = s
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/,\s*]/g, ']')
    .replace(/,\s*}/g, '}');

  return JSON.parse(oneLine);
}

function addToMailchimp(email, firstName) {
  return new Promise(resolve => {
    if (!MAILCHIMP_KEY || !MAILCHIMP_LIST_ID) {
      resolve({ ok: true, skipped: true });
      return;
    }

    const safeName = (firstName || '').trim();
    const parts = safeName.split(' ').filter(Boolean);
    const fname = parts[0] || safeName || '';
    const lname = parts.slice(1).join(' ') || '';

    const body = JSON.stringify({
      email_address: email,
      status: 'subscribed',
      merge_fields: {
        FNAME: fname,
        LNAME: lname,
      },
    });

    const auth = Buffer.from(`anystring:${MAILCHIMP_KEY}`).toString('base64');

    const req = https.request({
      hostname: `${MAILCHIMP_SERVER}.api.mailchimp.com`,
      path: `/3.0/lists/${MAILCHIMP_LIST_ID}/members`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('Mailchimp status:', res.statusCode, d.substring(0, 200));
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

function callAnthropicOnce(system, userMsg) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4200,
    system,
    messages: [{ role: 'user', content: userMsg }],
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
        'anthropic-version': '2023-06-01',
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          if (d.trim().startsWith('<') || res.statusCode >= 400) {
            throw new Error('Anthropic API returned status ' + res.statusCode + ': ' + d.substring(0, 300));
          }
          const a = JSON.parse(d);
          if (a.error) throw new Error(a.error.message);
          const raw = a.content?.[0]?.text || '';
          resolve(robustJsonParse(raw));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.setTimeout(180000, () => {
      req.destroy(new Error('Anthropic request timeout'));
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
      const overloaded =
        e.message &&
        (e.message.includes('Overloaded') ||
          e.message.includes('529') ||
          e.message.includes('503') ||
          e.message.includes('timeout') ||
          e.message.includes('ECONNRESET'));

      if (overloaded && attempt < retries) {
        await new Promise(r => setTimeout(r, attempt * 8000));
        continue;
      }

      throw e;
    }
  }
}

async function repairReadingIfNeeded(reading, chartText, transitPrompt, name) {
  const problems = validateReading(reading);
  if (!problems.length) return reading;

  const repairSystem = `${SYS}

REPAIR MODE
Repair the draft without flattening it.
Keep the layered architecture.
Remove astrology labels from prose.
Strengthen any section that feels one-note or generic.
Keep sections concise.`;

  const repairPrompt = [
    `Repair this reading for ${name}.`,
    '',
    'CHART:',
    chartText,
    '',
    transitPrompt,
    '',
    'PROBLEMS:',
    ...problems.map(p => `- ${p}`),
    '',
    'DRAFT:',
    JSON.stringify(reading),
  ].join('\n');

  try {
    return await callAnthropic(repairSystem, repairPrompt, 2);
  } catch {
    return reading;
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
        const chartText = chartToText(chart, name);
        const transitData = calcTransitWeather(chart);
        const transitPrompt = formatTransitsForPrompt(transitData);

        const userPrompt = [
          `Read this chart for ${name}:`,
          '',
          chartText,
          '',
          transitPrompt,
          '',
          'Important output reminder:',
          '- Keep the clarity of a finished app reading.',
          '- Reach for more depth and internal architecture than a one-theme summary.',
          '- Do not flatten the person into one adaptation.',
          '- Let the Performance be layered if the chart supports that.',
          '- Use The Mask section to show how the defense became socially rewarded and hard to recognize.',
          '- Keep Essence early, original, and prior to adult armor.',
          '- Keep all astrology labels out of the prose.',
          '- All astrology belongs only in the placements arrays.',
        ].join('\n');

        let [reading] = await Promise.all([
          callAnthropic(SYS, userPrompt),
          addToMailchimp(email, name),
        ]);

        reading = await repairReadingIfNeeded(reading, chartText, transitPrompt, name);

        res.writeHead(200);
        res.end(JSON.stringify({ lat, lon, chart, reading }));
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
          speed: 1.25,
        });

        const ttsReq = https.request({
          hostname: 'api.openai.com',
          path: '/v1/audio/speech',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(ttsBody),
          },
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
            'Transfer-Encoding': 'chunked',
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

        sendNurtureSequence(email);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/expand') {
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

        const expandSYS = `You are expanding a Performance Trap reading for PDF. Same person. Same voice. Keep the layered architecture. Keep the six-section structure. No astrology labels in prose. Do not flatten the reading. Do not become inspirational. Respond with valid JSON only.`;

        const readingText = [
          `Person: ${name}, born ${birthDate}, ${birthCity}`,
          '',
          ...(reading.sections || []).map(s => `${s.title.toUpperCase()}\n${s.content}`),
          ...(reading.way_home || []).map(s => `${s.title.toUpperCase()}\n${s.content}`),
          '',
          `Closing: ${reading.closing || ''}`,
          '',
          `Transits: ${(reading.transits && reading.transits.synthesis) || ''}`,
        ].join('\n\n');

        const reqBody = JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 5000,
          system: expandSYS,
          messages: [{ role: 'user', content: 'Expand this reading into a long-form PDF version.\n\n' + readingText }],
        });

        const apiReq = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(reqBody),
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
        }, apiRes => {
          let d = '';
          apiRes.on('data', c => d += c);
          apiRes.on('end', () => {
            try {
              const a = JSON.parse(d);
              if (a.error) throw new Error(a.error.message);
              const raw = a.content?.[0]?.text || '';
              let expanded;
              try {
                expanded = JSON.parse(raw);
              } catch {
                expanded = JSON.parse(raw.replace(/```json|```/g, '').trim());
              }

              res.writeHead(200);
              res.end(JSON.stringify({ expanded }));
            } catch (e) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        apiReq.setTimeout(180000, () => {
          apiReq.destroy(new Error('Expand request timeout'));
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

server.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
