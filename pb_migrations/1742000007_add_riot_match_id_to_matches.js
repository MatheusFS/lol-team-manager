/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = app.findCollectionByNameOrId("matches")
    collection.fields.add(new Field({ type: "text", name: "riot_match_id" }))
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("matches")
    collection.fields.removeByName("riot_match_id")
    app.save(collection)
})
