/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = new Collection({
        name: "players",
        type: "base",
        fields: [
            {
                type: "text",
                name: "name",
                required: true,
            },
            {
                type: "select",
                name: "role",
                required: true,
                values: ["Top", "Jungle", "Mid", "ADC", "Support"],
                maxSelect: 1,
            },
            {
                type: "bool",
                name: "is_sub",
            },
        ],
    })
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("players")
    app.delete(collection)
})
