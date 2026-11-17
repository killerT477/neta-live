/* Neta live sidecar: turns today's real political headlines into satirical, game-safe content and
   merges it into ../events.json, which GitHub Pages serves to the app.

     node sidecar/refresh.mjs                 # real run: needs GEMINI_API_KEY
     node sidecar/refresh.mjs --dry           # print what would be written, change nothing
     node sidecar/refresh.mjs --fixture f.json  # skip the AI call and use a saved reply (for testing)

   US headlines become bakbak posts from the game's parody accounts. India headlines become breaking
   events (pop-up choices). Every item passes a schema check and a content filter; anything that fails is
   dropped, never published. Hand-written stories and posts are never touched: this script only manages
   items whose id starts with "auto_", and deletes them after KEEP_DAYS.
   Plain Node 20+, no dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FEED = path.join(HERE, '..', 'events.json');
const KEEP_DAYS = 14;          // auto items older than this are removed
const MAX_EVENTS = 4;          // new India events per run
const MAX_POSTS = 16;          // new bakbak posts per run
const MAX_AUTO_EVENTS = 24;    // cap on auto events kept in the feed
const MAX_AUTO_POSTS = 120;    // cap on auto posts kept in the feed
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const fixtureAt = args.indexOf('--fixture');
const FIXTURE = fixtureAt >= 0 ? args[fixtureAt + 1] : null;

const SOURCES = {
  us: [
    'https://news.google.com/rss/search?q=(Senate+OR+Congress+OR+midterm+OR+governor+OR+%22White+House%22)+when:2d&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/headlines/section/topic/POLITICS?hl=en-US&gl=US&ceid=US:en',
  ],
  india: [
    'https://www.thehindu.com/news/national/feeder/default.rss',
    'https://news.google.com/rss/search?q=(Lok+Sabha+OR+MLA+OR+minister+OR+election+commission+OR+chief+minister)+India+when:2d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://news.google.com/rss/headlines/section/topic/NATION?hl=en-IN&gl=IN&ceid=IN:en',
  ],
};

// ---------- content rules (same as docs/CONTENT.md in the app repo) ----------
const FX_KEYS = new Set(['pop', 'loy', 'media', 'white', 'black', 'corr', 'heat', 'scandal', 'karma', 'stress', 'rival',
  'cases', 'aura', 'hp', 'cadre', 'legacy', 'oratory', 'network', 'army']);
const MONEY = new Set(['white', 'black']);
const BANKS = new Set(['far', 'you', 'tra', 'urb', 'wom', 'wor']);
const RELS = new Set(['chief', 'fixer', 'journo', 'tycoon', 'rival', 'spouse']);
// Topics the game never touches. Headlines on these are dropped before the AI sees them, and output is re-checked.
const BANNED = new RegExp('\\b(' + [
  'kill\\w*', 'dead', 'death\\w*', 'died', 'dies', 'murder\\w*', 'suicide', 'lynch\\w*', 'assassin\\w*', 'shoot\\w*', 'shot',
  'gun\\w*', 'bomb\\w*', 'blast', 'terror\\w*', 'militan\\w*', 'war', 'wars', 'army strike', 'missile\\w*', 'riot\\w*',
  'communal', 'religio\\w*', 'hindu\\w*', 'muslim\\w*', 'islam\\w*', 'sikh\\w*', 'christian\\w*', 'jain', 'temple', 'mosque',
  'masjid', 'church', 'gurdwara', 'caste\\w*', 'dalit\\w*', 'brahmin\\w*', 'rape\\w*', 'sexual\\w*', 'molest\\w*', 'porn\\w*',
  'flood\\w*', 'earthquake', 'cyclone', 'disaster\\w*', 'tragedy', 'tragic', 'plane crash', 'accident\\w*', 'stampede',
  'pakistan\\w*', 'kashmir\\w*', 'manipur', 'gaza', 'israel\\w*', 'ukrain\\w*', 'hostage\\w*', 'genocide', 'abortion',
  'immigra\\w*', 'deport\\w*', 'refugee\\w*', 'racis\\w*', 'nazi\\w*', 'hitler',
  'cough syrup', 'poison\\w*', 'toxic', 'contaminat\\w*', 'outbreak', 'epidemic', 'hospitali[sz]ed', 'injur\\w*', 'child abuse',
].join('|') + ')\\b', 'i');

const cast = JSON.parse(fs.readFileSync(path.join(HERE, 'cast.json'), 'utf8')).accounts;
const HANDLES = new Set(cast.map(a => a.handle));
const PARODY_NAMES = cast.map(a => a.name.toLowerCase());
const BLOCK = JSON.parse(fs.readFileSync(path.join(HERE, 'blocklist.json'), 'utf8')).names.map(n => n.toLowerCase());
// Single words of real names ("taylor" from "Taylor Swift") are blocked too, unless a parody name uses that word
// ("swift" in "Tailor Swift") or it's too short/common to mean anything.
const PARODY_WORDS = new Set(PARODY_NAMES.flatMap(n => n.split(/[^a-z]+/)));
const COMMON_WORDS = new Set(['cent', 'mann', 'honey', 'badshah', 'grok', 'west', 'mark', 'bill', 'gates', 'shah', 'bhat', 'krishna', 'swamy', 'amul']);
const BLOCK_WORDS = new Set(BLOCK.flatMap(n => n.split(/[^a-z]+/)).filter(w => w.length >= 4 && !PARODY_WORDS.has(w) && !COMMON_WORDS.has(w)));

const today = new Date().toISOString().slice(0, 10);
const stamp = today.replace(/-/g, '');

// ---------- 1. headlines ----------
const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '').trim();

async function readFeed(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'neta-live-sidecar/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const t = decode((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
      return t.replace(/\s+-\s+[^-]{2,40}$/, ''); // drop " - Publisher" suffix that Google News adds
    }).filter(Boolean);
  } catch (e) {
    console.warn(`feed failed: ${url.slice(0, 70)}… (${e.message})`);
    return [];
  }
}

async function headlines(kind) {
  const all = (await Promise.all(SOURCES[kind].map(readFeed))).flat();
  const seen = new Set();
  return all.filter(t => {
    const k = t.toLowerCase().slice(0, 60);
    if (seen.has(k) || BANNED.test(t) || t.length < 25) return false;
    seen.add(k);
    return true;
  }).slice(0, 30);
}

// Capitalised two- and three-word phrases from headlines ("Jane Doe", "New York"): if one of these shows up in the
// output it is probably a real person's name copied across, so the item is dropped.
const NOT_NAMES = /^(white house|supreme court|high court|lok sabha|rajya sabha|vidhan sabha|election commission|chief minister|prime minister|union minister|home minister|finance minister|new delhi|united states|new york|the senate|senate race|house race|the house|election day|exit poll\w*|breaking news|live updates|key races|election results)$/;
function realNameGuesses(lines) {
  const out = new Set();
  for (const l of lines) for (const m of l.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g)) {
    const g = m[1].toLowerCase();
    if (!NOT_NAMES.test(g)) out.add(g);
  }
  return out;
}

// ---------- 2. the AI call ----------
const SYSTEM = `You write content for Neta, a satirical mobile game about Indian politics. Everything is parody.
Hard rules, no exceptions:
- Never write any real person's real name. Only use the parody account names and handles you are given, or invent obviously fictional names.
- Never name a real political party. Say "the ruling side", "the opposition", "the Blue party", "the Red party" or invent a pun name.
- Never: deaths, violence, wars, terrorism, riots, religion, caste, sexual content, slurs, immigration, disasters, health scares (bad medicines, poisonings, outbreaks), anything where people were hurt, or claims that a real person committed a crime.
- Never use a real person's first name or surname on its own either (not even in a pun like "Taylor's version").
- Punch at power, hypocrisy, bureaucracy, campaign theatre and media circus. Light, warm, funny. Hinglish welcome for Indian characters.
- Turn each real headline into its satirical spirit, not its facts. A real seat flip becomes "a seat changed colour"; a real scandal becomes generic political comedy.`;

function userPrompt(us, india) {
  const roster = cast.map(a => `${a.handle} | ${a.name} | ${a.kind} | ${a.bio}${a.sig ? ` | catchphrases: ${a.sig.join(' / ')}` : ''}`).join('\n');
  return `Date: ${today}.

US political headlines from the last two days:
${us.map(t => '- ' + t).join('\n') || '- (none today)'}

Indian political headlines from the last two days:
${india.map(t => '- ' + t).join('\n') || '- (none today)'}

Parody accounts (handle | name | kind | bio):
${roster}

Task A, "posts": write up to ${MAX_POSTS} bakbak posts (the game's fake X/Twitter). At least half react to the US headlines, mostly from the "global" accounts (the US-politics parodies), with Indian accounts chiming in desi-style. The rest react to the Indian headlines. Each post under 220 characters, in that account's voice. "who" must be one of the handles above. "topic" is the headline it riffs on.

Task B, "events": write up to ${MAX_EVENTS} breaking events inspired by the Indian headlines, for the player (an Indian politician) to respond to. Format:
{ "era": "2-3 word tag", "title": "short headline, under 60 chars", "min": 0-6 (lowest office that sees it: 0 youth leader, 3 MLA, 5 minister, 6 PM), "text": "what happened, 1-2 sentences, invented names and places only", "ch": [2 or 3 choices: {"l": "choice label", "s": "short hint", "fx": {effects}, "r": "funny result, 1 sentence"}] }
Effect keys: pop loy media white black corr heat scandal karma stress rival cases aura hp cadre legacy oratory network army (small numbers, -12..12; white/black are money, -30..30). Optional "b" for vote banks {far you tra urb wom wor} and "rel" for people {chief fixer journo tycoon rival spouse}, -12..12.
Skip any headline that touches the forbidden topics. Fewer good items beat many weak ones.`;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    posts: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      who: { type: 'STRING' }, text: { type: 'STRING' }, topic: { type: 'STRING' } }, required: ['who', 'text'] } },
    events: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      era: { type: 'STRING' }, title: { type: 'STRING' }, min: { type: 'INTEGER' }, text: { type: 'STRING' },
      ch: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        l: { type: 'STRING' }, s: { type: 'STRING' }, r: { type: 'STRING' },
        fx: { type: 'OBJECT', properties: Object.fromEntries([...FX_KEYS].map(k => [k, { type: 'INTEGER' }]).concat([
          ['b', { type: 'OBJECT', properties: Object.fromEntries([...BANKS].map(k => [k, { type: 'INTEGER' }])) }],
          ['rel', { type: 'OBJECT', properties: Object.fromEntries([...RELS].map(k => [k, { type: 'INTEGER' }])) }],
        ])) },
      }, required: ['l', 'r', 'fx'] } },
    }, required: ['era', 'title', 'text', 'ch'] } },
  },
  required: ['posts', 'events'],
};

// Busy/rate-limited answers are common on the free tier: wait and retry, then fall back to the lighter model.
const FALLBACK_MODEL = 'gemini-flash-lite-latest';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function askGemini(prompt) {
  const plan = [[MODEL, 0], [MODEL, 30000], [FALLBACK_MODEL, 0], [FALLBACK_MODEL, 60000], [MODEL, 120000]];
  let last;
  for (const [model, wait] of plan) {
    if (wait) { console.log(`retrying ${model} in ${wait / 1000}s…`); await sleep(wait); }
    try { return await askGeminiOnce(prompt, model); } catch (e) {
      last = e;
      if (!e.retry) throw e;
      console.warn(e.message);
    }
  }
  throw last;
}

async function askGeminiOnce(prompt, model) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set (add it as a GitHub Actions secret)');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.9 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gemini ${model} HTTP ${res.status}: ${body.error?.message || 'no detail'}`);
    err.retry = res.status === 429 || res.status >= 500;
    throw err;
  }
  const text = body.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error(`Gemini returned nothing (finish: ${body.candidates?.[0]?.finishReason || body.promptFeedback?.blockReason || '?'})`);
  return JSON.parse(text);
}

// ---------- 3. validation + content filter ----------
function unsafe(text, guesses) {
  const t = text.toLowerCase();
  const hit = text.match(BANNED);
  if (hit) return `banned word "${hit[0]}"`;
  for (const n of BLOCK) if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) return `real name "${n}"`;
  for (const w of t.split(/[^a-z]+/)) if (BLOCK_WORDS.has(w)) return `real name word "${w}"`;
  for (const g of guesses) if (t.includes(g) && !PARODY_NAMES.some(p => p.includes(g))) return `possible real name "${g}"`;
  return null;
}

const clampInt = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
function cleanFx(fx) {
  const out = {};
  for (const [k, v] of Object.entries(fx || {})) {
    if (k === 'b' || k === 'rel') {
      const allowed = k === 'b' ? BANKS : RELS;
      const sub = {};
      for (const [kk, vv] of Object.entries(v || {})) { const n = clampInt(vv, -12, 12); if (allowed.has(kk) && n) sub[kk] = n; }
      if (Object.keys(sub).length) out[k] = sub;
    } else if (FX_KEYS.has(k)) {
      const n = MONEY.has(k) ? clampInt(v, -30, 30) : clampInt(v, -12, 12);
      if (n) out[k] = n;
    }
  }
  return out;
}

const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;

function checkPost(p, guesses) {
  if (!p || !HANDLES.has(p.who)) return `unknown handle ${p?.who}`;
  if (!str(p.text, 280)) return 'bad text';
  return unsafe(p.text, guesses);
}

function checkEvent(e, guesses) {
  if (!str(e?.era, 40) || !str(e.title, 90) || !str(e.text, 400)) return 'missing era/title/text';
  if (!Array.isArray(e.ch) || e.ch.length < 2 || e.ch.length > 3) return 'needs 2-3 choices';
  for (const c of e.ch) {
    if (!str(c.l, 80) || !str(c.r, 260) || (c.s != null && !str(c.s, 80))) return 'bad choice';
    if (!Object.keys(cleanFx(c.fx)).length) return 'choice with no effects';
  }
  return unsafe([e.era, e.title, e.text, ...e.ch.flatMap(c => [c.l, c.s || '', c.r])].join(' \n '), guesses);
}

// ---------- 4. merge ----------
const ageDays = id => {
  const m = /^auto_(\d{4})(\d{2})(\d{2})_/.exec(id);
  return m ? (Date.parse(today) - Date.parse(`${m[1]}-${m[2]}-${m[3]}`)) / 864e5 : 0;
};

async function main() {
  const feed = JSON.parse(fs.readFileSync(FEED, 'utf8'));
  const [us, india] = await Promise.all([headlines('us'), headlines('india')]);
  console.log(`headlines: ${us.length} US, ${india.length} India`);
  if (!us.length && !india.length) { console.log('No usable headlines; feed left as it is.'); return; }

  const reply = FIXTURE ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : await askGemini(userPrompt(us, india));
  const guesses = realNameGuesses([...us, ...india]);

  const known = new Set([...(feed.posts || []).map(p => p.text), ...(feed.events || []).map(e => e.title)]);
  const posts = [], events = [], dropped = [];
  for (const p of (reply.posts || []).slice(0, MAX_POSTS * 2)) {
    const why = checkPost(p, guesses) || (known.has(p.text) ? 'duplicate' : null);
    if (why) { dropped.push(`post ${p?.who}: ${why}`); continue; }
    posts.push({ id: `auto_${stamp}_p${posts.length}`, who: p.who, text: p.text.trim() });
    if (posts.length >= MAX_POSTS) break;
  }
  for (const e of (reply.events || []).slice(0, MAX_EVENTS * 2)) {
    const why = checkEvent(e, guesses) || (known.has(e.title) ? 'duplicate' : null);
    if (why) { dropped.push(`event "${e?.title}": ${why}`); continue; }
    events.push({
      id: `auto_${stamp}_e${events.length}`, era: e.era.trim(), title: e.title.trim(), min: clampInt(e.min ?? 0, 0, 6) ?? 0,
      text: e.text.trim(),
      ch: e.ch.map(c => ({ l: c.l.trim(), ...(c.s ? { s: c.s.trim() } : {}), fx: cleanFx(c.fx), r: c.r.trim() })),
    });
    if (events.length >= MAX_EVENTS) break;
  }

  // Replace today's auto items (so a re-run doesn't double up), expire old ones, keep hand-written ones as they are.
  const keep = list => (list || []).filter(x => !x.id.startsWith('auto_') || (!x.id.startsWith(`auto_${stamp}_`) && ageDays(x.id) < KEEP_DAYS));
  const capAuto = (list, max) => {
    const auto = list.filter(x => x.id.startsWith('auto_'));
    const drop = new Set(auto.slice(0, Math.max(0, auto.length - max)).map(x => x.id));
    return list.filter(x => !drop.has(x.id));
  };
  feed.events = capAuto([...keep(feed.events), ...events], MAX_AUTO_EVENTS);
  feed.posts = capAuto([...keep(feed.posts), ...posts], MAX_AUTO_POSTS);
  feed.updated = today;

  console.log(`kept ${posts.length} posts, ${events.length} events; dropped ${dropped.length}`);
  for (const d of dropped) console.log(`  dropped ${d}`);
  if (DRY) { console.log(JSON.stringify({ posts, events }, null, 1)); return; }
  if (!posts.length && !events.length) { console.log('Nothing passed the checks; feed left as it is.'); return; }
  fs.writeFileSync(FEED, JSON.stringify(feed, null, 1) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), FEED)}: ${feed.events.length} events, ${feed.posts.length} posts`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
