// ── Draft Recommendations Engine ──────────────────────────────────────────────
// Builds recommendation lines for the next picks in a draft.
//
// Dependencies (globals, loaded before this file):
//   draft-role-resolver.js  → resolveMissingRoles, parseViableRoles
//   draft-gap-analysis.js   → gapFilter, gapLabel, gapClasses
//   comp-analysis.js        → analyzeTeam (via caller)
//   shared.js               → COMP_BEATS, TIERS, normChampKey

// ── Constants ─────────────────────────────────────────────────────────────────

const POOL_TIER_ORDER_REC = { star: 0, green: 1, yellow: 2 }

// Role-specific heuristic priority ordering (CO > FL > SC > ... per role).
// SC = scaling → expands to all three phase gaps: 'early', 'mid', 'late'.
// GAP = phase fraca (score=0), REFORÇO = fase neutra (score=2).
const ROLE_HEURISTIC_PRIORITY = {
  top:     ['coherence', 'frontline', 'early', 'mid', 'late', 'peel',          'engage', 'ofensividade', 'perfilDano'],
  jungle:  ['coherence', 'early', 'mid', 'late', 'ofensividade', 'perfilDano', 'engage', 'peel',         'frontline'],
  mid:     ['coherence', 'ofensividade', 'early', 'mid', 'late', 'perfilDano', 'engage', 'peel',         'frontline'],
  adc:     ['coherence', 'ofensividade', 'early', 'mid', 'late', 'perfilDano', 'engage', 'peel'],
  support: ['coherence', 'peel',      'early', 'mid', 'late', 'frontline',     'engage'],
}

// Map damage types to "High Damage" label
const HIGH_DAMAGE_TYPES = new Set(['AD_high', 'AP_high', 'MIX_high'])

// Role-specific incompatibilities: gaps to exclude and classes to filter per role
// Format: 'class:X' entries → extra class filter; plain keys → gap exclusion
const ROLE_INCOMPATIBLE_GAPS = {
  top: [],
  jungle: [],
  mid: ['class:support'],                          // Mid shouldn't pick support champions
  adc: ['class:tank'],                             // ADC shouldn't pick tank champions
  support: ['class:marksman', 'class:assassin']    // Support shouldn't pick marksman or assassin
}

// ── Helper Functions ──────────────────────────────────────────────────────────


// Extract High Damage label from candidates and format classTags for tooltip
function formatClassTagsWithHighDamage(candidates, gapClasses) {
  const hasHighDamage = candidates.some(c => HIGH_DAMAGE_TYPES.has(c.damage_type))
  const tags = gapClasses.filter(tag => !['Marksman', 'Assassin', 'Mage'].includes(tag))
  
  if (hasHighDamage) {
    tags.unshift('High Damage')
  }
  
  return {
    display: `🔍 ${tags.length}`,
    tooltip: tags.join(', ')
  }
}

