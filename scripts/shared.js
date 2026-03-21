// ── PocketBase ────────────────────────────────────────────────────────────────
const PB = 'http://127.0.0.1:8090'

// ── Domain constants ──────────────────────────────────────────────────────────
const ROLES    = ['Top', 'Jungle', 'Mid', 'ADC', 'Support']
const PLAYERS  = ['Klebão','GdN','Conkreto','Digo','Kelly','Pixek','Nunes','Eden','Xuao']
const SUBTYPES = ['Siege','Protect','Engage','Split','Pick','Dive','Reset','Mix']
// ── Comp type table — única fonte de verdade para tipos e emojis ──────────────
const COMP_TYPE_DEFS = [
  { value: 'Protect', emoji: '🛡️' },
  { value: 'Pick',    emoji: '🔪'  },
  { value: 'Split',   emoji: '🔀'  },
  { value: 'Siege',   emoji: '🌀'  },
  { value: 'Engage',  emoji: '💥'  },
  { value: 'Mix',     emoji: '🌫️' },
]
const COMP_TYPES = COMP_TYPE_DEFS.map(d => d.value)
const COMP_EMOJI = Object.fromEntries(COMP_TYPE_DEFS.map(d => [d.value, d.emoji]))
const CHAMPION_CLASSES = ['Fighter','Mage','Tank','Assassin','Marksman','Support']
const DAMAGE_TYPES    = ['AD_high','AD_low','AP_high','AP_low','Mixed']
const TIERS           = ['S','A','B','C','D']
const SCALE_COLORS = ['🔴','🟡','🟢']
const SCALE_SLOTS  = ['Early','Mid','Late']
const PHASES       = ['early','mid','late']

// ── Componente Alpine reutilizável: seletor de força (🔴🟡🟢) ─────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('scaleSelector', () => ({
    value: null,

    pick(ci) {
      this.value = (this.value === ci ? null : ci)
      this.$dispatch('scale-pick', this.value)
    },
  }))
})

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

// ── Riot match stats extraction ───────────────────────────────────────────────
// Shared between import-tool.js, match-assistant.js, and match-form.js.
//
// opts.knownPuuidSet  — Set<string>: finds our team as the side with most known players
// opts.ourSide        — 'Blue'|'Red': alternative when puuids unavailable (e.g. stored snapshot)
// opts.puuidToName    — { [puuid]: playerName } — may be empty {}

const _POS_ORDER = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 }

// Canonical champion key for comparison.
// Strips non-alphanumeric chars (spaces, apostrophes), lowercases, and resolves
// the one structural mismatch: Wukong (DDragon display) ↔ MonkeyKing (Riot API key).
// Handles both "MissFortune" (Riot key) and "Miss Fortune" (DDragon display name),
// "Chogath" (Riot key) and "Cho'Gath" (DDragon display name), etc.
const _CHAMP_ALIASES = {
  monkeyking:  'monkeyking', wukong: 'monkeyking',  // Wukong DDragon ↔ MonkeyKing Riot
  renataglasc: 'renata',                             // "Renata Glasc" display ↔ "Renata" Riot key
  nunuwillump: 'nunu',                               // "Nunu & Willump" display ↔ "Nunu" Riot key
}
function normChampKey(name) {
  if (!name) return null
  const clean = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  return _CHAMP_ALIASES[clean] ?? clean
}

