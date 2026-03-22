document.addEventListener('alpine:init', () => {
  Alpine.data('matchForm', () => ({

    // ── Constants ──────────────────────────────────────────────────────────
    ROLES:    ['top', 'jng', 'mid', 'adc', 'sup'],
    SUBTYPES: ['Siege','Protect','Engage','Split','Pick','Dive','Reset','Mix'],
    players:  [],   // loaded dynamically from players collection
    // SCALE_COLORS, SCALE_SLOTS vêm de shared.js

    // ── Identity ───────────────────────────────────────────────────────────
    editId: null,
    isEdit: false,

    // ── Info ───────────────────────────────────────────────────────────────
    date:   '',
    game_n: 1,
    win:    null,   // true | false | null
    side:   null,   // 'Red' | 'Blue' | null

    // ── Lineup ────────────────────────────────────────────────────────────
    formations:  [],
    formationId: '',
    topPlayer:  '',
    ourChamps:   Array(5).fill(null).map(() => ({ name: '', key: '', query: '', results: [], open: false })),
    enemyChamps: Array(5).fill(null).map(() => ({ name: '', key: '', query: '', results: [], open: false })),

    // ── Strategy ──────────────────────────────────────────────────────────
    compType:     '',
    enemyType:    '',
    compSubtype:  [],
    scaling:      Array(3).fill(null).map(() => ({ ci: null })),
    enemyScaling: Array(3).fill(null).map(() => ({ ci: null })),

    // ── Results ───────────────────────────────────────────────────────────
    duration:   '',
    mvp:        '',
    mvcId:      '',
    mvcKey:     '',
    mvcQuery:   '',
    mvcDisplay: '',
    mvcResults: [],
    mvcOpen:    false,
    teamKills:    '',
    teamDeaths:   '',
    teamAssists:  '',
    riotMatchId:  '',
    riotSnapshot: null,
    playerStats:  null,

    // ── Stats ──────────────────────────────────────────────────────────────
    gd10:        '',
    gd20:        '',
    gdF:         '',
    totalGold:   '',
    goldPerMin:  '',
    damage:      '',
    dadi:        '',
    wardsPerMin: '',
    visionScore: '',
    csTotal:     '',
    csPerMin:    '',
    firstBlood:  null,
    firstTower:  null,
    objFlow:     '',

    // ── UI state ───────────────────────────────────────────────────────────
    saving:   false,
    deleting: false,

    // ── Computed ───────────────────────────────────────────────────────────
    get pageTitle() {
      return this.isEdit ? 'Editar Partida' : 'Nova Partida'
    },

    scalingToStr(arr) {
      const C = ['🔴','🟡','🟢']
      return arr.every(s => s.ci !== null) ? arr.map(s => C[s.ci]).join('') : ''
    },

    // ── Init ───────────────────────────────────────────────────────────────
    async init() {
      const [, fData, pData] = await Promise.all([
        Alpine.store('champions').load(),
        api.col('formations').list({ sort: '-active,name', perPage: 100 }),
        api.col('players').list({ sort: 'name', perPage: 200 }),
      ])
      this.formations = fData.items
      this.players    = pData.items
      const params = new URLSearchParams(location.search)
      this.editId  = params.get('id')
      this.isEdit  = !!this.editId
      if (this.isEdit) {
        await this.loadMatch()
      } else {
        this.date = new Date().toISOString().slice(0, 10)
        const active = this.formations.find(f => f.active)
        if (active) this.formationId = active.id
      }
      // Apply prefill from match lookup page (after loadMatch so it can override blanks)
      const raw = localStorage.getItem('match-assistant-prefill')
      if (raw) {
        try { this.applyFromRiot(JSON.parse(raw)) } catch (e) { console.warn('prefill error', e) }
        localStorage.removeItem('match-assistant-prefill')
      }
      const snap = localStorage.getItem('match-assistant-snapshot')
      if (snap) {
        try { this.riotSnapshot = JSON.parse(snap) } catch (e) { console.warn('snapshot error', e) }
        localStorage.removeItem('match-assistant-snapshot')
      }

      // When MVP changes, auto-update MVC to the champion played by that player
      this.$watch('mvp', (playerId) => {
        if (!playerId || !this.playerStats?.length) return
        const player = this.players.find(p => p.id === playerId)
        if (!player) return
        const stat = this.playerStats.find(s => s.name === player.name)
        if (!stat?.champion) return
        const found = Alpine.store('champions').list.find(c => c.name === stat.champion)
                   ?? Alpine.store('champions').list.find(c => c.key === stat.champion)
        if (found) {
          this.mvcId      = found.id
          this.mvcKey     = found.key ?? ''
          this.mvcDisplay = found.name
        }
      })
    },


    _loadScaling(str, arr) {
      const C = ['🔴','🟡','🟢']
      ;[...str].slice(0, 3).forEach((ch, si) => {
        const ci = C.indexOf(ch)
        if (ci !== -1) arr[si].ci = ci
      })
    },

    // ── Champion slot search ───────────────────────────────────────────────
    searchChamp(slot) {
      slot.name    = ''
      slot.key     = ''
      slot.results = Alpine.store('champions').search(slot.query)
      slot.open    = slot.query.length > 0 && slot.results.length > 0
    },

    pickChamp(slot, champ) {
      slot.name    = champ.name
      slot.key     = champ.key ?? ''
      slot.query   = champ.name
      slot.results = []
      slot.open    = false
    },

    onSlotFocus(slot) {
      if (slot.query) {
        slot.results = Alpine.store('champions').search(slot.query)
        slot.open    = slot.results.length > 0
      }
    },

    onSlotBlur(slot) {
      setTimeout(() => { slot.open = false }, 150)
    },

    // ── MVC champion search ────────────────────────────────────────────────
    searchMvc() {
      this.mvcResults = Alpine.store('champions').search(this.mvcQuery)
      this.mvcOpen    = this.mvcQuery.length > 0 && this.mvcResults.length > 0
    },

    onMvcFocus() {
      const q = this.mvcDisplay || this.mvcQuery
      if (q) {
        this.mvcResults = Alpine.store('champions').search(q)
        this.mvcOpen    = this.mvcResults.length > 0
      }
    },

    pickMvc(champ) {
      this.mvcId      = champ.id
      this.mvcKey     = champ.key ?? ''
      this.mvcDisplay = champ.name
      this.mvcQuery   = ''
      this.mvcResults = []
      this.mvcOpen    = false
    },

    onMvcBlur() {
      setTimeout(() => { this.mvcOpen = false }, 150)
    },

    // ── Load match ─────────────────────────────────────────────────────────
    async loadMatch() {
      // Reset fields that are only set when the match has them,
      // so stale data from a previous session never leaks through.
      this.mvcId = ''; this.mvcKey = ''; this.mvcDisplay = ''
      this.ourChamps.forEach(s => { s.name = ''; s.key = ''; s.query = '' })
      this.enemyChamps.forEach(s => { s.name = ''; s.key = ''; s.query = '' })
      this.scaling.forEach(s => { s.ci = null })
      this.enemyScaling.forEach(s => { s.ci = null })
      try {
        const m = await api.col('matches').get(this.editId, { expand: 'mvc' })

        this.date       = m.date?.slice(0, 10) ?? ''
        this.game_n     = m.game_n ?? 1
        this.win        = m.win   ?? null
        this.side       = m.side  ?? null
        this.formationId = m.formation  ?? ''
        this.topPlayer  = m.top_player ?? ''
        this.compType   = m.comp_type  ?? ''
        this.enemyType  = m.enemy_type ?? ''
        this.compSubtype = Array.isArray(m.comp_subtype) ? m.comp_subtype : []
        this.duration   = m.duration   ?? ''
        this.mvp        = m.mvp        ?? ''
        this.teamKills   = m.team_kills    ?? ''
        this.teamDeaths  = m.team_deaths   ?? ''
        this.teamAssists = m.team_assists  ?? ''
        this.riotMatchId = m.riot_match_id ?? ''
        this.playerStats = Array.isArray(m.player_stats) ? m.player_stats : null
        this.gd10       = m.gd_10       ?? ''
        this.gd20       = m.gd_20       ?? ''
        this.gdF        = m.gd_f        ?? ''
        this.totalGold  = m.total_gold  ?? ''
        this.goldPerMin = m.gold_per_min ?? ''
        this.damage     = m.damage       ?? ''
        this.dadi       = m.da_di        ?? ''
        this.wardsPerMin = m.wards_per_min ?? ''
        this.visionScore = m.vision_score  ?? ''
        this.csTotal     = m.cs_total      ?? ''
        this.csPerMin    = m.cs_per_min    ?? ''
        this.firstBlood  = m.first_blood   ?? null
        this.firstTower  = m.first_tower   ?? null
        this.objFlow    = m.obj_flow    ?? ''

        if (m.mvc && m.expand?.mvc) {
          this.mvcId      = m.mvc
          this.mvcKey     = m.expand.mvc.key ?? ''
          this.mvcDisplay = m.expand.mvc.name
        }

        const champsByName = Object.fromEntries(
          Alpine.store('champions').list.map(c => [c.name, c])
        )
        if (Array.isArray(m.our_champs)) {
          m.our_champs.forEach((name, i) => {
            if (this.ourChamps[i]) {
              this.ourChamps[i].name  = name
              this.ourChamps[i].key   = champsByName[name]?.key ?? ''
              this.ourChamps[i].query = name
            }
          })
        }
        if (Array.isArray(m.enemy_champs)) {
          m.enemy_champs.forEach((name, i) => {
            if (this.enemyChamps[i]) {
              this.enemyChamps[i].name  = name
              this.enemyChamps[i].key   = champsByName[name]?.key ?? ''
              this.enemyChamps[i].query = name
            }
          })
        }

        if (m.scaling)       this._loadScaling(m.scaling,       this.scaling)
        if (m.enemy_scaling) this._loadScaling(m.enemy_scaling, this.enemyScaling)

      } catch (e) {
        alert('Partida não encontrada.')
        history.back()
      }
    },

    // ── Save ───────────────────────────────────────────────────────────────
    async save() {
      if (this.win === null) { alert('Selecione VITÓRIA ou DERROTA.'); return }
      this.saving = true
      try {
        if (this.riotSnapshot) this._extractStatsFromSnapshot()

        const num = v => (v !== '' && v != null) ? +v : undefined
        const str = v => (typeof v === 'string' ? v.trim() : String(v ?? '')).trim() || undefined

        const payload = {
          date:          this.date + ' 00:00:00.000Z',
          game_n:        +this.game_n,
          win:           this.win,
          side:          this.side       ?? undefined,
          formation:     this.formationId || undefined,
          top_player:    this.topPlayer || undefined,
          comp_type:     str(this.compType),
          comp_subtype:  this.compSubtype.length ? this.compSubtype : undefined,
          scaling:       this.scalingToStr(this.scaling)      || undefined,
          enemy_type:    str(this.enemyType),
          enemy_scaling: this.scalingToStr(this.enemyScaling) || undefined,
          duration:      num(this.duration),
          mvp:           this.mvp || undefined,
          mvc:           this.mvcId || undefined,
          team_kills:    num(this.teamKills),
          team_deaths:   num(this.teamDeaths),
          team_assists:  num(this.teamAssists),
          riot_match_id: str(this.riotMatchId) || undefined,
          riot_match_snapshot: this.riotSnapshot ? stripSnapshot(this.riotSnapshot) : undefined,
          player_stats:  this.playerStats ?? undefined,
          gd_10:         num(this.gd10),
          gd_20:         num(this.gd20),
          gd_f:          num(this.gdF),
          total_gold:    num(this.totalGold),
          gold_per_min:  num(this.goldPerMin),
          damage:        num(this.damage),
          da_di:         num(this.dadi),
          wards_per_min: num(this.wardsPerMin),
          vision_score:  num(this.visionScore),
          cs_total:      num(this.csTotal),
          cs_per_min:    num(this.csPerMin),
          first_blood:   this.firstBlood ?? undefined,
          first_tower:   this.firstTower ?? undefined,
          obj_flow:      str(this.objFlow),
        }

        const ourArr = this.ourChamps.map(s => s.name).filter(Boolean)
        const enmArr = this.enemyChamps.map(s => s.name).filter(Boolean)
        if (ourArr.length) payload.our_champs   = ourArr
        if (enmArr.length) payload.enemy_champs = enmArr

        Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])

        if (this.editId) {
          await api.col('matches').update(this.editId, payload)
        } else {
          await api.col('matches').create(payload)
        }
        location.href = '/index.html'
      } catch (e) {
        console.error(e)
        alert('Falha ao salvar: ' + (e.message || JSON.stringify(e)))
        this.saving = false
      }
    },

    // ── Delete ─────────────────────────────────────────────────────────────
    async del() {
      if (!confirm('Excluir esta partida? Isso não pode ser desfeito.')) return
      this.deleting = true
      try {
        await api.col('matches').delete(this.editId)
        location.href = '/index.html'
      } catch (e) {
        alert('Falha ao excluir.')
        this.deleting = false
      }
    },

    // ── Extract all stats from stored snapshot (called on save when snapshot exists) ──
    _extractStatsFromSnapshot() {
      const { match, timeline } = this.riotSnapshot
      const stats = extractMatchStats(match, timeline, { ourSide: this.side })
      if (!stats) return

      this.duration    = stats.duration
      this.teamKills   = stats.team_kills
      this.teamDeaths  = stats.team_deaths
      this.teamAssists = stats.team_assists
      this.totalGold   = stats.total_gold
      this.damage      = stats.damage
      this.dadi        = stats.da_di ?? ''
      this.goldPerMin  = stats.gold_per_min
      this.wardsPerMin = stats.wards_per_min
      this.visionScore = stats.vision_score
      this.csTotal     = stats.cs_total
      this.csPerMin    = stats.cs_per_min
      this.firstBlood  = stats.first_blood
      this.firstTower  = stats.first_tower
      this.objFlow     = stats.obj_flow
      this.gd10        = stats.gd_10
      this.gd20        = stats.gd_20
      this.gdF         = stats.gd_f
    },

    // ── Strategy suggestion from champion data (display-only reference) ────
    _computeSuggestion(slots) {
      const phases = ['early', 'mid', 'late']
      const votes  = {}
      const totals = [0, 0, 0], counts = [0, 0, 0]
      const champions = []

      for (const slot of slots) {
        if (!slot.name) continue
        const c = Alpine.store('champions').list.find(ch => ch.name === slot.name)
        champions.push({
          name:        slot.name,
          key:         slot.key,
          comp_type:   c?.comp_type   ?? null,
          comp_type_2: c?.comp_type_2 ?? null,
          early:       c?.early       ?? null,
          mid:         c?.mid         ?? null,
          late:        c?.late        ?? null,
        })
        if (c?.comp_type)   votes[c.comp_type]   = (votes[c.comp_type]   ?? 0) + 2  // primário vale 2
        if (c?.comp_type_2) votes[c.comp_type_2] = (votes[c.comp_type_2] ?? 0) + 1  // secundário vale 1
        for (let i = 0; i < 3; i++) {
          if (c?.[phases[i]] != null) { totals[i] += c[phases[i]]; counts[i]++ }
        }
      }

      if (!champions.length) return null

      const maxVotes = Object.values(votes).length ? Math.max(...Object.values(votes)) : 0
      const winners  = Object.keys(votes).filter(k => votes[k] === maxVotes)
      const compType = winners.length === 1 ? winners[0] : (winners.length > 1 ? 'Mix' : null)
      const scaling  = totals.map((t, i) => counts[i] ? (t / counts[i] >= 7/5 ? 2 : t / counts[i] >= 3/5 ? 1 : 0) : null)
      const voteList = Object.entries(votes).map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n)

      return { compType, scaling, voteList, champions }
    },

    get ourSuggestion()   {
      if (this.ourChamps.filter(s   => s.name).length < 3) return null
      return this._computeSuggestion(this.ourChamps)
    },

    get enemySuggestion() {
      if (this.enemyChamps.filter(s => s.name).length < 3) return null
      return this._computeSuggestion(this.enemyChamps)
    },

    // ── Apply data from Riot assistant ─────────────────────────────────────
    applyFromRiot(data) {
      if (data.date && !this.date) this.date = data.date
      if (data.win != null) this.win      = data.win
      if (data.side)        this.side     = data.side
      if (data.duration)    this.duration = data.duration

      if (data.topPlayerId) this.topPlayer = data.topPlayerId

      const champsByName = Object.fromEntries(
        Alpine.store('champions').list.map(c => [c.name, c])
      )

      if (data.ourChamps?.length) {
        data.ourChamps.slice(0, 5).forEach((c, i) => {
          const found = champsByName[c.name]
          this.ourChamps[i].name  = c.name
          this.ourChamps[i].key   = found?.key ?? c.key ?? ''
          this.ourChamps[i].query = c.name
        })
      }

      if (data.enemyChamps?.length) {
        data.enemyChamps.slice(0, 5).forEach((c, i) => {
          const found = champsByName[c.name]
          this.enemyChamps[i].name  = c.name
          this.enemyChamps[i].key   = found?.key ?? c.key ?? ''
          this.enemyChamps[i].query = c.name
        })
      }

      if (data.mvpId) this.mvp = data.mvpId

      if (data.mvcChampName) {
        const mvc = champsByName[data.mvcChampName]
        if (mvc) {
          this.mvcId      = mvc.id
          this.mvcKey     = mvc.key ?? ''
          this.mvcDisplay = mvc.name
        }
      }

      if (data.teamKills   != null) this.teamKills   = data.teamKills
      if (data.teamDeaths  != null) this.teamDeaths  = data.teamDeaths
      if (data.teamAssists != null) this.teamAssists = data.teamAssists
      if (data.matchId)             this.riotMatchId = data.matchId
      if (data.gd10        != null) this.gd10        = data.gd10
      if (data.gd20        != null) this.gd20        = data.gd20
      if (data.gdF         != null) this.gdF         = data.gdF
      if (data.totalGold   != null) this.totalGold   = data.totalGold
      if (data.goldPerMin  != null) this.goldPerMin  = data.goldPerMin
      if (data.damage      != null) this.damage      = data.damage
      if (data.dadi        != null) this.dadi        = data.dadi
      if (data.wardsPerMin != null) this.wardsPerMin = data.wardsPerMin
      if (data.visionScore != null) this.visionScore = data.visionScore
      if (data.csTotal     != null) this.csTotal     = data.csTotal
      if (data.csPerMin    != null) this.csPerMin    = data.csPerMin
      if (data.firstBlood  != null) this.firstBlood  = data.firstBlood
      if (data.firstTower  != null) this.firstTower  = data.firstTower
      if (data.objFlow)             this.objFlow     = data.objFlow
      if (data.playerStats)         this.playerStats = data.playerStats
      if (data._snapshot)           this.riotSnapshot = data._snapshot
    },
  }))
})