// Gap name with emoji prefix (⚠️ for missing, 🧱 for reinforceable)
function gapNameWithEmoji(gap, analysis) {
  const score = analysis.heuristics?.[gap]?.score ?? 0
  const emoji = score < 2 ? '⚠️' : '🧱'
  return `${emoji} ${gapBareLabel(gap, analysis)}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Champion's default identity lens (pure function, mirrors _champDefaultIdentity from draft-page.js)
// Used by _scoreCandidateForRole to look up identity rank for a given champion
function _champLens(c) {
  if (!c) return null
  if (c.class === 'Support')  return 'suporte'
  if (c.class === 'Tank')     return 'tank'
  if (c.class === 'Assassin') return 'assassino'
  // Carry: Marksman, or Mage/Fighter with high damage
  if (c.class === 'Marksman') return 'carry'
  // Check if Mage or Fighter with high damage (comp_type Carry or damage high)
  const HIGH_DMG = new Set(['AD_high', 'AP_high', 'Mixed_high'])
  if ((c.class === 'Mage' || c.class === 'Fighter') && HIGH_DMG.has(c.damage_type)) return 'carry'
  // Bruiser: Fighter otherwise
  if (c.class === 'Fighter') return 'bruiser'
  return null
}

// Candidate score: weighted sum of 4 signals, all normalized to [0, 1].
// Champions ordered by: Identity Rank > Win Rate > Pool Tier + Meta Tier combined.
// Formula: f = 4×normIR + 3×normWR + 2×(normPT + normMT)
//
// Normalization (all signals clamped to [0, 1]):
// - normIR    = min(rankIdx / 6, 1)           (Iron=0, Gold≈0.33→actual 3/6=0.5, Challenger=1.0 capped)
// - normWR    = clamp((wr - 0.25) / 0.5, 0, 1)   (25%=0, 50%=0.5, 75%+=1.0 capped)
// - normPT    = (2 - poolOrd) / 2             (Situacional=0, Confortável=0.5, Signature=1.0)
// - normMT    = (4 - tierOrd) / 4             (D=0, B=0.5, S=1.0)
//
// Out-of-pool champions: normPT=0; f = 4×normIR + 3×normWR + 2×normMT (IR and WR still weighted)
function _scoreCandidateForRole(champ, role, ctx) {
  const TIER_ORD = { S: 0, A: 1, B: 2, C: 3, D: 4 }
  
  // Meta tier: tier_by_role[role], default B (tier 2)
  const tierOrd = TIER_ORD[champ.tier_by_role?.[role]] ?? 2
  const normMT = (4 - tierOrd) / 4

  // Find pool entries for this champion + role
  const entries = (ctx.champPool?.[champ.id] ?? [])
    .filter(e => role == null || e.role === role)

  if (!entries.length) {
    // Not in pool: score by IR, WR, and meta tier only (no pool tier)
    // Start by computing IR and WR from no pool context
    let bestRank = 0
    let bestWR = 0
    const champLens = _champLens(champ)
    
    // For out-of-pool, we can't look up player data, so both remain 0
    const normIR = 0
    const normWRclamped = 0
    
    // f = 4×normIR + 3×normWR + 2×normMT = 0 + 0 + 2×normMT = 2×normMT
    const f = 2 * normMT
    return -f  // negate: lower return = ranked first
  }

  // Compute pool normalization: best tier across all players for this champ+role
  const bestPoolOrd = Math.min(...entries.map(e => POOL_TIER_ORDER_REC[e.poolTier] ?? 2))
  const normPT = (2 - bestPoolOrd) / 2  // Situacional=0, Confortável=0.5, Signature=1.0

  // Compute best rank and WR across all player entries
  let bestRank = 0
  let bestWR = 0
  const champLens = _champLens(champ)
  
  for (const e of entries) {
    // Win rate from player champ stats
    const s = ctx.playerChampStats?.[`${e.playerName}:${normChampKey(champ.key)}`]
    if (s && s.n >= 3) {
      const wr = s.wins / s.n
      if (wr > bestWR) bestWR = wr
    }
    
    // Identity rank from player lens + champion's default lens
    if (champLens) {
      const rankIdx = ctx.playerIdentityRanks?.[e.playerName]?.[champLens] ?? 0
      if (rankIdx > bestRank) bestRank = rankIdx
    }
  }

  // Normalize to [0, 1]: IR and WR have hard caps, PT and MT are already bounded
  const normIR = Math.min(bestRank / 6, 1)
  const normWRclamped = Math.min(Math.max((bestWR - 0.25) / 0.5, 0), 1)
  
  // f = 4×normIR + 3×normWR + 2×(normPT + normMT)
  const f = 4 * normIR + 3 * normWRclamped + 2 * (normPT + normMT)
  return -f  // negate: lower return = ranked first
}

// Strip 'comp: ' prefix from gapClasses results (e.g. 'comp: Engage' → 'Engage')
function _gapClassesShort(gap, analysis) {
  const classes = gapClasses(gap, analysis)
  return classes.map(c => c.replace(/^comp:\s*/, ''))
}

// Build cross-product class-tag badges for multi-gap combo columns.
// Each gap contributes a group of class options; the result is one badge per combination
// (one option selected from each group), joined with '+'.
// E.g. groups [['Siege','Engage'],['Tank'],['Support','Protect']] →
//   ['Siege+Tank+Support', 'Siege+Tank+Protect', 'Engage+Tank+Support', 'Engage+Tank+Protect']
// Optional prefixClasses (e.g. counterTypes for PIVOT combos) prepended as the first group.
function _comboClassTagsFromGaps(gaps, analysis, prefixClasses) {
  const groups = []
  if (prefixClasses && prefixClasses.length > 0) groups.push(prefixClasses)
  for (const gap of gaps) {
    const classes = _gapClassesShort(gap, analysis)
    if (classes.length > 0) groups.push(classes)
  }
  if (!groups.length) return []
  // Cross-product: start with [[]], extend each partial combo by one class per group
  let combos = [[]]
  for (const group of groups) {
    combos = combos.flatMap(combo => group.map(cls => [...combo, cls]))
  }
  return combos.map(combo => combo.join('+'))
}

// Player name for a role from the active formation
function _playerForRole(role, ctx) {
  const fieldName = ctx.formationFields[role]
  return ctx.formation?.expand?.[fieldName]?.name ?? null
}

// Champion's short label: class + notable comp_type if applicable
// Example: Tank (no notable comp_type) → "Tank"
// Example: Tank with comp_type=Engage → "Tank+Engage"
function _champShortLabel(c) {
  const cls = c.class ?? ''
  const ct  = c.comp_type ?? ''
  const NOTABLE = new Set(['Engage','Pick','Protect','Poke','Siege','Split'])
  if (NOTABLE.has(ct)) return `${cls}+${ct}`
  return cls
}

// Generate class tags for a combo column from actual candidates.
// Only candidates that satisfy ALL filters are included (AND logic).
// Deduplicates and returns unique short labels.
function _comboClassTagsFromCandidates(candidates) {
  const tags = new Set()
  for (const c of candidates) {
    const label = _champShortLabel(c)
    if (label) tags.add(label)
  }
  return [...tags]
}

// Coherence filter: when we already have a comp_type defined, prefer picks that
// reinforce it. Returns null if no comp is defined yet (no filtering).
function _coherenceFilter(analysis) {
  const ct = analysis.compType
  if (!ct) return null
  return c => c.comp_type === ct || c.comp_type_2 === ct
}

// Find comp types that counter a given enemy comp type
function _findCounterTypes(enemyType) {
  if (!enemyType) return []
  return Object.entries(COMP_BEATS)
    .filter(([, beats]) => beats.includes(enemyType))
    .map(([type]) => type)
}

// Role-specific class filter (incompatibility map)
// - adc: exclude Tank, Support, Assassin
// - mid: exclude Support
// - sup: exclude Assassin, Marksman
// - others: no restriction
function _roleClassFilter(role) {
  if (role === 'adc') return c => c.class !== 'Tank' && c.class !== 'Support' && c.class !== 'Assassin'
  if (role === 'mid') return c => c.class !== 'Support'
  if (role === 'sup') return c => c.class !== 'Assassin' && c.class !== 'Marksman'
  return () => true
}

// Check if at least one champion can resolve a given gap for a specific role.
// Optional extraFilter allows passing additional class/role constraints.
function _hasAnyCandidates(role, gapFilterFn, ctx, extraFilter) {
  const roleFilter = _roleClassFilter(role)
  return ctx.championsList.some(c =>
    !ctx.usedIds.has(c.id) &&
    gapFilterFn(c) &&
    roleFilter(c) &&
    (!extraFilter || extraFilter(c)) &&
    (parseAssignedRoles(c).length > 0 ? parseAssignedRoles(c) : parseViableRoles(c)).includes(role)
  )
}



// ── Strategic Columns Builder ─────────────────────────────────────────────────
// Generates all strategic columns (independently filtered candidate lists) for a role.
// Priority order: COMBO (0-4) > PIVOT (5) > GAP (6) > REFORÇO (7) > BESTFIT (8)
//
// Returns: [ { priority, label, tag, colorClasses, candidates, filters: [...] }, ... ]
// (sorted by priority, filtered to non-empty only)
function _buildStrategicColumns(role, analysis, shouldPivot, counterTypes, matchup, picksLeft, ctx) {
  const columns = []

  // Parse role incompatibilities: 'class:X' entries → extra class filter; plain keys → gap exclusion
  const incompatibleEntries = ROLE_INCOMPATIBLE_GAPS[role] ?? []
  const incompatibleGaps = new Set(incompatibleEntries.filter(x => !x.startsWith('class:')))
  const incompatibleClassNames = new Set(
    incompatibleEntries
      .filter(x => x.startsWith('class:'))
      .map(x => { const n = x.slice(6); return n.charAt(0).toUpperCase() + n.slice(1) })
  )
  const classIncompatFilter = incompatibleClassNames.size > 0 ? c => !incompatibleClassNames.has(c.class) : null

  // Role-specific heuristic priority ordering
  const rolePriority = ROLE_HEURISTIC_PRIORITY[role] ?? []
  const byRolePriority = (a, b) => {
    const ai = rolePriority.indexOf(a); const bi = rolePriority.indexOf(b)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  }

  const eligibleGaps = (analysis.gaps ?? []).filter(g => !incompatibleGaps.has(g))
  const eligibleYellow = Object.entries(analysis.heuristics ?? {})
    .filter(([k, h]) => h.score === 2 && !incompatibleGaps.has(k))
    .map(([k]) => k)

  // Pre-filter gaps to only those with viable candidates for this role, then sort by role priority
  const viableGaps = eligibleGaps
    .filter(gap => _hasAnyCandidates(role, gapFilter(gap, analysis), ctx, classIncompatFilter))
    .sort(byRolePriority)
  const viableYellowGaps = eligibleYellow
    .filter(gap => _hasAnyCandidates(role, gapFilter(gap, analysis), ctx, classIncompatFilter))
    .sort(byRolePriority)

  const cf = _coherenceFilter(analysis)
  const pivotFilter = c => counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2)
  // Local wrappers that inject classIncompatFilter into all candidate calls within this function
  const _cf = filters => classIncompatFilter ? [classIncompatFilter, ...filters] : filters
  const getCandidates      = filters => _getCandidatesForFilters(role, _cf(filters), cf, ctx)
  const getCandidatesCombo = filters => _getCandidatesForCombo  (role, _cf(filters), cf, ctx)

  // Priority scale (lower internal number = shown first):
  // 0=PIVOT+GAP+GAP(9) 1=PIVOT+GAP+REFORÇO(8) 2=PIVOT+GAP(7)
  // 3=GAP+GAP+GAP(6) 4=PIVOT(5)/GAP+GAP+REFORÇO(5)
  // 5=GAP+REFORÇO+REFORÇO(4)/GAP+GAP(4) 6=GAP+REFORÇO(3)
  // 7=GAP(2) 8=REFORÇO(1) 9=FITTEST

  // ── Priority 0: PIVOT+GAP+GAP (score 9) ⭐ ─────────────────────────────────
  if (shouldPivot && viableGaps.length >= 2) {
    for (let i = 0; i < viableGaps.length - 1; i++) {
      for (let j = i + 1; j < viableGaps.length; j++) {
        const filters = [pivotFilter, gapFilter(viableGaps[i], analysis), gapFilter(viableGaps[j], analysis)]
        const candidates = getCandidatesCombo(filters)
        if (candidates.length > 0) {
          columns.push({
            priority: 0,
            tag: 'combo',
            prefix: '⭐ PIVOT c/ RECUPERAÇÃO DUPLA',
               gapNames: `${gapNameWithEmoji(viableGaps[i], analysis)} + ${gapNameWithEmoji(viableGaps[j], analysis)}`,
            classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([viableGaps[i], viableGaps[j]], analysis, counterTypes)),
            colorClasses: { header: 'text-purple-400 bg-purple-900/20 border-purple-700/30', button: 'group-hover:border-purple-500' },
            candidates,
            filters
          })
        }
      }
    }
  }

  // ── Priority 1: PIVOT+GAP+REFORÇO (score 8) ⭐ ─────────────────────────────
  if (shouldPivot && viableGaps.length > 0 && viableYellowGaps.length > 0) {
    for (const critGap of viableGaps) {
      for (const yellowGap of viableYellowGaps) {
        if (critGap === yellowGap) continue
        const filters = [pivotFilter, gapFilter(critGap, analysis), gapFilter(yellowGap, analysis)]
        const candidates = getCandidatesCombo(filters)
        if (candidates.length > 0) {
          columns.push({
            priority: 1,
            tag: 'combo',
            prefix: '⭐ PIVOT c/ RECUPERAÇÃO + REFORÇO',
               gapNames: `${gapNameWithEmoji(critGap, analysis)} + ${gapNameWithEmoji(yellowGap, analysis)}`,
            classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([critGap, yellowGap], analysis, counterTypes)),
            colorClasses: { header: 'text-purple-400 bg-purple-900/20 border-purple-700/30', button: 'group-hover:border-purple-500' },
            candidates,
            filters
          })
        }
      }
    }
  }

  // ── Priority 2: PIVOT+GAP (score 7) 🥇 ─────────────────────────────────────
  if (shouldPivot && viableGaps.length > 0) {
    for (const gap of viableGaps) {
      const filters = [pivotFilter, gapFilter(gap, analysis)]
      const candidates = getCandidatesCombo(filters)
        if (candidates.length > 0) {
        columns.push({
          priority: 2,
          tag: 'combo',
          prefix: '🥇 PIVOT c/ RECUPERAÇÃO',
          gapNames: gapNameWithEmoji(gap, analysis),
          classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([gap], analysis, counterTypes)),
            colorClasses: { header: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30', button: 'group-hover:border-yellow-500' },
            candidates,
            filters
          })
        }
    }
  }

  // ── Priority 3: GAP+GAP+GAP (score 6) 🥇 ───────────────────────────────────
  if (viableGaps.length >= 3) {
    for (let i = 0; i < viableGaps.length - 2; i++) {
      for (let j = i + 1; j < viableGaps.length - 1; j++) {
        for (let k = j + 1; k < viableGaps.length; k++) {
          const filters = [gapFilter(viableGaps[i], analysis), gapFilter(viableGaps[j], analysis), gapFilter(viableGaps[k], analysis)]
          const candidates = getCandidatesCombo(filters)
            if (candidates.length > 0) {
              columns.push({
                priority: 3,
                tag: 'combo',
                prefix: '🥇 RECUPERAÇÃO TRIPLA',
                gapNames: `${gapNameWithEmoji(viableGaps[i], analysis)} + ${gapNameWithEmoji(viableGaps[j], analysis)} + ${gapNameWithEmoji(viableGaps[k], analysis)}`,
                classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([viableGaps[i], viableGaps[j], viableGaps[k]], analysis)),
                colorClasses: { header: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30', button: 'group-hover:border-yellow-500' },
                candidates,
                filters
              })
            }
        }
      }
    }
  }

  // ── Priority 4a: PIVOT (score 5) ↩️ ────────────────────────────────────────
  if (shouldPivot && counterTypes.length > 0) {
    const filters = [pivotFilter]
    const candidates = getCandidates(filters)
    if (candidates.length > 0) {
      columns.push({
        priority: 4,
        tag: 'pivot',
        prefix: '↩️ PIVOT',
        gapNames: counterTypes.join(' / '),
        classTags: ['Counter'],
        colorClasses: { header: 'text-orange-400 bg-orange-900/20 border-orange-700/30', button: 'group-hover:border-orange-500' },
        candidates,
        filters
      })
    }
  }

  // ── Priority 4b: GAP+GAP+REFORÇO (score 5) 🥇 ──────────────────────────────
  if (viableGaps.length >= 2 && viableYellowGaps.length > 0) {
    for (let i = 0; i < viableGaps.length - 1; i++) {
      for (let j = i + 1; j < viableGaps.length; j++) {
        for (const yellowGap of viableYellowGaps) {
          if (yellowGap === viableGaps[i] || yellowGap === viableGaps[j]) continue
          const filters = [gapFilter(viableGaps[i], analysis), gapFilter(viableGaps[j], analysis), gapFilter(yellowGap, analysis)]
          const candidates = getCandidatesCombo(filters)
            if (candidates.length > 0) {
              columns.push({
                priority: 4,
                tag: 'combo',
                prefix: '🥇 RECUPERAÇÃO DUPLA c/ REFORÇO',
                gapNames: `${gapNameWithEmoji(viableGaps[i], analysis)} + ${gapNameWithEmoji(viableGaps[j], analysis)} + ${gapNameWithEmoji(yellowGap, analysis)}`,
                classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([viableGaps[i], viableGaps[j], yellowGap], analysis)),
                colorClasses: { header: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30', button: 'group-hover:border-yellow-500' },
                candidates,
                filters
              })
            }
        }
      }
    }
  }

  // ── Priority 5a: GAP+REFORÇO+REFORÇO (score 4) 🥈 ──────────────────────────
  if (viableGaps.length > 0 && viableYellowGaps.length >= 2) {
    for (const critGap of viableGaps) {
      for (let i = 0; i < viableYellowGaps.length - 1; i++) {
        for (let j = i + 1; j < viableYellowGaps.length; j++) {
          if (viableYellowGaps[i] === critGap || viableYellowGaps[j] === critGap) continue
          const filters = [gapFilter(critGap, analysis), gapFilter(viableYellowGaps[i], analysis), gapFilter(viableYellowGaps[j], analysis)]
          const candidates = getCandidatesCombo(filters)
            if (candidates.length > 0) {
              columns.push({
                priority: 5,
                tag: 'combo',
                prefix: '🥈 RECUPERAÇÃO c/ REFORÇO DUPLO',
                gapNames: `${gapNameWithEmoji(critGap, analysis)} + ${gapNameWithEmoji(viableYellowGaps[i], analysis)} + ${gapNameWithEmoji(viableYellowGaps[j], analysis)}`,
                classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([critGap, viableYellowGaps[i], viableYellowGaps[j]], analysis)),
                colorClasses: { header: 'text-slate-100 bg-slate-600/50 border-slate-400', button: 'group-hover:border-slate-400' },
                candidates,
                filters
              })
            }
        }
      }
    }
  }

  // ── Priority 5b: GAP+GAP (score 4) 🥈 ──────────────────────────────────────
  if (viableGaps.length >= 2) {
    for (let i = 0; i < viableGaps.length - 1; i++) {
      for (let j = i + 1; j < viableGaps.length; j++) {
        const filters = [gapFilter(viableGaps[i], analysis), gapFilter(viableGaps[j], analysis)]
        const candidates = getCandidatesCombo(filters)
          if (candidates.length > 0) {
            columns.push({
              priority: 5,
              tag: 'combo',
               prefix: '🥈 RECUPERAÇÃO DUPLA',
            gapNames: `${gapNameWithEmoji(viableGaps[i], analysis)} + ${gapNameWithEmoji(viableGaps[j], analysis)}`,
               classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([viableGaps[i], viableGaps[j]], analysis)),
               colorClasses: { header: 'text-slate-100 bg-slate-600/50 border-slate-400', button: 'group-hover:border-slate-400' },
              candidates,
              filters
            })
          }
      }
    }
  }

  // ── Priority 6: GAP+REFORÇO (score 3) 🥉 ───────────────────────────────────
  if (viableGaps.length > 0 && viableYellowGaps.length > 0) {
    for (const critGap of viableGaps) {
      for (const yellowGap of viableYellowGaps) {
        if (critGap === yellowGap) continue
        const filters = [gapFilter(critGap, analysis), gapFilter(yellowGap, analysis)]
        const candidates = getCandidatesCombo(filters)
          if (candidates.length > 0) {
            columns.push({
              priority: 6,
              tag: 'combo',
               prefix: '🥉 RECUPERAÇÃO c/ REFORÇO',
            gapNames: `${gapNameWithEmoji(critGap, analysis)} + ${gapNameWithEmoji(yellowGap, analysis)}`,
               classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([critGap, yellowGap], analysis)),
               colorClasses: { header: 'text-amber-400 bg-amber-900/30 border-amber-600/50', button: 'group-hover:border-amber-400' },
              candidates,
              filters
            })
          }
      }
    }
  }

  // ── Priority 7: GAP (score 2) ⚠️ ───────────────────────────────────────────
  for (const gap of viableGaps) {
    const filters = [gapFilter(gap, analysis)]
    const candidates = getCandidates(filters)
    if (candidates.length > 0) {
      columns.push({
        priority: 7,
         tag: 'gap',
         prefix: '⚠️ RECUPERAÇÃO',
         gapNames: gapNameWithEmoji(gap, analysis),
         classTags: formatClassTagsWithHighDamage(candidates, _gapClassesShort(gap, analysis)),
        colorClasses: { header: 'text-red-400 bg-red-900/20 border-red-700/30', button: 'group-hover:border-red-500' },
        candidates,
        filters
      })
    }
  }

  // ── Priority 6.1: REFORÇO+REFORÇO+REFORÇO (score 2+2+2) 🥈 ────────────────────
  if (viableYellowGaps.length >= 3) {
    for (let i = 0; i < viableYellowGaps.length - 2; i++) {
      for (let j = i + 1; j < viableYellowGaps.length - 1; j++) {
        for (let k = j + 1; k < viableYellowGaps.length; k++) {
          const filters = [gapFilter(viableYellowGaps[i], analysis), gapFilter(viableYellowGaps[j], analysis), gapFilter(viableYellowGaps[k], analysis)]
          const candidates = getCandidatesCombo(filters)
            if (candidates.length > 0) {
              columns.push({
                priority: 6.1,
                tag: 'combo',
                 prefix: '🥈 REFORÇO TRIPLO',
                 gapNames: `${gapNameWithEmoji(viableYellowGaps[i], analysis)} + ${gapNameWithEmoji(viableYellowGaps[j], analysis)} + ${gapNameWithEmoji(viableYellowGaps[k], analysis)}`,
                 classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([viableYellowGaps[i], viableYellowGaps[j], viableYellowGaps[k]], analysis)),
                 colorClasses: { header: 'text-slate-100 bg-slate-600/50 border-slate-400', button: 'group-hover:border-slate-400' },
                candidates,
                filters
              })
            }
        }
      }
    }
  }

  // ── Priority 6.2: REFORÇO+REFORÇO (score 2+2) 🥈 ────────────────────────────
  if (viableYellowGaps.length >= 2) {
    for (let i = 0; i < viableYellowGaps.length - 1; i++) {
      for (let j = i + 1; j < viableYellowGaps.length; j++) {
        const filters = [gapFilter(viableYellowGaps[i], analysis), gapFilter(viableYellowGaps[j], analysis)]
        const candidates = getCandidatesCombo(filters)
          if (candidates.length > 0) {
            columns.push({
              priority: 6.2,
              tag: 'combo',
               prefix: '🥈 REFORÇO DUPLO',
               gapNames: `${gapNameWithEmoji(viableYellowGaps[i], analysis)} + ${gapNameWithEmoji(viableYellowGaps[j], analysis)}`,
               classTags: formatClassTagsWithHighDamage(candidates, _comboClassTagsFromGaps([viableYellowGaps[i], viableYellowGaps[j]], analysis)),
               colorClasses: { header: 'text-slate-100 bg-slate-600/50 border-slate-400', button: 'group-hover:border-slate-400' },
              candidates,
              filters
            })
          }
      }
    }
  }

  // ── Priority 8: REFORÇO (score 1) 🧱 ───────────────────────────────────────
  for (const gap of viableYellowGaps) {
    const filters = [gapFilter(gap, analysis)]
    const candidates = getCandidates(filters)
    if (candidates.length > 0) {
      columns.push({
        priority: 8,
         tag: 'reinforce',
         prefix: '🧱 REFORÇO',
         gapNames: gapNameWithEmoji(gap, analysis),
         classTags: formatClassTagsWithHighDamage(candidates, _gapClassesShort(gap, analysis)),
        colorClasses: { header: 'text-blue-400 bg-blue-900/20 border-blue-700/30', button: 'group-hover:border-blue-500' },
        candidates,
        filters
      })
    }
  }

  // ── Priority 9: FITTEST (fallback) 🏆 ──────────────────────────────────────
  const bestfitCandidates = getCandidates([() => true])
  if (bestfitCandidates.length > 0) {
    columns.push({
      priority: 9,
      tag: 'bestfit',
      prefix: '🏆 FITTEST',
      gapNames: 'Melhor opção',
      classTags: [],
      colorClasses: { header: 'text-slate-400 bg-slate-800 border-slate-700', button: 'group-hover:border-slate-500' },
      candidates: bestfitCandidates,
      filters: [() => true]
    })
  }

  // Sort by priority (layout logic for column slicing moved to page layer)
  columns.sort((a, b) => a.priority - b.priority)
  return columns
}

// Helper: apply all filters (AND logic) and return sorted/sliced candidates
function _getCandidatesForFilters(role, filters, coherenceFilter, ctx) {
  const roleFilter = _roleClassFilter(role)

  const allValid = ctx.championsList.filter(c =>
    !ctx.usedIds.has(c.id) &&
    filters.every(f => f(c)) &&  // ALL filters must pass (AND logic)
    roleFilter(c) &&
    (parseAssignedRoles(c).length > 0 ? parseAssignedRoles(c) : parseViableRoles(c)).includes(role)
  )
  const inPool = allValid.filter(c => ctx.champPool?.[c.id]?.some(e => e.role === role))
  const notInPool = allValid.filter(c => !ctx.champPool?.[c.id]?.some(e => e.role === role))

  inPool.sort((a, b) => _scoreCandidateForRole(a, role, ctx) - _scoreCandidateForRole(b, role, ctx))
  return [...inPool, ...notInPool].slice(0, 4)
}

// Helper: apply filters with AND logic (for combo columns) — champions satisfying ALL filters
// Only champions that resolve all gaps simultaneously are included.
// If no champions satisfy all filters, the column will not be created (empty candidates).
// Sorted by: pool tier + win-rate
function _getCandidatesForCombo(role, filters, coherenceFilter, ctx) {
  const roleFilter = _roleClassFilter(role)

  // Valid champions: satisfy ALL filters (AND logic)
  const valid = ctx.championsList.filter(c =>
    !ctx.usedIds.has(c.id) &&
    filters.every(f => f(c)) &&  // ALL filters must pass (AND logic)
    roleFilter(c) &&
    (parseAssignedRoles(c).length > 0 ? parseAssignedRoles(c) : parseViableRoles(c)).includes(role)
  )

  const inPool = valid.filter(c => ctx.champPool?.[c.id]?.some(e => e.role === role))
  const notInPool = valid.filter(c => !ctx.champPool?.[c.id]?.some(e => e.role === role))

  // Sort pool champs by pool score + win-rate
  inPool.sort((a, b) =>
    _scoreCandidateForRole(a, role, ctx) - _scoreCandidateForRole(b, role, ctx)
  )

  return [...inPool, ...notInPool].slice(0, 4)
}

// ── Public API ────────────────────────────────────────────────────────────────
//
// Builds the full list of recommendation lines for the next picks.
//
// Parameters:
//   analysis      — result of analyzeTeam(ourPicks)
//   enemyAnalysis — result of analyzeTeam(enemyPicks)
//   picks         — Array(5) of champion | null  (our picks)
//   overrides     — Array(5) of role | null       (from pickRoles state)
//   ctx           — see context type above
//
// Returns: RecLine[]  (sorted by tag priority)

function buildRecommendations(analysis, enemyAnalysis, picks, overrides, ctx) {
  // Nothing to suggest if draft is done or team is complete
  if (!analysis || analysis.count === 5) return []

  const { missingRoles: initialMissingRoles, possibleRoles } =
    resolveMissingRoles(picks, overrides, ctx.champPool)

  // Exclude possibleRoles from missingRoles to avoid duplicate recommendations.
  // possibleRoles are those that flex picks can play (unconfirmed);
  // they are processed separately with full strategic analysis (or FITTEST fallback).
  // missingRoles are roles with NO coverage at all (not even from flex picks).
  const missingRoles = initialMissingRoles.filter(r => !possibleRoles.includes(r))

  const picksLeft    = picks.filter(p => p == null).length
  const enemyType    = enemyAnalysis?.compType ?? null
  const counterTypes = _findCounterTypes(enemyType)
  const matchup      = _matchupResult(analysis.compType, enemyType)
  const shouldPivot  = counterTypes.length > 0 &&
    (matchup === 'disadvantage' || matchup === 'neutral')

  // Sort champion pool by tier for consistent ranking
  const tierOrder = Object.fromEntries(TIERS.map((t, i) => [t, i]))
  const getBestTier = champ => {
    if (!champ.tier_by_role || typeof champ.tier_by_role !== 'object' || Array.isArray(champ.tier_by_role)) return 5
    const tiers = Object.values(champ.tier_by_role).filter(t => t && /^[SABCD]$/.test(t))
    if (!tiers.length) return 5
    return Math.min(...tiers.map(t => tierOrder[t] ?? 5), 5)
  }
  const sortedCtx = {
    ...ctx,
    championsList: ctx.championsList
      .slice()
      .sort((a, b) => getBestTier(a) - getBestTier(b)),
  }

  const recs = []

  // Confirmed-missing roles → generate all strategic columns
  for (const role of missingRoles) {
    const columns = _buildStrategicColumns(role, analysis, shouldPivot, counterTypes, matchup, picksLeft, sortedCtx)
    if (columns.length > 0) {
      // Create a rec object with columns instead of a single rec line
      const topPriorityColumn = columns[0]
      recs.push({
        role,
        player: _playerForRole(role, sortedCtx),
        tag: topPriorityColumn.tag,           // tag from the highest-priority column
        reason: topPriorityColumn.label,      // label for the role badge
        classes: [],                          // not used anymore (classes are in each column)
        candidates: [],                       // not used anymore (candidates are in each column)
        columns,                              // all strategic columns (up to 3)
      })
    }
  }

    // Flex picks (unconfirmed roles) → generate full strategic columns
    for (const role of possibleRoles) {
      const columns = _buildStrategicColumns(role, analysis, shouldPivot, counterTypes, matchup, picksLeft, sortedCtx)
      if (columns.length > 0) {
        recs.push({
          role,
          player: _playerForRole(role, sortedCtx),
          tag: columns[0].tag,
          reason: columns[0].label,
          classes: [],
          candidates: [],
          columns,
        })
      }
    }

  const result = recs.filter(Boolean)
  console.debug('[draft] buildRecommendations', {
    missingRoles,
    possibleRoles,
    picksLeft,
    poolSize:      sortedCtx.championsList.length,
    champPoolSize: Object.keys(ctx.champPool ?? {}).length,
    recLines:      result.map(r => `${r.role}(${r.tag}):${r.columns.length}cols`),
  })
  return result
}

// ── Internal matchup helper (mirrors draftPage.matchupResult) ─────────────────
function _matchupResult(ourComp, enemyComp) {
  if (!ourComp || !enemyComp) return null
  if ((COMP_BEATS[ourComp]   ?? []).includes(enemyComp)) return 'advantage'
  if ((COMP_BEATS[enemyComp] ?? []).includes(ourComp))   return 'disadvantage'
  return 'neutral'
}
