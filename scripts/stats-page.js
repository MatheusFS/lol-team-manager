// ── Chart.js global defaults ──────────────────────────────────────────────────
Chart.defaults.color          = '#94a3b8'
Chart.defaults.borderColor    = '#1e293b'
Chart.defaults.font.size      = 12
Chart.defaults.plugins.legend.display = false

// ── Wilson CI error bar plugin ────────────────────────────────────────────────
Chart.register({
  id: 'ciWhiskers',
  afterDatasetsDraw(chart) {
    const { ctx } = chart
    chart.data.datasets.forEach((ds, di) => {
      if (!ds._ci) return
      const meta = chart.getDatasetMeta(di)
      const isH  = chart.options.indexAxis === 'y'
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth   = 1.5
      meta.data.forEach((bar, j) => {
        const ci = ds._ci[j]
        if (!ci || ci.lo == null) return
        if (isH) {
          const x1 = chart.scales.x.getPixelForValue(ci.lo * 100)
          const x2 = chart.scales.x.getPixelForValue(ci.hi * 100)
          const y  = bar.y, c = 4
          ctx.beginPath()
          ctx.moveTo(x1, y-c); ctx.lineTo(x1, y+c)
          ctx.moveTo(x2, y-c); ctx.lineTo(x2, y+c)
          ctx.moveTo(x1, y);   ctx.lineTo(x2, y)
          ctx.stroke()
        } else {
          const y1 = chart.scales.y.getPixelForValue(ci.lo * 100)
          const y2 = chart.scales.y.getPixelForValue(ci.hi * 100)
          const x  = bar.x, c = 4
          ctx.beginPath()
          ctx.moveTo(x-c, y1); ctx.lineTo(x+c, y1)
          ctx.moveTo(x-c, y2); ctx.lineTo(x+c, y2)
          ctx.moveTo(x,   y1); ctx.lineTo(x,   y2)
          ctx.stroke()
        }
      })
      ctx.restore()
    })
  }
})

// ── Chart helpers (module-level, called from Alpine init) ─────────────────────

const COMP_EMOJI_STATS = { Protect:'🛡️', Pick:'🔪', Split:'🔀', Siege:'🌀', Engage:'💥', Mix:'🌫️' }

function mean(arr) { return arr.length ? arr.reduce((s,v) => s+v, 0) / arr.length : null }

function baseOpts(isH) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    ...(isH ? { indexAxis: 'y' } : {}),
    scales: {
      [isH ? 'x' : 'y']: {
        min: 0, max: 100,
        ticks: { callback: v => v + '%', stepSize: 25 },
        grid:  { color: 'rgba(51,65,85,0.5)' },
      },
      [isH ? 'y' : 'x']: { grid: { display: false } },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: ctx => {
            const ds = ctx.dataset
            const ci = ds._ci?.[ctx.dataIndex]
            const n  = ds._n?.[ctx.dataIndex]
            const w  = ds._w?.[ctx.dataIndex]
            const v  = ctx.parsed[isH ? 'x' : 'y']
            const ciStr = ci?.lo != null ? `  IC ${utils.pct(ci.lo)}–${utils.pct(ci.hi)}%` : ''
            const nStr  = n  != null     ? `  (${w}V / ${n-w}D, N=${n})` : ''
            return ` ${v}%${ciStr}${nStr}`
          },
        },
      },
    },
  }
}

function winRateChart(canvasId, stats, isH = true, extraOpts = {}) {
  new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: stats.map(s => {
        const e    = COMP_EMOJI_STATS[s.label] ?? ''
        const warn = s.n < 5 ? ' ⚠️' : ''
        return `${e}${e?' ':''}${s.label}${warn}  N=${s.n}`
      }),
      datasets: [{
        data:            stats.map(s => utils.pct(s.rate) ?? 0),
        backgroundColor: stats.map(s => utils.rateColor(s.rate ?? 0, s.n)),
        borderRadius: 4,
        _ci: stats.map(s => ({ lo: s.lo, hi: s.hi })),
        _n:  stats.map(s => s.n),
        _w:  stats.map(s => s.wins),
      }],
    },
    options: { ...baseOpts(isH), ...extraOpts },
  })
}

