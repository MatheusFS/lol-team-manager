/// <reference path="../pb_data/types.d.ts" />

// Rename global benchmark fields and fix kill metric semantics.
//
// CHANGES:
//
// global record (benchmarks):
//   - Remove 'kill_share'     (was kills/(kills+assists) — now computed in runtime JS)
//   - Remove 'assists_per_game' (now derived at runtime: kda × deaths − kills)
//   - Add    'kill_participation' with empirical values [0.310, 0.312, ...] (kills/teamKills by rank)
//
// carry lens:
//   - Metric 'killShare' source: 'kill_share' → 'kill_participation'
//   - Key rename: 'killShare' → 'killParticipation'

// Helper: safely read a JSON field from a record (works in both serve and migrate contexts)
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

migrate((app) => {
  // ── global benchmarks ──────────────────────────────────────────────────────
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (globalRec) {
    const cfg = getConfig(globalRec)
    const b = cfg.benchmarks ?? {}

    // Remove derived fields (now computed in runtime JS)
    delete b.kill_share
    delete b.assists_per_game

    // Add empirical kill_participation (kills/teamKills — different from kill_share)
    b.kill_participation = [0.310, 0.312, 0.310, 0.307, 0.301, 0.302, 0.285, 0.273, 0.273, 0.268]

    cfg.benchmarks = b
    globalRec.set('config', cfg)
    app.save(globalRec)
  }

  // ── carry lens: rename kill_share → kill_participation ────────────────────
  const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
  if (carryRec) {
    const cfg = getConfig(carryRec)
    if (cfg.metrics) {
      cfg.metrics = cfg.metrics.map(m => {
        if (m.source === 'kill_share') {
          return { ...m, key: 'killParticipation', source: 'kill_participation' }
        }
        return m
      })
    }
    carryRec.set('config', cfg)
    app.save(carryRec)
  }

}, (app) => {
  // ── Rollback ───────────────────────────────────────────────────────────────
  try {
    const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
    if (globalRec) {
      const cfg = getConfig(globalRec)
      const b = cfg.benchmarks ?? {}

      // Remove kill_participation
      delete b.kill_participation

      // Restore derived fields
      const kills   = b.kills_per_game    ?? [6.7,6.9,6.9,6.8,6.6,6.5,6.2,5.8,5.7,5.6]
      const deaths  = b.deaths_per_game   ?? [6.7,6.9,6.9,6.8,6.6,6.5,6.2,5.9,5.7,5.6]
      const kda     = b.kda               ?? [3.23,3.20,3.22,3.26,3.32,3.39,3.51,3.60,3.66,3.73]
      b.assists_per_game = kda.map((k, i) => Math.round((k * deaths[i] - kills[i]) * 100) / 100)
      b.kill_share = kills.map((k, i) => {
        const a = b.assists_per_game[i]
        return Math.round(k / (k + a) * 1000) / 1000
      })

      cfg.benchmarks = b
      globalRec.set('config', cfg)
      app.save(globalRec)
    }

    const carryRec = app.findRecordsByFilter('rank_config', `name = 'carry'`)[0]
    if (carryRec) {
      const cfg = getConfig(carryRec)
      if (cfg.metrics) {
        cfg.metrics = cfg.metrics.map(m => {
          if (m.source === 'kill_participation') {
            return { ...m, key: 'killShare', source: 'kill_share' }
          }
          return m
        })
      }
      carryRec.set('config', cfg)
      app.save(carryRec)
    }
  } catch (_) {}
})
