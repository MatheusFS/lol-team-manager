/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    const collection = app.findCollectionByNameOrId("players")

    collection.fields.add(new Field({ type: "text", name: "riot_id" }))  // e.g. "GdN#MFS"
    collection.fields.add(new Field({ type: "text", name: "puuid"   }))  // cached from Riot API
    app.save(collection)

    // Seed riot_id for the 9 existing players
    const RIOT_IDS = {
        'GdN':      'GdN#MFS',
        'Klé':      'Kerido#ADTR',
        'Digo':     'NOT OK#rdz',
        'Vitão':    'Conkreto#N64',
        'Kelly':    'KellyOhana#FLA',
        'Pixek':    'Worst Player TFT#001',
        'Eden':     'EI DIIGTO RPADIO#EVDD',
        'Nunes':    'Nunes#7778',
        'Xuao':     'talk talk#xuauz',
    }

    const players = app.findAllRecords("players")
    for (const p of players) {
        const riotId = RIOT_IDS[p.get("name")]
        if (riotId) {
            p.set("riot_id", riotId)
            app.save(p)
        }
    }
}, (app) => {
    const collection = app.findCollectionByNameOrId("players")
    collection.fields.removeByName("riot_id")
    collection.fields.removeByName("puuid")
    app.save(collection)
})
