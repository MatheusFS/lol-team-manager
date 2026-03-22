# AGENTS.md — Coding Guidelines for lol-team-manager

## Project Overview

**Stack**: Pure HTML + vanilla ES2020+ JavaScript + Alpine.js v3 (CDN) + Tailwind CSS (CDN)  
**Backend**: PocketBase (binary at `./pocketbase serve`)  
**No build tooling**: No npm, TypeScript, bundler, or test runner. All JS loads via `<script>` tags as globals.

---

## Running the Project

1. **Start PocketBase backend**:
   ```bash
   ./pocketbase serve
   # Runs at http://127.0.0.1:8090
   ```

2. **Serve frontend** (in another terminal):
   ```bash
   python3 -m http.server 8000
   # or: php -S localhost:8000
   # or: npx http-server
   ```

3. Open `http://localhost:8000` in browser.

**No build step exists.** Changes to HTML/JS are live; refresh browser to see them.

---

## Build/Lint/Test Commands

**There are no build, lint, or test commands.** This is a no-build project.

- No bundler (Webpack, Vite, etc.)
- No TypeScript compilation
- No linter (ESLint, Prettier)
- No test runner (Jest, Vitest)

All validation is manual/browser-based. Use browser DevTools console to check for errors.

---

## Code Style Guidelines

### JavaScript Conventions

- **ES2020+ syntax** (arrow functions, `const`/`let`, template literals, optional chaining, nullish coalescing)
- **No modules** (`import`/`require` forbidden) — all code runs in global scope via `<script>` tags
- **Globals are intentional**: `PB`, `api`, `utils`, `COMP_TYPE_DEFS`, `COMP_EMOJI`, `SCALE_COLORS`, `extractMatchStats`, etc. defined in `shared.js`
- **File naming**: kebab-case (e.g., `match-form.js`, `riot-api.js`)
- **Function/variable naming**: camelCase (e.g., `extractMatchStats()`, `buildPlayerLookup()`)

### Alpine.js Component Pattern

All interactive pages use Alpine.js components:

```html
<div x-data="matchForm" x-init="init()">
  <input x-model="formData.date" />
  <button @click="submit()">Save</button>
</div>
```

```js
Alpine.data('matchForm', () => ({
  formData: {},
  init() { /* load initial data */ },
  submit() { /* validate and save */ },
}))
```

- Use `Alpine.store('name')` for shared reactive state (e.g., `Alpine.store('champions')`)
- Use `Alpine.data('name')` to define components
- Use `$dispatch('event-name', payload)` to send events between components
- Use `$nextTick()` when DOM mutations must complete before next operations

### PocketBase API Pattern

Access via `api` wrapper from `shared.js`:

```js
// List
const records = await api.col('matches').list({ sort: '-date', limit: 100 })

// Get
const match = await api.col('matches').get(id, { expand: 'formation,top_player,mvp' })

// Create
const newMatch = await api.col('matches').create({ date, win, side, ... })

// Update
await api.col('matches').update(id, { win: true, ... })

// Delete
await api.col('matches').delete(id)
```

**Always use `api.col(collectionName)` — never call PocketBase directly.**

### Imports & Script Load Order (CRITICAL)

Every HTML page must load scripts in this exact order:

1. `<script src="scripts/shared.js"></script>` — **first, no defer**
2. Optional: `<script src="scripts/riot-api.js"></script>` (if page needs Riot API)
3. Optional: `<script src="scripts/champion-suggest.js"></script>` (if page needs meta suggestions)
4. Page-specific script (e.g., `match-form.js`)
5. Optional: `<script src="scripts/match-assistant.js"></script>` (if page has match lookup drawer)
6. Alpine.js: `<script defer src="https://cdn.jsdelivr.net/npm/alpine@3/dist/cdn.min.js"></script>` — **must have `defer`**
7. `<script>` inline IIFE in first `<body>` child for `layout.js` functionality — **synchronous, no defer**

**Violating this order breaks globals and Alpine initialization.**

### Naming Conventions

