document.addEventListener('alpine:init', () => {
  Alpine.data('matchList', () => ({

    // ── Filters ────────────────────────────────────────────────────────────
    fResult:    '',
    fSide:      '',
    fComp:      '',
    fFrom:      '',
    fTo:        '',
    fFormation: '',

    // ── Data ───────────────────────────────────────────────────────────────
    formations: [],
    matches:        [],
    displayMatches: [],
    total:          0,
    wins:       0,
    page:       1,
    totalPages: 1,

    // ── UI ─────────────────────────────────────────────────────────────────
    loading: true,
    msg:     '',

    // ── Computed ───────────────────────────────────────────────────────────
    get losses()  { return this.total - this.wins },
    get wr()      { return this.total > 0 ? Math.round(this.wins / this.total * 100) : 0 },
    get hasPrev() { return this.page > 1 },
    get hasNext() { return this.page < this.totalPages },
    get showPagination() { return this.totalPages > 1 },

    // ── Init ───────────────────────────────────────────────────────────────
    async init() {
      const [,fData] = await Promise.all([
        Alpine.store('champions').load(),
        api.col('formations').list({ sort: '-active,name', perPage: 100 }),
      ])
      this.formations = fData.items
      this.load()
    },

    // ── Filter helpers ─────────────────────────────────────────────────────
    buildFilter() {
      const parts = []
      if (this.fResult !== '') parts.push(`win=${this.fResult}`)
      if (this.fSide)          parts.push(`side='${this.fSide}'`)
      if (this.fComp)          parts.push(`comp_type='${this.fComp}'`)
      if (this.fFrom)          parts.push(`date>='${this.fFrom} 00:00:00.000Z'`)
      if (this.fTo)            parts.push(`date<='${this.fTo} 23:59:59.000Z'`)
      if (this.fFormation)     parts.push(`formation='${this.fFormation}'`)
      return parts.join(' && ')
    },

    applyFilters() { this.page = 1; this.load() },

    clearFilters() {
      this.fResult = ''; this.fSide = ''; this.fComp = ''
      this.fFrom   = ''; this.fTo   = ''; this.fFormation = ''
      this.page = 1; this.load()
    },

    changePage(d) {
      this.page = Math.max(1, Math.min(this.totalPages, this.page + d))
      this.load()
    },

    // ── Data loading ───────────────────────────────────────────────────────
    async load() {
      this.loading = true
      this.msg     = 'Carregando…'
      const filter = this.buildFilter()
      try {
        const params = { sort: '-date,game_n', expand: 'mvc', perPage: 25, page: this.page }
        if (filter) params.filter = filter

        const [matchRes, statsRes] = await Promise.all([
          api.col('matches').list(params),
          this._fetchStats(filter),
        ])

        this.matches    = matchRes.items

        // Agrupar por game_n
        const byGameN = {}
        for (const m of this.matches) {
          const gn = m.game_n ?? 0
          if (!byGameN[gn]) byGameN[gn] = []
          byGameN[gn].push(m)
        }

        // Para cada J1 (mais antigo primeiro), pegar consecutivos dentro de 2 dias
        const usedIds = new Set()
        const rawSessions = []
        const starts = [...(byGameN[1] ?? [])].sort((a, b) => a.date.localeCompare(b.date))

        for (const start of starts) {
          if (usedIds.has(start.id)) continue
          const games = [start]
          usedIds.add(start.id)
          let gn = 2
          while (byGameN[gn]) {
            const candidates = byGameN[gn].filter(m => !usedIds.has(m.id))
            if (!candidates.length) break
            const lastDate = new Date(games[games.length - 1].date)
            candidates.sort((a, b) =>
              Math.abs(new Date(a.date) - lastDate) - Math.abs(new Date(b.date) - lastDate)
            )
            const pick = candidates[0]
            if (Math.abs((new Date(pick.date) - lastDate) / 86400000) > 2) break
            games.push(pick)
            usedIds.add(pick.id)
            gn++
          }
          rawSessions.push({ startDate: start.date, games })
        }

        // Sessões mais recentes primeiro; jogos em ordem crescente de game_n (já estão)
        rawSessions.sort((a, b) => b.startDate.localeCompare(a.startDate))

        this.displayMatches = []
        for (const s of rawSessions) {
          const wins = s.games.filter(g => g.win).length
          this.displayMatches.push({ _isSep: true, date: s.startDate, count: s.games.length, wins })
          for (const g of s.games) this.displayMatches.push(g)
        }
        // Jogos sem game_n (registros antigos) ao final, sem separador
        for (const m of this.matches) {
          if (!usedIds.has(m.id)) this.displayMatches.push(m)
        }

        this.total      = statsRes.total
        this.wins       = statsRes.wins
        this.page       = matchRes.page
        this.totalPages = matchRes.totalPages
        this.loading    = false
        this.msg        = matchRes.items.length ? '' : 'Nenhuma partida encontrada.'
      } catch (e) {
        this.loading = false
        this.msg     = 'Falha ao carregar. O PocketBase está rodando?'
        console.error(e)
      }
    },

    async _fetchStats(filter) {
      const winFilter = filter ? `(${filter}) && win=true` : 'win=true'
      const params    = { perPage: 1 }
      const winParams = { perPage: 1, filter: winFilter }
      if (filter) params.filter = filter
      const [all, wins] = await Promise.all([
        api.col('matches').list(params),
        api.col('matches').list(winParams),
      ])
      return { total: all.totalItems, wins: wins.totalItems }
    },

    // ── Row display helpers ────────────────────────────────────────────────
    fmtDate(d)   { return d?.slice(0,10).split('-').reverse().join('/') ?? '—' },
    borderCls(w) { return w ? 'border-l-2 border-l-green-600' : 'border-l-2 border-l-red-700' },
    resultBg(w)  { return w ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400' },
    sideIcon(s)  { return s === 'Red' ? '🟥' : s === 'Blue' ? '🟦' : '—' },
    sideCls(s)   { return s === 'Red' ? 'text-red-400' : s === 'Blue' ? 'text-blue-400' : 'text-slate-600' },
    compLabel(t) { return t ? `${COMP_EMOJI[t] ?? ''} ${t}` : '' },
    fmtGold(v)   { return utils.fmtGold(v) },
    gdfCls(v)    { return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-400' },
    mvcName(m)   { return m.expand?.mvc?.name ?? '—' },
    mvcKey(m)    { return m.expand?.mvc?.key  ?? '' },
    champImg(key) { return champImgUrl(key) },

    async del(id) {
      if (!confirm('Excluir esta partida? Isso não pode ser desfeito.')) return
      try {
        await api.col('matches').delete(id)
        this.load()
      } catch (e) {
        alert('Falha ao excluir.')
      }
    },
  }))
})
