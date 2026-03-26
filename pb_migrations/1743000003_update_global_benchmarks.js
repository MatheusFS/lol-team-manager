/// <reference path="../pb_data/types.d.ts" />

// Updates the `rank_config` collection:
// - Adds 7 new global benchmark fields (empirical data-driven)
// - Removes ka_total from all lenses
// - Simplifies bruiser: removes netDamPerGame, uses damPerDeath + goldPerDeath
// - Converts tank/suporte metrics from 'direct' to derived sources
// - All deaths now derived from global.deaths_per_game (not assumptions.ka_total)
//
// New global fields:
//   deaths_per_game:       [9, 7, 5, 2.75]       (midpoints of B/A/G/P ranges)
//   kda (updated):         [1.85, 2.4, 3.0, 4.0] (empirical average)
//   game_time_min (updated): [30, 30, 28, 28]    (revised)
//   damage_taken_per_game: [21000, 25000, 29000, 34000] (empirical midpoints)
//   vision_score_per_game: [18, 22, 28, 38]      (support baseline)
//   wards_per_game:        [8, 10, 13, 18]       (support baseline)
//   cc_time_per_game:      [20, 34, 48, 64]      (tank CC seconds per game)

migrate((app) => {
  const col = app.findCollectionByNameOrId('rank_config')

  // ── Update 'global' record ─────────────────────────────────────────────────
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (globalRec) {
    globalRec.config = {
      benchmarks: {
        damage_per_game:       [12000, 16500, 21000, 25000],
        gold_per_game:         [9800,  12500, 13500, 14200],
        deaths_per_game:       [9,     7,     5,     2.75],
        kda:                   [1.85,  2.4,   3.0,   4.0],
        cs_per_min:            [5.0,   6.5,   7.2,   8.5],
        game_time_min:         [30,    30,    28,    28],
        damage_taken_per_game: [21000, 25000, 29000, 34000],
        vision_score_per_game: [18,    22,    28,    38],
        wards_per_game:        [8,     10,    13,    18],
        cc_time_per_game:      [20,    34,    48,    64],
      }
    }
    app.save(globalRec)
  }

  // ── Update 'carry' lens ────────────────────────────────────────────────────
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (carryRec) {
    carryRec.config = {
      assumptions: {
        kill_share: [0.30, 0.30, 0.30, 0.30],
      },
      metrics: [
        { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 5, cap: 20000 },
        { key: 'goldPerDeath',  source: 'gold_per_game/deaths',   weight_points: 3, cap: 8000  },
        { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 2, cap: 10    },
        { key: 'csMin',         source: 'cs_per_min',             weight_points: 1, cap: null  },
        { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
      ]
    }
    app.save(carryRec)
  }

  // ── Update 'assassino' lens ────────────────────────────────────────────────
  const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
  if (assassinoRec) {
    assassinoRec.config = {
      assumptions: {
        kill_share: [0.27, 0.27, 0.27, 0.27],
      },
      metrics: [
        { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 4, cap: 10    },
        { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 2, cap: 20000 },
        { key: 'goldMin',       source: 'gold_per_min',           weight_points: 1, cap: null  },
        { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
      ]
    }
    app.save(assassinoRec)
  }

  // ── Update 'bruiser' lens ──────────────────────────────────────────────────
  const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
  if (bruiserRec) {
    bruiserRec.config = {
      assumptions: {},
      metrics: [
        { key: 'damPerDeath',  source: 'damage_per_game/deaths', weight_points: 4, cap: 20000 },
        { key: 'goldPerDeath', source: 'gold_per_game/deaths',   weight_points: 2, cap: 8000  },
      ]
    }
    app.save(bruiserRec)
  }

  // ── Update 'tank' lens ─────────────────────────────────────────────────────
  const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
  if (tankRec) {
    tankRec.config = {
      assumptions: {
        dt_ratio:  [1.5,  1.45, 1.40, 1.35],
        mit_ratio: [0.45, 0.50, 0.55, 0.62],
      },
      metrics: [
        { key: 'mitMin', source: 'mit_per_min', weight_points: 4, cap: null },
        { key: 'dtMin',  source: 'dt_per_min',  weight_points: 2, cap: null },
        { key: 'ccMin',  source: 'cc_per_min',  weight_points: 1, cap: null },
      ]
    }
    app.save(tankRec)
  }

  // ── Update 'suporte' lens ──────────────────────────────────────────────────
  const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
  if (suporteRec) {
    suporteRec.config = {
      assumptions: {
        kill_share: [0.08, 0.08, 0.08, 0.08],
      },
      metrics: [
        { key: 'assistsPerDeath',    source: 'assists/deaths', weight_points: 2, cap: 10 },
        { key: 'visionPerDeath',     source: 'vision/deaths',  weight_points: 2, cap: 50 },
        { key: 'wardsAndWKPerDeath', source: 'wards/deaths',   weight_points: 1, cap: 50 },
      ]
    }
    app.save(suporteRec)
  }

}, (app) => {
  // ── Rollback ───────────────────────────────────────────────────────────────
  // Restore previous version by re-running 1743000002_create_rank_config.js
  try {
    const col = app.findCollectionByNameOrId('rank_config')
    const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
    const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
    const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
    const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
    const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
    const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]

    if (globalRec) {
      globalRec.config = {
        benchmarks: {
          damage_per_game: [12000, 16500, 21000, 25000],
          gold_per_game:   [9800,  12500, 13500, 14200],
          kda:             [1.8,   2.5,   3.2,   4.1  ],
          cs_per_min:      [5.0,   6.5,   7.2,   8.5  ],
          game_time_min:   [28,    28,    28,    28   ],
        }
      }
      app.save(globalRec)
    }

    if (carryRec) {
      carryRec.config = {
        assumptions: {
          ka_total:   [14, 13, 13, 13],
          kills:      [5,  8,  9,  10],
          kill_share: [0.25, 0.28, 0.32, 0.38],
        },
        metrics: [
          { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 5, cap: 20000 },
          { key: 'goldPerDeath',  source: 'gold_per_game/deaths',   weight_points: 3, cap: 8000  },
          { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 2, cap: 10    },
          { key: 'csMin',         source: 'cs_per_min',             weight_points: 1, cap: null  },
          { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
        ]
      }
      app.save(carryRec)
    }

    if (assassinoRec) {
      assassinoRec.config = {
        assumptions: {
          ka_total:   [12, 12, 12, 12],
          kills:      [6,  8,  10, 12],
          kill_share: [0.27, 0.30, 0.35, 0.42],
        },
        metrics: [
          { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 4, cap: 10    },
          { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 2, cap: 20000 },
          { key: 'goldMin',       source: 'gold_per_min',           weight_points: 1, cap: null  },
          { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
        ]
      }
      app.save(assassinoRec)
    }

    if (bruiserRec) {
      bruiserRec.config = {
        assumptions: {
          ka_total: [14, 14, 14, 14],
        },
        metrics: [
          { key: 'netDamPerGame', source: 'direct', benchmarks: [8000, 14000, 20000, 26000],
            weight_points: 4, cap: null },
          { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 2, cap: 20000 },
          { key: 'goldPerDeath',  source: 'gold_per_game/deaths',   weight_points: 1, cap: 8000  },
        ]
      }
      app.save(bruiserRec)
    }

    if (tankRec) {
      tankRec.config = {
        assumptions: {
          ka_total: [16, 15, 14, 14],
        },
        metrics: [
          { key: 'mitMin', source: 'direct', benchmarks: [600, 1000, 1400, 1900],
            weight_points: 4, cap: null },
          { key: 'dtMin',  source: 'direct', benchmarks: [700, 1000, 1300, 1600],
            weight_points: 2, cap: null },
          { key: 'ccMin',  source: 'direct', benchmarks: [0.7, 1.2, 1.7, 2.3],
            weight_points: 1, cap: null },
        ]
      }
      app.save(tankRec)
    }

    if (suporteRec) {
      suporteRec.config = {
        assumptions: {
          ka_total:     [16,   16,   15,   14  ],
          assists:      [10,   12,   13,   14  ],
          vision_score: [15,   22,   30,   40  ],
          wards_and_wk: [6,    10,   14,   20  ],
        },
        metrics: [
          { key: 'assistsPerDeath',    source: 'direct',
            benchmarks: [1.125, 1.875, 2.772, 4.105],
            weight_points: 2, cap: 10 },
          { key: 'visionPerDeath',     source: 'direct',
            benchmarks: [1.688, 3.438, 6.399, 11.737],
            weight_points: 2, cap: 50 },
          { key: 'wardsAndWKPerDeath', source: 'direct',
            benchmarks: [0.675, 1.563, 2.985, 5.865],
            weight_points: 1, cap: 50 },
        ]
      }
      app.save(suporteRec)
    }
  } catch (_) {}
})
