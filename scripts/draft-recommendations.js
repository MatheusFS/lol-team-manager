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

// ── Context type (for documentation) ─────────────────────────────────────────
// ctx = {
//   champPool        : Map<champId, [{playerName, role, poolTier}]>
//   playerChampStats : Map<"playerName:champKeyNorm", {n, wins}>
//   formation        : PocketBase formation record (expanded)
//   formationFields  : { top:'top', jng:'jungle', mid:'mid', adc:'adc', sup:'support' }
//   usedIds          : Set<champId>
//   championsList    : champion[]  (full store list, sorted by tier)
// }

// ── Helpers ───────────────────────────────────────────────────────────────────

// Player name for a role from the active formation
function _playerForRole(role, ctx) {
  const fieldName = ctx.formationFields[role]
  return ctx.formation?.expand?.[fieldName]?.name ?? null
}

// Strip 'comp: ' prefix from gapClasses results (e.g. 'comp: Engage' → 'Engage')
function _gapClassesShort(gap, analysis) {
  const classes = gapClasses(gap, analysis)
  return classes.map(c => c.replace(/^comp:\s*/, ''))
}

// Compute cross-product of arrays, joining each combination with '+'
// Example: [['Tank'], ['Engage', 'Pick']] → ['Tank+Engage', 'Tank+Pick']
function _crossProductTags(arrays) {
  if (!arrays.length) return []
  if (arrays.length === 1) return arrays[0]  // Single array: return as-is
  
  let result = arrays[0]
  for (let i = 1; i < arrays.length; i++) {
    const next = []
    for (const a of result) {
      for (const b of arrays[i]) {
        next.push(`${a}+${b}`)
      }
    }
    result = next
  }
  return result
}

