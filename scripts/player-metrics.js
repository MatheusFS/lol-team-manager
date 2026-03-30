// ── Player Performance Metrics Module ──────────────────────────────────────
// Shared constants, identity classification, rank system, and player aggregation
// Used by: stats-page.js, coach-page.js
// Dependencies: shared.js, rank-derivation.js

// ── Rank System Constants ──────────────────────────────────────────────────
const RANK_NAMES  = ['iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger']
const RANK_LABELS = ['Iron','Bronze','Silver','Gold','Platinum','Emerald','Diamond','Master','Grandmaster','Challenger']
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
const RANK_ABBR = ['IR', 'BR', 'SL', 'GD', 'PT', 'EM', 'DI', 'MS', 'GM', 'CL']

// ── Rank Config State & Loading ────────────────────────────────────────────
let _rankConfig = {}  // Keyed by lens name. Each entry: { thresholds, coefficients, metrics, kdaPenalty }

async function loadRankConfig() {
  try {
    const data = await api.col('rank_config').list({ perPage: 20 })
    const records = data.items
    const globalRec = records.find(r => r.name === 'global')
    if (!globalRec) return
    const G = migrateBenchmarks(globalRec.config.benchmarks)

    for (const rec of records) {
      if (rec.name === 'global') continue
      _rankConfig[rec.name] = deriveScoreConfig(G, rec.config)
    }
  } catch (err) {
    console.error('[rank_config] Failed to load rank config from DB:', err)
  }
}

// ── Identity Classification Helpers ────────────────────────────────────────
const HIGH_DMG = new Set(['AD_high','AP_high','Mixed_high'])

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

// Dynamic identity derivation based on item stats
// Falls back to static classification if item stats missing
function deriveRole(ps, champEntry) {
  const bHP = ps?.bHP ?? 0
  // Fallback to static classification for old records without stats fields
  if (!bHP && !(ps?.bAD) && !(ps?.bAP)) {
    if (isCarry(champEntry))                   return 'Carry'
    if (champEntry?.class === 'Assassin')      return 'Assassino'
    if (isBruiser(champEntry))                 return 'Bruiser'
    if (champEntry?.class === 'Tank')          return 'Tank'
    if (champEntry?.class === 'Support')       return 'Suporte'
    return null
  }
  const offense = (ps.bAD ?? 0) * 35 + (ps.bAP ?? 0) * 20 + (ps.bAS ?? 0) * 250
  const defense = (ps.bHP ?? 0) * 3 + (ps.bArmor ?? 0) * 20 + (ps.bMR ?? 0) * 18
  const total   = offense + defense || 1
  const ratioOff = offense / total
  const ratioDef = defense / total
  const cls = champEntry?.class
  if (cls === 'Assassin') return 'Assassino'
  if (cls === 'Support')  return 'Suporte'
  if (cls === 'Tank')     return ratioDef >= 0.6 ? 'Tank' : 'Bruiser'
  if (cls === 'Marksman') return ratioOff >= 0.6 ? 'Carry' : null
  if (cls === 'Mage')     return ratioOff >= 0.6 ? 'Carry' : null
  if (cls === 'Fighter') {
    if (ratioOff >= 0.65) return 'Carry'
    if (ratioDef >= 0.65) return 'Tank'
    return 'Bruiser'
  }
  return null
}

function hasNoLens(champEntry) {
  if (!champEntry) return true
  return !isCarry(champEntry) && !isBruiser(champEntry)
    && champEntry.class !== 'Assassin' && champEntry.class !== 'Tank' && champEntry.class !== 'Support'
}

// ── Lens Definitions ───────────────────────────────────────────────────────
const LENS_DEFS = {
  geral:     { defaultSort: 'wr',        filter: () => true,                                  cols: ['deathMin','killParticipation','controlWardsAvg','nCarry','nAssassino','nBruiser','nTank','nSuporte'] },
  carry:     { defaultSort: 'identRank', filter: (c, ps) => deriveRole(ps, c) === 'Carry',     cols: ['damPerMin','damPerDeath','goldPerMin','goldPerDeath','csPerMin','csPerDeath','killParticipation','identRank'] },
  assassino: { defaultSort: 'identRank', filter: (c, ps) => deriveRole(ps, c) === 'Assassino', cols: ['damPerMin','damPerDeath','goldPerMin','goldPerDeath','identRank'] },
  bruiser:   { defaultSort: 'identRank', filter: (c, ps) => deriveRole(ps, c) === 'Bruiser',   cols: ['damPerDmgRec','damPerDeath','goldPerDeath','identRank'] },
  tank:      { defaultSort: 'identRank', filter: (c, ps) => deriveRole(ps, c) === 'Tank',      cols: ['mitPerDmgRec','mitPerMin','mitPerDeath','dtPerDeath','ccMin','identRank'] },
  suporte:   { defaultSort: 'identRank', filter: (c, ps) => deriveRole(ps, c) === 'Suporte',   cols: ['assistsMin','assistsPerDeath','visionMin','visionPerDeath','controlWardsAvg','wardsMin','wardsAndWKPerDeath','identRank'] },
}

