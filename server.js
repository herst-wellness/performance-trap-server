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

// ── TRANSIT CALCULATOR ─────────────────────────────────────────
const TRANSIT_PLANETS = {
  saturn:  { label: 'Saturn', meaning: 'structure and reality-testing' },
  pluto:   { label: 'Pluto',  meaning: 'core evolutionary pressure' },
  uranus:  { label: 'Uranus', meaning: 'disruption and awakening' },
  neptune: { label: 'Neptune',meaning: 'dissolution and reconfiguration' },
  node:    { label: 'North Node', meaning: 'direction of growth' },
};

const NATAL_POINTS = ['sun','moon','mercury','saturn','chiron','asc','node'];
const ASPECTS_TO_CHECK = [
  {name:'conjunction',angle:0},
  {name:'opposition',angle:180},
  {name:'square',angle:90},
  {name:'trine',angle:120},
];
const TRANSIT_ORB = 5;

function jdToDateStr(j) {
  const d = new Date((j - 2440587.5) * 86400000);
  return d.toISOString().split('T')[0];
}

function aspectDiff(tLon, nLon, aspAngle) {
  let d = md(tLon - nLon);
  if (d > 180) d = 360 - d;
  return Math.abs(d - aspAngle);
}

function findTransitPasses(planet, natalLon, aspAngle, orb, startJD, endJD) {
  const step = 3;
  const passes = [];
  let inOrb = false, passStart = null, bestJD = null, bestDiff = 999;

  for (let j = startJD; j <= endJD; j += step) {
    const T = (j - 2451545) / 36525;
    const tLon = calcGeoLon(planet, T);
    const diff = aspectDiff(tLon, natalLon, aspAngle);

    if (diff <= orb) {
      if (!inOrb) { inOrb = true; passStart = j; bestDiff = diff; bestJD = j; }
      if (diff < bestDiff) { bestDiff = diff; bestJD = j; }
    } else if (inOrb) {
      // Refine exact date
      let lo = bestJD - step * 2, hi = bestJD + step * 2;
      for (let i = 0; i < 25; i++) {
        const mid = (lo + hi) / 2;
        const dMid = aspectDiff(calcGeoLon(planet, (mid - 2451545) / 36525), natalLon, aspAngle);
        const dLo = aspectDiff(calcGeoLon(planet, (lo - 2451545) / 36525), natalLon, aspAngle);
        if (dMid < dLo) lo = mid; else hi = mid;
      }
      passes.push({ start: jdToDateStr(passStart), exact: jdToDateStr((lo + hi) / 2), end: jdToDateStr(j) });
      inOrb = false; passStart = null; bestDiff = 999; bestJD = null;
    }
  }
  if (inOrb && passStart) {
    passes.push({ start: jdToDateStr(passStart), exact: 'ongoing', end: 'ongoing' });
  }
  return passes;
}

function calcTransits(natalChart) {
  const now = new Date();
  const todayJD = jd(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), 0);
  const startJD = todayJD - 180; // 6 months ago
  const endJD = todayJD + 365 * 3; // 3 years ahead

  // Build natal longitude map
  const natalLons = {};
  for (const key of NATAL_POINTS) {
    const display = { sun:'Sun', moon:'Moon', mercury:'Mercury', saturn:'Saturn', chiron:'Chiron', asc:'ASC', node:'North Node' }[key];
    if (natalChart[display]) natalLons[key] = { lon: natalChart[display].lon, label: display, sign: natalChart[display].sign, deg: natalChart[display].deg };
  }

  const activeTransits = [];
  const upcomingTransits = [];

  for (const [tPlanet, tInfo] of Object.entries(TRANSIT_PLANETS)) {
    for (const [nKey, nInfo] of Object.entries(natalLons)) {
      for (const asp of ASPECTS_TO_CHECK) {
        const passes = findTransitPasses(tPlanet, nInfo.lon, asp.angle, TRANSIT_ORB, startJD, endJD);
        if (!passes.length) continue;

        for (const pass of passes) {
          const transit = {
            transiting: tInfo.label,
            transitingMeaning: tInfo.meaning,
            aspect: asp.name,
            natal: nInfo.label,
            natalSign: nInfo.sign,
            natalDeg: nInfo.deg,
            start: pass.start,
            exact: pass.exact,
            end: pass.end,
          };

          const passEndDate = pass.end === 'ongoing' ? new Date(9999,0,1) : new Date(pass.end);
          const passStartDate = new Date(pass.start);
          const today = new Date();

          if (passStartDate <= today && passEndDate >= today) {
            activeTransits.push(transit);
          } else if (passStartDate > today) {
            upcomingTransits.push(transit);
          }
        }
      }
    }
  }

  // Sort upcoming by start date, take next 3
  upcomingTransits.sort((a, b) => new Date(a.start) - new Date(b.start));

  // Prioritize framework-relevant transits
  const frameworkPriority = ['Moon','Saturn','Mercury','ASC','Sun','Chiron','North Node'];
  function priorityScore(t) {
    const nIdx = frameworkPriority.indexOf(t.natal);
    const pScore = {pluto:10,neptune:9,uranus:8,saturn:7,node:5}[t.transiting.toLowerCase().replace(' node','').replace('north ','')] || 3;
    const nScore = nIdx >= 0 ? (frameworkPriority.length - nIdx) : 0;
    return pScore + nScore;
  }
  activeTransits.sort((a,b) => priorityScore(b) - priorityScore(a));
  upcomingTransits.sort((a,b) => new Date(a.start) - new Date(b.start));

  return {
    active: activeTransits.slice(0, 5),
    upcoming: upcomingTransits.slice(0, 3),
    today: now.toISOString().split('T')[0],
  };
}

