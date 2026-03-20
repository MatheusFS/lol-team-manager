/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const col = app.findCollectionByNameOrId("champions")
    col.fields.add(new Field({ type: "text",   name: "comp_type" }))  // Protect|Pick|Split|Siege|Engage|Mix
    col.fields.add(new Field({ type: "number", name: "early" }))      // 0=🔴 1=🟡 2=🟢
    col.fields.add(new Field({ type: "number", name: "mid" }))
    col.fields.add(new Field({ type: "number", name: "late" }))
    app.save(col)
}, (app) => {
    const col = app.findCollectionByNameOrId("champions")
    for (const f of ["comp_type", "early", "mid", "late"]) col.fields.removeByName(f)
    app.save(col)
})
