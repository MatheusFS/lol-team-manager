// ── PocketBase ────────────────────────────────────────────────────────────────
const PB = 'http://127.0.0.1:8090'

// ── Domain constants ──────────────────────────────────────────────────────────
const ROLES    = ['top', 'jng', 'mid', 'adc', 'sup']
const SUBTYPES = ['Siege','Protect','Engage','Split','Pick','Dive','Reset','Mix']

// ── Role label helpers (single source of truth) ───────────────────────────────
// Maps internal role IDs (top/jng/mid/adc/sup) → display labels (TOP/JNG/MID/ADC/SUP)
function roleLabel(role) {
  const ROLE_LABELS = { top: 'TOP', jng: 'JNG', mid: 'MID', adc: 'ADC', sup: 'SUP' }
  return ROLE_LABELS[role] || role || '—'
}

// Maps Riot API position keys (TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY) → display labels
function riotRoleLabel(role) {
  const RIOT_ROLE_LABELS = { TOP: 'TOP', JUNGLE: 'JNG', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUP' }
  return RIOT_ROLE_LABELS[role] ?? role ?? '—'
}

// ── Player cache ──────────────────────────────────────────────────────────────
let _cachedPlayers = null
async function loadPlayers() {
  if (_cachedPlayers) return _cachedPlayers
  const data = await api.col('players').list({ sort: 'name', perPage: 200 })
  _cachedPlayers = data.items
  return _cachedPlayers
}
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
const DAMAGE_TYPES    = ['AD_high','AD_low','AP_high','AP_low','Mixed_high','Mixed_low']

// ── Damage type display helpers ───────────────────────────────────────────────
// Label: only the type family (intensity communicated by badge color tone)
const DAMAGE_TYPE_LABELS = {
  'AD_high':    'AD',
  'AD_low':     'AD',
  'AP_high':    'AP',
  'AP_low':     'AP',
  'Mixed_high': 'MIX',
  'Mixed_low':  'MIX',
  'Mixed':      'MIX', // legacy
}
// Badge classes: dark bg + light text = high intensity; light bg + dark text = low intensity
const DAMAGE_TYPE_CLASSES = {
  'AD_high':    'bg-red-700 text-red-100',
  'AD_low':     'bg-red-200 text-red-800',
  'AP_high':    'bg-blue-700 text-blue-100',
  'AP_low':     'bg-blue-200 text-blue-800',
  'Mixed_high': 'bg-purple-700 text-purple-100',
  'Mixed_low':  'bg-purple-200 text-purple-800',
  'Mixed':      'bg-purple-200 text-purple-800', // legacy
}
// Select option labels: show intensity in text since native <select> ignores bg colors
const DAMAGE_TYPE_OPTION_LABELS = {
  'AD_high':    'AD Forte',
  'AD_low':     'AD Fraco',
  'AP_high':    'AP Forte',
  'AP_low':     'AP Fraco',
  'Mixed_high': 'MIX Forte',
  'Mixed_low':  'MIX Fraco',
}
const TIERS           = ['S','A','B','C','D']
// Arrow direction = beats. e.g. PICK → ENGAGE means Pick beats Engage.
const COMP_BEATS = {
  Engage:  ['Split', 'Siege'],
  Protect: ['Engage', 'Pick'],
  Pick:    ['Engage', 'Split'],
  Siege:   ['Protect', 'Pick'],
  Split:   ['Siege'],
  Mix:     [],
}
const SCALE_COLORS = ['🟥','🟨','🟩']
const SCALE_SLOTS  = ['Early','Mid','Late']
const PHASES       = ['early','mid','late']

// ── Componente Alpine reutilizável: seletor de força ─────────────────
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
    if (n < 10)      return 'rgba(100,116,139,0.5)'   // Gray < 10 matches
    if (rate >= 0.7) return 'rgba(168,85,247,0.78)'   // Purple ≥ 70%
    if (rate >= 0.6) return 'rgba(74,222,128,0.78)'   // Green 60%-70%
    if (rate >= 0.5) return 'rgba(234,179,8,0.78)'    // Gold 50%-60%
    if (rate >= 0.4) return 'rgba(249,115,22,0.78)'   // Orange 40%-50%
    return 'rgba(248,113,113,0.78)'                    // Red ≤ 40%
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

async function extractMatchStats(match, timeline, { knownPuuidSet, ourSide, puuidToName = {}, puuidToId = {} } = {}) {
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

  // Fetch DDragon item data for bonus stat calculation (cached)
  const itemDataMap = await fetchDDragonItems()

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
      puuid:                p.puuid,
      name:                 puuidToName[p.puuid] ?? null,
      role:                 p.teamPosition || p.individualPosition || null,
      champion:             p.championName,
      kills:                p.kills       ?? 0,
      deaths:               p.deaths      ?? 0,
      assists:              p.assists     ?? 0,
      cs:                   (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
      damage:               p.totalDamageDealtToChampions ?? 0,
      damageTaken:          p.totalDamageTaken ?? 0,
      gold:                 p.goldEarned  ?? 0,
      visionScore:          p.visionScore ?? 0,
      wardsPlaced:          p.wardsPlaced ?? 0,
      level:                p.champLevel  ?? null,
      kda,
      firstBlood:           p.firstBloodKill ?? false,
      damageSelfMitigated:  p.damageSelfMitigated ?? 0,
      timeCCingOthers:      p.timeCCingOthers ?? 0,
      wardsKilled:          p.wardsKilled ?? 0,
      damageToBuildings:    p.damageDealtToBuildings ?? 0,
      killParticipation:    p.challenges?.killParticipation ?? null,
      controlWardsPlaced:   p.challenges?.controlWardsPlaced ?? 0,
      ...calcItemStats([p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6], itemDataMap),
    }
  })

  let mvp = null, mvpPuuid = null, bestScore = -Infinity
  for (const p of allOur) {
    const name = puuidToName[p.puuid]
    if (!name) continue
    const score = (p.kills ?? 0) * 2 + (p.assists ?? 0) - (p.deaths ?? 0) * 0.5
    if (score > bestScore) { bestScore = score; mvp = name; mvpPuuid = p.puuid }
  }

  let topPlayer = '', topPlayerPuuid = null
  for (const p of sortedOur) {
    if ((p.teamPosition || p.individualPosition) === 'TOP') {
      topPlayer = puuidToName[p.puuid] ?? ''
      topPlayerPuuid = p.puuid
      break
    }
  }

  const mvpParticipant = allOur.find(p => p.puuid === mvpPuuid)

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
    mvpId:          puuidToId[mvpPuuid] ?? null,
    mvcChampKey:    mvpParticipant?.championName ?? null,
    topPlayer,
    topPlayerId:    puuidToId[topPlayerPuuid] ?? null,
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
    'damageSelfMitigated','timeCCingOthers','wardsKilled','damageDealtToBuildings',
    'item0','item1','item2','item3','item4','item5','item6',
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
        // Preserve specific challenges fields
        if (p.challenges) {
          out.challenges = {
            killParticipation:  p.challenges.killParticipation  ?? null,
            controlWardsPlaced: p.challenges.controlWardsPlaced ?? 0,
          }
        }
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

