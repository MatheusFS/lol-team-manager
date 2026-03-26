/// <reference path="../pb_data/types.d.ts" />

// Full rewrite of all 5 lens metric configs with new columns, sources, and weights.
//
// CHANGES (all lenses — metrics array replaced entirely):
//
// carry:
//   Columns: Dano/Morte, Ouro/Morte, CS/Morte, Kill Share
//   Score: KDA ×2, damPerDeath ×5, goldPerDeath ×3, csPerDeath ×1, killShare ×1
//   New sources: 'kda', 'cs_per_min/deaths'
//   Note: damPerDeath/goldPerDeath now use sum/deathsSum semantics (not per-min/deaths)
//
// assassino:
//   Columns: Kills/Morte, Dano/Morte, Kill Share, Ouro/min
//   Score: KDA ×2, killsPerDeath ×4, killShare ×2, damPerDeath ×1, goldPerDeath ×1
//   New sources: 'kda', 'gold_per_min/deaths'
//
// bruiser:
//   Columns: Dano/DmgRec, Dano/Morte, Ouro/Morte
//   Score: KDA ×1, damPerDmgRec ×3, damPerDeath ×1, goldPerDeath ×1
//   New sources: 'kda', 'damage_per_min/damage_taken_per_min'
//
// tank:
//   Columns: Mitigado/DmgRec, Mitigado/Morte, DmgRec/Morte, CC/min
//   Score: mitPerDmgRec ×3, mitPerDeath ×2, dtPerDeath ×1, ccMin ×1
//   New sources: 'damage_mitigated_per_min/damage_taken_per_min',
//                'damage_mitigated_per_min/deaths', 'damage_taken_per_min/deaths'
//
// suporte:
//   Columns: Assist/Morte, Visão/Morte, Control Wards, Wards/Morte
//   Score: KDA ×1, assistsPerDeath ×3, visionPerDeath ×3, controlWardsAvg ×2
//   New sources: 'kda', 'assists_per_min/deaths', 'control_wards_per_game'

// Helper: safely read a JSON field from a record (works in both serve and migrate contexts)
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

