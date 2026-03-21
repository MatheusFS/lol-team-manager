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

// COMP_EMOJI comes from shared.js

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
  Chart.getChart(canvasId)?.destroy()
  new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: stats.map(s => {
        const e    = COMP_EMOJI[s.label] ?? ''
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
      big: bestComp ? `${COMP_EMOJI[bestComp.label]} ${bestComp.label}` : '—',
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
  Chart.getChart('c-side')?.destroy()
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

// ── GD@5 from snapshot ────────────────────────────────────────────────────────
function computeGD5(m) {
  const snap = m.riot_match_snapshot
  if (!snap?.timeline?.info?.frames?.[5]) return null
  const frame5 = snap.timeline.info.frames[5]
  const ourId  = m.side === 'Blue' ? 100 : 200
  const parts  = snap.match?.info?.participants ?? []
  const ourIds = new Set(parts.filter(p => p.teamId === ourId).map(p => String(p.participantId)))
  let our = 0, their = 0
  for (const [id, pf] of Object.entries(frame5.participantFrames ?? {})) {
    if (ourIds.has(id)) our += pf.totalGold; else their += pf.totalGold
  }
  return our - their
}

// ── Section: Mortes Cedo ──────────────────────────────────────────────────────
function buildDeathSection(M) {
  const fbM  = M.filter(m => m.first_blood != null)
  const dthM = M.filter(m => m.team_deaths != null)

  const fbW  = fbM.filter(m => m.first_blood && m.win).length
  const fbN  = fbM.filter(m => m.first_blood).length
  const nfbW = fbM.filter(m => !m.first_blood && m.win).length
  const nfbN = fbM.filter(m => !m.first_blood).length

  const fbRate  = fbN  ? fbW  / fbN  : null
  const nfbRate = nfbN ? nfbW / nfbN : null

  const avgDW = mean(dthM.filter(m => m.win).map(m => m.team_deaths))
  const avgDL = mean(dthM.filter(m => !m.win).map(m => m.team_deaths))

  const rateCls = r => r == null ? 'text-slate-400' : r >= 0.6 ? 'text-green-400' : r >= 0.4 ? 'text-yellow-400' : 'text-red-400'

  document.getElementById('death-cards').innerHTML = [
    { label: 'First Blood → Win%', big: fbRate != null ? `${utils.pct(fbRate)}%` : '—',
      sub: `N=${fbN}`, cls: rateCls(fbRate) },
    { label: 'Sem First Blood → Win%', big: nfbRate != null ? `${utils.pct(nfbRate)}%` : '—',
      sub: `N=${nfbN}`, cls: rateCls(nfbRate) },
    { label: 'Mortes avg — Vitórias', big: avgDW != null ? avgDW.toFixed(1) : '—',
      sub: `N=${dthM.filter(m=>m.win).length}`, cls: avgDW != null && avgDL != null && avgDW < avgDL ? 'text-green-400' : 'text-yellow-400' },
    { label: 'Mortes avg — Derrotas', big: avgDL != null ? avgDL.toFixed(1) : '—',
      sub: `N=${dthM.filter(m=>!m.win).length}`, cls: 'text-red-400' },
  ].map(c => `
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div class="text-xs text-slate-400 mb-1">${c.label}</div>
      <div class="text-2xl font-bold ${c.cls}">${c.big}</div>
      ${c.sub ? `<div class="text-xs text-slate-500 mt-0.5">${c.sub}</div>` : ''}
    </div>`).join('')
}

// ── Section: Gold Flow ────────────────────────────────────────────────────────
function buildGoldSection(M) {
  const gdM  = M.filter(m => m.gd_10 != null)
  const wGD  = gdM.filter(m => m.win)
  const lGD  = gdM.filter(m => !m.win)

  // GD@5 from snapshot
  const gd5M = M.map(m => ({ ...m, gd5: computeGD5(m) })).filter(m => m.gd5 != null)
  const gd5W = gd5M.filter(m => m.win)
  const gd5L = gd5M.filter(m => !m.win)

  const mg5W = mean(gd5W.map(m => m.gd5))
  const mg5L = mean(gd5L.map(m => m.gd5))
  const mg10W = mean(wGD.map(m => m.gd_10))
  const mg10L = mean(lGD.map(m => m.gd_10))
  const mg20W = mean(wGD.map(m => m.gd_20))
  const mg20L = mean(lGD.map(m => m.gd_20))
  const mgfW  = mean(wGD.filter(m => m.gd_f != null).map(m => m.gd_f))
  const mgfL  = mean(lGD.filter(m => m.gd_f != null).map(m => m.gd_f))

  const fmtGD = v => v != null ? utils.fmtGold(Math.round(v)) : '—'
  const gdCls = v => v == null ? 'text-slate-400' : v >= 0 ? 'text-green-400' : 'text-red-400'

  document.getElementById('gd-cards').innerHTML = [
    { label: `GD@5 — Vitórias`,  big: fmtGD(mg5W),  sub: `N=${gd5W.length} c/ timeline`, cls: gdCls(mg5W) },
    { label: `GD@5 — Derrotas`,  big: fmtGD(mg5L),  sub: `N=${gd5L.length} c/ timeline`, cls: gdCls(mg5L) },
    { label: `GD@10 — Vitórias`, big: fmtGD(mg10W), sub: `N=${wGD.length}`, cls: gdCls(mg10W) },
    { label: `GD@10 — Derrotas`, big: fmtGD(mg10L), sub: `N=${lGD.length}`, cls: gdCls(mg10L) },
  ].map(c => `
    <div class="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div class="text-xs text-slate-400 mb-1">${c.label}</div>
      <div class="text-2xl font-bold ${c.cls}">${c.big}</div>
      ${c.sub ? `<div class="text-xs text-slate-500 mt-0.5">${c.sub}</div>` : ''}
    </div>`).join('')

  if (!gdM.length) return

  Chart.getChart('c-gd-comparison')?.destroy()
  new Chart(document.getElementById('c-gd-comparison'), {
    type: 'bar',
    data: {
      labels: ['GD@5', 'GD@10', 'GD@20', 'GD@F'],
      datasets: [
        {
          label: 'Vitórias',
          data: [mg5W ?? 0, mg10W ?? 0, mg20W ?? 0, mgfW ?? 0],
          backgroundColor: 'rgba(74,222,128,0.75)',
          borderRadius: 4,
        },
        {
          label: 'Derrotas',
          data: [mg5L ?? 0, mg10L ?? 0, mg20L ?? 0, mgfL ?? 0],
          backgroundColor: 'rgba(248,113,113,0.75)',
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8' } },
        tooltip: { callbacks: { label: ctx => ` ${utils.fmtGold(Math.round(ctx.parsed.y))}` } },
      },
      scales: {
        y: {
          grid: { color: 'rgba(51,65,85,0.5)' },
          ticks: { callback: v => utils.fmtGold(v) },
        },
        x: { grid: { display: false } },
      },
    },
  })
}

// ── Section: Objetivos ────────────────────────────────────────────────────────
function buildObjectiveSection(M) {
  const parseObj = m => {
    if (!m.obj_flow) return null
    const parts = m.obj_flow.split('/').map(Number)
    return { t: parts[0]??0, v: parts[1]??0, g: parts[2]??0, d: parts[3]??0, b: parts[4]??0, i: parts[5]??0, n: parts[6]??0 }
  }

  const objM = M.map(m => ({ ...m, obj: parseObj(m) })).filter(m => m.obj != null)
  const oW   = objM.filter(m => m.win)
  const oL   = objM.filter(m => !m.win)

  // ── C1: Dragões ──
  const avgDragW = mean(oW.map(m => m.obj.d))
  const avgDragL = mean(oL.map(m => m.obj.d))

  const dragBuckets = { '0–1': {w:0,n:0}, '2': {w:0,n:0}, '3': {w:0,n:0}, '4+': {w:0,n:0} }
  for (const m of objM) {
    const d = m.obj.d
    const k = d <= 1 ? '0–1' : d === 2 ? '2' : d === 3 ? '3' : '4+'
    dragBuckets[k].n++; if (m.win) dragBuckets[k].w++
  }
  const soul3plus = objM.filter(m => m.obj.d >= 3)
  const soul3W    = soul3plus.filter(m => m.win).length

  const statCard = (label, big, sub, cls) => `
    <div class="bg-slate-800 rounded p-3 text-center">
      <div class="text-xs text-slate-400 mb-1">${label}</div>
      <div class="text-xl font-bold ${cls}">${big}</div>
      ${sub ? `<div class="text-xs text-slate-500 mt-0.5">${sub}</div>` : ''}
    </div>`

  const dragWR3 = soul3plus.length ? soul3W / soul3plus.length : null

  document.getElementById('obj-dragons').innerHTML = `
    <h3 class="text-sm font-semibold text-slate-200 mb-3">🐉 Dragões</h3>
    <div class="grid grid-cols-2 gap-2 mb-4">
      ${statCard('Drag médio — Vitórias', avgDragW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Drag médio — Derrotas', avgDragL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
      ${statCard('Win% com ≥3 Drags', dragWR3 != null ? `${utils.pct(dragWR3)}%` : '—', `N=${soul3plus.length}`, dragWR3==null?'text-slate-400':dragWR3>=0.6?'text-green-400':dragWR3>=0.4?'text-yellow-400':'text-red-400')}
      ${statCard('Win% com <3 Drags', objM.length-soul3plus.length ? `${utils.pct((objM.filter(m=>m.obj.d<3&&m.win).length)/(objM.length-soul3plus.length))}%` : '—', `N=${objM.length-soul3plus.length}`, 'text-slate-300')}
    </div>
    <table class="w-full text-xs text-slate-300">
      <thead><tr class="text-slate-500 border-b border-slate-700">
        <th class="text-left py-1">Dragões</th><th class="text-right py-1">Win%</th><th class="text-right py-1">N</th>
      </tr></thead>
      <tbody>
        ${['0–1','2','3','4+'].map(k => {
          const { w, n } = dragBuckets[k]
          const wr = n ? utils.pct(w/n) : null
          const cls = wr == null ? 'text-slate-500' : wr >= 60 ? 'text-green-400' : wr >= 40 ? 'text-yellow-400' : 'text-red-400'
          return `<tr class="border-b border-slate-800">
            <td class="py-1">${k}</td>
            <td class="text-right ${cls}">${wr != null ? wr+'%' : '—'}</td>
            <td class="text-right text-slate-500">${n}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`

  // ── C2: Estruturas Early ──
  const ftM  = M.filter(m => m.first_tower != null)
  const ftW  = ftM.filter(m => m.first_tower && m.win).length
  const ftN  = ftM.filter(m => m.first_tower).length
  const nftW = ftM.filter(m => !m.first_tower && m.win).length
  const nftN = ftM.filter(m => !m.first_tower).length
  const ftRate  = ftN  ? ftW  / ftN  : null
  const nftRate = nftN ? nftW / nftN : null

  const avgTW  = mean(oW.map(m => m.obj.t))
  const avgTL  = mean(oL.map(m => m.obj.t))
  const avgHW  = mean(oW.map(m => m.obj.g))
  const avgHL  = mean(oL.map(m => m.obj.g))

  const rateClass = r => r >= 0.6 ? 'text-green-400' : r >= 0.4 ? 'text-yellow-400' : 'text-red-400'

  document.getElementById('obj-structures').innerHTML = `
    <h3 class="text-sm font-semibold text-slate-200 mb-3">🏰 Estruturas Early (T1 + Herald)</h3>
    <div class="grid grid-cols-2 gap-2">
      ${statCard('First Tower → Win%', ftRate != null ? `${utils.pct(ftRate)}%` : '—', `N=${ftN}`, ftRate != null ? rateClass(ftRate) : 'text-slate-400')}
      ${statCard('Sem First Tower → Win%', nftRate != null ? `${utils.pct(nftRate)}%` : '—', `N=${nftN}`, nftRate != null ? rateClass(nftRate) : 'text-slate-400')}
      ${statCard('Torres avg — Vitórias', avgTW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Torres avg — Derrotas', avgTL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
      ${statCard('Herald avg — Vitórias', avgHW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Herald avg — Derrotas', avgHL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
    </div>`

  // ── C3: Objetivos Tardios ──
  const baronHave = objM.filter(m => m.obj.b > 0)
  const baronNone = objM.filter(m => m.obj.b === 0)
  const baronHaveWR = baronHave.length ? baronHave.filter(m => m.win).length / baronHave.length : null
  const baronNoneWR = baronNone.length ? baronNone.filter(m => m.win).length / baronNone.length : null

  const avgBW  = mean(oW.map(m => m.obj.b))
  const avgBL  = mean(oL.map(m => m.obj.b))
  const avgIW  = mean(oW.map(m => m.obj.i))
  const avgIL  = mean(oL.map(m => m.obj.i))

  document.getElementById('obj-late').innerHTML = `
    <h3 class="text-sm font-semibold text-slate-200 mb-3">👑 Objetivos Tardios (Barão + Inhib)</h3>
    <div class="grid grid-cols-2 gap-2">
      ${statCard('Win% com Barão', baronHaveWR != null ? `${utils.pct(baronHaveWR)}%` : '—', `N=${baronHave.length}`, baronHaveWR != null ? rateClass(baronHaveWR) : 'text-slate-400')}
      ${statCard('Win% sem Barão', baronNoneWR != null ? `${utils.pct(baronNoneWR)}%` : '—', `N=${baronNone.length}`, baronNoneWR != null ? rateClass(baronNoneWR) : 'text-slate-400')}
      ${statCard('Barão avg — Vitórias', avgBW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Barão avg — Derrotas', avgBL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
      ${statCard('Inhib avg — Vitórias', avgIW?.toFixed(1) ?? '—', `N=${oW.length}`, 'text-green-400')}
      ${statCard('Inhib avg — Derrotas', avgIL?.toFixed(1) ?? '—', `N=${oL.length}`, 'text-red-400')}
    </div>`
}

// ── Table: Mortes por Jogador ─────────────────────────────────────────────────
function buildDeathTable(M) {
  const riotM = M.filter(m => m.player_stats?.length)
  if (!riotM.length) {
    document.getElementById('player-death-table').innerHTML =
      '<p class="text-xs text-slate-500">Sem partidas com dados Riot API.</p>'
    return
  }

  const map = {}
  for (const m of riotM) {
    for (const ps of m.player_stats) {
      if (!ps.name) continue
      const p = map[ps.name] ??= { n:0, deathsTotal:0, deathsW:0, nW:0, deathsL:0, nL:0, fbKills:0 }
      p.n++
      p.deathsTotal += ps.deaths ?? 0
      if (m.win) { p.deathsW += ps.deaths ?? 0; p.nW++ }
      else        { p.deathsL += ps.deaths ?? 0; p.nL++ }
      if (ps.firstBlood) p.fbKills++
    }
  }

  const rows = Object.entries(map)
    .map(([name, p]) => ({
      name,
      n:       p.n,
      avgD:    p.n    ? p.deathsTotal / p.n    : 0,
      avgDW:   p.nW   ? p.deathsW     / p.nW   : 0,
      avgDL:   p.nL   ? p.deathsL     / p.nL   : 0,
      fbKills: p.fbKills,
    }))
    .sort((a, b) => b.avgD - a.avgD)

  const deathCls = v => v > 4 ? 'text-red-400 font-semibold' : v > 2.5 ? 'text-yellow-400' : 'text-green-400'

  document.getElementById('player-death-table').innerHTML = `
    <table class="w-full text-sm text-slate-300">
      <thead><tr class="text-xs text-slate-500 border-b border-slate-700">
        <th class="text-left py-2">Jogador</th>
        <th class="text-right py-2">N</th>
        <th class="text-right py-2">Mortes avg</th>
        <th class="text-right py-2">avg (V)</th>
        <th class="text-right py-2">avg (D)</th>
        <th class="text-right py-2">FB Kills</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr class="border-b border-slate-800">
          <td class="py-2 font-medium">${r.name}</td>
          <td class="text-right text-slate-500">${r.n}</td>
          <td class="text-right ${deathCls(r.avgD)}">${r.avgD.toFixed(1)}</td>
          <td class="text-right text-green-400">${r.nW?r.avgDW.toFixed(1):'—'}</td>
          <td class="text-right text-red-400">${r.nL?r.avgDL.toFixed(1):'—'}</td>
          <td class="text-right text-yellow-400">${r.fbKills}</td>
        </tr>`).join('')}
      </tbody>
    </table>`
}

// ── Table: Performance Geral por Jogador ──────────────────────────────────────
function buildPlayerTable(M) {
  const riotM = M.filter(m => m.player_stats?.length)
  if (!riotM.length) {
    document.getElementById('player-stats-table').innerHTML =
      '<p class="text-xs text-slate-500">Sem partidas com dados Riot API.</p>'
    return
  }

  document.getElementById('player-stats-n').textContent = riotM.length

  const map = {}
  for (const m of riotM) {
    for (const ps of m.player_stats) {
      if (!ps.name) continue
      const p = map[ps.name] ??= { n:0, wins:0, kdaSum:0, damSum:0, goldSum:0, csSum:0, durSum:0 }
      p.n++
      if (m.win) p.wins++
      p.kdaSum  += ps.kda    ?? 0
      p.damSum  += ps.damage ?? 0
      p.goldSum += ps.gold   ?? 0
      p.csSum   += ps.cs     ?? 0
      p.durSum  += m.duration ?? 0
    }
  }

  const rows = PLAYERS
    .map(name => {
      const p = map[name]; if (!p) return null
      return {
        name, n: p.n,
        wr:    p.wins / p.n,
        kda:   p.kdaSum  / p.n,
        dam:   p.damSum  / p.n,
        gold:  p.goldSum / p.n,
        csMin: p.durSum  ? p.csSum / p.durSum : 0,
      }
    })
    .filter(Boolean)

  const fmtK = v => `${(v/1000).toFixed(1)}k`

  document.getElementById('player-stats-table').innerHTML = `
    <table class="w-full text-sm text-slate-300">
      <thead><tr class="text-xs text-slate-500 border-b border-slate-700">
        <th class="text-left py-2">Jogador</th>
        <th class="text-right py-2">N</th>
        <th class="text-right py-2">Win%</th>
        <th class="text-right py-2">KDA</th>
        <th class="text-right py-2">Dano</th>
        <th class="text-right py-2">Ouro</th>
        <th class="text-right py-2">CS/min</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => {
          const wrCls = r.n >= 5 ? (r.wr >= 0.6 ? 'text-green-400' : r.wr >= 0.4 ? 'text-yellow-400' : 'text-red-400') : 'text-slate-400'
          return `<tr class="border-b border-slate-800">
            <td class="py-2 font-medium">${r.name}</td>
            <td class="text-right text-slate-500">${r.n}</td>
            <td class="text-right ${wrCls}">${utils.pct(r.wr)}%</td>
            <td class="text-right">${r.kda.toFixed(2)}</td>
            <td class="text-right">${fmtK(r.dam)}</td>
            <td class="text-right">${fmtK(r.gold)}</td>
            <td class="text-right">${r.csMin.toFixed(1)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
}

// ── Table: Campeões ───────────────────────────────────────────────────────────
let _champRows = []
let _champSort = { col: 'wr', dir: -1 }

function sortChampTable(col) {
  _champSort.dir = _champSort.col === col ? _champSort.dir * -1 : -1
  _champSort.col = col
  renderChampTable()
}

function renderChampTable() {
  const { col, dir } = _champSort
  const sorted = [..._champRows].sort((a, b) => {
    const aOk = a.n >= 5, bOk = b.n >= 5
    if (aOk !== bOk) return aOk ? -1 : 1
    return dir * (a[col] - b[col])
  })
  const fmtK   = v => `${(v/1000).toFixed(1)}k`
  const arrow  = c => c === col ? (dir === -1 ? ' ↓' : ' ↑') : ''
  const th     = (c, label, extra = '') =>
    `<th class="text-right py-2 cursor-pointer select-none hover:text-slate-300 ${extra}" onclick="sortChampTable('${c}')">${label}${arrow(c)}</th>`

  document.getElementById('champion-table').innerHTML = `
    <table class="w-full text-sm text-slate-300">
      <thead><tr class="text-xs text-slate-500 border-b border-slate-700">
        <th class="py-2 w-8"></th>
        <th class="text-left py-2">Campeão</th>
        ${th('n',   'N')}
        ${th('wr',  'Win%')}
        ${th('kda', 'KDA')}
        ${th('dam', 'Dano')}
        ${th('cs',  'CS')}
      </tr></thead>
      <tbody>
        ${sorted.map(r => {
          const wrCls = r.n >= 5 ? (r.wr >= 0.6 ? 'text-green-400' : r.wr >= 0.4 ? 'text-yellow-400' : 'text-red-400') : 'text-slate-400'
          const img = r.key ? `<img src="${champImgUrl(r.key)}" class="w-6 h-6 rounded" title="${r.name}">` : '<span class="text-slate-600 text-xs">?</span>'
          return `<tr class="border-b border-slate-800">
            <td class="py-1.5">${img}</td>
            <td class="py-1.5 font-medium">${r.name}</td>
            <td class="text-right text-slate-500">${r.n}</td>
            <td class="text-right ${wrCls}">${utils.pct(r.wr)}%</td>
            <td class="text-right">${r.kda.toFixed(2)}</td>
            <td class="text-right">${fmtK(r.dam)}</td>
            <td class="text-right">${Math.round(r.cs)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
}

function buildChampionTable(M) {
  const riotM = M.filter(m => m.player_stats?.length)
  const champStore = Alpine.store('champions')

  const map = {}
  for (const m of riotM) {
    for (const ps of m.player_stats) {
      if (!ps.champion) continue
      const c = map[ps.champion] ??= { wins:0, n:0, kdaSum:0, csSum:0, damSum:0 }
      c.n++
      if (m.win) c.wins++
      c.kdaSum  += ps.kda    ?? 0
      c.csSum   += ps.cs     ?? 0
      c.damSum  += ps.damage ?? 0
    }
  }

  _champRows = Object.entries(map)
    .filter(([, c]) => c.n >= 2)
    .map(([name, c]) => ({
      name,
      n:   c.n,
      wr:  c.wins / c.n,
      kda: c.kdaSum / c.n,
      cs:  c.csSum  / c.n,
      dam: c.damSum  / c.n,
      key: champStore.list.find(x => x.name === name)?.key ?? null,
    }))

  if (!_champRows.length) {
    document.getElementById('champion-table').innerHTML =
      '<p class="text-xs text-slate-500">Sem campeões com N≥2 ainda.</p>'
    return
  }

  renderChampTable()
}

function buildPlayerCharts(M) {
  const mvpGames = M.filter(m => m.mvp)
  const topGames = M.filter(m => m.top_player)
  document.getElementById('mvp-n').textContent = mvpGames.length
  document.getElementById('top-n').textContent = topGames.length

  const freq = {}
  for (const m of mvpGames) freq[m.mvp] = (freq[m.mvp] ?? 0) + 1
  const sortedMvp = Object.entries(freq).sort((a,b) => b[1]-a[1])
  Chart.getChart('c-mvp-freq')?.destroy()
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
  Chart.getChart('c-mvc')?.destroy()
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
    activeTab:       'team',
    formations:      [],
    filterFormation: '',
    allMatches:      [],

    async init() {
      const [, fData, data] = await Promise.all([
        Alpine.store('champions').load(),
        api.col('formations').list({ sort: '-active,name', perPage: 100 }),
        api.col('matches').list({ perPage: 500, expand: 'mvc' }),
      ])
      this.formations = fData.items
      this.allMatches = data.items
      this._render(this.allMatches)

      this.$watch('filterFormation', () => this.filterAndRender())
    },

    filterAndRender() {
      const M = this.filterFormation
        ? this.allMatches.filter(m => m.formation === this.filterFormation)
        : this.allMatches
      this._render(M)
    },

    _render(M) {
      buildTeamCharts(M)
      buildDeathSection(M)
      buildGoldSection(M)
      buildObjectiveSection(M)
      buildPlayerCharts(M)
      buildDeathTable(M)
      buildPlayerTable(M)
      buildChampionTable(M)
    },

    tab(which) { this.activeTab = which },
  }))
})
