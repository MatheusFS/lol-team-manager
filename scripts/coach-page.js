// ── Coach Page Component ───────────────────────────────────────────────────
// One-page player performance report with automatic strength/weakness analysis
// Dependencies: shared.js, rank-derivation.js, player-metrics.js

// ── Metric Relevance by Lens ───────────────────────────────────────────────
// Which metrics are evaluated for each identity lens
const COACH_METRICS_BY_LENS = {
  geral: [
    'kda', 'deathMin', 'killParticipation', 'controlWardsAvg', 'wr'
  ],
  carry: [
    'damPerMin', 'damPerDeath', 'goldPerMin', 'goldPerDeath', 
    'csPerMin', 'csPerDeath', 'killParticipation'
  ],
  assassino: [
    'damPerMin', 'damPerDeath', 'goldPerMin', 'goldPerDeath'
  ],
  bruiser: [
    'damPerDmgRec', 'damPerDeath', 'goldPerDeath'
  ],
  tank: [
    'mitPerDmgRec', 'mitPerMin', 'mitPerDeath', 'dtPerDeath', 'ccMin'
  ],
  suporte: [
    'assistsMin', 'assistsPerDeath', 'visionMin', 'visionPerDeath', 
    'controlWardsAvg', 'wardsMin', 'wardsAndWKPerDeath'
  ]
}

// ── Metrics where lower values are better ──────────────────────────────────
const LOWER_IS_BETTER = new Set(['deathMin'])

// ── For Geral lens: which lens config has benchmarks for each metric ─────────
const GERAL_BENCHMARK_SOURCE = {
  kda:               'carry',
  killParticipation: 'carry',
  controlWardsAvg:   'suporte',
  // deathMin and wr have no benchmarks → team-relative fallback
}

// ── Evaluation Helper ──────────────────────────────────────────────────────
// Compares player metric against benchmarks (primary) and team average (secondary)
// Returns: { isStrength, isWeakness, rankIdx, rankLabel, rankImgUrl, teamRank, teamSize, delta, comparison, severity }
function evaluateMetric(playerValue, teamRows, metricKey, benchmarks, lens) {
  if (playerValue == null || isNaN(playerValue)) return null

  const lowerIsBetter = LOWER_IS_BETTER.has(metricKey)
  
  // Handle infinite values (no deaths → infinite damage per death)
  if (!isFinite(playerValue)) {
    return {
      isStrength: true,
      isWeakness: false,
      rankIdx: 9,
      rankLabel: 'Challenger',
      rankImgUrl: `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/challenger.png`,
      teamRank: 1,
      teamSize: teamRows.length,
      delta: null,
      comparison: 'Perfeição (sem mortes nessa métrica)',
      severity: 'high'
    }
  }

  // ── Calculate effective value (inverted if lower-is-better) ─────────────
  const effectiveValue = lowerIsBetter ? -playerValue : playerValue

  // ── Team statistics ───────────────────────────────────────────────────
  const validTeamValues = teamRows
    .map(r => r[metricKey])
    .filter(v => v != null && isFinite(v))
  
  let teamAvg = 0
  let delta = 0
  let teamRank = teamRows.length
  let teamSize = validTeamValues.length

  if (validTeamValues.length > 0) {
    teamAvg = validTeamValues.reduce((a, b) => a + b, 0) / validTeamValues.length
    const effectiveTeamAvg = lowerIsBetter ? -teamAvg : teamAvg
    
    if (effectiveTeamAvg !== 0) {
      delta = ((effectiveValue - effectiveTeamAvg) / Math.abs(effectiveTeamAvg)) * 100
    }
    
    // Compute team rank (1 = best)
    const sortedByEffectiveDesc = teamRows
      .slice()
      .sort((a, b) => {
        const aVal = a[metricKey]
        const bVal = b[metricKey]
        const aEff = aVal != null && isFinite(aVal) ? (lowerIsBetter ? -aVal : aVal) : -Infinity
        const bEff = bVal != null && isFinite(bVal) ? (lowerIsBetter ? -bVal : bVal) : -Infinity
        return bEff - aEff
      })
    
    for (let i = 0; i < sortedByEffectiveDesc.length; i++) {
      if (sortedByEffectiveDesc[i][metricKey] === playerValue) {
        teamRank = i + 1
        break
      }
    }
  }

  // ── Determine strength/weakness based on global benchmarks (primary) ──
  let rankIdx = 0
  let rankLabel = 'Iron'
  let rankImgUrl = ''
  let isStrength = false
  let isWeakness = false

  if (benchmarks && benchmarks.length > 0) {
    // Find rank tier from benchmarks
    for (let i = benchmarks.length - 1; i >= 0; i--) {
      const benchVal = benchmarks[i]
      if (lowerIsBetter ? (effectiveValue >= -benchVal) : (effectiveValue >= benchVal)) {
        rankIdx = i
        break
      }
    }
    
    rankLabel = RANK_LABELS[rankIdx]
    rankImgUrl = `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/${RANK_NAMES[rankIdx]}.png`
    
    // Strength = Gold+ (rankIdx >= 3), Weakness = Bronze or below (rankIdx <= 1)
    isStrength = rankIdx >= 3
    isWeakness = rankIdx <= 1
  } else {
    // Fallback: team-relative threshold (deathMin, wr)
    const threshold = 15
    isStrength = delta > threshold
    isWeakness = delta < -threshold
  }

  // ── Build comparison text ──────────────────────────────────────────────
  let comparison = ''
  const deltaAbs = Math.abs(Math.round(delta))
  
  if (validTeamValues.length === 0) {
    comparison = 'Sem dados da equipe para comparar'
  } else if (deltaAbs === 0) {
    comparison = 'Alinhado com a média do time'
  } else if (delta > 0) {
    comparison = `${deltaAbs}% acima da média do time (${teamAvg.toFixed(1)})`
  } else {
    comparison = `${deltaAbs}% abaixo da média do time (${teamAvg.toFixed(1)})`
  }

  const severity = Math.abs(delta) > 25 ? 'high' : 'medium'

  return { 
    isStrength, isWeakness, severity, comparison,
    rankIdx, rankLabel, rankImgUrl,
    teamRank, teamSize, delta
  }
}

