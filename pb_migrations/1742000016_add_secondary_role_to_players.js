/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = app.findCollectionByNameOrId("players")

    collection.fields.add(new Field({
        type: "select",
        name: "secondary_role",
        values: ["top", "jng", "mid", "adc", "sup"],
        maxSelect: 1,
    }))

    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("players")
    collection.fields.removeByName("secondary_role")
    app.save(collection)
})
