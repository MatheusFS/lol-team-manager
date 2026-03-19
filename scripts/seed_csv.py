#!/usr/bin/env python3
"""
Seed PocketBase with match history and champion pool data from CSVs.

Run fetch_champions.py first to generate scripts/champions.json, then:
    PB_EMAIL=admin@example.com PB_PASSWORD=secret python3 scripts/seed_csv.py

Env vars:
    PB_URL       PocketBase base URL (default: http://127.0.0.1:8090)
    PB_EMAIL     Superuser email
    PB_PASSWORD  Superuser password
"""

import csv
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = os.getenv("PB_URL", "http://127.0.0.1:8090").rstrip("/")
EMAIL    = os.getenv("PB_EMAIL", "")
PASSWORD = os.getenv("PB_PASSWORD", "")
ROOT     = Path(__file__).parent.parent
HISTORY  = ROOT / "Match Reviews - Clash History.csv"
POOL     = ROOT / "Match Reviews - Clash Pool.csv"
CHAMPS   = Path(__file__).parent / "champions.json"

PLAYERS = [
    {"name": "Klebão",   "role": "Top",     "is_sub": False},
    {"name": "GdN",      "role": "Jungle",  "is_sub": False},
    {"name": "Conkreto", "role": "Mid",     "is_sub": False},
    {"name": "Digo",     "role": "ADC",     "is_sub": False},
    {"name": "Kelly",    "role": "Support", "is_sub": False},
    {"name": "Pixek",    "role": "Top",     "is_sub": True},
    {"name": "Nunes",    "role": "Top",     "is_sub": True},
    {"name": "Eden",     "role": "Support", "is_sub": True},
    {"name": "Xuao",     "role": "ADC",     "is_sub": True},
]

# Abbreviations and nicknames used in the CSV → canonical Riot name
CHAMPION_ALIASES = {
    "J4":       "Jarvan IV",
    "LB":       "LeBlanc",
    "MF":       "Miss Fortune",
    "Cassio":   "Cassiopeia",
    "Voli":     "Volibear",
    "Xin":      "Xin Zhao",
    "Lee":      "Lee Sin",
    "Kai'sa":   "Kai'Sa",
    "Mundo":    "Dr. Mundo",
    "Rek":      "Rek'Sai",
    "K'sante":  "K'Sante",
    "GP":       "Gangplank",
    "TK":       "Tahm Kench",
    "Kha":      "Kha'Zix",
    "Cho":      "Cho'Gath",
    "Aurelion": "Aurelion Sol",
    "Renata":   "Renata Glasc",
    "Vladmir":  "Vladimir",
}

TIER_MARKERS = {"⭐": "star", "🟩": "green", "🟨": "yellow"}

SUBTYPE_MAP = {
    "Pick-Dive":               ["Pick", "Dive"],
    "Pick-Reset":              ["Pick", "Reset"],
    "Split-Dive":              ["Split", "Dive"],
    "Split-Pick-Engage-Siege": ["Split", "Pick", "Engage", "Siege"],
}

COMP_TYPE_MAP = {
    "🔼 Protect": "Protect",
    "🔪 Pick":    "Pick",
    "🔀 Split":   "Split",
    "🌀 Siege":   "Siege",
    "💥 Engage":  "Engage",
    "⚠ Mix":     "Mix",
}

SIDE_MAP = {
    "🟥 RED": "Red",
    "🟦 BLU": "Blue",
}

# ---------------------------------------------------------------------------
# HTTP helpers (stdlib urllib — no external dependencies)
# ---------------------------------------------------------------------------

_token = ""