function buildTeamCharts(M) {
  const total  = M.length
  const wins   = M.filter(m => m.win).length
  const { rate, lo, hi } = utils.wilson(wins, total)
  const durM   = M.filter(m => m.duration)
  const avgDur = mean(durM.map(m => m.duration))

  const compStats = utils.groupWR(M, m => m.comp_type)
  const bestComp  = compStats.filter(s => s.n >= 5).sort((a,b) => b.lo - a.lo)[0]

  document.getElementById('overview').innerHTML = [
    { label: 'Total de Partidas', big: total, cls: 'text-slate-200' },
    { label: 'Aproveitamento', big: `${utils.pct(rate)}%`,
      sub: `95% IC: ${utils.pct(lo)}–${utils.pct(hi)}%`,
      cls: rate >= 0.5 ? 'text-green-400' : 'text-red-400' },
    { label: 'Saldo', big: `${wins}V – ${total-wins}D`, cls: 'text-slate-200' },
    { label: 'Duração Média', big: avgDur ? `${Math.round(avgDur)}m` : '—',
      sub: `N=${durM.length} partidas`, cls: 'text-slate-200' },
    { label: 'Melhor Comp (N≥5)',
      big: bestComp ? `${COMP_EMOJI_STATS[bestComp.label]} ${bestComp.label}` : '—',
      sub: bestComp ? `${utils.pct(bestComp.rate)}%  IC: ${utils.pct(bestComp.lo)}–${utils.pct(bestComp.hi)}%` : '',
      cls: 'text-yellow-400' },
  ].map(c => `
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div class="text-xs text-slate-400 mb-1">${c.label}</div>
      <div class="text-2xl font-bold ${c.cls}">${c.big}</div>
      ${c.sub ? `<div class="text-xs text-slate-500 mt-0.5">${c.sub}</div>` : ''}
    </div>`).join('')

  winRateChart('c-comp-type',  compStats)
  winRateChart('c-enemy-type', utils.groupWR(M, m => m.enemy_type))

  const gnStats = utils.groupWR(M, m => String(m.game_n)).sort((a,b) => +a.label - +b.label)
  winRateChart('c-game-n', gnStats.map(s => ({ ...s, label: `J${s.label}` })), false)

  const ss = utils.groupWR(M, m => m.side).sort((a,b) => a.label.localeCompare(b.label))
  new Chart(document.getElementById('c-side'), {
    type: 'bar',
    data: {
      labels: ss.map(s => `${s.label === 'Red' ? '🟥' : '🟦'} ${s.label}  N=${s.n}`),
      datasets: [{
        data:            ss.map(s => utils.pct(s.rate)),
        backgroundColor: ss.map(s => s.label === 'Red' ? 'rgba(248,113,113,0.78)' : 'rgba(96,165,250,0.78)'),
        borderRadius: 4,
        _ci: ss.map(s => ({ lo: s.lo, hi: s.hi })),
        _n:  ss.map(s => s.n),
        _w:  ss.map(s => s.wins),
      }],
    },
    options: baseOpts(false),
  })

  const order   = ['<25m', '25–35m', '35–45m', '45m+']
  const buckets = { '<25m':{wins:0,n:0}, '25–35m':{wins:0,n:0}, '35–45m':{wins:0,n:0}, '45m+':{wins:0,n:0} }
  for (const m of M) {
    if (!m.duration) continue
    const k = m.duration < 25 ? '<25m' : m.duration < 35 ? '25–35m' : m.duration < 45 ? '35–45m' : '45m+'
    buckets[k].n++; if (m.win) buckets[k].wins++
  }
  winRateChart('c-duration', order.map(k => {
    const { wins, n } = buckets[k]
    return { label: `${k}  N=${n}`, wins, n, ...utils.wilson(wins, n) }
  }), false)
}

function buildPlayerCharts(M) {
  const mvpGames = M.filter(m => m.mvp)
  const topGames = M.filter(m => m.top_player)
  document.getElementById('mvp-n').textContent = mvpGames.length
  document.getElementById('top-n').textContent = topGames.length

  const freq = {}
  for (const m of mvpGames) freq[m.mvp] = (freq[m.mvp] ?? 0) + 1
  const sortedMvp = Object.entries(freq).sort((a,b) => b[1]-a[1])
  new Chart(document.getElementById('c-mvp-freq'), {
    type: 'bar',
    data: {
      labels:   sortedMvp.map(([p,n]) => `${p}  (${n})`),
      datasets: [{
        data:            sortedMvp.map(([,n]) => Math.round(n/M.length*100)),
        backgroundColor: 'rgba(234,179,8,0.75)',
        borderRadius: 4,
      }],
    },
    options: { ...baseOpts(false), plugins: { tooltip: { callbacks: {
      label: ctx => ` ${ctx.parsed.y}% de todas as partidas`,
    }}}},
  })

  winRateChart('c-mvp-wr',    utils.groupWR(mvpGames, m => m.mvp))
  winRateChart('c-top-player', utils.groupWR(topGames, m => m.top_player))

  const mvcFreq = {}
  for (const m of M) {
    const name = m.expand?.mvc?.name
    if (name) mvcFreq[name] = (mvcFreq[name] ?? 0) + 1
  }
  const sortedMvc = Object.entries(mvcFreq).sort((a,b) => b[1]-a[1]).slice(0, 12)
  new Chart(document.getElementById('c-mvc'), {
    type: 'bar',
    data: {
      labels:   sortedMvc.map(([name,n]) => `${name}  (${n})`),
      datasets: [{
        data:            sortedMvc.map(([,n]) => n),
        backgroundColor: 'rgba(234,179,8,0.6)',
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { stepSize:1 }, grid: { color:'rgba(51,65,85,0.5)' } },
        y: { grid: { display:false } },
      },
      plugins: { tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x}× como MVC` } } },
    },
  })
}

// ── Alpine component ──────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('statsPage', () => ({
    activeTab: 'team',

    async init() {
      const data = await api.col('matches').list({ perPage: 500, expand: 'mvc' })
      const M    = data.items
      buildTeamCharts(M)
      buildPlayerCharts(M)
    },

    tab(which) { this.activeTab = which },
  }))
})
