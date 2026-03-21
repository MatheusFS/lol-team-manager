// ── Champion Metadata Suggestion Engine ──────────────────────────────────────
// IIFE exposing global ChampionSuggest (same pattern as riot-api.js)
const ChampionSuggest = (() => {

  // ── Cache helpers ──────────────────────────────────────────────────────────
  const _cache = {
    get(key, ttlMs) {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const { ts, data } = JSON.parse(raw)
        if (Date.now() - ts > ttlMs) { localStorage.removeItem(key); return null }
        return data
      } catch { return null }
    },
    set(key, data) {
      try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })) } catch {}
    },
  }

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
  const ONE_DAY    = 24 * 60 * 60 * 1000

  // ── DDragon fetch ──────────────────────────────────────────────────────────
  async function fetchDDragon(version) {
    const cacheKey = `ddragon-champions-${version}`
    const cached = _cache.get(cacheKey, SEVEN_DAYS)
    if (cached) return cached

    const url = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`DDragon fetch failed: ${res.status}`)
    const json = await res.json()

    // json.data is { Aatrox: {...}, Ahri: {...}, ... } keyed by champion key
    _cache.set(cacheKey, json.data)
    return json.data
  }

  // ── Lolalytics meta fetch ─────────────────────────────────────────────────
  // Returns Map<champName, { winrate, pickrate, banrate, games, lane }> or null
  async function fetchMeta(patch) {
    const cacheKey = `lolalytics-meta-${patch}`
    const cached = _cache.get(cacheKey, ONE_DAY)
    if (cached) return cached

    try {
      const url = `https://lolalytics.com/lol/tierlist/?tier=emerald_plus&patch=${patch}`
      const res = await fetch(url)
      if (!res.ok) return null
      const html = await res.text()
      const meta = _parseLolalyticsTierlist(html)
      if (meta && Object.keys(meta).length > 20) {
        _cache.set(cacheKey, meta)
        return meta
      }
    } catch { /* CORS or network error — expected */ }

    return null
  }

  // Parse the rendered HTML tier list table
  function _parseLolalyticsTierlist(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const rows = doc.querySelectorAll('table tbody tr, [role="row"]')
    if (!rows.length) return null

    const meta = {}
    for (const row of rows) {
      const cells = row.querySelectorAll('td, [role="cell"]')
      if (cells.length < 6) continue

      // Typical tier list columns: Rank, Icon+Name, Tier, Lane, WR, PR, BR, Games
      const nameEl = cells[1]?.querySelector('a, span') || cells[1]
      const name = nameEl?.textContent?.trim()
      if (!name) continue

      const wr    = parseFloat(cells[4]?.textContent)
      const pr    = parseFloat(cells[5]?.textContent)
      const br    = parseFloat(cells[6]?.textContent)
      const games = parseInt(cells[7]?.textContent?.replace(/[^0-9]/g, ''))
      const lane  = cells[3]?.textContent?.trim()?.toLowerCase()

      if (!isNaN(wr)) {
        const key = name.toLowerCase().replace(/[^a-z]/g, '')
        meta[key] = { winrate: wr, pickrate: pr || 0, banrate: br || 0, games: games || 0, lane: lane || '' }
      }
    }
    return Object.keys(meta).length ? meta : null
  }

  // Allow user to manually import meta data (called from UI)
  function importMeta(jsonStr, patch) {
    try {
      const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
      if (typeof data !== 'object' || !Object.keys(data).length) return null
      const cacheKey = `lolalytics-meta-${patch}`
      _cache.set(cacheKey, data)
      return data
    } catch { return null }
  }

  function getMetaCache(patch) {
    return _cache.get(`lolalytics-meta-${patch}`, ONE_DAY)
  }

  // ── Suggestion rules ──────────────────────────────────────────────────────

  function suggestOne(dd, metaEntry) {
    const tags   = dd.tags || []
    const info   = dd.info || {}
    const stats  = dd.stats || {}
    const tag0   = tags[0] || ''
    const tag1   = tags[1] || ''
    const range  = stats.attackrange || 0

    // class
    const champClass = tag0

    // damage_type
    let damageType = 'Mixed'
    const { magic = 0, attack = 0 } = info
    if (magic >= 7 && attack <= 4)      damageType = 'AP_high'
    else if (magic >= 5 && magic > attack) damageType = 'AP_low'
    else if (attack >= 7 && magic <= 4) damageType = 'AD_high'
    else if (attack >= 5 && attack > magic) damageType = 'AD_low'

    // roles (heuristic from tags)
    const roles = new Set()
    const hasTag = t => tags.includes(t)

    if (hasTag('Marksman'))  { roles.add('ADC');  if (hasTag('Assassin') || hasTag('Mage')) roles.add('Mid') }
    if (hasTag('Assassin') && !hasTag('Marksman')) { roles.add('Mid'); roles.add('Jungle') }
    if (hasTag('Fighter'))   { roles.add('Top');  roles.add('Jungle') }
    if (hasTag('Tank') && range <= 300) { roles.add('Top'); roles.add('Jungle'); roles.add('Support') }
    if (hasTag('Mage') && tag0 === 'Mage') { roles.add('Mid'); if (range >= 500) roles.add('Support') }
    if (hasTag('Support'))   { roles.add('Support') }
    if (roles.size === 0) roles.add('Mid') // fallback

    // If meta data available, prefer meta lane
    let metaRoles = null
    if (metaEntry?.lane) {
      const laneMap = { top: 'Top', jungle: 'Jungle', middle: 'Mid', mid: 'Mid', bottom: 'ADC', adc: 'ADC', support: 'Support' }
      const mapped = laneMap[metaEntry.lane]
      if (mapped) metaRoles = [mapped]
    }

    // comp_fit
    let compFit = 'Mix'
    const def = info.defense || 0
    if (hasTag('Tank') && def >= 7)                compFit = 'Engage'
    else if (hasTag('Assassin'))                   compFit = 'Pick'
    else if (hasTag('Mage') && range >= 500)       compFit = 'Siege'
    else if (hasTag('Support') && def >= 5)        compFit = 'Protect'
    else if (hasTag('Fighter') && attack >= 7)     compFit = 'Split'

    // tier (from meta)
    let tier = null
    if (metaEntry?.winrate && metaEntry?.pickrate >= 1) {
      const wr = metaEntry.winrate
      if (wr > 53)      tier = 'S'
      else if (wr > 51) tier = 'A'
      else if (wr > 49) tier = 'B'
      else if (wr > 47) tier = 'C'
      else              tier = 'D'
    }

    // power_curve: null in V1 (needs per-champion game-length data)
    const powerCurve = null

    return {
      class:       champClass,
      roles:       metaRoles || [...roles],
      damage_type: damageType,
      comp_fit:    compFit,
      tier,
      power_curve: powerCurve,
    }
  }

  // ── Batch suggest ─────────────────────────────────────────────────────────
  // ddragonData: { [key]: champData } from fetchDDragon
  // meta: { [nameKey]: { winrate, pickrate, ... } } or null
  // Returns Map<champKey, suggestion>
  function suggestAll(ddragonData, meta) {
    const results = {}
    for (const [key, dd] of Object.entries(ddragonData)) {
      // Match meta entry by normalized name
      const normKey = key.toLowerCase().replace(/[^a-z]/g, '')
      const metaEntry = meta?.[normKey] || null
      results[key] = suggestOne(dd, metaEntry)
    }
    return results
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    fetchDDragon,
    fetchMeta,
    importMeta,
    getMetaCache,
    suggestOne,
    suggestAll,
  }

})()
