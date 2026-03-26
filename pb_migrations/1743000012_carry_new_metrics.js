/// <reference path="../pb_data/types.d.ts" />

// Rewrite carry lens metrics to the new 8-metric set.
//
// NEW METRICS (total weight: 16):
//   kda              ×3  source: 'kda'
//   damPerDeath      ×2  source: 'damage_per_min/deaths'
//   damPerMin        ×2  source: 'damage_per_min'          ← new source key
//   goldPerDeath     ×2  source: 'gold_per_min/deaths'
//   goldPerMin       ×2  source: 'gold_per_min'
//   csPerDeath       ×2  source: 'cs_per_min/deaths'
//   csPerMin         ×2  source: 'cs_per_min'
//   killParticipation×1  source: 'kill_participation'
//
// NOTE: 'damage_per_min' as a direct source key is new — ensure runtime JS
//       (rank-config-page.js + stats-page.js) has the matching switch case.
//
// OLD METRICS (from migration 1743000007, weight total: 12):
//   kda ×2, damPerDeath ×5, goldPerDeath ×3, csPerDeath ×1, killShare ×1

// Helper: safely read a JSON field from a record
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

migrate((app) => {
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (!carryRec) return

  const cfg = getConfig(carryRec)
  cfg.metrics = [
    { key: 'kda',               source: 'kda',                   weight_points: 3, cap: null },
    { key: 'damPerDeath',       source: 'damage_per_min/deaths', weight_points: 2, cap: null },
    { key: 'damPerMin',         source: 'damage_per_min',        weight_points: 2, cap: null },
    { key: 'goldPerDeath',      source: 'gold_per_min/deaths',   weight_points: 2, cap: null },
    { key: 'goldPerMin',        source: 'gold_per_min',          weight_points: 2, cap: null },
    { key: 'csPerDeath',        source: 'cs_per_min/deaths',     weight_points: 2, cap: null },
    { key: 'csPerMin',          source: 'cs_per_min',            weight_points: 2, cap: null },
    { key: 'killParticipation', source: 'kill_participation',    weight_points: 1, cap: null },
  ]
  carryRec.set('config', cfg)
  app.save(carryRec)

}, (app) => {
  // Rollback: restore old 5-metric carry set from migration 1743000007
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (!carryRec) return

  try {
    const cfg = getConfig(carryRec)
    cfg.metrics = [
      { key: 'kda',          source: 'kda',                   weight_points: 2, cap: null },
      { key: 'damPerDeath',  source: 'damage_per_min/deaths', weight_points: 5, cap: null },
      { key: 'goldPerDeath', source: 'gold_per_min/deaths',   weight_points: 3, cap: null },
      { key: 'csPerDeath',   source: 'cs_per_min/deaths',     weight_points: 1, cap: null },
      { key: 'killShare',    source: 'kill_participation',    weight_points: 1, cap: null },
    ]
    carryRec.set('config', cfg)
    app.save(carryRec)
  } catch (_) {}
})
