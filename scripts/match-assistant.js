// ── Drawer HTML injected before </body> on any page that includes this script ─
;(() => {
  const drawer = document.createElement('div')
  drawer.id    = 'match-assistant-drawer'
  drawer.innerHTML = `
<div x-data="matchAssistant" x-on:open-assistant.window="openWith($event.detail)" x-cloak>

  <!-- Backdrop -->
  <div x-show="open" x-transition.opacity
       @click="open = false"
       class="fixed inset-0 bg-black/50 z-40"></div>

  <!-- Slide-over panel -->
  <div x-show="open"
       x-transition:enter="transition ease-out duration-200 transform"
       x-transition:enter-start="translate-x-full"
       x-transition:enter-end="translate-x-0"
       x-transition:leave="transition ease-in duration-150 transform"
       x-transition:leave-start="translate-x-0"
       x-transition:leave-end="translate-x-full"
       class="fixed right-0 top-0 h-full w-full max-w-md bg-slate-900 border-l border-slate-800 z-50 flex flex-col shadow-2xl">

    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
      <div>
        <h2 class="text-sm font-semibold"
            x-text="mode === 'edit' ? 'Encontrar esta partida' : 'Partidas recentes do time'"></h2>
        <p x-show="mode === 'edit'" class="text-xs text-slate-500 mt-0.5">
          Filtrando por data ± 1 dia e resultado
        </p>
      </div>
      <button @click="open = false"
              class="text-slate-500 hover:text-slate-200 text-xl leading-none px-1 flex-shrink-0">×</button>
    </div>

    <!-- API key -->
    <div class="px-4 py-3 border-b border-slate-800 flex-shrink-0">
      <label class="text-xs text-slate-400 block mb-1">Riot API Key</label>
      <input type="password" x-model="apiKey" @change="saveKey()"
             placeholder="RGAPI-…"
             :class="keyExpired ? 'border-red-500' : 'border-slate-700'"
             class="w-full bg-slate-800 border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-yellow-500">
      <p x-show="keyExpired" class="text-xs text-red-400 mt-1">
        Chave expirada ou inválida — cole uma nova chave acima e tente novamente.
      </p>
    </div>

    <!-- Fetch button -->
    <div class="px-4 py-3 border-b border-slate-800 flex-shrink-0">
      <button @click="fetch()" :disabled="loading || !apiKey"
              class="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-900 font-semibold text-sm py-2 rounded transition-colors">
        <span x-show="!loading"
              x-text="mode === 'edit' ? '🔍 Buscar esta partida' : '🔍 Buscar partidas recentes'"></span>
        <span x-show="loading" x-text="status"></span>
      </button>
    </div>

    <!-- Cards -->
    <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">

      <div x-show="!loading && cards.length === 0 && !status"
           class="text-center text-slate-500 py-10 text-sm">
        Configure a API key e clique em buscar
      </div>
      <div x-show="!loading && cards.length === 0 && status"
           class="text-center text-slate-500 py-10 text-sm" x-text="status"></div>

      <template x-for="card in cards" :key="card.matchId">
        <div class="bg-slate-800 border rounded-lg p-3 text-xs"
             :class="card.win ? 'border-green-700/50' : 'border-red-800/50'">

          <!-- Card header -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold px-1.5 py-0.5 rounded"
                    :class="card.win ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
                    x-text="card.win ? 'VITÓRIA' : 'DERROTA'"></span>
              <span class="text-slate-400" x-text="card.side === 'Red' ? '🟥 Red' : '🟦 Blue'"></span>
              <span class="text-slate-500" x-text="card.duration + ' min'"></span>
              <span class="text-slate-600" x-text="card.date"></span>
            </div>
            <button @click="use(card)"
                    class="flex-shrink-0 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold px-2 py-1 rounded transition-colors">
              Usar
            </button>
          </div>

          <!-- Our champions -->
          <div class="flex gap-1 mb-1">
            <template x-for="c in card.ourChamps" :key="c.name">
              <img :src="$store.champions.imgUrl(c.key)" :title="c.name" :alt="c.name"
                   class="w-7 h-7 rounded object-cover" onerror="this.style.display='none'">
            </template>
          </div>

          <!-- Enemy champions (dimmed) -->
          <div class="flex gap-1 mb-2">
            <template x-for="c in card.enemyChamps" :key="c.name">
              <img :src="$store.champions.imgUrl(c.key)" :title="c.name" :alt="c.name"
                   class="w-6 h-6 rounded object-cover opacity-40" onerror="this.style.display='none'">
            </template>
          </div>

          <!-- Meta -->
          <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-400 mb-1">
            <span x-show="card.topPlayer">TOP: <span class="text-slate-200" x-text="card.topPlayer"></span></span>
            <span x-show="card.mvp">MVP: <span class="text-slate-200" x-text="card.mvp"></span></span>
            <span x-show="card.mvcChampName">MVC: <span class="text-slate-200" x-text="card.mvcChampName"></span></span>
            <span x-show="card.teamKills != null">K/D: <span class="text-slate-200" x-text="card.teamKills + '/' + card.teamDeaths"></span></span>
          </div>

          <!-- Gold diffs -->
          <div class="flex gap-3 text-slate-400" x-show="card.gd10 != null">
            <span>GD@10: <span :class="card.gd10>0?'text-green-400':card.gd10<0?'text-red-400':'text-slate-300'"
                               x-text="(card.gd10>0?'+':'')+(card.gd10??0).toLocaleString('en')"></span></span>
            <span x-show="card.gd20 != null">GD@20: <span :class="card.gd20>0?'text-green-400':card.gd20<0?'text-red-400':'text-slate-300'"
                               x-text="(card.gd20>0?'+':'')+(card.gd20??0).toLocaleString('en')"></span></span>
          </div>

        </div>
      </template>

    </div>
  </div>
</div>
  `
  // DOMContentLoaded fires after Alpine (deferred) has already initialized.
  // Use Alpine.initTree() to initialize the newly appended element.
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(drawer)
    if (window.Alpine) Alpine.initTree(drawer)
  })
})()