// ── Metric Metadata ───────────────────────────────────────────────────────
const COL_META = {
  damPerMin:    { label: 'Dano/min',     fmt: v => v.toFixed(0)                         },
  goldPerMin:   { label: 'Ouro/min',     fmt: v => v.toFixed(0)                         },
  deathMin:     { label: 'Mortes/min',   fmt: v => v.toFixed(3)                         },
  csPerMin:     { label: 'CS/min',       fmt: v => v.toFixed(1)                         },
  fbKills:      { label: 'FB Kills',     fmt: v => v                                    },
  killsAvg:     { label: 'Kills',        fmt: v => v.toFixed(1)                         },
  dtMin:        { label: 'DmgRec/min',   fmt: v => v.toFixed(0)                         },
  mitMin:       { label: 'Mitigado/min', fmt: v => v.toFixed(0)                         },
  mitPerMin:    { label: 'Mit/min',      fmt: v => v.toFixed(0)                         },
  turrets:      { label: 'Turrets',      fmt: v => v.toFixed(1)                         },
  ccMin:        { label: 'CC/min',       fmt: v => v.toFixed(2)                         },
  killParticipation: { label: 'Kill Part%',   fmt: v => v != null ? `${Math.round(v*100)}%` : '—' },
  assistsAvg:   { label: 'Assists',      fmt: v => v.toFixed(1)                         },
  visionMin:    { label: 'Visão/min',    fmt: v => v.toFixed(2)                         },
  wardsMin:     { label: 'Wards/min',    fmt: v => v.toFixed(2)                         },
  wkAvg:        { label: 'WardKills',    fmt: v => v.toFixed(1)                         },
  // Per-death metrics
  damPerDeath:  { label: 'Dano/Morte',   fmt: v => v === Infinity ? '∞' : v.toFixed(0) },
  goldPerDeath: { label: 'Ouro/Morte',   fmt: v => v === Infinity ? '∞' : v.toFixed(0) },
  killShare:    { label: 'Kill Part.',   fmt: v => `${(v * 100).toFixed(1)}%`           },
  killSecured:  { label: 'Kill Secured', fmt: v => `${(v * 100).toFixed(1)}%`           },
  killsPerDeath: { label: 'Kills/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  assistsPerDeath: { label: 'Assists/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  visionPerDeath: { label: 'Visão/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  controlWardsPerDeath: { label: 'CW/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  controlWardsAvg: { label: 'Control Wards', fmt: v => v.toFixed(2)                  },
  wardsAndWKPerDeath: { label: 'Wards/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(2) },
  killsMin:     { label: 'Kills/min',    fmt: v => v.toFixed(2) },
  assistsMin:   { label: 'Assist/min',   fmt: v => v.toFixed(2) },
  csPerDeath:   { label: 'CS/Morte',     fmt: v => v === Infinity ? '∞' : v.toFixed(1) },
  mitPerDeath:  { label: 'Mitigado/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(0) },
  dtPerDeath:   { label: 'DmgRec/Morte', fmt: v => v === Infinity ? '∞' : v.toFixed(0) },
  damPerDmgRec: { label: 'Dano/DmgRec',  fmt: v => v.toFixed(3) },
  mitPerDmgRec: { label: 'Mit/DmgRec',   fmt: v => v.toFixed(3) },
  // Identity counts
  nCarry:       { label: 'Carry',        fmt: v => v                                    },
  nAssassino:   { label: 'Assassino',    fmt: v => v                                    },
  nBruiser:     { label: 'Bruiser',      fmt: v => v                                    },
  nTank:        { label: 'Tank',         fmt: v => v                                    },
  nSuporte:     { label: 'Suporte',      fmt: v => v                                    },
  // Identity rank
  identRank:    { label: 'Rank',         fmt: v => v ? `${v.label}` : '—' },
}

const IDENTITY_COL_TO_LENS = {
  nCarry: 'carry',
  nAssassino: 'assassino',
  nBruiser: 'bruiser',
  nTank: 'tank',
  nSuporte: 'suporte'
}

// ── Identity Rank Computation ──────────────────────────────────────────────
// Computes identity ranks for a list of player rows using loaded rank config
function computeIdentityRanks(rows, lens) {
  const cfg = _rankConfig[lens]
  if (!cfg) return

  const { thresholds, coefficients, metrics, kdaPenalty } = cfg

  rows.forEach((r) => {
    let rawScore = metrics.reduce((sum, m) => {
      let val = r[m.key]
      if (val === Infinity) val = 1e9
      if (m.cap != null) val = Math.min(val, m.cap)
      return sum + val * (coefficients[m.key] ?? 0)
    }, 0)

    if (kdaPenalty && r.kda < kdaPenalty.ironValue) {
      const multiplier = Math.pow(r.kda / kdaPenalty.ironValue, kdaPenalty.exponent)
      rawScore *= multiplier
    }

    let rankIdx = 0
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (rawScore >= thresholds[i]) { rankIdx = i; break }
    }

    r.identRank = {
      score:   rawScore,
      rankIdx: rankIdx,
      label:   RANK_LABELS[rankIdx],
      name:    RANK_NAMES[rankIdx],
      imgUrl:  `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/${RANK_NAMES[rankIdx]}.png`,
    }
  })
}

// ── Player Stats Aggregation ───────────────────────────────────────────────
// Aggregates per-player statistics from a list of matches, filtered by lens
// Returns array of aggregated row objects with all computed metrics
function aggregateRows(riotM, champByKey, lensFilter, mapAll) {
  const map = {}
  const unclassifiedByPlayer = {}

  for (const m of riotM) {
    for (const ps of m.player_stats) {
      if (!ps.name) continue

      const champKey = normChampKey(ps.champion)
      const champEntry = champByKey[champKey] ?? null
      if (!lensFilter(champEntry, ps)) continue

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
      p.assistsSum  += ps.assists           ?? 0
      p.dtSum       += ps.damageTaken       ?? 0
      p.mitSum      += ps.damageSelfMitigated ?? 0
      p.ccSum       += ps.timeCCingOthers   ?? 0
      p.bldSum      += ps.damageToBuildings ?? 0
      p.wkSum       += ps.wardsKilled       ?? 0
      p.cwSum       += ps.controlWardsPlaced ?? 0
      p.visionSum   += ps.visionScore       ?? 0
      p.wardsSum    += ps.wardsPlaced       ?? 0
      if (ps.killParticipation != null) { p.kpSum += ps.killParticipation; p.kpN++ }
      if (ps.firstBlood) p.fbKills++

      const role = deriveRole(ps, champEntry)
      if (!role) {
        unclassifiedByPlayer[ps.name] = (unclassifiedByPlayer[ps.name] ?? 0) + 1
      }
    }
  }

  return Object.entries(map)
    .map(([name, p]) => ({
      name,
      n:         p.n,
      nTotal:    mapAll[name]?.nTotal ?? p.n,
      unmatched: unclassifiedByPlayer[name] ?? 0,
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
      mitPerMin: p.durSum ? p.mitSum / p.durSum : 0,
      ccMin:     p.durSum ? p.ccSum / p.durSum : 0,
      turrets:   p.n ? p.bldSum / p.n : 0,
      visionMin: p.durSum ? p.visionSum / p.durSum : 0,
      wardsMin:  p.durSum ? p.wardsSum / p.durSum : 0,
      wkAvg:     p.n ? p.wkSum / p.n : 0,
      killParticipation: p.kpN ? p.kpSum / p.kpN : 0,
      damPerDeath:   p.deathsSum ? p.damSum / p.deathsSum : Infinity,
      goldPerDeath:  p.deathsSum ? p.goldSum / p.deathsSum : Infinity,
      killShare:     p.teamKillsSum ? p.killsSum / p.teamKillsSum : 0,
      killSecured:   (p.killsSum + p.assistsSum) > 0 ? p.killsSum / (p.killsSum + p.assistsSum) : 0,
      killsPerDeath:        p.deathsSum ? p.killsSum / p.deathsSum : Infinity,
      assistsPerDeath:      p.deathsSum ? p.assistsSum / p.deathsSum : Infinity,
      visionPerDeath:       p.deathsSum ? p.visionSum / p.deathsSum : Infinity,
      controlWardsPerDeath: p.deathsSum ? p.cwSum / p.deathsSum : Infinity,
      controlWardsAvg:      p.n ? p.cwSum / p.n : 0,
      wardsAndWKPerDeath:   p.deathsSum ? (p.wardsSum + p.wkSum * 10) / p.deathsSum : Infinity,
      killsMin:   p.durSum ? p.killsSum / p.durSum : 0,
      assistsMin: p.durSum ? p.assistsSum / p.durSum : 0,
      csPerDeath:   p.deathsSum ? p.csSum / p.deathsSum : Infinity,
      mitPerDeath:  p.deathsSum ? p.mitSum / p.deathsSum : Infinity,
      dtPerDeath:   p.deathsSum ? p.dtSum / p.deathsSum : Infinity,
      damPerDmgRec: p.dtSum ? p.damSum / p.dtSum : 0,
      mitPerDmgRec: p.dtSum ? p.mitSum / p.dtSum : 0,
      nCarry:    mapAll[name]?.nCarry ?? 0,
      nAssassino: mapAll[name]?.nAssassino ?? 0,
      nBruiser:  mapAll[name]?.nBruiser ?? 0,
      nTank:     mapAll[name]?.nTank ?? 0,
      nSuporte:  mapAll[name]?.nSuporte ?? 0,
    }))
}
