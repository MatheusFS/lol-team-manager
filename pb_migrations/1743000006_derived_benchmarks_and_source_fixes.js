/// <reference path="../pb_data/types.d.ts" />

// Adds derived global benchmark fields and fixes metric sources in all lenses.
//
// CHANGES:
//
// 1. Global benchmarks — two new derived fields:
//    assists_per_game[ri] = kda[ri] × deaths_per_game[ri] − kills_per_game[ri]
//    kill_share[ri]       = kills_per_game[ri] / (kills_per_game[ri] + assists_per_game[ri])
//
// 2. All lenses — metric source key fixes:
//    'damage_per_game/deaths' → 'damage_per_min/deaths'
//      Old: G.damage_per_game / G.deaths_per_game          (damage per death — wrong units)
//      New: G.damage_per_game / G.game_time_min / G.deaths_per_game  (damage/min per death)
//
//    'kills/deaths' → 'kills_per_game/deaths'
//      Old: getAssumption('kill_share') × G.kda             (proxy via assumption)
//      New: G.kills_per_game / G.deaths_per_game            (direct empirical field)
//
//    'assists/deaths' → 'assists_per_game/deaths'
//      Old: G.kda × (1 − getAssumption('kill_share'))       (proxy via assumption)
//      New: G.assists_per_game / G.deaths_per_game          (direct derived field)
//
//    'kill_share' source remains 'kill_share' but now reads G.kill_share[ri] (global field)
//      instead of getAssumption('kill_share') (scalar assumption).
//
// 3. carry, assassino, suporte — remove 'kill_share' from assumptions (no longer needed).

// Helper: safely read a JSON field from a record (works in both serve and migrate contexts)
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

migrate((app) => {
  // ── 1. Add derived fields to global benchmarks ─────────────────────────────
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (globalRec) {
    const cfg = getConfig(globalRec)
    // assists_per_game = kda × deaths_per_game − kills_per_game
    cfg.benchmarks.assists_per_game = [14.94, 15.18, 15.32, 15.37, 15.31, 15.04, 15.56, 15.44, 15.16, 15.29]
    // kill_share = kills / (kills + assists)
    cfg.benchmarks.kill_share       = [0.310, 0.312, 0.310, 0.307, 0.301, 0.302, 0.285, 0.273, 0.273, 0.268]
    globalRec.set('config', cfg)
    app.save(globalRec)
  }

  // ── Helper: remap source keys in a metrics array ───────────────────────────
  function fixSources(metrics) {
    return metrics.map(m => {
      let source = m.source
      if (source === 'damage_per_game/deaths') source = 'damage_per_min/deaths'
      if (source === 'kills/deaths')           source = 'kills_per_game/deaths'
      if (source === 'assists/deaths')         source = 'assists_per_game/deaths'
      // 'kill_share' stays 'kill_share' — now reads from global field, no change needed in source string
      return { ...m, source }
    })
  }

  // ── 2. carry — fix sources, remove kill_share assumption ───────────────────
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (carryRec) {
    const cfg = getConfig(carryRec)
    cfg.metrics = fixSources(cfg.metrics)
    if (cfg.assumptions) delete cfg.assumptions.kill_share
    carryRec.set('config', cfg)
    app.save(carryRec)
  }

  // ── 3. assassino — fix sources, remove kill_share assumption ───────────────
  const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
  if (assassinoRec) {
    const cfg = getConfig(assassinoRec)
    cfg.metrics = fixSources(cfg.metrics)
    if (cfg.assumptions) delete cfg.assumptions.kill_share
    assassinoRec.set('config', cfg)
    app.save(assassinoRec)
  }

  // ── 4. bruiser — fix sources (damPerDeath only) ────────────────────────────
  const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
  if (bruiserRec) {
    const cfg = getConfig(bruiserRec)
    cfg.metrics = fixSources(cfg.metrics)
    bruiserRec.set('config', cfg)
    app.save(bruiserRec)
  }

  // ── 5. suporte — fix sources, remove kill_share assumption ─────────────────
  const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
  if (suporteRec) {
    const cfg = getConfig(suporteRec)
    cfg.metrics = fixSources(cfg.metrics)
    if (cfg.assumptions) delete cfg.assumptions.kill_share
    suporteRec.set('config', cfg)
    app.save(suporteRec)
  }

  // ── 6. tank — fix sources (no damPerDeath, no assumptions — safe no-op fixSources) ──
  const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
  if (tankRec) {
    const cfg = getConfig(tankRec)
    cfg.metrics = fixSources(cfg.metrics)
    tankRec.set('config', cfg)
    app.save(tankRec)
  }

}, (app) => {
  // ── Rollback ───────────────────────────────────────────────────────────────
  try {
    // Remove derived global fields
    const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
    if (globalRec) {
      const cfg = getConfig(globalRec)
      delete cfg.benchmarks.assists_per_game
      delete cfg.benchmarks.kill_share
      globalRec.set('config', cfg)
      app.save(globalRec)
    }

    function revertSources(metrics) {
      return metrics.map(m => {
        let source = m.source
        if (source === 'damage_per_min/deaths')   source = 'damage_per_game/deaths'
        if (source === 'kills_per_game/deaths')   source = 'kills/deaths'
        if (source === 'assists_per_game/deaths') source = 'assists/deaths'
        return { ...m, source }
      })
    }

    const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
    if (carryRec) {
      const cfg = getConfig(carryRec)
      cfg.metrics = revertSources(cfg.metrics)
      cfg.assumptions = { ...cfg.assumptions, kill_share: 0.30 }
      carryRec.set('config', cfg)
      app.save(carryRec)
    }

    const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
    if (assassinoRec) {
      const cfg = getConfig(assassinoRec)
      cfg.metrics = revertSources(cfg.metrics)
      cfg.assumptions = { ...cfg.assumptions, kill_share: 0.27 }
      assassinoRec.set('config', cfg)
      app.save(assassinoRec)
    }

    const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
    if (bruiserRec) {
      const cfg = getConfig(bruiserRec)
      cfg.metrics = revertSources(cfg.metrics)
      bruiserRec.set('config', cfg)
      app.save(bruiserRec)
    }

    const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
    if (suporteRec) {
      const cfg = getConfig(suporteRec)
      cfg.metrics = revertSources(cfg.metrics)
      cfg.assumptions = { ...cfg.assumptions, kill_share: 0.08 }
      suporteRec.set('config', cfg)
      app.save(suporteRec)
    }

    const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
    if (tankRec) {
      const cfg = getConfig(tankRec)
      cfg.metrics = revertSources(cfg.metrics)
      tankRec.set('config', cfg)
      app.save(tankRec)
    }
  } catch (_) {}
})

