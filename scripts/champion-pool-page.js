document.addEventListener('alpine:init', () => {
  Alpine.data('championPoolPage', () => ({
    players: [],
    selectedPlayer: null,
    pool: [],
    filterRole: null,
    loading: false,
    saving: false,
    addTier: 'green',
    addChampId: null,

    async init() {
      await Alpine.store('champions').load()
      this.players = await loadPlayers()
      if (this.players.length) await this.selectPlayer(this.players[0])
    },

    sortPool() {
      const tierOrder = { star: 0, green: 1, yellow: 2 }
      this.pool.sort((a, b) => {
        const tierDiff = (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99)
        if (tierDiff !== 0) return tierDiff
        return a.expand.champion.name.localeCompare(b.expand.champion.name)
      })
    },

    get filteredPool() {
      if (!this.filterRole) return this.pool
      return this.pool.filter(entry => {
        const champRoles = entry.expand?.champion?.roles || []
        return champRoles.includes(this.filterRole)
      })
    },

    async selectPlayer(p) {
      this.selectedPlayer = p
      this.filterRole = null
      await this.loadPool()
    },

    async loadPool() {
      this.loading = true
      try {
        const res = await api.col('champion_pool').list({
          filter: `player="${this.selectedPlayer.id}"`,
          expand: 'champion',
          perPage: 500,
        })
        this.pool = res.items
        this.sortPool()
      } catch (e) {
        console.error('[championPoolPage] loadPool failed:', e)
      } finally {
        this.loading = false
      }
    },

    async addEntry() {
      if (!this.addChampId) return
      if (this.pool.find(e => e.champion === this.addChampId)) return

      this.saving = true
      try {
        const newEntry = await api.col('champion_pool').create({
          player: this.selectedPlayer.id,
          champion: this.addChampId,
          tier: this.addTier,
        })
        // Expand champion data for the new entry
        const champ = Alpine.store('champions').byId(this.addChampId)
        newEntry.expand = { champion: champ }
        this.pool.push(newEntry)
        this.sortPool()
        this.addChampId = null
      } catch (e) {
        console.error('[championPoolPage] addEntry failed:', e)
      } finally {
        this.saving = false
      }
    },

    async updateTier(entry, tier) {
      try {
        await api.col('champion_pool').update(entry.id, { tier })
        entry.tier = tier
        this.sortPool()
      } catch (e) {
        console.error('[championPoolPage] updateTier failed:', e)
      }
    },

    async removeEntry(id) {
      if (!confirm('Remover campeão da pool?')) return
      try {
        await api.col('champion_pool').delete(id)
        this.pool = this.pool.filter(e => e.id !== id)
      } catch (e) {
        console.error('[championPoolPage] removeEntry failed:', e)
      }
    },
  }))
})
