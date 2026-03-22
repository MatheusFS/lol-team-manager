/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const players = app.findCollectionByNameOrId("players")
    const matches = app.findCollectionByNameOrId("matches")

    // Build name → id map from players
    const playerRecords = app.findRecordsByFilter("players", "", "", 200, 0)
    const nameToId = {}
    for (const p of playerRecords) {
        nameToId[p.getString("name")] = p.id
    }

    // Read existing string values before dropping the fields
    const matchRecords = app.findRecordsByFilter("matches", "", "", 2000, 0)
    const backfill = {}
    for (const m of matchRecords) {
        backfill[m.id] = {
            top_player: nameToId[m.getString("top_player")] ?? "",
            mvp:        nameToId[m.getString("mvp")]        ?? "",
        }
    }

    // Remove select fields, add relation fields
    matches.fields.removeByName("top_player")
    matches.fields.removeByName("mvp")
    matches.fields.add(new Field({
        type: "relation", name: "top_player",
        collectionId: players.id, maxSelect: 1,
    }))
    matches.fields.add(new Field({
        type: "relation", name: "mvp",
        collectionId: players.id, maxSelect: 1,
    }))
    app.save(matches)

    // Write back the relation IDs
    for (const [matchId, data] of Object.entries(backfill)) {
        if (!data.top_player && !data.mvp) continue
        try {
            const record = app.findRecordById("matches", matchId)
            if (data.top_player) record.set("top_player", data.top_player)
            if (data.mvp)        record.set("mvp",        data.mvp)
            app.save(record)
        } catch (e) {
            console.log("[migration 14] match " + matchId + ": " + e)
        }
    }
}, (app) => {
    // Rollback: restore select fields (stored IDs will be lost)
    const matches = app.findCollectionByNameOrId("matches")
    matches.fields.removeByName("top_player")
    matches.fields.removeByName("mvp")
    const PLAYERS = ["Klebão","GdN","Conkreto","Digo","Kelly","Pixek","Nunes","Eden","Xuao"]
    matches.fields.add(new Field({ type: "select", name: "top_player", values: PLAYERS, maxSelect: 1 }))
    matches.fields.add(new Field({ type: "select", name: "mvp",        values: PLAYERS, maxSelect: 1 }))
    app.save(matches)
})
