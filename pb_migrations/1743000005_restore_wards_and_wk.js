/// <reference path="../pb_data/types.d.ts" />

// Adds wards_and_wk_per_game to global benchmarks and restores wardsAndWKPerDeath
// to the suporte lens (alongside the controlWardsPerDeath added in migration 004).
//
// wards_and_wk_per_game = wardsPlaced + wardsKilled×10 per game (combined vision metric).
// This is a different signal from controlWardsPerDeath:
//   controlWardsPerDeath   → only control ward purchases (deliberate spending)
//   wardsAndWKPerDeath     → total vision work: all wards placed + ward denial (wardsKilled×10)
//
// Values estimated from 4-tier anchors B=6, A=10, G=14, P=20, smoothed to 10 ranks:
//   [Iron=5, Bronze=6, Silver=8, Gold=10, Platinum=12, Emerald=14, Diamond=16, Master=18, GM=20, Challenger=22]

// Helper: safely read a JSON field from a record (works in both serve and migrate contexts)
function getConfig(rec) {
  const raw = rec.getString('config')
  return raw ? JSON.parse(raw) : {}
}

migrate((app) => {
  // ── Add wards_and_wk_per_game to global benchmarks ────────────────────────
  const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
  if (globalRec) {
    const cfg = getConfig(globalRec)
    cfg.benchmarks.wards_and_wk_per_game = [5, 6, 8, 10, 12, 14, 16, 18, 20, 22]
    globalRec.set('config', cfg)
    app.save(globalRec)
  }

  // ── Restore wardsAndWKPerDeath in suporte lens ─────────────────────────────
  const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
  if (suporteRec) {
    const cfg = getConfig(suporteRec)
    // Add wardsAndWKPerDeath after controlWardsPerDeath (keep existing metrics intact)
    cfg.metrics.push({
      key: 'wardsAndWKPerDeath',
      source: 'wards_and_wk/deaths',
      weight_points: 1,
      cap: 50,
    })
    suporteRec.set('config', cfg)
    app.save(suporteRec)
  }

}, (app) => {
  // ── Rollback ───────────────────────────────────────────────────────────────
  try {
    const globalRec = app.findRecordsByFilter('rank_config', `name = 'global'`)[0]
    if (globalRec) {
      const cfg = getConfig(globalRec)
      delete cfg.benchmarks.wards_and_wk_per_game
      globalRec.set('config', cfg)
      app.save(globalRec)
    }

    const suporteRec = app.findRecordsByFilter('rank_config', `name = 'suporte'`)[0]
    if (suporteRec) {
      const cfg = getConfig(suporteRec)
      cfg.metrics = cfg.metrics.filter(m => m.key !== 'wardsAndWKPerDeath')
      suporteRec.set('config', cfg)
      app.save(suporteRec)
    }
  } catch (_) {}
})
