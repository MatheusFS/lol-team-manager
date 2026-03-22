/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
    // Normalize role keys inside champions.suggested JSON blob
    // The suggested field may contain legacy role keys (Top, Jungle, Mid, ADC, Support)
    // in its .roles array and .tier_by_role object keys.

    const roleMap = {
        "Top": "top",
        "Jungle": "jng",
        "Mid": "mid",
        "ADC": "adc",
        "Support": "sup"
    }

    function normalizeRoles(roles) {
        if (!Array.isArray(roles)) return roles
        return roles.map(r => roleMap[r] || r)
    }

    function normalizeTierByRole(tbr) {
        if (!tbr || typeof tbr !== "object" || Array.isArray(tbr)) return tbr
        const out = {}
        for (const [k, v] of Object.entries(tbr)) {
            out[roleMap[k] || k] = v
        }
        return out
    }

    const champRecords = app.findRecordsByFilter("champions", "")
    for (const record of champRecords) {
        let suggested = record.get("suggested")
        if (!suggested || typeof suggested !== "object") continue

        let changed = false

        if (Array.isArray(suggested.roles)) {
            const normalized = normalizeRoles(suggested.roles)
            if (JSON.stringify(normalized) !== JSON.stringify(suggested.roles)) {
                suggested.roles = normalized
                changed = true
            }
        }

        if (suggested.tier_by_role && typeof suggested.tier_by_role === "object") {
            const normalized = normalizeTierByRole(suggested.tier_by_role)
            if (JSON.stringify(normalized) !== JSON.stringify(suggested.tier_by_role)) {
                suggested.tier_by_role = normalized
                changed = true
            }
        }

        if (changed) {
            record.set("suggested", suggested)
            app.save(record)
        }
    }
}, (app) => {
    // Rollback: reverse the normalization (restore legacy keys)
    const roleMapReverse = {
        "top": "Top",
        "jng": "Jungle",
        "mid": "Mid",
        "adc": "ADC",
        "sup": "Support"
    }

    function denormalizeRoles(roles) {
        if (!Array.isArray(roles)) return roles
        return roles.map(r => roleMapReverse[r] || r)
    }

    function denormalizeTierByRole(tbr) {
        if (!tbr || typeof tbr !== "object" || Array.isArray(tbr)) return tbr
        const out = {}
        for (const [k, v] of Object.entries(tbr)) {
            out[roleMapReverse[k] || k] = v
        }
        return out
    }

    const champRecords = app.findRecordsByFilter("champions", "")
    for (const record of champRecords) {
        let suggested = record.get("suggested")
        if (!suggested || typeof suggested !== "object") continue

        let changed = false

        if (Array.isArray(suggested.roles)) {
            suggested.roles = denormalizeRoles(suggested.roles)
            changed = true
        }

        if (suggested.tier_by_role && typeof suggested.tier_by_role === "object") {
            suggested.tier_by_role = denormalizeTierByRole(suggested.tier_by_role)
            changed = true
        }

        if (changed) {
            record.set("suggested", suggested)
            app.save(record)
        }
    }
})
