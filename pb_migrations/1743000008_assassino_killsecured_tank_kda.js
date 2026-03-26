/// <reference path="../pb_data/types.d.ts" />

// Updates assassino and tank lens metric configs.
//
// CHANGES:
//
// assassino:
//   - Remove killsPerDeath (KDA already covers kill efficiency)
//   - Replace killShare (kills/teamKills) with killSecured (kills/(kills+assists))
//   - New metrics: kda ×2, killSecured ×2, damPerDeath ×1, goldPerDeath ×1
//
// tank:
//   - Prepend kda ×1 as first metric
//   - New metrics: kda ×1, mitPerDmgRec ×3, mitPerDeath ×2, dtPerDeath ×1, ccMin ×1

// Helper: safely read a JSON field from a record (works in both serve and migrate contexts)
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

migrate((app) => {
  // ── assassino ──────────────────────────────────────────────────────────────
  const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
  if (assassinoRec) {
    const cfg = getConfig(assassinoRec)
    cfg.assumptions = {}
    cfg.metrics = [
      { key: 'kda',          source: 'kda',                   weight_points: 2, cap: null },
      { key: 'killSecured',  source: 'kill_secured',          weight_points: 2, cap: null },
      { key: 'damPerDeath',  source: 'damage_per_min/deaths', weight_points: 1, cap: null },
      { key: 'goldPerDeath', source: 'gold_per_min/deaths',   weight_points: 1, cap: null },
    ]
    assassinoRec.set('config', cfg)
    app.save(assassinoRec)
  }

  // ── tank ───────────────────────────────────────────────────────────────────
  const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
  if (tankRec) {
    const cfg = getConfig(tankRec)
    cfg.assumptions = {}
    cfg.metrics = [
      { key: 'kda',          source: 'kda',                                        weight_points: 1, cap: null },
      { key: 'mitPerDmgRec', source: 'damage_mitigated_per_min/damage_taken_per_min', weight_points: 3, cap: null },
      { key: 'mitPerDeath',  source: 'damage_mitigated_per_min/deaths',               weight_points: 2, cap: null },
      { key: 'dtPerDeath',   source: 'damage_taken_per_min/deaths',                   weight_points: 1, cap: null },
      { key: 'ccMin',        source: 'cc_per_min',                                    weight_points: 1, cap: null },
    ]
    tankRec.set('config', cfg)
    app.save(tankRec)
  }

}, (app) => {
  // ── Rollback — restore migration 007 state ─────────────────────────────────
  try {
    const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
    if (assassinoRec) {
      const cfg = getConfig(assassinoRec)
      cfg.assumptions = {}
      cfg.metrics = [
        { key: 'kda',           source: 'kda',                   weight_points: 2, cap: null },
        { key: 'killsPerDeath', source: 'kills_per_game/deaths', weight_points: 4, cap: null },
        { key: 'killShare',     source: 'kill_share',            weight_points: 2, cap: null },
        { key: 'damPerDeath',   source: 'damage_per_min/deaths', weight_points: 1, cap: null },
        { key: 'goldPerDeath',  source: 'gold_per_min/deaths',   weight_points: 1, cap: null },
      ]
      assassinoRec.set('config', cfg)
      app.save(assassinoRec)
    }

    const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
    if (tankRec) {
      const cfg = getConfig(tankRec)
      cfg.assumptions = {}
      cfg.metrics = [
        { key: 'mitPerDmgRec', source: 'damage_mitigated_per_min/damage_taken_per_min', weight_points: 3, cap: null },
        { key: 'mitPerDeath',  source: 'damage_mitigated_per_min/deaths',               weight_points: 2, cap: null },
        { key: 'dtPerDeath',   source: 'damage_taken_per_min/deaths',                   weight_points: 1, cap: null },
        { key: 'ccMin',        source: 'cc_per_min',                                    weight_points: 1, cap: null },
      ]
      tankRec.set('config', cfg)
      app.save(tankRec)
    }
  } catch (_) {}
})
