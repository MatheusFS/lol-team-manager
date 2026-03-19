# LoL Team Manager

Internal tool for tracking and analyzing our League of Legends Clash history — match reviews, draft strategy, and player champion pools.

## Stack

- **Backend**: [PocketBase](https://pocketbase.io/) — embedded SQLite, REST API, auth, and admin UI out of the box
- **Frontend**: Plain HTML + [Tailwind CSS](https://tailwindcss.com/) via CDN, consuming the PocketBase API via `fetch`
- No build step. No custom server. No framework.

## Features

- **Match history** — results, sides, compositions, gold differentials, game duration, objective flow
- **Performance dashboards** — per-player and team-wide stats across Clash days
- **Draft analysis** — composition types (Protect/Pick/Split/Siege/Engage), scaling matchups, enemy strategy breakdowns
- **Champion pools** — per-player champion lists organized by confidence tier

## Data Model

### `players`

| Field | Type | Notes |
|---|---|---|
| `name` | text | |
| `role` | select | Top / Jungle / Mid / ADC / Support |
| `is_sub` | bool | Main 5 vs substitutes |

### `matches`

Migrated from `Match Reviews - Clash History.csv`.

| Field | Type | Notes |
|---|---|---|
| `date` | date | |
| `game_n` | number | Game number within the Clash day |
| `win` | bool | |
| `side` | select | Red / Blue |
| `top_player` | relation → players | Top lane rotated between Klebão, Pixek, Nunes |
| `our_champs` | json | `["Riven", "Volibear", ...]` |
| `enemy_champs` | json | `["Vladimir", "Xin Zhao", ...]` |
| `comp_type` | select | Protect / Pick / Split / Siege / Engage / Mix |
| `comp_subtype` | select (multi) | Atoms: Siege, Protect, Engage, Split, Pick, Dive, Reset, Mix |
| `scaling` | text | 🔴🟡🟢 early/mid/late |
| `enemy_type` | select | same values as `comp_type` |
| `enemy_scaling` | text | |
| `duration` | number | Minutes |
| `mvp` | relation → players | |
| `mvc` | text | MVP champion (abbreviated as logged) |
| `team_kills` | number | |
| `team_deaths` | number | |
| `gd_10 / gd_20 / gd_f` | number | Gold diff at 10, 20 min, and end |
| `total_gold` | number | Total gold earned (GT column) |
| `gold_per_min` | number | |
| `damage` | number | |
| `da_di` | number | Damage dealt / damage taken ratio |
| `wards_per_min` | number | |
| `obj_flow` | text | tower/voidgrub/riftherald/dragon/baron/inhibitor/nexus |

### `champion_pool`

Migrated from `Match Reviews - Clash Pool.csv`.

| Field | Type | Notes |
|---|---|---|
| `player` | relation → players | |
| `champion` | text | |
| `tier` | select | `star` ⭐ / `green` 🟩 / `yellow` 🟨 |

Tiers: **star** = main picks, **green** = strong/comfortable, **yellow** = situational.

### Players

| Player | Role | Type |
|---|---|---|
| Klebão | Top | Main |
| GdN | Jungle | Main |
| Conkreto | Mid | Main |
| Digo | ADC | Main |
| Kelly | Support | Main |
| Pixek | Top | Sub |
| Nunes | Top | Sub |
| Eden | Support | Sub |
| Xuao | ADC | Sub |

## Getting Started

1. Download the PocketBase binary for your platform from [pocketbase.io](https://pocketbase.io/docs/) and place it in the project root.

2. Start PocketBase (migrations in `pb_migrations/` run automatically):
   ```sh
   ./pocketbase serve
   ```

3. Open the admin UI at `http://127.0.0.1:8090/_/` and create a superuser account.

4. Seed the database from the CSVs:
   ```sh
   pip install -r scripts/requirements.txt
   PB_EMAIL=you@example.com PB_PASSWORD=secret python3 scripts/seed_csv.py
   ```

5. Open `index.html` in a browser (or serve it statically).

## Project Structure

```
lol-team-manager/
├── pocketbase                        # PocketBase binary (not committed)
├── pb_data/                          # PocketBase database and config (not committed)
├── pb_migrations/                    # Auto-run schema migrations
│   ├── 1742000000_create_players.js
│   ├── 1742000001_create_matches.js
│   └── 1742000002_create_champion_pool.js
├── scripts/
│   ├── seed_csv.py                   # One-time data migration from CSVs
│   └── requirements.txt
├── Match Reviews - Clash History.csv # Source data
├── Match Reviews - Clash Pool.csv    # Source data
└── index.html                        # App entry point (to be created)
```
