/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // Migration to update existing role values from Title-case to lowercase short forms
    // Top → top, Jungle → jng, Mid → mid, ADC → adc, Support → sup
    // Assumes new enum values already exist from migration 1742999998
    
    const roleMap = {
        "Top": "top",
        "Jungle": "jng",
        "Mid": "mid",
        "ADC": "adc",
        "Support": "sup"
    }

    // Update players.role
    const playerRecords = app.findRecordsByFilter("players", "")
    for (const record of playerRecords) {
        if (record.get("role") && roleMap[record.get("role")]) {
            record.set("role", roleMap[record.get("role")])
            app.save(record)
        }
        if (record.get("secondary_role") && roleMap[record.get("secondary_role")]) {
            record.set("secondary_role", roleMap[record.get("secondary_role")])
            app.save(record)
        }
    }

    // Update champions.roles (JSON array field)
    const champRecords = app.findRecordsByFilter("champions", "")
    for (const record of champRecords) {
        let updated = false
        
        const roles = record.get("roles")
        if (roles && Array.isArray(roles)) {
            const updatedRoles = roles.map(r => roleMap[r] || r)
            record.set("roles", updatedRoles)
            updated = true
        }

        const tierByRole = record.get("tier_by_role")
        if (tierByRole && typeof tierByRole === "object") {
            const updatedTierByRole = {}
            for (const [role, tier] of Object.entries(tierByRole)) {
                updatedTierByRole[roleMap[role] || role] = tier
            }
            record.set("tier_by_role", updatedTierByRole)
            updated = true
        }
        
        if (updated) {
            app.save(record)
        }
    }
}, (app) => {
    // Rollback: reverse the migration
    const roleMapReverse = {
        "top": "Top",
        "jng": "Jungle",
        "mid": "Mid",
        "adc": "ADC",
        "sup": "Support"
    }

    const playerRecords = app.findRecordsByFilter("players", "")
    for (const record of playerRecords) {
        if (record.get("role") && roleMapReverse[record.get("role")]) {
            record.set("role", roleMapReverse[record.get("role")])
            app.save(record)
        }
        if (record.get("secondary_role") && roleMapReverse[record.get("secondary_role")]) {
            record.set("secondary_role", roleMapReverse[record.get("secondary_role")])
            app.save(record)
        }
    }

    const champRecords = app.findRecordsByFilter("champions", "")
    for (const record of champRecords) {
        let updated = false
        
        const roles = record.get("roles")
        if (roles && Array.isArray(roles)) {
            const updatedRoles = roles.map(r => roleMapReverse[r] || r)
            record.set("roles", updatedRoles)
            updated = true
        }

        const tierByRole = record.get("tier_by_role")
        if (tierByRole && typeof tierByRole === "object") {
            const updatedTierByRole = {}
            for (const [role, tier] of Object.entries(tierByRole)) {
                updatedTierByRole[roleMapReverse[role] || role] = tier
            }
            record.set("tier_by_role", updatedTierByRole)
            updated = true
        }
        
        if (updated) {
            app.save(record)
        }
    }
})
