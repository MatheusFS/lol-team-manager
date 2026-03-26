migrate((db) => {
  // Remove kill_secured from assassino lens; replace with damage_per_min
  // New metrics focus on efficiency: kda, damage efficiency (per_min + per_death),
  // and gold efficiency (per_min + per_death). All 5 metrics increase with rank.
  // New total weight: 12 (up from 10)

  const assassinoRecord = db.findRecordsByFilter("rank_config", `name = "assassino"`)[0]
  if (!assassinoRecord) {
    console.warn("[1743000018] assassino record not found")
    return
  }

  assassinoRecord.config = {
    assumptions: {},
    metrics: [
      { key: "kda", source: "kda", weight_points: 3, cap: null },
      { key: "damPerMin", source: "damage_per_min", weight_points: 3, cap: null },
      { key: "damPerDeath", source: "damage_per_game/deaths", weight_points: 2, cap: null },
      { key: "goldPerMin", source: "gold_per_min", weight_points: 2, cap: null },
      { key: "goldPerDeath", source: "gold_per_game/deaths", weight_points: 2, cap: null },
    ]
  }

  db.save(assassinoRecord)
}, (db) => {
  // Rollback: revert to previous assassino (with kill_secured and kills_per_min)
  const assassinoRecord = db.findRecordsByFilter("rank_config", `name = "assassino"`)[0]
  if (!assassinoRecord) return

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
})
