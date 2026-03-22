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

// ── Champion pool tier sort order ────────────────────────────────────────────
const POOL_TIER_ORDER = { star: 0, green: 1, yellow: 2 }

// ── Comp type counter relationships ──────────────────────────────────────────
// Arrow direction in the image = beats. e.g. PICK → ENGAGE means Pick beats Engage.
const COMP_BEATS = {
  Engage:  ['Split', 'Siege'],
  Protect: ['Engage', 'Pick'],
  Pick:    ['Engage', 'Split'],
  Siege:   ['Protect', 'Pick'],
  Split:   ['Siege'],
  Mix:     [],
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

    // ── Formation / pool data ──────────────────────────────────────────────────
    formation:        null,  // active formation (expanded player relations)
    champPool:        {},    // champId → [{ playerName, role, poolTier }]
    playerChampStats: {},    // "playerName:champKeyNorm" → { n, wins }
    formationLoaded:  false,

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
      this._loadFormationData()  // non-blocking — recommendations improve progressively
      // Auto-save on any state change (after initial load to avoid spurious writes)
      this.$nextTick(() => {
        this.$watch('bluePicks',   () => this._saveToStorage())
        this.$watch('redPicks',    () => this._saveToStorage())
        this.$watch('blueBans',    () => this._saveToStorage())
        this.$watch('redBans',     () => this._saveToStorage())
        this.$watch('currentStep', () => this._saveToStorage())
        this.$watch('ourSide',     () => this._saveToStorage())
      })
    },

    reset() {
      this.bluePicks   = Array(5).fill(null)
      this.redPicks    = Array(5).fill(null)
      this.blueBans    = Array(5).fill(null)
      this.redBans     = Array(5).fill(null)
      this.currentStep = 0
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
      const input = document.createElement('input')
      input.type  = 'file'
      input.accept = '.json,application/json'
      input.onchange = async e => {
        const file = e.target.files[0]
        if (!file) return
        try {
          const text  = await file.text()
          const state = JSON.parse(text)
          const champs = Alpine.store('champions').list
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
      } catch (_) {}
    },

    // ── Formation + pool + WR data ────────────────────────────────────────────
    async _loadFormationData() {
      try {
        // 1. Active formation (with expanded player relations)
        const fRes = await api.col('formations').list({
          sort: '-active,name', perPage: 100,
          expand: 'top,jng,mid,adc,sup',
        })
        this.formation = fRes.items.find(f => f.active) ?? fRes.items[0] ?? null

        const roleForPlayer = {}  // playerId → role label
        const playerNames   = {}  // playerId → player name
        for (const role of ['top', 'jng', 'mid', 'adc', 'sup']) {
          const p = this.formation?.expand?.[role]
          if (p) { roleForPlayer[p.id] = role; playerNames[p.id] = p.name }
        }

        // 2. Champion pool for formation players
        const playerIds = Object.keys(roleForPlayer)
        if (playerIds.length) {
          const poolRes = await api.col('champion_pool').list({
            perPage: 500,
            filter: playerIds.map(id => `player = '${id}'`).join(' || '),
            expand: 'player',
          })
          const pool = {}
          for (const entry of poolRes.items) {
            const cid = entry.champion  // PocketBase champion relation ID
            const pid = entry.player
            if (!pool[cid]) pool[cid] = []
            pool[cid].push({
              playerName: entry.expand?.player?.name ?? playerNames[pid] ?? '?',
              role:       roleForPlayer[pid] ?? '?',
              poolTier:   entry.tier,  // 'star' | 'green' | 'yellow'
            })
          }
          this.champPool = pool
        }

        // 3. Per-player per-champion win rates from match history
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
      } catch (e) {
        console.warn('[draft] _loadFormationData falhou:', e)
      } finally {
        this.formationLoaded = true
      }
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
      // Force Alpine reactivity for arrays (replace the array reference)
      if (type === 'ban') {
        if (side === 'blue') this.blueBans = [...this.blueBans]
        else                 this.redBans  = [...this.redBans]
      } else {
        if (side === 'blue') this.bluePicks = [...this.bluePicks]
        else                 this.redPicks  = [...this.redPicks]
      }
      // Advance step if this was the current step
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
      // Fill the next empty pick slot for our side
      const arr = this.ourSide === 'blue' ? this.bluePicks : this.redPicks
      const idx = arr.findIndex(c => !c)
      if (idx === -1) return
      arr[idx] = champ
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
    get ourPicks()     { return this.ourSide === 'blue' ? this.bluePicks : this.redPicks },
    get enemyPicks()   { return this.ourSide === 'blue' ? this.redPicks  : this.bluePicks },
    get ourAnalysis()  { return this._analyzeTeam(this.ourPicks) },
    get enemyAnalysis(){ return this._analyzeTeam(this.enemyPicks) },
    get ourRecs()      { return this._getRecommendations(this.ourAnalysis) },
    get matchup()      { return this.matchupResult(this.ourAnalysis.compType, this.enemyAnalysis.compType) },

    // ── Comp matchup ──────────────────────────────────────────────────────────
    matchupResult(ourComp, enemyComp) {
      if (!ourComp || !enemyComp) return null
      if ((COMP_BEATS[ourComp]   ?? []).includes(enemyComp)) return 'advantage'
      if ((COMP_BEATS[enemyComp] ?? []).includes(ourComp))   return 'disadvantage'
      return 'neutral'
    },

    // ── Core analysis ─────────────────────────────────────────────────────────
    _analyzeTeam(picks) {
      const filled = picks.filter(Boolean)
      if (!filled.length) return { picks: filled, count: 0, compType: null, voteList: [], scaling: [null, null, null], classCounts: {}, damageCounts: {}, heuristics: {}, gaps: [], overallScore: 0 }

      const comp       = this._buildCompVector(filled)
      const counts     = this._buildCounts(filled)
      const heuristics = this._buildHeuristics(filled, comp, counts)
      const weights    = { frontline: 1.5, dps: 1.5, engage: 1.2, peel: 0.8, damageSplit: 1.0, coherence: 1.0 }
      const maxScore   = Object.values(weights).reduce((s, w) => s + w * 3, 0)
      const rawScore   = Object.entries(heuristics).reduce((s, [k, h]) => s + (weights[k] ?? 1) * h.score, 0)
      const gaps       = Object.entries(heuristics)
        .filter(([, h]) => h.score < 2)
        .sort(([, a], [, b]) => a.score - b.score)
        .map(([k]) => k)

      return {
        picks:        filled,
        count:        filled.length,
        compType:     comp.compType,
        voteList:     comp.voteList,
        scaling:      comp.scaling,
        classCounts:  counts.classCounts,
        damageCounts: counts.damageCounts,
        heuristics,
        gaps,
        overallScore: rawScore / maxScore,
      }
    },

    _buildCompVector(picks) {
      const votes  = {}
      const totals = [0, 0, 0], counts = [0, 0, 0]
      for (const c of picks) {
        if (c.comp_type)   votes[c.comp_type]   = (votes[c.comp_type]   ?? 0) + 2
        if (c.comp_type_2) votes[c.comp_type_2] = (votes[c.comp_type_2] ?? 0) + 1
        for (let i = 0; i < 3; i++) {
          const v = c[['early', 'mid', 'late'][i]]
          if (v != null) { totals[i] += v; counts[i]++ }
        }
      }
      const maxV     = Object.values(votes).length ? Math.max(...Object.values(votes)) : 0
      const winners  = Object.keys(votes).filter(k => votes[k] === maxV)
      const compType = winners.length === 1 ? winners[0] : (winners.length > 1 ? 'Mix' : null)
      const scaling  = totals.map((t, i) => counts[i] ? t / counts[i] : null)
      const voteList = Object.entries(votes).map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n)
      return { compType, scaling, voteList }
    },

    _buildCounts(picks) {
      const classCounts  = Object.fromEntries(CHAMPION_CLASSES.map(c => [c, 0]))
      const damageCounts = { AD_high: 0, AD_low: 0, AP_high: 0, AP_low: 0, Mixed_high: 0, Mixed_low: 0 }
      for (const c of picks) {
        if (c.class && c.class in classCounts) classCounts[c.class]++
        const dt = c.damage_type
        if (dt) {
          if (dt === 'Mixed') damageCounts.Mixed_low++  // legacy fallback
          else if (dt in damageCounts) damageCounts[dt]++
        }
      }
      return { classCounts, damageCounts }
    },

    _buildHeuristics(picks, comp, { classCounts, damageCounts }) {
      const sc = (n, t) => n === 0 ? t[0] : n === 1 ? t[1] : t[2]

      const frontlineRaw = classCounts.Tank + Math.floor(classCounts.Fighter / 2)
      const frontline    = { score: sc(frontlineRaw, [0, 2, 3]), label: 'Frontline' }

      const dpsRaw = classCounts.Marksman
        + classCounts.Assassin
        + picks.filter(c => c.class === 'Mage' && (c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high')).length
      const dps = { score: sc(dpsRaw, [0, 2, 3]), label: 'DPS' }

      const engageRaw = picks.filter(c =>
        c.comp_type === 'Engage' || c.comp_type_2 === 'Engage' ||
        c.comp_type === 'Pick'   || c.comp_type_2 === 'Pick'
      ).length
      const engage = {
        score: sc(engageRaw, [0, 2, 3]),
        label: 'Engage',
      }

      const peel = { score: sc(classCounts.Support, [0, 2, 3]), label: 'Proteção' }

      const dc = damageCounts
      const hasAD = (dc.AD_high >= 1 || dc.Mixed_high >= 1) && (dc.AD_low >= 1 || dc.Mixed_low >= 1)
      const hasAP = (dc.AP_high >= 1 || dc.Mixed_high >= 1) && (dc.AP_low >= 1 || dc.Mixed_low >= 1)
      const damageSplit = { score: (hasAD && hasAP) ? 3 : 0, label: 'Dano Split' }

      let coherenceScore = 3
      const ct = comp.compType
      if      (ct === 'Siege')   coherenceScore = (dc.AP_high >= 1 || dc.Mixed_high >= 1 || classCounts.Mage + classCounts.Marksman >= 2) ? 3 : 1
      else if (ct === 'Split')   coherenceScore = (classCounts.Fighter >= 1 && (dc.AD_high >= 1 || dc.AD_low >= 1)) ? 3 : 1
      else if (ct === 'Protect') coherenceScore = (classCounts.Marksman >= 1 && classCounts.Support >= 1) ? 3 : 1
      else if (ct === 'Engage')  coherenceScore = classCounts.Tank >= 1 ? 3 : 1
      else if (ct === 'Pick')    coherenceScore = (classCounts.Assassin >= 1 || picks.some(c => c.comp_type === 'Pick')) ? 3 : 1
      const coherence = { score: coherenceScore, label: 'Coerência' }

      const color = s => s >= 3 ? 'green' : s >= 2 ? 'yellow' : 'red'
      const add   = h => ({ ...h, color: color(h.score) })

      return {
        frontline:   add(frontline),
        dps:         add(dps),
        engage:      add(engage),
        peel:        add(peel),
        damageSplit: add(damageSplit),
        coherence:   add(coherence),
      }
    },

    // ── Recommendations ───────────────────────────────────────────────────────
    _getRecommendations(analysis) {
      if (!analysis || analysis.count === 5 || !analysis.gaps.length) return []
      const used      = this._usedIds()
      const tierOrder = Object.fromEntries(TIERS.map((t, i) => [t, i]))
      const pool      = Alpine.store('champions').list
        .filter(c => !used.has(c.id))
        .sort((a, b) => (tierOrder[a.tier] ?? 5) - (tierOrder[b.tier] ?? 5))

      return analysis.gaps.slice(0, 3).map(gap => {
        const filterFn = this._gapFilter(gap, analysis)
        const allValid = pool.filter(filterFn)

        // Partition: champions in team pool first, then global fallback
        const inPool    = allValid.filter(c => this.champPool?.[c.id]?.length > 0)
        const notInPool = allValid.filter(c => !this.champPool?.[c.id]?.length)
        inPool.sort((a, b) => this._candidateScore(a) - this._candidateScore(b))

        const candidates = [...inPool, ...notInPool].slice(0, 5)
        if (!candidates.length) return null
        return { reason: this._gapLabel(gap, analysis), classes: this._gapClasses(gap, analysis), candidates }
      }).filter(Boolean)
    },

    // Lower score = better candidate (pool tier × 10 − best WR)
    _candidateScore(champ) {
      const entries = this.champPool?.[champ.id] ?? []
      if (!entries.length) return 999
      const bestTier = Math.min(...entries.map(e => POOL_TIER_ORDER[e.poolTier] ?? 2))
      const bestWR   = Math.max(...entries.map(e => {
        const s = this.playerChampStats?.[`${e.playerName}:${normChampKey(champ.key)}`]
        return (s && s.n >= 3) ? s.wins / s.n : 0
      }))
      return bestTier * 10 - bestWR
    },

    _gapFilter(gap, analysis) {
      const dc = analysis.damageCounts
      switch (gap) {
        case 'frontline':   return c => c.class === 'Tank'
        case 'dps':         return c => c.class === 'Marksman'
          || (c.class === 'Assassin' && (c.damage_type === 'AD_high' || c.damage_type === 'Mixed_high'))
          || (c.class === 'Mage'     && (c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'))
        case 'engage':      return c => c.comp_type === 'Engage' || c.comp_type_2 === 'Engage' || c.comp_type === 'Pick' || c.comp_type_2 === 'Pick'
        case 'peel':        return c => c.class === 'Support'
        case 'damageSplit': {
          const hasAD = (dc.AD_high >= 1 || dc.Mixed_high >= 1) && (dc.AD_low >= 1 || dc.Mixed_low >= 1)
          const hasAP = (dc.AP_high >= 1 || dc.Mixed_high >= 1) && (dc.AP_low >= 1 || dc.Mixed_low >= 1)
          if (!hasAD) return c => c.damage_type === 'AD_high' || c.damage_type === 'Mixed_high'
          if (!hasAP) return c => c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'
          return () => false
        }
        case 'coherence': {
          const ct = analysis.compType
          if (ct === 'Siege')   return c => c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'
          if (ct === 'Split')   return c => c.class === 'Fighter' && (c.damage_type === 'AD_high' || c.damage_type === 'AD_low')
          if (ct === 'Protect') return c => c.class === 'Marksman' || c.class === 'Support'
          if (ct === 'Engage')  return c => c.class === 'Tank'
          if (ct === 'Pick')    return c => c.class === 'Assassin'
          return () => false
        }
        default: return () => false
      }
    },

    _gapLabel(gap, analysis) {
      const dc = analysis.damageCounts
      switch (gap) {
        case 'frontline':   return 'Falta frontline (Tank)'
        case 'dps':         return 'Falta DPS (carry ou mago de dano)'
        case 'engage':      return 'Falta engage ou pick'
        case 'peel':        return 'Falta proteção (Support)'
        case 'damageSplit': {
          const hasAD = (dc.AD_high >= 1 || dc.Mixed_high >= 1) && (dc.AD_low >= 1 || dc.Mixed_low >= 1)
          const hasAP = (dc.AP_high >= 1 || dc.Mixed_high >= 1) && (dc.AP_low >= 1 || dc.Mixed_low >= 1)
          if (!hasAD && !hasAP) return 'Falta damage split (nenhum tipo completo)'
          if (!hasAD)           return 'Falta dano físico (AD carry + suporte AD)'
          return                       'Falta dano mágico (AP carry + suporte AP)'
        }
        case 'coherence':   return `Comp incoerente para ${analysis.compType ?? 'tipo escolhido'}`
        default: return gap
      }
    },

    _gapClasses(gap, analysis) {
      switch (gap) {
        case 'frontline':   return ['Tank']
        case 'dps':         return ['Marksman', 'Assassin', 'Mage']
        case 'engage':      return ['comp: Engage', 'comp: Pick']
        case 'peel':        return ['Support']
        case 'damageSplit': {
          const dc = analysis.damageCounts
          const hasAD = (dc.AD_high >= 1 || dc.Mixed_high >= 1) && (dc.AD_low >= 1 || dc.Mixed_low >= 1)
          return !hasAD ? ['Marksman', 'Fighter AD'] : ['Mage', 'Suporte AP']
        }
        case 'coherence': {
          const ct = analysis.compType
          if (ct === 'Siege')   return ['Mage', 'Marksman']
          if (ct === 'Split')   return ['Fighter']
          if (ct === 'Protect') return ['Marksman', 'Support']
          if (ct === 'Engage')  return ['Tank']
          if (ct === 'Pick')    return ['Assassin']
          return []
        }
        default: return []
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

    damageColor(dt) {
      if (!dt) return 'text-slate-600'
      if (dt.startsWith('AD'))    return 'text-red-400'
      if (dt.startsWith('AP'))    return 'text-blue-400'
      if (dt.startsWith('Mixed')) return 'text-purple-400'
      return 'text-slate-500'
    },

    compEmoji(type) { return COMP_EMOJI[type] ?? '' },

    // Pool entries for a champion, sorted star → green → yellow
    champPoolInfo(champId) {
      return (this.champPool?.[champId] ?? [])
        .slice()
        .sort((a, b) => (POOL_TIER_ORDER[a.poolTier] ?? 2) - (POOL_TIER_ORDER[b.poolTier] ?? 2))
    },

    poolTierIcon(tier) {
      return { star: '★', green: '●', yellow: '◐' }[tier] ?? '?'
    },

    // Win rate for a player on a specific champion (null if < 3 games)
    playerWR(playerName, champKey) {
      const s = this.playerChampStats?.[`${playerName}:${normChampKey(champKey)}`]
      if (!s || s.n < 3) return null
      return { pct: Math.round(s.wins / s.n * 100), n: s.n }
    },

    // ── Internals ─────────────────────────────────────────────────────────────
    _arr(type, side) {
      if (type === 'ban')  return side === 'blue' ? this.blueBans  : this.redBans
      return                      side === 'blue' ? this.bluePicks : this.redPicks
    },

    _usedIds() {
      return new Set([
        ...this.bluePicks.filter(Boolean).map(c => c.id),
        ...this.redPicks.filter(Boolean).map(c => c.id),
        ...this.blueBans.filter(Boolean).map(c => c.id),
        ...this.redBans.filter(Boolean).map(c => c.id),
      ])
    },

    roleLabel(role) {
      const map = { 'top': 'TOP', 'jng': 'JNG', 'mid': 'MID', 'adc': 'ADC', 'sup': 'SUP' }
      return map[role] || role || '—'
    },
  }))
})
