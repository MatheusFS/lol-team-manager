/// <reference path="../pb_data/types.d.ts" />

// Fix carry lens source keys that should have been renamed in migration 013
// but didn't apply for some reason.
//
// This corrects:
//   damage_per_min/deaths → damage_per_game/deaths
//   gold_per_min/deaths → gold_per_game/deaths
//   cs_per_min/deaths → cs_per_game/deaths

function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

const FIXES = {
  'damage_per_min/deaths': 'damage_per_game/deaths',
  'gold_per_min/deaths': 'gold_per_game/deaths',
  'cs_per_min/deaths': 'cs_per_game/deaths',
}

migrate((app) => {
  const carryRec = app.findRecordsByFilter('rank_config', `name = "carry"`)[0]
  if (!carryRec) return

  const cfg = getConfig(carryRec)
  if (!cfg.metrics) return

  let modified = false
  for (const m of cfg.metrics) {
    if (FIXES[m.source]) {
      console.log(`Fixing carry metric ${m.key}: ${m.source} → ${FIXES[m.source]}`)
      m.source = FIXES[m.source]
      modified = true
    }
  }

  if (modified) {
    carryRec.set('config', cfg)
    app.save(carryRec)
  }
}, (app) => {
  // Rollback
  const REVERSE = Object.fromEntries(
    Object.entries(FIXES).map(([old, newVal]) => [newVal, old])
  )

  const carryRec = app.findRecordsByFilter('rank_config', `name = "carry"`)[0]
  if (!carryRec) return

  const cfg = getConfig(carryRec)
  if (!cfg.metrics) return

  for (const m of cfg.metrics) {
    if (REVERSE[m.source]) {
      m.source = REVERSE[m.source]
    }
  }

  carryRec.set('config', cfg)
  app.save(carryRec)
})
