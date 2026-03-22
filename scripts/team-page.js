document.addEventListener('alpine:init', () => {
  Alpine.data('teamPage', () => ({
    formations: [],
    players: [],
    loading: false,
    modal: false,
    editId: null,
    saving: false,
    form: { name: '', top: '', jungle: '', mid: '', adc: '', support: '', active: false },

    // ── Import scan ─────────────────────────────────────────────────────────
    importPanel:   false,
    importLoading: false,
    importScan:    [],   // [{ fingerprint, roles, count, matchIds, name, active }]

    async init() {
      const [pData] = await Promise.all([
        api.col('players').list({ sort: 'name', perPage: 200 }),
        this.load(),
      ])
      this.players = pData.items
    },

    async load() {
      this.loading = true
      try {
        const data = await api.col('formations').list({ sort: '-active,name', perPage: 100, expand: 'top,jungle,mid,adc,support' })
        this.formations = data.items
      } catch (e) {
        console.error('[team] load failed:', e)
      }
      this.loading = false
    },

    playerName(id) {
      return this.players.find(p => p.id === id)?.name ?? id
    },

    openNew() {
      this.editId = null
      this.form = { name: '', top: '', jungle: '', mid: '', adc: '', support: '', active: false }
      this.modal = true
    },

    openEdit(f) {
      this.editId = f.id
      this.form = {
        name: f.name,
        top: f.top,
        jungle: f.jungle,
        mid: f.mid,
        adc: f.adc,
        support: f.support,
        active: f.active,
      }
      this.modal = true
    },

    async save() {
      if (!this.form.name.trim()) return alert('Preencha o nome da formação.')
      for (const role of ['top', 'jng', 'mid', 'adc', 'sup']) {
        if (!this.form[role]) return alert(`Selecione o jogador de ${role}.`)
      }

      this.saving = true
      try {
        // If setting as active, deactivate current active formation
        if (this.form.active) {
          const current = this.formations.find(f => f.active && f.id !== this.editId)
          if (current) {
            await api.col('formations').update(current.id, { active: false })
          }
        }

        const payload = {
          name: this.form.name.trim(),
          top: this.form.top,
          jng: this.form.jng,
          mid: this.form.mid,
          adc: this.form.adc,
          sup: this.form.sup,
          active: this.form.active,
        }

        if (this.editId) {
          await api.col('formations').update(this.editId, payload)
        } else {
          await api.col('formations').create(payload)
        }

        this.closeModal()
        await this.load()
      } catch (e) {
        console.error('[team] save failed:', e)
        alert('Erro ao salvar formação.')
      }
      this.saving = false
    },

    async del(id) {
      if (!confirm('Excluir esta formação?')) return
      try {
        await api.col('formations').delete(id)
        await this.load()
      } catch (e) {
        console.error('[team] delete failed:', e)
        alert('Erro ao excluir formação.')
      }
    },

    closeModal() {
      this.modal = false
      this.editId = null
    },

    // ── Import scan: discover distinct lineups from match data ─────────────
    async runImportScan() {
      this.importLoading = true
      this.importPanel   = true
      this.importScan    = []
      try {
        const data = await api.col('matches').list({ perPage: 500, filter: 'player_stats!=""' })

        // Group matches by lineup fingerprint (player IDs)
        const groups = {}
        for (const m of data.items) {
          const lineup = extractLineup(m, this.players)
          const roles = ['top', 'jng', 'mid', 'adc', 'sup']
          if (!roles.every(r => lineup[r])) continue

          const fp = roles.map(r => lineup[r]).join('|')
          if (!groups[fp]) groups[fp] = { roles: lineup, matchIds: [], count: 0 }
          groups[fp].matchIds.push(m.id)
          groups[fp].count++
        }

        // Filter out lineups that already exactly match a known formation
        const knownFps = new Set(
          this.formations.map(f =>
            ['top','jng','mid','adc','sup'].map(r => f[r]).join('|')
          )
        )

        this.importScan = Object.entries(groups)
          .filter(([fp]) => !knownFps.has(fp))
          .map(([fp, g]) => ({ fingerprint: fp, ...g, name: '', active: false }))
          .sort((a, b) => b.count - a.count)

      } catch (e) {
        console.error('[team] import scan failed:', e)
        alert('Erro ao varrer partidas.')
      }
      this.importLoading = false
    },

    async createFromImport(item) {
      if (!item.name.trim()) return alert('Dê um nome para esta formação.')
      try {
        if (item.active) {
          const current = this.formations.find(f => f.active)
          if (current) await api.col('formations').update(current.id, { active: false })
        }
        await api.col('formations').create({
          name:    item.name.trim(),
          top:     item.roles.top,
          jungle:  item.roles.jungle,
          mid:     item.roles.mid,
          adc:     item.roles.adc,
          support: item.roles.support,
          active:  item.active,
        })
        this.importScan = this.importScan.filter(i => i.fingerprint !== item.fingerprint)
        await this.load()
      } catch (e) {
         console.error('[team] createFromImport failed:', e)
         alert('Erro ao criar formação.')
       }
     },

     roleLabel(role) {
       const map = { 'top': 'TOP', 'jng': 'JNG', 'mid': 'MID', 'adc': 'ADC', 'sup': 'SUP', 'jungle': 'JNG', 'support': 'SUP' }
       return map[role] || role || '—'
     },

     formationField(role) {
       const map = { 'top': 'top', 'jng': 'jungle', 'mid': 'mid', 'adc': 'adc', 'sup': 'support' }
       return map[role] || role
     },
   }))
})
