// ── Repair all match snapshots with new player_stats fields ──────────────────
// This script re-fetches all matches from Riot API and re-extracts player_stats
// with the new fields: damageSelfMitigated, timeCCingOthers, wardsKilled,
// damageToBuildings, killParticipation, controlWardsPlaced

document.addEventListener('alpine:init', () => {
  Alpine.data('repairSnapshots', () => ({
    apiKey: localStorage.getItem('riot-api-key') ?? '',
    repairing: false,
    totalMatches: 0,
    repairedCount: 0,
    errorCount: 0,
    currentMatchId: '',
    errors: [],
    status: '',

    async init() {
      // Fetch all matches from PocketBase
      try {
        const data = await api.col('matches').list({ perPage: 500 })
        this.totalMatches = data.items.filter(m => m.riot_match_id).length
      } catch (e) {
        this.status = `Erro ao carregar partidas: ${e.message}`
      }
    },

    async startRepair() {
      if (!this.apiKey) {
        this.status = '❌ API Key obrigatória'
        return
      }
      if (this.repairing) return

      this.repairing = true
      this.repairedCount = 0
      this.errorCount = 0
      this.errors = []
      this.status = 'Iniciando reparo…'

      try {
        localStorage.setItem('riot-api-key', this.apiKey)
        const data = await api.col('matches').list({ perPage: 500, sort: 'riot_match_id' })
        const matches = data.items.filter(m => m.riot_match_id)

        for (const match of matches) {
          if (!this.repairing) break // Stop if cancelled
          
          this.currentMatchId = match.riot_match_id
          this.status = `Processando ${this.repairedCount + this.errorCount} / ${matches.length}…`

          try {
            // Fetch fresh data from Riot API
            const base = RiotApi.baseUrl(RiotApi.clusterFromMatchId(match.riot_match_id))
            const [riotMatch, riotTimeline] = await Promise.all([
              RiotApi.fetch(`${base}/lol/match/v5/matches/${match.riot_match_id}`, this.apiKey),
              RiotApi.fetch(`${base}/lol/match/v5/matches/${match.riot_match_id}/timeline`, this.apiKey),
            ])

            // Re-extract player stats with new fields
            const { puuidToName, puuidToId } = await this._resolvePlayersMap(match)
            const stats = extractMatchStats(riotMatch, riotTimeline, {
              ourSide: match.side,
              puuidToName,
              puuidToId,
            })

            // Re-strip snapshot
            const snap = stripSnapshot({ match: riotMatch, timeline: riotTimeline })

            // Update match with new player_stats and riot_match_snapshot
            await api.col('matches').update(match.id, {
              player_stats: stats.playerStats,
              riot_match_snapshot: snap,
            })

            this.repairedCount++

            // Rate limit: ~1.2s between requests (safe for 20 req/s dev key)
            await new Promise(r => setTimeout(r, 1200))
          } catch (e) {
            console.error(`Erro ao reparar ${match.riot_match_id}:`, e)
            this.errors.push(`${match.riot_match_id}: ${e.message}`)
            this.errorCount++

            // Retry delay
            await new Promise(r => setTimeout(r, 1000))
          }
        }

        this.status = `✅ Reparo concluído: ${this.repairedCount} reparados, ${this.errorCount} erros`
      } catch (e) {
        this.status = `❌ Erro durante reparo: ${e.message}`
        console.error(e)
      } finally {
        this.repairing = false
      }
    },

    cancelRepair() {
      this.repairing = false
      this.status = '⊘ Reparo cancelado'
    },

    async _resolvePlayersMap(match) {
      const data = await api.col('players').list({ sort: 'name', perPage: 500 })
      const players = data.items
      const puuidToName = {}
      const puuidToId = {}
      for (const p of players) {
        puuidToName[p.puuid] = p.name
        puuidToId[p.puuid] = p.id
      }
      return { puuidToName, puuidToId }
    },
  }))
})