// ── Alpine Component ───────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('coachPage', () => ({
    players: [],
    selectedPlayerId: null,
    lens: 'geral',
    
    allMatches: [],
    allPlayers: [],
    allChampions: {},  // key → champion entry
    
    playerMetrics: null,
    teamMetrics: [],
    overviewCards: [],
    strengths: [],
    weaknesses: [],
    bestIdentity: null,
    
    loading: true,
    error: null,

    lenses: [
      { key: 'geral', label: 'Geral' },
      { key: 'carry', label: 'Carry' },
      { key: 'assassino', label: 'Assassino' },
      { key: 'bruiser', label: 'Bruiser' },
      { key: 'tank', label: 'Tank' },
      { key: 'suporte', label: 'Suporte' },
    ],

    async init() {
      try {
        // Load all data in parallel
        await Promise.all([
          Alpine.store('champions').load(),
          loadRankConfig(),
        ])

        const [playersData, matchesData] = await Promise.all([
          api.col('players').list({ perPage: 100 }),
          api.col('matches').list({ perPage: 500, expand: 'mvc,formation,mvp' }),
        ])

        this.allMatches = matchesData.items
        this.allPlayers = playersData.items

        // Build champion lookup
        const champStore = Alpine.store('champions')
        for (const c of champStore.list) {
          this.allChampions[normChampKey(c.key)] = c
        }

        // Filter players that have at least one match with player_stats
        const playerNamesInMatches = new Set()
        for (const m of this.allMatches) {
          if (m.player_stats?.length) {
            for (const ps of m.player_stats) {
              if (ps.name) playerNamesInMatches.add(ps.name)
            }
          }
        }

        this.players = this.allPlayers
          .filter(p => playerNamesInMatches.has(p.name))
          .sort((a, b) => a.name.localeCompare(b.name))

        // Select first player by default
        if (this.players.length > 0) {
          this.selectedPlayerId = this.players[0].id
          this._evaluatePlayer()
        }

        this.loading = false

        // Watch for changes
        this.$watch('selectedPlayerId', () => this._evaluatePlayer())
        this.$watch('lens', () => this._evaluatePlayer())
      } catch (err) {
        console.error('[coach] Init failed:', err)
        this.error = 'Falha ao carregar dados. Tente novamente.'
        this.loading = false
      }
    },

    _evaluatePlayer() {
      if (!this.selectedPlayerId) return

      const selectedPlayer = this.allPlayers.find(p => p.id === this.selectedPlayerId)
      if (!selectedPlayer) return

      const playerName = selectedPlayer.name
      const riotMatches = this.allMatches.filter(m => m.player_stats?.length)

      // ── 1. Build mapAll: counts of each identity ──
      const mapAll = {}
      for (const m of riotMatches) {
        for (const ps of m.player_stats) {
          if (!ps.name) continue
          const champKey = normChampKey(ps.champion)
          const champEntry = this.allChampions[champKey] ?? null
          const p = mapAll[ps.name] ??= {
            nTotal: 0, nCarry: 0, nAssassino: 0, nBruiser: 0, nTank: 0, nSuporte: 0
          }
          p.nTotal++
          if (isCarry(champEntry)) p.nCarry++
          else if (champEntry?.class === 'Assassin') p.nAssassino++
          else if (isBruiser(champEntry)) p.nBruiser++
          else if (champEntry?.class === 'Tank') p.nTank++
          else if (champEntry?.class === 'Support') p.nSuporte++
        }
      }

      // ── 2. Handle best identity for Geral lens ──
      this.bestIdentity = null
      if (this.lens === 'geral') {
        // Compute identity rank for all 5 identities, pick the best score
        let bestScore = -Infinity
        for (const identLens of ['carry', 'assassino', 'bruiser', 'tank', 'suporte']) {
          const lensFilter = LENS_DEFS[identLens].filter
          const rows = aggregateRows(riotMatches, this.allChampions, lensFilter, mapAll)
          computeIdentityRanks(rows, identLens)
          const playerRow = rows.find(r => r.name === playerName)
          
          if (playerRow?.identRank?.score > bestScore) {
            bestScore = playerRow.identRank.score
            this.bestIdentity = {
              key: identLens,
              label: this.lenses.find(l => l.key === identLens)?.label,
              identRank: playerRow.identRank
            }
          }
        }
      }

      // ── 3. Aggregate all player metrics by current lens ──
      const lensFilter = LENS_DEFS[this.lens].filter
      const allRows = aggregateRows(riotMatches, this.allChampions, lensFilter, mapAll)
      computeIdentityRanks(allRows, this.lens)

      // Find selected player in aggregated rows
      this.playerMetrics = allRows.find(r => r.name === playerName)
      if (!this.playerMetrics) {
        this.playerMetrics = { name: playerName, n: 0 }
      }

      // ── 4. Calculate team metrics (3+ games) ──
      this.teamMetrics = allRows.filter(r => r.n >= 3)

      // ── 5. Build overview cards ──
      let rankLabel = 'N/A'
      let rankImg = ''
      let rankScore = 'N/A'
      
      if (this.lens === 'geral' && this.bestIdentity?.identRank) {
        rankLabel = this.bestIdentity.identRank.label
        rankImg = this.bestIdentity.identRank.imgUrl
        rankScore = `${this.bestIdentity.identRank.score.toFixed(1)} pts`
      } else if (this.playerMetrics.identRank) {
        rankLabel = this.playerMetrics.identRank.label
        rankImg = this.playerMetrics.identRank.imgUrl
        rankScore = `${this.playerMetrics.identRank.score.toFixed(1)} pts`
      }

      this.overviewCards = [
        {
          label: 'Win Rate',
          value: `${(this.playerMetrics.wr * 100).toFixed(0)}%`,
          sub: `${this.playerMetrics.n} partidas`,
          color: this.playerMetrics.wr >= 0.6 ? 'text-green-400' : 'text-yellow-400'
        },
        {
          label: 'KDA',
          value: this.playerMetrics.kda?.toFixed(2) ?? '—',
          sub: `média`,
          color: this.playerMetrics.kda >= 2.5 ? 'text-green-400' : 'text-slate-300'
        },
        {
          label: this.lens === 'geral' ? 'Rank (Melhor)' : 'Rank (Identidade)',
          value: rankLabel,
          sub: rankScore,
          color: rankLabel !== 'N/A' ? RANK_COLORS[RANK_NAMES.indexOf(rankLabel.toLowerCase())] : 'text-slate-400',
          imgUrl: rankImg
        }
      ]

      // ── 6. Evaluate strengths and weaknesses ──
      this.strengths = []
      this.weaknesses = []

      const metricsToEval = COACH_METRICS_BY_LENS[this.lens] || []

      for (const metricKey of metricsToEval) {
        const playerVal = this.playerMetrics[metricKey]
        if (playerVal == null) continue

        // Get benchmarks
        let benchmarks = null
        if (this.lens === 'geral') {
          // For Geral, use fallback lens config if available
          const fallbackLens = GERAL_BENCHMARK_SOURCE[metricKey]
          const cfg = fallbackLens ? _rankConfig[fallbackLens] : null
          benchmarks = cfg?.rawBenchmarks?.[metricKey] ?? null
        } else {
          // For specific lenses, use that lens's config
          const cfg = _rankConfig[this.lens]
          benchmarks = cfg?.rawBenchmarks?.[metricKey] ?? null
        }

        // Evaluate against team and benchmarks
        const evalResult = evaluateMetric(playerVal, this.teamMetrics, metricKey, benchmarks, this.lens)
        if (!evalResult) continue

        const meta = COL_META[metricKey]
        if (!meta) continue

        const point = {
          metric: metricKey,
          label: meta.label,
          value: playerVal,
          formatted: meta.fmt(playerVal),
          comparison: evalResult.comparison,
          delta: evalResult.delta,
          severity: evalResult.severity,
          rankIdx: evalResult.rankIdx,
          rankLabel: evalResult.rankLabel,
          rankImgUrl: evalResult.rankImgUrl,
          teamRank: evalResult.teamRank,
          teamSize: evalResult.teamSize
        }

        if (evalResult.isStrength) {
          this.strengths.push(point)
        } else if (evalResult.isWeakness) {
          this.weaknesses.push(point)
        }
      }

      // Sort by rankIdx (descending for strengths, ascending for weaknesses)
      this.strengths.sort((a, b) => {
        // Primary: rankIdx desc (higher rank = better)
        if (b.rankIdx !== a.rankIdx) return b.rankIdx - a.rankIdx
        // Secondary: delta desc (more above team average)
        return (b.delta ?? 0) - (a.delta ?? 0)
      })
      
      this.weaknesses.sort((a, b) => {
        // Primary: rankIdx asc (lower rank = worse)
        if (a.rankIdx !== b.rankIdx) return a.rankIdx - b.rankIdx
        // Secondary: delta asc (more below team average)
        return (a.delta ?? 0) - (b.delta ?? 0)
      })
    }
  }))
})
