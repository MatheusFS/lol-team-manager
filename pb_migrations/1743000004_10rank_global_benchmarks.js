/// <reference path="../pb_data/types.d.ts" />

// Upgrades rank_config from 4-tier grouped system to 10-rank empirical system.
//
// BEFORE: Global benchmarks stored as 4-element arrays [B=Iron-Bronze, A=Silver-Plat, G=Emerald-Diamond, P=Master-Challenger]
//         deriveScoreConfig computed 4 tier scores then interpolated 10 rank thresholds via hardcoded formulas.
//
// AFTER:  Global benchmarks stored as 10-element arrays [Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, GM, Challenger]
//         deriveScoreConfig computes 10 rank scores directly — no interpolation step.
//         Assumptions are scalar values, not arrays.
//         Anchor for coefficient derivation: Platinum (index 4).
//
// New global fields (10-element empirical arrays):
//   kills_per_game           [6.7, 6.9, 6.9, 6.8, 6.6, 6.5, 6.2, 5.8, 5.7, 5.6]
//   deaths_per_game          [6.7, 6.9, 6.9, 6.8, 6.6, 6.5, 6.2, 5.9, 5.7, 5.6]
//   kda                      [3.23, 3.20, 3.22, 3.26, 3.32, 3.39, 3.51, 3.60, 3.66, 3.73]
//   cs_per_min               [4.82, 4.99, 5.27, 5.50, 5.68, 5.84, 5.97, 6.13, 6.19, 6.27]
//   vision_score_per_min     [0.88, 0.95, 1.03, 1.09, 1.12, 1.15, 1.18, 1.21, 1.25, 1.29]
//   game_time_min            [30.62, 31.07, 31.20, 30.97, 30.55, 29.97, 29.07, 27.87, 27.38, 27.07]
//   gold_per_min             [366.5, 394.0, 405.3, 409.8, 413.1, 416.1, 417.7, 423.8, 431.8, 442.2]
//   damage_per_game          [9000, 12000, 14250, 16500, 18300, 21000, 22600, 25000, 26333, 27667]  (interpolated)
//   damage_taken_per_min     [820, 860, 900, 880, 840, 800, 750, 700, 660, 620]
//   damage_mitigated_per_min [180, 200, 230, 260, 290, 320, 360, 400, 440, 480]
//   cc_per_min               [0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.1, 2.4, 2.7, 3.0]
//   control_wards_placed     [0.61, 0.77, 1.05, 1.31, 1.50, 1.66, 1.90, 1.99, 2.19, 2.41]
//
// Removed old fields: gold_per_game, damage_taken_per_game, vision_score_per_game, wards_per_game, cc_time_per_game
//
// Lens changes:
//   carry:     goldPerDeath source changed from gold_per_game/deaths → gold_per_min/deaths; cap removed (null)
//   assassino: goldMin source changed from gold_per_min (computed) → direct gold_per_min field
//   bruiser:   goldPerDeath cap removed (null)
//   tank:      assumptions removed entirely; direct global reads for mit/dt/cc per min
//   suporte:   wardsAndWKPerDeath removed; replaced with controlWardsPerDeath (source: control_wards/deaths)
//   all:       assumptions changed from arrays to scalar numbers

