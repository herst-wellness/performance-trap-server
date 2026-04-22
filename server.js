const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAILCHIMP_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_LIST_ID = process.env.MAILCHIMP_LIST_ID;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER_PREFIX || 'us6';

// ── LOGO URL (served as static file from /public) ─────────────
const BASE_URL = 'https://performance-trap-server.onrender.com';
const AUDIO_BASE_URL = 'https://pub-3e45b3813f2d4b1b81f913aad060a3b8.r2.dev/audio';
const LOGO_URL = BASE_URL + '/Herst-Wellness-Logo-cropped.jpg';
const CHAPTER_ONE_AUDIO_URL = BASE_URL + '/audio/chapter-one.mp3';
const LISTEN_PAGE_URL = BASE_URL + '/listen/chapter-one';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

// ── STATIC FILE SERVING ────────────────────────────────────────
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css',
  '.js':  'text/javascript',
  '.mp3': 'audio/mpeg',
   '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
};

function serveStatic(req, res) {
  const publicDir = path.join(__dirname, 'public');
  const filePath = path.join(publicDir, req.url);
  // Security: ensure we don't serve files outside public/
  if (!filePath.startsWith(publicDir)) { return false; }
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { return false; }
  } catch { return false; }
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

// ── VSOP87 TRUNCATED EPHEMERIS ─────────────────────────────────
// Accurate to ~1 arcminute for dates 1900-2100
// Based on Meeus "Astronomical Algorithms" 2nd ed.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const md = x => ((x % 360) + 360) % 360;

function jd(y, m, d, h) {
  let Y = y, M = m, D = d + h / 24;
  if (M <= 2) { Y--; M += 12; }
  const A = Math.floor(Y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + D + B - 1524.5;
}

// Nutation and aberration correction for the Sun
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

// Moon (Meeus Ch. 47, truncated)
function moonLon(T) {
  const Lp = md(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  const D  = md(297.8501921 + 445267.1114034  * T - 0.0018819 * T * T) * D2R;
  const M  = md(357.5291092 + 35999.0502909   * T - 0.0001536 * T * T) * D2R;
  const Mp = md(134.9633964 + 477198.8675055  * T + 0.0087414 * T * T) * D2R;
  const F  = md(93.2720950  + 483202.0175233  * T - 0.0036539 * T * T) * D2R;
  let s = 0;
  [[6.288774,[0,0,1,0]],[1.274027,[2,0,-1,0]],[0.658314,[2,0,0,0]],
   [0.213618,[0,0,2,0]],[-0.185116,[0,1,0,0]],[-0.114332,[0,0,0,2]],
   [0.058793,[2,0,-2,0]],[0.057066,[2,-1,-1,0]],[0.053322,[2,0,1,0]],
   [0.045758,[2,-1,0,0]],[-0.040923,[0,1,-1,0]],[-0.034720,[1,0,0,0]],
   [-0.030383,[0,1,1,0]],[0.015327,[2,0,0,-2]],[0.010980,[0,0,1,-2]],
   [0.010675,[4,0,-1,0]],[0.010034,[0,0,3,0]],[0.008548,[4,0,-2,0]],
   [-0.007888,[2,1,-1,0]],[-0.006766,[2,1,0,0]],[-0.005163,[1,0,-1,0]],
   [0.004987,[1,1,0,0]],[0.004036,[2,-1,1,0]],[0.003994,[2,0,3,0]]
  ].forEach(([a,[dD,dM,dMp,dF]]) => { s += a * Math.sin(dD*D + dM*M + dMp*Mp + dF*F); });
  return md(Lp + s);
}

// Planetary heliocentric longitudes using full Keplerian + perturbations
// Using improved orbital elements valid 1800-2050 from Meeus Table 33.a
function planetHelio(planet, T) {
  const el = {
    mercury: { L: [252.250906, 149474.0722491, 0.0003035, 0.000000018],
               e: [0.20563175, 0.000020406, -0.0000000284, -0.00000000017],
               w: [77.45645, 0.1600388, 0.00046975, 0.000000560] },
    venus:   { L: [181.979801, 58519.2130302, 0.00031014, 0.000000015],
               e: [0.00677188, -0.000047766, 0.0000000975, 0.00000000044],
               w: [131.563707, 1.4022188, -0.00107377, -0.000005765] },
    earth:   { L: [100.466456, 36000.7698278, 0.00030322, 0.000000020],
               e: [0.01670862, -0.000042037, -0.0000001236, 0.00000000004],
               w: [102.937348, 1.7195269, 0.00045962, 0.000000499] },
    mars:    { L: [355.433275, 19141.6964746, 0.00031097, 0.000000015],
               e: [0.09340062, 0.000090483, -0.0000000806, -0.00000000035],
               w: [336.060234, 1.8410449, 0.00013477, 0.000000536] },
    jupiter: { L: [34.351484, 3036.3027748, 0.00022330, 0.000000037],
               e: [0.04849485, 0.000163244, -0.0000004719, -0.00000000197],
               w: [14.331309, 1.6120730, 0.00103200, -0.000004270] },
    saturn:  { L: [50.077444, 1223.5110686, 0.00051908, -0.000000030],
               e: [0.05550825, -0.000346641, -0.0000006452, 0.00000000638],
               w: [93.056787, 1.9637694, 0.00083757, 0.000004899] },
    uranus:  { L: [314.055005, 429.8640561, 0.00030434, 0.000000026],
               e: [0.04629590, -0.000027337, 0.0000000790, 0.000000000025],
               w: [173.005159, 1.4863784, 0.00021450, 0.000000433] },
    neptune: { L: [304.348665, 219.8833092, 0.00030926, 0.000000018],
               e: [0.00898809, 0.000006408, -0.0000000008],
               w: [48.123691, 1.4262677, 0.00037918, -0.000000003] },
    pluto:   { L: [238.92903833, 145.20780515, 0.0],
               e: [0.24882730, 0.000006, 0.0],
               w: [224.06891629, 1.555029, 0.0] },
  };

  const p = el[planet];
  if (!p) return 0;

  const poly = (coeffs) => coeffs.reduce((sum, c, i) => sum + c * Math.pow(T, i), 0);

  const L = md(poly(p.L));
  const e = poly(p.e);
  const w = poly(p.w); // longitude of perihelion
  const M = md(L - w);
  const Mrad = M * D2R;

  // Kepler's equation
  let E = Mrad;
  for (let i = 0; i < 50; i++) {
    const dE = (Mrad - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }

  // True anomaly
  const v = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)) * R2D;
  return md(v + w); // heliocentric longitude
}

// Convert heliocentric to geocentric using Earth's position
function helioToGeo(planetLon_h, planetDist, earthLon_h, earthDist) {
  const pl = planetLon_h * D2R;
  const el = earthLon_h * D2R;
  const x = planetDist * Math.cos(pl) - earthDist * Math.cos(el);
  const y = planetDist * Math.sin(pl) - earthDist * Math.sin(el);
  return md(Math.atan2(y, x) * R2D);
}

// Approximate heliocentric distance
function helioRadius(planet, T) {
  const semi = { mercury: 0.387098, venus: 0.723330, earth: 1.000001, mars: 1.523692,
                 jupiter: 5.202603, saturn: 9.554909, uranus: 19.21845, neptune: 30.11039, pluto: 39.48 };
  const ecc =  { mercury: 0.20563, venus: 0.00677, earth: 0.01671, mars: 0.09340,
                 jupiter: 0.04849, saturn: 0.05551, uranus: 0.04630, neptune: 0.00899, pluto: 0.24883 };
  const a = semi[planet] || 1;
  const e = ecc[planet] || 0;
  // Mean distance approximation
  return a * (1 - e * e / 2);
}

// North Node (mean)
function nnLon(T) {
  return md(125.04452 - 1934.136261 * T + 0.0020708 * T * T);
}

// Chiron: use proper orbital elements
function chironLon(T) {
  const jd_val = T * 36525 + 2451545;
  const a = 13.633, e = 0.3787;
  const n = 360 / (50.7 * 365.25); // mean motion deg/day
  const t_peri = 2450128; // JD of perihelion
  const M = md(n * (jd_val - t_peri));
  const Mrad = M * D2R;
  let E = Mrad;
  for (let i = 0; i < 50; i++) {
    const dE = (Mrad - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  const v = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)) * R2D;
  const w_peri = 185.11; // calibrated perihelion longitude (ecliptic)
  const hLon = md(v + w_peri);
  const earthLon = planetHelio('earth', T);
  const earthR = helioRadius('earth', T);
  const chironR = a * (1 - e * Math.cos(E));
  return helioToGeo(hLon, chironR, earthLon, earthR);
}

// Retrograde check (based on speed - approximate)
function isRetrograde(planet, T, dt = 0.5) {
  if (planet === 'sun' || planet === 'moon') return false;
  const before = calcGeoLon(planet, T - dt/36525);
  const after = calcGeoLon(planet, T + dt/36525);
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
  const planets = ['sun','moon','mercury','venus','mars','jupiter','saturn','uranus','neptune','pluto','node','chiron'];
  const result = {};
  for (const p of planets) {
    let lon = calcGeoLon(p, T);
    const retro = (p !== 'sun' && p !== 'moon' && p !== 'node') ? isRetrograde(p, T) : false;
    result[p] = { lon, retrograde: retro };
  }
  return result;
}

const SGN = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
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
  const cosRAMC = Math.cos(RAMC), sinRAMC = Math.sin(RAMC);
  const cosEps = Math.cos(eps), sinEps = Math.sin(eps);
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
  let u = h + mn / 60 - tz, dd = d, mm = m, yy = y;
  if (u < 0) { u += 24; dd--; }
  if (u >= 24) { u -= 24; dd++; }
  const jdVal = jd(yy, mm, dd, u);
  const T = (jdVal - 2451545) / 36525;
  const asc = calcAsc(jdVal, lat, lon);
  const ascIdx = Math.floor(asc / 30);
  const mc = calcMC(jdVal, lon);
  const planets = calcAllPlanets(T);

  const NAMES = {
    sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars',
    jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune',
    pluto: 'Pluto', node: 'North Node', chiron: 'Chiron'
  };

  const chart = {};
  for (const [key, val] of Object.entries(planets)) {
    const s = toSign(val.lon);
    chart[NAMES[key]] = {
      sign: s.sign, deg: s.deg, lon: s.lon,
      house: wsh(val.lon, ascIdx),
      retrograde: val.retrograde
    };
  }
  chart['ASC'] = { ...toSign(asc), house: null, retrograde: false };
  chart['MC'] = { ...toSign(mc), house: null, retrograde: false };

  return chart;
}

