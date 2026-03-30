// rank-derivation.js
// Single source of truth for rank benchmark expansion, source resolution,
// and score configuration derivation.
// Consumed by: stats-page.js, rank-config-page.js

// ── Source key aliases ──────────────────────────────────────────────────────────
// Maps short/alternate source fragments to actual benchmark array keys.
const _SOURCE_ALIASES = {
  deaths:                 'deaths_per_game',
  control_wards:          'control_wards_placed',
  control_wards_per_game: 'control_wards_placed',
  wards_and_wk:           'wards_and_wk_per_game',
  damage_mitigated:       'damage_mitigated_per_game',
  damage_taken:           'damage_taken_per_game',
}

function _resolveKey(key) { return _SOURCE_ALIASES[key] ?? key }

// ── expandBenchmarks ────────────────────────────────────────────────────────────
// Enriches stored PocketBase benchmarks with every runtime-derived array
// (assists, kill_secured, all per_min ↔ per_game conversions).
function expandBenchmarks(G) {
  const t = G.game_time_min
  const assists_per_game = G.kda.map((k, i) => k * G.deaths_per_game[i] - G.kills_per_game[i])
  const kill_secured = G.kills_per_game.map((k, i) => {
    const denom = k + assists_per_game[i]
    return denom > 0 ? k / denom : 0
  })

  return {
    ...G,
    assists_per_game,
    kill_secured,
    // per_game ← per_min (stored as per_min)
    cs_per_game:              G.cs_per_min.map((v, i)           => v * t[i]),
    vision_score_per_game:    G.vision_score_per_min.map((v, i) => v * t[i]),
    // per_min ← per_game (stored as per_game)
    damage_per_min:           G.damage_per_game.map((v, i)           => v / t[i]),
    gold_per_min:             G.gold_per_game.map((v, i)             => v / t[i]),
    damage_taken_per_min:     G.damage_taken_per_game.map((v, i)     => v / t[i]),
    damage_mitigated_per_min: G.damage_mitigated_per_game.map((v, i) => v / t[i]),
    cc_per_min:               G.cc_per_game.map((v, i)               => v / t[i]),
    kills_per_min:            G.kills_per_game.map((v, i)            => v / t[i]),
    assists_per_min:          assists_per_game.map((v, i)            => v / t[i]),
    wards_and_wk_per_min:     G.wards_and_wk_per_game.map((v, i)    => v / t[i]),
  }
}

// ── resolveBenchmarkSource ──────────────────────────────────────────────────────
// Resolves a metric source string (e.g. 'damage_per_game/deaths', 'cs_per_min')
// to a numeric benchmark value at rank index ri.
function resolveBenchmarkSource(B, source, ri) {
  if (source.includes('/')) {
    const [numKey, denomKey] = source.split('/')
    const num   = B[_resolveKey(numKey)]
    const denom = B[_resolveKey(denomKey)]
    return (num?.[ri] ?? 0) / (denom?.[ri] || 1)
  }
  return B[_resolveKey(source)]?.[ri] ?? 0
}

// ── deriveScoreConfig ───────────────────────────────────────────────────────────
// Derives thresholds, coefficients, and KDA penalty for a lens from global benchmarks.
// Anchor: Platinum (index 4). No interpolation — all 10 ranks computed directly.
function deriveScoreConfig(G, lensCfg) {
  const { metrics } = lensCfg
  const R = 10
  const ANCHOR = 4 // Platinum

  const B = expandBenchmarks(G)
  const applyCap = (v, cap) => (cap != null ? Math.min(v, cap) : v)

  const coefficients = {}
  for (const m of metrics) {
    const anchorVal = applyCap(resolveBenchmarkSource(B, m.source, ANCHOR), m.cap)
    coefficients[m.key] = anchorVal > 0 ? m.weight_points / anchorVal : 0
  }

  const rawBenchmarks = {}
  for (const m of metrics) {
    rawBenchmarks[m.key] = Array.from({ length: R }, (_, ri) => resolveBenchmarkSource(B, m.source, ri))
  }

  const thresholds = Array.from({ length: R }, (_, ri) =>
    metrics.reduce((sum, m) => sum + applyCap(resolveBenchmarkSource(B, m.source, ri), m.cap) * coefficients[m.key], 0)
  )

  let kdaPenalty = null
  const kdaMetric = metrics.find(m => m.source === 'kda')
  if (kdaMetric) {
    const totalWeight = metrics.reduce((sum, m) => sum + m.weight_points, 0)
    const ironKdaValue = resolveBenchmarkSource(B, 'kda', 0)
    kdaPenalty = { ironValue: ironKdaValue, exponent: Math.sqrt(kdaMetric.weight_points / totalWeight) }
  }

  return { thresholds, coefficients, metrics, kdaPenalty, rawBenchmarks }
}

// ── migrateBenchmarks ───────────────────────────────────────────────────────────
// Converts old PocketBase format (per_game stored) to current format (per_min stored)
// for fields where the editable unit was changed. Mutates and returns the object.
function migrateBenchmarks(b) {
  if (b.cs_per_game && !b.cs_per_min) {
    b.cs_per_min = b.cs_per_game.map((v, i) => +(v / b.game_time_min[i]).toFixed(2))
    delete b.cs_per_game
  }
  if (b.vision_score_per_game && !b.vision_score_per_min) {
    b.vision_score_per_min = b.vision_score_per_game.map((v, i) => +(v / b.game_time_min[i]).toFixed(2))
    delete b.vision_score_per_game
  }
  return b
}
