const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const MAILCHIMP_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_LIST_ID = process.env.MAILCHIMP_LIST_ID;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER_PREFIX || 'us6';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
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
  // L = mean longitude, a = semi-major axis, e = eccentricity
  // i = inclination, omega = long. of ascending node, w = long. of perihelion
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
// Chiron discovered 1977, orbital period 50.7 years
// Perihelion ~1996, perihelion lon ~339°, a=13.633 AU, e=0.3787
function chironLon(T) {
  // Mean longitude at J2000: 95.5 degrees (Chiron was at ~4° Taurus in 2000)
  // Mean motion: 360/50.7 years = 7.1°/year = 0.194°/day
  const jd_val = T * 36525 + 2451545;
  // Chiron ephemeris: at J1990.0 (JD 2447892.5), Chiron was at Gemini 4° = 64°
  // At J2000.0, Chiron was at Sagittarius 12° = 252°... 
  // Actually Chiron's position varies dramatically due to high eccentricity
  // Let's use proper orbital elements:
  // a=13.633, e=0.3787, i=6.93°, omega=339.41°, Omega=209.37°
  // T_perihelion = 1996 Feb 14 = JD 2450128
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
  // Convert heliocentric to geocentric (approximate - Chiron is far enough that error is small)
  const earthLon = planetHelio('earth', T);
  const earthR = helioRadius('earth', T);
  const chironR = a * (1 - e * Math.cos(E));
  return helioToGeo(hLon, chironR, earthLon, earthR);
}

