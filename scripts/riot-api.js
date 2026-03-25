// ── riot-api.js — Shared Riot API infrastructure ────────────────────────────
// IIFE module exposing RiotApi global.
// Load order: shared.js → riot-api.js → consumers (import-tool, match-assistant, etc.)

/**
 * @typedef {Object} RiotFetchOptions
 * @property {function(string): void} [onStatus] - Progress callback (rate limit countdowns, etc.)
 * @property {number}  [retry=3]    - Retry attempts on 429
 */

/**
 * @typedef {Object} MatchSummary
 * @property {boolean}  teamComplete
 * @property {Object}   [stats]       - Return value of extractMatchStats()
 * @property {string[]} [ourChamps]   - Riot API champion keys for our team
 * @property {string[]} [enemyChamps] - Riot API champion keys for enemy team
 */

/**
 * @typedef {Object} ResolvePuuidOptions
 * @property {string} [playerId]       - PocketBase player record ID (for DB write-back)
 * @property {string} [existingPuuid]  - Known PUUID from DB (skip API call)
 */

const RiotApi = (() => {
  // ── Cluster mapping ─────────────────────────────────────────────────────────
  const CLUSTER = {
    BR1:'americas', NA1:'americas', LAN:'americas', LAS:'americas',
    EUW1:'europe',  EUNE1:'europe', TR1:'europe',   RU:'europe',
    KR:'asia',      JP1:'asia',
    OC1:'sea',      PH2:'sea',      SG2:'sea',      TH2:'sea', TW2:'sea', VN2:'sea',
  }

  // ── Rate limiter (shared across all callers) ────────────────────────────────
  let _reqTimes = []

  // ── Internal helpers ────────────────────────────────────────────────────────
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  async function _sleepCountdown(ms, label, onStatus) {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const secs = Math.ceil((deadline - Date.now()) / 1000)
      if (onStatus) onStatus(`${label} (${secs}s)…`)
      await _sleep(Math.min(1000, deadline - Date.now()))
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  return {

    // ── Infra ─────────────────────────────────────────────────────────────────

    /**
     * Riot API base URL for a given region.
     * @param {string} region - Platform code (e.g. 'BR1', 'NA1', 'EUW1')
     * @returns {string} Full base URL
     */
    baseUrl(region) {
      const cluster = CLUSTER[region] || 'americas'
      return `https://${cluster}.api.riotgames.com`
    },

    /**
     * Extract cluster from a Riot match ID prefix (e.g. 'BR1_12345' → 'americas').
     * @param {string} matchId
     * @returns {string} Cluster name
     */
    clusterFromMatchId(matchId) {
      return CLUSTER[matchId?.split('_')[0]] ?? 'americas'
    },

    /** @param {number} ms */
    sleep: _sleep,

    // ── Cache (localStorage, riot-* prefix) ───────────────────────────────────

    cache: {
      /** @param {string} key @returns {*|null} */
      get(key) {
        try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
      },

      /** @param {string} key @param {*} value */
      set(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify(value))
        } catch (e) {
          if (e?.name === 'QuotaExceededError' || e?.code === 22) {
            console.warn('[RiotApi.cache] localStorage cheio — entradas de cache não serão persistidas.', e)
          } else {
            console.warn('[RiotApi.cache] Falha ao salvar no localStorage:', e)
          }
        }
      },

      /** @returns {number} Number of riot-* cache entries */
      count() {
        try {
          return Object.keys(localStorage).filter(k =>
            k.startsWith('riot-ids-') || k.startsWith('riot-summary-') || k.startsWith('riot-puuid-')
          ).length
        } catch { return 0 }
      },

      /** Remove all riot-* cache entries. @returns {number} Entries removed */
      clear() {
        let count = 0
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('riot-ids-') || k.startsWith('riot-summary-') || k.startsWith('riot-puuid-')) {
            localStorage.removeItem(k)
            count++
          }
        }
        _reqTimes = []
        return count
      },
    },

    // ── Transport: rate-limited fetch with retry ──────────────────────────────

    /**
     * Rate-limited Riot API fetch with 429 retry.
     * Enforces 20 req/s (stays under 18) + 100 req/2min (stays under 90).
     *
     * @param {string} url
     * @param {string} apiKey - Riot API key (X-Riot-Token)
     * @param {RiotFetchOptions} [opts]
     * @returns {Promise<*>} Parsed JSON response
     * @throws {Error} On 403 (expired key), 404, or other HTTP errors
     */
    async fetch(url, apiKey, opts = {}) {
      const { onStatus, retry = 3 } = opts
      const now = Date.now()
      _reqTimes = _reqTimes.filter(t => now - t < 120000)

      // 100 req / 2 min (stay under 90)
      if (_reqTimes.length >= 90) {
        const waitMs = 120000 - (now - _reqTimes[0]) + 500
        await _sleepCountdown(waitMs, 'Aguardando janela de rate limit', onStatus)
        _reqTimes = _reqTimes.filter(t => Date.now() - t < 120000)
      }

      // 20 req / 1 sec (stay under 18)
      const lastSec = _reqTimes.filter(t => now - t < 1000)
      if (lastSec.length >= 18) {
        const waitMs = 1000 - (now - lastSec[0]) + 100
        await _sleep(waitMs)
      }

      _reqTimes.push(Date.now())

      const res = await fetch(url, { headers: { 'X-Riot-Token': apiKey } })
      if (res.status === 429) {
        if (retry <= 0) throw new Error('Limite de requisições atingido após várias tentativas.')
        const wait = (parseInt(res.headers.get('Retry-After') ?? '10') + 2) * 1000
        await _sleepCountdown(wait, 'Rate limit atingido — aguardando', onStatus)
        return RiotApi.fetch(url, apiKey, { ...opts, retry: retry - 1 })
      }
      if (res.status === 401 || res.status === 403) {
        const err = new Error('Chave de API inválida ou expirada.')
        err.expired = true
        throw err
      }
      if (res.status === 404) throw new Error('Recurso não encontrado na API da Riot.')
      if (!res.ok) throw new Error(`Erro na API da Riot: ${res.status}`)
      return res.json()
    },

    // ── PUUID resolution: cache → DB → API ───────────────────────────────────

    /**
     * Resolve a Riot ID (e.g. 'Name#BR1') to a PUUID.
     * Checks: localStorage cache (24h TTL) → opts.existingPuuid → Riot API.
     * On API fetch, writes back to localStorage + PocketBase player record.
     *
     * @param {string} riotId - 'GameName#TagLine'
     * @param {string} apiKey
     * @param {string} base   - Riot API base URL (from baseUrl())
     * @param {ResolvePuuidOptions} [opts]
     * @returns {Promise<string>} PUUID
     */
    async resolvePuuid(riotId, apiKey, base, opts = {}) {
      const { playerId, existingPuuid } = opts
      const cacheKey = `riot-puuid-${riotId.toLowerCase()}`

      // 1. localStorage cache (24h)
      const cached = RiotApi.cache.get(cacheKey)
      if (cached?.puuid && Date.now() - (cached._ts ?? 0) < 86400000) {
        return cached.puuid
      }

      // 2. Known PUUID from DB
      if (existingPuuid) {
        RiotApi.cache.set(cacheKey, { puuid: existingPuuid, _ts: Date.now() })
        return existingPuuid
      }

      // 3. Riot API
      const [gameName, tagLine] = riotId.split('#')
      const data = await RiotApi.fetch(
        `${base}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        apiKey
      )

      // Write back to localStorage
      RiotApi.cache.set(cacheKey, { puuid: data.puuid, _ts: Date.now() })

      // Write back to PocketBase player record (fire-and-forget)
      if (playerId) {
        api.col('players').update(playerId, { puuid: data.puuid }).catch(() => {})
      }

      return data.puuid
    },

    // ── Team detection ────────────────────────────────────────────────────────

    /**
     * Count how many known PUUIDs are on the same team (max across teams).
     * @param {Object[]} participants - match.info.participants
     * @param {Set<string>} knownPuuidSet
     * @returns {number}
     */
    countRosterOnSameTeam(participants, knownPuuidSet) {
      const counts = {}
      for (const p of participants) {
        if (knownPuuidSet.has(p.puuid)) counts[p.teamId] = (counts[p.teamId] ?? 0) + 1
      }
      const vals = Object.values(counts)
      return vals.length ? Math.max(...vals) : 0
    },

    // ── PB payload builder ────────────────────────────────────────────────────

    /**
     * Build the PocketBase PATCH payload for a match record from extracted stats.
     *
     * @param {Object} stats  - Return value of extractMatchStats()
     * @param {Object} [opts]
     * @param {string} [opts.riotId]    - Riot match ID to store
     * @param {Object} [opts.snapshot]  - { match, timeline } raw data to strip and store
     * @returns {Object} Payload for api.col('matches').update()
     */
    buildMatchPayload(stats, { riotId, snapshot } = {}) {
      const p = {
        player_stats:  stats.playerStats,
        team_kills:    stats.team_kills,
        team_deaths:   stats.team_deaths,
        team_assists:  stats.team_assists,
        total_gold:    stats.total_gold,
        damage:        stats.damage,
        da_di:         stats.da_di,
        gold_per_min:  stats.gold_per_min,
        wards_per_min: stats.wards_per_min,
        vision_score:  stats.vision_score,
        cs_total:      stats.cs_total,
        cs_per_min:    stats.cs_per_min,
        first_blood:   stats.first_blood,
        first_tower:   stats.first_tower,
        obj_flow:      stats.obj_flow,
        gd_f:          stats.gd_f,
        gd_10:         stats.gd_10,
        gd_20:         stats.gd_20,
        duration:      stats.duration,
      }
      if (riotId)       p.riot_match_id      = riotId
      if (snapshot)     p.riot_match_snapshot = stripSnapshot(snapshot)
      if (stats.date)   p.date               = stats.date + ' 00:00:00.000Z'
      if (stats.mvpId)  p.mvp                = stats.mvpId
      if (stats.topPlayerId) p.top_player    = stats.topPlayerId
      if (stats.win != null) p.win            = stats.win
      if (stats.side)   p.side               = stats.side
      if (stats.ourChampKeys?.length)   p.our_champs   = stats.ourChampKeys
      if (stats.enemyChampKeys?.length) p.enemy_champs = stats.enemyChampKeys
      return p
    },

  }
})()