// Adds derived global benchmark fields and fixes metric sources in all lenses.
//
// CHANGES:
//
// 1. Global benchmarks — two new derived fields:
//    assists_per_game[ri] = kda[ri] × deaths_per_game[ri] − kills_per_game[ri]
//    kill_share[ri]       = kills_per_game[ri] / (kills_per_game[ri] + assists_per_game[ri])
//
// 2. All lenses — metric source key fixes:
//    'damage_per_game/deaths' → 'damage_per_min/deaths'
//      Old: G.damage_per_game / G.deaths_per_game          (damage per death — wrong units)
//      New: G.damage_per_game / G.game_time_min / G.deaths_per_game  (damage/min per death)
//
//    'kills/deaths' → 'kills_per_game/deaths'
//      Old: getAssumption('kill_share') × G.kda             (proxy via assumption)
//      New: G.kills_per_game / G.deaths_per_game            (direct empirical field)
//
//    'assists/deaths' → 'assists_per_game/deaths'
//      Old: G.kda × (1 − getAssumption('kill_share'))       (proxy via assumption)
//      New: G.assists_per_game / G.deaths_per_game          (direct derived field)
//
//    'kill_share' source remains 'kill_share' but now reads G.kill_share[ri] (global field)
//      instead of getAssumption('kill_share') (scalar assumption).
//
// 3. carry, assassino, suporte — remove 'kill_share' from assumptions (no longer needed).

