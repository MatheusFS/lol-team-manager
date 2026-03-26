// ── Chart.js global defaults ──────────────────────────────────────────────────
Chart.defaults.color          = '#94a3b8'
Chart.defaults.borderColor    = '#1e293b'
Chart.defaults.font.size      = 12
Chart.defaults.plugins.legend.display = false

// ── Wilson CI error bar plugin ────────────────────────────────────────────────
Chart.register({
  id: 'ciWhiskers',
  afterDatasetsDraw(chart) {
    const { ctx } = chart
    chart.data.datasets.forEach((ds, di) => {
      if (!ds._ci) return
      const meta = chart.getDatasetMeta(di)
      const isH  = chart.options.indexAxis === 'y'
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth   = 1.5
      meta.data.forEach((bar, j) => {
        const ci = ds._ci[j]
        if (!ci || ci.lo == null) return
        if (isH) {
          const x1 = chart.scales.x.getPixelForValue(ci.lo * 100)
          const x2 = chart.scales.x.getPixelForValue(ci.hi * 100)
          const y  = bar.y, c = 4
          ctx.beginPath()
          ctx.moveTo(x1, y-c); ctx.lineTo(x1, y+c)
          ctx.moveTo(x2, y-c); ctx.lineTo(x2, y+c)
          ctx.moveTo(x1, y);   ctx.lineTo(x2, y)
          ctx.stroke()
        } else {
          const y1 = chart.scales.y.getPixelForValue(ci.lo * 100)
          const y2 = chart.scales.y.getPixelForValue(ci.hi * 100)
          const x  = bar.x, c = 4
          ctx.beginPath()
          ctx.moveTo(x-c, y1); ctx.lineTo(x+c, y1)
          ctx.moveTo(x-c, y2); ctx.lineTo(x+c, y2)
          ctx.moveTo(x,   y1); ctx.lineTo(x,   y2)
          ctx.stroke()
        }
      })
      ctx.restore()
    })
  }
})

// ── Chart helpers (module-level, called from Alpine init) ─────────────────────

// COMP_EMOJI comes from shared.js

function mean(arr) { return arr.length ? arr.reduce((s,v) => s+v, 0) / arr.length : null }

function baseOpts(isH) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    ...(isH ? { indexAxis: 'y' } : {}),
    scales: {
      [isH ? 'x' : 'y']: {
        min: 0, max: 100,
        ticks: { callback: v => v + '%', stepSize: 25 },
        grid:  { color: 'rgba(51,65,85,0.5)' },
      },
      [isH ? 'y' : 'x']: { grid: { display: false } },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: ctx => {
            const ds = ctx.dataset
            const ci = ds._ci?.[ctx.dataIndex]
            const n  = ds._n?.[ctx.dataIndex]
            const w  = ds._w?.[ctx.dataIndex]
            const v  = ctx.parsed[isH ? 'x' : 'y']
            const ciStr = ci?.lo != null ? `  IC ${utils.pct(ci.lo)}–${utils.pct(ci.hi)}%` : ''
            const nStr  = n  != null     ? `  (${w}V / ${n-w}D, N=${n})` : ''
            return ` ${v}%${ciStr}${nStr}`
          },
        },
      },
    },
  }
}

// ── Global state for chart filtering ──────────────────────────────────────
let _showAnecdotal = {
  'comp-type': false,
  'enemy-type': false,
  'game-n': false,
  'side': false,
  'duration': false,
  'mvp-wr': false,
  'formation': false,
}

// ── Player Performance Lens Definitions ───────────────────────────────────
let _playerLens = 'geral'

// ── Rank config (loaded from DB; derived at runtime from benchmarks + lens params) ──
const RANK_NAMES  = ['iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger']
const RANK_LABELS = ['Iron','Bronze','Silver','Gold','Platinum','Emerald','Diamond','Master','Grandmaster','Challenger']
// Tailwind text-color classes aligned to LoL rank palette
// Iron=zinc, Bronze=amber-dark, Silver=slate-light, Gold=yellow, Platinum=teal,
// Emerald=emerald, Diamond=cyan, Master=purple, Grandmaster=red, Challenger=vivid-orange
const RANK_COLORS = [
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
]

// In-memory cache populated by loadRankConfig(). Keyed by lens name.
// Each entry: { thresholds: number[10], coefficients: { [metricKey]: number } }
let _rankConfig = {}

// Load rank_config records from PocketBase and derive per-lens thresholds + coefficients.
// Falls back to empty config (no-op) on error — ranks simply won't render.
async function loadRankConfig() {
  try {
    const data = await api.col('rank_config').list({ perPage: 20 })
    const records = data.items
    const globalRec = records.find(r => r.name === 'global')
    if (!globalRec) return
    const G = globalRec.config.benchmarks  // { damage_per_game, gold_per_game, kda, cs_per_min, game_time_min }

    for (const rec of records) {
      if (rec.name === 'global') continue
      _rankConfig[rec.name] = deriveScoreConfig(G, rec.config)
    }
  } catch (err) {
    console.error('[rank_config] Failed to load rank config from DB:', err)
  }
}

