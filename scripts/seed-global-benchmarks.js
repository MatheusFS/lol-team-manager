#!/usr/bin/env node
// seed-global-benchmarks.js
//
// Pushes empirical 10-rank global benchmark data into PocketBase's rank_config collection.
// Data sourced from league tracking site images (session memory — confirmed values).
//
// Usage:
//   node scripts/seed-global-benchmarks.js
//
// Requirements:
//   - PocketBase running at http://127.0.0.1:8090
//   - Node 18+ (uses built-in fetch)
//   - rank_config collection must already exist (run PocketBase migrations first)

const PB = 'http://127.0.0.1:8090'

// ── Empirical 10-rank benchmark data ─────────────────────────────────────────
// Rank order (index 0–9): Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Challenger
//
// Sources:
//   kills_per_game, deaths_per_game, kda, game_time_min, control_wards_placed → direct from tracking site images
//   damage_per_game → interpolated: anchored at Bronze=12K, Gold=16.5K, Emerald=21K, Master=25K
//   kill_participation → empirical (kills+assists)/teamKills per rank [0.52..0.70], rising with rank
//
//   gold_per_game     → derived: gold_per_min × game_time_min
//                       gold_per_min: [366.5, 394.0, 405.3, 409.8, 413.1, 416.1, 417.7, 423.8, 431.8, 442.2]
//
//   cs_per_game           → derived: cs_per_min × game_time_min
//   vision_score_per_game → derived: vision_score_per_min × game_time_min
//   damage_taken_per_game → derived: damage_taken_per_min × game_time_min
//   damage_mitigated_per_game → derived: damage_mitigated_per_min × game_time_min
//   cc_per_game           → derived: cc_per_min × game_time_min
//
//   wards_and_wk_per_game → estimated from old 4-tier anchors B=6, A=10, G=14, P=20 (smoothed)
//
// Runtime-derived (NOT stored, computed in JS from per_game / game_time_min):
//   gold_per_min, cs_per_min, vision_score_per_min,
//   damage_taken_per_min, damage_mitigated_per_min, cc_per_min
//
// Also runtime-derived:
//   assists_per_game = kda × deaths_per_game − kills_per_game
//   kill_secured     = kills_per_game / (kills_per_game + assists_per_game)

const BENCHMARKS = {
  // Rank:                          I        B        S        G        P        E        D        M        GM       C
  kills_per_game:           [  6.7,     6.9,     6.9,     6.8,     6.6,     6.5,     6.2,     5.8,     5.7,     5.6   ],
  deaths_per_game:          [  6.7,     6.9,     6.9,     6.8,     6.6,     6.5,     6.2,     5.9,     5.7,     5.6   ],
  kda:                      [ 3.23,    3.20,    3.22,    3.26,    3.32,    3.39,    3.51,    3.60,    3.66,    3.73   ],
  kill_participation:       [ 0.52,    0.54,    0.56,    0.58,    0.60,    0.62,    0.64,    0.66,    0.68,    0.70  ],
  game_time_min:            [30.62,   31.07,   31.20,   30.97,   30.55,   29.97,   29.07,   27.87,   27.38,   27.07  ],
  damage_per_game:          [ 9000,   12000,   14250,   16500,   18300,   21000,   22600,   25000,   26333,   27667  ],
  // per_game = per_min × game_time_min (original per_min values in comment above)
  gold_per_game:            [11222.2, 12241.6, 12645.4, 12691.5, 12620.2, 12470.5, 12142.5, 11811.3, 11822.7, 11970.4],
  cs_per_game:              [147.6,   155.0,   164.4,   170.3,   173.5,   175.0,   173.5,   170.8,   169.5,   169.7  ],
  vision_score_per_game:    [ 26.9,    29.5,    32.1,    33.8,    34.2,    34.5,    34.3,    33.7,    34.2,    34.9   ],
  damage_taken_per_game:    [25108.4, 26720.2, 28080.0, 27253.6, 25662.0, 23976.0, 21802.5, 19509.0, 18070.8, 16783.4],
  damage_mitigated_per_game:[5511.6,  6214.0,  7176.0,  8052.2,  8859.5,  9590.4, 10465.2, 11148.0, 12047.2, 12993.6],
  cc_per_game:              [  27.6,    31.1,    37.4,    43.4,    48.9,    53.9,    61.0,    66.9,    73.9,    81.2  ],
  control_wards_placed:     [  0.61,    0.77,    1.05,    1.31,    1.50,    1.66,    1.90,    1.99,    2.19,    2.41  ],
  wards_and_wk_per_game:    [     5,       6,       8,      10,      12,      14,      16,      18,      20,      22  ],
}

async function main() {
  // 1. Find the 'global' rank_config record
  console.log(`Connecting to PocketBase at ${PB}...`)

  let globalRecord
  try {
    const res = await fetch(
      `${PB}/api/collections/rank_config/records?filter=name%3D'global'&perPage=1`,
      { headers: { 'Content-Type': 'application/json' } }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GET failed (${res.status}): ${text}`)
    }
    const data = await res.json()
    if (!data.items?.length) {
      throw new Error(`No 'global' record found in rank_config collection.\nRun PocketBase migrations first: ./pocketbase migrate`)
    }
    globalRecord = data.items[0]
  } catch (err) {
    console.error(`\n❌ Failed to fetch rank_config records:\n   ${err.message}`)
    console.error(`\n   Is PocketBase running? Try: ./pocketbase serve`)
    process.exit(1)
  }

  console.log(`Found global record: ${globalRecord.id}`)

  // Show current field count for verification
  const currentBenchmarks = globalRecord.config?.benchmarks ?? {}
  const currentKeys = Object.keys(currentBenchmarks)
  console.log(`Current benchmark fields (${currentKeys.length}): ${currentKeys.join(', ')}`)

  // 2. PATCH with new benchmark data (merge with existing config to preserve structure)
  const newConfig = {
    ...globalRecord.config,
    benchmarks: BENCHMARKS,
  }

  try {
    const res = await fetch(
      `${PB}/api/collections/rank_config/records/${globalRecord.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: newConfig }),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`PATCH failed (${res.status}): ${text}`)
    }
    const updated = await res.json()
    const updatedKeys = Object.keys(updated.config?.benchmarks ?? {})
    console.log(`\n✓ Global benchmarks updated successfully`)
    console.log(`  Updated fields (${updatedKeys.length}): ${updatedKeys.join(', ')}`)
    console.log(`\n  Rank order: Iron, Bronze, Silver, Gold, Platinum, Emerald, Diamond, Master, Grandmaster, Challenger`)
    console.log(`  Anchor for identity rank derivation: Platinum (index 4)`)
  } catch (err) {
    console.error(`\n❌ Failed to update global benchmarks:\n   ${err.message}`)
    process.exit(1)
  }
}

main()
