migrate((db) => {
  // Expand assassino lens metrics: add kills_per_min and goldPerMin
  // New total weight: 10
  // Rationale: Assassins thrive on early game kills and tempo. Adding per-min metrics captures
  // their ability to impact the game through sustained kill threat and gold generation.

  const assassinoRecord = db.findRecordsByFilter("rank_config", `name = "assassino"`)[0]
  if (!assassinoRecord) {
    console.warn("[1743000016] assassino record not found")
    return
  }

  assassinoRecord.config = {
    assumptions: {},
    metrics: [
      { key: "kda", source: "kda", weight_points: 3, cap: null },
      { key: "killSecured", source: "kill_secured", weight_points: 3, cap: null },
      { key: "killsMin", source: "kills_per_min", weight_points: 2, cap: null },
      { key: "goldPerMin", source: "gold_per_min", weight_points: 1, cap: null },
      { key: "damPerDeath", source: "damage_per_game/deaths", weight_points: 1, cap: null },
    ]
  }

  db.save(assassinoRecord)
}, (db) => {
  // Rollback: revert to 4-metric assassino
  const assassinoRecord = db.findRecordsByFilter("rank_config", `name = "assassino"`)[0]
  if (!assassinoRecord) return

  assassinoRecord.config = {
    assumptions: {},
    metrics: [
      { key: "kda", source: "kda", weight_points: 3, cap: null },
      { key: "killSecured", source: "kill_secured", weight_points: 3, cap: null },
      { key: "damPerDeath", source: "damage_per_game/deaths", weight_points: 1, cap: null },
      { key: "goldPerDeath", source: "gold_per_game/deaths", weight_points: 1, cap: null },
    ]
  }

  db.save(assassinoRecord)
})