// ── DDragon items ─────────────────────────────────────────────────────────────
// Fetches items.json from DDragon and caches in localStorage for 7 days.
// Returns a map: { [itemId: string]: { FlatHPPoolMod, FlatPhysicalDamageMod, ... } }
let _itemDataCache = null
async function fetchDDragonItems() {
  if (_itemDataCache) return _itemDataCache

  const version = _ddragonVersion
  const cacheKey = `ddragon-items-${version}`
  const TTL = 7 * 24 * 60 * 60 * 1000

  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const { ts, data } = JSON.parse(cached)
      if (Date.now() - ts < TTL) {
        _itemDataCache = data
        return _itemDataCache
      }
    }
  } catch {}

  try {
    const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`)
    if (!res.ok) return {}
    const json = await res.json()
    // Flatten to { itemId: stats } — only keep the stat fields we use
    const data = {}
    for (const [id, item] of Object.entries(json.data ?? {})) {
      if (item.stats && Object.keys(item.stats).length) data[id] = item.stats
    }
    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })) } catch {}
    _itemDataCache = data
    return _itemDataCache
  } catch {
    return {}
  }
}

// Sums bonus stats from a participant's items using DDragon item data.
// itemIds: array of item IDs (item0…item6), 0 = empty slot.
// itemDataMap: result of fetchDDragonItems().
// Returns: { bHP, bAD, bAP, bAS, bArmor, bMR }
function calcItemStats(itemIds, itemDataMap) {
  let bHP = 0, bAD = 0, bAP = 0, bAS = 0, bArmor = 0, bMR = 0
  for (const id of itemIds) {
    if (!id) continue
    const stats = itemDataMap[String(id)]
    if (!stats) continue
    bHP    += stats.FlatHPPoolMod          ?? 0
    bAD    += stats.FlatPhysicalDamageMod  ?? 0
    bAP    += stats.FlatMagicDamageMod     ?? 0
    bAS    += stats.PercentAttackSpeedMod  ?? 0
    bArmor += stats.FlatArmorMod           ?? 0
    bMR    += stats.FlatSpellBlockMod      ?? 0
  }
  return { bHP, bAD, bAP, bAS, bArmor, bMR }
}

// ── Formation detection ───────────────────────────────────────────────────────
// Given a match record and an array of formation objects, returns the best
// matching formation (or null if ambiguous / no data).
//
// Returns: { match: formationObj|null, score: number, total: number, candidates: [] }
//   score   = number of roles that matched
//   total   = number of roles we had data for
//   match   = single formation when unambiguous, null when tied or no match
//   candidates = tied formations when ambiguous
// players = array of player records { id, name, ... } — required for ID-based matching
// Builds a name→id lookup that handles renamed players via riot_id prefix and case-insensitive match.
function buildPlayerLookup(players, puuidToId = {}) {
  const nameToId   = Object.fromEntries(players.map(p => [p.name, p.id]))
  const riotIdToId = Object.fromEntries(players.map(p => {
    const base = p.riot_id ? p.riot_id.split('#')[0] : ''
    return [base, p.id]
  }))
  return (name, puuid) => {
    if (puuid && puuidToId[puuid]) return puuidToId[puuid]
    if (!name) return null
    if (nameToId[name])   return nameToId[name]
    if (riotIdToId[name]) return riotIdToId[name]
    const key = Object.keys(nameToId).find(k => k.toLowerCase() === name.toLowerCase())
    return key ? nameToId[key] : null
  }
}

function detectFormation(match, formations, players = []) {
  const ROLE_MAP = { TOP: 'top', JUNGLE: 'jng', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'sup' }
  const ALL_ROLES = ['top', 'jng', 'mid', 'adc', 'sup']
  const puuidToId = Object.fromEntries(players.filter(p => p.puuid).map(p => [p.puuid, p.id]))
  const findPlayerId = buildPlayerLookup(players, puuidToId)

  // Extract role→player ID from player_stats (PUUID-first, then name fallback)
  const byRole = {}
  if (Array.isArray(match.player_stats)) {
    for (const ps of match.player_stats) {
      if (ps.role) {
        const key = ROLE_MAP[ps.role]
        const id  = findPlayerId(ps.name, ps.puuid)
        if (key && id) byRole[key] = id
      }
    }
  }
  // Fallback: top_player is already a relation ID after migration
  if (!byRole.top && match.top_player) byRole.top = match.top_player

  const knownRoles = ALL_ROLES.filter(r => byRole[r])
  if (!knownRoles.length) return { match: null, score: 0, total: 0, candidates: [] }

  // ── Set-based matching (handles lane swaps) ──────────────────────────────
  // If all 5 players resolved, try to match by player SET instead of role-by-role.
  // A lane swap changes who is in which role, but the 5 players present are the same.
  if (knownRoles.length === 5) {
    const matchPlayerSet = new Set(ALL_ROLES.map(r => byRole[r]))
    const setMatches = formations.filter(f =>
      ALL_ROLES.every(r => matchPlayerSet.has(f[r]))
    )
    if (setMatches.length === 1) {
      return { match: setMatches[0], score: 5, total: 5, candidates: [] }
    }
    // If multiple formations with same 5 players, fall through to role-based scoring
  }

  // ── Role-based scoring (fallback / partial) ──────────────────────────────
  const scored = formations.map(f => {
    const hits = knownRoles.filter(r => f[r] === byRole[r]).length
    return { formation: f, score: hits }
  }).sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score === 0) return { match: null, score: 0, total: knownRoles.length, candidates: [] }

  const tied = scored.filter(s => s.score === best.score)
  if (tied.length > 1) {
    return { match: null, score: best.score, total: knownRoles.length, candidates: tied.map(s => s.formation) }
  }

  return { match: best.formation, score: best.score, total: knownRoles.length, candidates: [] }
}

// Extract role→player ID map from a match's player_stats (same ROLE_MAP as detectFormation).
// Returns { top, jng, mid, adc, sup } — missing roles are null.
// players = array of player records { id, name } — required for ID-based lookup.
function extractLineup(match, players = []) {
  const ROLE_MAP = { TOP: 'top', JUNGLE: 'jng', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'sup' }
  const lineup = { top: null, jng: null, mid: null, adc: null, sup: null }
  const puuidToId = Object.fromEntries(players.filter(p => p.puuid).map(p => [p.puuid, p.id]))
  const findPlayerId = buildPlayerLookup(players, puuidToId)
  if (Array.isArray(match.player_stats)) {
    for (const ps of match.player_stats) {
      if (ps.role) {
        const key = ROLE_MAP[ps.role]
        const id  = findPlayerId(ps.name, ps.puuid)
        if (key && id) lineup[key] = id
      }
    }
  }
  // Fallback: top_player is already a relation ID after migration
  if (!lineup.top && match.top_player) lineup.top = match.top_player
  return lineup
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
