/// <reference path="../pb_data/types.d.ts" />

// Tank lens improvements:
// 1. Rename mitPerDmgRec.source from misleading 'damage_mitigated_per_min/damage_taken_per_min'
//    to correct semantics 'damage_mitigated/damage_taken' (per_game/per_game ratio, time units cancel)
// 2. Add new mitPerMin metric: damage_mitigated_per_min with weight=2
//    (mirrors the pattern of other lenses with direct per_min metrics)
//
// Final tank metrics (total weight: 12):
//   kda              ×2   source: kda
//   mitPerDmgRec     ×3   source: damage_mitigated/damage_taken
//   mitPerDeath      ×3   source: damage_mitigated_per_game/deaths
//   dtPerDeath       ×1   source: damage_taken_per_game/deaths
//   ccMin            ×1   source: cc_per_min
//   mitPerMin        ×2   source: damage_mitigated_per_min  ← new

function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

migrate((app) => {
  const tankRec = app.findRecordsByFilter('rank_config', `name = "tank"`)[0]
  if (!tankRec) {
    console.log('[migration 1743000015] No tank record found')
    return
  }

  const cfg = getConfig(tankRec)
  if (!cfg.metrics) {
    console.log('[migration 1743000015] No metrics in tank config')
    return
  }

  // 1. Rename mitPerDmgRec.source
  const mitPerDmgRecMetric = cfg.metrics.find(m => m.key === 'mitPerDmgRec')
  if (mitPerDmgRecMetric && mitPerDmgRecMetric.source === 'damage_mitigated_per_min/damage_taken_per_min') {
    console.log('[migration 1743000015] Renaming mitPerDmgRec.source')
    mitPerDmgRecMetric.source = 'damage_mitigated/damage_taken'
  }

  // 2. Add mitPerMin metric if not already present
  if (!cfg.metrics.find(m => m.key === 'mitPerMin')) {
    console.log('[migration 1743000015] Adding mitPerMin metric')
    cfg.metrics.push({
      key: 'mitPerMin',
      source: 'damage_mitigated_per_min',
      weight_points: 2,
      cap: null,
    })
  }

  tankRec.set('config', cfg)
  app.save(tankRec)
  console.log('[migration 1743000015] Tank config updated successfully')
}, (app) => {
  // Rollback: reverse the changes
  const tankRec = app.findRecordsByFilter('rank_config', `name = "tank"`)[0]
  if (!tankRec) return

  try {
    const cfg = getConfig(tankRec)
    if (!cfg.metrics) return

    // Revert source name
    const mitPerDmgRecMetric = cfg.metrics.find(m => m.key === 'mitPerDmgRec')
    if (mitPerDmgRecMetric && mitPerDmgRecMetric.source === 'damage_mitigated/damage_taken') {
      mitPerDmgRecMetric.source = 'damage_mitigated_per_min/damage_taken_per_min'
    }

    // Remove mitPerMin metric
    cfg.metrics = cfg.metrics.filter(m => m.key !== 'mitPerMin')

    tankRec.set('config', cfg)
    app.save(tankRec)
  } catch (_) {}
})
