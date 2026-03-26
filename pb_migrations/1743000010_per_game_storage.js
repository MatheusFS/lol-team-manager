/// <reference path="../pb_data/types.d.ts" />

// Convert global benchmark storage from per_min to per_game for 6 fields.
//
// MOTIVATION:
//   per_game values are the true empirical base data. per_min are derived
//   (per_game / game_time_min) and should be computed in runtime JS, not stored.
//
// CHANGES (global record benchmarks):
//   Rename + convert (multiply by game_time_min[ri]):
//   - gold_per_min             → gold_per_game
//   - cs_per_min               → cs_per_game
//   - vision_score_per_min     → vision_score_per_game
//   - damage_taken_per_min     → damage_taken_per_game
//   - damage_mitigated_per_min → damage_mitigated_per_game
//   - cc_per_min               → cc_per_game
//
// The per_min values are now computed at runtime in JS as per_game / game_time_min.

// Helper: safely read a JSON field from a record
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

// Computed: per_min[ri] × game_time_min[ri]
// game_time_min: [30.62, 31.07, 31.20, 30.97, 30.55, 29.97, 29.07, 27.87, 27.38, 27.07]
const GOLD_PER_GAME             = [11222.2, 12241.6, 12645.4, 12691.5, 12620.2, 12470.5, 12142.5, 11811.3, 11822.7, 11970.4]
const CS_PER_GAME               = [147.6,   155.0,   164.4,   170.3,   173.5,   175.0,   173.5,   170.8,   169.5,   169.7  ]
const VISION_SCORE_PER_GAME     = [26.9,    29.5,    32.1,    33.8,    34.2,    34.5,    34.3,    33.7,    34.2,    34.9   ]
const DAMAGE_TAKEN_PER_GAME     = [25108.4, 26720.2, 28080.0, 27253.6, 25662.0, 23976.0, 21802.5, 19509.0, 18070.8, 16783.4]
const DAMAGE_MITIGATED_PER_GAME = [5511.6,  6214.0,  7176.0,  8052.2,  8859.5,  9590.4,  10465.2, 11148.0, 12047.2, 12993.6]
const CC_PER_GAME               = [27.6,    31.1,    37.4,    43.4,    48.9,    53.9,    61.0,    66.9,    73.9,    81.2   ]

migrate((app) => {
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (!globalRec) return

  const cfg = getConfig(globalRec)
  const b = cfg.benchmarks ?? {}

  // Remove per_min fields
  delete b.gold_per_min
  delete b.cs_per_min
  delete b.vision_score_per_min
  delete b.damage_taken_per_min
  delete b.damage_mitigated_per_min
  delete b.cc_per_min

  // Add per_game fields
  b.gold_per_game             = GOLD_PER_GAME
  b.cs_per_game               = CS_PER_GAME
  b.vision_score_per_game     = VISION_SCORE_PER_GAME
  b.damage_taken_per_game     = DAMAGE_TAKEN_PER_GAME
  b.damage_mitigated_per_game = DAMAGE_MITIGATED_PER_GAME
  b.cc_per_game               = CC_PER_GAME

  cfg.benchmarks = b
  globalRec.set('config', cfg)
  app.save(globalRec)

}, (app) => {
  // Rollback: convert per_game back to per_min (divide by game_time_min)
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (!globalRec) return

  try {
    const cfg = getConfig(globalRec)
    const b = cfg.benchmarks ?? {}
    const t = b.game_time_min ?? [30.62, 31.07, 31.20, 30.97, 30.55, 29.97, 29.07, 27.87, 27.38, 27.07]

    const toPerMin = (pg) => pg.map((v, i) => Math.round(v / t[i] * 10) / 10)

    delete b.gold_per_game
    delete b.cs_per_game
    delete b.vision_score_per_game
    delete b.damage_taken_per_game
    delete b.damage_mitigated_per_game
    delete b.cc_per_game

    b.gold_per_min             = toPerMin(GOLD_PER_GAME)
    b.cs_per_min               = toPerMin(CS_PER_GAME)
    b.vision_score_per_min     = toPerMin(VISION_SCORE_PER_GAME)
    b.damage_taken_per_min     = toPerMin(DAMAGE_TAKEN_PER_GAME)
    b.damage_mitigated_per_min = toPerMin(DAMAGE_MITIGATED_PER_GAME)
    b.cc_per_min               = toPerMin(CC_PER_GAME)

    cfg.benchmarks = b
    globalRec.set('config', cfg)
    app.save(globalRec)
  } catch (_) {}
})
