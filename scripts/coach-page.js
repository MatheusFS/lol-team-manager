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

// ── Evaluation Helper ──────────────────────────────────────────────────────
// Compares player metric against team average and benchmark
// Returns: { delta %, isStrength, isWeakness, severity, comparison }
function evaluateMetric(playerValue, teamAvg, metricKey, benchmarks) {
  if (playerValue == null || isNaN(playerValue)) return null
  if (teamAvg == null || isNaN(teamAvg)) return null

  // Skip infinite values (handle separately as "perfect")
  if (!isFinite(playerValue)) {
    return {
      delta: null,
      isStrength: true,
      isWeakness: false,
      severity: 'high',
      comparison: 'Perfeição (sem mortes nessa métrica)'
    }
  }

  // Calculate delta vs team average
  let delta = 0
  if (teamAvg !== 0) {
    delta = ((playerValue - teamAvg) / Math.abs(teamAvg)) * 100
  }

  // Determine strength/weakness based on threshold (±15% from team avg)
  const threshold = 15  // 15% deviation from team average
  const isStrength = delta > threshold
  const isWeakness = delta < -threshold

  // Build comparison text
  let comparison = ''
  const direction = delta > 0 ? '↑' : '↓'
  const deltaAbs = Math.abs(Math.round(delta))
  
  if (deltaAbs === 0) {
    comparison = 'Alinhado com a média do time'
  } else if (delta > 0) {
    comparison = `${deltaAbs}% acima da média do time (${teamAvg.toFixed(1)})`
  } else {
    comparison = `${deltaAbs}% abaixo da média do time (${teamAvg.toFixed(1)})`
  }

  // Add benchmark context if available
  if (benchmarks && benchmarks.length > 0) {
    let rankName = '?'
    for (let i = benchmarks.length - 1; i >= 0; i--) {
      if (playerValue >= benchmarks[i]) {
        rankName = RANK_NAMES[i]
        break
      }
    }
    comparison += ` · Nível ${rankName}`
  }

  const severity = Math.abs(delta) > 25 ? 'high' : 'medium'

  return { delta, isStrength, isWeakness, severity, comparison }
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

      // ── 1. Aggregate all player metrics by lens ──
      const lensFilter = LENS_DEFS[this.lens].filter

      // Build mapAll: counts of each identity
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

      // Aggregate rows for current lens
      const allRows = aggregateRows(riotMatches, this.allChampions, lensFilter, mapAll)

      // Compute identity rank for current lens
      computeIdentityRanks(allRows, this.lens)

      // Find selected player in aggregated rows
      this.playerMetrics = allRows.find(r => r.name === playerName)
      if (!this.playerMetrics) {
        this.playerMetrics = { name: playerName, n: 0 }
      }

      // ── 2. Calculate team averages ──
      this.teamMetrics = allRows.filter(r => r.n >= 3)  // only players with 3+ games

      // ── 3. Build overview cards ──
      const rankLabel = this.playerMetrics.identRank?.label ?? 'N/A'
      const rankImg = this.playerMetrics.identRank?.imgUrl ?? ''

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
          label: 'Rank',
          value: rankLabel,
          sub: this.playerMetrics.identRank ? `${this.playerMetrics.identRank.score.toFixed(1)} pts` : 'N/A',
          color: this.playerMetrics.identRank ? RANK_COLORS[RANK_NAMES.indexOf(this.playerMetrics.identRank.name)] : 'text-slate-400',
          imgUrl: rankImg
        }
      ]

      // ── 4. Evaluate strengths and weaknesses ──
      this.strengths = []
      this.weaknesses = []

      const metricsToEval = COACH_METRICS_BY_LENS[this.lens] || []

      for (const metricKey of metricsToEval) {
        const playerVal = this.playerMetrics[metricKey]
        if (playerVal == null) continue

        // Calculate team average
        const validTeamValues = this.teamMetrics
          .map(r => r[metricKey])
          .filter(v => v != null && isFinite(v))
        
        if (validTeamValues.length === 0) continue

        const teamAvg = validTeamValues.reduce((a, b) => a + b, 0) / validTeamValues.length

        // Get benchmarks from rank config if available
        const cfg = _rankConfig[this.lens]
        const metric = cfg?.metrics?.find(m => m.key === metricKey)
        const benchmarks = cfg?.rawBenchmarks?.[metricKey] ?? null

        // Evaluate
        const eval = evaluateMetric(playerVal, teamAvg, metricKey, benchmarks)
        if (!eval) continue

        const meta = COL_META[metricKey]
        if (!meta) continue

        const point = {
          metric: metricKey,
          label: meta.label,
          value: playerVal,
          formatted: meta.fmt(playerVal),
          comparison: eval.comparison,
          delta: eval.delta,
          severity: eval.severity
        }

        if (eval.isStrength) {
          this.strengths.push(point)
        } else if (eval.isWeakness) {
          this.weaknesses.push(point)
        }
      }

      // Sort by delta (magnitude)
      this.strengths.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
      this.weaknesses.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
    }
  }))
})
