/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const col = app.findCollectionByNameOrId("champions")
    col.fields.add(new Field({ type: "text", name: "class" }))        // DDragon primary tag
    col.fields.add(new Field({ type: "json", name: "roles" }))        // ["Top","Jungle"]
    col.fields.add(new Field({ type: "text", name: "damage_type" }))  // AD_high|AD_low|AP_high|AP_low|Mixed
    col.fields.add(new Field({ type: "text", name: "tier" }))         // S|A|B|C|D
    col.fields.add(new Field({ type: "text", name: "patch" }))        // DDragon version
    col.fields.add(new Field({ type: "json", name: "suggested" }))    // auto-generated blob
    col.fields.add(new Field({ type: "json", name: "overrides" }))    // manual edits blob
    app.save(col)
}, (app) => {
    const col = app.findCollectionByNameOrId("champions")
    for (const f of ["class", "roles", "damage_type", "tier", "patch", "suggested", "overrides"])
        col.fields.removeByName(f)
    app.save(col)
})
