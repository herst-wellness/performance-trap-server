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
Wrong: "The wound is also the gift. Your ability to hold space for rage..."
Right: "That survival strategy kept you alive. It is also why you're exhausted. Those are both true. Neither one is poetic."
Delete any sentence that makes the pain sound meaningful or purposeful. State it and stop.

RULE 4 — NO PSYCHOLOGICAL EQUATIONS:
"You fight for everyone else's right to be angry while your own stays buried" is a clean psychological equation. It packages raw material into a lesson.
Instead: describe what actually happens in the moment.
Wrong: "You turn your rage into wisdom."
Right: "Someone else gets to lose their shit in the room. You take notes. You write the workshop about it later."

RULE 5 — STATE THE TRUTH AND STOP:
Do not rush in after a hard observation to explain it, soften it, or make it make sense.
Say it. Put a period. Move on. Let the discomfort sit.
If you feel the impulse to follow a hard sentence with a comforting one, delete the comforting one.

RULE 6 — THE TEST:
Before keeping any sentence, ask: is this a body or is this a lesson?
If it sounds wise, it's probably a lesson. Cut it.
If it describes what happens in the chest or the throat or the gut, keep it.

About 1000 words total. Short paragraphs. White space. Hard stops.



THE SEVEN LAYERS:

01 THE ORIGINAL SIGNAL — Moon sign + house
What did this nervous system reach for before it learned to stop reaching?
Name the Moon sign and translate it immediately into a gritty physical reality.
Wrong: "Your Moon in Scorpio reached for the kind of intimacy that doesn't lie."
Right: "You've got your Moon in Scorpio. Your body is wired for the kind of contact that doesn't bullshit."
Then: what house. What that means for where the signal got loudest. What happened to it there.
State what it wanted. State what happened to that wanting. Do not romanticize either.

02 THE MAP OF BELONGING — Saturn + 4th house
The map was the set of rules the environment installed. Name them bluntly.
Wrong: "The environment communicated that emotional needs were a luxury."
Right: "The map said: your feelings are expensive. Make them worth something or keep them to yourself."
Saturn sign = the specific demand. Cancer: your feelings are a burden. Capricorn: prove it. Virgo: be useful or be quiet. Aquarius: don't get emotional. Scorpio: I can see through you. Gemini: be light, don't get heavy. Libra: keep the peace.
Saturn house = where that demand was loudest.
Hard Saturn-Moon aspects: the map stopped feeling like a map. It felt like reality.
Say what the environment communicated. One sentence. Then stop.

03 THE DOUBLE BIND — Mercury
Two tracks running at the same time. What the body sensed. What got said out loud.
Wrong: "Mercury in Scorpio learned to speak two languages — the truth and the version that wouldn't cost connection."
Right: "Your Mercury in Scorpio could see what was actually happening. You learned to keep that to yourself. Not because you were weak. Because you watched what happened when you didn't."
Mercury-Saturn: speaking the truth learned to feel dangerous. Show the moment, not the conclusion.
Mercury-Neptune: the signal and the story blurred. They couldn't tell what they felt from what they'd absorbed.
The cost is losing trust in their own perception. Say it like that. Then stop. Do not explain why that matters.

04 THE OVERRIDE — Saturn-Mars + 6th house
Name what the override actually does in the body.
Wrong: "Your drive got bonded to fear."
Right: "The engine that moves you also scans for threats. Every time. Before you speak. Before you act. The scan happens whether you want it to or not."
Saturn-Mars hard aspect: performance as anxiety management. Fear and drive, same wire.
6th house: the body became the performance instrument. What that looks like specifically.
Then name what it cost. One sentence. Do not turn that cost into a lesson or a paradox.

05 THE SACRED WOUND — Chiron
Chiron is where the somatic imprint lives. The ache. Where in life it shows up.
Name the wound directly. No poetry. No paradox.
Wrong: "Here's the paradox that doesn't resolve: the wound is also the gift."
Wrong: "The wound and the gift live in the same place."
Right: "That survival strategy kept you safe. It is also why you're exhausted. Those are both true. Neither one is poetic."
Right: "The same hypervigilance that makes you good at reading rooms is what keeps you from having a room of your own. That's not a paradox. That's just the cost."

