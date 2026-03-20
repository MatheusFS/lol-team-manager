document.addEventListener('alpine:init', () => {
  Alpine.data('importTool', () => ({

    CLUSTER: {
      BR1:'americas', NA1:'americas', LAN:'americas', LAS:'americas',
      EUW1:'europe',  EUNE1:'europe', TR1:'europe',   RU:'europe',
      KR:'asia',      JP1:'asia',
      OC1:'sea',      PH2:'sea',      SG2:'sea',      TH2:'sea', TW2:'sea', VN2:'sea',
    },
    POS_ORDER: { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 },

    // ── Config ─────────────────────────────────────────────────────────────
    apiKey:   '',
    region:   'BR1',
    summoner: '',

    // ── Missing data ───────────────────────────────────────────────────────
    missingRows: [],

    // ── Results ────────────────────────────────────────────────────────────
    matchPairs:  [],
    cards:       [],
    showResults: false,

    // ── Status ─────────────────────────────────────────────────────────────
    statusMsg:  '',
    statusType: 'info',

    // ── Init ───────────────────────────────────────────────────────────────
    init() {
      this.apiKey   = localStorage.getItem('riot-api-key')  || ''
      this.region   = localStorage.getItem('riot-region')   || 'BR1'
      this.summoner = localStorage.getItem('riot-summoner') || ''
      this.loadMissing()
    },

    // ── Missing data ───────────────────────────────────────────────────────
    async loadMissing() {
      try {
        const enc = s => encodeURIComponent(s)
        const [gd, kda, snap] = await Promise.all([
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('gd_f = null')}`).then(r => r.json()),
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('team_kills = null')}`).then(r => r.json()),
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('riot_match_id != "" && riot_match_snapshot = null')}`).then(r => r.json()),
        ])
        this.missingRows = []
        if (gd.totalItems)   this.missingRows.push({ n: gd.totalItems,   label: 'sem diferença de ouro (GD@F)' })
        if (kda.totalItems)  this.missingRows.push({ n: kda.totalItems,  label: 'sem K/D do time' })
        if (snap.totalItems) this.missingRows.push({ n: snap.totalItems, label: 'com riot_match_id mas sem snapshot' })
      } catch (_) {}
    },

    // ── Fetch Riot matches ─────────────────────────────────────────────────
    async fetchMatches() {
      if (!this.apiKey) { this.setStatus('Insira uma chave de API primeiro.', 'error'); return }
      if (!this.summoner.includes('#')) {
        this.setStatus('Insira o Riot ID no formato Nome#Tag (ex: GdN#BR1)', 'error'); return
      }

      localStorage.setItem('riot-api-key',  this.apiKey)
      localStorage.setItem('riot-region',   this.region)
      localStorage.setItem('riot-summoner', this.summoner)

      const [gameName, tagLine] = this.summoner.split('#')
      const cluster = this.CLUSTER[this.region] || 'americas'
      const base    = `https://${cluster}.api.riotgames.com`
      this.showResults = false

      try {
        this.setStatus('Buscando conta…')
        const account = await this._riotFetch(`${base}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`)

        this.setStatus('Carregando jogadores…')
        const puuidToName = {}
        try {
          const players = await api.col('players').list({ perPage: 50 })
          for (const p of players.items) {
            if (p.puuid) puuidToName[p.puuid] = p.name
          }
        } catch (_) {}

        this.setStatus('Buscando lista de partidas de Clash…')
        const matchIds = await this._riotFetch(`${base}/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=700&count=20`)
        if (!matchIds.length) { this.setStatus('Nenhuma partida de Clash encontrada.'); return }

        const details = []
        for (let i = 0; i < matchIds.length; i++) {
          this.setStatus(`Buscando partida ${i + 1}/${matchIds.length}…`)
          const match    = await this._riotFetch(`${base}/lol/match/v5/matches/${matchIds[i]}`)
          await this._sleep(100)
          const timeline = await this._riotFetch(`${base}/lol/match/v5/matches/${matchIds[i]}/timeline`)
          details.push({ riotId: matchIds[i], match, timeline, puuid: account.puuid })
          if (i < matchIds.length - 1) await this._sleep(150)
        }

        this.setStatus('Cruzando com seus registros…')
        const pbRes = await fetch(
          `${PB}/api/collections/matches/records?perPage=200&sort=-date&fields=id,date,side,win,game_n,gd_f,team_kills,riot_match_id`
        ).then(r => r.json())
        this.setStatus('')
        this._renderResults(details, pbRes.items || [], puuidToName)

      } catch (e) {
        this.setStatus(e.message, 'error')
        console.error(e)
      }
    },

    _renderResults(details, pbMatches, puuidToName) {
      this.matchPairs = []
      this.cards      = []
      for (const { riotId, match, timeline, puuid } of details) {
        const stats = this._extractStats(match, timeline, puuid, puuidToName)
        if (!stats) continue
        const pb        = this._findPbMatch(stats, pbMatches)
        const hasData   = pb && pb.gd_f != null && pb.team_kills != null && !!pb.riot_match_id
        const canImport = pb && !hasData
        this.matchPairs.push({ riotId, stats, snapshot: { match, timeline }, pbId: pb?.id ?? null, canImport })
        this.cards.push({ riotId, stats, pb, hasData, canImport })
      }
      this.showResults = true
    },

    _extractStats(match, timeline, puuid, puuidToName) {
      const info    = match.info
      const me      = info.participants.find(p => p.puuid === puuid)
      if (!me) return null
      const teamId  = me.teamId
      const allOur  = info.participants.filter(p => p.teamId === teamId)
      const allEnm  = info.participants.filter(p => p.teamId !== teamId)
      const ourTeam = info.teams.find(t => t.teamId === teamId)
      const ourIds  = new Set(allOur.map(p => p.participantId))
      const dur     = Math.round(info.gameDuration / 60) || 1

      const teamKills   = ourTeam.objectives.champion.kills
      const teamDeaths  = allOur.reduce((s, p) => s + (p.deaths  ?? 0), 0)
      const teamAssists = allOur.reduce((s, p) => s + (p.assists ?? 0), 0)
      const totalGold   = allOur.reduce((s, p) => s + (p.goldEarned ?? 0), 0)
      const damage      = allOur.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0)
      const dmgTaken    = allOur.reduce((s, p) => s + (p.totalDamageTaken ?? 0), 0)
      const wards       = allOur.reduce((s, p) => s + (p.wardsPlaced ?? 0), 0)
      const visionScore = allOur.reduce((s, p) => s + (p.visionScore ?? 0), 0)
      const csTotal     = allOur.reduce((s, p) => s + (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0), 0)

      const o = ourTeam?.objectives
      const objFlow = o ? [
        o.tower?.kills ?? 0, o.horde?.kills ?? 0, o.riftHerald?.kills ?? 0,
        o.dragon?.kills ?? 0, o.baron?.kills ?? 0, o.inhibitor?.kills ?? 0, o.nexus?.kills ?? 0,
      ].join('/') : ''

      // Gold diffs from timeline
      const frames = timeline?.info?.frames
      const calcGd = (min) => {
        const f = frames?.[min]
        if (!f?.participantFrames) return null
        let our = 0, enm = 0
        for (const [pid, pf] of Object.entries(f.participantFrames)) {
          if (ourIds.has(+pid)) our += pf.totalGold ?? 0
          else                  enm += pf.totalGold ?? 0
        }
        return our - enm
      }
      let gdF = totalGold - allEnm.reduce((s, p) => s + (p.goldEarned ?? 0), 0)
      if (frames?.length) {
        const last = frames[frames.length - 1]
        if (last?.participantFrames) {
          let our = 0, enm = 0
          for (const [pid, pf] of Object.entries(last.participantFrames)) {
            if (ourIds.has(+pid)) our += pf.totalGold ?? 0
            else                  enm += pf.totalGold ?? 0
          }
          gdF = our - enm
        }
      }

      // Player stats
      const sorted = [...allOur].sort((a, b) =>
        (this.POS_ORDER[a.teamPosition] ?? 99) - (this.POS_ORDER[b.teamPosition] ?? 99)
      )
      const playerStats = sorted.map(p => {
        const kda = p.deaths === 0
          ? (p.kills + p.assists)
          : Math.round(((p.kills + p.assists) / p.deaths) * 100) / 100
        return {
          name:        puuidToName[p.puuid] ?? null,
          role:        p.teamPosition || p.individualPosition || null,
          champion:    p.championName,
          kills:       p.kills       ?? 0,
          deaths:      p.deaths      ?? 0,
          assists:     p.assists     ?? 0,
          cs:          (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
          damage:      p.totalDamageDealtToChampions ?? 0,
          damageTaken: p.totalDamageTaken ?? 0,
          gold:        p.goldEarned  ?? 0,
          visionScore: p.visionScore ?? 0,
          wardsPlaced: p.wardsPlaced ?? 0,
          level:       p.champLevel  ?? null,
          kda,
          firstBlood:  p.firstBloodKill ?? false,
        }
      })

      // MVP suggestion
      let mvp = null, bestMvpScore = -Infinity
      for (const p of allOur) {
        const name = puuidToName[p.puuid]
        if (!name) continue
        const score = (p.kills ?? 0) * 2 + (p.assists ?? 0) - (p.deaths ?? 0) * 0.5
        if (score > bestMvpScore) { bestMvpScore = score; mvp = name }
      }

      // MVC = champion of the MVP player
      const mvpParticipant = allOur.find(p => puuidToName[p.puuid] === mvp)
      const mvcChampName   = mvpParticipant?.championName ?? null

      return {
        team_kills: teamKills, team_deaths: teamDeaths, team_assists: teamAssists,
        total_gold: totalGold, damage,
        da_di:        dmgTaken > 0 ? Math.round((damage / dmgTaken) * 100) / 100 : null,
        gold_per_min: Math.round(totalGold / dur),
        wards_per_min: Math.round((wards / dur) * 10) / 10,
        vision_score: visionScore,
        cs_total: csTotal, cs_per_min: Math.round((csTotal / dur) * 10) / 10,
        first_blood: ourTeam?.objectives?.champion?.first ?? false,
        first_tower: ourTeam?.objectives?.tower?.first    ?? false,
        obj_flow: objFlow,
        gd_f: gdF, gd_10: calcGd(10), gd_20: calcGd(20),
        duration: dur,
        win:  ourTeam.win,
        side: teamId === 100 ? 'Blue' : 'Red',
        date: new Date(info.gameStartTimestamp ?? info.gameCreation).toISOString().slice(0, 10),
        playerStats, mvp, mvcChampName,
      }
    },

    _findPbMatch(stats, pbMatches) {
      const exact = pbMatches.filter(m =>
        m.date?.slice(0,10) === stats.date && m.side === stats.side && m.win === stats.win)
      if (exact.length === 1) return exact[0]
      const sameDay = pbMatches.filter(m => m.date?.slice(0,10) === stats.date)
      if (sameDay.length === 1) return sameDay[0]
      return null
    },

    // ── Import ─────────────────────────────────────────────────────────────
    async importSingle(riotId) {
      const pair = this.matchPairs.find(p => p.riotId === riotId)
      if (!pair?.pbId) return
      try {
        await this._patchPb(pair.pbId, riotId, pair.stats, pair.snapshot)
        this.setStatus('Importado. Atualizando…', 'ok')
        await this.loadMissing()
        await this.fetchMatches()
      } catch (e) { this.setStatus(e.message, 'error') }
    },

    async importAll() {
      const toImport = this.matchPairs.filter(p => p.canImport && p.pbId)
      if (!toImport.length) { this.setStatus('Nenhuma partida identificada para importar.'); return }
      this.setStatus(`Importando ${toImport.length} partidas…`)
      try {
        for (const pair of toImport) {
          await this._patchPb(pair.pbId, pair.riotId, pair.stats, pair.snapshot)
          await this._sleep(50)
        }
        this.setStatus(`Concluído — ${toImport.length} partidas importadas.`, 'ok')
        await this.loadMissing()
        await this.fetchMatches()
      } catch (e) { this.setStatus(e.message, 'error') }
    },

    async _patchPb(id, riotId, stats, snapshot) {
      const payload = {
        riot_match_id:       riotId,
        riot_match_snapshot: stripSnapshot(snapshot),
        player_stats:        stats.playerStats,
        team_kills:          stats.team_kills,
        team_deaths:         stats.team_deaths,
        team_assists:        stats.team_assists,
        total_gold:          stats.total_gold,
        damage:              stats.damage,
        da_di:               stats.da_di,
        gold_per_min:        stats.gold_per_min,
        wards_per_min:       stats.wards_per_min,
        vision_score:        stats.vision_score,
        cs_total:            stats.cs_total,
        cs_per_min:          stats.cs_per_min,
        first_blood:         stats.first_blood,
        first_tower:         stats.first_tower,
        obj_flow:            stats.obj_flow,
        gd_f:                stats.gd_f,
        gd_10:               stats.gd_10,
        gd_20:               stats.gd_20,
        duration:            stats.duration,
      }
      if (stats.mvp) payload.mvp = stats.mvp

      const res = await fetch(`${PB}/api/collections/matches/records/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Falha ao salvar registro ${id}: ${res.status}`)
    },

    async _riotFetch(url) {
      const res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } })
      if (res.status === 403) throw new Error('Chave de API inválida ou expirada.')
      if (res.status === 404) throw new Error('Conta não encontrada.')
      if (res.status === 429) throw new Error('Limite de requisições atingido. Aguarde e tente novamente.')
      if (!res.ok) throw new Error(`Erro na API da Riot: ${res.status}`)
      return res.json()
    },

    // ── Helpers ────────────────────────────────────────────────────────────
    setStatus(msg, type = 'info') {
      this.statusMsg  = msg
      this.statusType = type
    },

    get statusCls() {
      return ({ info:'text-slate-400', error:'text-red-400', ok:'text-green-400' })[this.statusType] ?? 'text-slate-400'
    },

    fmtGdf(v)  { return (v >= 0 ? '+' : '') + v.toLocaleString('en') },
    gdfCls(v)  { return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-400' },
    _sleep(ms) { return new Promise(r => setTimeout(r, ms)) },
  }))
})
