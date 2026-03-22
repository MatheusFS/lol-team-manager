/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const col = app.findCollectionByNameOrId("champions")
    col.fields.add(new Field({ type: "text",   name: "comp_type" }))
    col.fields.add(new Field({ type: "number", name: "early" }))
    col.fields.add(new Field({ type: "number", name: "mid" }))
    col.fields.add(new Field({ type: "number", name: "late" }))
    app.save(col)
}, (app) => {
    const col = app.findCollectionByNameOrId("champions")
    for (const f of ["comp_type", "early", "mid", "late"]) col.fields.removeByName(f)
    app.save(col)
})
