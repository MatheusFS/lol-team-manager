/// <reference path="../pb_data/types.d.ts" />
// Opens all collections for unauthenticated access.
// This app is an internal team tool with no public exposure — adjust if that changes.
migrate((app) => {
    for (const name of ["players", "champions", "matches", "champion_pool"]) {
        const c = app.findCollectionByNameOrId(name)
        c.listRule   = ""
        c.viewRule   = ""
        c.createRule = ""
        c.updateRule = ""
        c.deleteRule = ""
        app.save(c)
    }
}, (app) => {
    for (const name of ["players", "champions", "matches", "champion_pool"]) {
        const c = app.findCollectionByNameOrId(name)
        c.listRule   = null
        c.viewRule   = null
        c.createRule = null
        c.updateRule = null
        c.deleteRule = null
        app.save(c)
    }
})
