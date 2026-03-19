document.addEventListener('alpine:init', () => {
  Alpine.data('matchForm', () => ({

    // ── Constants ──────────────────────────────────────────────────────────
    ROLES:        ['Top', 'Jungle', 'Mid', 'ADC', 'Support'],
    PLAYERS:      ['Klebão','GdN','Conkreto','Digo','Kelly','Pixek','Nunes','Eden','Xuao'],
    SUBTYPES:     ['Siege','Protect','Engage','Split','Pick','Dive','Reset','Mix'],
    SCALE_COLORS: ['🔴','🟡','🟢'],
    SCALE_SLOTS:  ['Early','Mid','Late'],

    // ── Identity ───────────────────────────────────────────────────────────
    editId: null,
    isEdit: false,

    // ── Info ───────────────────────────────────────────────────────────────
    date:   '',
    game_n: 1,
    win:    null,   // true | false | null
    side:   null,   // 'Red' | 'Blue' | null

    // ── Lineup ────────────────────────────────────────────────────────────
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
    teamKills:  '',
    teamDeaths: '',

    // ── Stats ──────────────────────────────────────────────────────────────
    gd10:        '',
    gd20:        '',
    gdF:         '',
    totalGold:   '',
    goldPerMin:  '',
    damage:      '',
    dadi:        '',
    wardsPerMin: '',
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
      await Alpine.store('champions').load()
      const params = new URLSearchParams(location.search)
      this.editId  = params.get('id')
      this.isEdit  = !!this.editId
      if (this.isEdit) {
        await this.loadMatch()
      } else {
        this.date = new Date().toISOString().slice(0, 10)
      }
      // Apply prefill from match lookup page (after loadMatch so it can override blanks)
      const raw = localStorage.getItem('match-assistant-prefill')
      if (raw) {
        try { this.applyFromRiot(JSON.parse(raw)) } catch (e) { console.warn('prefill error', e) }
        localStorage.removeItem('match-assistant-prefill')
      }
    },

    // ── Scaling ────────────────────────────────────────────────────────────
    pickScaling(arr, si, ci) {
      arr[si].ci = ci
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
      try {
        const m = await api.col('matches').get(this.editId, { expand: 'mvc' })

        this.date       = m.date?.slice(0, 10) ?? ''
        this.game_n     = m.game_n ?? 1
        this.win        = m.win   ?? null
        this.side       = m.side  ?? null
        this.topPlayer  = m.top_player ?? ''
        this.compType   = m.comp_type  ?? ''
        this.enemyType  = m.enemy_type ?? ''
        this.compSubtype = Array.isArray(m.comp_subtype) ? m.comp_subtype : []
        this.duration   = m.duration   ?? ''
        this.mvp        = m.mvp        ?? ''
        this.teamKills  = m.team_kills  ?? ''
        this.teamDeaths = m.team_deaths ?? ''
        this.gd10       = m.gd_10       ?? ''
        this.gd20       = m.gd_20       ?? ''
        this.gdF        = m.gd_f        ?? ''
        this.totalGold  = m.total_gold  ?? ''
        this.goldPerMin = m.gold_per_min ?? ''
        this.damage     = m.damage       ?? ''
        this.dadi       = m.da_di        ?? ''
        this.wardsPerMin = m.wards_per_min ?? ''
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
        const num = v => (v !== '' && v != null) ? +v : undefined
        const str = v => (typeof v === 'string' ? v.trim() : String(v ?? '')).trim() || undefined

        const payload = {
          date:          this.date + ' 00:00:00.000Z',
          game_n:        +this.game_n,
          win:           this.win,
          side:          this.side       ?? undefined,
          top_player:    str(this.topPlayer),
          comp_type:     str(this.compType),
          comp_subtype:  this.compSubtype.length ? this.compSubtype : undefined,
          scaling:       this.scalingToStr(this.scaling)      || undefined,
          enemy_type:    str(this.enemyType),
          enemy_scaling: this.scalingToStr(this.enemyScaling) || undefined,
          duration:      num(this.duration),
          mvp:           str(this.mvp),
          mvc:           this.mvcId || undefined,
          team_kills:    num(this.teamKills),
          team_deaths:   num(this.teamDeaths),
          gd_10:         num(this.gd10),
          gd_20:         num(this.gd20),
          gd_f:          num(this.gdF),
          total_gold:    num(this.totalGold),
          gold_per_min:  num(this.goldPerMin),
          damage:        num(this.damage),
          da_di:         num(this.dadi),
          wards_per_min: num(this.wardsPerMin),
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

    // ── Apply data from Riot assistant ─────────────────────────────────────
    applyFromRiot(data) {
      if (data.date)        this.date     = data.date
      if (data.win != null) this.win      = data.win
      if (data.side)        this.side     = data.side
      if (data.duration)    this.duration = data.duration

      if (data.topPlayer)   this.topPlayer = data.topPlayer

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

      if (data.mvp) this.mvp = data.mvp

      if (data.mvcChampName) {
        const mvc = champsByName[data.mvcChampName]
        if (mvc) {
          this.mvcId      = mvc.id
          this.mvcKey     = mvc.key ?? ''
          this.mvcDisplay = mvc.name
        }
      }

      if (data.teamKills  != null) this.teamKills  = data.teamKills
      if (data.teamDeaths != null) this.teamDeaths = data.teamDeaths
      if (data.gd10       != null) this.gd10       = data.gd10
      if (data.gd20       != null) this.gd20       = data.gd20
      if (data.gdF        != null) this.gdF        = data.gdF
      if (data.totalGold  != null) this.totalGold  = data.totalGold
      if (data.goldPerMin != null) this.goldPerMin = data.goldPerMin
      if (data.damage     != null) this.damage     = data.damage
      if (data.dadi       != null) this.dadi       = data.dadi
      if (data.wardsPerMin != null) this.wardsPerMin = data.wardsPerMin
      if (data.objFlow)             this.objFlow    = data.objFlow
    },
  }))
})
