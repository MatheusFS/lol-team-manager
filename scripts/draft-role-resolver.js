// ── Draft Role Resolver ────────────────────────────────────────────────────────
// Pure functions for resolving which roles are covered/missing in a draft.
//
// Two distinct role-parsing functions are intentional:
//   parseAssignedRoles  — used when deducing which role a picked champion IS playing.
//                         Only uses the champion's roles[] field (DDragon data).
//                         Narrower: avoids false positives from OP.GG's tier_by_role.
//   parseViableRoles    — used when filtering the candidate pool for recommendations.
//                         Merges roles[] + tier_by_role keys for maximum coverage.
//                         Wider: ensures champions viable in a role show up as candidates.

// ── Internal parse helpers ─────────────────────────────────────────────────────

function _parseJsonRoles(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

// Roles where a champion is likely PLAYING (narrow — for role deduction only)
function parseAssignedRoles(champ) {
  if (!champ) return []
  return _parseJsonRoles(champ.roles)
}

// All roles a champion is VIABLE in (wide — for candidate pool filtering)
function parseViableRoles(champ) {
  if (!champ) return []
  const fromField = _parseJsonRoles(champ.roles)
  const fromTier  = (champ.tier_by_role && typeof champ.tier_by_role === 'object' && !Array.isArray(champ.tier_by_role))
    ? Object.keys(champ.tier_by_role)
    : []
  return [...new Set([...fromField, ...fromTier])]
}

// ── Missing-role resolver ──────────────────────────────────────────────────────
//
// Determines which roles are still missing from the draft for our team.
//
// Algorithm (slot-aware — each slot produces at most one role assignment):
//
//   Pass 0 — Manual overrides: overrides[i] assigns slot i directly.
//             Each role can only be assigned to ONE slot (first-wins). Later slots
//             with the same override role are treated as unresolved to avoid
//             falsely double-confirming a single role.
//
//   Pass 1 — Champion role inference: for unassigned slots with a pick, check the
//             champion's inherent viable roles (roles[] + tier_by_role).
//             If exactly 1 viable role and not yet assigned → assign it.
//             If 2+ viable roles (multi-role/flex) → leave for constraint propagation.
//
//   Pass 2 — Constraint propagation on still-unresolved picks:
//             Uses parseAssignedRoles (narrow) for each unresolved pick.
//             • 1 viable role → assign (if not taken).
//             • multi roles → intersect with unassigned set; if exactly 1 left → assign.
//             • 0 or 2+ left → slot remains ambiguous.
//             Iterates until stable (no new assignments).
//
//   Pass 3 — Derive outputs:
//             missingRoles  = ALL_ROLES not in coveredRoles (confirmed gaps).
//             possibleRoles = roles that ambiguous flex picks COULD cover that are
//                             currently "confirmed" — meaning the flex pick might shift
//                             to that role, potentially uncovering another.
//             Only produced if nullSlots > missingRoles (more empty slots than gaps).
//
// Parameters:
//   picks     — Array(5) of champion records | null  (our team picks)
//   overrides — Array(5) of role string | null        (pickRoles per slot)
//   champPool — Map<champId, [{playerName, role, poolTier}]>
//
// Returns:
//   {
//     slotAssignments : Map<slotIdx, role>,  // confirmed role per slot
//     coveredRoles    : Set<string>,          // roles covered with certainty
//     missingRoles    : string[],             // ALL_ROLES \ coveredRoles
//     possibleRoles   : string[],             // wobbly confirmed roles (may show as hints)
//   }

const ALL_ROLES = ['top', 'jng', 'mid', 'adc', 'sup']

function resolveMissingRoles(picks, overrides, champPool) {
  const slotAssignments = new Map()   // slotIdx → role
  const coveredRoles    = new Set()   // roles definitively assigned

  // Indices of slots that have a pick but no assignment yet
  const unresolvedIdxs  = []

  // ── Pass 0: manual overrides ───────────────────────────────────────────────
  // Each override assigns its slot directly. ONLY for slots that have a pick —
  // an override on an empty slot must not count as "covered" (the pick hasn't
  // happened yet). If two slots have the same override role, the second is
  // treated as unresolved to avoid double-counting.
  for (let i = 0; i < picks.length; i++) {
    const role = overrides?.[i]
    if (!role) continue
    if (!picks[i]) continue          // empty slot — override is intent, not fact
    if (!coveredRoles.has(role)) {
      slotAssignments.set(i, role)
      coveredRoles.add(role)
    }
    // Slot with duplicate override → leave for later passes (has a pick but no assignment)
  }

  // ── Pass 1: champion role inference ────────────────────────────────────────
  // Resolve picks based on champion's inherent viable roles (from roles[] + tier_by_role),
  // NOT from the champion_pool collection. This ensures that:
  //   • Single-role champions (e.g., Thresh [sup]) auto-confirm.
  //   • Multi-role champions (e.g., Poppy [top,jng,sup]) are treated as flex.
  // The pool is used elsewhere (candidate ranking), not for role inference.
  for (let i = 0; i < picks.length; i++) {
    if (slotAssignments.has(i)) continue   // already assigned
    const pick = picks[i]
    if (!pick) continue                    // empty slot — not a pick at all

    // Use champion's viable roles (wide: roles[] + tier_by_role)
    const viableRoles = parseViableRoles(pick)

    // Only resolve if exactly 1 viable role; otherwise treat as flex
    if (viableRoles.length === 1) {
      const role = viableRoles[0]
      if (!coveredRoles.has(role)) {
        slotAssignments.set(i, role)
        coveredRoles.add(role)
      } else {
        unresolvedIdxs.push(i)
      }
    } else {
      // 0 roles (no roles field?) or 2+ roles (multi-role/flex) → unresolved
      unresolvedIdxs.push(i)
    }
  }

  // ── Pass 2: constraint propagation ─────────────────────────────────────────
  // Use parseAssignedRoles (narrow — no tier_by_role) to avoid false certainty.
  let changed = true
  while (changed) {
    changed = false
    for (let k = unresolvedIdxs.length - 1; k >= 0; k--) {
      const i    = unresolvedIdxs[k]
      const pick = picks[i]
      if (!pick) { unresolvedIdxs.splice(k, 1); continue }

      const roles     = parseAssignedRoles(pick)
      const remaining = roles.filter(r => !coveredRoles.has(r))

      if (roles.length === 0) {
        unresolvedIdxs.splice(k, 1)
        continue
      }
      if (remaining.length === 1) {
        const role = remaining[0]
        slotAssignments.set(i, role)
        coveredRoles.add(role)
        unresolvedIdxs.splice(k, 1)
        changed = true
      } else if (remaining.length === 0) {
        // All this pick's roles are already taken → give up on this slot
        unresolvedIdxs.splice(k, 1)
      }
      // 2+ remaining → still ambiguous, try again next iteration
    }
  }

  // ── Pass 3: derive missing + possible ──────────────────────────────────────
  const missingRoles = ALL_ROLES.filter(r => !coveredRoles.has(r))

  // Flex pick detection: when picks exist but lack role confirmation (unresolved),
  // collect all the roles they could viably play — but ONLY roles not yet covered.
  // This ensures possibleRoles never includes roles already confirmed elsewhere.
  let possibleRoles = []
  if (unresolvedIdxs.length > 0) {
    // Collect all roles that unconfirmed/flex picks could play (narrow: parseAssignedRoles),
    // filtering out roles already assigned (in coveredRoles).
    const wobblySet = new Set()
    for (const i of unresolvedIdxs) {
      const pick = picks[i]
      if (!pick) continue
      for (const r of parseAssignedRoles(pick)) {
        if (!coveredRoles.has(r)) wobblySet.add(r)
      }
    }
    possibleRoles = [...wobblySet]
  }

  console.debug('[draft] resolveMissingRoles', {
    picks:       picks.map(p => p?.name ?? null),
    overrides,
    slotAssignments: Object.fromEntries(slotAssignments),
    coveredRoles: [...coveredRoles],
    missingRoles,
    possibleRoles,
    unresolved: unresolvedIdxs,
  })

  return { slotAssignments, coveredRoles, missingRoles, possibleRoles }
}
