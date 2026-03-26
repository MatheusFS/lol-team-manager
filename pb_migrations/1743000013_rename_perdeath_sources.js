/// <reference path="../pb_data/types.d.ts" />

// Rename source keys in all lens configurations.
//
// RATIONALE:
//   Source keys like 'damage_per_min/deaths' were misleading — the actual formula
//   is always damage_per_game / deaths_per_game, NOT damage_per_min / deaths.
//
// RENAMES (7 total):
//   damage_per_min/deaths                    → damage_per_game/deaths
//   gold_per_min/deaths                      → gold_per_game/deaths
//   cs_per_min/deaths                        → cs_per_game/deaths
//   assists_per_min/deaths                   → assists_per_game/deaths  (already had alias, remove old)
//   vision_score_per_min/deaths              → vision_score_per_game/deaths
//   damage_mitigated_per_min/deaths          → damage_mitigated_per_game/deaths
//   damage_taken_per_min/deaths              → damage_taken_per_game/deaths
//
// UNCHANGED (genuinely per_min):
//   damage_mitigated_per_min/damage_taken_per_min (stays same)
//   damage_taken_per_min, cc_per_min, etc. (stays same)

// Helper: safely read a JSON field from a record
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

const OLD_SOURCES = {
  'damage_per_min/deaths': 'damage_per_game/deaths',
  'gold_per_min/deaths': 'gold_per_game/deaths',
  'cs_per_min/deaths': 'cs_per_game/deaths',
  'assists_per_min/deaths': 'assists_per_game/deaths',
  'vision_score_per_min/deaths': 'vision_score_per_game/deaths',
  'damage_mitigated_per_min/deaths': 'damage_mitigated_per_game/deaths',
  'damage_taken_per_min/deaths': 'damage_taken_per_game/deaths',
}

function renameSourcesInLens(cfg) {
  if (!cfg.metrics) return
  for (const m of cfg.metrics) {
    if (OLD_SOURCES[m.source]) {
      m.source = OLD_SOURCES[m.source]
    }
  }
}

migrate((app) => {
  const lensNames = ['carry', 'assassino', 'bruiser', 'tank', 'suporte']
  for (const name of lensNames) {
    const rec = app.findRecordsByFilter('rank_config', `name = "${name}"`)[0]
    if (!rec) continue
    const cfg = getConfig(rec)
    renameSourcesInLens(cfg)
    rec.set('config', cfg)
    app.save(rec)
  }
}, (app) => {
  // Rollback: reverse the renames
  const REVERSE_SOURCES = Object.fromEntries(
    Object.entries(OLD_SOURCES).map(([old, newVal]) => [newVal, old])
  )

  const lensNames = ['carry', 'assassino', 'bruiser', 'tank', 'suporte']
  for (const name of lensNames) {
    const rec = app.findRecordsByFilter('rank_config', `name = "${name}"`)[0]
    if (!rec) continue
    try {
      const cfg = getConfig(rec)
      if (!cfg.metrics) continue
      for (const m of cfg.metrics) {
        if (REVERSE_SOURCES[m.source]) {
          m.source = REVERSE_SOURCES[m.source]
        }
      }
      rec.set('config', cfg)
      app.save(rec)
    } catch (_) {}
  }
})
