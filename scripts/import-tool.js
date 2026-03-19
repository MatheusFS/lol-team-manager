document.addEventListener('alpine:init', () => {
  Alpine.data('importTool', () => ({

    CLUSTER: {
      BR1:'americas', NA1:'americas', LAN:'americas', LAS:'americas',
      EUW1:'europe',  EUNE1:'europe', TR1:'europe',   RU:'europe',
      KR:'asia',      JP1:'asia',
      OC1:'sea',      PH2:'sea',      SG2:'sea',      TH2:'sea',      TW2:'sea', VN2:'sea',
    },

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
        const [gd, kda, dmg] = await Promise.all([
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('gd_f = null')}`).then(r => r.json()),
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('team_kills = null')}`).then(r => r.json()),
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('damage = null')}`).then(r => r.json()),
        ])
        this.missingRows = []
        if (gd.totalItems)  this.missingRows.push({ n: gd.totalItems,  label: 'sem diferença de ouro (GD@F)' })
        if (kda.totalItems) this.missingRows.push({ n: kda.totalItems, label: 'sem K/D do time' })
        if (dmg.totalItems) this.missingRows.push({ n: dmg.totalItems, label: 'sem dano causado' })
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
      this.showResults = false

      try {
        this.setStatus('Buscando conta…')
        const account = await this._riotFetch(
          `https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
        )

        this.setStatus('Buscando lista de partidas de Clash…')
        const matchIds = await this._riotFetch(
          `https://${cluster}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=700&count=20`
        )
        if (!matchIds.length) { this.setStatus('Nenhuma partida de Clash encontrada para esta conta.'); return }

        this.setStatus(`Buscando detalhes de ${matchIds.length} partidas…`)
        const details = []
        for (let i = 0; i < matchIds.length; i++) {
          const m = await this._riotFetch(
            `https://${cluster}.api.riotgames.com/lol/match/v5/matches/${matchIds[i]}`
          )
          details.push({ riotId: matchIds[i], data: m, puuid: account.puuid })
          if (i < matchIds.length - 1) await this._sleep(120)
        }

        this.setStatus('Cruzando com seus registros…')
        const pbRes = await fetch(`${PB}/api/collections/matches/records?perPage=200&sort=-date`).then(r => r.json())
        this.setStatus('')
        this._renderResults(details, pbRes.items || [])

      } catch (e) {
        this.setStatus(e.message, 'error')
        console.error(e)
      }
    },

    _renderResults(details, pbMatches) {
      this.matchPairs = []
      this.cards      = []
      for (const { riotId, data, puuid } of details) {
        const stats = this._extractStats(data, puuid)
        if (!stats) continue
        const pb        = this._findPbMatch(stats, pbMatches)
        const hasData   = pb && pb.gd_f != null && pb.team_kills != null
        const canImport = pb && !hasData
        this.matchPairs.push({ riotId, stats, pbId: pb?.id ?? null, canImport })
        this.cards.push({ riotId, stats, pb, hasData, canImport })
      }
      this.showResults = true
    },

    _extractStats(data, puuid) {
      const info = data.info
      const me   = info.participants.find(p => p.puuid === puuid)
      if (!me) return null
      const teamId    = me.teamId
      const ourTeam   = info.participants.filter(p => p.teamId === teamId)
      const enemyTeam = info.participants.filter(p => p.teamId !== teamId)
      const teamObj   = info.teams.find(t => t.teamId === teamId)
      return {
        team_kills:  teamObj.objectives.champion.kills,
        team_deaths: ourTeam.reduce((s,p) => s + p.deaths, 0),
        total_gold:  ourTeam.reduce((s,p) => s + p.goldEarned, 0),
        damage:      ourTeam.reduce((s,p) => s + p.totalDamageDealtToChampions, 0),
        gd_f:        ourTeam.reduce((s,p) => s + p.goldEarned, 0) - enemyTeam.reduce((s,p) => s + p.goldEarned, 0),
        win:         teamObj.win,
        side:        teamId === 100 ? 'Blue' : 'Red',
        duration:    Math.round(info.gameDuration / 60),
        date:        new Date(info.gameCreation).toISOString().slice(0, 10),
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
        await this._patchPb(pair.pbId, pair.stats)
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
          await this._patchPb(pair.pbId, pair.stats)
          await this._sleep(50)
        }
        this.setStatus(`Concluído — ${toImport.length} partidas importadas.`, 'ok')
        await this.loadMissing()
        await this.fetchMatches()
      } catch (e) { this.setStatus(e.message, 'error') }
    },

    async _patchPb(id, stats) {
      const res = await fetch(`${PB}/api/collections/matches/records/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          team_kills: stats.team_kills, team_deaths: stats.team_deaths,
          total_gold: stats.total_gold, damage: stats.damage, gd_f: stats.gd_f,
        }),
      })
      if (!res.ok) throw new Error(`Falha ao salvar registro ${id}: ${res.status}`)
    },

    async _riotFetch(url) {
      const res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } })
      if (res.status === 403) throw new Error('Chave de API inválida ou expirada.')
      if (res.status === 404) throw new Error('Conta não encontrada — verifique o Riot ID e o servidor.')
      if (res.status === 429) throw new Error('Limite de requisições atingido. Aguarde um minuto e tente novamente.')
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