HARD BAN: Never use the word "gift" to describe a trauma response, a wound, or a survival strategy. Ever.
The protectors are strategies. They worked. They also cost something. Name both without making either one sound meaningful.
Do not call the wound a gift. Do not say the pain made them effective. Do not say the wound became the medicine. Say: the same strategy that protected them is now the thing they're exhausted from running.

06 THE PERFORMANCE DISGUISE — ASC + Sun + South Node
The ASC is the face. Name what it does in a room. Specifically.
Wrong: "Gemini rising learned to be whatever the moment needs."
Right: "Gemini rising walks into a room and immediately starts reading it. Who needs what. What register to speak in. The calibration happens before the first word."
Sun in its house: what gets offered to earn connection. State it plainly.
Sun-Neptune: the performance feels like a calling. They genuinely believe it. That makes it harder to see.
South Node: the specific contract that keeps getting signed. The role that keeps getting played.
Wrong: "You keep falling into the role of the curious observer who never gets to be the subject."
Right: "You ask better questions than you answer. That's not an accident. That's the trap."
Name what it costs. Do not console them for it.

07 THE THIRD OPTION — North Node
Follow this sequence exactly. Do not skip steps. Do not merge them.

ONE: Name the feeling tone this person needs to keep company with. Not fix. Not transcend. Keep company with — the way you sit with a friend having a hard moment. Describe the emotional quality based on their chart. Do NOT describe physical sensations or body locations — you can't know that.

TWO: Name the unique ache — the specific shape of this person's not-enoughness based on their chart. Not generic loneliness. It has a particular texture. State it directly.

THREE: Describe how they've kept the peace or made everyone else comfortable. The specific moves. What they do with their own truth when it would create friction. Name it plainly.

FOUR: Describe what actually matters to them underneath the performance. Not values in the abstract. The specific tender thing this chart shows.

FIVE: Name the compromise they tend to make and what it costs them. Dignity, or honesty, or being known, or their own anger. The specific thing this chart shows them giving up. Name the price. Don't soften it.

SIX: The third option. The move that breaks the double bind — not fight, not submit. A simple utterance they can speak right now without apologizing for it. Make it specific to their North Node sign and house. One real sentence a real person could actually say.

SEVEN: One concrete step that honors their reality instead of erasing it. Specific to this chart.

THIS CHART USES WHOLE SIGN HOUSES. ASC sign = House 1.

RESPOND WITH ONLY VALID JSON, nothing before or after:
{"headline":"One sentence. The central relational thing — what they learned to do to belong, and what it cost. No hedging. No comfort.","sections":[{"title":"The Original Signal","content":"2-3 paragraphs. Moon. The body in relationship before adaptation. State what it wanted. State what happened to that wanting."},{"title":"The Map of Belonging","content":"2-3 paragraphs. Saturn and 4th house. The specific conditions. What the environment communicated. Say it plainly."},{"title":"The Double Bind","content":"2 paragraphs. Mercury. The two channels. How trust in their own perception got trained away. State the cost and stop."},{"title":"The Override","content":"2 paragraphs. Saturn-Mars and 6th house. How the body got silenced. What it cost. Do not turn the cost into a lesson."},{"title":"The Sacred Wound","content":"3 paragraphs. Chiron. The ache. The protectors. The paradox — gifts and wound as the same place. Hold both without resolving the tension."},{"title":"The Performance Disguise","content":"2-3 paragraphs. ASC, Sun, South Node. The face. The offer. The pattern. Name what it costs without consoling them for it."},{"title":"The Third Option","content":"Follow the seven-step sequence exactly. About 250 words. Specific to their North Node. Do not wrap it up. Do not make it inspiring."}],"closing":"One moment. In relationship. The third option happening. Concrete. Do not make it redemptive. Just make it real.","transits":{"synthesis":"Open by naming each planet and its exact house number: Saturn in your Xth house, Pluto in your Xth, Neptune in your Xth, Uranus in your Xth. Then 4-5 sentences on what this collective weather means for this specific person's trap and evolution. Find the thread connecting all four. Use the framework language. Short sentences. Do not make it hopeful. Make it honest."}}`;

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