function extractMatchStats(match, timeline, { knownPuuidSet, ourSide, puuidToName = {} } = {}) {
  const info = match?.info
  if (!info) return null

  const participants = info.participants ?? []

  let ourTeamId
  if (ourSide) {
    ourTeamId = ourSide === 'Blue' ? 100 : 200
  } else if (knownPuuidSet?.size) {
    const teamCounts = {}
    for (const p of participants) {
      if (knownPuuidSet.has(p.puuid)) teamCounts[p.teamId] = (teamCounts[p.teamId] ?? 0) + 1
    }
    const best = Object.entries(teamCounts).sort((a, b) => b[1] - a[1])[0]
    if (!best) return null
    ourTeamId = +best[0]
  } else {
    return null
  }

  const allOur  = participants.filter(p => p.teamId === ourTeamId)
  const allEnm  = participants.filter(p => p.teamId !== ourTeamId)
  const ourTeam = info.teams?.find(t => t.teamId === ourTeamId)
  if (!ourTeam) return null

  const ourIds = new Set(allOur.map(p => p.participantId))
  const dur    = Math.round(info.gameDuration / 60) || 1

  const teamKills   = ourTeam.objectives?.champion?.kills ?? 0
  const teamDeaths  = allOur.reduce((s, p) => s + (p.deaths  ?? 0), 0)
  const teamAssists = allOur.reduce((s, p) => s + (p.assists ?? 0), 0)
  const totalGold   = allOur.reduce((s, p) => s + (p.goldEarned ?? 0), 0)
  const damage      = allOur.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0)
  const dmgTaken    = allOur.reduce((s, p) => s + (p.totalDamageTaken ?? 0), 0)
  const wards       = allOur.reduce((s, p) => s + (p.wardsPlaced ?? 0), 0)
  const visionScore = allOur.reduce((s, p) => s + (p.visionScore ?? 0), 0)
  const csTotal     = allOur.reduce((s, p) => s + (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0), 0)

  const o = ourTeam.objectives
  const objFlow = o ? [
    o.tower?.kills ?? 0, o.horde?.kills ?? 0, o.riftHerald?.kills ?? 0,
    o.dragon?.kills ?? 0, o.baron?.kills ?? 0, o.inhibitor?.kills ?? 0, o.nexus?.kills ?? 0,
  ].join('/') : ''

  const frames = timeline?.info?.frames
  const calcGd = min => {
    const f = frames?.[min]
    if (!f?.participantFrames) return null
    let our = 0, enm = 0
    for (const [pid, pf] of Object.entries(f.participantFrames)) {
      if (ourIds.has(+pid)) our += pf.totalGold ?? 0
      else                  enm += pf.totalGold ?? 0
    }
    return our - enm
  }

  let gdF = totalGold - allEnm.reduce((s, p) => s + (p.goldEarned ?? 0), 0)
  if (frames?.length) {
    const last = frames[frames.length - 1]
    if (last?.participantFrames) {
      let our = 0, enm = 0
      for (const [pid, pf] of Object.entries(last.participantFrames)) {
        if (ourIds.has(+pid)) our += pf.totalGold ?? 0
        else                  enm += pf.totalGold ?? 0
      }
      gdF = our - enm
    }
  }

  const sortByPos = arr => [...arr].sort((a, b) =>
    (_POS_ORDER[a.teamPosition] ?? 99) - (_POS_ORDER[b.teamPosition] ?? 99)
  )
  const sortedOur = sortByPos(allOur)
  const sortedEnm = sortByPos(allEnm)

  // champion stored as Riot API key (e.g. "MissFortune", "MonkeyKing", "Chogath")
  const playerStats = sortedOur.map(p => {
    const kda = p.deaths === 0
      ? (p.kills + p.assists)
      : Math.round(((p.kills + p.assists) / p.deaths) * 100) / 100
    return {
      name:        puuidToName[p.puuid] ?? null,
      role:        p.teamPosition || p.individualPosition || null,
      champion:    p.championName,
      kills:       p.kills       ?? 0,
      deaths:      p.deaths      ?? 0,
      assists:     p.assists     ?? 0,
      cs:          (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
      damage:      p.totalDamageDealtToChampions ?? 0,
      damageTaken: p.totalDamageTaken ?? 0,
      gold:        p.goldEarned  ?? 0,
      visionScore: p.visionScore ?? 0,
      wardsPlaced: p.wardsPlaced ?? 0,
      level:       p.champLevel  ?? null,
      kda,
      firstBlood:  p.firstBloodKill ?? false,
    }
  })

  let mvp = null, bestScore = -Infinity
  for (const p of allOur) {
    const name = puuidToName[p.puuid]
    if (!name) continue
    const score = (p.kills ?? 0) * 2 + (p.assists ?? 0) - (p.deaths ?? 0) * 0.5
    if (score > bestScore) { bestScore = score; mvp = name }
  }

  let topPlayer = ''
  for (const p of sortedOur) {
    if ((p.teamPosition || p.individualPosition) === 'TOP') {
      topPlayer = puuidToName[p.puuid] ?? ''
      break
    }
  }

  const mvpParticipant = allOur.find(p => puuidToName[p.puuid] === mvp)

  return {
    win:     ourTeam.win,
    side:    ourTeamId === 100 ? 'Blue' : 'Red',
    date:    new Date(info.gameStartTimestamp ?? info.gameCreation).toISOString().slice(0, 10),
    duration: dur,

    team_kills: teamKills, team_deaths: teamDeaths, team_assists: teamAssists,
    total_gold: totalGold, damage,
    da_di:         dmgTaken > 0 ? Math.round((damage / dmgTaken) * 100) / 100 : null,
    gold_per_min:  Math.round(totalGold / dur),
    wards_per_min: Math.round((wards / dur) * 10) / 10,
    vision_score:  visionScore,
    cs_total: csTotal, cs_per_min: Math.round((csTotal / dur) * 10) / 10,
    first_blood: ourTeam.objectives?.champion?.first ?? false,
    first_tower: ourTeam.objectives?.tower?.first    ?? false,
    obj_flow: objFlow,
    gd_f: gdF, gd_10: calcGd(10), gd_20: calcGd(20),

    playerStats,
    mvp,
    mvcChampKey:    mvpParticipant?.championName ?? null,
    topPlayer,
    ourChampKeys:   sortedOur.map(p => p.championName),
    enemyChampKeys: sortedEnm.map(p => p.championName),
  }
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
