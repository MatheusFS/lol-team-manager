/// <reference path="../pb_data/types.d.ts" />
// PocketBase treats required:true on a bool field as "must be truthy",
// which rejects false. Remove required so false is a valid value.
migrate((app) => {
    const collection = app.findCollectionByNameOrId("matches")
    for (const field of collection.fields) {
        if (field.name === "win") {
            field.required = false
            break
        }
    }
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("matches")
    for (const field of collection.fields) {
        if (field.name === "win") {
            field.required = true
            break
        }
    }
    app.save(collection)
})