def _request(method: str, url: str, body: dict = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if _token:
        headers["Authorization"] = f"Bearer {_token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"HTTP {e.code} {method} {url}: {body}") from None


def auth():
    global _token
    if not EMAIL or not PASSWORD:
        sys.exit("Set PB_EMAIL and PB_PASSWORD env vars before running.")
    result = _request("POST",
        f"{BASE_URL}/api/collections/_superusers/auth-with-password",
        {"identity": EMAIL, "password": PASSWORD},
    )
    _token = result["token"]
    print("✓ Authenticated")


def create(collection: str, data: dict) -> dict:
    return _request("POST", f"{BASE_URL}/api/collections/{collection}/records", data)


def fetch_all(collection: str) -> list:
    return _request("GET", f"{BASE_URL}/api/collections/{collection}/records?perPage=500")["items"]


def count(collection: str) -> int:
    return _request("GET", f"{BASE_URL}/api/collections/{collection}/records?perPage=1")["totalItems"]


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def parse_br_number(value: str):
    """Parse Brazilian-formatted number. Returns None if invalid/empty."""
    v = value.strip()
    if not v or v in ("#DIV/0!", "#N/A"):
        return None
    negative = v.startswith("(") and v.endswith(")")
    if negative:
        v = v[1:-1]
    # Period = thousands separator, comma = decimal separator
    v = v.replace(".", "").replace(",", ".")
    try:
        num = float(v)
        if negative:
            num = -num
        return int(num) if num == int(num) else num
    except ValueError:
        return None


def parse_date(value: str) -> str:
    """DD/MM/YYYY → YYYY-MM-DD"""
    d, m, y = value.strip().split("/")
    return f"{y}-{m}-{d}"


def parse_comp(value: str):
    """
    'Riven - Volibear - Lissandra - Sivir - Thresh | Vladimir - Xin Zhao - ...'
    → (["Riven", ...], ["Vladimir", ...])
    """
    v = value.strip()
    if not v:
        return None, None
    if "|" in v:
        ours, theirs = v.split("|", 1)
        return (
            [c.strip() for c in ours.split(" - ") if c.strip()],
            [c.strip() for c in theirs.split(" - ") if c.strip()],
        )
    return [c.strip() for c in v.split(" - ") if c.strip()], None


def parse_kda(value: str):
    """'34 - 21' → (34, 21). Returns (None, None) if empty."""
    v = value.strip()
    if not v:
        return None, None
    parts = v.split(" - ")
    if len(parts) == 2:
        try:
            return int(parts[0]), int(parts[1])
        except ValueError:
            pass
    return None, None


def parse_subtype(value: str):
    v = value.strip()
    if not v:
        return None
    return SUBTYPE_MAP.get(v, [v])


def resolve_champion(name: str, champ_map: dict) -> str | None:
    """Resolve a champion name (possibly abbreviated) to its PocketBase record ID."""
    if not name:
        return None
    name = name.strip()
    canonical = CHAMPION_ALIASES.get(name, name)
    return champ_map.get(canonical)


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

def seed_champions() -> dict:
    """Seed champions from scripts/champions.json. Returns name → id map."""
    if not CHAMPS.exists():
        sys.exit(
            f"Missing {CHAMPS}\n"
            "Run: python3 scripts/fetch_champions.py"
        )

    if count("champions") > 0:
        print("  champions: already seeded, fetching existing records")
        return {r["name"]: r["id"] for r in fetch_all("champions")}

    champions = json.loads(CHAMPS.read_text())
    name_to_id = {}
    for c in champions:
        record = create("champions", c)
        name_to_id[c["name"]] = record["id"]

    print(f"  champions: {len(name_to_id)} records created")
    return name_to_id


def seed_players() -> dict:
    """Seed players. Returns name → id map."""
    if count("players") > 0:
        print("  players: already seeded, fetching existing records")
        return {r["name"]: r["id"] for r in fetch_all("players")}

    name_to_id = {}
    for p in PLAYERS:
        record = create("players", p)
        name_to_id[p["name"]] = record["id"]
        print(f"  + player: {p['name']}")
    return name_to_id


def seed_matches(player_ids: dict, champ_ids: dict):
    if count("matches") > 0:
        print("  matches: already seeded, skipping")
        return

    with open(HISTORY, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    created = 0
    skipped = 0
    for row in rows:
        our_champs, enemy_champs = parse_comp(row["Comp"])
        kills, deaths = parse_kda(row["KDA"])

        data = {
            "date":         parse_date(row["Data"]),
            "game_n":       int(row["n"]),
            "win":          "VITÓRIA" in row["Resultado"],
            "side":         SIDE_MAP.get(row["Lado"].strip()),
            "top_player":   row["TOP"].strip() or None,
            "comp_type":    COMP_TYPE_MAP.get(row["Tipo"].strip()),
            "comp_subtype": parse_subtype(row["Subtipo"]),
            "scaling":      row["Scaling"].strip() or None,
            "enemy_type":   COMP_TYPE_MAP.get(row["Tipo Inimigo"].strip()),
            "enemy_scaling":row["En. Scaling"].strip() or None,
            "duration":     int(row["Duração"]) if row["Duração"].strip() else None,
            "mvp":          row["MVP"].strip() or None,
            "mvc":          resolve_champion(row["MVC"], champ_ids),
            "team_kills":   kills,
            "team_deaths":  deaths,
            "gd_10":        parse_br_number(row["GD@10"]),
            "gd_20":        parse_br_number(row["GD@20"]),
            "gd_f":         parse_br_number(row["GD@F"]),
            "total_gold":   parse_br_number(row["GT"]),
            "gold_per_min": parse_br_number(row["G/m"]),
            "damage":       parse_br_number(row["Dano"]),
            "da_di":        parse_br_number(row["DA/DI"]),
            "wards_per_min":parse_br_number(row["W/m"]),
            "obj_flow":     row["Fluxo de objetivos (t/v/g/d/b/i/n)"].strip() or None,
        }

        if our_champs:
            data["our_champs"] = our_champs
        if enemy_champs:
            data["enemy_champs"] = enemy_champs

        # Drop None values so PocketBase uses field defaults
        data = {k: v for k, v in data.items() if v is not None}

        try:
            create("matches", data)
            created += 1
        except RuntimeError as e:
            print(f"  ! row {row['Data']} game {row['n']}: {e}")
            skipped += 1

    print(f"  matches: {created} created, {skipped} skipped")


def seed_champion_pool(player_ids: dict, champ_ids: dict):
    if count("champion_pool") > 0:
        print("  champion_pool: already seeded, skipping")
        return

    with open(POOL, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))

    # Row 0: headers — "Klebão (T)", "GdN (J)", ..., "" (separator), ...
    players = []
    for h in rows[0]:
        h = h.strip()
        players.append(h.split(" (")[0].strip() if h else None)

    current_tier = ["star"] * len(players)

    created = 0
    skipped = 0
    for row in rows[1:]:
        is_tier_row = any(cell.strip() in TIER_MARKERS for cell in row)
        if is_tier_row:
            for i, cell in enumerate(row):
                if i < len(current_tier) and cell.strip() in TIER_MARKERS:
                    current_tier[i] = TIER_MARKERS[cell.strip()]
            continue

        for i, cell in enumerate(row):
            name = cell.strip()
            if not name or i >= len(players) or not players[i]:
                continue
            player_name = players[i]
            if player_name not in player_ids:
                continue

            canonical = CHAMPION_ALIASES.get(name, name)
            champ_id  = champ_ids.get(canonical)
            if not champ_id:
                print(f"  ! unknown champion in pool: '{name}' (player: {player_name})")
                skipped += 1
                continue

            create("champion_pool", {
                "player":   player_ids[player_name],
                "champion": champ_id,
                "tier":     current_tier[i],
            })
            created += 1

    print(f"  champion_pool: {created} created, {skipped} skipped")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Connecting to {BASE_URL} …\n")
    auth()

    print("\nSeeding champions …")
    champ_ids = seed_champions()

    print("\nSeeding players …")
    player_ids = seed_players()

    print("\nSeeding matches …")
    seed_matches(player_ids, champ_ids)

    print("\nSeeding champion pool …")
    seed_champion_pool(player_ids, champ_ids)

    print("\nDone.")


if __name__ == "__main__":
    main()
