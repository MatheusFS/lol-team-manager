;(function () {
  const PB = 'http://127.0.0.1:8090'

  // ── Nav ───────────────────────────────────────────────────────────────────

  const NAV_ITEMS = [
    { href: '/index.html',       label: 'Histórico' },
    { href: '/pages/stats.html', label: 'Estatísticas' },
    { href: null,                label: 'Análise de Draft' },
    { href: null,                label: 'Pool de Campeões' },
  ]

  function isActive(href) {
    const p = location.pathname
    if (href === '/index.html') return p === '/' || p === '/index.html'
    return p === href || p.startsWith(href.replace(/\.html$/, ''))
  }

  function buildNav() {
    const items = NAV_ITEMS.map(item => {
      if (!item.href)
        return `<span class="text-slate-500 cursor-not-allowed">${item.label}</span>`
      const active = isActive(item.href)
      return `<a href="${item.href}" class="${active ? 'text-yellow-400 font-medium' : 'text-slate-300 hover:text-slate-100'}">${item.label}</a>`
    }).join('')

    return `<nav class="bg-slate-900 border-b border-slate-800">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <a href="/index.html" class="font-bold text-yellow-500 tracking-wide">⚔ Clash Manager</a>
        <div class="flex gap-6 text-sm">${items}</div>
      </div>
    </nav>`
  }

  // ── Alert bar ─────────────────────────────────────────────────────────────

  const DISMISS_KEY = 'missing-alert-dismissed'

  async function checkAlerts() {
    const today = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem(DISMISS_KEY) === today) return
    try {
      const res  = await fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${encodeURIComponent('gd_f = null && team_kills = null')}`)
      const data = await res.json()
      if (data.totalItems > 0) showAlert(data.totalItems)
    } catch (_) {}
  }

  function showAlert(count) {
    const bar = document.createElement('div')
    bar.innerHTML = `
      <div class="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <div class="flex items-center gap-3 min-w-0 flex-wrap">
          <span class="text-amber-400 shrink-0">⚠</span>
          <span class="text-slate-300">
            <span class="font-semibold text-amber-300">${count}</span>
            partidas com dados de desempenho incompletos (ouro, K/D, dano).
          </span>
          <a href="/pages/import.html"
             class="shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-3 py-0.5 rounded text-xs transition-colors">
            Importar Dados →
          </a>
        </div>
        <button id="_alert-dismiss" class="text-slate-500 hover:text-slate-200 text-xl leading-none shrink-0">×</button>
      </div>`

    const nav = document.querySelector('nav')
    if (nav) nav.after(bar)
    else document.body.prepend(bar)

    document.getElementById('_alert-dismiss').addEventListener('click', () => {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString().slice(0, 10))
      bar.remove()
    })
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // Always the first child of <body>, so document.body exists — run now so
  // nav is in the DOM before Alpine initialises and removes x-cloak.

  document.body.insertAdjacentHTML('afterbegin', buildNav())
  checkAlerts()
})()
