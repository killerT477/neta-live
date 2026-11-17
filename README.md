# neta-live

Live content and public pages for **Neta**, a satirical career game about Indian politics for iPhone and Android.
Data and static pages only: no app code lives here.

## What's in this repo

| File | What it is | Served at |
|---|---|---|
| `events.json` | breaking stories (and optional extra bakbak posts) the app downloads at launch | https://killert477.github.io/neta-live/events.json |
| `privacy.html` | privacy policy (linked from the store listings) | https://killert477.github.io/neta-live/privacy.html |
| `terms.html` | terms of use | https://killert477.github.io/neta-live/terms.html |
| `satire.html` | satire and parody notice | https://killert477.github.io/neta-live/satire.html |
| `credits.html` | credits | https://killert477.github.io/neta-live/credits.html |
| `index.html` | landing page | https://killert477.github.io/neta-live/ |

GitHub Pages publishes `main` a minute or two after each commit. Players get new stories the next time they open the app.
The app ships with its own copy of every story, so it works offline and nothing breaks if this site is down.

## Publishing a breaking story

1. Write it in the app repo's `live/events.json` first and run `npm run check` there.
2. Copy the same entry into `events.json` here and commit. Keep the two files identical.

```json
{ "id": "live_unique_id", "era": "Short tag", "title": "Headline", "min": 0,
  "text": "What happened.",
  "ch": [
    { "l": "Choice", "s": "Hint", "fx": { "pop": 3, "b": { "you": 2 } }, "r": "What happened next." },
    { "l": "Another choice", "s": "Hint", "fx": { "media": -2 }, "r": "What happened next." }
  ] }
```

- `id` must be new and never reused; the app merges stories by `id`.
- `min`: the lowest office that sees it (0 youth leader … 6 Prime Minister).
- 2 or 3 choices, each with `l` (label) and `r` (result).
- `fx` keys: `pop loy media white black corr heat scandal karma stress rival cases aura hp cadre legacy oratory network army`;
  `b` vote banks: `far you tra urb wom wor`; `rel` people: `chief fixer journo tycoon rival spouse`. Keep values small (±2 to ±12).
- One broken entry can break the game for everyone: check the JSON is valid before committing.

### Extra bakbak posts (optional)

A top-level `posts` array adds posts to the in-game phone: `{ "id": "unique", "who": "@ExistingHandle", "text": "..." }`.
Posts from handles the app doesn't know are dropped. The app repo's `tools/ai_posts.mjs` can draft a batch with Claude;
read every post before publishing.

## Content rules

Every name is invented or a clear parody. No real people outside the game's parody accounts, and nothing about
tragedies, wars, terrorism, riots, religion or caste. Full rules: `docs/CONTENT.md` in the app repo.

## Removing a story

Delete or fix the entry and commit. Players stop seeing it on their next launch (a story they already played stays in
their save's history).

## Auto feed (the sidecar)

Once a day a GitHub Action (`.github/workflows/refresh.yml`) runs `sidecar/refresh.mjs`:

1. **Reads headlines** from free RSS: Google News (US politics, India nation) and The Hindu national. Headlines about
   deaths, violence, war, religion, caste, disasters and similar are thrown away before the AI sees them.
2. **One AI call** (Google Gemini, free tier) turns them into satire in the app's exact format:
   US news (midterms, Senate flips…) → **bakbak posts** from the game's parody accounts;
   India news → **breaking events** with 2–3 choices.
3. **Checks everything**: handle must exist in `sidecar/cast.json`; events need 2–3 choices with known `fx`/`b`/`rel`
   keys (numbers are clamped to ±12, money ±30); text is re-checked for banned topics, for real names in
   `sidecar/blocklist.json`, and for any person-like name copied from the headlines. Anything that fails is dropped.
4. **Publishes**: merges into `events.json`, commits, and Pages serves it. The app downloads it at launch, caches it,
   and falls back to the cached or bundled copy when offline.

Auto items have ids starting `auto_YYYYMMDD_` and are deleted after 14 days (max 24 events and 120 posts kept).
Hand-written stories and posts are never touched.

### Cost

| Piece | Cost |
|---|---|
| GitHub Actions (public repo, ~1 min/day) | $0 |
| Google Gemini API, free tier (1 call/day) | $0 |
| RSS feeds, GitHub Pages | $0 |
| **Expected total** | **$0/month** |

If the free tier ever goes away, a paid Gemini Flash call of this size costs well under $0.01, so about $0.10–0.30/month.
Note: on the free tier Google may use prompts to improve its models; the prompts contain only public headlines and the
parody cast.

### One-time setup

1. Get a free key at https://aistudio.google.com/apikey.
2. Repo **Settings → Secrets and variables → Actions → New repository secret**: name `GEMINI_API_KEY`, paste the key.
   Never commit the key to a file.
3. **Actions → Refresh live feed → Run workflow** to run it once now. Check the new commit's `events.json`.

Optional repository variable `GEMINI_MODEL` picks a different model (default `gemini-flash-latest`).

### Pause, stop, undo

- **Pause:** Settings → Secrets and variables → Actions → **Variables** → add `SIDECAR_PAUSED` = `1`. Delete it to resume.
- **Stop completely:** Actions → Refresh live feed → `…` → **Disable workflow**.
- **Bad item went out:** delete it from `events.json` and commit (or revert the bot's commit). Players lose it on their
  next launch, because a fresh download replaces the phone's cached copy.

### Run it on your computer

```bash
node sidecar/refresh.mjs --fixture sidecar/test-reply.json --dry   # no key needed: real headlines, saved AI reply, no writes
GEMINI_API_KEY=... node sidecar/refresh.mjs --dry                  # real AI call, prints result, no writes
```

When the app's parody accounts change, regenerate `sidecar/cast.json` and `sidecar/blocklist.json` from the app repo's
`data/social.json` (handle, name, kind, bio, sig; and the `parody_of` names for the blocklist).