function chartToText(chart, name, noTime) {
  const order = noTime
    ? ['Sun','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','North Node','Chiron']
    : ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','North Node','Chiron'];
  const lines = order.map(k => {
    const v = chart[k];
    if (!v) return '';
    const r = v.retrograde ? ' RETROGRADE' : '';
    if (noTime) {
      return `${k}: ${v.sign} ${v.deg}°${r}`;
    }
    return `${k}: ${v.sign} ${v.deg}°${r} · House ${v.house}`;
  }).filter(Boolean);

  if (!noTime) {
    lines.push(`ASC: ${chart['ASC'].sign} ${chart['ASC'].deg}° (Whole Sign Houses — ${chart['ASC'].sign} is House 1)`);
    lines.push(`MC: ${chart['MC'].sign} ${chart['MC'].deg}°`);
  }

  // Add prominent retrograde summary
  const retrogrades = order.filter(k => chart[k] && chart[k].retrograde);
  if (retrogrades.length) {
    lines.push('');
    lines.push('RETROGRADE PLANETS (must be interpreted as retrograde in the reading):');
    retrogrades.forEach(k => {
      const v = chart[k];
      const houseStr = noTime ? '' : ` · House ${v.house}`;
      lines.push(`  ${k} RETROGRADE in ${v.sign}${houseStr} — energy works INWARD, must be named as retrograde`);
    });
  }

  if (noTime) {
    lines.push('');
    lines.push('IMPORTANT: This person does NOT know their exact birth time. The chart was calculated using noon as a placeholder. This means:');
    lines.push('  - The Ascendant is UNKNOWN. Do NOT reference rising sign or Ascendant.');
    lines.push('  - All HOUSE PLACEMENTS are UNKNOWN. Do NOT reference houses (1st, 2nd, 6th, 7th, etc.) anywhere in the reading.');
    lines.push('  - Work entirely from SIGNS and ASPECTS. Build the reading around what each planet is doing in its sign and what aspects connect them.');
    lines.push('  - At the START of the Essence section, briefly acknowledge: "Because you don\'t know your exact birth time, this reading works from the planetary signs and their aspects rather than the houses. The pattern is still here — it just shows up in what you\'re reaching for, what holds you back, and what wants out, rather than which areas of life they play in."');
    return `${name}'s Chart (NO BIRTH TIME — signs and aspects only):\n${lines.join('\n')}`;
  }

  return `${name}'s Chart (Whole Sign Houses):\n${lines.join('\n')}`;
}

function calcNatalAspects(chart, noTime) {
  const ASPECT_TYPES = [
    { name: 'conjunction', angle: 0, orb: 8 },
    { name: 'sextile', angle: 60, orb: 6 },
    { name: 'square', angle: 90, orb: 8 },
    { name: 'trine', angle: 120, orb: 8 },
    { name: 'opposition', angle: 180, orb: 8 },
  ];

  const bodies = noTime
    ? ['Sun','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','North Node','Chiron']
    : ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','North Node','Chiron','ASC','MC'];
  const aspects = [];

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = chart[bodies[i]];
      const b = chart[bodies[j]];
      if (!a || !b || a.lon === undefined || b.lon === undefined) continue;

      let diff = Math.abs(a.lon - b.lon);
      if (diff > 180) diff = 360 - diff;

      for (const asp of ASPECT_TYPES) {
        const orbActual = Math.abs(diff - asp.angle);
        // Tighter orbs for minor bodies and angles
        let maxOrb = asp.orb;
        if (['North Node','Chiron','ASC','MC'].includes(bodies[i]) || ['North Node','Chiron','ASC','MC'].includes(bodies[j])) {
          maxOrb = Math.min(maxOrb, 5);
        }
        if (orbActual <= maxOrb) {
          aspects.push({
            body1: bodies[i],
            body2: bodies[j],
            type: asp.name,
            orb: Math.round(orbActual * 100) / 100,
            exact: orbActual < 1
          });
          break; // only one aspect type per pair
        }
      }
    }
  }

  // Sort by orb (tightest first)
  aspects.sort((a, b) => a.orb - b.orb);
  return aspects;
}

function aspectsToText(aspects, chart) {
  if (!aspects.length) return 'No major aspects found.';

  const lines = ['NATAL ASPECTS (sorted tightest first):'];
  aspects.forEach(a => {
    const tight = a.orb < 1 ? ' *** VERY TIGHT' : a.orb < 3 ? ' ** TIGHT' : '';
    const r1 = (chart[a.body1] && chart[a.body1].retrograde) ? ' (R)' : '';
    const r2 = (chart[a.body2] && chart[a.body2].retrograde) ? ' (R)' : '';
    lines.push(`  ${a.body1}${r1} ${a.type} ${a.body2}${r2} (orb ${a.orb}°)${tight}`);
  });

  lines.push('');
  lines.push('IMPORTANT: Use ONLY these aspects in your reading. Do NOT invent aspects that are not listed here. When citing an aspect, use the EXACT orb from this list. The tightest aspects (marked ** or ***) produce the most vivid patterns and should be prioritized.');

  return lines.join('\n');
}

// ── MAILCHIMP ──────────────────────────────────────────────────
function addToMailchimp(email, firstName) {
  return new Promise((resolve) => {
    const parts = firstName.trim().split(' ');
    const fname = parts[0] || firstName;
    const lname = parts.slice(1).join(' ') || '';
    const body = JSON.stringify({ email_address: email, status: 'subscribed', merge_fields: { FNAME: fname, LNAME: lname } });
    const auth = Buffer.from(`anystring:${MAILCHIMP_KEY}`).toString('base64');
    const req = https.request({
      hostname: `${MAILCHIMP_SERVER}.api.mailchimp.com`,
      path: `/3.0/lists/${MAILCHIMP_LIST_ID}/members/${require('crypto').createHash('md5').update(email.toLowerCase()).digest('hex')}`,
      method: 'PUT'
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          console.log('Mailchimp status:', res.statusCode, JSON.stringify(r).substring(0, 200));
        } catch(e) { console.log('Mailchimp raw:', d.substring(0, 200)); }
        resolve({ ok: true });
      });
    });
    req.on('error', e => { console.log('Mailchimp error:', e.message); resolve({ ok: true }); });
    req.write(body); req.end();
  });
}

// ── ANTHROPIC ──────────────────────────────────────────────────
function callAnthropicOnce(system, userMsg) {
  const body = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 10000, system, messages: [{ role: 'user', content: userMsg }] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          // Handle non-JSON responses (XML errors, HTML error pages, etc)
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
          let reading;

          // Robust JSON extraction: handle markdown fences, literal newlines,
          // unescaped quotes inside string values, and other Claude quirks.
          function robustJsonParse(text) {
            // Strip markdown fences
            let s = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();

            // Extract the outermost { ... } by brace matching
            const start = s.indexOf('{');
            if (start === -1) throw new Error('No JSON object found');
            let depth = 0, end = -1;
            let inString = false, escape = false;
            for (let i = start; i < s.length; i++) {
              const ch = s[i];
              if (escape) { escape = false; continue; }
              if (ch === '\\') { escape = true; continue; }
              if (ch === '"' && !escape) { inString = !inString; continue; }
              if (inString) continue;
              if (ch === '{') depth++;
              else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
            }
            if (end === -1) throw new Error('Unmatched braces');
            s = s.substring(start, end + 1);

            // Try parsing as-is first
            try { return JSON.parse(s); } catch(e) { console.log('First parse attempt:', e.message); }

            // Fix trailing commas before ] or } (common Claude mistake)
            s = s.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            try { return JSON.parse(s); } catch(e) { console.log('After trailing comma fix:', e.message); }

            // Fix common issues: literal newlines and tabs inside string values
            // Walk character by character and fix newlines/tabs only when inside strings
            let result = '';
            inString = false;
            escape = false;
            for (let i = 0; i < s.length; i++) {
              const ch = s[i];
              if (escape) { result += ch; escape = false; continue; }
              if (ch === '\\') { result += ch; escape = true; continue; }
              if (ch === '"') { inString = !inString; result += ch; continue; }
              if (inString) {
                if (ch === '\n') { result += '\\n'; continue; }
                if (ch === '\r') { result += '\\r'; continue; }
                if (ch === '\t') { result += '\\t'; continue; }
              }
              result += ch;
            }

            // Also fix trailing commas in the newline-fixed version
            result = result.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            try { return JSON.parse(result); } catch(e) { console.log('Second parse attempt:', e.message); }

            // Last resort: collapse everything to one line, replacing newlines with spaces
            let oneLine = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
            oneLine = oneLine.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            return JSON.parse(oneLine);
          }

          reading = robustJsonParse(raw);
          console.log('Reading parsed successfully, trap_name:', reading.trap_name || 'unknown');
          console.log('Fields present:', Object.keys(reading).join(', '));
          console.log('sections count:', (reading.sections||[]).length);
          console.log('way_home count:', (reading.way_home||[]).length);
          console.log('has sacred_wound:', !!reading.sacred_wound);
          console.log('has closing:', !!reading.closing);
          resolve(reading);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function callAnthropic(system, userMsg, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await callAnthropicOnce(system, userMsg);
    } catch(e) {
      const isOverloaded = e.message && (e.message.includes('Overloaded') || e.message.includes('overloaded') || e.message.includes('529') || e.status === 529 || e.status === 503);
      if (isOverloaded && attempt < retries) {
        const wait = attempt * 8000;
        console.log(`Anthropic overloaded, retry ${attempt}/${retries} in ${wait/1000}s...`);
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
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'Accept': 'application/json', ...headers } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

// ── TRANSIT WEATHER ───────────────────────────────────────────
function calcTransitWeather(natalChart) {
  const now = new Date();
  const todayJD = jd(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), 0);
  const T = (todayJD - 2451545) / 36525;
  const today = now.toISOString().split('T')[0];

  const ascLon = natalChart['ASC'] ? natalChart['ASC'].lon : 0;
  const ascSignIdx = Math.floor(ascLon / 30);

  const planets = {
    Saturn:  calcGeoLon('saturn',  T),
    Pluto:   calcGeoLon('pluto',   T),
    Neptune: calcGeoLon('neptune', T),
    Uranus:  calcGeoLon('uranus',  T),
  };

  const SGN_NAMES = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];

  const weather = {};
  for (const [name, lon] of Object.entries(planets)) {
    const signIdx = Math.floor(md(lon) / 30);
    const sign = SGN_NAMES[signIdx];
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
      if (Math.abs(diff - 0) <= orb)   aspects.push({ planets: [n1, n2], type: 'conjunction', diff });
      if (Math.abs(diff - 60) <= orb)  aspects.push({ planets: [n1, n2], type: 'sextile', diff });
      if (Math.abs(diff - 90) <= orb)  aspects.push({ planets: [n1, n2], type: 'square', diff });
      if (Math.abs(diff - 120) <= orb) aspects.push({ planets: [n1, n2], type: 'trine', diff });
      if (Math.abs(diff - 180) <= orb) aspects.push({ planets: [n1, n2], type: 'opposition', diff });
    }
  }
  return aspects;
}

function formatTransitsForPrompt(transitData, natalChart) {
  const { weather, today } = transitData;
  const lines = [`TODAY: ${today}`, ''];
  lines.push('CURRENT OUTER PLANET POSITIONS (whole sign houses for this natal chart):');
  for (const [name, data] of Object.entries(weather)) {
    lines.push(`${name}: ${data.sign} ${data.deg}° — currently in natal House ${data.house}`);
  }
  lines.push('');
  const aspects = calcAspects(weather);
  if (aspects.length > 0) {
    lines.push('');
    lines.push('CURRENT ASPECTS BETWEEN OUTER PLANETS:');
    const aspectDescriptions = {
      'conjunction': 'merged — amplifying each other',
      'sextile': 'flowing — supporting each other',
      'square': 'in friction — creating pressure and tension',
      'trine': 'harmonious — easing movement',
      'opposition': 'in opposition — pulling in different directions'
    };
    aspects.forEach(a => {
      lines.push(`${a.planets[0]} and ${a.planets[1]}: ${a.type} (${aspectDescriptions[a.type]})`);
    });
  }
  lines.push('');
  lines.push(`FOR THE transits.synthesis FIELD: Write ONE paragraph of 4-6 sentences in Chad Herst's voice. DO NOT name any planets, signs, or houses. DO NOT use any astrological terminology whatsoever. Translate everything into plain human experience. Describe: (1) what this person is up against right now in their life — the specific pressure or friction they are likely feeling, (2) how that pressure relates directly to the performance trap this reading just named, and (3) what their growing edge is in this moment — not as inspiration, but as honest description of what is being asked of them. Ground it in the body and in relationship. Short sentences. No comfort. No astrology.`);
  return lines.join('\n');
}


