/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const champions = app.findCollectionByNameOrId("champions")

    const PLAYERS = [
        "Klé", "GdN", "Vitão", "Digo", "Kelly",
        "Pixek", "Nunes", "Eden", "Xuao",
    ]

    const collection = new Collection({
        name: "matches",
        type: "base",
        fields: [
            // Core
            { type: "date",   name: "date",      required: true },
            { type: "number", name: "game_n",     required: true, onlyInt: true },
            { type: "bool",   name: "win",        required: true },

            // Context
            { type: "select", name: "side",        values: ["Red", "Blue"], maxSelect: 1 },
            { type: "select", name: "top_player",  values: PLAYERS, maxSelect: 1 },

            // Draft
            { type: "json", name: "our_champs" },    // ["Riven", "Volibear", ...]
            { type: "json", name: "enemy_champs" },  // ["Vladimir", "Xin Zhao", ...]

            // Our strategy
            {
                type: "select", name: "comp_type",
                values: ["Protect", "Pick", "Split", "Siege", "Engage", "Mix"], maxSelect: 1,
            },
            {
                // Compound subtypes split into atoms e.g. "Pick-Dive" → ["Pick","Dive"]
                type: "select", name: "comp_subtype",
                values: ["Siege", "Protect", "Engage", "Split", "Pick", "Dive", "Reset", "Mix"],
                maxSelect: 4,
            },
            { type: "text", name: "scaling" },

            // Enemy strategy
            {
                type: "select", name: "enemy_type",
                values: ["Protect", "Pick", "Split", "Siege", "Engage", "Mix"], maxSelect: 1,
            },
            { type: "text", name: "enemy_scaling" },

            // Match summary
            { type: "number", name: "duration",    onlyInt: true }, // minutes
            { type: "select", name: "mvp",         values: PLAYERS, maxSelect: 1 },
            {
                type: "relation", name: "mvc",
                collectionId: champions.id, maxSelect: 1,
            },
            { type: "number", name: "team_kills",  onlyInt: true },
            { type: "number", name: "team_deaths", onlyInt: true },

            // Gold metrics
            { type: "number", name: "gd_10" },       // gold diff at 10 min
            { type: "number", name: "gd_20" },       // gold diff at 20 min
            { type: "number", name: "gd_f" },        // gold diff at end
            { type: "number", name: "total_gold" },  // GT — total gold earned
            { type: "number", name: "gold_per_min" },

            // Performance
            { type: "number", name: "damage" },
            { type: "number", name: "da_di" },       // damage dealt / damage taken ratio
            { type: "number", name: "wards_per_min" },

            // Objectives: tower/voidgrub/riftherald/dragon/baron/inhibitor/nexus
            { type: "text", name: "obj_flow" },
        ],
    })
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("matches")
    app.delete(collection)
})
