/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // Final step: Remove old role values from enum, keep only new ones
    const collection = app.findCollectionByNameOrId("players")
    
    collection.fields.removeByName("role")
    collection.fields.add(new Field({
        type: "select",
        name: "role",
        required: true,
        values: ["top", "jng", "mid", "adc", "sup"],
        maxSelect: 1,
    }))
    
    collection.fields.removeByName("secondary_role")
    collection.fields.add(new Field({
        type: "select",
        name: "secondary_role",
        values: ["top", "jng", "mid", "adc", "sup"],
        maxSelect: 1,
    }))
    
    app.save(collection)
}, (app) => {
    // Rollback: Add back both old and new values
    const collection = app.findCollectionByNameOrId("players")
    
    collection.fields.removeByName("role")
    collection.fields.add(new Field({
        type: "select",
        name: "role",
        required: true,
        values: ["Top", "Jungle", "Mid", "ADC", "Support", "top", "jng", "mid", "adc", "sup"],
        maxSelect: 1,
    }))
    
    collection.fields.removeByName("secondary_role")
    collection.fields.add(new Field({
        type: "select",
        name: "secondary_role",
        values: ["Top", "Jungle", "Mid", "ADC", "Support", "top", "jng", "mid", "adc", "sup"],
        maxSelect: 1,
    }))
    
    app.save(collection)
})
