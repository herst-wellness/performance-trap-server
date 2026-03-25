const https = require('https');
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

// ── ASTRONOMY ──────────────────────────────────────────────────
const D2R=Math.PI/180,R2D=180/Math.PI,md=x=>((x%360)+360)%360;
function jd(y,m,d,h){let Y=y,M=m,D=d+h/24;if(M<=2){Y--;M+=12}const A=Math.floor(Y/100),B=2-A+Math.floor(A/4);return Math.floor(365.25*(Y+4716))+Math.floor(30.6001*(M+1))+D+B-1524.5}
function ea(Mr,e){let E=Mr;for(let i=0;i<50;i++){const dE=(Mr-E+e*Math.sin(E))/(1-e*Math.cos(E));E+=dE;if(Math.abs(dE)<1e-10)break}return E}
function ta(Md,e){const E=ea(Md*D2R,e);return md(2*Math.atan2(Math.sqrt(1+e)*Math.sin(E/2),Math.sqrt(1-e)*Math.cos(E/2))*R2D)}
const ORB={mercury:{M0:174.79252,Md:4.09235503,e:.20563175,w0:77.45645,wd:.00043585},venus:{M0:50.44675,Md:1.60213352,e:.00677219,w0:131.56785,wd:.00015459},mars:{M0:19.387,Md:.52402614,e:.09341233,w0:336.04084,wd:.00012165},jupiter:{M0:20.0205,Md:.0830916,e:.04849485,w0:14.33131,wd:.00059192},saturn:{M0:317.02,Md:.03344536,e:.05550825,w0:92.86136,wd:.00155965},uranus:{M0:142.95517,Md:.01170786,e:.0462959,w0:170.96424,wd:.00111982},neptune:{M0:259.376,Md:.00597968,e:.00898809,w0:44.97135,wd:.00390245},pluto:{M0:14.864,Md:.00396961,e:.24880766,w0:224.06676,wd:-.00011055}};
function pLon(n,j){const o=ORB[n],d=j-2451545,M=md(o.M0+o.Md*d),w=md(o.w0+o.wd*d);return md(ta(M,o.e)+w)}
function sunLon(j){const T=(j-2451545)/36525,L0=md(280.46646+36000.76983*T),M=md(357.52911+35999.05029*T)*D2R,C=(1.914602-.004817*T)*Math.sin(M)+(.019993-.000101*T)*Math.sin(2*M)+.000289*Math.sin(3*M),om=md(125.04-1934.136*T)*D2R;return md(L0+C-.00569-.00478*Math.sin(om))}
function moonLon(j){const T=(j-2451545)/36525,Lp=md(218.3164477+481267.88123421*T-.0015786*T*T),D=md(297.8501921+445267.1114034*T-.0018819*T*T)*D2R,M=md(357.5291092+35999.0502909*T-.0001536*T*T)*D2R,Mp=md(134.9633964+477198.8675055*T+.0087414*T*T)*D2R,F=md(93.272095+483202.0175233*T-.0036539*T*T)*D2R;let s=0;[[6.288774,[0,0,1,0]],[1.274027,[2,0,-1,0]],[.658314,[2,0,0,0]],[.213618,[0,0,2,0]],[-.185116,[0,1,0,0]],[-.114332,[0,0,0,2]],[.058793,[2,0,-2,0]],[.057066,[2,-1,-1,0]],[.053322,[2,0,1,0]],[.045758,[2,-1,0,0]],[-.040923,[0,1,-1,0]],[-.03472,[1,0,0,0]],[-.030383,[0,1,1,0]],[.015327,[2,0,0,-2]],[.01098,[0,0,1,-2]],[.010675,[4,0,-1,0]],[.010034,[0,0,3,0]],[.008548,[4,0,-2,0]],[-.007888,[2,1,-1,0]],[-.006766,[2,1,0,0]],[-.005163,[1,0,-1,0]],[.004987,[1,1,0,0]],[.004036,[2,-1,1,0]],[.003994,[2,0,3,0]]].forEach(([a,[dD,dM,dMp,dF]])=>{s+=a*Math.sin(dD*D+dM*M+dMp*Mp+dF*F)});return md(Lp+s)}
function nnLon(j){const T=(j-2451545)/36525;return md(125.04452-1934.136261*T+.0020708*T*T)}
function chLon(j){return md(55+7.1*(j-2447892.5)/365.25)}
function calcAsc(jd,lat,lon){const T=(jd-2451545)/36525,eps=(23.4392911-.013004167*T)*D2R,J0=Math.floor(jd-.5)+.5,T0=(J0-2451545)/36525,gmst=md(100.4606184+36000.7700536*T0+360.98564724*(jd-J0)),LMST=md(gmst+lon),RAMC=LMST*D2R,latR=lat*D2R,cosRAMC=Math.cos(RAMC),sinRAMC=Math.sin(RAMC),cosEps=Math.cos(eps),sinEps=Math.sin(eps),tanLat=Math.tan(latR);return md(Math.atan2(cosRAMC,-(sinRAMC*cosEps+tanLat*sinEps))*R2D)}
const SGN=['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
const so=lon=>({sign:SGN[Math.floor(lon/30)],deg:Math.floor(lon%30)});
const wsh=(pLon,ascIdx)=>((Math.floor(pLon/30)-ascIdx+12)%12)+1;
function buildChartText(ds,ts,tz,lat,lon,name){
  const[y,m,d]=ds.split('-').map(Number),[h,mn]=ts.split(':').map(Number);
  let u=h+mn/60-tz,dd=d,mm=m,yy=y;
  if(u<0){u+=24;dd--}if(u>=24){u-=24;dd++}
  const j=jd(yy,mm,dd,u),aL=calcAsc(j,lat,lon),ascIdx=Math.floor(aL/30);
  const raw={Sun:sunLon(j),Moon:moonLon(j),Mercury:pLon('mercury',j),Venus:pLon('venus',j),Mars:pLon('mars',j),Jupiter:pLon('jupiter',j),Saturn:pLon('saturn',j),Uranus:pLon('uranus',j),Neptune:pLon('neptune',j),Pluto:pLon('pluto',j),'North Node':nnLon(j),Chiron:chLon(j)};
  const lines=Object.entries(raw).map(([k,v])=>{const s=so(v);return`${k}: ${s.sign} ${s.deg}° · House ${wsh(v,ascIdx)}`});
  const as=so(aL),mc=so(md(aL+270));
  lines.push(`ASC: ${as.sign} ${as.deg}° (Whole Sign Houses — ${as.sign} is House 1)`);
  lines.push(`MC: ${mc.sign} ${mc.deg}°`);
  return`${name}'s Chart (Whole Sign Houses):\n${lines.join('\n')}`;
}

function fetchJSON(reqUrl, headers={}) {
  return new Promise((resolve, reject) => {
    const u = new URL(reqUrl);
    const lib = u.protocol === 'https:' ? https : http;
    lib.get({hostname:u.hostname,path:u.pathname+u.search,headers:{'Accept':'application/json',...headers}}, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    }).on('error',reject);
  });
}

