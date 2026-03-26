/// <reference path="../pb_data/types.d.ts" />

// Fix kill_participation values in the global benchmark record.
//
// PROBLEM:
//   Migration 009 renamed kill_share → kill_participation, but the stored values
//   [0.310, 0.312, 0.310, 0.307, 0.301, 0.302, 0.285, 0.273, 0.273, 0.268]
//   were originally kills/(kills+assists) — i.e. kill_secured semantics.
//
//   True Kill Participation = (kills + assists) / teamKills
//   Empirical KP values rise with rank (higher-rank players are more involved in kills).
//
// FIX:
//   Replace with correct empirical KP values [0.52 .. 0.70] per rank.
//
// Rank order: Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Challenger

// Helper: safely read a JSON field from a record
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

const OLD_KILL_PARTICIPATION = [0.310, 0.312, 0.310, 0.307, 0.301, 0.302, 0.285, 0.273, 0.273, 0.268]
const NEW_KILL_PARTICIPATION = [0.52,  0.54,  0.56,  0.58,  0.60,  0.62,  0.64,  0.66,  0.68,  0.70 ]

migrate((app) => {
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (!globalRec) return

  const cfg = getConfig(globalRec)
  const b = cfg.benchmarks ?? {}

  b.kill_participation = NEW_KILL_PARTICIPATION

  cfg.benchmarks = b
  globalRec.set('config', cfg)
  app.save(globalRec)

}, (app) => {
  // Rollback: restore old (wrong) kill_participation values
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (!globalRec) return

  try {
    const cfg = getConfig(globalRec)
    const b = cfg.benchmarks ?? {}

    b.kill_participation = OLD_KILL_PARTICIPATION

    cfg.benchmarks = b
    globalRec.set('config', cfg)
    app.save(globalRec)
  } catch (_) {}
})
