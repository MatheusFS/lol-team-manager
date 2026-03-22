/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const players   = app.findCollectionByNameOrId("players")
    const formations = app.findCollectionByNameOrId("formations")

    // Build name → id map from players
    const playerRecords = app.findRecordsByFilter("players", "", "", 200, 0)
    const nameToId = {}
    for (const p of playerRecords) {
        nameToId[p.getString("name")] = p.id
    }

    // Read existing string values before dropping the fields
    const formationRecords = app.findRecordsByFilter("formations", "", "", 500, 0)
    const backfill = {}
    for (const f of formationRecords) {
        backfill[f.id] = {
            top:     nameToId[f.getString("top")]     ?? "",
            jungle:  nameToId[f.getString("jungle")]  ?? "",
            mid:     nameToId[f.getString("mid")]     ?? "",
            adc:     nameToId[f.getString("adc")]     ?? "",
            support: nameToId[f.getString("support")] ?? "",
        }
    }

    // Remove select fields, add relation fields
    const ROLES = ["top", "jungle", "mid", "adc", "support"]
    for (const r of ROLES) formations.fields.removeByName(r)
    for (const r of ROLES) {
        formations.fields.add(new Field({
            type: "relation", name: r,
            collectionId: players.id, maxSelect: 1, required: true,
        }))
    }
    app.save(formations)

    // Write back the relation IDs
    for (const [fId, data] of Object.entries(backfill)) {
        try {
            const record = app.findRecordById("formations", fId)
            for (const r of ROLES) {
                if (data[r]) record.set(r, data[r])
            }
            app.save(record)
        } catch (e) {
            console.log("[migration 15] formation " + fId + ": " + e)
        }
    }
}, (app) => {
    // Rollback: restore select fields (stored IDs will be lost)
    const formations = app.findCollectionByNameOrId("formations")
    const ROLES   = ["top", "jungle", "mid", "adc", "support"]
    const PLAYERS = ["Klebão","GdN","Conkreto","Digo","Kelly","Pixek","Nunes","Eden","Xuao"]
    for (const r of ROLES) formations.fields.removeByName(r)
    for (const r of ROLES) {
        formations.fields.add(new Field({ type: "select", name: r, values: PLAYERS, maxSelect: 1, required: true }))
    }
    app.save(formations)
})