- **Variables**: `camelCase` (e.g., `playerStats`, `matchId`, `winRate`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `COMP_TYPE_DEFS`, `SCALE_COLORS`, `COMP_EMOJI`)
- **Functions**: `camelCase` (e.g., `extractMatchStats()`, `normChampKey()`)
- **HTML files**: kebab-case in `pages/` (e.g., `match-detail.html`, `champion-pool.html`)
- **JS files**: kebab-case (e.g., `match-form.js`, `riot-api.js`)
- **CSS classes**: kebab-case (Tailwind standard, e.g., `flex`, `gap-4`, `text-sm`)
- **Alpine.js component names**: camelCase (e.g., `x-data="matchForm"`, `Alpine.data('draftPage')`)

### Type Safety & Champion Key Normalization

**Always normalize champion keys using `normChampKey(name)` from `shared.js`:**

```js
const key = normChampKey("Master Yi")  // → "MonkeyKing"
const key = normChampKey("Nunu & Willump")  // → "Nunu"
```

This handles aliases (Wukong→MonkeyKing, etc.) and ensures consistency with Riot DDragon data.

### Error Handling

**Pattern**: Try-catch with console logging + user-facing UI message

```js
try {
  const data = await api.col('matches').get(id)
  // success
} catch (err) {
  console.error('Failed to load match:', err)
  this.error = 'Could not load match. Please try again.'
  // display error in Alpine state or toast
}
```

- **Console errors** for debugging (shown in DevTools)
- **Alpine state** for user-facing error messages (e.g., `this.error`, `this.loading`)
- **Never silently fail** — always log + inform user

### localStorage Caching

Standard keys for caching:

```js
// Riot API caching (shared.js)
localStorage['puuid-<riotId>']              // 24h TTL
localStorage['match-ids-<puuid>-<region>']  // weekly TTL
localStorage['match-<matchId>']             // indefinite

// Champion meta caching (champion-suggest.js)
localStorage['lolalytics-meta-<patch>']     // 1-day TTL
localStorage['ddragon-champions-<version>'] // 7-day TTL

// Page-specific state (e.g., draft-page.js)
localStorage['draft-state']                 // draft board state
localStorage['match-assistant-prefill']     // match prefill data
```

Always check TTL before using cached data. Prefix keys to avoid conflicts.

---

## Adding a New Page

Checklist:

1. Create `pages/new-page.html` with Alpine component `x-data="newPage"`
2. Create `scripts/new-page.js` with `Alpine.data('newPage', () => ({ ... }))`
3. Add script load in HTML respecting the order above
4. Import Alpine component data if needed (e.g., `Alpine.store('champions')`)
5. Add navigation link in `layout.js` nav menu
6. Test in browser; check DevTools console for errors

---

## PocketBase Collections Schema (Reference)

- **players**: name, role (`select`: `top`/`jng`/`mid`/`adc`/`sup`), secondary_role, is_sub, riot_id, puuid
- **champions**: name, key, comp_type, early/mid/late (scale), class, roles (JSON array: `["top","jng","mid","adc","sup"]`), damage_type, tier, tier_by_role (JSON: `{"top":"A","jng":"B",...}`)
- **matches**: date, game_n, win, side, formation, our_champs, enemy_champs, comp_type, scaling, team_kills/deaths/assists, gold stats, Riot snapshot
- **champion_pool**: player → champions, tier (star/green/yellow)
- **formations**: name, top/jng/mid/adc/sup (all relation→players), active

All collections have open rules (no authentication).

---

## Key Utilities from shared.js

- `api` — PocketBase wrapper
- `Alpine.store('champions')` — lazy-loaded champion cache with `.load()`, `.list`, `.byId(id)`, `.search(query)`, `.imgUrl(key)`
- `extractMatchStats(match, timeline, ctx)` — computes team + per-player stats from Riot API
- `stripSnapshot(match)` — removes Riot snapshot for storage
- `detectFormation(stats)` — infers 5-man formation from player stats
- `extractLineup(stats)` — extracts 5-man lineup from player stats
- `buildPlayerLookup(names)` — creates puuid→player map
- `champImgUrl(key)` — returns DDragon image URL
- `normChampKey(name)` — canonicalizes champion names
- `COMP_TYPE_DEFS`, `COMP_EMOJI`, `SCALE_COLORS` — shared constants

---

## Debugging Tips

- **Open DevTools** (`F12`) and check Console for errors
- **Check network tab** for failed API calls to PocketBase or Riot API
- **Inspect Elements** to verify Alpine data binding is working (look for `x-data` attributes)
- **localStorage inspection** — open Console and type `localStorage` to see all cached data
- **Alpine DevTools extension** — helpful for inspecting component state in real-time