// Derive thresholds and coefficients for a single lens from global benchmarks + lens config.
//
// Rank order in all arrays (index 0–9):
//   [Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Challenger]
//
// Global benchmark fields stored in PocketBase (empirical, editable):
//   kills_per_game, deaths_per_game, kda, kill_participation,
//   game_time_min, damage_per_game,
//   gold_per_game, cs_per_game, vision_score_per_game,
//   damage_taken_per_game, damage_mitigated_per_game, cc_per_game,
//   control_wards_placed, wards_and_wk_per_game
//
// Runtime-computed fields (derived, NOT stored in PocketBase):
//   per_min = per_game / game_time_min  (gold, cs, vision_score, damage_taken, damage_mitigated, cc)
//   assists_per_game = kda × deaths_per_game − kills_per_game
//   kill_secured     = kills_per_game / (kills_per_game + assists_per_game)
//
// Metric sources (m.source string → formula):
//   'damage_per_game/deaths'                       → damage_per_game / deaths_per_game
//   'gold_per_game/deaths'                         → gold_per_game / deaths_per_game
//   'kills_per_game/deaths'                       → kills_per_game / deaths_per_game
//   'assists_per_game/deaths'                     → assists_per_game / deaths_per_game
//   'cs_per_game/deaths'                           → cs_per_game / deaths_per_game
//   'vision_score_per_game/deaths'                 → vision_score_per_game / deaths_per_game
//   'damage_mitigated_per_game/deaths'             → damage_mitigated_per_game / deaths_per_game
//   'damage_taken_per_game/deaths'                 → damage_taken_per_game / deaths_per_game
//   'control_wards/deaths'                        → control_wards_placed / deaths_per_game
//   'wards_and_wk/deaths'                         → wards_and_wk_per_game / deaths_per_game
//   'damage_per_min/damage_taken_per_min'         → damage_per_game / damage_taken_per_game
//   'damage_mitigated_per_min/damage_taken_per_min' → damage_mitigated_per_game / damage_taken_per_game
//   'gold_per_min'             → gold_per_game / game_time_min
//   'cs_per_min'               → cs_per_game / game_time_min
//   'vision_score_per_min'     → vision_score_per_game / game_time_min
//   'damage_mitigated_per_min' → damage_mitigated_per_game / game_time_min
//   'damage_taken_per_min'     → damage_taken_per_game / game_time_min
//   'cc_per_min'               → cc_per_game / game_time_min
//   'kill_participation'       → G.kill_participation[ri]
//   'kill_secured'             → kills_per_game / (kills_per_game + assists_per_game)
//   'kda'                      → G.kda[ri]
//   'control_wards_per_game'   → G.control_wards_placed[ri]
//
// Coefficient anchor: Platinum (index 4).
// coefficient = weight_points / Platinum_value  (so that Platinum score = sum of weight_points)
//
// 10 rank thresholds computed directly — no interpolation step.
function deriveScoreConfig(G, lensCfg) {
  const { assumptions = {}, metrics } = lensCfg
  const R = 10
  const ANCHOR = 4 // Platinum

  // ── Runtime-derived fields (not stored in PocketBase) ─────────────────────
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

  // Get raw (uncapped) benchmark value for a metric at rank index ri
  function rawBenchmark(m, ri) {
    switch (m.source) {
      // ── Per-death: X_per_game / deaths_per_game ────────────────────────
      case 'damage_per_game/deaths':           return G.damage_per_game[ri]           / G.deaths_per_game[ri]
      case 'kills_per_game/deaths':           return G.kills_per_game[ri]            / G.deaths_per_game[ri]
      case 'assists_per_game/deaths':         return assists_per_game[ri]            / G.deaths_per_game[ri]
      case 'gold_per_game/deaths':             return G.gold_per_game[ri]             / G.deaths_per_game[ri]
      case 'cs_per_game/deaths':               return G.cs_per_game[ri]               / G.deaths_per_game[ri]
      case 'vision_score_per_game/deaths':     return G.vision_score_per_game[ri]     / G.deaths_per_game[ri]
      case 'damage_mitigated_per_game/deaths': return G.damage_mitigated_per_game[ri] / G.deaths_per_game[ri]
      case 'damage_taken_per_game/deaths':     return G.damage_taken_per_game[ri]     / G.deaths_per_game[ri]
      case 'control_wards/deaths':            return G.control_wards_placed[ri]      / G.deaths_per_game[ri]
      case 'wards_and_wk/deaths':             return G.wards_and_wk_per_game[ri]     / G.deaths_per_game[ri]
      // ── Ratio: per_game / per_game ──────────────────────────────────────
      case 'damage_per_min/damage_taken_per_min':           return G.damage_per_game[ri]           / G.damage_taken_per_game[ri]
      case 'damage_mitigated_per_min/damage_taken_per_min': return G.damage_mitigated_per_game[ri] / G.damage_taken_per_game[ri]
      // ── Direct per_min (runtime-computed) ──────────────────────────────
      case 'damage_per_min':           return damage_per_min[ri]
      case 'gold_per_min':             return gold_per_min[ri]
      case 'cs_per_min':               return cs_per_min[ri]
      case 'vision_score_per_min':     return vision_score_per_min[ri]
      case 'damage_mitigated_per_min': return damage_mitigated_per_min[ri]
      case 'damage_taken_per_min':     return damage_taken_per_min[ri]
      case 'cc_per_min':               return cc_per_min[ri]
      // ── Direct empirical ────────────────────────────────────────────────
      case 'kill_participation':     return G.kill_participation[ri]
      case 'kill_secured':           return kill_secured[ri]
      case 'kda':                    return G.kda[ri]
      case 'control_wards_per_game': return G.control_wards_placed[ri]
      default:
        console.warn(`[deriveScoreConfig] Unknown source: ${m.source} (key: ${m.key})`)
        return 0
    }
  }

  // Cap a value (null cap = no cap)
  const applyCap = (v, cap) => (cap != null ? Math.min(v, cap) : v)

  // Compute coefficient anchored at Platinum (index 4)
  const coefficients = {}
  for (const m of metrics) {
    const anchorVal = applyCap(rawBenchmark(m, ANCHOR), m.cap)
    coefficients[m.key] = anchorVal > 0 ? m.weight_points / anchorVal : 0
  }

  // Compute 10 rank thresholds directly — no interpolation
  const thresholds = Array.from({ length: R }, (_, ri) =>
    metrics.reduce((sum, m) => sum + applyCap(rawBenchmark(m, ri), m.cap) * coefficients[m.key], 0)
  )

  // KDA penalty: if player's KDA < Iron benchmark, apply a smooth multiplier
  // multiplier = (playerKDA / ironKDA) ^ exponent
  // exponent = sqrt(kda_weight / total_weight) — self-adjusts if weights change
  let kdaPenalty = null
  const kdaMetric = metrics.find(m => m.source === 'kda')
  if (kdaMetric) {
    const totalWeight = metrics.reduce((sum, m) => sum + m.weight_points, 0)
    const ironKdaValue = rawBenchmark(kdaMetric, 0)  // rank 0 = Iron
    const exponent = Math.sqrt(kdaMetric.weight_points / totalWeight)
    kdaPenalty = { ironValue: ironKdaValue, exponent }
  }

  return { thresholds, coefficients, metrics, kdaPenalty }
}

// High-damage classifications for identity filtering
const HIGH_DMG = new Set(['AD_high','AP_high','Mixed_high'])

// Identity filter helpers
function isCarry(champEntry) {
  if (!champEntry) return false
  if (champEntry.class === 'Marksman') return true
  if (champEntry.class === 'Mage'    && HIGH_DMG.has(champEntry.damage_type)) return true
  if (champEntry.class === 'Fighter' && HIGH_DMG.has(champEntry.damage_type)) return true
  return false
}

function isBruiser(champEntry) {
  if (!champEntry) return false
  return champEntry.class === 'Fighter' && !HIGH_DMG.has(champEntry.damage_type)
}

function hasNoLens(champEntry) {
  if (!champEntry) return true  // unclassified = no entry in DB
  return !isCarry(champEntry) && !isBruiser(champEntry)
    && champEntry.class !== 'Assassin' && champEntry.class !== 'Tank' && champEntry.class !== 'Support'
}

const LENS_DEFS = {
  geral:     { defaultSort: 'wr',        filter: () => true,                   cols: ['deathMin','killParticipation','controlWardsAvg','nCarry','nAssassino','nBruiser','nTank','nSuporte'] },
  carry:     { defaultSort: 'identRank', filter: isCarry,                      cols: ['damPerMin','damPerDeath','goldPerMin','goldPerDeath','csPerMin','csPerDeath','killShare','identRank'] },
  assassino: { defaultSort: 'identRank', filter: c => c?.class === 'Assassin', cols: ['killsMin','damPerDeath','killSecured','goldPerMin','identRank'] },
  bruiser:   { defaultSort: 'identRank', filter: isBruiser,                    cols: ['damPerDmgRec','damPerDeath','goldPerDeath','identRank'] },
  tank:      { defaultSort: 'identRank', filter: c => c?.class === 'Tank',     cols: ['mitPerDmgRec','mitPerDeath','dtPerDeath','ccMin','identRank'] },
  suporte:   { defaultSort: 'identRank', filter: c => c?.class === 'Support',  cols: ['assistsMin','assistsPerDeath','visionMin','visionPerDeath','controlWardsAvg','wardsMin','wardsAndWKPerDeath','identRank'] },
}

