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
        c.class === 'Marksman' ||
        (c.class === 'Assassin' && (c.damage_type === 'AD_high' || c.damage_type === 'Mixed_high')) ||
        (c.class === 'Mage'     && (c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'))

    case 'engage':
      return c =>
        c.comp_type  === 'Engage' || c.comp_type_2 === 'Engage' ||
        c.comp_type  === 'Pick'   || c.comp_type_2 === 'Pick'

    case 'peel':
      return c => c.class === 'Support'

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
      if (ct === 'Siege')   return c => c.damage_type === 'AP_high' || c.damage_type === 'Mixed_high'
      if (ct === 'Split')   return c => c.class === 'Fighter' && (c.damage_type === 'AD_high' || c.damage_type === 'AD_low')
      if (ct === 'Protect') return c => c.class === 'Marksman' || c.class === 'Support'
      if (ct === 'Engage')  return c => c.class === 'Tank'
      if (ct === 'Pick')    return c => c.class === 'Assassin'
      return () => false
    }

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
      return `Comp incoerente (${analysis.compType ?? '?'})`

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
    case 'peel':         return ['Support']

    case 'perfilDano': {
      const { adWeight, apWeight, hasExplosivo } = computeDamageProfile(analysis)
      if (adWeight < 1) return ['Marksman', 'Assassin AD']
      if (apWeight < 1) return ['Mage', 'Assassin AP']
      if (!hasExplosivo) return ['Assassin', 'Mage burst', 'Marksman burst']
      return ['Mage', 'Fighter']
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

    default:
      return []
  }
}
