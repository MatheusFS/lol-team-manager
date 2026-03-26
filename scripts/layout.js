;(function () {
  const PB = 'http://127.0.0.1:8090'

  // ── Nav ───────────────────────────────────────────────────────────────────

  const PAGE_ITEMS = [
    { href: '/index.html',       label: '📋 Histórico' },
    { href: '/pages/stats.html', label: '📊 Estatísticas' },
    { href: '/pages/draft.html', label: '🗡️ Assistente de Draft' },
  ]

  const CONFIG_ITEMS = [
    { href: '/pages/champions.html', label: '👑 Campeões' },
    { href: '/pages/players.html',   label: '👥 Jogadores' },
    { href: '/pages/champion-pool.html', label: '🎯 Pool de Campeões' },
    { href: '/pages/import.html',    label: '📥 Importar' },
    { href: '/pages/team.html',      label: '🛡️ Formações' },
    { href: '/pages/rank-config.html', label: '📊 Calibração de Rank' },
    { href: '/pages/repair-snapshots.html', label: '🔧 Reparar Snapshots' },
  ]

  function isActive(href) {
    const p = location.pathname
    if (href === '/index.html') return p === '/' || p === '/index.html'
    return p === href || p.startsWith(href.replace(/\.html$/, ''))
  }

  function buildNav() {
    const pageLinks = PAGE_ITEMS.map(item => {
      if (!item.href)
        return `<span class="text-slate-500 cursor-not-allowed">${item.label}</span>`
      const active = isActive(item.href)
      return `<a href="${item.href}" class="${active ? 'text-yellow-400 font-medium' : 'text-slate-300 hover:text-slate-100'}">${item.label}</a>`
    }).join('')

    const configActive = CONFIG_ITEMS.some(i => isActive(i.href))
    const configLinks = CONFIG_ITEMS.map(item => {
      const active = isActive(item.href)
      return `<a href="${item.href}" class="block px-4 py-1.5 ${active ? 'text-yellow-400 font-medium' : 'text-slate-300 hover:text-slate-100'}">${item.label}</a>`
    }).join('')

    const dropdown = `<div class="relative group">
        <span class="cursor-default ${configActive ? 'text-yellow-400 font-medium' : 'text-slate-300 hover:text-slate-100'} flex items-center gap-1 select-none">⚙️ Configurações <span class="text-xs">▾</span></span>
        <div class="absolute hidden group-hover:block right-0 top-full pt-1 z-50">
          <div class="bg-slate-800 border border-slate-700 rounded shadow-xl py-1 min-w-[10rem]">
            ${configLinks}
          </div>
        </div>
      </div>`

    return `<nav class="bg-slate-900 border-b border-slate-800">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <a href="/index.html" class="font-bold text-yellow-500 tracking-wide">⚔ Clash Manager</a>
        <div class="flex gap-6 text-sm items-center">${pageLinks}${dropdown}</div>
      </div>
    </nav>`
  }

  // ── Alert bar ─────────────────────────────────────────────────────────────

  const DISMISS_KEY = 'missing-alert-dismissed'

  async function checkAlerts() {
    localStorage.removeItem(DISMISS_KEY)   // limpa dismiss antigo de versões anteriores
    if (sessionStorage.getItem(DISMISS_KEY)) return
    try {
      const enc = s => encodeURIComponent(s)
      const [r1, r2] = await Promise.all([
        fetch(`${PB}/api/collections/matches/records?perPage=1&fields=id&filter=${enc('gd_f = null')}`).then(r => r.json()),
        fetch(`${PB}/api/collections/matches/records?perPage=1&fields=id&filter=${enc('team_kills = null')}`).then(r => r.json()),
      ])
      const total = Math.max(r1.totalItems ?? 0, r2.totalItems ?? 0)
      if (total > 0) showAlert(total)
    } catch (e) {
      console.warn('[layout] checkAlerts falhou:', e)
    }
  }

  function showAlert(count) {
    const bar = document.createElement('div')
    bar.innerHTML = `
      <div class="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <div class="flex items-center gap-3 min-w-0 flex-wrap">
          <span class="text-amber-400 shrink-0">⚠️</span>
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
      sessionStorage.setItem(DISMISS_KEY, '1')
      bar.remove()
    })
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // Always the first child of <body>, so document.body exists — run now so
  // nav is in the DOM before Alpine initialises and removes x-cloak.

  document.body.insertAdjacentHTML('afterbegin', buildNav())
  checkAlerts()
})()