const SYS = `You are writing a natal chart reading through Chad Herst's Performance Trap framework.

This is not a personality summary. It is the story of how an intelligent nervous system solved an impossible problem — and what it has been carrying ever since.

DELIVERY PRINCIPLES:
1. Translate before you explain. Build the felt experience first — then let the chart confirm it.
2. Surface the objection. Walk into "but isn't that just my personality?" and answer it.
3. Keep the stakes visible. What does this feel like on a Tuesday?
4. Earn the astrology. When the reading works, they think "that's me."

VOICE:
- Direct, human, restrained. Clear over clever.
- Somatic when earned. Short to medium sentences.
- Never call trauma a gift. Never romanticize the wound. Never use "gift."

ASTROLOGY IN THE PROSE:
Name placements directly. Use sign names, planet names, house numbers, aspects with orbs. The reading should feel like a practitioner referencing the chart as they speak.

But TRANSLATE BEFORE YOU EXPLAIN. Build the felt experience first, then name the placement that confirms it. The astrology arrives as confirmation, not as a door the reader has to push through.

CRITICAL — ASPECTS:
You receive a list of NATAL ASPECTS calculated from actual chart positions, sorted by orb. USE ONLY THESE ASPECTS. Do NOT invent, guess, or assume aspects not in the list. If an aspect is not listed, it does not exist. When citing an aspect, use the EXACT orb from the list — do not approximate.

If a key aspect (like Saturn-Moon) does NOT appear in the list, do not pretend it exists. Look for alternative connections — Saturn in the Moon's sign, same element, etc. Name what IS there.

CRITICAL — RETROGRADES:
When a planet is marked RETROGRADE in the chart data, you MUST interpret it as retrograde. Retrograde energy works INWARD first. This fundamentally changes how the planet operates and must be named in the reading.

Specific retrograde interpretations:
- Mars retrograde: Force turned INWARD. NOT direct or straightforward. The person does not lack fire — they have an inferno directed at themselves. The override mobilizes through internal acceleration, self-interrogation before action. Do NOT describe Mars Rx as "a direct impulse" or "honest straightforward energy." It is the opposite.
- Saturn retrograde: The enforcer is a deeply PRIVATE INTERNAL voice, not external authority. It has been running so long it feels like architecture, not pattern. The person self-polices before anyone else has a chance to.
- Chiron retrograde: The wound is SELF-INFLICTED in the sense that it's about what you did to yourself to belong, not what others did to you. The ways you tamped down your own initiative, anger, raw selfhood.
- Mercury retrograde: Communication turns inward — the person processes and reprocesses internally, may struggle to externalize their most important truths.
- Venus retrograde: Desire and value systems are internalized and revisited — the person may question whether they deserve what they want.

CRITICAL — ASPECT INTERPRETATIONS TO INCLUDE:
- Saturn-Pluto aspects: The enforcer bonded to survival-level stakes. The conviction that losing control — letting the mask slip — would be genuinely dangerous. Not just interpersonally but existentially. The override feels absolute.
- Sun-Neptune conjunctions: Identity dissolves into others' needs. Idealization in relationship. Confusion about where you end and others begin. In the 7th house, this is the performance trap's most intimate expression.
- Mars-Uranus oppositions: The override in its most volatile form. Fine, fine, fine — then a sudden eruptive move. Job quit without notice, relationship ended in a flash. Not impulsiveness but the body's emergency broadcast system.
- Mercury-Jupiter squares: The precise reading overridden by the generous interpretation. Doubting your own accurate perception in favor of a more expansive, optimistic narrative.

HOW TO ACHIEVE DEPTH:

RULE 1 — SHOW MECHANISMS, NOT JUST PATTERNS.
Don't name the pattern and move on. Show how it operates internally — the split-second recalculation, the monitoring, what triggers it, what the body does before the mind registers.

RULE 2 — NAME THE ENFORCER'S SPECIFIC VOICE.
Saturn's sign and house produce a specific internal monologue. Write the exact sentences. Saturn in Cancer = "You must not be a burden. Your hunger for being held, for being soft, is what will drive people away." Make it so specific the reader's stomach drops.

RULE 3 — WORK WITH THE TIGHT ASPECTS.
The tightest aspects (*** and **) produce the most vivid life patterns. Translate each into a recognizable experience the person will immediately identify.

RULE 4 — BUILD EACH INSIGHT IN LAYERS.
Layer 1: What the original quality was (sign). Layer 2: Where it lives (house). Layer 3: What the person does with it now (cost).

RULE 5 — DEVELOP KEY INSIGHTS, DON'T STATE AND MOVE ON.
When you land on a sharp insight — "one-way valve," "see through others but never let them see through you" — do NOT state it once and move past. Give it 2-3 sentences of unpacking. Show what it looks like in daily life. Let it land.

RULE 6 — END SECTIONS WITH DIAGNOSTIC QUESTIONS.
"What quality did you learn to suppress first?"
"What does the enforcer's voice say to you?"
"When the anxiety spikes, what do you do?"

RULE 7 — NAME WHAT WENT UNDERGROUND (12th house).
12th house sign and any planets — what got buried in service of the performance.

RULE 8 — VERIFY ORBS AGAINST THE DATA.
When citing any aspect with an orb, copy the EXACT orb from the aspects list. Do not round, estimate, or invent orb values.

STELLIUMS: If 3+ planets share a sign or house, note it.

KEY TERMS: 3 per section (3-7 words). Plain, memorable, specific.

WHOLE SIGN HOUSES. ASC sign = House 1.

WORD BUDGET: 3000-4000 words across all sections.

===

STRUCTURE

BEFORE WE BEGIN (as "intro" field):
"This is your performance trap, mapped from the moment you arrived. It's not a horoscope. It's a reading of how you built your trap of performance, who you had to become to belong. It will show you the cost you've been living with, and it will also show you the path forward. Read slowly. Let the body respond before the mind organizes."

HOW YOUR PERFORMANCE TRAP FORMED

01 ESSENCE — The original signal
PLANETS: Moon sign + house (primary), Venus sign + house, chart ruler if original. Stelliums if relevant. If Moon is retrograde, interpret as retrograde.
What did this nervous system reach for before adaptation? Essence is pre-armor. Do NOT include adaptive language.
3-5 paragraphs. End by setting up what went wrong.

02 THE MISS — How you were missed
PLANETS: 4th house/IC, Saturn sign + house (interpret retrograde if applicable), Saturn-Moon aspects (CHECK THE LIST — if none exists, say so and describe alternative connection), Mercury + aspects, Neptune/Pluto/Uranus aspects from list. Saturn-Pluto aspects if in list (survival-level stakes).
NAME THE ENFORCER'S SPECIFIC VOICE. Include BOTH misattunement AND mixed signals.
3-5 paragraphs.

03 THE PERFORMANCE — What you learned to become
PLANETS: Ascendant (from INSIDE — the exhaustion of performing), Sun sign + house, Sun-Neptune if in list (identity dissolution), Saturn (structure), Mars sign + house (INTERPRET RETROGRADE — force turned inward, not direct), Saturn-Mars aspects if in list, 6th house, South Node, Mercury.
Show LAYERS of contortion. Work with TIGHT ASPECTS. Develop key insights — don't state and move on.
4-6 paragraphs.

YOUR WAY HOME

04 CONTACT — The way home begins here
PLANETS: Chiron sign + house + aspects (INTERPRET RETROGRADE if applicable — wound is self-inflicted), Moon (returning), Saturn (visible as machinery), Neptune, 12th house, Pluto.
The wound is where the sharpest capacities formed. Name what went underground.
MUST contain at least one real-time scene: "You're in a conversation and you notice yourself calculating how much truth this person can handle before you've even registered what YOU want to say." Concrete, immediate, recognizable.
Contact must be AS DETAILED as Performance. 4-5 paragraphs minimum. End with diagnostic question.

05 A NEW RESPONSE — What becomes possible now
PLANETS: Venus (desire unperformed), Mars freed (INTERPRET what Mars Rx freed looks like — internal before external), 7th house + ruler, Mercury freed, Jupiter, North Node.
What are you still trading? What has the body been sensing? One utterance.
2-3 paragraphs plus utterance.

CLOSING: 3-5 sentences. Old machinery appears. Something less managed becomes possible.

RESPOND WITH ONLY VALID JSON:
{
  "intro": "framing text",
  "sections": [
    {"title": "Essence", "subtitle": "The original signal", "content": "3-5 paragraphs", "key_terms": ["term", "term", "term"]},
    {"title": "The miss", "subtitle": "How you were missed", "content": "3-5 paragraphs", "key_terms": ["term", "term", "term"]},
    {"title": "The performance", "subtitle": "What you learned to become", "content": "4-6 paragraphs", "key_terms": ["term", "term", "term"]}
  ],
  "way_home": [
    {"title": "Contact", "subtitle": "The way home begins here", "content": "4-5 paragraphs minimum", "key_terms": ["term", "term", "term"]},
    {"title": "A new response", "subtitle": "What becomes possible now", "content": "2-3 paragraphs", "utterance": "One sentence", "key_terms": ["term", "term", "term"]}
  ],
  "closing": "3-5 sentences."
}`;