const COL_META = {
  damPerMin:    { label: 'Dano/min',     fmt: v => v.toFixed(0)                         },
  goldPerMin:   { label: 'Ouro/min',     fmt: v => v.toFixed(0)                         },
  deathMin:   { label: 'Mortes/min',   fmt: v => v.toFixed(3)                         },
  csPerMin:     { label: 'CS/min',       fmt: v => v.toFixed(1)                         },
  fbKills:    { label: 'FB Kills',     fmt: v => v                                    },
  killsAvg:   { label: 'Kills',        fmt: v => v.toFixed(1)                         },
  dtMin:      { label: 'DmgRec/min',   fmt: v => v.toFixed(0)                         },
  mitMin:     { label: 'Mitigado/min', fmt: v => v.toFixed(0)                         },
  turrets:    { label: 'Turrets',      fmt: v => v.toFixed(1)                         },
  ccMin:      { label: 'CC/min',       fmt: v => v.toFixed(2)                         },
  killParticipation: { label: 'Kill Part%',   fmt: v => v != null ? `${Math.round(v*100)}%` : '—' },
  assistsAvg: { label: 'Assists',      fmt: v => v.toFixed(1)                         },
  visionMin:  { label: 'Visão/min',    fmt: v => v.toFixed(2)                         },
  wardsMin:   { label: 'Wards/min',    fmt: v => v.toFixed(2)                         },
  wkAvg:      { label: 'WardKills',    fmt: v => v.toFixed(1)                         },
  // Per-death metrics
  damPerDeath: { label: 'Dano/Morte',  fmt: v => v === Infinity ? '∞' : v.toFixed(0) },
  goldPerDeath: { label: 'Ouro/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(0) },
  killShare:  { label: 'Kill Part.',    fmt: v => `${(v * 100).toFixed(1)}%`           },
  killSecured:{ label: 'Kill Secured',  fmt: v => `${(v * 100).toFixed(1)}%`           },
  killsPerDeath: { label: 'Kills/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  assistsPerDeath: { label: 'Assists/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  visionPerDeath: { label: 'Visão/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  controlWardsPerDeath: { label: 'CW/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  controlWardsAvg: { label: 'Control Wards', fmt: v => v.toFixed(2)                  },
  wardsAndWKPerDeath:   { label: 'Wards/Morte',     fmt: v => v === Infinity ? '∞' : v.toFixed(2)  },
  // New per-min columns
  killsMin:   { label: 'Kills/min',    fmt: v => v.toFixed(2) },
  assistsMin: { label: 'Assist/min',   fmt: v => v.toFixed(2) },
  // New per-death columns
  csPerDeath:  { label: 'CS/Morte',          fmt: v => v === Infinity ? '∞' : v.toFixed(1)  },
  mitPerDeath: { label: 'Mitigado/Morte',    fmt: v => v === Infinity ? '∞' : v.toFixed(0)  },
  dtPerDeath:  { label: 'DmgRec/Morte',      fmt: v => v === Infinity ? '∞' : v.toFixed(0)  },
  // New ratio columns
  damPerDmgRec: { label: 'Dano/DmgRec', fmt: v => v.toFixed(3) },
  mitPerDmgRec: { label: 'Mit/DmgRec',  fmt: v => v.toFixed(3) },
  // Identity counts (Geral lens)
  nCarry:     { label: 'Carry',        fmt: v => v                                    },
  nAssassino: { label: 'Assassino',    fmt: v => v                                    },
  nBruiser:   { label: 'Bruiser',      fmt: v => v                                    },
  nTank:      { label: 'Tank',         fmt: v => v                                    },
  nSuporte:   { label: 'Suporte',      fmt: v => v                                    },
  // Identity rank (special rendering)
  identRank:  { label: 'Rank',      fmt: v => v ? `${v.label}` : '—' },
}


function winRateChart(canvasId, stats, isH = true, chartKey = null, extraOpts = {}) {
  Chart.getChart(canvasId)?.destroy()
  
  // Filtrar dados anedóticos se checkbox está desmarcado
  const showAnecdotal = chartKey && _showAnecdotal[chartKey]
  const filtered = !chartKey || showAnecdotal 
    ? stats 
    : stats.filter(s => s.n >= 10)
  
  // Se todos os dados foram filtrados, mostrar mensagem
  if (filtered.length === 0) {
    document.getElementById(canvasId).parentElement.innerHTML = 
      '<p class="text-xs text-slate-500">Sem dados significativos (N≥10) para exibir.</p>'
    return
  }
  
  new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: filtered.map(s => {
        const e    = COMP_EMOJI[s.label] ?? ''
        const warn = s.n < 10 ? ' ⚠️' : ''
        return `${e}${e?' ':''}${s.label}${warn}  N=${s.n}`
      }),
      datasets: [{
        data:            filtered.map(s => utils.pct(s.rate) ?? 0),
        backgroundColor: filtered.map(s => utils.rateColor(s.rate ?? 0, s.n)),
        borderRadius: 4,
        _ci: filtered.map(s => ({ lo: s.lo, hi: s.hi })),
        _n:  filtered.map(s => s.n),
        _w:  filtered.map(s => s.wins),
      }],
    },
    options: { ...baseOpts(isH), ...extraOpts },
  })
}

function buildTeamCharts(M) {
  const total  = M.length
  const wins   = M.filter(m => m.win).length
  const { rate, lo, hi } = utils.wilson(wins, total)
  const durM   = M.filter(m => m.duration)
  const avgDur = mean(durM.map(m => m.duration))

  const compStats = utils.groupWR(M, m => m.comp_type)
  const bestComp  = compStats.filter(s => s.n >= 5).sort((a,b) => b.lo - a.lo)[0]

  document.getElementById('overview').innerHTML = [
    { label: 'Total de Partidas', big: total, cls: 'text-slate-200' },
    { label: 'Aproveitamento', big: `${utils.pct(rate)}%`,
      sub: `95% IC: ${utils.pct(lo)}–${utils.pct(hi)}%`,
      cls: rate >= 0.5 ? 'text-green-400' : 'text-red-400' },
    { label: 'Saldo', big: `${wins}V – ${total-wins}D`, cls: 'text-slate-200' },
    { label: 'Duração Média', big: avgDur ? `${Math.round(avgDur)}m` : '—',
      sub: `N=${durM.length} partidas`, cls: 'text-slate-200' },
    { label: 'Melhor Comp (N≥5)',
      big: bestComp ? `${COMP_EMOJI[bestComp.label]} ${bestComp.label}` : '—',
      sub: bestComp ? `${utils.pct(bestComp.rate)}%  IC: ${utils.pct(bestComp.lo)}–${utils.pct(bestComp.hi)}%` : '',
      cls: 'text-yellow-400' },
  ].map(c => `
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div class="text-xs text-slate-400 mb-1">${c.label}</div>
      <div class="text-2xl font-bold ${c.cls}">${c.big}</div>
      ${c.sub ? `<div class="text-xs text-slate-500 mt-0.5">${c.sub}</div>` : ''}
    </div>`).join('')

  winRateChart('c-comp-type',  compStats, true, 'comp-type')
  winRateChart('c-enemy-type', utils.groupWR(M, m => m.enemy_type), true, 'enemy-type')

  const gnStats = utils.groupWR(M, m => String(m.game_n)).sort((a,b) => +a.label - +b.label)
  winRateChart('c-game-n', gnStats.map(s => ({ ...s, label: `J${s.label}` })), false, 'game-n')

  const ss = utils.groupWR(M, m => m.side).sort((a,b) => a.label.localeCompare(b.label))
  Chart.getChart('c-side')?.destroy()
  new Chart(document.getElementById('c-side'), {
    type: 'bar',
    data: {
      labels: ss.map(s => `${s.label === 'Red' ? '🟥' : '🟦'} ${s.label}  N=${s.n}`),
      datasets: [{
        data:            ss.map(s => utils.pct(s.rate)),
        backgroundColor: ss.map(s => s.label === 'Red' ? 'rgba(248,113,113,0.78)' : 'rgba(96,165,250,0.78)'),
        borderRadius: 4,
        _ci: ss.map(s => ({ lo: s.lo, hi: s.hi })),
        _n:  ss.map(s => s.n),
        _w:  ss.map(s => s.wins),
      }],
    },
    options: baseOpts(false),
  })

  const order   = ['<25m', '25–35m', '35–45m', '45m+']
  const buckets = { '<25m':{wins:0,n:0}, '25–35m':{wins:0,n:0}, '35–45m':{wins:0,n:0}, '45m+':{wins:0,n:0} }
  for (const m of M) {
    if (!m.duration) continue
    const k = m.duration < 25 ? '<25m' : m.duration < 35 ? '25–35m' : m.duration < 45 ? '35–45m' : '45m+'
    buckets[k].n++; if (m.win) buckets[k].wins++
  }
  winRateChart('c-duration', order.map(k => {
    const { wins, n } = buckets[k]
    return { label: `${k}  N=${n}`, wins, n, ...utils.wilson(wins, n) }
  }), false, 'duration')
}

