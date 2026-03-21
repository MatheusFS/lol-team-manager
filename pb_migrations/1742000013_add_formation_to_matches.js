/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const formations = app.findCollectionByNameOrId("formations")
    const matches = app.findCollectionByNameOrId("matches")
    matches.fields.add(new Field({
        type: "relation",
        name: "formation",
        collectionId: formations.id,
        maxSelect: 1,
    }))
    app.save(matches)
}, (app) => {
    const matches = app.findCollectionByNameOrId("matches")
    matches.fields.removeByName("formation")
    app.save(matches)
})
