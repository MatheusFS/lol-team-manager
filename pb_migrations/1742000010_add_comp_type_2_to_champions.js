/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const col = app.findCollectionByNameOrId("champions")
    col.fields.add(new Field({ type: "text", name: "comp_type_2" }))
    app.save(col)
}, (app) => {
    const col = app.findCollectionByNameOrId("champions")
    col.fields.removeByName("comp_type_2")
    app.save(col)
})