migrate((app) => {
  // ── 1. Add derived fields to global benchmarks ─────────────────────────────
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (globalRec) {
    const cfg = globalRec.get('config')
    // assists_per_game = kda × deaths_per_game − kills_per_game
    cfg.benchmarks.assists_per_game = [14.94, 15.18, 15.32, 15.37, 15.31, 15.04, 15.56, 15.44, 15.16, 15.29]
    // kill_share = kills / (kills + assists)
    cfg.benchmarks.kill_share       = [0.310, 0.312, 0.310, 0.307, 0.301, 0.302, 0.285, 0.273, 0.273, 0.268]
    globalRec.set('config', cfg)
    app.save(globalRec)
  }

  // ── Helper: remap source keys in a metrics array ───────────────────────────
  function fixSources(metrics) {
    return metrics.map(m => {
      let source = m.source
      if (source === 'damage_per_game/deaths') source = 'damage_per_min/deaths'
      if (source === 'kills/deaths')           source = 'kills_per_game/deaths'
      if (source === 'assists/deaths')         source = 'assists_per_game/deaths'
      // 'kill_share' stays 'kill_share' — now reads from global field, no change needed in source string
      return { ...m, source }
    })
  }

  // ── 2. carry — fix sources, remove kill_share assumption ───────────────────
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (carryRec) {
    const cfg = carryRec.get('config')
    cfg.metrics = fixSources(cfg.metrics)
    delete cfg.assumptions?.kill_share
    carryRec.set('config', cfg)
    app.save(carryRec)
  }

  // ── 3. assassino — fix sources, remove kill_share assumption ───────────────
  const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
  if (assassinoRec) {
    const cfg = assassinoRec.get('config')
    cfg.metrics = fixSources(cfg.metrics)
    delete cfg.assumptions?.kill_share
    assassinoRec.set('config', cfg)
    app.save(assassinoRec)
  }

  // ── 4. bruiser — fix sources (damPerDeath only) ────────────────────────────
  const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
  if (bruiserRec) {
    const cfg = bruiserRec.get('config')
    cfg.metrics = fixSources(cfg.metrics)
    bruiserRec.set('config', cfg)
    app.save(bruiserRec)
  }

  // ── 5. suporte — fix sources, remove kill_share assumption ─────────────────
  const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
  if (suporteRec) {
    const cfg = suporteRec.get('config')
    cfg.metrics = fixSources(cfg.metrics)
    delete cfg.assumptions?.kill_share
    suporteRec.set('config', cfg)
    app.save(suporteRec)
  }

  // ── 6. tank — fix sources (no damPerDeath, no assumptions — safe no-op fixSources) ──
  const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
  if (tankRec) {
    const cfg = tankRec.get('config')
    cfg.metrics = fixSources(cfg.metrics)
    tankRec.set('config', cfg)
    app.save(tankRec)
  }

}, (app) => {
  // ── Rollback ───────────────────────────────────────────────────────────────
  try {
    // Remove derived global fields
    const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
    if (globalRec) {
      const cfg = globalRec.get('config')
      delete cfg.benchmarks.assists_per_game
      delete cfg.benchmarks.kill_share
      globalRec.set('config', cfg)
      app.save(globalRec)
    }

    function revertSources(metrics) {
      return metrics.map(m => {
        let source = m.source
        if (source === 'damage_per_min/deaths')   source = 'damage_per_game/deaths'
        if (source === 'kills_per_game/deaths')   source = 'kills/deaths'
        if (source === 'assists_per_game/deaths') source = 'assists/deaths'
        return { ...m, source }
      })
    }

    const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
    if (carryRec) {
      const cfg = carryRec.get('config')
      cfg.metrics = revertSources(cfg.metrics)
      cfg.assumptions = { ...cfg.assumptions, kill_share: 0.30 }
      carryRec.set('config', cfg)
      app.save(carryRec)
    }

    const assassinoRec = app.findRecordsByFilter('rank_config', `name = 'assassino'`)[0]
    if (assassinoRec) {
      const cfg = assassinoRec.get('config')
      cfg.metrics = revertSources(cfg.metrics)
      cfg.assumptions = { ...cfg.assumptions, kill_share: 0.27 }
      assassinoRec.set('config', cfg)
      app.save(assassinoRec)
    }

    const bruiserRec = app.findRecordsByFilter('rank_config', `name = 'bruiser'`)[0]
    if (bruiserRec) {
      const cfg = bruiserRec.get('config')
      cfg.metrics = revertSources(cfg.metrics)
      bruiserRec.set('config', cfg)
      app.save(bruiserRec)
    }

    const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
    if (suporteRec) {
      const cfg = suporteRec.get('config')
      cfg.metrics = revertSources(cfg.metrics)
      cfg.assumptions = { ...cfg.assumptions, kill_share: 0.08 }
      suporteRec.set('config', cfg)
      app.save(suporteRec)
    }

    const tankRec = app.findRecordsByFilter('rank_config', `name = 'tank'`)[0]
    if (tankRec) {
      const cfg = tankRec.get('config')
      cfg.metrics = revertSources(cfg.metrics)
      tankRec.set('config', cfg)
      app.save(tankRec)
    }
  } catch (_) {}
})
