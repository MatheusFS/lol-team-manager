// ── Draft sequence — 20 steps in official LoL draft order ────────────────────
const DRAFT_SEQUENCE = [
  // Phase 1 Bans (B-R interleaved × 3)
  { type: 'ban',  side: 'blue', idx: 0 },  // 0  Blue Ban 1
  { type: 'ban',  side: 'red',  idx: 0 },  // 1  Red Ban 1
  { type: 'ban',  side: 'blue', idx: 1 },  // 2  Blue Ban 2
  { type: 'ban',  side: 'red',  idx: 1 },  // 3  Red Ban 2
  { type: 'ban',  side: 'blue', idx: 2 },  // 4  Blue Ban 3
  { type: 'ban',  side: 'red',  idx: 2 },  // 5  Red Ban 3
  // Phase 1 Picks: B1, R1+R2, B2+B3, R3
  { type: 'pick', side: 'blue', idx: 0 },  // 6  B1
  { type: 'pick', side: 'red',  idx: 0 },  // 7  R1
  { type: 'pick', side: 'red',  idx: 1 },  // 8  R2
  { type: 'pick', side: 'blue', idx: 1 },  // 9  B2
  { type: 'pick', side: 'blue', idx: 2 },  // 10 B3
  { type: 'pick', side: 'red',  idx: 2 },  // 11 R3
  // Phase 2 Bans (B-R interleaved × 2)
  { type: 'ban',  side: 'blue', idx: 3 },  // 12 Blue Ban 4
  { type: 'ban',  side: 'red',  idx: 3 },  // 13 Red Ban 4
  { type: 'ban',  side: 'blue', idx: 4 },  // 14 Blue Ban 5
  { type: 'ban',  side: 'red',  idx: 4 },  // 15 Red Ban 5
  // Phase 2 Picks: R4, B4+B5, R5
  { type: 'pick', side: 'red',  idx: 3 },  // 16 R4
  { type: 'pick', side: 'blue', idx: 3 },  // 17 B4
  { type: 'pick', side: 'blue', idx: 4 },  // 18 B5
  { type: 'pick', side: 'red',  idx: 4 },  // 19 R5
]

// ── Formation field name mapping (role → PocketBase field name) ──────────────
const FORMATION_FIELDS = {
  top: 'top',
  jng: 'jungle',
  mid: 'mid',
  adc: 'adc',
  sup: 'support',
}

// ── Champion default identity (class → lens) ──────────────────────────────────
function _champDefaultIdentity(c) {
  if (!c) return null
  if (c.class === 'Support')  return 'suporte'
  if (c.class === 'Tank')     return 'tank'
  if (c.class === 'Assassin') return 'assassino'
  if (isCarry(c))             return 'carry'
  if (isBruiser(c))           return 'bruiser'
  return null
}

