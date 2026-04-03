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
const SGN = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const md = x => ((x % 360) + 360) % 360;

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

function helioRadius(planet) {
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
    result[p] = { lon: calcGeoLon(p, T), retrograde: isRetrograde(p, T) };
  }
  result.sun.retrograde = false;
  result.moon.retrograde = false;
  result.node.retrograde = false;
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
      sign: SGN[signIdx],
      deg: Math.floor(md(lon) % 30),
      house: ((signIdx - ascSignIdx + 12) % 12) + 1,
      lon
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
  lines.push('FOR THE transits.synthesis FIELD: Write ONE paragraph of 4 to 6 sentences. No astrology labels in prose. Translate into plain human experience. Describe the current pressure, how it exposes the trap, and what loosens now. Make it feel like the structure is showing its seams.');
  return lines.join('\n');
}

const SYS = `You are writing a natal chart reading through Chad Herst's Performance Trap framework.

The astrology decides the content. The framework only organizes it.

This must sound like a finished app reading, not analysis notes.

MAIN RULES
- No astrology labels in the prose.
- The prose must read like one unfolding story.
- The reading must feel layered, not one-note.
- Every section should contain more than one dimension of the person when the chart supports that.
- Do not flatten the person into one trait.
- Do not reduce the chart to one adaptation.
- Keep the writing clear, but let the architecture stay alive.

VOICE
- Direct. Human. Precise.
- No guru voice.
- No therapy jargon.
- No inflated spirituality.
- No flashy metaphors unless they are simple and exact.
- Short to medium sentences.
- The prose should feel inevitable, not decorated.

VERY IMPORTANT
This reading should feel like:
1. a story
2. a system
3. a person

That means:
- Essence should feel like the original face.
- The Miss should feel like a structural mismatch between that original face and the field.
- The Performance should feel like a multi-layered contortion, not just one behavior.
- The Mask should feel brilliantly useful, and therefore hard to recognize as defense.
- Contact should feel like the old structure is showing its seams.
- A New Response should feel like less interference, not better management.

DO NOT DEFAULT TO GENERIC PSYCHOLOGY
Do not decide the reading from coaching logic first.
Do not impose one preferred wound story.
Do not assume every chart is about need, or truth-telling, or boundaries.
Let the chart decide.

DO NOT CONFUSE ARMOR WITH ESSENCE
If the chart contains both a vulnerable core and a later high-functioning adaptation, Essence must begin with the vulnerable core and not with the later competence.

PROSE BANS
Do not use:
- sign names
- planet names
- house numbers
- aspects
- retrograde
- chart
- astrology
- placement
- archetype

STRUCTURE
Use these exact sections and subtitles:

sections[0]
title: "Your essence"
subtitle: "The original face"

sections[1]
title: "The miss"
subtitle: "How you were missed"

sections[2]
title: "The performance, the contortion"
subtitle: "What you learned to become"

way_home[0]
title: "Contact"
subtitle: "The way home begins here"

way_home[1]
title: "A new response"
subtitle: "What becomes possible now"

WHAT EACH SECTION MUST DO

YOUR ESSENCE
- Begin as origin story.
- Use language like: when you came into the world, originally, the part of you that arrived first.
- Describe the original face before adaptation.
- Include at least two interacting dimensions if the chart supports them.
- Keep it specific.
- It should feel like a real person, not a slogan.

THE MISS
- Must clearly grow out of Essence.
- Must show both the mismatch and the contradiction.
- Not just what was absent, but what was split, confusing, or impossible.
- It should feel like the original face landed in a field built for something else.

THE PERFORMANCE, THE CONTORTION
- This section may include more than one contortion.
- Show the adaptation as a system.
- Include both brilliance and cost.
- This is where you can name translation, containment, usefulness, self-arrest, room-reading, over-framing, or anything else the chart supports.
- Do not reduce it to one trick.

CONTACT
- The tone must turn here.
- The person is not stuck.
- The protectors begin to show as protectors.
- The structure begins to show its seams.
- The ache underneath them must be described clearly.
- Contact should feel like the original signal getting room to breathe again.

A NEW RESPONSE
- Derive this from the chart, especially North Node direction plus the relational machinery of the chart.
- Do not default to generic advice.
- The move should feel specific.
- It should sound like less interference, not a better performance.
- The utterance should feel real, simple, and direct.

KEY TERMS
Each section must include exactly 3 key_terms.
They should feel memorable and natural, not slogan-like.

PLACEMENTS
Each section must include 2 to 4 placements.
These go in the dropdown only.
Each meaning must be one short sentence.
Tight. Exact. Plain English.

CLOSING
- 3 to 5 sentences.
- A concrete scene.
- Show the old reflex and the new opening.
- No tidy redemption.

TRANSITS
- One paragraph only.
- Make it feel like the structure is being audited, loosened, glitched, or exposed.
- No astrology labels in prose.

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
  'sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron', 'node',
  'asc', 'ascendant', 'midheaven', 'mc', 'retrograde', 'house', 'houses', 'chart', 'astrolog', 'placement', 'placements'
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
  if (!Array.isArray(reading.sections) || reading.sections.length !== 3) problems.push('sections must have length 3.');
  if (!Array.isArray(reading.way_home) || reading.way_home.length !== 2) problems.push('way_home must have length 2.');
  if (!reading.closing) problems.push('closing is required.');
  if (!reading.transits || !reading.transits.synthesis) problems.push('transits.synthesis is required.');
  if (hasAstroLeak(reading)) problems.push('Astrology labels leaked into the prose.');

  const allSections = [].concat(reading.sections || []).concat(reading.way_home || []);
  allSections.forEach((s, idx) => {
    if (!s.title || !s.content) problems.push(`Section ${idx + 1} missing title or content.`);
    if (!Array.isArray(s.key_terms) || s.key_terms.length !== 3) problems.push(`Section ${idx + 1} needs 3 key_terms.`);
    if (!Array.isArray(s.placements) || s.placements.length < 2 || s.placements.length > 4) problems.push(`Section ${idx + 1} needs 2 to 4 placements.`);
  });

  if (reading.way_home && reading.way_home[1] && !reading.way_home[1].utterance) {
    problems.push('A new response needs an utterance.');
  }

  return problems;
}

async function addToMailchimp(email, firstName) {
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
            throw new Error('Anthropic API returned status ' + res.statusCode + ': ' + d.substring(0, 200));
          }
          const a = JSON.parse(d);
          if (a.error) throw new Error(a.error.message);
          const raw = a.content?.[0]?.text || '';

          function robustJsonParse(text) {
            let s = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
            const start = s.indexOf('{');
            if (start === -1) throw new Error('No JSON object found');
            let depth = 0, end = -1, inString = false, escape = false;
            for (let i = start; i < s.length; i++) {
              const ch = s[i];
              if (escape) { escape = false; continue; }
              if (ch === '\\') { escape = true; continue; }
              if (ch === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
              }
            }
            if (end === -1) throw new Error('Unmatched braces');
            s = s.substring(start, end + 1);
            try { return JSON.parse(s); } catch {}
            s = s.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            try { return JSON.parse(s); } catch {}
            let oneLine = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
            oneLine = oneLine.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            return JSON.parse(oneLine);
          }

          resolve(robustJsonParse(raw));
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
      const overloaded = e.message && (e.message.includes('Overloaded') || e.message.includes('529') || e.message.includes('503'));
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

  const repairSYS = `${SYS}\n\nREPAIR MODE\nRepair the draft without flattening it. Keep the layered architecture. Remove astrology labels from prose. Strengthen structural complexity where the draft has become too simple.`;
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
    JSON.stringify(reading)
  ].join('\n');

  try {
    return await callAnthropic(repairSYS, repairPrompt, 2);
  } catch {
    return reading;
  }
}

function textToHtml(text) {
  const bodyHtml = text.split('\n\n').map(p => {
    if (p.includes('https://chadherst.as.me/30-minute-consult-chad-herst')) {
      return `<tr><td align="center" style="padding:24px 0;"><a href="https://chadherst.as.me/30-minute-consult-chad-herst" style="display:inline-block; font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; letter-spacing:0.15em; text-transform:uppercase; padding:14px 36px; border:1px solid #8B6B1E; color:#8B6B1E; text-decoration:none;">Book a 30-minute conversation</a></td></tr>`;
    }
    return `<tr><td style="padding:0 0 20px 0; font-family:'Cormorant Garamond',Georgia,serif; font-size:17px; line-height:1.9; color:#352515;">${p.replace(/\n/g, '<br>')}</td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap');</style>
