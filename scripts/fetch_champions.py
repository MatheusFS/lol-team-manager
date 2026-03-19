#!/usr/bin/env python3
"""
Fetch the full champion list from Riot Data Dragon and save to scripts/champions.json.

Run this once (or to update when new champions ship):
    python3 scripts/fetch_champions.py

No dependencies beyond the standard library.
"""

import json
import urllib.request
from pathlib import Path

VERSIONS_URL  = "https://ddragon.leagueoflegends.com/api/versions.json"
CHAMPIONS_URL = "https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/champion.json"
OUTPUT         = Path(__file__).parent / "champions.json"
VERSION_OUTPUT = Path(__file__).parent / "ddragon-version.txt"


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read().decode())


def main():
    print("Fetching latest patch version …")
    versions = fetch_json(VERSIONS_URL)
    latest = versions[0]
    print(f"Patch: {latest}")

    print("Fetching champion data …")
    data = fetch_json(CHAMPIONS_URL.format(version=latest))

    champions = sorted(
        [{"name": c["name"], "key": c["id"]} for c in data["data"].values()],
        key=lambda c: c["name"],
    )

    OUTPUT.write_text(json.dumps(champions, ensure_ascii=False, indent=2))
    VERSION_OUTPUT.write_text(latest)
    print(f"Saved {len(champions)} champions → {OUTPUT}")
    print(f"Saved version {latest} → {VERSION_OUTPUT}")


if __name__ == "__main__":
    main()
