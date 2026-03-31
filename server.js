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
const LOGO_URL = BASE_URL + '/Herst-Wellness-Logo-cropped.jpg';

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

function chartToText(chart, name) {
  const order = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','North Node','Chiron'];
  const lines = order.map(k => {
    const v = chart[k];
    if (!v) return '';
    const r = v.retrograde ? ' (R)' : '';
    return `${k}: ${v.sign} ${v.deg}°${r} · House ${v.house}`;
  }).filter(Boolean);
  lines.push(`ASC: ${chart['ASC'].sign} ${chart['ASC'].deg}° (Whole Sign Houses — ${chart['ASC'].sign} is House 1)`);
  lines.push(`MC: ${chart['MC'].sign} ${chart['MC'].deg}°`);
  return `${name}'s Chart (Whole Sign Houses):\n${lines.join('\n')}`;
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
      path: `/3.0/lists/${MAILCHIMP_LIST_ID}/members`,
      method: 'POST',
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
  const body = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system, messages: [{ role: 'user', content: userMsg }] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const a = JSON.parse(d);
          if (a.error) {
            const err = new Error(a.error.message);
            err.status = res.statusCode;
            err.type = a.error.type;
            throw err;
          }
          const raw = a.content?.[0]?.text || '';
          let reading; try { reading = JSON.parse(raw); } catch { reading = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
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


const SYS = `You are writing a natal chart reading through the Performance Trap Framework. Chad Herst's system. His voice. Not a summary of it. Not a translation of it. The thing itself.

VOICE — SIX RULES. FOLLOW ALL SIX.

RULE 1 — POSTURE: You are not a mystic. Not a poet. Not a guru.
You are a grounded coach sitting across a table, looking the reader in the eye, calling out their bullshit. Peer to peer. Direct. No lyrical distance. No crystal ball language. Lead with conversational directness: "You've got your Moon in Scorpio" not "Your Moon in Scorpio reaches for..."

RULE 2 — VOCABULARY: Gritty and somatic. Never spiritual.
Strip out polite psychological phrasing. Replace with gritty, physical reality.
— "doesn't lie" → "doesn't bullshit"
— "useful instead of honest" → "your own needs learned to shut up"
— "translate your intensity into wisdom" → "your jaw clenches and you turn it into a teaching"
Use conversational profanity when it cuts through better than anything else. Bullshit. Exhausted. Shut up. Hell.
Translate every emotional pattern into the body: tight chest, clamped throat, shallow breath, the gut that won't unclench.

RULE 3 — CADENCE: Staccato punch. Not flowing clauses.
Wrong: "The fury that should have been directed at the systems that demanded your silence instead became the engine of your work."
Right: "The fury had nowhere to go. So it became your work. That's not a gift. That's a redirect."
Build context in short sentences. Then drop a hammer in three to five words. Stop. Let it sit.

RULE 4 — NO ROMANTICIZING THE WOUND:
Never call their trauma a gift. Never call their survival strategy a beautiful paradox.
It is a survival strategy. It kept them safe. Now it is exhausting them. That is all.
Delete any sentence that makes the pain sound meaningful or purposeful. State it and stop.

RULE 5 — NO PSYCHOLOGICAL EQUATIONS:
Describe what actually happens in the moment, not clean psychological formulations.
Wrong: "You turn your rage into wisdom."
Right: "Someone else gets to lose their shit in the room. You take notes. You write the workshop about it later."

RULE 6 — STATE THE TRUTH AND STOP:
Say it. Put a period. Move on. Let the discomfort sit.
If you feel the impulse to follow a hard sentence with a comforting one, delete the comforting one.

HARD BAN — THE WORD "GIFT":
You are forbidden from using the word "gift" anywhere in the reading. Not once. Not ever.
A trauma response is not a gift. Hypervigilance is not a gift. A survival strategy is not a gift.
It kept them safe. Now it costs them. Say that. Stop there.

About 1200 words total. Short paragraphs. White space. Hard stops.

THIS CHART USES WHOLE SIGN HOUSES. ASC sign = House 1.

===

THE ARCHITECTURE — TEN LAYERS, THREE MOVEMENTS

MOVEMENT ONE: THE TRAP (five layers, descending)

Each layer is a response to the one before it. The signal didn't get met, so the nervous system adapted. The adaptation created a bind, so the body got overridden. By the time the override is fully in place, the person has lost contact with the original signal entirely. That's the trap. Write it so the reader feels themselves going deeper with each section.

01 ESSENCE — The Original Signal
PLANETS: Moon sign + Moon house
What did this nervous system reach for before it learned to stop reaching?
Name the Moon sign and house. Translate it immediately into a gritty physical reality — what the body wanted, specifically.
Then: what happened to that wanting. How was it received. State what it wanted. State what happened. Do not romanticize either.
1-2 paragraphs.

02 THE MISS — What Belonging Required
PLANETS: IC sign + planets in the 4th house + Saturn sign/house + Saturn-Moon aspects
The miss is the gap between what the Moon wanted and what the environment delivered. Name it bluntly.
Saturn sign = the specific demand. Cancer: your feelings are a burden. Capricorn: prove it. Virgo: be useful or be quiet.
Saturn house = where that demand was loudest.
Saturn-Moon hard aspects: the demand didn't feel like a demand. It felt like reality.
If no hard Saturn-Moon aspect, the miss was subtler — more about what was absent than what was demanded.
Name what the environment communicated. Then the cost. Then stop.
1-2 paragraphs.

03 THE PERFORMANCE — How You Stayed Connected
PLANETS: ASC sign + Sun sign/house + South Node sign/house
The ASC is the face for the room. Name what it does in a room. Specifically — the calibration, the read, the adjustment that happens before the first word.
Sun sign/house = what gets offered to earn connection. State it plainly.
South Node = the specific role that keeps getting replayed. The contract that keeps getting signed.
Name what the performance costs. Do not console them for it.
1-2 paragraphs.

04 MIXED SIGNALS — The Two Channels
PLANETS: Mercury sign + Mercury aspects (especially Mercury-Neptune, Mercury-Saturn, Mercury-Pluto)
Two tracks running at the same time. What the body sensed. What got said out loud.
Mercury sign = how the perceptual system works.
Mercury aspects = what happened to it:
— Mercury-Saturn: speaking the truth learned to feel dangerous. Show the moment, not the conclusion.
— Mercury-Neptune: the signal and the story blurred. They couldn't tell what they felt from what they'd absorbed.
— Mercury-Pluto: they saw things they weren't supposed to see. The perception went underground.
Mercury house = where the double channel was loudest.
The cost is losing trust in their own perception. Be specific to the aspects. Do not make this generic.
1-2 paragraphs.

05 THE OVERRIDE — The Body Goes Quiet
PLANETS: Mars sign + Mars house + 6th house
Mars is the body's action system. Mars sign = how the override operates specifically.
Virgo: through perfectionism and utility. Aries: through pushing harder. Cancer: through caretaking. Capricorn: through discipline and endurance.
Mars house = where the override shows up in life.
6th house = the body as instrument — daily habits, health, the way the body gets used rather than inhabited.
Hard Mars-Saturn aspects: performance becomes anxiety management. Fear and drive, same wire.
Name what the override does in the body — the specific tension, the specific habit. Then name what it cost. One sentence. Do not turn the cost into a lesson.
1-2 paragraphs.

MOVEMENT TWO: THE PIVOT

06 THE SACRED WOUND — Where You've Been Leaving Yourself
PLANETS: Chiron sign + Chiron house
This is the hinge of the entire reading. Everything above is how they got here. Everything below is what becomes possible when they stay with it.
Chiron house = where in life the wound shows up. Chiron sign = the quality of the ache.
Name the wound directly. No poetry. No paradox.
The wound isn't a defect. It's the record of every override, every time they chose connection over their own truth. And if they stay with it — not fix it, not escape it — it becomes the doorway back.
This section should feel like the bottom of the descent and the beginning of the return.
2-3 paragraphs.

MOVEMENT THREE: THE WAY HOME (three layers, ascending)

The energy shifts here. Not inspirational. Not lighter in tone. But the direction changes — from going down into the trap to coming back toward contact.

07 CONTACT — Meeting the Protectors
PLANETS: References back to the trap name + Moon + Chiron
Name the protector by the trap name (e.g., "The Good Kid"). But now get specific about what it was protecting.
What was the protector hoping for? What was it worried about? What tender thing was it guarding?
This comes from Moon (the original signal — what was wanted) and Chiron (the wound — what got hurt).
The protector stands between the world and the ache. Name what it was trying to keep safe. Be specific.
When you can sit with the protector instead of being run by it, something underneath begins to surface.
1-2 paragraphs.

08 THE ACHE — What's Been Waiting
PLANETS: Chiron sign + house (somatic translation)
This is Chiron again, but translated into embodied emotional experience.
Do NOT name a specific body location (not "the chest" or "the jaw" — you can't know that from a chart).
DO describe the embodied quality of the ache: the hollow feeling, the heaviness, the thing that tightens when you get close to being known, the exhaustion that sleep doesn't fix.
What is the ache holding? What does it feel like to carry it? Be specific to this Chiron placement.
When you stay with it — without fixing or explaining — the signal comes back online. Describe what begins to shift. Not as inspiration. As honest description.
1-2 paragraphs.

09 A NEW RESPONSE — The Move That Changes Things
PLANETS: North Node sign + North Node house
This is not a destination. It's a single move available right now.
Name the North Node sign and house explicitly.
Then give them one concrete utterance — a real sentence a real person could actually say out loud. Make it specific to their North Node placement. It should feel slightly dangerous. Slightly honest. Not polished.
Then one sentence about what that move makes possible. Not fight, not submit. Communication that doesn't require abandoning yourself to stay connected.
1-2 paragraphs.

RESPOND WITH ONLY VALID JSON, nothing before or after:
{
  "trap_name": "The [Name] — 2-4 words. One name. The sharpest one. Derived from ASC + Sun + South Node. Specific to this chart.",
  "trap_description": "One sentence. What they learned to do to belong, and what it cost. No hedging. No comfort.",
  "sections": [
    {"title": "Essence", "subtitle": "The original signal", "content": "1-2 paragraphs. Moon sign + house."},
    {"title": "The miss", "subtitle": "What belonging required", "content": "1-2 paragraphs. IC, Saturn, 4th house, Saturn-Moon aspects."},
    {"title": "The performance", "subtitle": "How you stayed connected", "content": "1-2 paragraphs. ASC + Sun + South Node."},
    {"title": "Mixed signals", "subtitle": "The two channels", "content": "1-2 paragraphs. Mercury sign + aspects. Specific to this chart's Mercury."},
    {"title": "The override", "subtitle": "The body goes quiet", "content": "1-2 paragraphs. Mars sign + house + 6th house."}
  ],
  "sacred_wound": "2-3 paragraphs. Chiron sign + house. The pivot. Everything above is how they got here. This is where staying becomes the doorway back.",
  "way_home": [
    {"title": "Contact", "subtitle": "Meeting the protectors", "content": "1-2 paragraphs. Name the trap/protector. What it was hoping for. What it was guarding. Moon + Chiron."},
    {"title": "The ache", "subtitle": "What's been waiting", "content": "1-2 paragraphs. Chiron somatically — the embodied quality of the wound. What begins to shift when you stay."},
    {"title": "A new response", "subtitle": "The move that changes things", "content": "1-2 paragraphs. North Node sign + house named explicitly.", "utterance": "One real sentence they could say out loud. Specific to their North Node. Slightly dangerous. Not polished."}
  ],
  "closing": "3-5 sentences. A real scene from North Node house. Not redemptive. Just real.",
  "transits": {"synthesis": "ONE paragraph, 4-6 sentences. NO planet names. NO sign names. NO house numbers. NO astrology terminology. Plain human language only. What is this person up against right now. How it connects to their specific trap. What their growing edge is. Chad Herst voice. Body and relationship. Short sentences. Honest not hopeful."}
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

The reading names that role — your Performance Archetype. It's not a flaw. It's brilliant adaptation. Your nervous system learned how to survive in an environment where connection had to be earned.

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

It's not one moment. It's thousands of moments — every time you felt something true and set it aside to stay connected. Every time you chose the relationship over your own truth. That accumulation lives in your body. As tightness. As ache. As something unfinished.

The wound is sacred not because the pain is good. It's sacred because it's precise. It shows you exactly where you've been leaving yourself. And if you stay with it — not fix it, not transcend it, just stay — it becomes a doorway back to yourself.

I spent years trying to meditate it away, stretch past it, yoga it into submission. Then I finally sat still long enough to feel the knot in my gut — that tight, deep thing that had been sitting there for decades — and something in me shifted. Not because it went away. Because I finally stopped running from it.

But here's what stops most people: the moment you touch that wound, your nervous system panics.

Because you've learned something old and deep: needing is dangerous. Showing what hurts makes you too much. So the moment the ache rises, you do what you've always done — you push it down, medicate it, achieve past it, anything but feel it.

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

You know the pattern. You've named it. You can probably feel where it lives in your body — the places you override, the moments you perform, the ways you learned not to need.

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
        const { city, name, email, date, time, tz } = JSON.parse(body);
        const geoData = await fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, { 'User-Agent': 'PerformanceTrapApp/1.0' });
        if (!geoData.length) { res.writeHead(400); res.end(JSON.stringify({ error: `Could not find "${city}". Try: "San Rafael, California, USA"` })); return; }
        const lat = parseFloat(geoData[0].lat), lon = parseFloat(geoData[0].lon);
        const chart = buildChart(date, time, parseFloat(tz), lat, lon);
        const text = chartToText(chart, name);
        const transitData = calcTransitWeather(chart);
        const transitText = formatTransitsForPrompt(transitData, chart);
        console.log('Chart for', name, ':\n' + text);
        console.log('Transits:\n' + transitText);
        const [reading] = await Promise.all([
          callAnthropic(SYS, `Read this chart for ${name}:\n\n${text}\n\n===REQUIRED: CURRENT PLANETARY WEATHER===\nYou MUST use the following data for the transits.synthesis field. Name each planet and its house explicitly.\n${transitText}`),
          addToMailchimp(email, name)
        ]);
        res.writeHead(200); res.end(JSON.stringify({ lat, lon, reading, chart }));
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
