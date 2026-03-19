document.addEventListener('alpine:init', () => {
  Alpine.data('matchList', () => ({

    COMP_EMOJI: { Protect:'🔼', Pick:'🔪', Split:'🔀', Siege:'🌀', Engage:'💥', Mix:'⚠' },

    // ── Filters ────────────────────────────────────────────────────────────
    fResult: '',
    fSide:   '',
    fComp:   '',
    fFrom:   '',
    fTo:     '',

    // ── Data ───────────────────────────────────────────────────────────────
    matches:    [],
    total:      0,
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
    init() {
      // Load champions so ddragon version is resolved for champion icons
      Alpine.store('champions').load()
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
      return parts.join(' && ')
    },

    applyFilters() { this.page = 1; this.load() },

    clearFilters() {
      this.fResult = ''; this.fSide = ''; this.fComp = ''
      this.fFrom   = ''; this.fTo   = ''
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
        const params = { sort: '-date,-game_n', expand: 'mvc', perPage: 25, page: this.page }
        if (filter) params.filter = filter

        const [matchRes, statsRes] = await Promise.all([
          api.col('matches').list(params),
          this._fetchStats(filter),
        ])

        this.matches    = matchRes.items
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
    compLabel(t) { return t ? `${this.COMP_EMOJI[t] ?? ''} ${t}` : '' },
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
