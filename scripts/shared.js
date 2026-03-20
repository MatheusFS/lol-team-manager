// ── PocketBase ────────────────────────────────────────────────────────────────
const PB = 'http://127.0.0.1:8090'

// ── Domain constants ──────────────────────────────────────────────────────────
const ROLES    = ['Top', 'Jungle', 'Mid', 'ADC', 'Support']
const PLAYERS  = ['Klebão','GdN','Conkreto','Digo','Kelly','Pixek','Nunes','Eden','Xuao']
const SUBTYPES = ['Siege','Protect','Engage','Split','Pick','Dive','Reset','Mix']
const COMP_EMOJI = { Protect:'🛡️', Pick:'🔪', Split:'🔀', Siege:'🌀', Engage:'💥', Mix:'🌫️' }
const SCALE_COLORS = ['🔴','🟡','🟢']
const SCALE_SLOTS  = ['Early','Mid','Late']

// ── PocketBase fetch helpers ──────────────────────────────────────────────────
const api = {
  async _req(method, path, body = null) {
    const opts = { method, headers: {} }
    if (body !== null) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json' }
    const res  = await fetch(PB + path, opts)
    if (res.status === 204 || method === 'DELETE') return null
    const data = await res.json()
    if (!res.ok) throw data
    return data
  },
  col(name) {
    const base = `/api/collections/${name}/records`
    return {
      list: (p = {}) => {
        const qs = new URLSearchParams(p).toString()
        return api._req('GET', `${base}${qs ? '?' + qs : ''}`)
      },
      get:    (id, p = {}) => {
        const qs = new URLSearchParams(p).toString()
        return api._req('GET', `${base}/${id}${qs ? '?' + qs : ''}`)
      },
      create: (data)     => api._req('POST',   base,           data),
      update: (id, data) => api._req('PATCH',  `${base}/${id}`, data),
      delete: (id)       => api._req('DELETE', `${base}/${id}`),
    }
  },
}

// ── Statistical utilities ──────────────────────────────────────────────────────
const utils = {
  fmtGold(v) { return (v > 0 ? '+' : '') + v.toLocaleString('en') },

  wilson(wins, n, z = 1.96) {
    if (n === 0) return { rate: null, lo: null, hi: null }
    const p = wins / n, z2 = z * z, d = 1 + z2 / n
    const c = (p + z2 / (2 * n)) / d
    const m = (z / d) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return { rate: p, lo: Math.max(0, c - m), hi: Math.min(1, c + m) }
  },

  pct(v) { return v == null ? null : Math.round(v * 100) },

  rateColor(rate, n) {
    if (n < 5)       return 'rgba(100,116,139,0.5)'
    if (rate >= 0.6) return 'rgba(74,222,128,0.78)'
    if (rate >= 0.4) return 'rgba(234,179,8,0.78)'
    return 'rgba(248,113,113,0.78)'
  },

  groupWR(matches, keyFn, sort = 'rate') {
    const map = {}
    for (const m of matches) {
      const k = keyFn(m)
      if (!k) continue
      if (!map[k]) map[k] = { wins: 0, n: 0 }
      map[k].n++
      if (m.win) map[k].wins++
    }
    return Object.entries(map)
      .map(([label, { wins, n }]) => ({ label, wins, n, ...utils.wilson(wins, n) }))
      .sort((a, b) => sort === 'rate' ? (b.rate ?? 0) - (a.rate ?? 0) : a.label.localeCompare(b.label))
  },
}

// ── Snapshot stripper (keeps only fields used by the app, avoids PB 1MB limit) ─
function stripSnapshot({ match, timeline }) {
  const PARTICIPANT_FIELDS = [
    'teamId','participantId','puuid',
    'kills','deaths','assists',
    'goldEarned','totalDamageDealtToChampions','totalDamageTaken',
    'wardsPlaced','visionScore','totalMinionsKilled','neutralMinionsKilled',
    'championName','teamPosition','individualPosition','champLevel','firstBloodKill',
  ]

  const strippedMatch = {
    metadata: { matchId: match.metadata?.matchId },
    info: {
      gameDuration:       match.info.gameDuration,
      gameStartTimestamp: match.info.gameStartTimestamp,
      teams:              match.info.teams,
      participants:       match.info.participants.map(p => {
        const out = {}
        for (const k of PARTICIPANT_FIELDS) if (k in p) out[k] = p[k]
        return out
      }),
    },
  }

  const strippedTimeline = {
    info: {
      frames: (timeline?.info?.frames ?? []).map(f => ({
        participantFrames: Object.fromEntries(
          Object.entries(f.participantFrames ?? {}).map(([id, pf]) => [id, { totalGold: pf.totalGold }])
        ),
      })),
    },
  }

  return { match: strippedMatch, timeline: strippedTimeline }
}

// ── [x-cloak] CSS (prevent Alpine FOUC) ──────────────────────────────────────
;(() => {
  const s = document.createElement('style')
  s.textContent = '[x-cloak]{display:none!important}'
  document.head.appendChild(s)
})()

// ── Data Dragon version ───────────────────────────────────────────────────────
// Served from localhost (PocketBase --publicDir .) — no CORS.
// Updated by running: python3 scripts/fetch_champions.py
let _ddragonVersion = '16.6.1' // fallback; overwritten by the fetch below
fetch(`${PB}/scripts/ddragon-version.txt`)
  .then(r => r.ok ? r.text() : Promise.reject())
  .then(v => { _ddragonVersion = v.trim() })
  .catch(() => {})

function champImgUrl(key) {
  if (!key || !_ddragonVersion) return ''
  return `https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/champion/${key}.png`
}

// ── Alpine.store: shared champion list ────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.store('champions', {
    list:   [],
    loaded: false,

    async load() {
      if (this.loaded) return
      const data = await api.col('champions').list({ perPage: 500, sort: 'name' })
      this.list   = data.items
      this.loaded = true
    },

    search(query, limit = 20) {
      if (!query?.trim()) return []
      const q = query.toLowerCase()
      return this.list.filter(c => c.name.toLowerCase().includes(q)).slice(0, limit)
    },

    byId(id) { return this.list.find(c => c.id === id) ?? null },

    imgUrl(key) { return champImgUrl(key) },
  })
})