// ── GD@5 from snapshot ────────────────────────────────────────────────────────
function computeGD5(m) {
  const snap = m.riot_match_snapshot
  if (!snap?.timeline?.info?.frames?.[5]) return null
  const frame5 = snap.timeline.info.frames[5]
  const ourId  = m.side === 'Blue' ? 100 : 200
  const parts  = snap.match?.info?.participants ?? []
  const ourIds = new Set(parts.filter(p => p.teamId === ourId).map(p => String(p.participantId)))
  let our = 0, their = 0
  for (const [id, pf] of Object.entries(frame5.participantFrames ?? {})) {
    if (ourIds.has(id)) our += pf.totalGold; else their += pf.totalGold
  }
  return our - their
}

// ── Section: Mortes Cedo ──────────────────────────────────────────────────────
function buildDeathSection(M) {
  const fbM  = M.filter(m => m.first_blood != null)
  const dthM = M.filter(m => m.team_deaths != null)

  const fbW  = fbM.filter(m => m.first_blood && m.win).length
  const fbN  = fbM.filter(m => m.first_blood).length
  const nfbW = fbM.filter(m => !m.first_blood && m.win).length
  const nfbN = fbM.filter(m => !m.first_blood).length

  const fbRate  = fbN  ? fbW  / fbN  : null
  const nfbRate = nfbN ? nfbW / nfbN : null

  const avgDW = mean(dthM.filter(m => m.win).map(m => m.team_deaths))
  const avgDL = mean(dthM.filter(m => !m.win).map(m => m.team_deaths))

  const rateCls = r => r == null ? 'text-slate-400' : r >= 0.6 ? 'text-green-400' : r >= 0.4 ? 'text-yellow-400' : 'text-red-400'

  document.getElementById('death-cards').innerHTML = [
    { label: 'First Blood → Win%', big: fbRate != null ? `${utils.pct(fbRate)}%` : '—',
      sub: `N=${fbN}`, cls: rateCls(fbRate) },
    { label: 'Sem First Blood → Win%', big: nfbRate != null ? `${utils.pct(nfbRate)}%` : '—',
      sub: `N=${nfbN}`, cls: rateCls(nfbRate) },
    { label: 'Mortes avg — Vitórias', big: avgDW != null ? avgDW.toFixed(1) : '—',
      sub: `N=${dthM.filter(m=>m.win).length}`, cls: avgDW != null && avgDL != null && avgDW < avgDL ? 'text-green-400' : 'text-yellow-400' },
    { label: 'Mortes avg — Derrotas', big: avgDL != null ? avgDL.toFixed(1) : '—',
      sub: `N=${dthM.filter(m=>!m.win).length}`, cls: 'text-red-400' },
  ].map(c => `
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div class="text-xs text-slate-400 mb-1">${c.label}</div>
      <div class="text-2xl font-bold ${c.cls}">${c.big}</div>
      ${c.sub ? `<div class="text-xs text-slate-500 mt-0.5">${c.sub}</div>` : ''}
    </div>`).join('')
}

