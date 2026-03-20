/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const col = app.findCollectionByNameOrId("matches")
    col.fields.add(new Field({ type: "json",   name: "riot_match_snapshot" }))
    col.fields.add(new Field({ type: "json",   name: "player_stats" }))
    col.fields.add(new Field({ type: "number", name: "team_assists" }))
    col.fields.add(new Field({ type: "number", name: "vision_score" }))
    col.fields.add(new Field({ type: "number", name: "cs_total" }))
    col.fields.add(new Field({ type: "number", name: "cs_per_min" }))
    col.fields.add(new Field({ type: "bool",   name: "first_blood" }))
    col.fields.add(new Field({ type: "bool",   name: "first_tower" }))
    app.save(col)
}, (app) => {
    const col = app.findCollectionByNameOrId("matches")
    for (const f of ["riot_match_snapshot", "player_stats", "team_assists",
                     "vision_score", "cs_total", "cs_per_min", "first_blood", "first_tower"]) {
        col.fields.removeByName(f)
    }
    app.save(col)
})
