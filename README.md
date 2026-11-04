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
