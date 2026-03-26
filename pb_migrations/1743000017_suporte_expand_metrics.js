migrate((db) => {
  // Expand suporte lens metrics: add assistsMin, visionMin, and wardsAndWKPerDeath
  // New total weight: 14 (up from 9)
  // Rationale: Supports need to impact the map via objective control (vision, wards), sustain
  // presence (assists/min), and survive without feeding (assist/death ratio already in).

  const suporteRecord = db.findRecordsByFilter("rank_config", `name = "suporte"`)[0]
  if (!suporteRecord) {
    console.warn("[1743000017] suporte record not found")
    return
  }

  suporteRecord.config = {
    assumptions: {},
    metrics: [
      { key: "kda", source: "kda", weight_points: 1, cap: null },
      { key: "assistsPerDeath", source: "assists_per_game/deaths", weight_points: 2, cap: null },
      { key: "assistsMin", source: "assists_per_min", weight_points: 2, cap: null },
      { key: "visionPerDeath", source: "vision_score_per_game/deaths", weight_points: 2, cap: null },
      { key: "visionMin", source: "vision_score_per_min", weight_points: 2, cap: null },
      { key: "controlWardsAvg", source: "control_wards_per_game", weight_points: 2, cap: null },
      { key: "wardsAndWKPerDeath", source: "wards_and_wk/deaths", weight_points: 3, cap: null },
    ]
  }

  db.save(suporteRecord)
}, (db) => {
  // Rollback: revert to 4-metric suporte
  const suporteRecord = db.findRecordsByFilter("rank_config", `name = "suporte"`)[0]
  if (!suporteRecord) return

  suporteRecord.config = {
    assumptions: {},
    metrics: [
      { key: "kda", source: "kda", weight_points: 1, cap: null },
      { key: "assistsPerDeath", source: "assists_per_game/deaths", weight_points: 3, cap: null },
      { key: "visionPerDeath", source: "vision_score_per_game/deaths", weight_points: 3, cap: null },
      { key: "controlWardsAvg", source: "control_wards_per_game", weight_points: 2, cap: null },
    ]
  }

  db.save(suporteRecord)
})
