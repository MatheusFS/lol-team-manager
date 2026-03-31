// ── Draft Gap Analysis ─────────────────────────────────────────────────────────
// Pure functions for evaluating team composition gaps.
// Extracted from draft-page.js to eliminate DRY violations in _gapFilter,
// _gapLabel, _gapClasses (all three had duplicated damage-profile logic).
//
// computeDamageProfile() is the single source of truth for AD/AP weighting.
// gapFilter / gapLabel / gapClasses all call it instead of repeating the math.

// ── Damage profile ────────────────────────────────────────────────────────────
//
// Converts raw damageCounts into weighted AD/AP scores and boolean flags.
// Weights: high = 1.0, mixed_high = 0.5, mixed_low = 0.167, low = 0.333
//
// Returns:
//   adWeight      — weighted sum of AD damage across picks
//   apWeight      — weighted sum of AP damage across picks
//   hasExplosivo  — true if at least one high-burst pick exists
//   hasSustentado — true if at least one sustained-damage pick exists (Mage or Fighter)

function computeDamageProfile(analysis) {
  const dc  = analysis.damageCounts ?? {}
  const picks = analysis.picks ?? []

  const adWeight = (dc.AD_high    ?? 0) * 1.000
                 + (dc.AD_low     ?? 0) * 0.333
                 + (dc.Mixed_high ?? 0) * 0.500
                 + (dc.Mixed_low  ?? 0) * 0.167

  const apWeight = (dc.AP_high    ?? 0) * 1.000
                 + (dc.AP_low     ?? 0) * 0.333
                 + (dc.Mixed_high ?? 0) * 0.500
                 + (dc.Mixed_low  ?? 0) * 0.167

  const hasExplosivo = picks.some(c =>
    c.class === 'Assassin' ||
    (c.class === 'Mage'     && (c.damage_type === 'AP_high'    || c.damage_type === 'Mixed_high')) ||
    (c.class === 'Marksman' && (c.damage_type === 'AD_high'    || c.damage_type === 'Mixed_high')) ||
    (c.class === 'Fighter'  && (c.damage_type === 'AD_high'    || c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'))
  )

  const hasSustentado = (analysis.classCounts?.Mage ?? 0) >= 1
                     || (analysis.classCounts?.Fighter ?? 0) >= 1

  return { adWeight, apWeight, hasExplosivo, hasSustentado }
}

// ── Gap filter ────────────────────────────────────────────────────────────────
// Returns a predicate (champ) => boolean that selects champions addressing a gap.

function gapFilter(gap, analysis) {
  switch (gap) {
    case 'frontline':
      return c => c.class === 'Tank'

    case 'ofensividade':
      return c =>
        (c.class === 'Marksman' && (c.damage_type === 'AD_high' || c.damage_type === 'Mixed_high')) ||
        (c.class === 'Assassin' && (c.damage_type === 'AD_high' || c.damage_type === 'Mixed_high')) ||
        (c.class === 'Mage'     && (c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'))

    case 'engage':
      return c =>
        c.comp_type  === 'Engage' || c.comp_type_2 === 'Engage' ||
        c.comp_type  === 'Pick'   || c.comp_type_2 === 'Pick'

    case 'peel':
      return c => c.class === 'Support' || c.comp_type === 'Protect' || c.comp_type_2 === 'Protect'

    case 'perfilDano': {
      const { adWeight, apWeight, hasExplosivo, hasSustentado } = computeDamageProfile(analysis)
      if (!adWeight || adWeight < 1)    return c => c.damage_type === 'AD_high' || c.damage_type === 'Mixed_high'
      if (!apWeight || apWeight < 1)    return c => c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'
      if (!hasExplosivo)                return c =>
        c.class === 'Assassin' ||
        (c.class === 'Mage'     && (c.damage_type === 'AP_high'  || c.damage_type === 'Mixed_high')) ||
        (c.class === 'Marksman' && (c.damage_type === 'AD_high'  || c.damage_type === 'Mixed_high')) ||
        (c.class === 'Fighter'  && (c.damage_type === 'AD_high'  || c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'))
      if (!hasSustentado)               return c => c.class === 'Mage' || c.class === 'Fighter'
      return () => false
    }

    case 'coherence': {
      const ct = analysis.compType
      if (!ct) return () => false
      return c => c.comp_type === ct || c.comp_type_2 === ct
    }

    case 'early':
      return c => c.early === 2  // Champion strong in early

    case 'mid':
      return c => c.mid === 2    // Champion strong in mid

    case 'late':
      return c => c.late === 2   // Champion strong in late

    default:
      return () => false
  }
}

// ── Gap label ─────────────────────────────────────────────────────────────────
// Returns a human-readable description of the gap.

function gapLabel(gap, analysis) {
  switch (gap) {
    case 'frontline':    return 'Falta frontline (Tank)'
    case 'ofensividade': return 'Falta ofensividade (carry ou mago de dano)'
    case 'engage':       return 'Falta engage ou pick'
    case 'peel':         return 'Falta proteção (Support)'

    case 'perfilDano': {
      const { adWeight, apWeight, hasExplosivo, hasSustentado } = computeDamageProfile(analysis)
      if (adWeight < 1 && apWeight < 1) return 'Perfil de dano fraco (falta AD e AP relevantes)'
      if (adWeight < 1)                 return 'Falta dano físico relevante (AD_high ou Mixed)'
      if (apWeight < 1)                 return 'Falta dano mágico relevante (AP_high ou Mixed)'
      if (!hasExplosivo)                return 'Falta dano explosivo (carry ou mago burst)'
      if (!hasSustentado)               return 'Falta dano sustentado (Mage ou Fighter)'
      return 'Perfil de dano incompleto'
    }

    case 'coherence':
      return `Comp incoerente para ${analysis.compType ?? 'tipo escolhido'}`

    case 'early':
      return 'Falta força no early game'

    case 'mid':
      return 'Falta força no mid game'

    case 'late':
      return 'Falta força no late game'

    default:
      return gap
  }
}

// ── Gap short label ────────────────────────────────────────────────────────
// Returns a brief human-readable description of the gap (without class hints).
// Used for column headers where space is tight.

function gapShortLabel(gap, analysis) {
  switch (gap) {
    case 'frontline':    return 'Falta frontline'
    case 'ofensividade': return 'Falta ofensividade'
    case 'engage':       return 'Falta engage ou pick'
    case 'peel':         return 'Falta proteção'

    case 'perfilDano': {
      const { adWeight, apWeight, hasExplosivo, hasSustentado } = computeDamageProfile(analysis)
      if (adWeight < 1 && apWeight < 1) return 'Falta dano AD e AP'
      if (adWeight < 1)                 return 'Falta dano físico relevante'
      if (apWeight < 1)                 return 'Falta dano mágico relevante'
      if (!hasExplosivo)                return 'Falta dano explosivo'
      if (!hasSustentado)               return 'Falta dano sustentado'
      return 'Perfil de dano incompleto'
    }

    case 'coherence':
      return 'Comp incoerente'

    case 'early':
      return 'Falta early'

    case 'mid':
      return 'Falta mid'

    case 'late':
      return 'Falta late'

    default:
      return gap
  }
}

// ── Gap classes ───────────────────────────────────────────────────────────────
// Returns badge labels for champion classes that address this gap.

function gapClasses(gap, analysis) {
  switch (gap) {
    case 'frontline':    return ['Tank']
    case 'ofensividade': return ['Marksman', 'Assassin', 'Mage']
    case 'engage':       return ['comp: Engage', 'comp: Pick']
    case 'peel':         return ['Support', 'comp: Protect']

    case 'perfilDano': {
      const { adWeight, apWeight, hasExplosivo } = computeDamageProfile(analysis)
      if (adWeight < 1) return ['Marksman', 'Assassin AD']
      if (apWeight < 1) return ['Mage', 'Assassin AP']
      if (!hasExplosivo) return ['Assassin', 'Mage burst', 'Marksman burst']
      return ['Mage', 'Fighter']
    }

    case 'coherence': {
      const ct = analysis.compType
      if (!ct) return []
      return [`comp: ${ct}`]
    }

    case 'early':
      return ['Early']

    case 'mid':
      return ['Mid']

    case 'late':
      return ['Late']

    default:
      return []
  }
}
