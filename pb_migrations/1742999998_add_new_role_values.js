/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // First: Modify role field to include new values (keeping old ones temporarily)
    const collection = app.findCollectionByNameOrId("players")
    
    // Remove existing role field
    collection.fields.removeByName("role")
    
    // Add new role field with both old and new values
    collection.fields.add(new Field({
        type: "select",
        name: "role",
        required: true,
        values: ["Top", "Jungle", "Mid", "ADC", "Support", "top", "jng", "mid", "adc", "sup"],
        maxSelect: 1,
    }))
    
    // Remove existing secondary_role field
    collection.fields.removeByName("secondary_role")
    
    // Add new secondary_role field with both old and new values
    collection.fields.add(new Field({
        type: "select",
        name: "secondary_role",
        values: ["Top", "Jungle", "Mid", "ADC", "Support", "top", "jng", "mid", "adc", "sup"],
        maxSelect: 1,
    }))
    
    app.save(collection)
}, (app) => {
    // Rollback: Keep only old values
    const collection = app.findCollectionByNameOrId("players")
    
    collection.fields.removeByName("role")
    collection.fields.add(new Field({
        type: "select",
        name: "role",
        required: true,
        values: ["Top", "Jungle", "Mid", "ADC", "Support"],
        maxSelect: 1,
    }))
    
    collection.fields.removeByName("secondary_role")
    collection.fields.add(new Field({
        type: "select",
        name: "secondary_role",
        values: ["Top", "Jungle", "Mid", "ADC", "Support"],
        maxSelect: 1,
    }))
    
    app.save(collection)
})