// ── Alpine component ──────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('matchAssistant', () => ({

    apiKey:     localStorage.getItem('riot-api-key') ?? '',
    keyExpired: false,
    open:       false,
    mode:       'create',   // 'create' | 'edit'
    filters:    {},         // { date, win, side } — populated in edit mode
    loading:    false,
    status:     '',
    cards:      [],

    saveKey() {
      localStorage.setItem('riot-api-key', this.apiKey)
      this.keyExpired = false
    },

    // Called by open-assistant window event
    openWith(detail = {}) {
      this.filters    = detail ?? {}
      this.mode       = (detail?.date != null) ? 'edit' : 'create'
      this.open       = true
      this.cards      = []
      this.status     = ''
      this.keyExpired = false
      this.fetch()
    },

    // ── Lazy-load snapshot on demand ────────────────────────────────────
    async _ensureSnapshot(card) {
      if (card._snapshot) return card._snapshot
      const base = RiotApi.baseUrl(localStorage.getItem('riot-region') || 'BR1')
      const [match, timeline] = await Promise.all([
        RiotApi.fetch(`${base}/lol/match/v5/matches/${card.matchId}`, this.apiKey),
        RiotApi.fetch(`${base}/lol/match/v5/matches/${card.matchId}/timeline`, this.apiKey),
      ])
      card._snapshot = { match, timeline }
      return card._snapshot
    },

    // Apply card: dispatch event (caught by matchForm if present) + localStorage fallback
    async use(card) {
      try {
        await this._ensureSnapshot(card)
      } catch (e) {
        console.error('[match-assistant] Falha ao buscar snapshot:', e)
      }
      const { _snapshot, ...prefill } = card
      if (location.pathname.includes('match-form')) {
        window.dispatchEvent(new CustomEvent('apply-match', { detail: { ...prefill, _snapshot }, bubbles: true }))
      } else {
        localStorage.setItem('match-assistant-prefill', JSON.stringify(prefill))
        if (_snapshot) {
          try {
            localStorage.setItem('match-assistant-snapshot', JSON.stringify(stripSnapshot(_snapshot)))
          } catch (e) {
            console.warn('[match-assistant] Falha ao salvar snapshot no localStorage:', e)
          }
        }
        window.dispatchEvent(new CustomEvent('apply-match', { detail: prefill, bubbles: true }))
        location.href = '/pages/match-form.html'
      }
      this.open = false
    },

    _buildPuuidToName(roster, puuidMap) {
      const nameMap = {}, idMap = {}
      for (const m of roster) {
        const puuid = puuidMap?.[m.riot_id] ?? m.puuid
        if (puuid) { nameMap[puuid] = m.name; idMap[puuid] = m.id }
      }
      return { nameMap, idMap }
    },

    // ── Main fetch dispatcher ─────────────────────────────────────────────
    async fetch() {
      if (!this.apiKey) return
      this.loading    = true
      this.cards      = []
      this.keyExpired = false
      try {
        if (this.mode === 'edit') {
          await this._fetchEdit()
        } else {
          await this._fetchCreate()
        }
      } catch (e) {
        console.error(e)
        if (e.expired) this.keyExpired = true
        this.status = 'Erro: ' + e.message
      }
      this.loading = false
    },

    // ── Load already-associated Riot matchIds from PocketBase ────────────
    async _loadAssociatedMatchIds() {
      try {
        const res = await api.col('matches').list({
          perPage: 500,
          fields:  'riot_match_id',
          filter:  'riot_match_id != ""',
        })
        return new Set(res.items.map(m => m.riot_match_id))
      } catch (e) {
        return new Set()
      }
    },

    // ── Resolve roster PUUIDs via RiotApi ────────────────────────────────
    // Returns { puuids: string[], puuidMap: { riot_id → puuid } }
    async _resolveRoster(roster) {
      const base    = RiotApi.baseUrl(localStorage.getItem('riot-region') || 'BR1')
      const results = await Promise.allSettled(
        roster.map(m => RiotApi.resolvePuuid(m.riot_id, this.apiKey, base, {
          playerId:      m.id,
          existingPuuid: m.puuid,
        }))
      )
      const puuids   = []
      const puuidMap = {}
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled' && r.value) {
          puuids.push(r.value)
          puuidMap[roster[i].riot_id] = r.value
        } else if (r.status === 'rejected' && r.reason?.expired) {
          this.keyExpired = true
        }
      }
      return { puuids, puuidMap }
    },

    // ── Process a single match ID → card (with cache awareness) ─────────
    async _processMatchId(matchId, knownPuuidSet, puuidToName, puuidToId = {}, opts = {}) {
      const base = RiotApi.baseUrl(localStorage.getItem('riot-region') || 'BR1')

      // Check summary cache first (shared with import-tool)
      const cached = RiotApi.cache.get(`riot-summary-${matchId}`)
      if (cached) {
        if (!cached.teamComplete) return null   // already known to be non-team match
        if (cached.stats) {
          // Win filter in edit mode
          if (opts.winFilter != null && cached.stats.win !== opts.winFilter) return null
          return this._buildCardFromStats(matchId, cached.stats)
        }
      }

      // Fetch match data from API
      const match    = await RiotApi.fetch(`${base}/lol/match/v5/matches/${matchId}`, this.apiKey)
      const teamSize = RiotApi.countRosterOnSameTeam(match.info?.participants ?? [], knownPuuidSet)
      if (teamSize < 5) {
        RiotApi.cache.set(`riot-summary-${matchId}`, { teamComplete: false, _ts: Date.now() })
        return null
      }

      // Win filter in edit mode
      if (opts.winFilter != null) {
        const our = match.info?.participants?.find(p => knownPuuidSet.has(p.puuid))
        const ourTeam = match.info?.teams?.find(t => t.teamId === our?.teamId)
        if (ourTeam?.win !== opts.winFilter) return null
      }

      await RiotApi.sleep(80)
      const timeline = await RiotApi.fetch(`${base}/lol/match/v5/matches/${matchId}/timeline`, this.apiKey)
      const stats = extractMatchStats(match, timeline, { knownPuuidSet, puuidToName, puuidToId })
      if (!stats) return null

      // Cache the summary for future use
      const ourChampKeys   = stats.ourChampKeys ?? []
      const enemyChampKeys = stats.enemyChampKeys ?? []
      RiotApi.cache.set(`riot-summary-${matchId}`, {
        teamComplete: true,
        stats,
        ourChamps: ourChampKeys,
        enemyChamps: enemyChampKeys,
        _ts: Date.now(),
      })

      return this._buildCardFromStats(matchId, stats)
    },

    // ── Edit mode: date-filtered, minimal API calls ───────────────────────
    async _fetchEdit() {
      this.status = 'Carregando jogadores…'
      const playersRes = await api.col('players').list({ perPage: 50, filter: 'riot_id != ""' })
      const roster     = playersRes.items
      if (!roster.length) { this.status = 'Nenhum jogador com riot_id no banco.'; return }

      this.status = 'Resolvendo contas…'
      const { puuids: knownPuuids, puuidMap } = await this._resolveRoster(roster)
      const knownPuuidSet = new Set(knownPuuids)
      const { nameMap: puuidToName, idMap: puuidToId } = this._buildPuuidToName(roster, puuidMap)
      if (this.keyExpired) { this.status = 'Chave expirada — substitua e tente novamente.'; return }

      // Date ± 1 day → Unix seconds
      const base      = new Date(this.filters.date + 'T12:00:00Z')
      const startTime = Math.floor((base.getTime() - 86400000) / 1000)
      const endTime   = Math.floor((base.getTime() + 86400000) / 1000)

      const riotBase = RiotApi.baseUrl(localStorage.getItem('riot-region') || 'BR1')

      // Fetch IDs for ALL players in parallel → union
      this.status = 'Buscando partidas no período…'
      const idResults = await Promise.allSettled(
        knownPuuids.map(p =>
          RiotApi.fetch(`${riotBase}/lol/match/v5/matches/by-puuid/${p}/ids?startTime=${startTime}&endTime=${endTime}&count=20`, this.apiKey)
        )
      )
      const seen = new Set()
      const ids  = []
      for (const r of idResults) {
        if (r.status !== 'fulfilled') continue
        for (const id of r.value) { if (!seen.has(id)) { seen.add(id); ids.push(id) } }
      }
      if (!ids.length) { this.status = 'Nenhuma partida encontrada no período.'; return }

      const associated = await this._loadAssociatedMatchIds()

      for (let i = 0; i < ids.length; i++) {
        this.status = `Verificando ${i + 1}/${ids.length}…`
        if (associated.has(ids[i])) continue
        try {
          const card = await this._processMatchId(ids[i], knownPuuidSet, puuidToName, puuidToId, { winFilter: this.filters.win })
          if (card) this.cards.push(card)
        } catch (e) { console.warn('Skipping', ids[i], e.message) }
        await RiotApi.sleep(80)
      }

      this.status = this.cards.length
        ? `${this.cards.length} partida(s) encontrada(s).`
        : 'Nenhuma partida correspondente encontrada.'
    },

    // ── Create mode: recent team matches ─────────────────────────────────
    async _fetchCreate() {
      this.status = 'Carregando jogadores…'
      const playersRes = await api.col('players').list({ perPage: 50, filter: 'riot_id != ""' })
      const roster     = playersRes.items
      if (!roster.length) { this.status = 'Nenhum jogador com riot_id no banco.'; return }

      this.status = 'Resolvendo contas…'
      const { puuids: knownPuuids, puuidMap } = await this._resolveRoster(roster)
      const knownPuuidSet = new Set(knownPuuids)
      if (this.keyExpired) { this.status = 'Chave expirada — substitua e tente novamente.'; return }

      const riotBase = RiotApi.baseUrl(localStorage.getItem('riot-region') || 'BR1')

      this.status = 'Buscando partidas recentes…'

      const idResults = await Promise.allSettled(
        knownPuuids.map(p =>
          RiotApi.fetch(`${riotBase}/lol/match/v5/matches/by-puuid/${p}/ids?count=20`, this.apiKey)
        )
      )

      const seen   = new Set()
      const allIds = []
      for (const r of idResults) {
        if (r.status !== 'fulfilled') continue
        for (const id of r.value) {
          if (!seen.has(id)) { seen.add(id); allIds.push(id) }
        }
      }

      if (!allIds.length) { this.status = 'Nenhuma partida encontrada.'; return }

      const { nameMap: puuidToName, idMap: puuidToId } = this._buildPuuidToName(roster, puuidMap)
      const associated  = await this._loadAssociatedMatchIds()

      for (let i = 0; i < allIds.length; i++) {
        this.status = `Verificando ${i + 1}/${allIds.length}…`
        if (associated.has(allIds[i])) continue
        try {
          const card = await this._processMatchId(allIds[i], knownPuuidSet, puuidToName, puuidToId)
          if (card) this.cards.push(card)
        } catch (e) { console.warn('Skipping', allIds[i], e.message) }
        await RiotApi.sleep(80)
      }

      this.status = this.cards.length
        ? `${this.cards.length} partidas do time encontradas.`
        : 'Nenhuma partida com 5 membros do time encontrada.'
    },

    // _resolveChamp: DDragon key → {name, key} for UI display
    _resolveChamp(championId) {
      const id = championId ?? ''
      const lower = id.toLowerCase()
      const found = Alpine.store('champions').list.find(c => c.key === id)
                 ?? Alpine.store('champions').list.find(c => c.name === id)
                 ?? Alpine.store('champions').list.find(c => c.key.toLowerCase() === lower)
      return { name: found?.name ?? id, key: found?.key ?? id }
    },

    _buildCardFromStats(matchId, stats) {
      const ourChamps   = (stats.ourChampKeys ?? []).map(k => this._resolveChamp(k))
      const enemyChamps = (stats.enemyChampKeys ?? []).map(k => this._resolveChamp(k))
      const mvcChamp    = stats.mvcChampKey ? this._resolveChamp(stats.mvcChampKey) : null

      return {
        matchId,
        date:         stats.date,
        win:          stats.win,
        side:         stats.side,
        duration:     stats.duration,
        ourChamps,
        enemyChamps,
        topPlayer:    stats.topPlayer,
        topPlayerId:  stats.topPlayerId ?? null,
        mvp:          stats.mvp,
        mvpId:        stats.mvpId ?? null,
        mvcChampName: mvcChamp?.name ?? '',
        mvcChampKey:  mvcChamp?.key  ?? '',
        teamKills:    stats.team_kills,
        teamDeaths:   stats.team_deaths,
        teamAssists:  stats.team_assists,
        gd10:         stats.gd_10,
        gd20:         stats.gd_20,
        gdF:          stats.gd_f,
        totalGold:    stats.total_gold,
        goldPerMin:   stats.gold_per_min,
        damage:       stats.damage,
        dadi:         stats.da_di,
        wardsPerMin:  stats.wards_per_min,
        visionScore:  stats.vision_score,
        csTotal:      stats.cs_total,
        csPerMin:     stats.cs_per_min,
        firstBlood:   stats.first_blood,
        firstTower:   stats.first_tower,
        objFlow:      stats.obj_flow,
        playerStats:  stats.playerStats,
        _snapshot:    null,   // lazy-loaded on use()
      }
    },

  }))
})
