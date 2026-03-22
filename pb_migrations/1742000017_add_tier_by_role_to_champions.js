/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const col = app.findCollectionByNameOrId("champions")
    col.fields.add(new Field({
        type: "json",
        name: "tier_by_role",
    }))
    app.save(col)
}, (app) => {
    const col = app.findCollectionByNameOrId("champions")
    col.fields.removeByName("tier_by_role")
    app.save(col)
})