const SYS_NO_TIME = `You are writing a natal chart reading through Chad Herst's Performance Trap framework. This reading is being generated WITHOUT an exact birth time.

CRITICAL CONSTRAINTS — NO BIRTH TIME VERSION:
- The person does NOT know their exact birth time.
- You do NOT have access to: Ascendant, Moon (excluded as unreliable without time), MC, or any houses.
- DO NOT mention the Moon, the rising sign, the Ascendant, the MC, or any houses (1st, 2nd, 3rd, 4th, 5th, 6th, 7th, 8th, 9th, 10th, 11th, 12th) anywhere in the reading.
- Build the reading entirely from: Sun, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Chiron, North Node, and aspects between them.
- The reading maps INTERNAL ARCHITECTURE — the psychological wiring underneath the performance — rather than life areas.

OPENING ACKNOWLEDGMENT:
At the very start of the Essence section, briefly acknowledge (in your own voice, not as a disclaimer): "Without your exact birth time, this reading maps the psychological wiring underneath the performance — the internal architecture — rather than the specific life areas where it shows up. The pattern is still here. It shows up in what you reach for, what holds you back, and what wants out."

This is not a personality summary. It is the story of how an intelligent nervous system solved an impossible problem — and what it has been carrying ever since.

DELIVERY PRINCIPLES:
1. Translate before you explain. Build the felt experience first — then let the chart confirm it.
2. Surface the objection. Walk into "but isn't that just my personality?" and answer it.
3. Keep the stakes visible. What does this feel like on a Tuesday?
4. Earn the astrology. When the reading works, they think "that's me."

VOICE:
- Direct, human, restrained. Clear over clever.
- Somatic when earned. Short to medium sentences.
- Never call trauma a gift. Never romanticize the wound. Never use "gift."

ASTROLOGY IN THE PROSE:
Name placements directly. Use sign names, planet names, aspects with orbs. The reading should feel like a practitioner referencing the chart as they speak.

But TRANSLATE BEFORE YOU EXPLAIN. Build the felt experience first, then name the placement that confirms it. The astrology arrives as confirmation, not as a door the reader has to push through.

CRITICAL — ASPECTS:
You receive a list of NATAL ASPECTS calculated from actual chart positions, sorted by orb. USE ONLY THESE ASPECTS. Do NOT invent, guess, or assume aspects not in the list. If an aspect is not listed, it does not exist. When citing an aspect, use the EXACT orb from the list — do not approximate.

If a key aspect (like Saturn-Moon) does NOT appear in the list, do not pretend it exists — AND remember, you cannot reference the Moon in this reading anyway. Look for alternative Saturn connections: Saturn-Venus (what you learned to deny yourself wanting), Saturn-Sun (the enforcer vs. identity), Saturn-Mercury (the inner voice of restriction). Name what IS there.

CRITICAL — RETROGRADES:
When a planet is marked RETROGRADE in the chart data, you MUST interpret it as retrograde. Retrograde energy works INWARD first.

Specific retrograde interpretations:
- Mars retrograde: Force turned INWARD. NOT direct or straightforward. The person does not lack fire — they have an inferno directed at themselves. The override mobilizes through internal acceleration, self-interrogation before action.
- Saturn retrograde: The enforcer is a deeply PRIVATE INTERNAL voice, not external authority. It has been running so long it feels like architecture, not pattern. The person self-polices before anyone else has a chance to.
- Chiron retrograde: The wound is SELF-INFLICTED in the sense that it's about what you did to yourself to belong, not what others did to you. The ways you tamped down your own initiative, anger, raw selfhood.
- Mercury retrograde: Communication turns inward — the person processes and reprocesses internally, may struggle to externalize their most important truths.
- Venus retrograde: Desire and value systems are internalized and revisited — the person may question whether they deserve what they want.

CRITICAL — ASPECT INTERPRETATIONS TO INCLUDE:
- Saturn-Pluto aspects: The enforcer bonded to survival-level stakes. The conviction that losing control — letting the mask slip — would be genuinely dangerous. Not just interpersonally but existentially. The override feels absolute.
- Sun-Neptune conjunctions: Identity dissolves into others' needs. Idealization in relationship. Confusion about where you end and others begin.
- Mars-Uranus oppositions: The override in its most volatile form. Fine, fine, fine — then a sudden eruptive move. Job quit without notice, relationship ended in a flash. Not impulsiveness but the body's emergency broadcast system.
- Mercury-Jupiter squares: The precise reading overridden by the generous interpretation. Doubting your own accurate perception in favor of a more expansive, optimistic narrative.

HOW TO ACHIEVE DEPTH:

RULE 1 — SHOW MECHANISMS, NOT JUST PATTERNS.
Don't name the pattern and move on. Show how it operates internally — the split-second recalculation, the monitoring, what triggers it, what the body does before the mind registers.

RULE 2 — NAME THE ENFORCER'S SPECIFIC VOICE.
Saturn's sign produces a specific internal monologue. Write the exact sentences. Saturn in Cancer = "You must not be a burden. Your hunger for being held, for being soft, is what will drive people away." Make it so specific the reader's stomach drops.

RULE 3 — WORK WITH THE TIGHT ASPECTS.
The tightest aspects (*** and **) produce the most vivid life patterns. Translate each into a recognizable experience the person will immediately identify.

RULE 4 — BUILD EACH INSIGHT IN LAYERS.
Layer 1: What the original quality was (sign). Layer 2: What the person does with it now (cost). Without houses, replace the "where it lives" layer with a specific body sensation or real-time moment.

RULE 5 — DEVELOP KEY INSIGHTS, DON'T STATE AND MOVE ON.
When you land on a sharp insight — "one-way valve," "see through others but never let them see through you" — do NOT state it once and move past. Give it 2-3 sentences of unpacking. Show what it looks like in daily life. Let it land.

RULE 6 — END SECTIONS WITH DIAGNOSTIC QUESTIONS.
"What quality did you learn to suppress first?"
"What does the enforcer's voice say to you?"
"When the anxiety spikes, what do you do?"

RULE 7 — CONCRETENESS IS NON-NEGOTIABLE.
Without houses to give life-area specificity, every insight MUST be concretized. No abstract psychological language. Every section requires at least ONE real-time scene ("You're in a conversation and you notice yourself…") and at least ONE specific body sensation (tight gut, shallow breath, jaw clench, back of the neck). Do NOT say "this shows up in your relationships" or "this affects your work" — you do not have houses, so you cannot say that. Say instead: "this shows up as the feeling of X" or "this shows up in the moment when you Y."

RULE 8 — VERIFY ORBS AGAINST THE DATA.
When citing any aspect with an orb, copy the EXACT orb from the aspects list. Do not round, estimate, or invent orb values.

STELLIUMS: If 3+ planets share a sign, note it.

KEY TERMS: 3 per section (3-7 words). Plain, memorable, specific.

WORD BUDGET: 3000-4000 words across all sections.

===

STRUCTURE

BEFORE WE BEGIN (as "intro" field):
"What follows is the story of how an intelligent nervous system solved an impossible problem — and what it has been carrying ever since. This does not show a broken person. It shows an extraordinarily capable one — someone whose sharpest capacities were forged in the exact place where adaptation was required. The ache you carry is not proof of failure. It is the signature of a system that kept you alive and connected at a cost you are only now beginning to see. Read slowly. Let the body respond before the mind organizes."

HOW YOUR PERFORMANCE TRAP FORMED

01 ESSENCE — The original signal
PLANETS: Venus sign (what the nervous system valued and reached for), chart ruler (ruler of the Sun sign — shows the organizing principle), any very tight aspects from the inner planets (Mercury, Venus, Mars). Stelliums if relevant.
OPEN WITH THE NO-BIRTH-TIME ACKNOWLEDGMENT (see above).
What did this nervous system reach for before adaptation? Essence is pre-armor. Do NOT include adaptive language.
3-5 paragraphs. End by setting up what went wrong.

02 THE MISS — How you were missed
PLANETS: Saturn sign (interpret retrograde if applicable), Saturn aspects to Venus, Sun, Mercury (the enforcer's reach — use these as substitutes for Saturn-Moon which does not exist in this reading). Chiron sign + aspects. Neptune/Pluto/Uranus aspects from list. Saturn-Pluto aspects if in list (survival-level stakes).
NAME THE ENFORCER'S SPECIFIC VOICE. Include BOTH misattunement AND mixed signals.
3-5 paragraphs.

03 THE PERFORMANCE — What you learned to become
PLANETS: Sun sign, Sun-Neptune if in list (identity dissolution), Saturn (structure), Mars sign (INTERPRET RETROGRADE — force turned inward, not direct), Mars aspects, Saturn-Mars aspects if in list, Mercury.
Show LAYERS of contortion. Work with TIGHT ASPECTS. Develop key insights — don't state and move on.
4-6 paragraphs.

YOUR WAY HOME

04 CONTACT — The way home begins here
PLANETS: Chiron sign + aspects (INTERPRET RETROGRADE if applicable — wound is self-inflicted). Mercury returning (trusting your precise perception again — the generous override stops winning). Venus returning (desire unperformed). Neptune, Pluto for depth work.
The wound is where the sharpest capacities formed.
MUST contain at least one real-time scene: "You're in a conversation and you notice yourself calculating how much truth this person can handle before you've even registered what YOU want to say." Concrete, immediate, recognizable.
Contact must be AS DETAILED as Performance. 4-5 paragraphs minimum. End with diagnostic question.

05 A NEW RESPONSE — What becomes possible now
PLANETS: Venus freed (desire unperformed, not strategic), Mars freed (INTERPRET what Mars Rx freed looks like — internal before external), Mercury freed, Jupiter, North Node sign.
What are you still trading? What has the body been sensing? One utterance.
2-3 paragraphs plus utterance.

CLOSING: 3-5 sentences. Old machinery appears. Something less managed becomes possible.

RESPOND WITH ONLY VALID JSON:
{
  "intro": "framing text",
  "sections": [
    {"title": "Essence", "subtitle": "The original signal", "content": "3-5 paragraphs", "key_terms": ["term", "term", "term"]},
    {"title": "The miss", "subtitle": "How you were missed", "content": "3-5 paragraphs", "key_terms": ["term", "term", "term"]},
    {"title": "The performance", "subtitle": "What you learned to become", "content": "4-6 paragraphs", "key_terms": ["term", "term", "term"]}
  ],
  "way_home": [
    {"title": "Contact", "subtitle": "The way home begins here", "content": "4-5 paragraphs minimum", "key_terms": ["term", "term", "term"]},
    {"title": "A new response", "subtitle": "What becomes possible now", "content": "2-3 paragraphs", "utterance": "One sentence", "key_terms": ["term", "term", "term"]}
  ],
  "closing": "3-5 sentences."
}`;

// ── STYLED EMAIL TEMPLATE ────────────────────────────────────────
function textToHtml(text) {
  const bodyHtml = text.split('\n\n').map(p => {
    // Check if this paragraph contains the booking URL and replace with styled button
    if (p.includes('https://chadherst.as.me/30-minute-consult-chad-herst')) {
      return `<tr><td align="center" style="padding:24px 0;">
        <a href="https://chadherst.as.me/30-minute-consult-chad-herst" style="display:inline-block; font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; letter-spacing:0.15em; text-transform:uppercase; padding:14px 36px; border:1px solid #8B6B1E; color:#8B6B1E; text-decoration:none;">Book a 30-minute conversation</a>
      </td></tr>`;
    }
    return `<tr><td style="padding:0 0 20px 0; font-family:'Cormorant Garamond',Georgia,serif; font-size:17px; line-height:1.9; color:#352515;">` +
      p.replace(/\n/g, '<br>') + `</td></tr>`;
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

          <!-- HEADER / LOGO -->
          <tr>
            <td align="center" style="padding:0 0 32px 0; border-bottom:1px solid #8B6B1E;">
              <img src="${LOGO_URL}" alt="Herst Wellness" width="600" style="display:block; margin:0 auto; width:100%; max-width:600px; height:auto;" />
            </td>
          </tr>

          <!-- SPACER -->
          <tr><td style="padding:20px 0 0 0;">&nbsp;</td></tr>

          <!-- BODY CONTENT -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${bodyHtml}
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
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

// ── RESEND EMAIL SEQUENCE ─────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Chad Herst <chad@herstwellness.com>';

function sendResendEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject: subject,
      html: html
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
    req.on('error', e => { console.error('Resend error:', e.message); reject(e); });
    req.write(body);
    req.end();
  });
}

