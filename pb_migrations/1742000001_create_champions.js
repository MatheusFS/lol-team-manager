/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = new Collection({
        name: "champions",
        type: "base",
        fields: [
            {
                type: "text",
                name: "name",   // e.g. "Jarvan IV"
                required: true,
            },
            {
                type: "text",
                name: "key",    // Riot Data Dragon key e.g. "JarvanIV" (used for image URLs)
                required: true,
            },
        ],
    })
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("champions")
    app.delete(collection)
})
