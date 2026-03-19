// ── Team roster ───────────────────────────────────────────────────────────────
const ROSTER = [
  { name: 'GdN',      riotId: 'GdN#MFS'               },
  { name: 'Klebão',   riotId: 'Kerido#ADTR'            },
  { name: 'Digo',     riotId: 'NOT OK#rdz'             },
  { name: 'Conkreto', riotId: 'Conkreto#N64'           },
  { name: 'Kelly',    riotId: 'KellyOhana#FLA'         },
  { name: 'Pixek',    riotId: 'Worst Player TFT#001'   },
  { name: 'Eden',     riotId: 'EI DIIGTO RPADIO#EVDD'  },
  { name: 'Nunes',    riotId: 'Nunes#7778'             },
  { name: 'Xuao',     riotId: 'talk talk#xuauz'        },
]

const RIOT_BASE = 'https://americas.api.riotgames.com'
const POS_ORDER = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 }

// ── Alpine component ──────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('matchAssistant', () => ({

    ROSTER,
    apiKey:  localStorage.getItem('riot-api-key') ?? '',
    loading: false,
    status:  '',
    cards:   [],
    puuids:  {},   // riotId → puuid cache

    saveKey() { localStorage.setItem('riot-api-key', this.apiKey) },

    returnHref() {
      const returnId = new URLSearchParams(location.search).get('returnId')
      return returnId
        ? `/pages/match-form.html?id=${encodeURIComponent(returnId)}`
        : '/pages/match-form.html'
    },

    // Navigate to match form, passing card data via localStorage
    use(card) {
      localStorage.setItem('match-assistant-prefill', JSON.stringify(card))
      const returnId = new URLSearchParams(location.search).get('returnId')
      location.href  = returnId
        ? `/pages/match-form.html?id=${encodeURIComponent(returnId)}`
        : '/pages/match-form.html'
    },

    // ── Riot API fetch helper ─────────────────────────────────────────────
    async _riotFetch(url) {
      const res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(`Riot API ${res.status}: ${body?.status?.message ?? url}`)
      }
      return res.json()
    },

    // ── Resolve PUUID for one roster member ───────────────────────────────
    async _resolvePuuid(member) {
      if (this.puuids[member.riotId]) return this.puuids[member.riotId]
      const [gameName, tagLine] = member.riotId.split('#')
      const data = await this._riotFetch(
        `${RIOT_BASE}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
      )
      this.puuids[member.riotId] = data.puuid
      return data.puuid
    },

    // ── Fetch recent match IDs for a PUUID (no queue filter) ─────────────
    async _fetchMatchIds(puuid, count = 20) {
      return this._riotFetch(
        `${RIOT_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}`
      )
    },

    // ── Count how many roster members are on the same team ────────────────
    _countRosterOnSameTeam(participants, knownPuuidSet) {
      const counts = {}
      for (const p of participants) {
        if (knownPuuidSet.has(p.puuid)) {
          counts[p.teamId] = (counts[p.teamId] ?? 0) + 1
        }
      }
      const vals = Object.values(counts)
      return vals.length ? Math.max(...vals) : 0
    },

    // ── Main orchestration ────────────────────────────────────────────────
    async fetch() {
      if (!this.apiKey) return
      this.loading = true
      this.cards   = []
      this.status  = 'Resolvendo contas…'

      try {
        // 1. Resolve all PUUIDs
        const puuidResults = await Promise.allSettled(
          ROSTER.map(m => this._resolvePuuid(m))
        )
        const knownPuuids = puuidResults
          .map(r => r.status === 'fulfilled' ? r.value : null)
          .filter(Boolean)
        const knownPuuidSet = new Set(knownPuuids)

        // 2. Fetch recent match IDs per member (no queue filter)
        this.status = 'Buscando partidas recentes…'
        const idResults = await Promise.allSettled(
          knownPuuids.map(p => this._fetchMatchIds(p, 20))
        )

        // 3. Deduplicate, preserve first-seen order
        const seen   = new Set()
        const allIds = []
        for (const r of idResults) {
          if (r.status !== 'fulfilled') continue
          for (const id of r.value) {
            if (!seen.has(id)) { seen.add(id); allIds.push(id) }
          }
        }

        if (allIds.length === 0) {
          this.status  = 'Nenhuma partida encontrada.'
          this.loading = false
          return
        }

        // 4. Two-pass: details first (filter by team size), then timeline
        const champStore = Alpine.store('champions')

        for (let i = 0; i < allIds.length; i++) {
          const matchId = allIds[i]
          this.status = `Verificando ${i + 1}/${allIds.length}…`

          try {
            // Pass 1: fetch details, check if ≥5 roster members on same team
            const match    = await this._riotFetch(`${RIOT_BASE}/lol/match/v5/matches/${matchId}`)
            const teamSize = this._countRosterOnSameTeam(match.info?.participants ?? [], knownPuuidSet)

            if (teamSize < 5) {
              await new Promise(r => setTimeout(r, 50))
              continue
            }

            // Pass 2: fetch timeline for qualifying match
            await new Promise(r => setTimeout(r, 80))
            const timeline = await this._riotFetch(`${RIOT_BASE}/lol/match/v5/matches/${matchId}/timeline`)

            const card = this._buildCard(match, timeline, knownPuuidSet)
            if (card) this.cards.push(card)

          } catch (e) {
            console.warn('Skipping match', matchId, e.message)
          }

          await new Promise(r => setTimeout(r, 80))
        }

        this.status  = this.cards.length
          ? `${this.cards.length} partidas do time encontradas.`
          : 'Nenhuma partida com 5 membros do time encontrada.'
        this.loading = false

      } catch (e) {
        console.error(e)
        this.status  = 'Erro: ' + e.message
        this.loading = false
      }
    },

    // ── Sort participants by lane position (3-tier fallback) ──────────────
    _sortByPosition(participants) {
      return [...participants].sort((a, b) => {
        const ai = POS_ORDER[a.teamPosition] ?? POS_ORDER[a.individualPosition] ?? 99
        const bi = POS_ORDER[b.teamPosition] ?? POS_ORDER[b.individualPosition] ?? 99
        return ai - bi
      })
    },

    // ── Calculate team gold difference at a given minute ──────────────────
    _calcGdAtMinute(timeline, ourParticipantIds, minute) {
      const frames = timeline?.info?.frames
      if (!frames || frames.length <= minute) return null
      const frame = frames[minute]
      if (!frame?.participantFrames) return null

      const ourSet = new Set(ourParticipantIds)
      let ourGold = 0, enemyGold = 0
      for (const [pidStr, pf] of Object.entries(frame.participantFrames)) {
        const pid = parseInt(pidStr, 10)
        if (ourSet.has(pid)) ourGold += pf.totalGold ?? 0
        else                 enemyGold += pf.totalGold ?? 0
      }
      return ourGold - enemyGold
    },

    // ── Build objective flow string (t/v/g/d/b/i/n) ───────────────────────
    _buildObjFlow(teamObj) {
      if (!teamObj) return ''
      const t = teamObj.tower?.kills      ?? 0
      const v = teamObj.horde?.kills      ?? 0
      const g = teamObj.riftHerald?.kills ?? 0
      const d = teamObj.dragon?.kills     ?? 0
      const b = teamObj.baron?.kills      ?? 0
      const ih = teamObj.inhibitor?.kills ?? 0
      const n = teamObj.nexus?.kills      ?? 0
      return `${t}/${v}/${g}/${d}/${b}/${ih}/${n}`
    },

    // ── Resolve champion name + key via store ─────────────────────────────
    _resolveChamp(championName) {
      const found = Alpine.store('champions').list.find(c => c.name === championName)
      return { name: championName ?? '', key: found?.key ?? '' }
    },

    // ── Identify Top laner from roster ────────────────────────────────────
    _identifyTopPlayer(sortedOurParticipants, puuidToName) {
      for (const p of sortedOurParticipants) {
        const pos = p.teamPosition || p.individualPosition
        if (pos === 'TOP') return puuidToName[p.puuid] ?? ''
      }
      return ''
    },

    // ── Suggest MVP: best KDA among identified team members ───────────────
    _suggestMvp(ourParticipants, puuidToName) {
      let best = null, bestScore = -Infinity
      for (const p of ourParticipants) {
        const name = puuidToName[p.puuid]
        if (!name) continue
        const score = (p.kills ?? 0) * 2 + (p.assists ?? 0) - (p.deaths ?? 0) * 0.5
        if (score > bestScore) { bestScore = score; best = name }
      }
      return best ?? ''
    },

    // ── Suggest MVC: highest damage champion ─────────────────────────────
    _suggestMvc(ourParticipants) {
      let best = null, bestDmg = -1
      for (const p of ourParticipants) {
        const dmg = p.totalDamageDealtToChampions ?? 0
        if (dmg > bestDmg) {
          bestDmg = dmg
          best = this._resolveChamp(p.championName)
        }
      }
      return best
    },

    // ── Build a single match card ─────────────────────────────────────────
    _buildCard(match, timeline, knownPuuidSet) {
      const info = match?.info
      if (!info) return null

      const participants = info.participants ?? []
      const ourParticipants = participants.filter(p => knownPuuidSet.has(p.puuid))
      if (ourParticipants.length === 0) return null

      const ourTeamId = ourParticipants[0].teamId
      const ourTeam   = info.teams?.find(t => t.teamId === ourTeamId)
      const allOur    = participants.filter(p => p.teamId === ourTeamId)
      const allEnemy  = participants.filter(p => p.teamId !== ourTeamId)

      const ourParticipantIds = allOur.map(p => p.participantId)

      const win      = ourTeam?.win ?? false
      const side     = ourTeamId === 100 ? 'Blue' : 'Red'
      const date     = info.gameStartTimestamp
        ? new Date(info.gameStartTimestamp).toISOString().slice(0, 10)
        : ''
      const duration = info.gameDuration ? Math.round(info.gameDuration / 60) : null

      const sortedOur   = this._sortByPosition(allOur)
      const sortedEnemy = this._sortByPosition(allEnemy)
      const ourChamps   = sortedOur.map(p => this._resolveChamp(p.championName))
      const enemyChamps = sortedEnemy.map(p => this._resolveChamp(p.championName))

      // PUUID → roster name
      const puuidToName = {}
      for (const m of ROSTER) {
        if (this.puuids[m.riotId]) puuidToName[this.puuids[m.riotId]] = m.name
      }

      const gd10 = this._calcGdAtMinute(timeline, ourParticipantIds, 10)
      const gd20 = this._calcGdAtMinute(timeline, ourParticipantIds, 20)

      // GD at final frame
      let gdF = null
      const frames = timeline?.info?.frames
      if (frames?.length) {
        const last   = frames[frames.length - 1]
        const ourSet = new Set(ourParticipantIds)
        if (last?.participantFrames) {
          let ourG = 0, enmG = 0
          for (const [pidStr, pf] of Object.entries(last.participantFrames)) {
            const pid = parseInt(pidStr, 10)
            if (ourSet.has(pid)) ourG += pf.totalGold ?? 0
            else                 enmG += pf.totalGold ?? 0
          }
          gdF = ourG - enmG
        }
      }

      const teamKills  = allOur.reduce((s, p) => s + (p.kills   ?? 0), 0)
      const teamDeaths = allOur.reduce((s, p) => s + (p.deaths  ?? 0), 0)
      const totalGold  = allOur.reduce((s, p) => s + (p.goldEarned ?? 0), 0)
      const damage     = allOur.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0)
      const goldPerMin = duration ? Math.round(totalGold / duration) : null

      const totalWards  = allOur.reduce((s, p) => s + (p.wardsPlaced ?? 0), 0)
      const wardsPerMin = duration
        ? Math.round((totalWards / duration) * 10) / 10
        : null

      const damageTaken = allOur.reduce((s, p) => s + (p.totalDamageTaken ?? 0), 0)
      const dadi = damageTaken > 0
        ? Math.round((damage / damageTaken) * 100) / 100
        : null

      const objFlow    = this._buildObjFlow(ourTeam?.objectives)
      const topPlayer  = this._identifyTopPlayer(sortedOur, puuidToName)
      const mvp        = this._suggestMvp(allOur, puuidToName)
      const mvcChamp   = this._suggestMvc(allOur)

      return {
        matchId: match.metadata?.matchId ?? '',
        date, win, side, duration,
        ourChamps, enemyChamps,
        topPlayer, mvp,
        mvcChampName: mvcChamp?.name ?? '',
        mvcChampKey:  mvcChamp?.key  ?? '',
        teamKills, teamDeaths,
        gd10, gd20, gdF,
        totalGold, goldPerMin, damage, dadi, wardsPerMin,
        objFlow,
      }
    },

  }))
})
