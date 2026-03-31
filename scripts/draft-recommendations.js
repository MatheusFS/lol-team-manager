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

// Build a single recommendation line for a given role + filter.
// Returns null if no viable candidates exist after filtering.
function _makeRecLine(role, compFilterFn, reason, tag, classes, ctx) {
  // ADC cannot be Support or Tank (they have no carry/damage role in that lane)
  const roleFilter = role === 'adc'
    ? c => c.class !== 'Support' && c.class !== 'Tank'
    : () => true

  const allValid  = ctx.championsList.filter(c =>
    !ctx.usedIds.has(c.id) &&
    compFilterFn(c) &&
    roleFilter(c) &&
    (parseAssignedRoles(c).length > 0 ? parseAssignedRoles(c) : parseViableRoles(c)).includes(role)
  )
  const inPool    = allValid.filter(c =>  ctx.champPool?.[c.id]?.some(e => e.role === role))
  const notInPool = allValid.filter(c => !ctx.champPool?.[c.id]?.some(e => e.role === role))

  inPool.sort((a, b) => _scoreCandidateForRole(a, role, ctx) - _scoreCandidateForRole(b, role, ctx))

  const candidates = [...inPool, ...notInPool].slice(0, 10)
  if (!candidates.length) {
    console.debug(`[draft] _makeRecLine(${role}) tag=${tag} → no candidates (allValid=${allValid.length} pool=${ctx.championsList.length})`)
    return null
  }
  return {
    reason,
    tag,
    classes,
    candidates,
    role,
    player: _playerForRole(role, ctx),
  }
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

// Build the best recommendation line for a single role, in priority order.
function _prioritizeRecForRole(role, analysis, shouldPivot, counterTypes, matchup, picksLeft, ctx) {
  const gaps       = analysis.gaps
  const yellowGaps = Object.entries(analysis.heuristics)
    .filter(([, h]) => h.score === 2)
    .sort(([, a], [, b]) => a.score - b.score)
    .map(([k]) => k)

  // Prefer picks that reinforce the established comp theme whenever comp_type is defined.
  // cf is null when no comp type is defined yet (no filtering applied).
  const cf = _coherenceFilter(analysis)

  // 1. Combo: pivot + gap resolved by the same pick (highest priority)
  if (shouldPivot) {
    for (const gap of gaps) {
      const gf  = gapFilter(gap, analysis)
      const rec = _makeRecLine(
        role,
        c => (counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2)) && gf(c),
        `↩️ ${counterTypes.join('/')} · ⚠️ ${analysis.heuristics[gap]?.label ?? gap}`,
        'combo',
        [...counterTypes, ...gapClasses(gap, analysis)],
        ctx,
      )
      if (rec) return rec
    }
  }

  // 2. Pivot first (when >= 2 picks remaining)
  if (picksLeft >= 2 && shouldPivot) {
    const rec = _makeRecLine(
      role,
      c => counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2),
      `↩️ ${counterTypes.join('/')}`,
      'pivot',
      counterTypes,
      ctx,
    )
    if (rec) return rec
  }

  // 3. Critical gap — try multi-objective (2 gaps at once) before single gap
  // 3a: Multi-gap combo: fills two critical gaps with one champion
  if (gaps.length >= 2) {
    for (let i = 0; i < gaps.length - 1; i++) {
      for (let j = i + 1; j < gaps.length; j++) {
        const gf1 = gapFilter(gaps[i], analysis)
        const gf2 = gapFilter(gaps[j], analysis)
        const combinedClasses = [...new Set([...gapClasses(gaps[i], analysis), ...gapClasses(gaps[j], analysis)])]
        const rec = _makeRecLine(
          role,
          c => gf1(c) && gf2(c),
          `⚠️ ${gapLabel(gaps[i], analysis)} + ${gapLabel(gaps[j], analysis)}`,
          'gap',
          combinedClasses,
          ctx,
        )
        if (rec) return rec
      }
    }
  }

  // 3b: Single gap — prefer picks that also reinforce comp_type when comp is defined
  for (const gap of gaps) {
    if (cf) {
      const rec = _makeRecLine(
        role,
        c => gapFilter(gap, analysis)(c) && cf(c),
        `⚠️ ${gapLabel(gap, analysis)} · 🎯 ${analysis.compType}`,
        'gap',
        gapClasses(gap, analysis),
        ctx,
      )
      if (rec) return rec
    }
    const rec = _makeRecLine(
      role,
      gapFilter(gap, analysis),
      `⚠️ ${gapLabel(gap, analysis)}`,
      'gap',
      gapClasses(gap, analysis),
      ctx,
    )
    if (rec) return rec
  }

  // 4. Pivot after gap (when < 2 picks remaining)
  if (picksLeft < 2 && shouldPivot) {
    const rec = _makeRecLine(
      role,
      c => counterTypes.includes(c.comp_type) || counterTypes.includes(c.comp_type_2),
      `↩️ ${counterTypes.join('/')}`,
      'pivot',
      counterTypes,
      ctx,
    )
    if (rec) return rec
  }

  // 5. Yellow gap (reinforce) — prefer picks that also reinforce comp_type
  for (const gap of yellowGaps) {
    if (cf) {
      const rec = _makeRecLine(
        role,
        c => gapFilter(gap, analysis)(c) && cf(c),
        `🧱 ${analysis.heuristics[gap].label} · 🎯 ${analysis.compType}`,
        'reinforce',
        gapClasses(gap, analysis),
        ctx,
      )
      if (rec) return rec
    }
    const rec = _makeRecLine(
      role,
      gapFilter(gap, analysis),
      `🧱 ${analysis.heuristics[gap].label}`,
      'reinforce',
      gapClasses(gap, analysis),
      ctx,
    )
    if (rec) return rec
  }

  // 6. Best-fit fallback — prefer picks that reinforce comp_type
  if (cf) {
    const rec = _makeRecLine(role, cf, `🏆 Melhor pick · 🎯 ${analysis.compType}`, 'bestfit', [], ctx)
    if (rec) return rec
  }
  return _makeRecLine(role, () => true, `🏆 Melhor pick`, 'bestfit', [], ctx)
}

