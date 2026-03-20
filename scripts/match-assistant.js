const RIOT_BASE = 'https://americas.api.riotgames.com'
const POS_ORDER = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 }

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
            <span x-show="card.topPlayer">Top: <span class="text-slate-200" x-text="card.topPlayer"></span></span>
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
    puuids:     {},   // riot_id → puuid (session cache)

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

    // Apply card: dispatch event (caught by matchForm if present) + localStorage fallback
    use(card) {
      const { _snapshot, ...prefill } = card
      if (location.pathname.includes('match-form')) {
        // Already on the form — pass snapshot inline so it doesn't leak to the next session
        window.dispatchEvent(new CustomEvent('apply-match', { detail: { ...prefill, _snapshot }, bubbles: true }))
      } else {
        localStorage.setItem('match-assistant-prefill', JSON.stringify(prefill))
        if (_snapshot) localStorage.setItem('match-assistant-snapshot', JSON.stringify(_snapshot))
        window.dispatchEvent(new CustomEvent('apply-match', { detail: prefill, bubbles: true }))
        location.href = '/pages/match-form.html'
      }
      this.open = false
    },

    // ── Riot API fetch helper ─────────────────────────────────────────────
    async _riotFetch(url) {
      const res = await fetch(url, { headers: { 'X-Riot-Token': this.apiKey } })
      if (res.status === 401 || res.status === 403) this.keyExpired = true
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(`Riot API ${res.status}: ${body?.status?.message ?? url}`)
      }
      return res.json()
    },

    // ── Resolve PUUID: session cache → DB cache → Riot API (saves back) ───
    async _resolvePuuid(player) {
      if (this.puuids[player.riot_id])  return this.puuids[player.riot_id]
      if (player.puuid) {
        this.puuids[player.riot_id] = player.puuid
        return player.puuid
      }
      const [gameName, tagLine] = player.riot_id.split('#')
      const data = await this._riotFetch(
        `${RIOT_BASE}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
      )
      this.puuids[player.riot_id] = data.puuid
      api.col('players').update(player.id, { puuid: data.puuid }).catch(() => {})
      return data.puuid
    },

    async _fetchMatchIds(puuid, count = 20, extra = '') {
      return this._riotFetch(
        `${RIOT_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}${extra}`
      )
    },

    _countRosterOnSameTeam(participants, knownPuuidSet) {
      const counts = {}
      for (const p of participants) {
        if (knownPuuidSet.has(p.puuid)) counts[p.teamId] = (counts[p.teamId] ?? 0) + 1
      }
      const vals = Object.values(counts)
      return vals.length ? Math.max(...vals) : 0
    },

    _findOurTeam(info, knownPuuidSet) {
      const our = info.participants?.find(p => knownPuuidSet.has(p.puuid))
      return info.teams?.find(t => t.teamId === our?.teamId) ?? null
    },

    _buildPuuidToName(roster) {
      const map = {}
      for (const m of roster) {
        const puuid = this.puuids[m.riot_id] ?? m.puuid
        if (puuid) map[puuid] = m.name
      }
      return map
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
        this.status = 'Erro: ' + e.message
      }
      this.loading = false
    },

    // ── Edit mode: date-filtered, minimal API calls ───────────────────────
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
        return new Set()   // graceful fallback — never block the search
      }
    },

    async _fetchEdit() {
      this.status = 'Carregando jogadores…'
      const playersRes = await api.col('players').list({ perPage: 50, filter: 'riot_id != ""' })
      const roster     = playersRes.items
      if (!roster.length) { this.status = 'Nenhum jogador com riot_id no banco.'; return }

      // Resolve all PUUIDs in parallel (needed for union ID search)
      this.status = 'Resolvendo contas…'
      const puuidResults  = await Promise.allSettled(roster.map(m => this._resolvePuuid(m)))
      const knownPuuids   = puuidResults.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean)
      const knownPuuidSet = new Set(knownPuuids)
      const puuidToName   = this._buildPuuidToName(roster)
      if (this.keyExpired) { this.status = 'Chave expirada — substitua e tente novamente.'; return }

      // Date ± 1 day → Unix seconds
      const base      = new Date(this.filters.date + 'T12:00:00Z')
      const startTime = Math.floor((base.getTime() - 86400000) / 1000)
      const endTime   = Math.floor((base.getTime() + 86400000) / 1000)

      // Fetch IDs for ALL players in parallel → union (handles subs / roster changes)
      this.status = 'Buscando partidas no período…'
      const idResults = await Promise.allSettled(
        knownPuuids.map(p =>
          this._riotFetch(`${RIOT_BASE}/lol/match/v5/matches/by-puuid/${p}/ids?startTime=${startTime}&endTime=${endTime}&count=20`)
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
        if (associated.has(ids[i])) continue   // já associada a outra partida
        try {
          const match    = await this._riotFetch(`${RIOT_BASE}/lol/match/v5/matches/${ids[i]}`)
          const teamSize = this._countRosterOnSameTeam(match.info?.participants ?? [], knownPuuidSet)
          if (teamSize < 5) { await new Promise(r => setTimeout(r, 50)); continue }

          // Win filter when available
          if (this.filters.win != null) {
            const ourTeam = this._findOurTeam(match.info, knownPuuidSet)
            if (ourTeam?.win !== this.filters.win) { await new Promise(r => setTimeout(r, 50)); continue }
          }

          await new Promise(r => setTimeout(r, 80))
          const timeline = await this._riotFetch(`${RIOT_BASE}/lol/match/v5/matches/${ids[i]}/timeline`)
          const card = this._buildCard(match, timeline, knownPuuidSet, puuidToName)
          if (card) this.cards.push(card)
        } catch (e) { console.warn('Skipping', ids[i], e.message) }
        await new Promise(r => setTimeout(r, 80))
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
      const puuidResults = await Promise.allSettled(roster.map(m => this._resolvePuuid(m)))
      const knownPuuids  = puuidResults.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean)
      const knownPuuidSet = new Set(knownPuuids)

      if (this.keyExpired) { this.status = 'Chave expirada — substitua e tente novamente.'; return }

      this.status = 'Buscando partidas recentes…'
      const idResults = await Promise.allSettled(knownPuuids.map(p => this._fetchMatchIds(p, 20)))

      const seen   = new Set()
      const allIds = []
      for (const r of idResults) {
        if (r.status !== 'fulfilled') continue
        for (const id of r.value) {
          if (!seen.has(id)) { seen.add(id); allIds.push(id) }
        }
      }

      if (!allIds.length) { this.status = 'Nenhuma partida encontrada.'; return }

      const puuidToName = this._buildPuuidToName(roster)
      const associated  = await this._loadAssociatedMatchIds()

      for (let i = 0; i < allIds.length; i++) {
        this.status = `Verificando ${i + 1}/${allIds.length}…`
        if (associated.has(allIds[i])) continue   // already logged
        try {
          const match    = await this._riotFetch(`${RIOT_BASE}/lol/match/v5/matches/${allIds[i]}`)
          const teamSize = this._countRosterOnSameTeam(match.info?.participants ?? [], knownPuuidSet)
          if (teamSize < 5) { await new Promise(r => setTimeout(r, 50)); continue }

          await new Promise(r => setTimeout(r, 80))
          const timeline = await this._riotFetch(`${RIOT_BASE}/lol/match/v5/matches/${allIds[i]}/timeline`)
          const card = this._buildCard(match, timeline, knownPuuidSet, puuidToName)
          if (card) this.cards.push(card)
        } catch (e) { console.warn('Skipping', allIds[i], e.message) }
        await new Promise(r => setTimeout(r, 80))
      }

      this.status = this.cards.length
        ? `${this.cards.length} partidas do time encontradas.`
        : 'Nenhuma partida com 5 membros do time encontrada.'
    },

    // ── Sort participants by lane position ────────────────────────────────
    _sortByPosition(participants) {
      return [...participants].sort((a, b) => {
        const ai = POS_ORDER[a.teamPosition] ?? POS_ORDER[a.individualPosition] ?? 99
        const bi = POS_ORDER[b.teamPosition] ?? POS_ORDER[b.individualPosition] ?? 99
        return ai - bi
      })
    },

    _calcGdAtMinute(timeline, ourParticipantIds, minute) {
      const frames = timeline?.info?.frames
      if (!frames || frames.length <= minute) return null
      const frame = frames[minute]
      if (!frame?.participantFrames) return null
      const ourSet = new Set(ourParticipantIds)
      let ourGold = 0, enemyGold = 0
      for (const [pidStr, pf] of Object.entries(frame.participantFrames)) {
        const pid = parseInt(pidStr, 10)
        if (ourSet.has(pid)) ourGold += pf.totalGold ?? 0
        else                 enemyGold += pf.totalGold ?? 0
      }
      return ourGold - enemyGold
    },

    _buildObjFlow(teamObj) {
      if (!teamObj) return ''
      const t  = teamObj.tower?.kills      ?? 0
      const v  = teamObj.horde?.kills      ?? 0
      const g  = teamObj.riftHerald?.kills ?? 0
      const d  = teamObj.dragon?.kills     ?? 0
      const b  = teamObj.baron?.kills      ?? 0
      const ih = teamObj.inhibitor?.kills  ?? 0
      const n  = teamObj.nexus?.kills      ?? 0
      return `${t}/${v}/${g}/${d}/${b}/${ih}/${n}`
    },

    _resolveChamp(championId) {
      // Riot API returns the internal DDragon id (e.g. "AurelionSol", "Nunu", "DrMundo").
      // Match by key first (exact), then name, then case-insensitive key for edge cases
      // like "FiddleSticks" (Riot) vs "Fiddlesticks" (DDragon).
      const id = championId ?? ''
      const lower = id.toLowerCase()
      const found = Alpine.store('champions').list.find(c => c.key === id)
                 ?? Alpine.store('champions').list.find(c => c.name === id)
                 ?? Alpine.store('champions').list.find(c => c.key.toLowerCase() === lower)
      return { name: found?.name ?? id, key: found?.key ?? id }
    },

    _identifyTopPlayer(sortedOurParticipants, puuidToName) {
      for (const p of sortedOurParticipants) {
        const pos = p.teamPosition || p.individualPosition
        if (pos === 'TOP') return puuidToName[p.puuid] ?? ''
      }
      return ''
    },

    _suggestMvp(ourParticipants, puuidToName) {
      let best = null, bestScore = -Infinity
      for (const p of ourParticipants) {
        const name = puuidToName[p.puuid]
        if (!name) continue
        const score = (p.kills ?? 0) * 2 + (p.assists ?? 0) - (p.deaths ?? 0) * 0.5
        if (score > bestScore) { bestScore = score; best = name }
      }
      return best ?? ''
    },

    _buildCard(match, timeline, knownPuuidSet, puuidToName) {
      const info = match?.info
      if (!info) return null

      const participants    = info.participants ?? []
      const ourParticipants = participants.filter(p => knownPuuidSet.has(p.puuid))
      if (!ourParticipants.length) return null

      const ourTeamId = ourParticipants[0].teamId
      const ourTeam   = info.teams?.find(t => t.teamId === ourTeamId)
      const allOur    = participants.filter(p => p.teamId === ourTeamId)
      const allEnemy  = participants.filter(p => p.teamId !== ourTeamId)
      const ourParticipantIds = allOur.map(p => p.participantId)

      const win      = ourTeam?.win ?? false
      const side     = ourTeamId === 100 ? 'Blue' : 'Red'
      const date     = info.gameStartTimestamp
        ? new Date(info.gameStartTimestamp).toISOString().slice(0, 10)
        : ''
      const duration = info.gameDuration ? Math.round(info.gameDuration / 60) : null

      const sortedOur   = this._sortByPosition(allOur)
      const sortedEnemy = this._sortByPosition(allEnemy)
      const ourChamps   = sortedOur.map(p => this._resolveChamp(p.championName))
      const enemyChamps = sortedEnemy.map(p => this._resolveChamp(p.championName))

      const gd10 = this._calcGdAtMinute(timeline, ourParticipantIds, 10)
      const gd20 = this._calcGdAtMinute(timeline, ourParticipantIds, 20)

      let gdF = null
      const frames = timeline?.info?.frames
      if (frames?.length) {
        const last   = frames[frames.length - 1]
        const ourSet = new Set(ourParticipantIds)
        if (last?.participantFrames) {
          let ourG = 0, enmG = 0
          for (const [pidStr, pf] of Object.entries(last.participantFrames)) {
            const pid = parseInt(pidStr, 10)
            if (ourSet.has(pid)) ourG += pf.totalGold ?? 0
            else                 enmG += pf.totalGold ?? 0
          }
          gdF = ourG - enmG
        }
      }

      const teamKills  = allOur.reduce((s, p) => s + (p.kills   ?? 0), 0)
      const teamDeaths = allOur.reduce((s, p) => s + (p.deaths  ?? 0), 0)
      const teamAssists = allOur.reduce((s, p) => s + (p.assists ?? 0), 0)
      const totalGold  = allOur.reduce((s, p) => s + (p.goldEarned ?? 0), 0)
      const damage     = allOur.reduce((s, p) => s + (p.totalDamageDealtToChampions ?? 0), 0)
      const goldPerMin = duration ? Math.round(totalGold / duration) : null

      const totalWards  = allOur.reduce((s, p) => s + (p.wardsPlaced ?? 0), 0)
      const wardsPerMin = duration ? Math.round((totalWards / duration) * 10) / 10 : null

      const damageTaken = allOur.reduce((s, p) => s + (p.totalDamageTaken ?? 0), 0)
      const dadi = damageTaken > 0 ? Math.round((damage / damageTaken) * 100) / 100 : null

      const visionScore = allOur.reduce((s, p) => s + (p.visionScore ?? 0), 0)
      const csTotal     = allOur.reduce((s, p) => s + (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0), 0)
      const csPerMin    = duration ? Math.round((csTotal / duration) * 10) / 10 : null
      const firstBlood  = ourTeam?.objectives?.champion?.first ?? false
      const firstTower  = ourTeam?.objectives?.tower?.first    ?? false

      const playerStats = allOur.map(p => {
        const champ = this._resolveChamp(p.championName)
        const kda = p.deaths === 0
          ? (p.kills + p.assists)
          : Math.round(((p.kills + p.assists) / p.deaths) * 100) / 100
        return {
          name:        puuidToName[p.puuid] ?? null,
          role:        p.teamPosition || p.individualPosition || null,
          champion:    champ.name,
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

      const objFlow   = this._buildObjFlow(ourTeam?.objectives)
      const topPlayer    = this._identifyTopPlayer(sortedOur, puuidToName)
      const mvp          = this._suggestMvp(allOur, puuidToName)
      const mvpParticipant = allOur.find(p => puuidToName[p.puuid] === mvp)
      const mvcChamp     = mvpParticipant ? this._resolveChamp(mvpParticipant.championName) : null

      return {
        matchId: match.metadata?.matchId ?? '',
        date, win, side, duration,
        ourChamps, enemyChamps,
        topPlayer, mvp,
        mvcChampName: mvcChamp?.name ?? '',
        mvcChampKey:  mvcChamp?.key  ?? '',
        teamKills, teamDeaths, teamAssists,
        gd10, gd20, gdF,
        totalGold, goldPerMin, damage, dadi, wardsPerMin,
        visionScore, csTotal, csPerMin,
        firstBlood, firstTower,
        objFlow,
        playerStats,
        _snapshot: { match, timeline },
      }
    },

  }))
})
