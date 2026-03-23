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
        const params = { sort: '-date,game_n', expand: 'mvc,formation,mvp', perPage: 25, page: this.page }
        if (filter) params.filter = filter

        const [matchRes, statsRes] = await Promise.all([
          api.col('matches').list(params),
          this._fetchStats(filter),
        ])

         this.matches    = matchRes.items

         // ── Novo algoritmo de agrupamento por proximidade de datas ──
         // Uma sessão = sequência contígua de partidas com intervalos ≤ 2 dias
         // Independente de game_n (robusto a duplicatas game_n=1)
         const sorted = [...this.matches].sort((a, b) => a.date.localeCompare(b.date))
         const rawSessions = []

         for (const match of sorted) {
           if (!rawSessions.length) {
             // Primeira sessão
             rawSessions.push({ startDate: match.date, games: [match] })
           } else {
             const lastSession = rawSessions[rawSessions.length - 1]
             const lastMatch = lastSession.games[lastSession.games.length - 1]
             const daysBetween = Math.abs(
               (new Date(match.date) - new Date(lastMatch.date)) / 86400000
             )
             if (daysBetween <= 2) {
               // Adicionar à sessão atual
               lastSession.games.push(match)
             } else {
               // Nova sessão
               rawSessions.push({ startDate: match.date, games: [match] })
             }
           }
         }

         // Ordenar sessões por data descente (mais recentes primeiro)
         rawSessions.sort((a, b) => b.startDate.localeCompare(a.startDate))

         // Ordenar jogos dentro de cada sessão por game_n crescente, depois por date
         for (const s of rawSessions) {
           s.games.sort((a, b) => {
             const gnA = a.game_n ?? 0, gnB = b.game_n ?? 0
             return gnA !== gnB ? gnA - gnB : a.date.localeCompare(b.date)
           })
         }

          // Construir displayMatches com separadores (incluir _sessionIdx para unicidade de key)
          this.displayMatches = []
          for (let sessionIdx = 0; sessionIdx < rawSessions.length; sessionIdx++) {
            const s = rawSessions[sessionIdx]
            const wins = s.games.filter(g => g.win).length
            this.displayMatches.push({
              _isSep: true,
              date: s.startDate,
              count: s.games.length,
              wins,
              _sessionIdx: sessionIdx,
            })
            for (const g of s.games) this.displayMatches.push(g)
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