function callAnthropic(system, userMsg) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system,
    messages: [{role:'user',content:userMsg}]
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Content-Length':Buffer.byteLength(body),
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version':'2023-06-01'
      }
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const apiData=JSON.parse(d);
          if(apiData.error) throw new Error(apiData.error.message);
          const raw=apiData.content?.[0]?.text||'';
          let reading; try{reading=JSON.parse(raw)}catch{reading=JSON.parse(raw.replace(/```json|```/g,'').trim())}
          resolve(reading);
        } catch(e){reject(e)}
      });
    });
    req.on('error',reject); req.write(body); req.end();
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

RULES: Plain language only — no jargon without immediate translation. Story before mechanism. Surface objections proactively. Specific and warm like a wise caring friend. Always name what the pattern costs. About 800 words total.

RESPOND WITH ONLY VALID JSON, nothing before or after:
{"headline":"One sentence capturing the central ache and gift of this specific chart","sections":[{"title":"What was there before the trap","content":"2-3 paragraphs about the Moon — the original signal before any adaptation"},{"title":"The environment that made it necessary","content":"2-3 paragraphs about the 4th house and Saturn — how the wound formed"},{"title":"Where the wound lives","content":"2-3 paragraphs about Chiron — the sacred wound and the gift inside it"},{"title":"The face that was built","content":"2-3 paragraphs about ASC and Sun — the performing self"},{"title":"How it all wires together","content":"2-3 paragraphs showing the circuit — how the pieces reinforce each other"},{"title":"What the chart is pointing toward","content":"2-3 paragraphs about North Node — the third option"}],"closing":"One warm, concrete, specific image of the third option as one real moment in this person's actual life"}`;

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'POST' && req.url === '/reading') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { city, name, date, time, tz } = JSON.parse(body);

        // Geocode
        const geoData = await fetchJSON(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
          { 'User-Agent': 'PerformanceTrapApp/1.0' }
        );
        if (!geoData.length) {
          res.writeHead(400); res.end(JSON.stringify({ error: `Could not find "${city}". Try: "San Rafael, California, USA"` })); return;
        }
        const lat = parseFloat(geoData[0].lat), lon = parseFloat(geoData[0].lon);

        // Build chart + call Claude — no timeout pressure
        const ct = buildChartText(date, time, parseFloat(tz), lat, lon, name);
        const reading = await callAnthropic(SYS, `Read this chart for ${name}:\n\n${ct}`);

        res.writeHead(200); res.end(JSON.stringify({ lat, lon, reading }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message || 'Something went wrong.' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`Performance Trap server running on port ${PORT}`));