// ── Strategic Grouping ────────────────────────────────────────────────────────
// Groups recommendation candidates into strategic buckets based on rec tag.
// Each candidate appears in exactly one bucket (the bucket corresponding to rec.tag).
function _groupCandidatesByStrategicPriority(recTag, candidates) {
  // Initialize all buckets as empty
  const groups = {
    combo: [],
    pivot: [],
    gap: [],
    reinforce: [],
    bestfit: [],
  }
  
  // All candidates go to the bucket matching the rec tag
  if (groups.hasOwnProperty(recTag)) {
    groups[recTag] = candidates
  } else {
    // Fallback: unknown tag goes to bestfit
    groups.bestfit = candidates
  }
  
  return groups
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

  // Tag priority order (changes based on how many picks are left)
  const TAG_ORDER = picksLeft >= 2
    ? { combo: 0, pivot: 1, gap: 2, reinforce: 3, bestfit: 4 }
    : { combo: 0, gap: 1, pivot: 2, reinforce: 3, bestfit: 4 }

  const recs = []

  // Confirmed-missing roles → full priority rec lines
   for (const role of missingRoles) {
     const rec = _prioritizeRecForRole(role, analysis, shouldPivot, counterTypes, matchup, picksLeft, sortedCtx)
     if (rec) {
       // Add strategic grouping to each rec
       rec.strategicGroups = _groupCandidatesByStrategicPriority(rec.tag, rec.candidates)
       recs.push(rec)
     }
   }
 
   // Possibly-missing (wobbly flex) roles → bestfit lines only, no duplicates
   for (const role of possibleRoles) {
     if (missingRoles.includes(role)) continue  // already covered above
     const rec = _makeRecLine(role, () => true, `🏆 Melhor pick`, 'bestfit', [], sortedCtx)
     if (rec) {
       // Add strategic grouping to each rec
       rec.strategicGroups = _groupCandidatesByStrategicPriority(rec.tag, rec.candidates)
       recs.push(rec)
     }
   }

  recs.sort((a, b) => (TAG_ORDER[a.tag] ?? 9) - (TAG_ORDER[b.tag] ?? 9))

  const result = recs.filter(Boolean)
  console.debug('[draft] buildRecommendations', {
    missingRoles,
    possibleRoles,
    picksLeft,
    poolSize:      sortedCtx.championsList.length,
    champPoolSize: Object.keys(ctx.champPool ?? {}).length,
    recLines:      result.map(r => `${r.role}(${r.tag}):${r.candidates.length}`),
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