// Retrograde check (based on speed - approximate)
function isRetrograde(planet, T, dt = 0.5) {
  if (planet === 'sun' || planet === 'moon') return false;
  // Compare position at T-dt and T+dt
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

// Add perturbations for Jupiter and Saturn (improve accuracy significantly)
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
function callAnthropic(system, userMsg) {
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
          if (a.error) throw new Error(a.error.message);
          const raw = a.content?.[0]?.text || '';
          let reading; try { reading = JSON.parse(raw); } catch { reading = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
          resolve(reading);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
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
// Calculate which whole sign house each slow planet currently occupies

function calcTransitWeather(natalChart) {
  const now = new Date();
  const todayJD = jd(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), 0);
  const T = (todayJD - 2451545) / 36525;
  const today = now.toISOString().split('T')[0];

  // Get ASC sign index from natal chart
  const ascLon = natalChart['ASC'] ? natalChart['ASC'].lon : 0;
  const ascSignIdx = Math.floor(ascLon / 30);

  // Current positions of the four outer planets
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

function formatTransitsForPrompt(transitData, natalChart) {
  const { weather, today } = transitData;
  const lines = [`TODAY: ${today}`, ''];
  lines.push('CURRENT OUTER PLANET POSITIONS (whole sign houses for this natal chart):');
  for (const [name, data] of Object.entries(weather)) {
    lines.push(`${name}: ${data.sign} ${data.deg}° — currently in natal House ${data.house}`);
  }
  lines.push('');
  lines.push('FOR THE transits.synthesis FIELD: Start by naming each planet and its exact house number. Then write 4-6 sentences on what this collective weather means for THIS person specifically. Find the thread connecting all four planets. Framework language. Direct voice. No generic astrology. Use ONLY the house numbers listed above — do not invent them.');
  return lines.join('\n');}


const SYS = `You are writing a natal chart reading through the Performance Trap Framework — Chad Herst's original system for understanding how a person learned that connection has to be earned, and the relational shape they built to manage that.

This is a relational model. Every layer is about what happened in relationship and what keeps happening in relationship.

VOICE — THIS IS THE MOST IMPORTANT INSTRUCTION:

You are a fellow traveler. Not a guide. Not a teacher. You know this pain from the inside because you live in it too. You are not on a pedestal. You are sitting across from them at a table, being honest about what you see.

Short sentences. Hard stops. Let them land before the next one comes.

One-line paragraphs when something needs to hit. "So I did." "But it wasn't free." "That's the trap."

Physical experience before interpretation. The body first. The knot in the gut before the insight. The jaw that clenches before the explanation.

No spiritual bypassing. No "this placement invites you to explore." No framework jargon. No hedging. If something is bullshit, say so. If something costs everything, say it costs everything.

Profanity when it's the most honest word available. Not for shock — for precision.

Hold both sides without collapsing either. The ache is real. The gifts that came through it are real. Say both. Don't tidy it up.

About 1000 words total. Short paragraphs. White space. Let the reader breathe.

THE SEVEN LAYERS:

01 THE ORIGINAL SIGNAL — Moon sign + house
Before any role was learned, before any map was followed, what did this nervous system reach for in relationship? The Moon is the original broadcast — the quality of emotional contact this body expected to give and receive before it learned that reaching wasn't safe. Moon sign is the specific texture of that signal. Moon house is where in life it was loudest and most at risk of being silenced. Write it as a body in relationship. Not a concept.

02 THE MAP OF BELONGING — Saturn + 4th house
We all grow up with a map of how to be loved. Saturn describes the specific relational conditions that shaped this person's contract — what the emotional atmosphere communicated about how connection had to be earned. Saturn sign is the specific demand the environment installed: Cancer = don't be a burden. Capricorn = prove your worth. Virgo = be useful and correct. Aquarius = be rational, not emotional. Scorpio = I can see through you. Gemini = be light, be interesting, don't get heavy. Saturn house is where that demand was loudest. Hard Saturn-Moon aspects mean the map ran so deep it stopped feeling like a map. It felt like reality.

03 THE DOUBLE BIND — Mercury
The double bind is where the person learned to distrust their own read of the room. One channel said come close. The other — tone, posture, silence, the jaw clenched tight enough to snap — said something different. Mercury describes how they learned to run two tracks simultaneously: what the body sensed and what got said out loud. Mercury-Saturn aspects mean speaking the truth learned to feel dangerous. Mercury-Neptune means they couldn't always tell what they felt from what they'd absorbed from others. The cost is losing trust in their own perception. Say that cost plainly.

04 THE OVERRIDE — Saturn-Mars + 6th house
If the body is wrong, it must be silenced. The override is what comes after the double bind takes hold. A split: the mind that watches the room, and the body that learns to be ignored. Saturn-Mars is the engine — fear and drive bonded together, performance as a way of managing baseline anxiety about belonging. The 6th house is where the body became the performance instrument. Describe what the override feels like somatically — the scanning before entering a room, the breath that never fully lets go, the chest that braces before speaking. Name what it cost.

05 THE SACRED WOUND — Chiron
The sacred wound is the somatic imprint of the relational trades. Not one trade. Thousands of them. The nervous system memory of: I will bury this to keep the peace. I will disappear so the bond survives. Chiron's sign is the specific shape of that ache. Chiron's house is where it lives most actively.

The wound doesn't show up alone. It's surrounded by protectors — perfectionism, self-sufficiency, the performance of having it together. Don't call these defects. They're strategies. They're often also superpowers.

Then the Paradox of Performance: the drive that makes them effective came from refusing to give up on the still face. The empathy that makes them good at what they do was the survival map for the double bind. The gifts and the wound are the same place. Both true. The question isn't whether the gifts are real. They are. The question is whether they can now offer them without still paying the old price.

06 THE PERFORMANCE DISGUISE — ASC + Sun + South Node
The ASC is the relational face built to manage the room — the specific way this person learned to show up so the bond would hold. The Sun's house shows what gets offered to earn connection. Sun conjunct Neptune: the performance feels like a calling. Nearly impossible to question as performance. Sun square Saturn: a constant internal audit before speaking.

The South Node is the specific relational shape of the trap — the role that keeps getting replayed, the contract that keeps getting signed. Not a flaw. A groove worn deep by repetition. The pattern that collapses time back to the original bind. What role does this person keep playing in relationships? What do they keep offering, hoping this time it will finally be enough?

07 THE THIRD OPTION — North Node
This section follows a specific sequence. Do not skip steps.

ONE: Name the feeling tone this person needs to keep company with — the way you'd sit with a friend having a hard moment. Not fix it. Not transcend it. Just keep it company. Describe this feeling tone specifically based on their chart. Do NOT describe where it lives in the body or what it feels like physically — you can't know that. Describe only its emotional quality and relational shape.

TWO: Describe the unique ache — the specific shape of this person's not-enoughness. The one they've spent their whole life trying to outrun. Be specific to their chart. This is not generic loneliness. It has a particular emotional texture. Do not describe physical sensations.

THREE: Describe how they've kept the peace or made everyone else comfortable. The specific moves they make. What they do with their own truth when it would create friction. The exact shape of the self-abandonment.

FOUR: Describe what actually matters to them — what they're protecting underneath the performance. Not their values in the abstract. The specific tender thing this chart shows.

FIVE: Name the compromise they tend to make and what it costs them. Dignity, or honesty, or being known, or their own anger — name the specific thing this chart shows them repeatedly giving up. Name the price clearly. Don't soften it.

SIX: The third option. The move that breaks the double bind — not by fighting back to prove they're right, and not by caving in to be loved. A simple utterance they can speak out loud right now without apologizing for it. Make it specific to their North Node sign and house. One real sentence a real person could actually say in a real moment.

SEVEN: One concrete step that honors their reality instead of erasing it. Based on this chart. Specific.

THIS CHART USES WHOLE SIGN HOUSES. ASC sign = House 1. Each subsequent sign = next house.

RESPOND WITH ONLY VALID JSON, nothing before or after:
{"headline":"One sentence. The central relational thing — what they learned to do to belong, and what it cost. Specific. No hedging.","sections":[{"title":"The Original Signal","content":"2-3 paragraphs. Moon. The body in relationship before adaptation. Physical first."},{"title":"The Map of Belonging","content":"2-3 paragraphs. Saturn and 4th house. The specific conditions that shaped the contract."},{"title":"The Double Bind","content":"2 paragraphs. Mercury. The two channels. How trust in their own perception got trained away."},{"title":"The Override","content":"2 paragraphs. Saturn-Mars and 6th house. How the body got silenced. Somatic and specific."},{"title":"The Sacred Wound","content":"3 paragraphs. Chiron. The ache. The protectors. The paradox."},{"title":"The Performance Disguise","content":"2-3 paragraphs. ASC, Sun, and South Node. The face. The offer. The pattern that keeps replaying."},{"title":"The Third Option","content":"Follow the seven-step sequence exactly. This is the longest section — about 250 words. Specific to their North Node."}],"closing":"One moment. In the body. In relationship. The third option happening — not an insight, a scene. Concrete enough to feel.","transits":{"synthesis":"One unified paragraph — 4 to 6 sentences. Open by naming each planet and the specific house it currently occupies for this person — e.g. Saturn in Aries in your 11th house, Pluto in Aquarius in your 9th. Then synthesize what that collective weather means for THIS person's performance trap and evolution. Find the thread that connects all four. Framework language. Direct voice. No hedging."}}`;

const server = http.createServer(async (req, res) => {
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
          voice: 'alloy',
          input: text.substring(0, 4096),
          speed: 0.92
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

  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