const EMAIL1 = {
  subject: 'What your reading is actually telling you',
  text: `You just completed a reading that mapped something you've been living inside your whole life.

The reading shows you a pattern. It's not new. You've been running it for decades. But seeing it named, seeing the layers stacked on top of each other — that hits different.

I know because I've lived it. When my brother took his life at twenty, I was sent back to school with no space to grieve — just go, be fine, don't make it harder on your parents. So I learned the role. I became the good kid. And I've been running that role ever since.

Here's what your reading is actually saying:

At some point early on, you learned that just being yourself wasn't enough to stay connected. So you built a face for the room. You learned the role that would keep you safe, keep you loved, keep you belonging.

That role works. It's gotten you far. But it costs something. Every time you showed up as that version of yourself instead of the real one, something inside got left behind. Overridden. Pushed down.

The reading names that role. It's not a flaw. It's brilliant adaptation. Your nervous system learned how to survive in an environment where connection had to be earned.

But here's what the reading can't tell you: what happens when you finally stop performing.

That's the real work. That's where things change.

If you want to hear where this whole framework came from — the day my own performance trap finally cracked — I recorded the first chapter of my book in my own voice. It's twenty-eight minutes. The phone call. My brother. The day everything I'd built started to come apart.

https://performance-trap-server.onrender.com/listen/chapter-one

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

It's not one moment. It's thousands of moments — every time you felt something true and set it aside to stay connected. Every time you chose the relationship over your own truth. That accumulation lives in your body. As tightness. As ache. As something unfinished.

The wound is sacred not because the pain is good. It's sacred because it's precise. It shows you exactly where you've been leaving yourself. And if you stay with it — not fix it, not transcend it, just stay — it becomes a doorway back to yourself.

I spent years trying to meditate it away, stretch past it, yoga it into submission. Then I finally sat still long enough to feel the knot in my gut — that tight, deep thing that had been sitting there for decades — and something in me shifted. Not because it went away. Because I finally stopped running from it.

This is what I wrote a whole book about. It's called The Performance Trap, and it comes out in September. But I'm not making you wait until then.

I'm putting together a small launch team — readers willing to post an honest Amazon review around launch week in exchange for getting the book early. If you join, you get the book right now in whatever format works for you: audio in my own voice (every chapter, just over seven hours), EPUB for your Kindle or e-reader, or PDF for desktop or tablet. Read it at your own pace between now and September.

The only thing I ask is that if it lands for you, you post an honest review on Amazon during launch week. Honest is the word. If it doesn't land for you, say that too. I'd rather have a true two-star than a courteous five.

If you want in:

https://herstwellness.com/launch-team

—Chad`
};

const EMAIL3 = {
  subject: 'If you want to take this further',
  text: `You've had a few days to sit with what your reading showed you.

You know the pattern. You've named it. You can probably feel where it lives in your body — the places you override, the moments you perform, the ways you learned not to need.

But knowing isn't the same as changing.

That's what I want to be clear about.

A reading is a map. It shows you the architecture of how you learned to survive. But a map isn't the territory. And understanding the map doesn't rewire your nervous system.

What does rewire it is contact. With yourself first. Then with someone else who can stay with you long enough that you finally feel met.

The book is the long version of that work. Every chapter is a step in the sequence I walked myself — from the day my mask cracked, through the years of trying to meditate the ache away, to the practices that actually changed something. The whole arc, in my own voice, plus the methods I use with clients now.

If the reading lit something up in you, the book is where to take it next.

I'm putting together a launch team for September. If you join, you get everything right now: the audiobook in my own voice (every chapter, all the way through, just over seven hours), the EPUB for your Kindle or e-reader, and the PDF for desktop or tablet. Read or listen at your own pace.

The only ask is an honest Amazon review around launch week. That's it. If the book lands, say so. If it doesn't, say that too.

https://herstwellness.com/launch-team

If you'd rather skip the book and just talk — I do thirty-minute conversations. No pitch, no homework, just two people sitting with what's actually moving:

https://chadherst.as.me/30-minute-consult-chad-herst

Either way, thanks for being here.

—Chad`
};

const LAUNCH_TEAM_EMAIL = {
  subject: "You're on the launch team",
  text: `Thank you for saying yes to this.

The book is yours. You can read it right now in whatever format works for you: https://herstwellness.com/book

There you'll find Kindle, EPUB, and PDF downloads, plus the audio of every chapter in my voice — opening credits, every chapter, all the way through. Read at your own pace.

One ask. The book comes out publicly in September. Hold your Amazon review until launch week. I'll send you a reminder when the day comes. If the book lands for you, an honest review during that window is the single most useful thing you can do for it. Honest is the word. If it doesn't land for you, say that too. I'd rather have a true two-star than a courteous five.

If you haven't taken the Map yet, it's a personalized reading based on the framework from the book. A good companion piece while you're reading: https://map.herstwellness.com

If this isn't the right time for you and you'd rather not be on the team, just reply and let me know. No hard feelings.

Talk soon,
Chad`
};

const CHAPTER_ONE_EMAIL = {
  subject: 'Chapter One, in my voice',
  text: (listenUrl) => `Listen here: ${listenUrl}

"The Day the Mask Cracked." It's the chapter where the story really begins. The phone call. My brother. The day everything I'd built started to come apart.

It's 28 minutes. You can listen on a walk, in the car, or anywhere you've got room to sit with it.

The book comes out in September. But you can read it now — every chapter, every format, including the audio in my voice. If you're up for posting an honest Amazon review around launch week, the book is yours: https://herstwellness.com/launch-team

Or if you'd rather see how the pattern shows up in your own life first, the Map is here: https://map.herstwellness.com

Either way, thanks for being here.

Chad`
};

async function sendNurtureSequence(email) {
  try {
    // Email 1 — immediately
    await sendResendEmail(email, EMAIL1.subject, textToHtml(EMAIL1.text));
    console.log('Nurture Email 1 sent to', email);

    // Email 2 — 2 days later
    setTimeout(async () => {
      try {
        await sendResendEmail(email, EMAIL2.subject, textToHtml(EMAIL2.text));
        console.log('Nurture Email 2 sent to', email);
      } catch(e) { console.error('Email 2 error:', e.message); }
    }, 2 * 24 * 60 * 60 * 1000);

    // Email 3 — 5 days after Email 1
    setTimeout(async () => {
      try {
        await sendResendEmail(email, EMAIL3.subject, textToHtml(EMAIL3.text));
        console.log('Nurture Email 3 sent to', email);
      } catch(e) { console.error('Email 3 error:', e.message); }
    }, 5 * 24 * 60 * 60 * 1000);

  } catch(e) {
    console.error('Nurture sequence error:', e.message);
  }
}

