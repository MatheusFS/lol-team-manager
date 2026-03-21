/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = app.findCollectionByNameOrId("players")

    collection.fields.add(new Field({
        type: "select",
        name: "secondary_role",
        values: ["Top", "Jungle", "Mid", "ADC", "Support"],
        maxSelect: 1,
    }))

    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("players")
    collection.fields.removeByName("secondary_role")
    app.save(collection)
})
