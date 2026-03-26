/// <reference path="../pb_data/types.d.ts" />

// Creates the `rank_config` collection and seeds 6 records:
//   - 'global'    : real-world benchmark stats at 4 tiers (B/A/G/P)
//   - 'carry'     : lens formula config (metrics, weight_points, caps, derivation source)
//   - 'assassino' : lens formula config
//   - 'bruiser'   : lens formula config
//   - 'tank'      : lens formula config
//   - 'suporte'   : lens formula config
//
// Tier order in all arrays: [B, A, G, P]
//   B = Iron-Bronze average
//   A = Silver-Platinum average
//   G = Emerald-Diamond average
//   P = Master-Challenger average
//
// The 10 rank thresholds are NOT stored — they are derived at runtime from the 4 tier scores
// via fixed interpolation: Iron=0, Bronze=B/2, Silver=B, Gold=lerp(B,A,0.5), Platinum=A,
// Emerald=lerp(A,G,0.5), Diamond=G, Master=lerp(G,P,0.5), Grandmaster=P, Challenger=P×1.5
//
// Metric source types:
//   'damage_per_game/deaths' — global.damage_per_game[t] / deaths[t]
//   'gold_per_game/deaths'   — global.gold_per_game[t] / deaths[t]
//   'kills/deaths'           — assumptions.kills[t] / deaths[t]
//   'cs_per_min'             — global.cs_per_min[t] directly
//   'kill_share'             — assumptions.kill_share[t] directly
//   'gold_per_min'           — global.gold_per_game[t] / global.game_time_min[t]
//   'direct'                 — metric.benchmarks[t] (stored per-metric, for identity-specific stats)
//
// deaths[t] = assumptions.ka_total[t] / global.kda[t]
// coefficient = weight_points / A_tier_metric_value   (derived at runtime, not stored)