// ── Alpine component ──────────────────────────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('draftPage', () => ({

    // ── State ─────────────────────────────────────────────────────────────────
    bluePicks: [],   // Array(5) of champion records | null
    redPicks:  [],
    blueBans:  [],
    redBans:   [],

    currentStep: 0,     // 0-19; index into DRAFT_SEQUENCE
    ourSide: 'blue',    // 'blue' | 'red'

    // ── Formations ────────────────────────────────────────────────────────────
    formations:          [],
    selectedFormationId: null,

    // ── Role overrides ────────────────────────────────────────────────────────
    // Manual role assignment per slot: { 'blue:0': 'top', 'blue:2': 'jng', ... }
    // Keys use format `${side}:${idx}`. Only tracked for our side.
    pickRoles: {},

    // ── Formation / pool data ─────────────────────────────────────────────────
    formation:           null,  // active formation (expanded player relations)
    champPool:           {},    // champId → [{ playerName, role, poolTier }]
    playerChampStats:    {},    // "playerName:champKeyNorm" → { n, wins }
    playerIdentityRanks: {},    // playerName → { carry|assassino|bruiser|tank|suporte → rankIdx }
    formationLoaded:     false,

    // ── Modal ─────────────────────────────────────────────────────────────────
    activeSlot:   null,   // { type:'ban'|'pick', side:'blue'|'red', idx:0-4 }
    modalQuery:   '',
    modalResults: [],

    loaded: false,

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    async init() {
      await Alpine.store('champions').load()
      this.bluePicks = Array(5).fill(null)
      this.redPicks  = Array(5).fill(null)
      this.blueBans  = Array(5).fill(null)
      this.redBans   = Array(5).fill(null)
      this._loadFromStorage()
      this.loaded = true
      await this._loadFormations()
      this._loadFormationData()  // non-blocking — recommendations improve progressively
      this.$nextTick(() => {
        this.$watch('bluePicks',   () => this._saveToStorage())
        this.$watch('redPicks',    () => this._saveToStorage())
        this.$watch('blueBans',    () => this._saveToStorage())
        this.$watch('redBans',     () => this._saveToStorage())
        this.$watch('currentStep', () => this._saveToStorage())
        this.$watch('ourSide', () => {
          this._saveToStorage()
          // Force Alpine to re-evaluate all getters that depend on bluePicks/redPicks
          // when ourSide changes (ourPicks/enemyPicks/ourAnalysis/enemyAnalysis/matchup/ourRecs)
          this.bluePicks = [...this.bluePicks]
          this.redPicks  = [...this.redPicks]
        })
        this.$watch('pickRoles',   () => this._saveToStorage())
        // When formation/pool data finishes loading, force Alpine to re-evaluate
        // ourRecs (and other getters that depend on champPool/playerChampStats).
        this.$watch('formationLoaded', () => {
          this.bluePicks = [...this.bluePicks]
          this.redPicks  = [...this.redPicks]
        })
      })
    },

    reset() {
      this.bluePicks   = Array(5).fill(null)
      this.redPicks    = Array(5).fill(null)
      this.blueBans    = Array(5).fill(null)
      this.redBans     = Array(5).fill(null)
      this.currentStep = 0
      this.pickRoles   = {}
      localStorage.removeItem('draft-state')
    },

    exportDraft() {
      const state = {
        bluePicks:   this.bluePicks.map(c => c?.id ?? null),
        redPicks:    this.redPicks.map(c => c?.id ?? null),
        blueBans:    this.blueBans.map(c => c?.id ?? null),
        redBans:     this.redBans.map(c => c?.id ?? null),
        currentStep: this.currentStep,
        ourSide:     this.ourSide,
      }
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `draft-${new Date().toISOString().slice(0,16).replace('T','-')}.json`
      a.click()
      URL.revokeObjectURL(url)
    },

    importDraft() {
      const input    = document.createElement('input')
      input.type     = 'file'
      input.accept   = '.json,application/json'
      input.onchange = async e => {
        const file = e.target.files[0]
        if (!file) return
        try {
          const text  = await file.text()
          const state = JSON.parse(text)
          const champs  = Alpine.store('champions').list
          const resolve = id => (id ? champs.find(c => c.id === id) ?? null : null)
          this.bluePicks   = (state.bluePicks  ?? Array(5).fill(null)).map(resolve)
          this.redPicks    = (state.redPicks   ?? Array(5).fill(null)).map(resolve)
          this.blueBans    = (state.blueBans   ?? Array(5).fill(null)).map(resolve)
          this.redBans     = (state.redBans    ?? Array(5).fill(null)).map(resolve)
          this.currentStep = state.currentStep ?? 0
          this.ourSide     = state.ourSide     ?? 'blue'
          this._saveToStorage()
        } catch (err) {
          alert('Arquivo inválido: ' + err.message)
        }
      }
      input.click()
    },

    // ── Storage ───────────────────────────────────────────────────────────────
    _saveToStorage() {
      try {
        localStorage.setItem('draft-state', JSON.stringify({
          bluePicks:   this.bluePicks.map(c => c?.id ?? null),
          redPicks:    this.redPicks.map(c => c?.id ?? null),
          blueBans:    this.blueBans.map(c => c?.id ?? null),
          redBans:     this.redBans.map(c => c?.id ?? null),
          currentStep: this.currentStep,
          ourSide:     this.ourSide,
          pickRoles:   this.pickRoles,
        }))
      } catch (_) {}
    },

    _loadFromStorage() {
      try {
        const raw = localStorage.getItem('draft-state')
        if (!raw) return
        const state = JSON.parse(raw)
        const byId  = id => id ? (Alpine.store('champions').list.find(c => c.id === id) ?? null) : null
        const restore = (key, prop) => {
          if (Array.isArray(state[key]) && state[key].length === 5)
            this[prop] = state[key].map(byId)
        }
        restore('bluePicks', 'bluePicks')
        restore('redPicks',  'redPicks')
        restore('blueBans',  'blueBans')
        restore('redBans',   'redBans')
        if (typeof state.currentStep === 'number') this.currentStep = state.currentStep
        if (state.ourSide === 'blue' || state.ourSide === 'red') this.ourSide = state.ourSide
        if (state.pickRoles && typeof state.pickRoles === 'object') this.pickRoles = state.pickRoles
      } catch (_) {}
    },

    // ── Load formations list ───────────────────────────────────────────────────
    async _loadFormations() {
      try {
        const fRes = await api.col('formations').list({
          sort: '-active,name', perPage: 100,
          expand: 'top,jungle,mid,adc,support',
        })
        this.formations = fRes.items
        const active = fRes.items.find(f => f.active)
        this.selectedFormationId = active?.id ?? fRes.items[0]?.id ?? null
      } catch (e) {
        console.warn('[draft] _loadFormations failed:', e)
      }
    },

    // ── Formation + pool + WR data ────────────────────────────────────────────
    async _loadFormationData() {
      try {
        if (!this.selectedFormationId) {
          const fRes = await api.col('formations').list({
            sort: '-active,name', perPage: 100,
            expand: 'top,jungle,mid,adc,support',
          })
          this.formation = fRes.items.find(f => f.active) ?? fRes.items[0] ?? null
        } else {
          this.formation = await api.col('formations').get(this.selectedFormationId, {
            expand: 'top,jungle,mid,adc,support',
          })
        }

        // Build role/player lookups from the formation
        const roleForPlayer = {}   // playerId → role
        const playerNames   = {}   // playerId → player name
        for (const role of ['top', 'jng', 'mid', 'adc', 'sup']) {
          const fieldName = FORMATION_FIELDS[role]
          const p = this.formation?.expand?.[fieldName]
          if (p) { roleForPlayer[p.id] = role; playerNames[p.id] = p.name }
        }

        // Champion pool for formation players
        const playerIds = Object.keys(roleForPlayer)
        if (playerIds.length) {
          const poolRes = await api.col('champion_pool').list({
            perPage: 500,
            filter: playerIds.map(id => `player = '${id}'`).join(' || '),
            expand: 'player',
          })
          const pool = {}
          for (const entry of poolRes.items) {
            const cid = entry.champion
            const pid = entry.player
            if (!pool[cid]) pool[cid] = []
            pool[cid].push({
              playerName: entry.expand?.player?.name ?? playerNames[pid] ?? '?',
              role:       roleForPlayer[pid] ?? '?',
              poolTier:   entry.tier,
            })
          }
          this.champPool = pool
        }

        // Per-player per-champion win rates from match history
        const matchRes = await api.col('matches').list({
          perPage: 500, fields: 'win,player_stats',
        })
        const stats = {}
        for (const m of matchRes.items) {
          for (const ps of (m.player_stats ?? [])) {
            if (!ps.name || !ps.champion) continue
            const key = `${ps.name}:${normChampKey(ps.champion)}`
            if (!stats[key]) stats[key] = { n: 0, wins: 0 }
            stats[key].n++
            if (m.win) stats[key].wins++
          }
        }
        this.playerChampStats = stats

        // Compute player identity ranks (carry/assassino/bruiser/tank/suporte)
        try {
          await loadRankConfig()
          const champsByKey = {}
          for (const c of Alpine.store('champions').list) champsByKey[normChampKey(c.key)] = c

          const riotMatches = matchRes.items.filter(m => m.player_stats?.length)
          const mapAll = {}
          for (const m of riotMatches) {
            for (const ps of m.player_stats) {
              if (!ps.name || !ps.champion) continue
              const ce = champsByKey[normChampKey(ps.champion)] ?? null
              const p  = mapAll[ps.name] ??= { nTotal:0, nCarry:0, nAssassino:0, nBruiser:0, nTank:0, nSuporte:0 }
              p.nTotal++
              if (isCarry(ce)) p.nCarry++
              else if (ce?.class === 'Assassin') p.nAssassino++
              else if (isBruiser(ce)) p.nBruiser++
              else if (ce?.class === 'Tank') p.nTank++
              else if (ce?.class === 'Support') p.nSuporte++
            }
          }

          const identRanks = {}
          for (const identLens of ['carry', 'assassino', 'bruiser', 'tank', 'suporte']) {
            const rows = aggregateRows(riotMatches, champsByKey, LENS_DEFS[identLens].filter, mapAll)
            computeIdentityRanks(rows, identLens)
            for (const row of rows) {
              // Only store identity rank if player has 3+ games in this lens
              if (row.identRank && row.n >= 3) {
                identRanks[row.name] ??= {}
                identRanks[row.name][identLens] = row.identRank.rankIdx
              }
            }
          }
          this.playerIdentityRanks = identRanks
        } catch (e) {
          console.warn('[draft] identity ranks failed:', e)
        }
      } catch (e) {
        console.warn('[draft] _loadFormationData failed:', e)
      } finally {
        this.formationLoaded = true
      }
    },

    // Change the selected formation and reload formation data
    async changeFormation(formationId) {
      this.selectedFormationId = formationId
      await this._loadFormationData()
    },

    // ── Modal ─────────────────────────────────────────────────────────────────
    openPicker(type, side, idx) {
      this.activeSlot   = { type, side, idx }
      this.modalQuery   = ''
      this.modalResults = []
      this.$nextTick(() => document.getElementById('modal-search')?.focus())
    },

    closePicker() {
      this.activeSlot   = null
      this.modalQuery   = ''
      this.modalResults = []
    },

    searchModal() {
      if (!this.modalQuery.trim()) { this.modalResults = []; return }
      const used = this._usedIds()
      this.modalResults = Alpine.store('champions')
        .search(this.modalQuery, 40)
        .filter(c => !used.has(c.id))
    },

    pickChamp(champ) {
      if (!this.activeSlot) return
      const { type, side, idx } = this.activeSlot
      const arr = this._arr(type, side)
      arr[idx] = champ
      // Auto-confirm role when champion has exactly one viable role
      if (type === 'pick') {
        const roles = parseViableRoles(champ)
        if (roles.length === 1) {
          this.pickRoles = { ...this.pickRoles, [`${side}:${idx}`]: roles[0] }
        }
      }
      // Force Alpine reactivity (replace array reference)
      if (type === 'ban') {
        if (side === 'blue') this.blueBans = [...this.blueBans]
        else                 this.redBans  = [...this.redBans]
      } else {
        if (side === 'blue') this.bluePicks = [...this.bluePicks]
        else                 this.redPicks  = [...this.redPicks]
      }
      // Advance draft step if this filled the current step
      const cur = DRAFT_SEQUENCE[this.currentStep]
      if (cur && cur.type === type && cur.side === side && cur.idx === idx) {
        this._advanceStep()
      }
      this.closePicker()
    },

    clearSlot(type, side, idx) {
      const arr = this._arr(type, side)
      arr[idx] = null
      if (type === 'ban') {
        if (side === 'blue') this.blueBans = [...this.blueBans]
        else                 this.redBans  = [...this.redBans]
      } else {
        if (side === 'blue') this.bluePicks = [...this.bluePicks]
        else                 this.redPicks  = [...this.redPicks]
      }
    },

    quickPick(champ) {
      const arr = this.ourSide === 'blue' ? this.bluePicks : this.redPicks
      const idx = arr.findIndex(c => !c)
      if (idx === -1) return
      arr[idx] = champ
      // Auto-confirm role when champion has exactly one viable role
      const roles = parseViableRoles(champ)
      if (roles.length === 1) {
        this.pickRoles = { ...this.pickRoles, [`${this.ourSide}:${idx}`]: roles[0] }
      }
      if (this.ourSide === 'blue') this.bluePicks = [...this.bluePicks]
      else                         this.redPicks  = [...this.redPicks]
    },

    // ── Step helpers ──────────────────────────────────────────────────────────
    _advanceStep() {
      for (let s = this.currentStep + 1; s < DRAFT_SEQUENCE.length; s++) {
        const { type, side, idx } = DRAFT_SEQUENCE[s]
        if (!this._arr(type, side)[idx]) { this.currentStep = s; return }
      }
      this.currentStep = DRAFT_SEQUENCE.length  // draft complete
    },

    isCurrentStep(type, side, idx) {
      if (this.currentStep >= DRAFT_SEQUENCE.length) return false
      const s = DRAFT_SEQUENCE[this.currentStep]
      return s.type === type && s.side === side && s.idx === idx
    },

    get stepLabel() {
      const step = this.currentStep
      if (step >= DRAFT_SEQUENCE.length) return '✅ Draft completo'
      const { type, side, idx } = DRAFT_SEQUENCE[step]
      const phase = step < 6  ? 'Fase 1 Bans'
                  : step < 12 ? 'Fase 1 Picks'
                  : step < 16 ? 'Fase 2 Bans'
                  :             'Fase 2 Picks'
      const sideLabel = side === 'blue' ? 'Blue' : 'Red'
      const n = idx + 1
      return `${phase} • ${sideLabel} ${type === 'ban' ? 'Ban' : 'Pick'} ${n}`
    },

    get currentPhase() {
      const s = this.currentStep
      if (s < 6)  return 'ban1'
      if (s < 12) return 'pick1'
      if (s < 16) return 'ban2'
      if (s < 20) return 'pick2'
      return 'done'
    },

    // ── Analysis getters (reactive) ───────────────────────────────────────────
    get ourPicks()      { return this.ourSide === 'blue' ? this.bluePicks : this.redPicks },
    get enemyPicks()    { return this.ourSide === 'blue' ? this.redPicks  : this.bluePicks },
    get ourAnalysis()   { return analyzeTeam(this.ourSide === 'blue' ? this.bluePicks : this.redPicks) },
    get enemyAnalysis() { return analyzeTeam(this.ourSide === 'blue' ? this.redPicks  : this.bluePicks) },
    get blueAnalysis()  { return analyzeTeam(this.bluePicks) },
    get redAnalysis()   { return analyzeTeam(this.redPicks) },

    get ourRecs() {
      // Accesses this.ourSide, bluePicks, redPicks directly for Alpine reactivity
      const ourPicks = this.ourSide === 'blue' ? this.bluePicks : this.redPicks
      const enemyPicks = this.ourSide === 'blue' ? this.redPicks : this.bluePicks
      const overrides = ourPicks
        .map((_, i) => this.pickRoles[`${this.ourSide}:${i}`] ?? null)
      const ourAnalysis = analyzeTeam(ourPicks)
      const enemyAnalysis = analyzeTeam(enemyPicks)
      return buildRecommendations(
        ourAnalysis,
        enemyAnalysis,
        ourPicks,
        overrides,
        this._recContext(),
      )
    },

    get matchup() {
      // Accesses this.ourSide, bluePicks, redPicks directly for Alpine reactivity
      const ourPicks = this.ourSide === 'blue' ? this.bluePicks : this.redPicks
      const enemyPicks = this.ourSide === 'blue' ? this.redPicks : this.bluePicks
      const ourComp = analyzeTeam(ourPicks).compType
      const enemyComp = analyzeTeam(enemyPicks).compType
      return this.matchupResult(ourComp, enemyComp)
    },

    // ── Comp matchup ──────────────────────────────────────────────────────────
    matchupResult(ourComp, enemyComp) {
      if (!ourComp || !enemyComp) return null
      if ((COMP_BEATS[ourComp]   ?? []).includes(enemyComp)) return 'advantage'
      if ((COMP_BEATS[enemyComp] ?? []).includes(ourComp))   return 'disadvantage'
      return 'neutral'
    },

    // ── Role override toggle ───────────────────────────────────────────────────
    // If the slot already has that role, remove the override (toggle off).
    setPickRole(side, idx, role) {
      const key = `${side}:${idx}`
      if (this.pickRoles[key] === role) {
        const updated = { ...this.pickRoles }
        delete updated[key]
        this.pickRoles = updated
      } else {
        this.pickRoles = { ...this.pickRoles, [key]: role }
      }
      this._saveToStorage()
    },

    // ── Context builder for recommendation engine ─────────────────────────────
    _recContext() {
      return {
        champPool:        this.champPool,
        playerChampStats: this.playerChampStats,
        formation:        this.formation,
        formationFields:  FORMATION_FIELDS,
        usedIds:          this._usedIds(),
        championsList:    Alpine.store('champions').list,
      }
    },

    // ── Display helpers ───────────────────────────────────────────────────────
    scaleIdx(raw) {
      if (raw == null) return null
      return raw >= 7 / 5 ? 2 : raw >= 3 / 5 ? 1 : 0
    },

    badgeClass(color) {
      return {
        green:  'bg-green-500/15 text-green-400 border border-green-500/30',
        yellow: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
        red:    'bg-red-500/15 text-red-400 border border-red-500/30',
      }[color] ?? 'bg-slate-700/50 text-slate-400'
    },

    tierColor(tier) {
      return { S: 'text-yellow-300', A: 'text-green-400', B: 'text-slate-300', C: 'text-orange-400', D: 'text-red-400' }[tier] ?? 'text-slate-600'
    },

    // Get the best (highest) tier across all roles in tier_by_role
    // Used for champion picker modal when role is not known
    bestTierOf(champ) {
      if (!champ?.tier_by_role || typeof champ.tier_by_role !== 'object' || Array.isArray(champ.tier_by_role)) return null
      const tiers = Object.values(champ.tier_by_role).filter(t => t && /^[SABCD]$/.test(t))
      if (!tiers.length) return null
      const tierOrder = { S: 0, A: 1, B: 2, C: 3, D: 4 }
      return tiers.sort((a, b) => (tierOrder[a] ?? 5) - (tierOrder[b] ?? 5))[0] ?? null
    },

    // Winrate color: follows stats-page scheme
    // 60%+ = Green, 40-60% = Yellow, <40% = Red, null/undefined = Slate
    wrColor(wrPct) {
      if (wrPct == null || wrPct === undefined) return 'text-slate-400'
      const wr = Number(wrPct)
      if (wr >= 60) return 'text-green-400'
      if (wr >= 40) return 'text-yellow-400'
      return 'text-red-400'
    },

    damageClass(dt) { return DAMAGE_TYPE_CLASSES[dt] ?? 'bg-slate-700 text-slate-400' },
    damageLabel(dt) { return DAMAGE_TYPE_LABELS[dt]  ?? dt ?? '' },
    compEmoji(type) { return COMP_EMOJI[type]         ?? '' },

    // Pool entries for a champion, sorted star → green → yellow
    champPoolInfo(champId) {
      return (this.champPool?.[champId] ?? [])
        .slice()
        .sort((a, b) => (POOL_TIER_ORDER_REC[a.poolTier] ?? 2) - (POOL_TIER_ORDER_REC[b.poolTier] ?? 2))
    },

    // Pool entries for a champion filtered by role (for rec lines)
    champPoolInfoForRole(champId, role) {
      return (this.champPool?.[champId] ?? [])
        .filter(e => e.role === role)
        .slice()
        .sort((a, b) => (POOL_TIER_ORDER_REC[a.poolTier] ?? 2) - (POOL_TIER_ORDER_REC[b.poolTier] ?? 2))
    },

    poolTierIcon(tier) {
      return { star: '★', green: '●', yellow: '◐' }[tier] ?? '?'
    },

    roleLabel(role) {
      return { top: 'TOP', jng: 'JNG', mid: 'MID', adc: 'ADC', sup: 'SUP' }[role]
        ?? role.toUpperCase()
    },

    // Identity rank image for a player on a champion's default identity lens
    champIdentityForPlayer(champ, playerName) {
      if (!champ || !playerName) return null
      const lens    = _champDefaultIdentity(champ)
      if (!lens) return null
      const rankIdx = this.playerIdentityRanks?.[playerName]?.[lens]
      if (rankIdx == null) return null
      return {
        rankIdx,
        imgUrl: `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/${RANK_NAMES[rankIdx]}.png`
      }
    },

    // Win rate for a player on a specific champion (null if < 3 games)
    playerWR(playerName, champKey) {
      const s = this.playerChampStats?.[`${playerName}:${normChampKey(champKey)}`]
      if (!s || s.n < 3) return null
      return { pct: Math.round(s.wins / s.n * 100), n: s.n }
    },

    // Player name for a role in the active formation (used in templates)
    formationPlayerForRole(role) {
      const fieldName = FORMATION_FIELDS[role]
      return this.formation?.expand?.[fieldName]?.name ?? null
    },

    // ── Internals ─────────────────────────────────────────────────────────────
    _arr(type, side) {
      if (type === 'ban') return side === 'blue' ? this.blueBans  : this.redBans
      return                     side === 'blue' ? this.bluePicks : this.redPicks
    },

    _usedIds() {
      return new Set([
        ...this.bluePicks.filter(Boolean).map(c => c.id),
        ...this.redPicks.filter(Boolean).map(c => c.id),
        ...this.blueBans.filter(Boolean).map(c => c.id),
        ...this.redBans.filter(Boolean).map(c => c.id),
      ])
    },
  }))
})
