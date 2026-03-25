const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const MAILCHIMP_KEY = process.env.MAILCHIMP_API_KEY;
const MAILCHIMP_LIST_ID = process.env.MAILCHIMP_LIST_ID;
const MAILCHIMP_SERVER = process.env.MAILCHIMP_SERVER_PREFIX || 'us6';

// ── SWISS EPHEMERIS ────────────────────────────────────────────
let swe;
try {
  swe = require('swisseph');
} catch(e) {
  console.error('swisseph not available:', e.message);
  swe = null;
}

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const SGN = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];

function toSignObj(lon) {
  const l = ((lon % 360) + 360) % 360;
  return { sign: SGN[Math.floor(l / 30)], deg: Math.floor(l % 30), lon: l };
}

function julianDay(year, month, day, hour) {
  // UT to Julian Day Number
  let y = year, m = month, d = day + hour / 24;
  if (m <= 2) { y--; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function calcAsc(jd, lat, lon) {
  const md = x => ((x % 360) + 360) % 360;
  const T = (jd - 2451545) / 36525;
  const eps = (23.4392911 - 0.013004167 * T) * D2R;
  const J0 = Math.floor(jd - 0.5) + 0.5;
  const T0 = (J0 - 2451545) / 36525;
  const gmst = md(100.4606184 + 36000.7700536 * T0 + 360.98564724 * (jd - J0));
  const LMST = md(gmst + lon);
  const RAMC = LMST * D2R;
  const latR = lat * D2R;
  const y = -Math.cos(RAMC);
  const x = Math.sin(eps) * Math.tan(latR) + Math.cos(eps) * Math.sin(RAMC);
  return md(Math.atan2(y, x) * R2D);
}

function wsh(pLon, ascIdx) {
  return ((Math.floor(((pLon % 360) + 360) % 360 / 30) - ascIdx + 12) % 12) + 1;
}

function calcWithSwissEph(jd, lat, lon) {
  const PLANETS = [
    { id: swe.SE_SUN,       name: 'Sun' },
    { id: swe.SE_MOON,      name: 'Moon' },
    { id: swe.SE_MERCURY,   name: 'Mercury' },
    { id: swe.SE_VENUS,     name: 'Venus' },
    { id: swe.SE_MARS,      name: 'Mars' },
    { id: swe.SE_JUPITER,   name: 'Jupiter' },
    { id: swe.SE_SATURN,    name: 'Saturn' },
    { id: swe.SE_URANUS,    name: 'Uranus' },
    { id: swe.SE_NEPTUNE,   name: 'Neptune' },
    { id: swe.SE_PLUTO,     name: 'Pluto' },
    { id: swe.SE_MEAN_NODE, name: 'North Node' },
    { id: swe.SE_CHIRON,    name: 'Chiron' },
  ];

  const asc = calcAsc(jd, lat, lon);
  const ascIdx = Math.floor(asc / 30);
  const mc = ((asc + 270) % 360 + 360) % 360;
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED;
  const chart = {};

  for (const planet of PLANETS) {
    const result = swe.calc_ut(jd, planet.id, flags);
    if (result.error) {
      console.error(`Error calculating ${planet.name}:`, result.error);
      continue;
    }
    const lon_val = result.longitude;
    const s = toSignObj(lon_val);
    chart[planet.name] = {
      sign: s.sign,
      deg: s.deg,
      lon: s.lon,
      house: wsh(lon_val, ascIdx),
      retrograde: result.longitudeSpeed < 0
    };
  }

  chart['ASC'] = { ...toSignObj(asc), house: null };
  chart['MC'] = { ...toSignObj(mc), house: null };

  return chart;
}

function buildChartText(ds, ts, tz, lat, lon, name) {
  const [y, m, d] = ds.split('-').map(Number);
  const [h, mn] = ts.split(':').map(Number);
  let u = h + mn / 60 - tz, dd = d, mm = m, yy = y;
  if (u < 0) { u += 24; dd--; }
  if (u >= 24) { u -= 24; dd++; }
  const jd = julianDay(yy, mm, dd, u);

  let chart;
  if (swe) {
    chart = calcWithSwissEph(jd, lat, lon);
  } else {
    throw new Error('Swiss Ephemeris not available');
  }

  const lines = Object.entries(chart)
    .filter(([k]) => !['ASC','MC'].includes(k))
    .map(([k, v]) => {
      const retro = v.retrograde ? ' (R)' : '';
      return `${k}: ${v.sign} ${v.deg}°${retro} · House ${v.house}`;
    });
  
  const ascSign = chart['ASC'].sign;
  lines.push(`ASC: ${ascSign} ${chart['ASC'].deg}° (Whole Sign Houses — ${ascSign} is House 1)`);
  lines.push(`MC: ${chart['MC'].sign} ${chart['MC'].deg}°`);

  return { text: `${name}'s Chart (Whole Sign Houses):\n${lines.join('\n')}`, chart };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

function addToMailchimp(email, firstName) {
  return new Promise((resolve) => {
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
        } catch(e) {
          console.log('Mailchimp raw response:', d.substring(0, 200));
        }
        resolve({ ok: true });
      });
    });
    req.on('error', (e) => { console.log('Mailchimp error:', e.message); resolve({ ok: true }); });
    req.write(body);
    req.end();
  });
}

