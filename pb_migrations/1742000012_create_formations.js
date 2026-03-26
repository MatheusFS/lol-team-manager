/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = new Collection({
        name: "formations",
        type: "base",
        listRule: "",
        viewRule: "",
        createRule: "",
        updateRule: "",
        deleteRule: "",
        fields: [
            {
                type: "text",
                name: "name",
                required: true,
            },
            {
                type: "select",
                name: "top",
                required: true,
                values: ["Klé","GdN","Vitão","Digo","Kelly","Pixek","Nunes","Eden","Xuao"],
                maxSelect: 1,
            },
            {
                type: "select",
                name: "jungle",
                required: true,
                values: ["Klé","GdN","Vitão","Digo","Kelly","Pixek","Nunes","Eden","Xuao"],
                maxSelect: 1,
            },
            {
                type: "select",
                name: "mid",
                required: true,
                values: ["Klé","GdN","Vitão","Digo","Kelly","Pixek","Nunes","Eden","Xuao"],
                maxSelect: 1,
            },
            {
                type: "select",
                name: "adc",
                required: true,
                values: ["Klé","GdN","Vitão","Digo","Kelly","Pixek","Nunes","Eden","Xuao"],
                maxSelect: 1,
            },
            {
                type: "select",
                name: "support",
                required: true,
                values: ["Klé","GdN","Vitão","Digo","Kelly","Pixek","Nunes","Eden","Xuao"],
                maxSelect: 1,
            },
            {
                type: "bool",
                name: "active",
            },
        ],
    })
    app.save(collection)
}, (app) => {
    const collection = app.findCollectionByNameOrId("formations")
    app.delete(collection)
})