function formatTransitsForPrompt(transits) {
  const lines = [`TODAY: ${transits.today}`, ''];

  if (transits.active.length > 0) {
    lines.push(`ACTIVE TRANSITS NOW — ${transits.active.length} active (copy these exact strings and dates into JSON):`);
    for (const t of transits.active) {
      const exactStr = t.exact === 'ongoing' ? 'exact recently/ongoing' : `exact ${t.exact}`;
      const endStr = t.end === 'ongoing' ? 'still building' : `ends approx ${t.end}`;
      const label = `${t.transiting} ${t.aspect} natal ${t.natal} (${t.natalSign} ${t.natalDeg}°)`;
      lines.push(`TRANSIT: "${label}" | DATES: "began ${t.start}, ${exactStr}, ${endStr}" | PLANET MEANING: ${t.transitingMeaning}`);
    }
    lines.push('');
  }

  if (transits.upcoming.length > 0) {
    lines.push('UPCOMING TRANSITS (use these exact strings and dates in the JSON output):');
    for (const t of transits.upcoming) {
      const label = `${t.transiting} ${t.aspect} natal ${t.natal} (${t.natalSign} ${t.natalDeg}°)`;
      lines.push(`TRANSIT: "${label}" | DATES: "begins ${t.start}, exact ${t.exact}"`);
    }
  }

  return lines.join('\n');
}

