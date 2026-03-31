// ── Comp Analysis Utilities ───────────────────────────────────────────────────
// Shared logic used by draft-page.js and match-form.js.
// Depends on: CHAMPION_CLASSES, COMP_BEATS (shared.js)

/**
 * Computes comp type (via weighted votes), EML scaling, and vote list
 * from an array of champion records.
 *
 * @param {Object[]} picks - Array of champion records (with class, comp_type, comp_type_2, early, mid, late)
 * @returns {{ compType: string|null, scaling: (number|null)[], voteList: {type:string,n:number}[] }}
 */
function buildCompVector(picks) {
  // Peso por classe: carries/divers definem mais o tema do que ADC/SUP
  const CLASS_VOTE_WEIGHT = { Fighter: 1.5, Assassin: 1.5, Tank: 1.2, Mage: 1.0, Marksman: 0.7, Support: 0.9 }
  const votes  = {}
  const totals = [0, 0, 0], counts = [0, 0, 0]
  for (const c of picks) {
    const w = CLASS_VOTE_WEIGHT[c.class] ?? 1.0
     if (c.comp_type)   votes[c.comp_type]   = (votes[c.comp_type]   ?? 0) + 3 * w
     if (c.comp_type_2) votes[c.comp_type_2] = (votes[c.comp_type_2] ?? 0) + 1 * w
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
}

/**
 * Counts champions per class and per damage_type bucket.
 *
 * @param {Object[]} picks
 * @returns {{ classCounts: Object, damageCounts: Object }}
 */
function buildCounts(picks) {
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
}

/**
 * Builds heuristic scores (frontline, ofensividade, engage, peel, perfilDano, coherence)
 * from picks + comp vector + class/damage counts.
 *
 * Each heuristic: { score: 0|2|3, label: string, color: 'red'|'yellow'|'green' }
 *
 * @param {Object[]} picks
 * @param {{ compType: string|null }} comp
 * @param {{ classCounts: Object, damageCounts: Object }} counts
 * @returns {Object}
 */
function buildHeuristics(picks, comp, { classCounts, damageCounts }) {
  const sc = (n, t) => n === 0 ? t[0] : n === 1 ? t[1] : t[2]

  const frontlineRaw = classCounts.Tank + Math.floor(classCounts.Fighter / 2)
  const frontline    = { score: sc(frontlineRaw, [0, 2, 3]), label: 'Frontline' }

    const dpsRaw = picks.filter(c =>
      (c.class === 'Marksman' && (c.damage_type === 'AD_high' || c.damage_type === 'Mixed_high')) ||
      (c.class === 'Assassin' && (c.damage_type === 'AD_high' || c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high')) ||
      (c.class === 'Mage'     && (c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high')) ||
      (c.class === 'Fighter'  && (c.damage_type === 'AD_high' || c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'))
    ).length
   // Scoring: 0 → 0 (red), 1-2 → 2 (yellow), 3+ → 3 (green)
   const ofensividade = { score: dpsRaw === 0 ? 0 : dpsRaw < 3 ? 2 : 3, label: 'Ofensividade' }

  const engageRaw = picks.filter(c =>
    c.comp_type === 'Engage' || c.comp_type_2 === 'Engage' ||
    c.comp_type === 'Pick'   || c.comp_type_2 === 'Pick'
  ).length
  const engage = { score: sc(engageRaw, [0, 2, 3]), label: 'Engage' }

   const peelRaw = picks.reduce((s, c) => {
     if (c.class === 'Support' || c.comp_type === 'Protect')  return s + 1.0
     if (c.comp_type_2 === 'Protect') return s + 0.5
     return s
   }, 0)
   // Scoring: <1.5 → 0 (red), 1.5-2.4 → 2 (yellow), 2.5+ → 3 (green)
   const peel = { score: peelRaw >= 2.5 ? 3 : peelRaw >= 1.5 ? 2 : 0, label: 'Proteção' }

  const dc = damageCounts
  const adWeight = picks.reduce((s, c) => {
    if      (c.damage_type === 'AD_high')    return s + 1.000
    else if (c.damage_type === 'AD_low')     return s + 0.333
    else if (c.damage_type === 'Mixed_high') return s + 0.500
    else if (c.damage_type === 'Mixed_low')  return s + 0.167
    return s
  }, 0)
  const apWeight = picks.reduce((s, c) => {
    if      (c.damage_type === 'AP_high')    return s + 1.000
    else if (c.damage_type === 'AP_low')     return s + 0.333
    else if (c.damage_type === 'Mixed_high') return s + 0.500
    else if (c.damage_type === 'Mixed_low')  return s + 0.167
    return s
  }, 0)
  const hasAD         = adWeight >= 1
  const hasAP         = apWeight >= 1
  const hasExplosivo  = picks.some(c =>
    (c.class === 'Assassin') ||
    (c.class === 'Mage'     && (c.damage_type === 'AP_high'  || c.damage_type === 'Mixed_high')) ||
    (c.class === 'Marksman' && (c.damage_type === 'AD_high'  || c.damage_type === 'Mixed_high')) ||
    (c.class === 'Fighter'  && (c.damage_type === 'AD_high'  || c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'))
  )
  const hasSustentado = classCounts.Mage >= 1 || classCounts.Fighter >= 1
  const perfilAxes    = [hasAD, hasAP, hasExplosivo, hasSustentado].filter(Boolean).length
  const perfilDano    = { score: perfilAxes >= 4 ? 3 : perfilAxes >= 3 ? 2 : 0, label: 'Perfil de Dano' }

   // Coherence: progressive score based on team composition alignment with dominant comp type
   // Uses two signals: N (number of picks) and S (weighted theme score for the dominant comp type)
   // Thresholds: ZERO (red) if N≤1 or S<2.5; ONE (red) if N≥2 && S≥2.5;
   //             TWO (yellow) if N≥3 && S≥3.5; THREE (green) if N≥4 && S≥4.5
   const ct = comp.compType
   let coherenceScore
   if (!ct || ct === 'Mix') {
     // No established comp yet or mix of types → no established direction to be incoherent about
     coherenceScore = 3
   } else {
     const N = picks.length
     const S = comp.voteList.find(v => v.type === ct)?.n ?? 0
     if      (N >= 4 && S >= 4.5) coherenceScore = 3
     else if (N >= 3 && S >= 3.5) coherenceScore = 2
     else if (N >= 2 && S >= 2.5) coherenceScore = 1
     else                          coherenceScore = 0
   }
   const coherence = { score: coherenceScore, label: 'Coerência' }

  const color = s => s >= 3 ? 'green' : s >= 2 ? 'yellow' : 'red'
  const add   = h => ({ ...h, color: color(h.score) })

  return {
    frontline:    add(frontline),
    ofensividade: add(ofensividade),
    engage:       add(engage),
    peel:         add(peel),
    perfilDano:   add(perfilDano),
    coherence:    add(coherence),
  }
}

/**
 * Full team analysis pipeline: comp vector + counts + heuristics + gaps + overall score.
 *
 * @param {Object[]} picks - Array of champion records (nulls filtered internally)
 * @returns {Object} analysis
 */
function analyzeTeam(picks) {
  const filled = picks.filter(Boolean)
  if (!filled.length) return {
    picks: filled, count: 0, compType: null, voteList: [], scaling: [null, null, null],
    classCounts: {}, damageCounts: {}, heuristics: {}, gaps: [], overallScore: 0,
  }

  const comp       = buildCompVector(filled)
  const counts     = buildCounts(filled)
  const heuristics = buildHeuristics(filled, comp, counts)
  const weights    = { frontline: 1.5, ofensividade: 1.5, engage: 1.2, peel: 0.8, perfilDano: 1.0, coherence: 1.0 }
  // Tiebreaker when multiple gaps share the same score
  const GAP_PRIORITY = ['frontline', 'ofensividade', 'engage', 'perfilDano', 'coherence', 'peel']
  
  // Derive phase-specific gaps from scaling curve (early/mid/late)
  const phaseGaps = []
  if (comp.scaling && comp.scaling.length === 3) {
    const phases = ['early', 'mid', 'late']
    for (let i = 0; i < 3; i++) {
      const avg = comp.scaling[i]
      // Weak: avg < 0.6; Neutral: 0.6 ≤ avg < 1.4; Strong: avg ≥ 1.4
      if (avg != null && avg < 3/5) {
        phaseGaps.push(phases[i])  // weak phase → add as gap
      }
    }
  }
  
  const maxScore   = Object.values(weights).reduce((s, w) => s + w * 3, 0)
  const rawScore   = Object.entries(heuristics).reduce((s, [k, h]) => s + (weights[k] ?? 1) * h.score, 0)
  const gaps       = Object.entries(heuristics)
    .filter(([, h]) => h.score < 2)
    .sort(([ka, a], [kb, b]) =>
      a.score !== b.score
        ? a.score - b.score
        : (GAP_PRIORITY.indexOf(ka) + 1 || 99) - (GAP_PRIORITY.indexOf(kb) + 1 || 99)
    )
    .map(([k]) => k)
    .concat(phaseGaps)  // Add phase gaps after heuristic gaps

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
}
