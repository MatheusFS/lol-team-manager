/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const players   = app.findCollectionByNameOrId("players")
    const champions = app.findCollectionByNameOrId("champions")

    const collection = new Collection({
        name: "champion_pool",
        type: "base",
        fields: [
            {
                type: "relation", name: "player",
                required: true,
                collectionId: players.id, maxSelect: 1, cascadeDelete: true,
            },
            {
                type: "relation", name: "champion",
                required: true,
                collectionId: champions.id, maxSelect: 1,
            },
            {
                type: "select", name: "tier",
                required: true,
                values: ["star", "green", "yellow"], maxSelect: 1,
            },
        ],
    })
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("champion_pool")
    app.delete(collection)
})