const server = http.createServer(async (req, res) => {
  // ── STATIC FILES (logo, etc.) ────────────────────────────────
  if (req.method === 'GET' && serveStatic(req, res)) { return; }

  if (req.method === 'GET' && req.url === '/listen/chapter-one') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chapter One — The Performance Trap</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:#F4EDE4; font-family:'Cormorant Garamond',Georgia,serif; color:#352515; }
  .wrap { max-width:600px; margin:0 auto; padding:40px 20px; }
  .logo-top { display:block; width:100%; max-width:600px; height:auto; margin:0 auto; }
  .divider { border:none; border-top:1px solid #8B6B1E; margin:32px 0; }
  h1 { font-family:'Playfair Display',Georgia,serif; font-size:32px; line-height:1.2; color:#352515; margin:0 0 8px 0; font-weight:700; }
  .subtitle { font-family:'Cormorant Garamond',Georgia,serif; font-style:italic; font-size:18px; color:#8B6B1E; margin:0 0 32px 0; letter-spacing:0.05em; }
  p { font-size:18px; line-height:1.9; margin:0 0 20px 0; }
  .player-wrap { background:#EFE6D8; border:1px solid #8B6B1E; padding:24px; margin:32px 0; text-align:center; }
  audio { width:100%; max-width:520px; }
  .duration { font-size:14px; color:#4F4130; font-style:italic; margin-top:12px; letter-spacing:0.05em; }
  .footer { text-align:center; padding:40px 0 20px 0; border-top:1px solid #E8DED3; margin-top:48px; }
  .footer img { display:block; margin:0 auto 16px auto; max-width:200px; height:auto; }
  .footer p { font-size:12px; color:#4F4130; margin:0 0 8px 0; line-height:1.6; }
  .footer a { color:#8B6B1E; text-decoration:none; }
</style>
</head>
<body>
  <div class="wrap">
    <img src="${LOGO_URL}" alt="Herst Wellness" class="logo-top" />
    <hr class="divider" />
    <h1>Chapter One</h1>
    <p class="subtitle">The Day the Mask Cracked</p>
    <p>This is where the story really begins. The phone call. My brother. The day everything I'd built started to come apart.</p>
    <p>Find a quiet twenty-eight minutes. A walk works. So does the car. Anywhere you've got room to sit with it.</p>
    <div class="player-wrap">
      <audio controls preload="metadata" src="${CHAPTER_ONE_AUDIO_URL}">
        Your browser does not support audio playback. <a href="${CHAPTER_ONE_AUDIO_URL}">Download the MP3</a>.
      </audio>
      <div class="duration">28 minutes</div>
    </div>
<p>If Chapter One landed for you, the book comes out in September. But if you want to keep reading or listening right now, I'm putting together a small launch team — readers willing to post an honest Amazon review around launch week in exchange for getting the whole book the moment they sign up: audio in my own voice, EPUB, and PDF.</p>
    <p>If you're up for that:</p>
    <div style="text-align:center; margin:32px 0 8px 0;">
      <a href="https://herstwellness.com/launch-team" style="display:inline-block; font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; letter-spacing:0.2em; text-transform:uppercase; padding:16px 36px; background:#8B6B1E; color:#FBF7F0; text-decoration:none;">Join the Launch Team</a>
    </div>
    <p style="margin-top:40px; font-style:italic; color:#6b5a3a;">Not ready for that? I'll email you when the book is out.</p>
    <div style="text-align:center; margin:16px 0 8px 0;">
      <a href="#" onclick="showListForm(event)" style="display:inline-block; font-family:'Cormorant Garamond',Georgia,serif; font-size:13px; letter-spacing:0.2em; text-transform:uppercase; padding:14px 32px; background:transparent; color:#8B6B1E; border:1px solid #8B6B1E; text-decoration:none;">Join the List</a>
    </div>
    <div id="listFormWrap" style="display:none; max-width:400px; margin:20px auto 0; padding:20px; background:rgba(139,107,30,0.05); border-left:2px solid #8B6B1E;">
      <input type="email" id="listEmail" placeholder="Your email address" style="width:100%; padding:12px; font-size:16px; border:1px solid #d4c5a0; background:#FBF7F0; font-family:'Cormorant Garamond',Georgia,serif; margin-bottom:12px; box-sizing:border-box;">
      <button onclick="submitList()" style="width:100%; padding:12px; background:#8B6B1E; color:#FBF7F0; border:none; font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; letter-spacing:0.2em; text-transform:uppercase; cursor:pointer;">Send</button>
      <p id="listMsg" style="margin-top:12px; font-size:14px; color:#6b5a3a; font-style:italic; min-height:20px;"></p>
    </div>
    <script>
    function showListForm(e){e.preventDefault();document.getElementById('listFormWrap').style.display='block';document.getElementById('listEmail').focus();}
    async function submitList(){
      const email=document.getElementById('listEmail').value.trim();
      const msg=document.getElementById('listMsg');
      if(!email||!email.includes('@')){msg.textContent='Please enter a valid email.';return;}
      msg.textContent='Sending...';
      try{
        const res=await fetch('/general-list-signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
        if(res.ok){msg.textContent="You're in. I'll email you when the book is out.";document.getElementById('listEmail').disabled=true;}
        else{msg.textContent='Something went wrong. Please try again.';}
      }catch(e){msg.textContent='Something went wrong. Please try again.';}
    }
    </script>  
    <div class="footer">
      <img src="${LOGO_URL}" alt="Herst Wellness" />
      <p>765 Market St, San Francisco, CA 94103<br>(415) 686-4411 &middot; <a href="mailto:chad@herstwellness.com">chad@herstwellness.com</a></p>
      <p><a href="https://map.herstwellness.com">map.herstwellness.com</a></p>
    </div>
  </div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(html);
    return;
  }
  if (req.method === 'GET' && req.url === '/book') {
    const tracks = [
      { num: 1,  file: '01-opening-credits.mp3',                 title: 'Opening Credits',                          duration: '1:42',  part: 'front' },
      { num: 2,  file: '02-introduction.mp3',                    title: 'Introduction',                             duration: '12:57', part: 'front' },
      { num: 3,  file: '04-ch01-the-day-the-mask-cracked.mp3',   title: 'Chapter One: The Day the Mask Cracked',    duration: '28:17', part: 'one' },
      { num: 4,  file: '05-ch02-am-i-a-man-or-a-mooch.mp3',      title: 'Chapter Two: Am I a Man or a Mooch?',      duration: '36:30', part: 'one' },
      { num: 5,  file: '06-ch03-i-thought-the-hard-part-was-over.mp3', title: 'Chapter Three: I Thought the Hard Part Was Over', duration: '27:29', part: 'one' },
      { num: 6,  file: '07-ch04-the-beginning-of-the-end.mp3',   title: 'Chapter Four: The Beginning of the End',   duration: '9:05',  part: 'one' },
      { num: 7,  file: '08-ch05-proving-myself-into-pain.mp3',   title: 'Chapter Five: Proving Myself into Pain',   duration: '14:08', part: 'one' },
      { num: 8,  file: '09-ch06-the-good-kid.mp3',               title: 'Chapter Six: The Good Kid',                duration: '16:25', part: 'one' },
      { num: 9,  file: '10-ch07-walls.mp3',                      title: 'Chapter Seven: Walls',                     duration: '16:49', part: 'one' },
      { num: 10, file: '11-ch08-snot-and-all.mp3',               title: 'Chapter Eight: Snot and All',              duration: '19:23', part: 'one' },
      { num: 11, file: '12-ch09-my-way-home.mp3',                title: 'Chapter Nine: My Way Home',                duration: '21:46', part: 'one' },
      { num: 12, file: '13-bridge-the-performance-trap.mp3',     title: 'Bridge: The Performance Trap',             duration: '21:40', part: 'one' },
      { num: 13, file: '15-how-to-use-this-section.mp3',         title: 'How to Use This Section',                  duration: '20:45', part: 'two' },
      { num: 14, file: '16-methods-breaking-the-performance-trap.mp3', title: 'Methods: Breaking the Performance Trap', duration: '17:55', part: 'two' },
      { num: 15, file: '17-ch10-overwhelm.mp3',                  title: 'Chapter Ten: Overwhelm',                   duration: '19:08', part: 'two' },
      { num: 16, file: '18-try-this-overwhelm.mp3',              title: 'Try This: Overwhelm',                      duration: '6:16',  part: 'two', sub: true },
      { num: 17, file: '19-ch11-the-inner-critic.mp3',           title: 'Chapter Eleven: The Inner Critic',         duration: '22:04', part: 'two' },
      { num: 18, file: '20-try-this-the-inner-critic.mp3',       title: 'Try This: The Inner Critic',               duration: '8:14',  part: 'two', sub: true },
      { num: 19, file: '21-ch12-emptiness.mp3',                  title: 'Chapter Twelve: Emptiness',                duration: '15:16', part: 'two' },
      { num: 20, file: '22-try-this-emptiness.mp3',              title: 'Try This: Emptiness',                      duration: '5:34',  part: 'two', sub: true },
      { num: 21, file: '23-ch13-self-abandonment.mp3',           title: 'Chapter Thirteen: Self-Abandonment',       duration: '15:40', part: 'two' },
      { num: 22, file: '24-try-this-self-abandonment.mp3',       title: 'Try This: Self-Abandonment',               duration: '6:59',  part: 'two', sub: true },
      { num: 23, file: '25-ch14-the-pressure-to-perform.mp3',    title: 'Chapter Fourteen: The Pressure to Perform',duration: '12:33', part: 'two' },
      { num: 24, file: '26-try-this-pressure-to-perform.mp3',    title: 'Try This: Pressure to Perform',            duration: '5:04',  part: 'two', sub: true },
      { num: 25, file: '27-epilogue-the-hidden-trail.mp3',       title: 'Epilogue: The Hidden Trail',               duration: '14:39', part: 'two' },
      { num: 26, file: '28-acknowledgements.mp3',                title: 'Acknowledgements',                         duration: '7:55',  part: 'back' },
      { num: 27, file: '29-notes-and-resources.mp3',             title: 'Notes and Resources',                      duration: '48:31', part: 'back' },
      { num: 28, file: '30-about-the-author.mp3',                title: 'About the Author',                         duration: '1:17',  part: 'back' },
    ];

    // Convert "MM:SS" or "HH:MM:SS" to seconds
    const parseDuration = (s) => {
      const parts = s.split(':').map(Number);
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return 0;
    };
    const totalSeconds = tracks.reduce((sum, t) => sum + parseDuration(t.duration), 0);
    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMinutes = Math.floor((totalSeconds % 3600) / 60);
    const totalDurationText = `${totalHours} hours ${totalMinutes} minutes`;

    const renderTrack = (t) => `
      <li class="track${t.sub ? ' sub' : ''}" data-num="${t.num}" data-seconds="${parseDuration(t.duration)}">
        <button class="track-btn" type="button">
          <span class="check-mark" aria-label="completed">&#10003;</span>
          <span class="track-title">${t.title}</span>
          <span class="track-dur">${t.duration}</span>
        </button>
      </li>`;

    const partFront = tracks.filter(t => t.part === 'front').map(renderTrack).join('');
    const partOne   = tracks.filter(t => t.part === 'one').map(renderTrack).join('');
    const partTwo   = tracks.filter(t => t.part === 'two').map(renderTrack).join('');
    const partBack  = tracks.filter(t => t.part === 'back').map(renderTrack).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Performance Trap &mdash; Chad Herst</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
<style>
  body { margin:0; padding:0; background:#F4EDE4; font-family:'Cormorant Garamond',Georgia,serif; color:#352515; }
  .wrap { max-width:680px; margin:0 auto; padding:40px 20px; }
  .logo-top { display:block; width:100%; max-width:680px; height:auto; margin:0 auto; }
  .divider { border:none; border-top:1px solid #8B6B1E; margin:32px 0; }
  h1 { font-family:'Playfair Display',Georgia,serif; font-size:36px; line-height:1.15; color:#352515; margin:0 0 8px 0; font-weight:700; }
  .subtitle { font-family:'Cormorant Garamond',Georgia,serif; font-style:italic; font-size:20px; color:#8B6B1E; margin:0 0 8px 0; letter-spacing:0.04em; }
  .author { font-family:'Cormorant Garamond',Georgia,serif; font-size:16px; color:#4F4130; margin:0 0 4px 0; letter-spacing:0.08em; text-transform:uppercase; }
  .book-meta { font-family:'Cormorant Garamond',Georgia,serif; font-size:15px; color:#4F4130; font-style:italic; margin:0 0 32px 0; letter-spacing:0.03em; }
  p { font-size:18px; line-height:1.85; margin:0 0 20px 0; }
  h2 { font-family:'Playfair Display',Georgia,serif; font-size:24px; color:#352515; margin:48px 0 16px 0; font-weight:700; }
  .resume { background:#EFE6D8; border-left:3px solid #8B6B1E; padding:16px 20px; margin:24px 0; display:none; }
  .resume.show { display:block; }
  .resume p { margin:0 0 12px 0; font-size:16px; }
  .resume button { font-family:'Cormorant Garamond',Georgia,serif; font-size:13px; letter-spacing:0.15em; text-transform:uppercase; padding:10px 24px; border:1px solid #8B6B1E; background:transparent; color:#8B6B1E; cursor:pointer; margin-right:8px; }
  .resume button:hover { background:#8B6B1E; color:#FBF7F0; }
  .resume button.primary { background:#8B6B1E; color:#FBF7F0; }
  .resume button.primary:hover { background:#6F551A; }
  .player-wrap { background:#EFE6D8; border:1px solid #8B6B1E; padding:24px; margin:24px 0 16px 0; }
  .player-header { display:flex; gap:16px; align-items:flex-start; margin-bottom:16px; }
  .player-header-cover { width:72px; height:auto; flex-shrink:0; box-shadow:0 3px 10px rgba(53,37,21,0.2); }
  .player-header-text { flex:1; min-width:0; }
  .now-playing-label { font-family:'Cormorant Garamond',Georgia,serif; font-style:italic; font-size:13px; color:#4F4130; margin:0 0 2px 0; letter-spacing:0.05em; text-transform:uppercase; }
  .now-playing-title { font-family:'Playfair Display',Georgia,serif; font-size:18px; color:#352515; margin:0 0 6px 0; font-weight:700; line-height:1.25; }
  .now-playing-context { font-family:'Cormorant Garamond',Georgia,serif; font-size:13px; color:#4F4130; font-style:italic; margin:0; }
  .overall-progress { margin:0 0 16px 0; }
  .progress-stats { display:flex; justify-content:space-between; font-family:'Cormorant Garamond',Georgia,serif; font-size:13px; color:#4F4130; margin-bottom:6px; letter-spacing:0.03em; }
  .progress-stats strong { color:#8B6B1E; font-weight:500; }
  .progress-bar { width:100%; height:6px; background:#D9CBAF; border-radius:3px; overflow:hidden; }
  .progress-fill { height:100%; background:#8B6B1E; width:0%; transition:width 0.5s ease; }
  .speed-pills { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:16px; flex-wrap:wrap; }
  .speed-label { font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; color:#4F4130; font-style:italic; letter-spacing:0.05em; margin-right:4px; }
  .speed-pill { font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; padding:6px 14px; background:transparent; border:1px solid #8B6B1E; color:#8B6B1E; cursor:pointer; transition:all 0.15s; letter-spacing:0.03em; }
  .speed-pill:hover { background:#F4EDE4; }
  .speed-pill.active { background:#8B6B1E; color:#FBF7F0; }
  .auto-save-hint { text-align:center; font-size:14px; color:#4F4130; margin:8px 0 16px 0; }
  .plyr--audio .plyr__controls { background:transparent; color:#352515; padding:8px; }
  .plyr--audio .plyr__control:hover { background:#8B6B1E; color:#FBF7F0; }
  .plyr--audio .plyr__control[aria-expanded=true] { background:#8B6B1E; color:#FBF7F0; }
  .plyr--full-ui input[type=range] { color:#8B6B1E; }
  .jump-nav { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0 12px 0; padding-bottom:12px; border-bottom:1px solid #E8DED3; }
  .jump-nav a { font-family:'Cormorant Garamond',Georgia,serif; font-size:13px; color:#8B6B1E; text-decoration:none; letter-spacing:0.08em; text-transform:uppercase; padding:4px 10px; border:1px solid transparent; transition:all 0.15s; }
  .jump-nav a:hover { border-color:#8B6B1E; background:#EFE6D8; }
  .chapter-list { list-style:none; padding:0; margin:0; }
  .part-header { font-family:'Playfair Display',Georgia,serif; font-size:17px; color:#8B6B1E; margin:24px 0 4px 0; padding-bottom:4px; border-bottom:1px solid #E8DED3; letter-spacing:0.05em; text-transform:uppercase; font-weight:700; scroll-margin-top:20px; }
  .part-header:first-child { margin-top:8px; }
  .part-header.back { color:#A89680; }
  .track { margin:0; }
  .track.sub { padding-left:28px; }
  .track-btn { width:100%; background:transparent; border:none; border-bottom:1px solid #E8DED3; border-left:3px solid transparent; padding:9px 4px 9px 10px; text-align:left; cursor:pointer; font-family:'Cormorant Garamond',Georgia,serif; color:#352515; display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
  .track-btn:hover { background:#EFE6D8; }
  .track-btn.playing { background:#EFE6D8; border-left-color:#8B6B1E; }
  .track-btn.playing .track-title { color:#8B6B1E; font-weight:500; }
  .track-title { font-size:15px; line-height:1.35; flex:1; }
  .track.sub .track-title { font-style:italic; font-size:14px; color:#4F4130; }
  .track-dur { font-size:13px; color:#8B6B1E; font-style:italic; flex-shrink:0; letter-spacing:0.05em; }
  .check-mark { display:inline-block; width:16px; font-size:14px; color:#8B6B1E; opacity:0; flex-shrink:0; transition:opacity 0.2s; }
  .track.completed .check-mark { opacity:1; }
  .track.back-matter .track-title { color:#6F6050; font-style:italic; }
  .track.back-matter .track-dur { color:#A89680; }
  .downloads { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin:24px 0; }
  @media (max-width: 540px) { .downloads { grid-template-columns:1fr; } .player-header-cover { width:56px; } }
  .dl-card { background:#FBF7F0; border:1px solid #8B6B1E; padding:20px; text-align:center; text-decoration:none; color:#352515; display:block; transition:background 0.2s; }
  .dl-card:hover { background:#EFE6D8; }
  .dl-card img { display:block; width:100%; max-width:160px; height:auto; margin:0 auto 16px auto; box-shadow:0 4px 12px rgba(53,37,21,0.15); }
  .dl-format { font-family:'Playfair Display',Georgia,serif; font-size:20px; color:#352515; margin:0 0 4px 0; font-weight:700; }
  .dl-desc { font-family:'Cormorant Garamond',Georgia,serif; font-size:14px; font-style:italic; color:#4F4130; margin:0; }
  .kindle-howto { background:#EFE6D8; padding:24px; margin:16px 0 32px 0; border-left:3px solid #8B6B1E; }
  .kindle-howto h3 { font-family:'Playfair Display',Georgia,serif; font-size:20px; margin:0 0 12px 0; color:#352515; }
  .kindle-howto p { font-size:16px; margin:0 0 12px 0; }
  .kindle-howto ol { font-size:16px; line-height:1.85; padding-left:20px; margin:0; }
  .kindle-howto li { margin-bottom:10px; }
  .kindle-howto a { color:#8B6B1E; }
  .footer { text-align:center; padding:40px 0 20px 0; border-top:1px solid #E8DED3; margin-top:48px; }
  .footer img { display:block; margin:0 auto 16px auto; max-width:200px; height:auto; }
  .footer p { font-size:12px; color:#4F4130; margin:0 0 8px 0; line-height:1.6; }
  .footer a { color:#8B6B1E; text-decoration:none; }
</style>
</head>
<body>
  <div class="wrap">
    <img src="${LOGO_URL}" alt="Herst Wellness" class="logo-top" />
    <hr class="divider" />

    <h1>The Performance Trap</h1>
    <p class="subtitle">The Ache No Success Will Ever Fix</p>
    <p class="author">Chad Herst</p>
    <p class="book-meta">${totalDurationText} &middot; 28 tracks</p>

    <p>This is the audiobook, in my voice. Twenty-eight tracks, just over seven hours, recorded chapter by chapter. Read in any order. Stop when you need to.</p>
    <p><em>Prefer to read? The EPUB and PDF are below &mdash; keep scrolling.</em></p>

    <div class="resume" id="resume-banner">
      <p id="resume-text">Welcome back. Pick up where you left off?</p>
      <button id="resume-yes" class="primary" type="button">Resume</button>
      <button id="resume-no" type="button">Start over</button>
    </div>

    <div class="player-wrap">
      <div class="player-header">
        <img src="${BASE_URL}/book-cover.jpg" alt="The Performance Trap cover" class="player-header-cover" />
        <div class="player-header-text">
          <p class="now-playing-label">Now playing</p>
          <p class="now-playing-title" id="now-title">Opening Credits</p>
          <p class="now-playing-context" id="now-context">Chapter 1 of 28</p>
        </div>
      </div>

      <div class="overall-progress">
        <div class="progress-stats">
          <span><strong id="progress-percent">0%</strong> complete</span>
<span><strong id="progress-remaining">${totalDurationText}</strong></span>        </div>
        <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
      </div>

      <audio id="player" controls preload="metadata">
        <source src="${AUDIO_BASE_URL}/01-opening-credits.mp3" type="audio/mpeg" />
      </audio>

      <div class="speed-pills">
        <span class="speed-label">Speed</span>
        <button type="button" class="speed-pill" data-speed="0.75">0.75&times;</button>
        <button type="button" class="speed-pill active" data-speed="1">1&times;</button>
        <button type="button" class="speed-pill" data-speed="1.25">1.25&times;</button>
        <button type="button" class="speed-pill" data-speed="1.5">1.5&times;</button>
        <button type="button" class="speed-pill" data-speed="2">2&times;</button>
      </div>
    </div>
    <p class="auto-save-hint"><em>Your place is saved automatically &mdash; close the tab and come back anytime.</em></p>

    <h2>Chapters</h2>
    <nav class="jump-nav" aria-label="Jump to section">
      <a href="#section-front">Front</a>
      <a href="#section-one">Part One</a>
      <a href="#section-two">Part Two</a>
      <a href="#section-back">Back Matter</a>
    </nav>
    <ul class="chapter-list">
      <li class="part-header" id="section-front">Front Matter</li>
      ${partFront}
      <li class="part-header" id="section-one">Part One: Finding My Way Home</li>
      ${partOne}
      <li class="part-header" id="section-two">Part Two: From Understanding to Embodiment</li>
      ${partTwo}
      <li class="part-header back" id="section-back">Back Matter</li>
      ${partBack}
    </ul>

    <h2>Read it instead</h2>
    <p>If you'd rather read than listen, the book is available in two formats. Click either cover to download.</p>

    <div class="downloads">
      <a class="dl-card" href="${BASE_URL}/downloads/the-performance-trap.epub" download>
        <img src="${BASE_URL}/book-cover.jpg" alt="The Performance Trap cover" />
        <p class="dl-format">EPUB</p>
        <p class="dl-desc">For Kindle, Apple Books, Kobo, and most e-readers</p>
      </a>
      <a class="dl-card" href="${BASE_URL}/downloads/the-performance-trap.pdf" download>
        <img src="${BASE_URL}/book-cover.jpg" alt="The Performance Trap cover" />
        <p class="dl-format">PDF</p>
        <p class="dl-desc">For desktop, tablet, or printing</p>
      </a>
    </div>

    <div class="kindle-howto">
      <h3>How to read the EPUB on your Kindle</h3>
      <p>Amazon stopped supporting the old AZW3 format, but EPUB works perfectly through their official Send to Kindle service. Three ways to do it &mdash; pick whichever is easiest:</p>
      <ol>
        <li><strong>Email it.</strong> Every Kindle account has a personal email address ending in <em>@kindle.com</em>. Find yours at <a href="https://www.amazon.com/myk" target="_blank" rel="noopener">amazon.com/myk</a> under Preferences &rarr; Personal Document Settings. Email the EPUB to that address as an attachment, and it shows up on your Kindle in a few minutes.</li>
        <li><strong>Use the web uploader.</strong> Go to <a href="https://www.amazon.com/sendtokindle" target="_blank" rel="noopener">amazon.com/sendtokindle</a>, sign in, and drag the EPUB into the browser. Same result, no email.</li>
        <li><strong>Use the desktop app.</strong> Download Send to Kindle for Mac or Windows from Amazon, then right-click the EPUB and choose "Send to Kindle."</li>
      </ol>
      <p>For the PDF: open it on any computer, tablet, or phone. Most people read PDFs in their browser, in Apple Books, or in Adobe Acrobat.</p>
    </div>

    <div class="footer">
      <img src="${LOGO_URL}" alt="Herst Wellness" />
      <p>765 Market St, San Francisco, CA 94103<br>(415) 686-4411 &middot; <a href="mailto:chad@herstwellness.com">chad@herstwellness.com</a></p>
      <p><a href="https://map.herstwellness.com">map.herstwellness.com</a></p>
    </div>
  </div>

  <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
  <script>
    const TRACKS = ${JSON.stringify(tracks.map(t => ({ num: t.num, file: AUDIO_BASE_URL + '/' + t.file, title: t.title, duration: t.duration, seconds: parseDuration(t.duration), part: t.part })))};
    const TOTAL_SECONDS = ${totalSeconds};
    const STORAGE_KEY = 'performance-trap-progress-v2';
    const audio = document.getElementById('player');
    const nowTitle = document.getElementById('now-title');
    const nowContext = document.getElementById('now-context');
    const progressPercent = document.getElementById('progress-percent');
    const progressRemaining = document.getElementById('progress-remaining');
    const progressFill = document.getElementById('progress-fill');

    const player = new Plyr(audio, {
      controls: ['play', 'rewind', 'progress', 'current-time', 'duration', 'fast-forward', 'mute', 'volume'],
      seekTime: 15,
      keyboard: { focused: true, global: false },
    });

    let currentNum = 1;

    function loadProgress() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    }
    function saveProgress(num, time) {
      try {
        const p = loadProgress();
        p.lastTrack = num;
        p.lastTime = time;
        p.tracks = p.tracks || {};
        p.tracks[num] = p.tracks[num] || {};
        p.tracks[num].position = time;
        // Mark completed at 90% of chapter duration
        const t = TRACKS.find(x => x.num === num);
        if (t && time >= t.seconds * 0.9) {
          p.tracks[num].completed = true;
          const li = document.querySelector('.track[data-num="' + num + '"]');
          if (li) li.classList.add('completed');
        }
        p.updated = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      } catch {}
    }

    function applyStoredCompletions() {
      const p = loadProgress();
      if (!p.tracks) return;
      Object.keys(p.tracks).forEach(num => {
        if (p.tracks[num] && p.tracks[num].completed) {
          const li = document.querySelector('.track[data-num="' + num + '"]');
          if (li) li.classList.add('completed');
        }
      });
    }

    function fmtTime(s) {
      s = Math.floor(s || 0);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function fmtRemaining(s) {
      s = Math.floor(s || 0);
      if (s <= 0) return 'Complete';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (h > 0) return h + 'h ' + m + 'm remaining';
      return m + 'm remaining';
    }

    function updateOverallProgress() {
      // Sum: completed chapter durations + completed time in chapters up to current + current position
      const p = loadProgress();
      let elapsed = 0;
      for (const t of TRACKS) {
        if (t.num < currentNum) {
          // Count the stored position for earlier tracks, or full duration if completed
          const stored = p.tracks && p.tracks[t.num];
          if (stored && stored.completed) {
            elapsed += t.seconds;
          } else if (stored && typeof stored.position === 'number') {
            elapsed += Math.min(stored.position, t.seconds);
          } else {
            // Assume not listened
          }
        } else if (t.num === currentNum) {
          elapsed += audio.currentTime || 0;
        }
      }
      const pct = Math.min(100, Math.floor((elapsed / TOTAL_SECONDS) * 100));
      const remaining = Math.max(0, TOTAL_SECONDS - elapsed);
      progressPercent.textContent = pct + '%';
      progressFill.style.width = pct + '%';
      progressRemaining.textContent = fmtRemaining(remaining);
    }

    function loadTrack(num, seekTime) {
      const t = TRACKS.find(x => x.num === num);
      if (!t) return;
      currentNum = num;
      audio.src = t.file;
      audio.load();
      nowTitle.textContent = t.title;
      nowContext.textContent = 'Chapter ' + num + ' of ' + TRACKS.length;
      document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('playing'));
      const li = document.querySelector('.track[data-num="' + num + '"] .track-btn');
      if (li) li.classList.add('playing');
      if (seekTime && seekTime > 2) {
        audio.addEventListener('loadedmetadata', function once() {
          audio.currentTime = seekTime;
          audio.removeEventListener('loadedmetadata', once);
          updateOverallProgress();
        });
      } else {
        updateOverallProgress();
      }
    }

    // Mark back-matter tracks visually
    document.querySelectorAll('.track').forEach(li => {
      const num = parseInt(li.dataset.num, 10);
      const t = TRACKS.find(x => x.num === num);
      if (t && t.part === 'back') li.classList.add('back-matter');
    });

    document.querySelectorAll('.track').forEach(li => {
      li.querySelector('.track-btn').addEventListener('click', () => {
        const num = parseInt(li.dataset.num, 10);
        loadTrack(num, 0);
        player.play();
      });
    });

    let saveTimer = 0;
    audio.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - saveTimer > 5000) {
        saveTimer = now;
        if (audio.currentTime > 0) saveProgress(currentNum, audio.currentTime);
        updateOverallProgress();
      }
    });
    audio.addEventListener('ended', () => {
      saveProgress(currentNum, TRACKS.find(x => x.num === currentNum).seconds);
      const next = TRACKS.find(x => x.num === currentNum + 1);
      if (next) { loadTrack(next.num, 0); player.play(); }
    });

    // Smooth scroll for jump nav
    document.querySelectorAll('.jump-nav a').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Speed pills
    document.querySelectorAll('.speed-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        audio.playbackRate = speed;
        document.querySelectorAll('.speed-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Initial setup
    applyStoredCompletions();
    const progress = loadProgress();
    if (progress.lastTrack && progress.lastTime > 5) {
      const t = TRACKS.find(x => x.num === progress.lastTrack);
      if (t) {
        const banner = document.getElementById('resume-banner');
        document.getElementById('resume-text').textContent = 'Welcome back. Pick up where you left off in "' + t.title + '" at ' + fmtTime(progress.lastTime) + '?';
        banner.classList.add('show');
        document.getElementById('resume-yes').addEventListener('click', () => {
          banner.classList.remove('show');
          loadTrack(progress.lastTrack, progress.lastTime);
        });
        document.getElementById('resume-no').addEventListener('click', () => {
          banner.classList.remove('show');
          loadTrack(1, 0);
        });
      }
    }

    loadTrack(1, 0);
    updateOverallProgress();
  </script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(html);
    return;
  }

  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ ok: true, engine: 'vsop87-js' })); return;
  }

  if (req.method === 'POST' && req.url === '/reading') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { city, name, email, date, time, tz, noTime } = JSON.parse(body);
        const geoData = await fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, { 'User-Agent': 'PerformanceTrapApp/1.0' });
        if (!geoData.length) { res.writeHead(400); res.end(JSON.stringify({ error: `Could not find "${city}". Try: "San Rafael, California, USA"` })); return; }
        const lat = parseFloat(geoData[0].lat), lon = parseFloat(geoData[0].lon);
        // If no birth time, use noon UTC and timezone 0 to get the most central possible Moon position
        const useTime = noTime ? '12:00' : time;
        const useTz = noTime ? 0 : parseFloat(tz);
        const chart = buildChart(date, useTime, useTz, lat, lon);
        const text = chartToText(chart, name, noTime);
        const aspects = calcNatalAspects(chart, noTime);
        const aspectText = aspectsToText(aspects, chart);
        const userPrompt = `Read this chart for ${name}:\n\n${text}\n\n${aspectText}`;
        console.log('Chart for', name, '(noTime=' + !!noTime + '):\n' + text + '\n' + aspectText);
        const [reading] = await Promise.all([
          callAnthropic(noTime ? SYS_NO_TIME : SYS, userPrompt),
          addToMailchimp(email, name)
        ]);
        res.writeHead(200); res.end(JSON.stringify({ lat, lon, reading, chart, noTime: !!noTime }));
      } catch(e) {
        console.error('Error:', e.message, e.stack);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message || 'Something went wrong.' }));
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
        if (!text) { res.writeHead(400); res.end(JSON.stringify({ error: 'No text provided' })); return; }

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
            let errData = '';
            ttsRes.on('data', c => errData += c);
            ttsRes.on('end', () => { res.writeHead(500); res.end(JSON.stringify({ error: 'TTS failed' })); });
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked'
          });
          ttsRes.pipe(res);
        });
        ttsReq.on('error', e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
        ttsReq.write(ttsBody);
        ttsReq.end();
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── OPT-IN SEQUENCE ──────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/optin') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        if (!email) { res.writeHead(400); res.end(JSON.stringify({ error: 'No email' })); return; }
        console.log('Opt-in received for:', email);
        sendNurtureSequence(email); // fire and forget
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── LAUNCH TEAM WELCOME ──────────────────────────────────────
  if (req.method === 'POST' && req.url === '/launch-team-welcome') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email, firstName } = JSON.parse(body);
        if (!email) { res.writeHead(400); res.end(JSON.stringify({ error: 'No email provided' })); return; }
        console.log('Launch team welcome triggered for:', email, firstName || '(no name)');

        // Send welcome email + add to Mailchimp in parallel
        await Promise.all([
          sendResendEmail(email, LAUNCH_TEAM_EMAIL.subject, textToHtml(LAUNCH_TEAM_EMAIL.text)),
          addToMailchimp(email, firstName || '')
        ]);

        // Apply "Launch Team" tag in Mailchimp (separate API call)
        const crypto = require('crypto');
        const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
        const tagBody = JSON.stringify({ tags: [{ name: 'Launch Team', status: 'active' }] });
        const tagAuth = Buffer.from(`anystring:${MAILCHIMP_KEY}`).toString('base64');
        const tagReq = https.request({
          hostname: `${MAILCHIMP_SERVER}.api.mailchimp.com`,
          path: `/3.0/lists/${MAILCHIMP_LIST_ID}/members/${subscriberHash}/tags`,
          method: 'POST',
          headers: {
            'Authorization': `Basic ${tagAuth}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(tagBody)
          }
        }, tagRes => {
          let td = '';
          tagRes.on('data', c => td += c);
          tagRes.on('end', () => {
            console.log('Mailchimp tag status:', tagRes.statusCode, td.substring(0, 200));
          });
        });
        tagReq.on('error', e => console.log('Mailchimp tag error:', e.message));
        tagReq.write(tagBody);
        tagReq.end();

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        console.error('Launch team welcome error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GENERAL LIST SIGNUP (no Launch Team tag) ─────────────────
  if (req.method === 'POST' && req.url === '/general-list-signup') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        if (!email || !email.includes('@')) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid email' })); return; }
        console.log('General list signup for:', email);
        await addToMailchimp(email, '');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        console.error('General list signup error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // ── CHAPTER ONE AUDIO DELIVERY ───────────────────────────────
  if (req.method === 'POST' && req.url === '/chapter-one-audio') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        if (!email) { res.writeHead(400); res.end(JSON.stringify({ error: 'No email provided' })); return; }
        console.log('Chapter One audio triggered for:', email);
        const emailBody = CHAPTER_ONE_EMAIL.text(LISTEN_PAGE_URL);
        await sendResendEmail(email, CHAPTER_ONE_EMAIL.subject, textToHtml(emailBody));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        console.error('Chapter One audio error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── PDF EXPANSION ────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/expand') {
    console.log('Expand endpoint hit');
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { reading, name, birthDate, birthCity } = JSON.parse(body);
        if (!reading) { res.writeHead(400); res.end(JSON.stringify({ error: 'No reading provided' })); return; }

        const expandSYS = `You are expanding a Performance Trap natal chart reading for a PDF document. Chad Herst's voice: brutally honest, somatic, direct. No spiritual bypassing. Never call the wound a gift.

Rules:
- Peer across the table, not guru
- Physical sensations before interpretations: tight gut, jaw clench, shallow breath
- Short punchy sentences. Hard stops.
- Never call the wound a gift — it is a survival strategy
- Show what happens in the body, not what it means
- State the hard truth. Period. Move on.

Expand each section to 2-3 paragraphs. Keep each paragraph under 100 words. Be specific to this person's chart.

CRITICAL: Keep your total response under 3000 words. Be concise.

RESPOND WITH ONLY VALID JSON, no markdown fences, nothing before or after:
{"headline":"one sentence","sections":[{"title":"exact section title from input","content":"2-3 paragraphs separated by newline"}],"closing":"one concrete scene in the body","transits_expanded":"2 paragraphs on the transit weather"}`;

        const readingText = [
          'Person: ' + name + ', born ' + birthDate + ', ' + birthCity,
          '',
          'Headline: ' + (reading.trap_name || '') + ' — ' + (reading.trap_description || ''),
          '',
        ].concat((reading.sections || []).map(s => s.title.toUpperCase() + '\n' + (s.content || ''))).concat([
          '',
          'Closing: ' + (reading.closing || ''),
          '',
          'Transits: ' + ((reading.transits && reading.transits.synthesis) || '')
        ]).join('\n');
        const userMsg = 'Expand this reading into a detailed long-form PDF. Same voice rules apply — direct, somatic, no spiritual bypassing, no romanticizing the wound:\n\n' + readingText;

        const reqBody = JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8096,
          system: expandSYS,
          messages: [{ role: 'user', content: userMsg }]
        });

        console.log('Expand: calling Haiku for', name);
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
              console.log('Expand: Haiku response status', apiRes.statusCode, 'length', d.length);
              const a = JSON.parse(d);
              if (a.error) throw new Error('Haiku error: ' + a.error.type + ' - ' + a.error.message);
              const raw = a.content?.[0]?.text || '';
              console.log('Expand: raw length', raw.length, 'preview:', raw.substring(0, 100));
              let expanded;
              try { expanded = JSON.parse(raw); }
              catch { expanded = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
              res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ expanded }));
              console.log('Expand: success for', name);
            } catch(e) {
              console.error('Expand error:', e.message);
              console.error('Raw response:', d.substring(0, 300));
              res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
            }
          });
        });
        apiReq.on('error', e => {
          console.error('Expand request error:', e.message);
          res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
        });
        apiReq.write(reqBody);
        apiReq.end();
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