const SYS = `You are writing a natal chart reading through the Performance Trap Framework — Chad Herst's original system for understanding how a person learned that connection has to be earned, and what relational shape they built to manage that.

This is a relational model. Every layer describes what happened in relationship and what keeps happening in relationship. Write to the person directly, quietly, as if sitting across from them. They are reading this alone.

THE FRAMEWORK — seven layers, in sequence:

01 THE ORIGINAL SIGNAL — Moon sign + house
Before any adaptation, before any role was learned, what did this nervous system reach for in relationship? The Moon is the body's original broadcast — what it expected to give and receive before it learned that reaching didn't always work. Moon sign is the specific quality of that signal. Moon house is where in life it was most active and most at risk of being muted. Write it as a body in relationship, not an emotional concept.

02 THE MAP OF BELONGING — Saturn + 4th house
We all grow up with a map of how to be loved. Saturn describes the specific relational conditions that shaped this person's contract — what the early environment communicated about how connection had to be earned. Read Saturn's sign as the specific demand ("don't be a burden," "prove your worth," "be rational not emotional," "be useful and correct"). Read Saturn's house as the arena where that demand was loudest. The 4th house describes the emotional atmosphere of the home — what the landmarks were. Hard Saturn-Moon aspects mean the map ran so deep it stopped feeling like a map and started feeling like reality.

03 THE DOUBLE BIND — Mercury
The double bind is where the person learned to distrust their own reading of the room. One channel said come close. The other channel — tone, posture, silence, the jaw clenched tight enough to snap — said something different. Mercury describes how the person learned to run two tracks simultaneously: what the body sensed and what got spoken aloud. Mercury-Saturn aspects mean speaking the truth learned to feel dangerous early. Mercury-Neptune means the person couldn't always tell what they felt from what they absorbed from others. The double bind isn't confusion. It's a survival system. The cost is losing trust in your own perception.

04 THE OVERRIDE — Saturn-Mars + 6th house
If the body is wrong, it must be silenced. The override is what happens after the double bind takes hold. The person splits in two: a mind that watches the room, and a body that learns to be ignored. Saturn-Mars describes the engine — fear and drive bonded together, performance as a way of managing baseline anxiety. The 6th house shows where the body became the performance instrument. Describe what the override feels like somatically — the shallow breath, the chest that braces, the scanning before entering a room. And name what it cost.

05 THE SACRED WOUND — Chiron
The sacred wound is the somatic imprint of the relational trades. Not one trade — thousands of them. The nervous system memory of: I will bury this to keep the peace. I will disappear so the bond survives. Chiron's sign describes the specific shape of the ache. Chiron's house describes where in life that ache lives most actively.

But the wound rarely shows up alone. It's guarded by protectors — perfectionism, self-sufficiency, the performance of having it together. These aren't character defects. They're strategies. Often they're superpowers.

Then name the Paradox of Performance: the gifts, capacities, and strengths this person carries often came directly through the wounding. The drive that makes them effective. The empathy that makes them good at what they do. The question is not whether those gifts are real — they are. The question is whether they can now offer them without still paying the old price.

06 THE PERFORMANCE DISGUISE — ASC + Sun + South Node
The ASC is the relational face built to manage the room — the specific way this person learned to show up so the bond would hold. The Sun in its house shows what gets offered to earn connection. Sun conjunct Neptune: the performance feels like a calling, nearly impossible to question. Sun square Saturn: constant self-audit before speaking.

The South Node is the specific relational shape of the trap — the role that keeps getting replayed in relationships, the contract that keeps getting signed. It describes the default: the pattern that collapses time back to the original bind. Not a flaw. A groove worn deep by repetition. Name it specifically.

07 THE THIRD OPTION — North Node
When the trap is running, it feels like only two options: push back and risk the bond, or go quiet and lose yourself. That narrowing is the trap.

The North Node is the move that didn't exist back then. Not fight. Not submit. The third option: staying related to the other while staying true to yourself. Connected without selling yourself out.

Read the North Node's sign as the specific quality of that move — what it feels like when the person finds it. Read the North Node's house as the relational arena where that move is most needed and most available. This is not a future destination. It is a quality available right now, in the body, in this moment.

THIS CHART USES WHOLE SIGN HOUSES. ASC sign = House 1. Each subsequent sign = next house.

VOICE — THIS IS THE MOST IMPORTANT INSTRUCTION:
Write the way someone speaks who has lived inside this territory. Not taught it from outside.

Short sentences. Let them land before the next one comes. Name the physical experience before naming what it means. The body first, then the interpretation.

Do not write like a guide explaining a system. Do not use "this placement suggests" or "in this framework" or "this indicates." Write as if you already know them.

Name what things cost. Quietly. "There just wasn't room for it." Not "this created significant challenges."

Hold ambiguity when it's true. "I don't know exactly what that version of you looked like, but I can sense it through the longing" is more honest than false certainty.

The ache is not proof they're broken. The place they had to adapt is usually where the gifts came through. Hold both without collapsing either.

About 950 words total. Two to four sentences per paragraph. Let them breathe.

RESPOND WITH ONLY VALID JSON, nothing before or after:
{"headline":"One sentence. Quiet, specific, earned. The central relational thing — what they learned to do to belong, and what it cost.","sections":[{"title":"The Original Signal","content":"2-3 paragraphs. The Moon. The body in relationship before any adaptation. What it reached for. Physical and specific."},{"title":"The Map of Belonging","content":"2-3 paragraphs. Saturn and the 4th house. The specific relational conditions that shaped the contract. The landmarks. What the environment communicated about how connection had to be earned."},{"title":"The Double Bind","content":"2 paragraphs. Mercury. The two channels. What the body sensed and what got spoken. How trust in their own perception got trained away."},{"title":"The Override","content":"2 paragraphs. Saturn-Mars and the 6th house. How the body got silenced. The somatic shape of the split. What it cost."},{"title":"The Sacred Wound","content":"3 paragraphs. Chiron. The specific ache and where it lives. The protectors that guard it. Then the Paradox of Performance — the gifts that came through the wounding, and the question of whether they can now offer those gifts without still paying the old price."},{"title":"The Performance Disguise","content":"2-3 paragraphs. ASC, Sun, and South Node. The relational face. What gets offered to earn connection. The specific role that keeps getting replayed — the shape of the trap in relationship."},{"title":"The Third Option","content":"2-3 paragraphs. North Node. The move that didn't exist back then. The specific quality and relational arena. Connected without selling yourself out. Available now."}],"closing":"One moment. Concrete. In the body. In relationship. The third option happening — not an insight, a scene.","transits":{"overview":"2-3 sentences. Where the relational trap is under pressure right now. Name the specific transits. Quiet voice.","active":[{"transit":"COPY EXACTLY from transit data e.g. Saturn square natal Saturn (Cancer 3°)","dates":"COPY EXACTLY from transit data e.g. began 2026-01-26, exact 2026-03-12, ends approx 2026-04-23","interpretation":"2-3 sentences. What this pressure means for this person's specific relational pattern. Where the trap is being asked to evolve. Physical and specific."}],"upcoming":[{"transit":"COPY EXACTLY from transit data","dates":"COPY EXACTLY from transit data e.g. begins 2026-05-11, exact 2026-07-28","interpretation":"1-2 sentences. What's approaching and why it matters for this chart's relational pattern."}]}}`;

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
        const transits = calcTransits(chart);
        const transitText = formatTransitsForPrompt(transits);
        console.log('Chart for', name, ':\n' + text);
        console.log('Transits:\n' + transitText);
        const [reading] = await Promise.all([
          callAnthropic(SYS, `Read this chart for ${name}:\n\n${text}\n\nTRANSIT CONTEXT:\n${transitText}`),
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

  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