</head>
<body style="margin:0; padding:0; background-color:#F4EDE4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4EDE4;">
    <tr><td align="center" style="padding:40px 20px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
        <tr><td align="center" style="padding:0 0 32px 0; border-bottom:1px solid #8B6B1E;"><img src="${LOGO_URL}" alt="Herst Wellness" width="600" style="display:block; margin:0 auto; width:100%; max-width:600px; height:auto;" /></td></tr>
        <tr><td style="padding:20px 0 0 0;">&nbsp;</td></tr>
        <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${bodyHtml}</table></td></tr>
        <tr><td align="center" style="padding:40px 0 20px 0; border-top:1px solid #E8DED3;"><img src="${LOGO_URL}" alt="Herst Wellness" width="200" style="display:block; margin:0 auto 16px auto; max-width:200px; height:auto;" /><p style="font-family:'Cormorant Garamond',Georgia,serif; font-size:12px; color:#4F4130; margin:0 0 8px 0; line-height:1.6;">765 Market St, San Francisco, CA 94103<br>(415) 686-4411 &middot; <a href="mailto:chad@herstwellness.com" style="color:#8B6B1E; text-decoration:none;">chad@herstwellness.com</a></p><p style="font-family:'Cormorant Garamond',Georgia,serif; font-size:12px; color:#4F4130; margin:0;"><a href="https://map.herstwellness.com" style="color:#8B6B1E; text-decoration:none;">map.herstwellness.com</a></p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function sendResendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html });
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
      res.on('end', () => resolve({ ok: res.statusCode < 300 }));
    });
    req.on('error', reject);
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
    setTimeout(async () => {
      try { await sendResendEmail(email, EMAIL2.subject, textToHtml(EMAIL2.text)); } catch {}
    }, 2 * 24 * 60 * 60 * 1000);
    setTimeout(async () => {
      try { await sendResendEmail(email, EMAIL3.subject, textToHtml(EMAIL3.text)); } catch {}
    }, 5 * 24 * 60 * 60 * 1000);
  } catch (e) {
    console.error('Nurture sequence error:', e.message);
  }
}

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Accept: 'application/json', ...headers } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
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
        const geoData = await fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
          'User-Agent': 'PerformanceTrapApp/1.0'
        });

        if (!geoData.length) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: `Could not find "${city}". Try: "San Rafael, California, USA"` }));
          return;
        }

        const lat = parseFloat(geoData[0].lat);
        const lon = parseFloat(geoData[0].lon);
        const chart = buildChart(date, time, parseFloat(tz), lat, lon);
        const text = chartToText(chart, name);
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
          '- Keep the story clear, but not simplistic.',
          '- Let multiple dimensions of the chart stay alive in each section when appropriate.',
          '- Do not flatten the person into one theme.',
          '- Make the performance feel like a system, not a single trick.',
          '- Make the mask brilliantly useful, so the defense is hard to recognize.',
          '- Make Contact feel like the structure is showing its seams.',
          '- Make A New Response feel like less interference, not better management.',
          '- No astrology labels in prose.',
          '- All astrology goes in the placements arrays only.'
        ].join('\n');

        let [reading] = await Promise.all([
          callAnthropic(SYS, userPrompt),
          addToMailchimp(email, name)
        ]);

        reading = await repairReadingIfNeeded(reading, text, transitPrompt, name);

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
        const ttsBody = JSON.stringify({ model: 'tts-1', voice: 'echo', input: text.substring(0, 4096), speed: 1.25 });
        const ttsReq = https.request({
          hostname: 'api.openai.com',
          path: '/v1/audio/speech',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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

        const expandSYS = `You are expanding a Performance Trap reading for PDF. Same voice. Same person. Keep the layered architecture. No astrology labels in prose. No spiritual bypassing. No romanticizing. Expand the existing reading, do not reinvent it. Respond with valid JSON only.`;

        const readingText = [
          `Person: ${name}, born ${birthDate}, ${birthCity}`,
          '',
          ...(reading.sections || []).map(s => `${s.title.toUpperCase()}\n${s.content}`),
          ...(reading.way_home || []).map(s => `${s.title.toUpperCase()}\n${s.content}`),
          '',
          `Closing: ${reading.closing || ''}`,
          `Transits: ${(reading.transits && reading.transits.synthesis) || ''}`
        ].join('\n\n');

        const reqBody = JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8096,
          system: expandSYS,
          messages: [{ role: 'user', content: 'Expand this reading into a long-form PDF version.\n\n' + readingText }]
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
              if (a.error) throw new Error(a.error.message);
              const raw = a.content?.[0]?.text || '';
              let expanded;
              try { expanded = JSON.parse(raw); }
              catch { expanded = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
              res.writeHead(200);
              res.end(JSON.stringify({ expanded }));
            } catch (e) {
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
