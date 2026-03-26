// rank-config-page.js
// Alpine component for the rank calibration config page.
// Allows editing global benchmarks and per-lens identity assumptions + metric weights/caps.
// Changes are saved to the 'rank_config' PocketBase collection.

// Re-implements the derivation logic from stats-page.js so the preview works standalone.
// (Kept in sync manually — if you change the derivation algorithm in stats-page.js, update here too.)

document.addEventListener('alpine:init', () => {
Alpine.data('rankConfigPage', () => ({
  loading: true,
  error:   null,
  saving:  false,

  // Record IDs (needed for PATCH operations)
  recordIds: {},  // { global: 'pb_id', carry: 'pb_id', ... }

  activeLens: 'carry',
  lensKeys: ['carry', 'assassino', 'bruiser', 'tank', 'suporte'],

  rankNames: ['Iron','Bronze','Silver','Gold','Platinum','Emerald','Diamond','Master','Grandmaster','Challenger'],
  rankAbbr:  ['I','B','S','G','P','E','D','M','GM','C'],
  // Tailwind text-color classes — must match RANK_COLORS in stats-page.js
  rankColors: [
    'text-zinc-500',    // 0 Iron
    'text-amber-700',   // 1 Bronze
    'text-slate-300',   // 2 Silver
    'text-yellow-400',  // 3 Gold
    'text-teal-400',    // 4 Platinum
    'text-emerald-400', // 5 Emerald
    'text-cyan-300',    // 6 Diamond
    'text-purple-400',  // 7 Master
    'text-red-500',     // 8 Grandmaster
    'text-orange-400',  // 9 Challenger
  ],

  saveMsg: {},  // { global: 'Saved!', carry: 'Saved!', ... }

    // Global benchmark defaults (10-element empirical arrays)
    // Rank order: [Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Challenger]
    //
    // Stored in PocketBase (editable): per_game values, ratios, game_time_min
    // Computed at runtime (read-only): per_min = per_game / game_time_min
    // Also computed at runtime: assists_per_game, kill_secured
    globalData: {
      // ── per_game (empirical, editable) ────────────────────────────────────
      kills_per_game:               [6.7,     6.9,     6.9,     6.8,     6.6,     6.5,     6.2,     5.8,     5.7,     5.6    ],
      deaths_per_game:              [6.7,     6.9,     6.9,     6.8,     6.6,     6.5,     6.2,     5.9,     5.7,     5.6    ],
      kda:                          [3.23,    3.20,    3.22,    3.26,    3.32,    3.39,    3.51,    3.60,    3.66,    3.73   ],
      kill_participation:           [0.52,    0.54,    0.56,    0.58,    0.60,    0.62,    0.64,    0.66,    0.68,    0.70   ],
      game_time_min:                [30.62,   31.07,   31.20,   30.97,   30.55,   29.97,   29.07,   27.87,   27.38,   27.07  ],
      damage_per_game:              [9000,    12000,   14250,   16500,   18300,   21000,   22600,   25000,   26333,   27667  ],
      gold_per_game:                [11222.2, 12241.6, 12645.4, 12691.5, 12620.2, 12470.5, 12142.5, 11811.3, 11822.7, 11970.4],
      cs_per_game:                  [147.6,   155.0,   164.4,   170.3,   173.5,   175.0,   173.5,   170.8,   169.5,   169.7  ],
      vision_score_per_game:        [26.9,    29.5,    32.1,    33.8,    34.2,    34.5,    34.3,    33.7,    34.2,    34.9   ],
      damage_taken_per_game:        [25108.4, 26720.2, 28080.0, 27253.6, 25662.0, 23976.0, 21802.5, 19509.0, 18070.8, 16783.4],
      damage_mitigated_per_game:    [5511.6,  6214.0,  7176.0,  8052.2,  8859.5,  9590.4,  10465.2, 11148.0, 12047.2, 12993.6],
      cc_per_game:                  [27.6,    31.1,    37.4,    43.4,    48.9,    53.9,    61.0,    66.9,    73.9,    81.2   ],
      control_wards_placed:         [0.61,    0.77,    1.05,    1.31,    1.50,    1.66,    1.90,    1.99,    2.19,    2.41   ],
      wards_and_wk_per_game:        [5,       6,       8,       10,      12,      14,      16,      18,      20,      22     ],
    },

  globalRows: [
    // ── per_game (editável — armazenado no PocketBase) ─────────────────────
    { key: 'kills_per_game',            label: 'Kills',                unit: 'kills/jogo',       editable: true  },
    { key: 'deaths_per_game',           label: 'Mortes',               unit: 'mortes/jogo',      editable: true  },
    { key: 'kda',                       label: 'KDA',                  unit: 'ratio',            editable: true  },
    { key: 'kill_participation',        label: 'Kill Participation',   unit: 'ratio',            editable: true  },
    { key: 'kill_secured',              label: 'Kill Secured (K/(K+A))', unit: 'ratio',          editable: false },
    { key: 'damage_per_game',           label: 'Dano',                 unit: 'dano/jogo',        editable: true  },
    { key: 'damage_per_min',            label: 'Dano/min',             unit: 'dano/min',         editable: false },
    { key: 'gold_per_game',             label: 'Ouro',                 unit: 'ouro/jogo',        editable: true  },
    { key: 'cs_per_game',               label: 'CS',                   unit: 'cs/jogo',          editable: true  },
    { key: 'vision_score_per_game',     label: 'Vision Score',         unit: 'pontos/jogo',      editable: true  },
    { key: 'damage_taken_per_game',     label: 'Dano Recebido',        unit: 'dano/jogo',        editable: true  },
    { key: 'damage_mitigated_per_game', label: 'Dano Mitigado',        unit: 'dano/jogo',        editable: true  },
    { key: 'cc_per_game',               label: 'CC',                   unit: 'cc/jogo',          editable: true  },
    { key: 'control_wards_placed',      label: 'Control Wards',        unit: 'wards/jogo',       editable: true  },
    { key: 'wards_and_wk_per_game',     label: 'Wards + WardKills',    unit: 'combinado/jogo',   editable: true  },
    // ── duração (editável) ─────────────────────────────────────────────────
    { key: 'game_time_min',             label: 'Duração',              unit: 'minutos',          editable: true  },
    // ── per_min (read-only — derivado: per_game / game_time_min) ──────────
    { key: 'gold_per_min',              label: 'Ouro/min',             unit: 'ouro/min',         editable: false },
    { key: 'cs_per_min',                label: 'CS/min',               unit: 'cs/min',           editable: false },
    { key: 'vision_score_per_min',      label: 'Vision Score/min',     unit: 'pontos/min',       editable: false },
    { key: 'damage_taken_per_min',      label: 'Dano Recebido/min',    unit: 'dano/min',         editable: false },
    { key: 'damage_mitigated_per_min',  label: 'Dano Mitigado/min',    unit: 'dano/min',         editable: false },
    { key: 'cc_per_min',                label: 'CC/min',               unit: 'cc/min',           editable: false },
  ],

  // Per-lens config state (deep copy from DB)
  lensData: {},

  async init() {
    try {
      const data = await api.col('rank_config').list({ perPage: 20 })
      for (const rec of data.items) {
        this.recordIds[rec.name] = rec.id
        if (rec.name === 'global') {
          this.globalData = JSON.parse(JSON.stringify(rec.config.benchmarks))
        } else {
          this.lensData[rec.name] = JSON.parse(JSON.stringify(rec.config))
        }
      }
      this.error = null
    } catch (err) {
      this.error = `Erro ao carregar config: ${err.message}`
      console.error('[rank-config-page] load error:', err)
    } finally {
      this.loading = false
    }
  },

  lensLabel(lens) {
    return { carry: 'Carry', assassino: 'Assassino', bruiser: 'Bruiser', tank: 'Tank', suporte: 'Suporte' }[lens] ?? lens
  },

  setMetricField(lens, mi, field, val) {
    this.lensData[lens].metrics[mi][field] = val
  },

  // ── Derivation (mirrors deriveScoreConfig in stats-page.js) ──────────────
  // 10-rank direct computation — no interpolation.
  // Anchor: Platinum (index 4).
  _deriveScoreConfig(G, lensCfg) {
    const { assumptions = {}, metrics } = lensCfg
    const R = 10
    const ANCHOR = 4 // Platinum

    // ── Runtime-derived fields (not stored in PocketBase) ──────────────────
    // per_min = per_game / game_time_min
    const damage_per_min           = G.damage_per_game.map((v, i)           => v / G.game_time_min[i])
    const gold_per_min             = G.gold_per_game.map((v, i)             => v / G.game_time_min[i])
    const cs_per_min               = G.cs_per_game.map((v, i)               => v / G.game_time_min[i])
    const vision_score_per_min     = G.vision_score_per_game.map((v, i)     => v / G.game_time_min[i])
    const damage_taken_per_min     = G.damage_taken_per_game.map((v, i)     => v / G.game_time_min[i])
    const damage_mitigated_per_min = G.damage_mitigated_per_game.map((v, i) => v / G.game_time_min[i])
    const cc_per_min               = G.cc_per_game.map((v, i)               => v / G.game_time_min[i])
    // assists_per_game = kda × deaths − kills
    const assists_per_game = G.kda.map((k, i) => k * G.deaths_per_game[i] - G.kills_per_game[i])
    // kill_secured = kills / (kills + assists)
    const kill_secured = G.kills_per_game.map((k, i) => {
      const denom = k + assists_per_game[i]
      return denom > 0 ? k / denom : 0
    })

    const applyCap = (v, cap) => (cap != null ? Math.min(v, cap) : v)

    const rawBenchmark = (m, ri) => {
      switch (m.source) {
         // ── Per-death: X_per_game / deaths_per_game ────────────────────────
         case 'damage_per_game/deaths':           return G.damage_per_game[ri]         / G.deaths_per_game[ri]
         case 'kills_per_game/deaths':           return G.kills_per_game[ri]          / G.deaths_per_game[ri]
         case 'assists_per_game/deaths':         return assists_per_game[ri]          / G.deaths_per_game[ri]
         case 'gold_per_game/deaths':             return G.gold_per_game[ri]           / G.deaths_per_game[ri]
         case 'cs_per_game/deaths':               return G.cs_per_game[ri]             / G.deaths_per_game[ri]
         case 'vision_score_per_game/deaths':     return G.vision_score_per_game[ri]   / G.deaths_per_game[ri]
         case 'damage_mitigated_per_game/deaths': return G.damage_mitigated_per_game[ri] / G.deaths_per_game[ri]
         case 'damage_taken_per_game/deaths':     return G.damage_taken_per_game[ri]   / G.deaths_per_game[ri]
         case 'control_wards/deaths':            return G.control_wards_placed[ri]    / G.deaths_per_game[ri]
         case 'wards_and_wk/deaths':             return G.wards_and_wk_per_game[ri]   / G.deaths_per_game[ri]
         // ── Ratio: per_game / per_game ──────────────────────────────────────
         case 'damage_per_min/damage_taken_per_min':           return G.damage_per_game[ri] / G.damage_taken_per_game[ri]
         case 'damage_mitigated_per_min/damage_taken_per_min': return G.damage_mitigated_per_game[ri] / G.damage_taken_per_game[ri]
         case 'damage_mitigated/damage_taken':                 return G.damage_mitigated_per_game[ri] / G.damage_taken_per_game[ri]
         // ── Direct per_min (runtime-computed) ──────────────────────────────
         case 'damage_per_min':           return damage_per_min[ri]
         case 'gold_per_min':             return gold_per_min[ri]
         case 'cs_per_min':               return cs_per_min[ri]
         case 'vision_score_per_min':     return vision_score_per_min[ri]
         case 'damage_mitigated_per_min': return damage_mitigated_per_min[ri]
         case 'damage_taken_per_min':     return damage_taken_per_min[ri]
         case 'cc_per_min':               return cc_per_min[ri]
         // ── Direct empirical ────────────────────────────────────────────────
         case 'kill_participation':   return G.kill_participation[ri]
         case 'kill_secured':         return kill_secured[ri]
         case 'kda':                  return G.kda[ri]
         case 'control_wards_per_game': return G.control_wards_placed[ri]
         default: return 0
       }
    }

    const coefficients = {}
    for (const m of metrics) {
      const anchorVal = applyCap(rawBenchmark(m, ANCHOR), m.cap)
      coefficients[m.key] = anchorVal > 0 ? m.weight_points / anchorVal : 0
    }

    // Capture rawBenchmarks per metric for display
    const rawBenchmarks = {}
    for (const m of metrics) {
      rawBenchmarks[m.key] = Array.from({ length: R }, (_, ri) => rawBenchmark(m, ri))
    }

    // 10 rank thresholds directly — no interpolation
    const thresholds = Array.from({ length: R }, (_, ri) =>
      metrics.reduce((sum, m) => sum + applyCap(rawBenchmark(m, ri), m.cap) * coefficients[m.key], 0)
    )

    return { thresholds, coefficients, rawBenchmarks }
  },

  derivedPreview(lens) {
    const ld = this.lensData[lens]
    if (!ld) return { thresholds: Array(10).fill(0), coefficients: {}, rawBenchmarks: {} }
    try {
      return this._deriveScoreConfig(this.globalData, ld)
    } catch (_) {
      return { thresholds: Array(10).fill(0), coefficients: {}, rawBenchmarks: {} }
    }
  },

  // Returns globalData enriched with runtime-derived values for display in the table.
  // The per_min keys and kill_secured are read-only rows in globalRows — they don't exist
  // in globalData, so we compute them here for the template to render.
  globalDataDisplay() {
    const G = this.globalData
    const t = G.game_time_min
    if (!t) return G
    const assists_per_game = G.kda?.map((k, i) => k * G.deaths_per_game[i] - G.kills_per_game[i])
    return {
      ...G,
      damage_per_min:           G.damage_per_game?.map((v, i)           => v / t[i]),
      gold_per_min:             G.gold_per_game?.map((v, i)             => v / t[i]),
      cs_per_min:               G.cs_per_game?.map((v, i)               => v / t[i]),
      vision_score_per_min:     G.vision_score_per_game?.map((v, i)     => v / t[i]),
      damage_taken_per_min:     G.damage_taken_per_game?.map((v, i)     => v / t[i]),
      damage_mitigated_per_min: G.damage_mitigated_per_game?.map((v, i) => v / t[i]),
      cc_per_min:               G.cc_per_game?.map((v, i)               => v / t[i]),
      kill_secured:             G.kills_per_game?.map((k, i) => {
        const denom = k + (assists_per_game?.[i] ?? 0)
        return denom > 0 ? k / denom : 0
      }),
    }
  },

  // ── Save ──────────────────────────────────────────────────────────────────
  async saveGlobal() {
    this.saving = true
    this.saveMsg = { ...this.saveMsg, global: null }
    try {
      await api.col('rank_config').update(this.recordIds['global'], {
        config: { benchmarks: this.globalData }
      })
      this.saveMsg = { ...this.saveMsg, global: 'Salvo com sucesso!' }
      setTimeout(() => { this.saveMsg = { ...this.saveMsg, global: null } }, 3000)
    } catch (err) {
      this.saveMsg = { ...this.saveMsg, global: `Erro: ${err.message}` }
    } finally {
      this.saving = false
    }
  },

  async saveLens(lens) {
    this.saving = true
    this.saveMsg = { ...this.saveMsg, [lens]: null }
    try {
      await api.col('rank_config').update(this.recordIds[lens], {
        config: this.lensData[lens]
      })
      this.saveMsg = { ...this.saveMsg, [lens]: 'Salvo com sucesso!' }
      setTimeout(() => { this.saveMsg = { ...this.saveMsg, [lens]: null } }, 3000)
    } catch (err) {
      this.saveMsg = { ...this.saveMsg, [lens]: `Erro: ${err.message}` }
    } finally {
      this.saving = false
    }
  },
}))
})