// ── Section: Gold Flow ────────────────────────────────────────────────────────
function buildGoldSection(M) {
  const gdM  = M.filter(m => m.gd_10 != null)
  const wGD  = gdM.filter(m => m.win)
  const lGD  = gdM.filter(m => !m.win)

  // GD@5 from snapshot
  const gd5M = M.map(m => ({ ...m, gd5: computeGD5(m) })).filter(m => m.gd5 != null)
  const gd5W = gd5M.filter(m => m.win)
  const gd5L = gd5M.filter(m => !m.win)

  const mg5W = mean(gd5W.map(m => m.gd5))
  const mg5L = mean(gd5L.map(m => m.gd5))
  const mg10W = mean(wGD.map(m => m.gd_10))
  const mg10L = mean(lGD.map(m => m.gd_10))
  const mg20W = mean(wGD.map(m => m.gd_20))
  const mg20L = mean(lGD.map(m => m.gd_20))
  const mgfW  = mean(wGD.filter(m => m.gd_f != null).map(m => m.gd_f))
  const mgfL  = mean(lGD.filter(m => m.gd_f != null).map(m => m.gd_f))

  const fmtGD = v => v != null ? utils.fmtGold(Math.round(v)) : '—'
  const gdCls = v => v == null ? 'text-slate-400' : v >= 0 ? 'text-green-400' : 'text-red-400'

  document.getElementById('gd-cards').innerHTML = [
    { label: `GD@5 — Vitórias`,  big: fmtGD(mg5W),  sub: `N=${gd5W.length} c/ timeline`, cls: gdCls(mg5W) },
    { label: `GD@5 — Derrotas`,  big: fmtGD(mg5L),  sub: `N=${gd5L.length} c/ timeline`, cls: gdCls(mg5L) },
    { label: `GD@10 — Vitórias`, big: fmtGD(mg10W), sub: `N=${wGD.length}`, cls: gdCls(mg10W) },
    { label: `GD@10 — Derrotas`, big: fmtGD(mg10L), sub: `N=${lGD.length}`, cls: gdCls(mg10L) },
  ].map(c => `
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div class="text-xs text-slate-400 mb-1">${c.label}</div>
      <div class="text-2xl font-bold ${c.cls}">${c.big}</div>
      ${c.sub ? `<div class="text-xs text-slate-500 mt-0.5">${c.sub}</div>` : ''}
    </div>`).join('')

  if (!gdM.length) return

  Chart.getChart('c-gd-comparison')?.destroy()
  new Chart(document.getElementById('c-gd-comparison'), {
    type: 'bar',
    data: {
      labels: ['GD@5', 'GD@10', 'GD@20', 'GD@F'],
      datasets: [
        {
          label: 'Vitórias',
          data: [mg5W ?? 0, mg10W ?? 0, mg20W ?? 0, mgfW ?? 0],
          backgroundColor: 'rgba(74,222,128,0.75)',
          borderRadius: 4,
        },
        {
          label: 'Derrotas',
          data: [mg5L ?? 0, mg10L ?? 0, mg20L ?? 0, mgfL ?? 0],
          backgroundColor: 'rgba(248,113,113,0.75)',
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8' } },
        tooltip: { callbacks: { label: ctx => ` ${utils.fmtGold(Math.round(ctx.parsed.y))}` } },
      },
      scales: {
        y: {
          grid: { color: 'rgba(51,65,85,0.5)' },
          ticks: { callback: v => utils.fmtGold(v) },
        },
        x: { grid: { display: false } },
      },
    },
  })
}

// ── Section: Objetivos ────────────────────────────────────────────────────────
function buildObjectiveSection(M) {
  const parseObj = m => {
    if (!m.obj_flow) return null
    const parts = m.obj_flow.split('/').map(Number)
    return { t: parts[0]??0, v: parts[1]??0, g: parts[2]??0, d: parts[3]??0, b: parts[4]??0, i: parts[5]??0, n: parts[6]??0 }
  }

  const objM = M.map(m => ({ ...m, obj: parseObj(m) })).filter(m => m.obj != null)
  const oW   = objM.filter(m => m.win)
  const oL   = objM.filter(m => !m.win)

  // ── C1: Dragões ──
  const avgDragW = mean(oW.map(m => m.obj.d))
  const avgDragL = mean(oL.map(m => m.obj.d))

  const dragBuckets = { '0–1': {w:0,n:0}, '2': {w:0,n:0}, '3': {w:0,n:0}, '4+': {w:0,n:0} }
  for (const m of objM) {
    const d = m.obj.d
    const k = d <= 1 ? '0–1' : d === 2 ? '2' : d === 3 ? '3' : '4+'
    dragBuckets[k].n++; if (m.win) dragBuckets[k].w++
  }
  const soul3plus = objM.filter(m => m.obj.d >= 3)
  const soul3W    = soul3plus.filter(m => m.win).length

  const statCard = (label, big, sub, cls) => `
    <div class="bg-slate-800 rounded p-3 text-center">
      <div class="text-xs text-slate-400 mb-1">${label}</div>
      <div class="text-xl font-bold ${cls}">${big}</div>
      ${sub ? `<div class="text-xs text-slate-500 mt-0.5">${sub}</div>` : ''}
    </div>`

  const dragWR3 = soul3plus.length ? soul3W / soul3plus.length : null

  document.getElementById('obj-dragons').innerHTML = `
    <h3 class="text-sm font-semibold text-slate-200 mb-3">🐉 Dragões</h3>
    <div class="grid grid-cols-2 gap-2 mb-4">
      ${statCard('Drag médio — Vitórias', avgDragW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Drag médio — Derrotas', avgDragL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
      ${statCard('Win% com ≥3 Drags', dragWR3 != null ? `${utils.pct(dragWR3)}%` : '—', `N=${soul3plus.length}`, dragWR3==null?'text-slate-400':dragWR3>=0.6?'text-green-400':dragWR3>=0.4?'text-yellow-400':'text-red-400')}
      ${statCard('Win% com <3 Drags', objM.length-soul3plus.length ? `${utils.pct((objM.filter(m=>m.obj.d<3&&m.win).length)/(objM.length-soul3plus.length))}%` : '—', `N=${objM.length-soul3plus.length}`, 'text-slate-300')}
    </div>
    <table class="w-full text-xs text-slate-300">
      <thead><tr class="text-slate-500 border-b border-slate-700">
        <th class="text-left py-1">Dragões</th><th class="text-right py-1">Win%</th><th class="text-right py-1">N</th>
      </tr></thead>
      <tbody>
        ${['0–1','2','3','4+'].map(k => {
          const { w, n } = dragBuckets[k]
          const wr = n ? utils.pct(w/n) : null
          const cls = wr == null ? 'text-slate-500' : wr >= 60 ? 'text-green-400' : wr >= 40 ? 'text-yellow-400' : 'text-red-400'
          return `<tr class="border-b border-slate-800">
            <td class="py-1">${k}</td>
            <td class="text-right ${cls}">${wr != null ? wr+'%' : '—'}</td>
            <td class="text-right text-slate-500">${n}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`

  // ── C2: Estruturas Early ──
  const ftM  = M.filter(m => m.first_tower != null)
  const ftW  = ftM.filter(m => m.first_tower && m.win).length
  const ftN  = ftM.filter(m => m.first_tower).length
  const nftW = ftM.filter(m => !m.first_tower && m.win).length
  const nftN = ftM.filter(m => !m.first_tower).length
  const ftRate  = ftN  ? ftW  / ftN  : null
  const nftRate = nftN ? nftW / nftN : null

  const avgTW  = mean(oW.map(m => m.obj.t))
  const avgTL  = mean(oL.map(m => m.obj.t))
  const avgHW  = mean(oW.map(m => m.obj.g))
  const avgHL  = mean(oL.map(m => m.obj.g))

  const rateClass = r => r >= 0.6 ? 'text-green-400' : r >= 0.4 ? 'text-yellow-400' : 'text-red-400'

  document.getElementById('obj-structures').innerHTML = `
    <h3 class="text-sm font-semibold text-slate-200 mb-3">🏰 Estruturas Early (T1 + Herald)</h3>
    <div class="grid grid-cols-2 gap-2">
      ${statCard('First Tower → Win%', ftRate != null ? `${utils.pct(ftRate)}%` : '—', `N=${ftN}`, ftRate != null ? rateClass(ftRate) : 'text-slate-400')}
      ${statCard('Sem First Tower → Win%', nftRate != null ? `${utils.pct(nftRate)}%` : '—', `N=${nftN}`, nftRate != null ? rateClass(nftRate) : 'text-slate-400')}
      ${statCard('Torres avg — Vitórias', avgTW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Torres avg — Derrotas', avgTL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
      ${statCard('Herald avg — Vitórias', avgHW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Herald avg — Derrotas', avgHL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
    </div>`

  // ── C3: Objetivos Tardios ──
  const baronHave = objM.filter(m => m.obj.b > 0)
  const baronNone = objM.filter(m => m.obj.b === 0)
  const baronHaveWR = baronHave.length ? baronHave.filter(m => m.win).length / baronHave.length : null
  const baronNoneWR = baronNone.length ? baronNone.filter(m => m.win).length / baronNone.length : null

  const avgBW  = mean(oW.map(m => m.obj.b))
  const avgBL  = mean(oL.map(m => m.obj.b))
  const avgIW  = mean(oW.map(m => m.obj.i))
  const avgIL  = mean(oL.map(m => m.obj.i))

  document.getElementById('obj-late').innerHTML = `
    <h3 class="text-sm font-semibold text-slate-200 mb-3">👑 Objetivos Tardios (Barão + Inhib)</h3>
    <div class="grid grid-cols-2 gap-2">
      ${statCard('Win% com Barão', baronHaveWR != null ? `${utils.pct(baronHaveWR)}%` : '—', `N=${baronHave.length}`, baronHaveWR != null ? rateClass(baronHaveWR) : 'text-slate-400')}
      ${statCard('Win% sem Barão', baronNoneWR != null ? `${utils.pct(baronNoneWR)}%` : '—', `N=${baronNone.length}`, baronNoneWR != null ? rateClass(baronNoneWR) : 'text-slate-400')}
      ${statCard('Barão avg — Vitórias', avgBW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Barão avg — Derrotas', avgBL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
      ${statCard('Inhib avg — Vitórias', avgIW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Inhib avg — Derrotas', avgIL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
    </div>`
}

// ── Table: Desempenho por Jogador (Consolidated with Sortable Columns) ────────
let _playerRows = []
let _playerSort = { col: 'wr', dir: -1 }

// Compute identity rank for each player based on lens-specific score.
// Uses DB-driven coefficients and thresholds derived from loadRankConfig().
// If config is not loaded yet (or failed), rows get identRank = null.
// 
// KDA Penalty: If player's KDA < Iron benchmark, apply smooth multiplier:
//   multiplier = (playerKDA / ironKDA) ^ sqrt(kdaWeight / totalWeight)
// This prevents players with very low KDA from being carried to high ranks by other metrics.
function computeIdentityRanks(rows, lens) {
  const cfg = _rankConfig[lens]
  if (!cfg) return  // config not loaded or invalid lens

  const { thresholds, coefficients, metrics, kdaPenalty } = cfg

  rows.forEach((r) => {
    // Compute weighted score: Σ( cap(row[metric]) × coefficient )
    let rawScore = metrics.reduce((sum, m) => {
      let val = r[m.key]
      // Replace Infinity (zero-death players) with a large number, then cap
      if (val === Infinity) val = 1e9
      if (m.cap != null) val = Math.min(val, m.cap)
      return sum + val * (coefficients[m.key] ?? 0)
    }, 0)

    // Apply KDA penalty if player's KDA is below Iron benchmark
    if (kdaPenalty && r.kda < kdaPenalty.ironValue) {
      const multiplier = Math.pow(r.kda / kdaPenalty.ironValue, kdaPenalty.exponent)
      rawScore *= multiplier
    }

    // Find rank: highest threshold that rawScore meets or exceeds
    let rankIdx = 0
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (rawScore >= thresholds[i]) { rankIdx = i; break }
    }

    r.identRank = {
      score:  rawScore,
      label:  RANK_LABELS[rankIdx],
      name:   RANK_NAMES[rankIdx],
      imgUrl: `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/${RANK_NAMES[rankIdx]}.png`,
    }
  })
}

function sortPlayerTable(col) {
  _playerSort.dir = _playerSort.col === col ? _playerSort.dir * -1 : -1
  _playerSort.col = col
  renderPlayerTable()
}

function renderPlayerTable() {
    const { col, dir } = _playerSort
    const lens = LENS_DEFS[_playerLens]
    const dynamicCols = lens.cols
    const showUnmatched = _playerLens !== 'geral' && _playerRows.some(r => r.unmatched > 0)
   
   const sorted = [..._playerRows].sort((a, b) => {
     const aOk = a.n >= 10, bOk = b.n >= 10
     if (aOk !== bOk) return aOk ? -1 : 1
     
     // Special sorting for identRank (by score, not alphabetically)
     if (col === 'identRank') {
       return dir * ((a.identRank?.score ?? 0) - (b.identRank?.score ?? 0))
     }
     
     return dir * (a[col] - b[col])
   })
   
   const arrow  = c => c === col ? (dir === -1 ? ' ↓' : ' ↑') : ''
   const th     = (c, label, extra = '') =>
     `<th class="text-right py-2 cursor-pointer select-none hover:text-slate-300 ${extra}" onclick="sortPlayerTable('${c}')">${label}${arrow(c)}</th>`

   const validRows = sorted.filter(r => r.n >= 10)
   const anecdotalRows = sorted.filter(r => r.n < 10)

   // Build headers: fixed columns + [unmatched if applicable] + dynamic columns
   let headerHTML = `<th class="text-left py-2 cursor-pointer select-none hover:text-slate-300" onclick="sortPlayerTable('name')">Jogador${arrow('name')}</th>
         ${th('n',   'N')}
         ${th('wr',  'Win%')}
         ${th('kda', 'KDA')}`
   
   if (showUnmatched) {
     headerHTML += th('unmatched', 'Sem classe')
   }
   
   for (const colKey of dynamicCols) {
     const meta = COL_META[colKey]
     headerHTML += th(colKey, meta.label)
   }

   // Build row template function
   const buildRowHTML = (r, isAnecdotal = false) => {
     const wrCls = isAnecdotal ? 'text-slate-500' : (r.wr >= 0.7 ? 'text-purple-400' : r.wr >= 0.56 ? 'text-green-400' : r.wr >= 0.46 ? 'text-yellow-400' : 'text-red-400')
     const cellCls = isAnecdotal ? 'text-slate-600' : ''
     const nameCls = isAnecdotal ? 'text-slate-500' : ''
     
     let cellHTML = `<td class="py-2 font-medium ${nameCls}">${r.name}</td>
             <td class="text-right ${isAnecdotal ? 'text-slate-600' : 'text-slate-500'}">${r.n}</td>
             <td class="text-right ${wrCls}">${utils.pct(r.wr)}%</td>
             <td class="text-right ${cellCls}">${r.kda.toFixed(2)}</td>`
     
     if (showUnmatched) {
       cellHTML += `<td class="text-right text-xs ${cellCls} text-slate-500">${r.unmatched}</td>`
     }
     
      for (const colKey of dynamicCols) {
        const meta = COL_META[colKey]
        const val = r[colKey]
        
        // Special rendering for identRank
        if (colKey === 'identRank' && val) {
          const rankIdx = RANK_NAMES.indexOf(val.name)
          const colorCls = rankIdx >= 0 ? RANK_COLORS[rankIdx] : ''
           const formatted = `<div class="flex items-center justify-end gap-2"><img src="${val.imgUrl}" class="w-7 h-7" title="Score: ${val.score.toFixed(2)}"><span class="text-xs font-bold uppercase ${colorCls}">${val.label}</span></div>`
          cellHTML += `<td class="${cellCls}">${formatted}</td>`
        } else {
          const formatted = meta.fmt(val)
          cellHTML += `<td class="text-right ${cellCls}">${formatted}</td>`
        }
      }
     
     return cellHTML
   }

   let tableHTML = `
     <table class="w-full text-sm text-slate-300">
       <thead><tr class="text-xs text-slate-500 border-b border-slate-700">
         ${headerHTML}
       </tr></thead>
       <tbody>
         ${validRows.map(r => `<tr class="border-b border-slate-800">${buildRowHTML(r)}</tr>`).join('')}`

   if (anecdotalRows.length > 0) {
     const colCount = 4 + (showUnmatched ? 1 : 0) + dynamicCols.length
     tableHTML += `
         <tr class="border-b-2 border-slate-700 bg-slate-800/30">
           <td colspan="${colCount}" class="py-2 text-xs text-slate-500">Dados anedóticos (N &lt; 10)</td>
         </tr>
         ${anecdotalRows.map(r => `<tr class="border-b border-slate-800">${buildRowHTML(r, true)}</tr>`).join('')}`
   }

   tableHTML += `</tbody>
     </table>`

   document.getElementById('player-perf-table').innerHTML = tableHTML
}

function buildPlayerTable(M) {
  const riotM = M.filter(m => m.player_stats?.length)
  if (!riotM.length) {
    document.getElementById('player-perf-table').innerHTML =
      '<p class="text-xs text-slate-500">Sem partidas com dados Riot API.</p>'
    return
  }

  document.getElementById('player-perf-n').textContent = riotM.length

  // Build champion lookup: normalized key → champion entry (with class, damage_type)
  const champStore = Alpine.store('champions')
  const champByKey = {}
  for (const c of champStore.list) {
    champByKey[normChampKey(c.key)] = c
  }

  // Get filter function for current lens
  const lensFilter = LENS_DEFS[_playerLens].filter

  // First pass: count total, unclassified, and identity distribution per player
  const mapAll = {}
  for (const m of riotM) {
    for (const ps of m.player_stats) {
      if (!ps.name) continue
      const champKey = normChampKey(ps.champion)
      const champEntry = champByKey[champKey] ?? null
      const p = mapAll[ps.name] ??= { 
        nTotal: 0, nUnclassified: 0, 
        nCarry: 0, nAssassino: 0, nBruiser: 0, nTank: 0, nSuporte: 0 
      }
      p.nTotal++
      
      // Count identity distribution
      if (isCarry(champEntry)) p.nCarry++
      else if (champEntry?.class === 'Assassin') p.nAssassino++
      else if (isBruiser(champEntry)) p.nBruiser++
      else if (champEntry?.class === 'Tank') p.nTank++
      else if (champEntry?.class === 'Support') p.nSuporte++
      else p.nUnclassified++
    }
  }

  // Second pass: aggregate stats for matches that pass lens filter
  const map = {}
  for (const m of riotM) {
    for (const ps of m.player_stats) {
      if (!ps.name) continue
      
      // Resolve champion and check lens filter
      const champKey = normChampKey(ps.champion)
      const champEntry = champByKey[champKey] ?? null
      if (!lensFilter(champEntry)) continue

      const p = map[ps.name] ??= { 
        n: 0, wins: 0, kdaSum: 0, damSum: 0, goldSum: 0, csSum: 0, 
        durSum: 0, deathsSum: 0, fbKills: 0, killsSum: 0, assistsSum: 0,
        dtSum: 0, mitSum: 0, ccSum: 0, bldSum: 0, wkSum: 0, cwSum: 0,
        kpSum: 0, kpN: 0, visionSum: 0, wardsSum: 0, teamKillsSum: 0
      }
      p.n++
      if (m.win) p.wins++
      p.kdaSum      += ps.kda               ?? 0
      p.damSum      += ps.damage            ?? 0
      p.goldSum     += ps.gold              ?? 0
      p.csSum       += ps.cs                ?? 0
      p.deathsSum   += ps.deaths            ?? 0
      p.durSum      += m.duration           ?? 0
      p.teamKillsSum += m.team_kills        ?? 0
      p.killsSum    += ps.kills             ?? 0
      p.assistsSum += ps.assists           ?? 0
      p.dtSum      += ps.damageTaken       ?? 0
      p.mitSum     += ps.damageSelfMitigated ?? 0
      p.ccSum      += ps.timeCCingOthers   ?? 0
      p.bldSum     += ps.damageToBuildings ?? 0
      p.wkSum      += ps.wardsKilled       ?? 0
      p.cwSum      += ps.controlWardsPlaced ?? 0
      p.visionSum  += ps.visionScore       ?? 0
      p.wardsSum   += ps.wardsPlaced       ?? 0
      if (ps.killParticipation != null) { p.kpSum += ps.killParticipation; p.kpN++ }
      if (ps.firstBlood) p.fbKills++
    }
  }

  _playerRows = Object.entries(map)
    .map(([name, p]) => ({
      name,
      n:         p.n,
      nTotal:    mapAll[name]?.nTotal ?? p.n,
      unmatched: mapAll[name]?.nUnclassified ?? 0,
      wr:        p.wins / p.n,
      kda:       p.kdaSum / p.n,
      damPerMin: p.durSum ? p.damSum / p.durSum : 0,
      goldPerMin: p.durSum ? p.goldSum / p.durSum : 0,
      deathMin:  p.durSum ? p.deathsSum / p.durSum : 0,
      csPerMin:  p.durSum ? p.csSum / p.durSum : 0,
      fbKills:   p.fbKills,
      killsAvg:  p.n ? p.killsSum / p.n : 0,
      assistsAvg: p.n ? p.assistsSum / p.n : 0,
      dtMin:     p.durSum ? p.dtSum / p.durSum : 0,
      mitMin:    p.durSum ? p.mitSum / p.durSum : 0,
      ccMin:     p.durSum ? p.ccSum / p.durSum : 0,
      turrets:   p.n ? p.bldSum / p.n : 0,
      visionMin: p.durSum ? p.visionSum / p.durSum : 0,
      wardsMin:  p.durSum ? p.wardsSum / p.durSum : 0,
      wkAvg:     p.n ? p.wkSum / p.n : 0,
        killParticipation: p.kpN ? p.kpSum / p.kpN : 0,
       // Per-death metrics: sum / deathsSum (total / total deaths)
       damPerDeath:   p.deathsSum ? p.damSum   / p.deathsSum : Infinity,
       goldPerDeath:  p.deathsSum ? p.goldSum  / p.deathsSum : Infinity,
       killShare:     p.teamKillsSum ? p.killsSum / p.teamKillsSum : 0,
       killSecured:   (p.killsSum + p.assistsSum) > 0 ? p.killsSum / (p.killsSum + p.assistsSum) : 0,
       killsPerDeath:        p.deathsSum ? p.killsSum / p.deathsSum : Infinity,
       assistsPerDeath:      p.deathsSum ? p.assistsSum / p.deathsSum : Infinity,
       visionPerDeath:       p.deathsSum ? p.visionSum / p.deathsSum : Infinity,
       controlWardsPerDeath: p.deathsSum ? p.cwSum / p.deathsSum : Infinity,
       controlWardsAvg:      p.n ? p.cwSum / p.n : 0,
       wardsAndWKPerDeath:   p.deathsSum ? (p.wardsSum + p.wkSum * 10) / p.deathsSum : Infinity,
       // New per-min metrics
       killsMin:   p.durSum ? p.killsSum   / p.durSum : 0,
       assistsMin: p.durSum ? p.assistsSum / p.durSum : 0,
       // New per-death metrics (sum/deathsSum pattern)
       csPerDeath:   p.deathsSum ? p.csSum  / p.deathsSum : Infinity,
       mitPerDeath:  p.deathsSum ? p.mitSum / p.deathsSum : Infinity,
       dtPerDeath:   p.deathsSum ? p.dtSum  / p.deathsSum : Infinity,
       // New ratio metrics (dealt / taken — same time units cancel)
       damPerDmgRec: p.dtSum ? p.damSum / p.dtSum : 0,
       mitPerDmgRec: p.dtSum ? p.mitSum / p.dtSum : 0,
       // Identity counts (from Geral lens full data)
      nCarry:    mapAll[name]?.nCarry ?? 0,
      nAssassino: mapAll[name]?.nAssassino ?? 0,
      nBruiser:  mapAll[name]?.nBruiser ?? 0,
      nTank:     mapAll[name]?.nTank ?? 0,
      nSuporte:  mapAll[name]?.nSuporte ?? 0,
    }))

  // Compute identity ranks for active lens (if not Geral)
  if (_playerLens !== 'geral') {
    computeIdentityRanks(_playerRows, _playerLens)
  } else {
    // For Geral lens, set identRank to null (not displayed)
    _playerRows.forEach(r => { r.identRank = null })
  }

  renderPlayerTable()
}
// ── Table: Campeões ───────────────────────────────────────────────────────────
let _champRows = []
let _champSort = { col: 'wr', dir: -1 }

function sortChampTable(col) {
  _champSort.dir = _champSort.col === col ? _champSort.dir * -1 : -1
  _champSort.col = col
  renderChampTable()
}

function renderChampTable() {
  const { col, dir } = _champSort
  const sorted = [..._champRows].sort((a, b) => {
    const aOk = a.n >= 10, bOk = b.n >= 10
    if (aOk !== bOk) return aOk ? -1 : 1
    return dir * (a[col] - b[col])
  })
  const fmtK   = v => `${(v/1000).toFixed(1)}k`
  const arrow  = c => c === col ? (dir === -1 ? ' ↓' : ' ↑') : ''
  const th     = (c, label, extra = '') =>
    `<th class="text-right py-2 cursor-pointer select-none hover:text-slate-300 ${extra}" onclick="sortChampTable('${c}')">${label}${arrow(c)}</th>`

  document.getElementById('champion-table').innerHTML = `
    <table class="w-full text-sm text-slate-300">
      <thead><tr class="text-xs text-slate-500 border-b border-slate-700">
        <th class="py-2 w-8"></th>
        <th class="text-left py-2">Campeão</th>
        ${th('n',   'N')}
        ${th('wr',  'Win%')}
        ${th('kda', 'KDA')}
        ${th('dam', 'Dano')}
        ${th('cs',  'CS')}
      </tr></thead>
      <tbody>
        ${sorted.map(r => {
          const wrCls = r.n >= 10 ? (r.wr >= 0.7 ? 'text-purple-400' : r.wr >= 0.56 ? 'text-green-400' : r.wr >= 0.46 ? 'text-yellow-400' : 'text-red-400') : 'text-slate-400'
          const img = r.key ? `<img src="${champImgUrl(r.key)}" class="w-6 h-6 rounded" title="${r.name}">` : '<span class="text-slate-600 text-xs">?</span>'
          return `<tr class="border-b border-slate-800">
            <td class="py-1.5">${img}</td>
            <td class="py-1.5 font-medium">${r.name}</td>
            <td class="text-right text-slate-500">${r.n}</td>
            <td class="text-right ${wrCls}">${utils.pct(r.wr)}%</td>
            <td class="text-right">${r.kda.toFixed(2)}</td>
            <td class="text-right">${fmtK(r.dam)}</td>
            <td class="text-right">${Math.round(r.cs)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
}

function buildChampionTable(M) {
  const riotM = M.filter(m => m.player_stats?.length)
  const champStore = Alpine.store('champions')

  const map = {}
  for (const m of riotM) {
    for (const ps of m.player_stats) {
      if (!ps.champion) continue
      const c = map[ps.champion] ??= { wins:0, n:0, kdaSum:0, csSum:0, damSum:0 }
      c.n++
      if (m.win) c.wins++
      c.kdaSum  += ps.kda    ?? 0
      c.csSum   += ps.cs     ?? 0
      c.damSum  += ps.damage ?? 0
    }
  }

  _champRows = Object.entries(map)
    .filter(([, c]) => c.n >= 2)
    .map(([name, c]) => ({
      name,
      n:   c.n,
      wr:  c.wins / c.n,
      kda: c.kdaSum / c.n,
      cs:  c.csSum  / c.n,
      dam: c.damSum  / c.n,
      key: champStore.list.find(x => x.name === name)?.key ?? null,
    }))

  if (!_champRows.length) {
    document.getElementById('champion-table').innerHTML =
      '<p class="text-xs text-slate-500">Sem campeões com N≥2 ainda.</p>'
    return
  }

  renderChampTable()
}

function buildPlayerCharts(M) {
  const mvpGames       = M.filter(m => m.expand?.mvp)
  const formationGames = M.filter(m => m.expand?.formation)
  document.getElementById('mvp-n').textContent       = mvpGames.length
  document.getElementById('formation-n').textContent = formationGames.length

  const freq = {}
  for (const m of mvpGames) {
    const name = m.expand.mvp.name
    freq[name] = (freq[name] ?? 0) + 1
  }
  const sortedMvp = Object.entries(freq)
    .map(([p, n]) => ({ name: p, n, pct: Math.round(n/M.length*100) }))
    .sort((a,b) => b.n - a.n)
  
  Chart.getChart('c-mvp-freq')?.destroy()
  new Chart(document.getElementById('c-mvp-freq'), {
    type: 'bar',
    data: {
      labels:   sortedMvp.map(m => `${m.name}  (${m.n})`),
      datasets: [{
        data:            sortedMvp.map(m => m.pct),
        backgroundColor: 'rgba(234,179,8,0.75)',
        borderRadius: 4,
      }],
    },
    options: { ...baseOpts(false), plugins: { tooltip: { callbacks: {
      label: ctx => ` ${ctx.parsed.y}% de todas as partidas`,
    }}}},
  })

  winRateChart('c-mvp-wr',   utils.groupWR(mvpGames,       m => m.expand?.mvp?.name), true, 'mvp-wr')
  winRateChart('c-formation', utils.groupWR(formationGames, m => m.expand?.formation?.name), true, 'formation')

  const mvcFreq = {}
  for (const m of M) {
    const name = m.expand?.mvc?.name
    if (name) mvcFreq[name] = (mvcFreq[name] ?? 0) + 1
  }
  const sortedMvc = Object.entries(mvcFreq)
    .map(([name, n]) => ({ name, n }))
    .sort((a,b) => b.n - a.n)
    .slice(0, 12)
  
  Chart.getChart('c-mvc')?.destroy()
  new Chart(document.getElementById('c-mvc'), {
    type: 'bar',
    data: {
      labels:   sortedMvc.map(m => `${m.name}  (${m.n})`),
      datasets: [{
        data:            sortedMvc.map(m => m.n),
        backgroundColor: 'rgba(234,179,8,0.6)',
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { stepSize:1 }, grid: { color:'rgba(51,65,85,0.5)' } },
        y: { grid: { display:false } },
      },
      plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x}× como MVC` } } },
    },
  })
}

// ── Alpine component ──────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
   Alpine.data('statsPage', () => ({
    activeTab:       'team',
    playerLens:      'geral',
    formations:      [],
    filterFormation: '',
    allMatches:      [],
    _currentMatches: [],
    showAnecdotal: _showAnecdotal,
    lenses: [
      { key: 'geral',     label: 'Geral' },
      { key: 'carry',     label: 'Carry' },
      { key: 'assassino', label: 'Assassino' },
      { key: 'bruiser',   label: 'Bruiser' },
      { key: 'tank',      label: 'Tank' },
      { key: 'suporte',   label: 'Suporte' },
    ],

    async init() {
      const [, fData, data] = await Promise.all([
        Alpine.store('champions').load(),
        api.col('formations').list({ sort: '-active,name', perPage: 100 }),
        api.col('matches').list({ perPage: 500, expand: 'mvc,formation,mvp' }),
        loadRankConfig(),
      ])
      this.formations = fData.items
      this.allMatches = data.items
      this._currentMatches = data.items
      this._render(this.allMatches)

      this.$watch('filterFormation', () => this.filterAndRender())
      this.$watch('showAnecdotal', () => this.filterAndRender(), { deep: true })
      this.$watch('playerLens', (newLens) => {
        _playerLens = newLens
        _playerSort = { col: LENS_DEFS[newLens].defaultSort, dir: -1 }
        buildPlayerTable(this._currentMatches)
      })
    },

    filterAndRender() {
      const M = this.filterFormation
        ? this.allMatches.filter(m => m.formation === this.filterFormation)
        : this.allMatches
      this._currentMatches = M
      this._render(M)
    },

    _render(M) {
      buildTeamCharts(M)
      buildDeathSection(M)
      buildGoldSection(M)
      buildObjectiveSection(M)
      buildPlayerCharts(M)
      buildPlayerTable(M)
      buildChampionTable(M)
    },

    tab(which) { this.activeTab = which },
  }))
})
