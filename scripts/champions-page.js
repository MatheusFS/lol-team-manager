document.addEventListener('alpine:init', () => {
  Alpine.data('championsPage', () => ({

    champs:  [],
    query:   '',
    saving:  {},   // { [id]: 'saving' | 'ok' | null }

    COMP_OPTIONS: ['Protect','Pick','Split','Siege','Engage','Mix'],
    SCALE_COLORS: ['🔴','🟡','🟢'],
    SCALE_SLOTS:  ['Early','Mid','Late'],
    PHASES:       ['early','mid','late'],

    get filtered() {
      const q = this.query.toLowerCase().trim()
      return q ? this.champs.filter(c => c.name.toLowerCase().includes(q)) : this.champs
    },

    async init() {
      const res   = await api.col('champions').list({ perPage: 500, sort: 'name' })
      this.champs = res.items
      // Keep shared store in sync so the match form can use new data immediately
      Alpine.store('champions').list   = res.items
      Alpine.store('champions').loaded = true
    },

    async save(champ) {
      this.saving = { ...this.saving, [champ.id]: 'saving' }
      try {
        await api.col('champions').update(champ.id, {
          comp_type:   champ.comp_type   || null,
          comp_type_2: champ.comp_type_2 || null,
          early:       champ.early       ?? null,
          mid:         champ.mid         ?? null,
          late:        champ.late        ?? null,
        })
        this.saving = { ...this.saving, [champ.id]: 'ok' }
        // Sync shared store
        const idx = Alpine.store('champions').list.findIndex(c => c.id === champ.id)
        if (idx >= 0) Object.assign(Alpine.store('champions').list[idx], champ)
        setTimeout(() => { this.saving = { ...this.saving, [champ.id]: null } }, 1500)
      } catch (e) {
        console.error('Falha ao salvar campeão', e)
        this.saving = { ...this.saving, [champ.id]: null }
      }
    },

    pickScaling(champ, phase, ci) {
      // Toggle: click same value again to deselect
      champ[phase] = (champ[phase] === ci) ? null : ci
      this.save(champ)
    },

  }))
})