// Candidate score: lower = better.  Pool tier × 10 − best win-rate for this role.
// Flex picks (champions viable in multiple roles) receive a small bonus (−0.1)
// when comparing candidates with equal tier and win-rate.
function _scoreCandidateForRole(champ, role, ctx) {
  const entries = (ctx.champPool?.[champ.id] ?? [])
    .filter(e => role == null || e.role === role)
  if (!entries.length) return 999

  const bestTier = Math.min(...entries.map(e => POOL_TIER_ORDER_REC[e.poolTier] ?? 2))
  const bestWR   = Math.max(...entries.map(e => {
    const s = ctx.playerChampStats?.[`${e.playerName}:${normChampKey(champ.key)}`]
    return (s && s.n >= 3) ? s.wins / s.n : 0
  }))
  
  let score = bestTier * 10 - bestWR
  
  // Bonus for flex picks: champions viable in multiple roles get slightly better score
  // This ensures flex champions rank higher when all other parameters are equal
  const isFlexChamp = parseViableRoles(champ).length > 1
  if (isFlexChamp) {
    score -= 0.1  // negative = better (lower scores rank first)
  }
  
  return score
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

// Check if at least one champion can resolve a given gap for a specific role
function _hasAnyCandidates(role, gapFilterFn, ctx) {
  const roleFilter = _roleClassFilter(role)
  return ctx.championsList.some(c =>
    !ctx.usedIds.has(c.id) &&
    gapFilterFn(c) &&
    roleFilter(c) &&
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
  const gaps = analysis.gaps ?? []
  const yellowGaps = Object.entries(analysis.heuristics ?? {})
    .filter(([, h]) => h.score === 2)
    .map(([k]) => k)
  
  // Pre-filter gaps to only those with viable candidates for this role
  const viableGaps = gaps.filter(gap =>
    _hasAnyCandidates(role, gapFilter(gap, analysis), ctx)
  )
  const viableYellowGaps = yellowGaps.filter(gap =>
    _hasAnyCandidates(role, gapFilter(gap, analysis), ctx)
  )

  const cf = _coherenceFilter(analysis)

  // ── Combo priorities (0-4) ────────────────────────────────────────────────

  // Priority 0: PIVOT+GAP (counter-picker + solve critical gap)
  if (shouldPivot && viableGaps.length > 0) {
    for (const gap of viableGaps) {
      const gf = gapFilter(gap, analysis)
      const filters = [
        c => counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2),
        gf
      ]
      const candidates = _getCandidatesForCombo(role, filters, cf, ctx)
      if (candidates.length > 0) {
        columns.push({
          priority: 0,
          tag: 'combo',
          prefix: '⭐ PIVOT+GAP',
          gapNames: gapShortLabel(gap, analysis),
          classTags: _crossProductTags([
            ['PIVOT'],
            _gapClassesShort(gap, analysis)
          ]),
          colorClasses: { header: 'text-purple-400 bg-purple-900/20 border-purple-700/30', button: 'group-hover:border-purple-500' },
          candidates,
          filters
        })
      }
    }
  }

  // Priority 1: PIVOT+REFORÇO (counter-picker + reinforce yellow gap)
  if (shouldPivot && viableYellowGaps.length > 0) {
    for (const gap of viableYellowGaps) {
      const gf = gapFilter(gap, analysis)
      const filters = [
        c => counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2),
        gf
      ]
      const candidates = _getCandidatesForCombo(role, filters, cf, ctx)
      if (candidates.length > 0) {
        columns.push({
          priority: 1,
          tag: 'combo',
          prefix: '⭐ PIVOT+REFORÇO',
          gapNames: gapShortLabel(gap, analysis),
          classTags: _crossProductTags([
            ['PIVOT'],
            _gapClassesShort(gap, analysis)
          ]),
           colorClasses: { header: 'text-purple-400 bg-purple-900/20 border-purple-700/30', button: 'group-hover:border-purple-500' },
           candidates,
           filters
         })
       }
     }
   }

   // Priority 1: PIVOT+REFORÇO (counter-pick + reinforce yellow gap)
   if (shouldPivot && viableYellowGaps.length > 0) {
     for (const gap of viableYellowGaps) {
       const gf = gapFilter(gap, analysis)
       const filters = [
         c => counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2),
         gf
       ]
       const candidates = _getCandidatesForCombo(role, filters, cf, ctx)
       if (candidates.length > 0) {
         columns.push({
           priority: 1,
           tag: 'combo',
           prefix: '⭐ PIVOT+REFORÇO',
           gapNames: gapShortLabel(gap, analysis),
           classTags: _crossProductTags([
             ['PIVOT'],
             _gapClassesShort(gap, analysis)
           ]),
           colorClasses: { header: 'text-purple-400 bg-purple-900/20 border-purple-700/30', button: 'group-hover:border-purple-500' },
           candidates,
           filters
         })
       }
     }
   }

   // Priority 2: PIVOT (pure counter-pick)
  if (shouldPivot && counterTypes.length > 0) {
    const filters = [c => counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2)]
    const candidates = _getCandidatesForFilters(role, filters, cf, ctx)
    if (candidates.length > 0) {
      columns.push({
        priority: 2,
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

  // Priority 3: GAP+GAP (solve two critical gaps)
  if (viableGaps.length >= 2) {
    for (let i = 0; i < viableGaps.length - 1; i++) {
      for (let j = i + 1; j < viableGaps.length; j++) {
        const gf1 = gapFilter(viableGaps[i], analysis)
        const gf2 = gapFilter(viableGaps[j], analysis)
        const filters = [gf1, gf2]
        const candidates = _getCandidatesForCombo(role, filters, cf, ctx)
        if (candidates.length > 0) {
          columns.push({
            priority: 3,
            tag: 'combo',
            prefix: '🥇 GAP+GAP',
            gapNames: `${gapShortLabel(viableGaps[i], analysis)} + ${gapShortLabel(viableGaps[j], analysis)}`,
            classTags: _crossProductTags([
              _gapClassesShort(viableGaps[i], analysis),
              _gapClassesShort(viableGaps[j], analysis)
            ]),
            colorClasses: { header: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30', button: 'group-hover:border-yellow-500' },
            candidates,
            filters
          })
        }
      }
    }
  }

   // Priority 4: GAP+REFORÇO (solve one critical + one yellow gap)
  if (viableGaps.length > 0 && viableYellowGaps.length > 0) {
    for (const critGap of viableGaps) {
      for (const yellowGap of viableYellowGaps) {
        const gf1 = gapFilter(critGap, analysis)
        const gf2 = gapFilter(yellowGap, analysis)
        const filters = [gf1, gf2]
        const candidates = _getCandidatesForCombo(role, filters, cf, ctx)
        if (candidates.length > 0) {
          columns.push({
            priority: 4,
            tag: 'combo',
            prefix: '🥈 GAP+REFORÇO',
            gapNames: `${gapShortLabel(critGap, analysis)} + ${gapShortLabel(yellowGap, analysis)}`,
            classTags: _crossProductTags([
              _gapClassesShort(critGap, analysis),
              _gapClassesShort(yellowGap, analysis)
            ]),
            colorClasses: { header: 'text-slate-400 bg-slate-800 border-slate-700', button: 'group-hover:border-slate-600' },
            candidates,
            filters
          })
        }
      }
    }
  }

  // Priority 6: REFORÇO+REFORÇO (solve two yellow gaps)
  if (viableYellowGaps.length >= 2) {
    for (let i = 0; i < viableYellowGaps.length - 1; i++) {
      for (let j = i + 1; j < viableYellowGaps.length; j++) {
        const gf1 = gapFilter(viableYellowGaps[i], analysis)
        const gf2 = gapFilter(viableYellowGaps[j], analysis)
        const filters = [gf1, gf2]
        const candidates = _getCandidatesForCombo(role, filters, cf, ctx)
        if (candidates.length > 0) {
          columns.push({
            priority: 6,
            tag: 'combo',
            prefix: '🥉 REFORÇO+REFORÇO',
            gapNames: `${gapShortLabel(viableYellowGaps[i], analysis)} + ${gapShortLabel(viableYellowGaps[j], analysis)}`,
            classTags: _crossProductTags([
              _gapClassesShort(viableYellowGaps[i], analysis),
              _gapClassesShort(viableYellowGaps[j], analysis)
            ]),
            colorClasses: { header: 'text-amber-700 bg-amber-950 border-amber-800', button: 'group-hover:border-amber-600' },
            candidates,
            filters
          })
        }
      }
    }
  }

   // ── Single-target priorities (5-8) ────────────────────────────────────────

  // Priority 5: GAP (solve single critical gap)
  for (const gap of viableGaps) {
    const gf = gapFilter(gap, analysis)
    const filters = [gf]
    const candidates = _getCandidatesForFilters(role, filters, cf, ctx)
    if (candidates.length > 0) {
      columns.push({
        priority: 5,
        tag: 'gap',
        prefix: '⚠️ GAP',
        gapNames: gapShortLabel(gap, analysis),
        classTags: _gapClassesShort(gap, analysis),  // Single array, not cross-product
        colorClasses: { header: 'text-red-400 bg-red-900/20 border-red-700/30', button: 'group-hover:border-red-500' },
        candidates,
        filters
      })
    }
  }

  // Priority 7: REFORÇO (reinforce single yellow gap)
  for (const gap of viableYellowGaps) {
    const gf = gapFilter(gap, analysis)
    const filters = [gf]
    const candidates = _getCandidatesForFilters(role, filters, cf, ctx)
    if (candidates.length > 0) {
      columns.push({
        priority: 7,
        tag: 'reinforce',
        prefix: '🧱 REFORÇO',
        gapNames: gapShortLabel(gap, analysis),
        classTags: _gapClassesShort(gap, analysis),  // Single array, not cross-product
        colorClasses: { header: 'text-blue-400 bg-blue-900/20 border-blue-700/30', button: 'group-hover:border-blue-500' },
        candidates,
        filters
      })
    }
  }

  // Priority 8: FITTEST (fallback, no filter)
  const bestfitCandidates = _getCandidatesForFilters(role, [() => true], cf, ctx)
  if (bestfitCandidates.length > 0) {
    columns.push({
      priority: 8,
      tag: 'bestfit',
      prefix: '🏆 FITTEST',
      gapNames: 'Melhor opção',
      classTags: [],  // No gap-specific classes
      colorClasses: { header: 'text-slate-400 bg-slate-800 border-slate-700', button: 'group-hover:border-slate-500' },
      candidates: bestfitCandidates,
      filters: [() => true]
    })
  }

  // Sort by priority and limit to top 3 non-empty columns
  columns.sort((a, b) => a.priority - b.priority)
  return columns.slice(0, 3)
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
  return [...inPool, ...notInPool].slice(0, 5)
}

// Helper: apply filters with OR logic (for combo columns) — champions satisfying ANY filter
// Sorted by: (1) number of filters satisfied (combo-first), (2) pool tier + win-rate
function _getCandidatesForCombo(role, filters, coherenceFilter, ctx) {
  const roleFilter = _roleClassFilter(role)

  // Valid champions: satisfy at least one filter (OR logic)
  const valid = ctx.championsList.filter(c =>
    !ctx.usedIds.has(c.id) &&
    filters.some(f => f(c)) &&  // ANY filter must pass (OR logic)
    roleFilter(c) &&
    (parseAssignedRoles(c).length > 0 ? parseAssignedRoles(c) : parseViableRoles(c)).includes(role)
  )

  // Count how many filters this champion satisfies (more = better for combo ranking)
  const comboScore = c => {
    const count = filters.filter(f => f(c)).length
    return -count  // negate: higher count = lower value (sorts first)
  }

  const inPool = valid.filter(c => ctx.champPool?.[c.id]?.some(e => e.role === role))
  const notInPool = valid.filter(c => !ctx.champPool?.[c.id]?.some(e => e.role === role))

  // Sort pool champs: combo-first (more filters), then by pool score
  inPool.sort((a, b) => {
    const scoreA = comboScore(a), scoreB = comboScore(b)
    if (scoreA !== scoreB) return scoreA - scoreB
    return _scoreCandidateForRole(a, role, ctx) - _scoreCandidateForRole(b, role, ctx)
  })

  return [...inPool, ...notInPool].slice(0, 5)
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

  const { missingRoles, possibleRoles } =
    resolveMissingRoles(picks, overrides, ctx.champPool)

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

   // Possibly-missing (wobbly flex) roles → bestfit columns only
    for (const role of possibleRoles) {
      if (missingRoles.includes(role)) continue  // already covered above
      const bestfitCandidates = _getCandidatesForFilters(role, [() => true], null, sortedCtx)
      if (bestfitCandidates.length > 0) {
        recs.push({
          role,
          player: _playerForRole(role, sortedCtx),
          tag: 'bestfit',
          reason: `🏆 Melhor pick`,
          classes: [],
          candidates: [],
          columns: [{
            priority: 8,
            tag: 'bestfit',
            prefix: '🏆 MELHOR PICK',
            gapNames: 'Melhor opção',
            classTags: [],
            colorClasses: { header: 'text-slate-400 bg-slate-800 border-slate-700', button: 'group-hover:border-slate-500' },
            candidates: bestfitCandidates,
            filters: [() => true]
          }]
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