migrate((app) => {
  // ── Create collection ──────────────────────────────────────────────────────
  const collection = new Collection({
    name: 'rank_config',
    type: 'base',
    fields: [
      { type: 'text', name: 'name', required: true },
      { type: 'json', name: 'config', required: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_rank_config_name ON rank_config (name)'],
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: '',
  })
  app.save(collection)

  // ── Seed records ───────────────────────────────────────────────────────────
  const col = app.findCollectionByNameOrId('rank_config')

  function seed(name, config) {
    const rec = new Record(col)
    rec.set('name', name)
    rec.set('config', config)
    app.save(rec)
  }

  // ── GLOBAL BENCHMARKS ──────────────────────────────────────────────────────
  // Source: leagueoflegendstools.com + community tier data (2024–2025 average patch)
  // These represent the average performance of a typical player at each tier group.
  seed('global', {
    benchmarks: {
      damage_per_game: [12000, 16500, 21000, 25000],
      gold_per_game:   [9800,  12500, 13500, 14200],
      kda:             [1.8,   2.5,   3.2,   4.1  ],
      cs_per_min:      [5.0,   6.5,   7.2,   8.5  ],
      game_time_min:   [28,    28,    28,    28   ],
    }
  })

  // ── CARRY ──────────────────────────────────────────────────────────────────
  // Applies to: Marksman, high-damage Mage, high-damage Fighter
  // Identity assumptions: carries get many kills, moderate assists
  seed('carry', {
    assumptions: {
      ka_total:   [14, 13, 13, 13],    // kills + assists per game at each tier
      kills:      [5,  8,  9,  10],    // kills per game at each tier
      kill_share: [0.25, 0.28, 0.32, 0.38], // kills / (kills+assists) ratio
    },
    metrics: [
      { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 5, cap: 20000 },
      { key: 'goldPerDeath',  source: 'gold_per_game/deaths',   weight_points: 3, cap: 8000  },
      { key: 'killsPerDeath', source: 'kills/deaths',           weight_points: 2, cap: 10    },
      { key: 'csMin',         source: 'cs_per_min',             weight_points: 1, cap: null  },
      { key: 'killShare',     source: 'kill_share',             weight_points: 1, cap: null  },
    ]
  })

  // ── ASSASSINO ──────────────────────────────────────────────────────────────
  // Applies to: Assassin class
  // Identity assumptions: assassins prioritise kills over assists, burst-focused
  seed('assassino', {
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
  })

  // ── BRUISER ────────────────────────────────────────────────────────────────
  // Applies to: Fighter class WITHOUT high damage type
  // Identity assumptions: moderate KA, good survivability, net positive damage dealer
  seed('bruiser', {
    assumptions: {
      ka_total: [14, 14, 14, 14],
    },
    metrics: [
      // netDamPerGame = damage_dealt - net_damage_taken (identity-specific, stored direct)
      { key: 'netDamPerGame', source: 'direct', benchmarks: [8000, 14000, 20000, 26000],
        weight_points: 4, cap: null },
      { key: 'damPerDeath',   source: 'damage_per_game/deaths', weight_points: 2, cap: 20000 },
      { key: 'goldPerDeath',  source: 'gold_per_game/deaths',   weight_points: 1, cap: 8000  },
    ]
  })

  // ── TANK ───────────────────────────────────────────────────────────────────
  // Applies to: Tank class
  // All metrics are identity-specific — global damage benchmarks reflect damage dealers,
  // not tanks. Tank performance is measured by mitigation, damage absorbed, and CC output.
  seed('tank', {
    assumptions: {
      ka_total: [16, 15, 14, 14],
    },
    metrics: [
      // mitMin: damage self-mitigated per minute (shields + resistances)
      // Better itemization and positioning at higher tiers
      { key: 'mitMin', source: 'direct', benchmarks: [600, 1000, 1400, 1900],
        weight_points: 4, cap: null },
      // dtMin: damage taken per minute — tanks absorb more intentionally at higher elos
      { key: 'dtMin',  source: 'direct', benchmarks: [700, 1000, 1300, 1600],
        weight_points: 2, cap: null },
      // ccMin: CC score per minute (Riot's timeCCingOthers) — measures CC impact
      { key: 'ccMin',  source: 'direct', benchmarks: [0.7, 1.2, 1.7, 2.3],
        weight_points: 1, cap: null },
    ]
  })

  // ── SUPORTE ────────────────────────────────────────────────────────────────
  // Applies to: Support class
  // All metrics are identity-specific and computed from per-tier support assumptions.
  // assistsPerDeath: derived from assists[t] / deaths(ka_total[t], kda[t])
  // visionPerDeath:  derived from vision_score[t] / deaths
  // wardsAndWKPerDeath: derived from (wards_placed[t] + wards_killed[t]*10) / deaths
  //
  // Pre-computed benchmark arrays (derivation documented in comments):
  //   deaths[B] = 16/1.8 = 8.89,  [A] = 16/2.5 = 6.40,  [G] = 15/3.2 = 4.69,  [P] = 14/4.1 = 3.41
  //   assistsPerDeath: [min(10/8.89,10), min(12/6.40,10), min(13/4.69,10), min(14/3.41,10)]
  //                  = [1.125, 1.875, 2.772, 4.105]   (all below cap of 10)
  //   visionPerDeath:  [min(15/8.89,50), min(22/6.40,50), min(30/4.69,50), min(40/3.41,50)]
  //                  = [1.688, 3.438, 6.399, 11.737]  (all below cap of 50)
  //   wardsAndWKPerDeath: [min(6/8.89,50), min(10/6.40,50), min(14/4.69,50), min(20/3.41,50)]
  //                     = [0.675, 1.563, 2.985, 5.865]
  seed('suporte', {
    assumptions: {
      ka_total:     [16,   16,   15,   14  ],
      assists:      [10,   12,   13,   14  ],
      vision_score: [15,   22,   30,   40  ],
      wards_and_wk: [6,    10,   14,   20  ],  // wardsPlaced + wardsKilled*10 per game
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
  })

}, (app) => {
  // ── Rollback ───────────────────────────────────────────────────────────────
  try {
    const col = app.findCollectionByNameOrId('rank_config')
    app.delete(col)
  } catch (_) {}
})