migrate((app) => {
  // ── Update 'global' record ─────────────────────────────────────────────────
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (globalRec) {
    globalRec.set('config', {
      benchmarks: {
        // Rank order: [Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Challenger]
        kills_per_game:           [6.7,   6.9,   6.9,   6.8,   6.6,   6.5,   6.2,   5.8,   5.7,   5.6  ],
        deaths_per_game:          [6.7,   6.9,   6.9,   6.8,   6.6,   6.5,   6.2,   5.9,   5.7,   5.6  ],
        kda:                      [3.23,  3.20,  3.22,  3.26,  3.32,  3.39,  3.51,  3.60,  3.66,  3.73 ],
        cs_per_min:               [4.82,  4.99,  5.27,  5.50,  5.68,  5.84,  5.97,  6.13,  6.19,  6.27 ],
        vision_score_per_min:     [0.88,  0.95,  1.03,  1.09,  1.12,  1.15,  1.18,  1.21,  1.25,  1.29 ],
        game_time_min:            [30.62, 31.07, 31.20, 30.97, 30.55, 29.97, 29.07, 27.87, 27.38, 27.07],
        gold_per_min:             [366.5, 394.0, 405.3, 409.8, 413.1, 416.1, 417.7, 423.8, 431.8, 442.2],
        // damage_per_game: anchored at Bronze=12K, Gold=16.5K, Emerald=21K, Master=25K; linearly interpolated between
        damage_per_game:          [9000,  12000, 14250, 16500, 18300, 21000, 22600, 25000, 26333, 27667],
        damage_taken_per_min:     [820,   860,   900,   880,   840,   800,   750,   700,   660,   620  ],
        damage_mitigated_per_min: [180,   200,   230,   260,   290,   320,   360,   400,   440,   480  ],
        cc_per_min:               [0.9,   1.0,   1.2,   1.4,   1.6,   1.8,   2.1,   2.4,   2.7,   3.0  ],
        control_wards_placed:     [0.61,  0.77,  1.05,  1.31,  1.50,  1.66,  1.90,  1.99,  2.19,  2.41 ],
      }
    })
    app.save(globalRec)
  }

  // ── Update 'carry' lens ────────────────────────────────────────────────────
  // kill_share is now a scalar (not array); goldPerDeath source updated to gold_per_min/deaths
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (carryRec) {
    carryRec.set('config', {
      assumptions: {
        kill_share: 0.30,
      },
      metrics: [
        { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 5, cap: 20000 },
        { key: 'goldPerDeath',  source: 'gold_per_min/deaths',    weight_points: 3, cap: null  },
        { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 2, cap: 10    },
        { key: 'csMin',         source: 'cs_per_min',             weight_points: 1, cap: null  },
        { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
      ]
    })
    app.save(carryRec)
  }

  // ── Update 'assassino' lens ────────────────────────────────────────────────
  // kill_share is now a scalar; goldMin reads directly from gold_per_min global field
  const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
  if (assassinoRec) {
    assassinoRec.set('config', {
      assumptions: {
        kill_share: 0.27,
      },
      metrics: [
        { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 4, cap: 10    },
        { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 2, cap: 20000 },
        { key: 'goldMin',       source: 'gold_per_min',           weight_points: 1, cap: null  },
        { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
      ]
    })
    app.save(assassinoRec)
  }

  // ── Update 'bruiser' lens ──────────────────────────────────────────────────
  // No assumptions; goldPerDeath cap removed (null, previously 8000)
  const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
  if (bruiserRec) {
    bruiserRec.set('config', {
      assumptions: {},
      metrics: [
        { key: 'damPerDeath',  source: 'damage_per_game/deaths', weight_points: 4, cap: 20000 },
        { key: 'goldPerDeath', source: 'gold_per_min/deaths',    weight_points: 2, cap: null  },
      ]
    })
    app.save(bruiserRec)
  }

  // ── Update 'tank' lens ─────────────────────────────────────────────────────
  // No assumptions; metrics read directly from global damage_mitigated_per_min, damage_taken_per_min, cc_per_min
  const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
  if (tankRec) {
    tankRec.set('config', {
      assumptions: {},
      metrics: [
        { key: 'mitMin', source: 'damage_mitigated_per_min', weight_points: 4, cap: null },
        { key: 'dtMin',  source: 'damage_taken_per_min',     weight_points: 2, cap: null },
        { key: 'ccMin',  source: 'cc_per_min',               weight_points: 1, cap: null },
      ]
    })
    app.save(tankRec)
  }

  // ── Update 'suporte' lens ──────────────────────────────────────────────────
  // kill_share is now a scalar; wardsAndWKPerDeath replaced by controlWardsPerDeath
  const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
  if (suporteRec) {
    suporteRec.set('config', {
      assumptions: {
        kill_share: 0.08,
      },
      metrics: [
        { key: 'assistsPerDeath',      source: 'assists/deaths',              weight_points: 2, cap: 10 },
        { key: 'visionPerDeath',       source: 'vision_score_per_min/deaths', weight_points: 2, cap: 50 },
        { key: 'controlWardsPerDeath', source: 'control_wards/deaths',        weight_points: 1, cap: 50 },
      ]
    })
    app.save(suporteRec)
  }

}, (app) => {
  // ── Rollback: restore migration 003 state ─────────────────────────────────
  try {
    const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
    if (globalRec) {
      globalRec.set('config', {
        benchmarks: {
          damage_per_game:       [12000, 16500, 21000, 25000],
          gold_per_game:         [9800,  12500, 13500, 14200],
          deaths_per_game:       [9,     7,     5,     2.75 ],
          kda:                   [1.85,  2.4,   3.0,   4.0  ],
          cs_per_min:            [5.0,   6.5,   7.2,   8.5  ],
          game_time_min:         [30,    30,    28,    28   ],
          damage_taken_per_game: [21000, 25000, 29000, 34000],
          vision_score_per_game: [18,    22,    28,    38   ],
          wards_per_game:        [8,     10,    13,    18   ],
          cc_time_per_game:      [20,    34,    48,    64   ],
        }
      })
      app.save(globalRec)
    }

    const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
    if (carryRec) {
      carryRec.set('config', {
        assumptions: { kill_share: [0.30, 0.30, 0.30, 0.30] },
        metrics: [
          { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 5, cap: 20000 },
          { key: 'goldPerDeath',  source: 'gold_per_game/deaths',   weight_points: 3, cap: 8000  },
          { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 2, cap: 10    },
          { key: 'csMin',         source: 'cs_per_min',             weight_points: 1, cap: null  },
          { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
        ]
      })
      app.save(carryRec)
    }

    const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
    if (assassinoRec) {
      assassinoRec.set('config', {
        assumptions: { kill_share: [0.27, 0.27, 0.27, 0.27] },
        metrics: [
          { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 4, cap: 10    },
          { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 2, cap: 20000 },
          { key: 'goldMin',       source: 'gold_per_min',           weight_points: 1, cap: null  },
          { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
        ]
      })
      app.save(assassinoRec)
    }

    const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
    if (bruiserRec) {
      bruiserRec.set('config', {
        assumptions: {},
        metrics: [
          { key: 'damPerDeath',  source: 'damage_per_game/deaths', weight_points: 4, cap: 20000 },
          { key: 'goldPerDeath', source: 'gold_per_game/deaths',   weight_points: 2, cap: 8000  },
        ]
      })
      app.save(bruiserRec)
    }

    const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
    if (tankRec) {
      tankRec.set('config', {
        assumptions: {
          dt_ratio:  [1.5,  1.45, 1.40, 1.35],
          mit_ratio: [0.45, 0.50, 0.55, 0.62],
        },
        metrics: [
          { key: 'mitMin', source: 'mit_per_min', weight_points: 4, cap: null },
          { key: 'dtMin',  source: 'dt_per_min',  weight_points: 2, cap: null },
          { key: 'ccMin',  source: 'cc_per_min',  weight_points: 1, cap: null },
        ]
      })
      app.save(tankRec)
    }

    const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
    if (suporteRec) {
      suporteRec.set('config', {
        assumptions: { kill_share: [0.08, 0.08, 0.08, 0.08] },
        metrics: [
          { key: 'assistsPerDeath',    source: 'assists/deaths', weight_points: 2, cap: 10 },
          { key: 'visionPerDeath',     source: 'vision/deaths',  weight_points: 2, cap: 50 },
          { key: 'wardsAndWKPerDeath', source: 'wards/deaths',   weight_points: 1, cap: 50 },
        ]
      })
      app.save(suporteRec)
    }
  } catch (_) {}
})