migrate((app) => {
  // ── carry ──────────────────────────────────────────────────────────────────
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (carryRec) {
    const cfg = getConfig(carryRec)
    cfg.assumptions = {}
    cfg.metrics = [
      { key: 'kda',          source: 'kda',                  weight_points: 2, cap: null },
      { key: 'damPerDeath',  source: 'damage_per_min/deaths', weight_points: 5, cap: null },
      { key: 'goldPerDeath', source: 'gold_per_min/deaths',   weight_points: 3, cap: null },
      { key: 'csPerDeath',   source: 'cs_per_min/deaths',     weight_points: 1, cap: null },
      { key: 'killShare',    source: 'kill_share',            weight_points: 1, cap: null },
    ]
    carryRec.set('config', cfg)
    app.save(carryRec)
  }

  // ── assassino ──────────────────────────────────────────────────────────────
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

  // ── bruiser ────────────────────────────────────────────────────────────────
  const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
  if (bruiserRec) {
    const cfg = getConfig(bruiserRec)
    cfg.assumptions = {}
    cfg.metrics = [
      { key: 'kda',          source: 'kda',                                        weight_points: 1, cap: null },
      { key: 'damPerDmgRec', source: 'damage_per_min/damage_taken_per_min',        weight_points: 3, cap: null },
      { key: 'damPerDeath',  source: 'damage_per_min/deaths',                      weight_points: 1, cap: null },
      { key: 'goldPerDeath', source: 'gold_per_min/deaths',                        weight_points: 1, cap: null },
    ]
    bruiserRec.set('config', cfg)
    app.save(bruiserRec)
  }

  // ── tank ───────────────────────────────────────────────────────────────────
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

  // ── suporte ────────────────────────────────────────────────────────────────
  const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
  if (suporteRec) {
    const cfg = getConfig(suporteRec)
    cfg.assumptions = {}
    cfg.metrics = [
      { key: 'kda',             source: 'kda',                       weight_points: 1, cap: null },
      { key: 'assistsPerDeath', source: 'assists_per_min/deaths',    weight_points: 3, cap: null },
      { key: 'visionPerDeath',  source: 'vision_score_per_min/deaths', weight_points: 3, cap: null },
      { key: 'controlWardsAvg', source: 'control_wards_per_game',    weight_points: 2, cap: null },
    ]
    suporteRec.set('config', cfg)
    app.save(suporteRec)
  }

}, (app) => {
  // ── Rollback — restore previous metrics arrays ─────────────────────────────
  try {
    const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
    if (carryRec) {
      const cfg = getConfig(carryRec)
      cfg.assumptions = {}
      cfg.metrics = [
        { key: 'damPerDeath',  source: 'damage_per_min/deaths', weight_points: 5, cap: 20000 },
        { key: 'goldPerDeath', source: 'gold_per_min/deaths',   weight_points: 3, cap: null  },
        { key: 'killsPerDeath',source: 'kills_per_game/deaths', weight_points: 2, cap: 10    },
        { key: 'csMin',        source: 'cs_per_min',            weight_points: 1, cap: null  },
        { key: 'killShare',    source: 'kill_share',            weight_points: 1, cap: null  },
      ]
      carryRec.set('config', cfg)
      app.save(carryRec)
    }

    const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
    if (assassinoRec) {
      const cfg = getConfig(assassinoRec)
      cfg.assumptions = {}
      cfg.metrics = [
        { key: 'killsPerDeath', source: 'kills_per_game/deaths', weight_points: 4, cap: 10    },
        { key: 'damPerDeath',   source: 'damage_per_min/deaths', weight_points: 2, cap: 20000 },
        { key: 'goldMin',       source: 'gold_per_min',          weight_points: 1, cap: null  },
        { key: 'killShare',     source: 'kill_share',            weight_points: 1, cap: null  },
      ]
      assassinoRec.set('config', cfg)
      app.save(assassinoRec)
    }

    const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
    if (bruiserRec) {
      const cfg = getConfig(bruiserRec)
      cfg.assumptions = {}
      cfg.metrics = [
        { key: 'damPerDeath',  source: 'damage_per_min/deaths', weight_points: 4, cap: 20000 },
        { key: 'goldPerDeath', source: 'gold_per_min/deaths',   weight_points: 2, cap: null  },
      ]
      bruiserRec.set('config', cfg)
      app.save(bruiserRec)
    }

    const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
    if (tankRec) {
      const cfg = getConfig(tankRec)
      cfg.assumptions = {}
      cfg.metrics = [
        { key: 'mitMin', source: 'damage_mitigated_per_min', weight_points: 4, cap: null },
        { key: 'dtMin',  source: 'damage_taken_per_min',     weight_points: 2, cap: null },
        { key: 'ccMin',  source: 'cc_per_min',               weight_points: 1, cap: null },
      ]
      tankRec.set('config', cfg)
      app.save(tankRec)
    }

    const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
    if (suporteRec) {
      const cfg = getConfig(suporteRec)
      cfg.assumptions = {}
      cfg.metrics = [
        { key: 'assistsPerDeath',      source: 'assists_per_game/deaths',    weight_points: 2, cap: 10 },
        { key: 'visionPerDeath',       source: 'vision_score_per_min/deaths', weight_points: 2, cap: 50 },
        { key: 'controlWardsPerDeath', source: 'control_wards/deaths',       weight_points: 1, cap: 50 },
        { key: 'wardsAndWKPerDeath',   source: 'wards_and_wk/deaths',        weight_points: 1, cap: 50 },
      ]
      suporteRec.set('config', cfg)
      app.save(suporteRec)
    }
  } catch (_) {}
})