function callAnthropic(system, userMsg) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: userMsg }]
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const apiData = JSON.parse(d);
          if (apiData.error) throw new Error(apiData.error.message);
          const raw = apiData.content?.[0]?.text || '';
          let reading;
          try { reading = JSON.parse(raw); }
          catch { reading = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
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
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Accept': 'application/json', ...headers }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

const SYS = `You are delivering a natal chart reading through the Performance Trap Framework — a system mapping how we learn that love must be earned and what we build as a result.

FRAMEWORK:
ORIGINAL SIGNAL — Moon sign = what the nervous system reached for before adaptation. House = where most active and vulnerable.
HOW IT FORMED — 4th house = early home atmosphere. Saturn-Moon hard = override is detectable. Saturn-Moon soft = override feels like emotional intelligence, nearly invisible. Pluto-Moon = survival intensity. Neptune-Moon = blurred boundaries.
THE SACRED WOUND — Chiron sign + house = where wound lives AND where gift came from. Same place. The wound becomes the medicine.
THE INNER CRITIC — Saturn sign: Cancer="don't be a burden", Capricorn="prove worth through achievement", Aquarius="be rational not emotional", Scorpio="I can see through you". House = where it stands guard most powerfully.
THE PERFORMING SELF — ASC = face built to manage the room. Sun sign + house = what is fundamentally offered to earn connection. Sun-Saturn hard = constant self-audit. Sun-Neptune close = performance feels like calling — most invisible form.
THE THIRD OPTION — North Node sign + house = what was always possible and kept being bypassed. Not a destination — a quality available right now.

This chart uses WHOLE SIGN HOUSES. The ASC sign is House 1. Each subsequent sign is the next house.

Plain language only — no jargon without immediate translation. Story before mechanism. Surface objections proactively. Specific and warm like a wise caring friend. Always name what the pattern costs. About 800 words total.

RESPOND WITH ONLY VALID JSON, nothing before or after:
{"headline":"One sentence capturing the central ache and gift of this specific chart","sections":[{"title":"What was there before the trap","content":"2-3 paragraphs about the Moon — the original signal before any adaptation"},{"title":"The environment that made it necessary","content":"2-3 paragraphs about the 4th house and Saturn — how the wound formed"},{"title":"Where the wound lives","content":"2-3 paragraphs about Chiron — the sacred wound and the gift inside it"},{"title":"The face that was built","content":"2-3 paragraphs about ASC and Sun — the performing self"},{"title":"How it all wires together","content":"2-3 paragraphs showing the circuit — how the pieces reinforce each other"},{"title":"What the chart is pointing toward","content":"2-3 paragraphs about North Node — the third option"}],"closing":"One warm, concrete, specific image of the third option as one real moment in this person's actual life"}`;

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, swisseph: !!swe }));
    return;
  }

  if (req.method === 'POST' && req.url === '/reading') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { city, name, email, date, time, tz } = JSON.parse(body);

        // Geocode
        const geoData = await fetchJSON(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
          { 'User-Agent': 'PerformanceTrapApp/1.0' }
        );
        if (!geoData.length) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: `Could not find "${city}". Try: "San Rafael, California, USA"` }));
          return;
        }
        const lat = parseFloat(geoData[0].lat), lon = parseFloat(geoData[0].lon);

        // Build chart with Swiss Ephemeris
        const { text: chartText, chart } = buildChartText(date, time, parseFloat(tz), lat, lon, name);
        console.log('Chart built successfully for', name);

        // Run Mailchimp and Claude in parallel
        const [reading] = await Promise.all([
          callAnthropic(SYS, `Read this chart for ${name}:\n\n${chartText}`),
          addToMailchimp(email, name)
        ]);

        res.writeHead(200);
        res.end(JSON.stringify({ lat, lon, reading, chart }));
      } catch(e) {
        console.error('Error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message || 'Something went wrong.' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`Performance Trap server running on port ${PORT}, swisseph: ${!!swe}`));
