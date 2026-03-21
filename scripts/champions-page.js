document.addEventListener('alpine:init', () => {
  Alpine.data('championsPage', () => ({

    champs:           [],
    query:            '',
    filterComp:       '',
    filterClass:      '',
    filterRole:       '',
    filterTier:       '',
    filterConfigured: '',   // '' | 'yes' | 'no'
    saving:           {},   // { [id]: 'saving' | 'ok' | null }
    fetching:         false,
    fetchProgress:    '',
    metaStatus:       '',   // '' | 'ok' | 'cors' | 'manual'

    // Modal state
    modal:    null,   // { champ, suggested, edits }
    metaJson: '',     // textarea for manual meta import

    // ── Filters ──────────────────────────────────────────────────────────────

    get filtered() {
      let list = this.champs
      const q = this.query.toLowerCase().trim()
      if (q) list = list.filter(c => c.name.toLowerCase().includes(q))

      if (this.filterConfigured === 'yes') list = list.filter(c => c.comp_type || c.class)
      if (this.filterConfigured === 'no')  list = list.filter(c => !c.comp_type && !c.class)

      if (this.filterClass) list = list.filter(c => c.class === this.filterClass)
      if (this.filterRole)  list = list.filter(c => Array.isArray(c.roles) && c.roles.includes(this.filterRole))
      if (this.filterTier)  list = list.filter(c => c.tier === this.filterTier)

      if (this.filterComp) {
        list = list.filter(c => c.comp_type === this.filterComp || c.comp_type_2 === this.filterComp)
        list = [...list].sort((a, b) => {
          const aPrimary = a.comp_type === this.filterComp
          const bPrimary = b.comp_type === this.filterComp
          if (aPrimary !== bPrimary) return aPrimary ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
      return list
    },

    // ── Init ─────────────────────────────────────────────────────────────────

    async init() {
      const res   = await api.col('champions').list({ perPage: 500, sort: 'name' })
      this.champs = res.items
      Alpine.store('champions').list   = res.items
      Alpine.store('champions').loaded = true
    },

    // ── Fetch Suggestions ────────────────────────────────────────────────────

    async fetchSuggestions() {
      this.fetching = true
      this.fetchProgress = 'Buscando DDragon…'
      this.metaStatus = ''

      try {
        const version = _ddragonVersion
        const ddragonData = await ChampionSuggest.fetchDDragon(version)

        this.fetchProgress = 'Buscando meta (Lolalytics)…'
        const patchNum = version.split('.').slice(0, 2).join('.')
        let meta = await ChampionSuggest.fetchMeta(patchNum)

        if (meta) {
          this.metaStatus = 'ok'
        } else {
          this.metaStatus = 'cors'
          meta = ChampionSuggest.getMetaCache(patchNum)
        }

        const suggestions = ChampionSuggest.suggestAll(ddragonData, meta)

        const total = this.champs.length
        let done = 0
        const BATCH = 10

        for (let i = 0; i < total; i += BATCH) {
          const batch = this.champs.slice(i, i + BATCH)
          await Promise.all(batch.map(async champ => {
            const s = suggestions[champ.key]
            if (!s) return

            // Store suggested blob for modal comparison
            champ.suggested = s
            champ.patch     = version

            // Only auto-fill flat fields if they're not yet set (don't overwrite manual edits)
            const payload = { suggested: s, patch: version }
            if (!champ.class)       { champ.class       = s.class;       payload.class       = s.class }
            if (!champ.roles)       { champ.roles       = s.roles;       payload.roles       = s.roles }
            if (!champ.damage_type) { champ.damage_type = s.damage_type; payload.damage_type = s.damage_type }
            if (!champ.tier)        { champ.tier        = s.tier;        payload.tier        = s.tier }
            if (!champ.comp_type)   { champ.comp_type   = s.comp_fit;    payload.comp_type   = s.comp_fit }

            await api.col('champions').update(champ.id, payload)
            done++
            this.fetchProgress = `${done}/${total}`
          }))
        }

        Alpine.store('champions').list = [...this.champs]
        this.fetchProgress = 'Concluído!'
        setTimeout(() => { this.fetchProgress = '' }, 2000)
      } catch (e) {
        console.error('Falha ao buscar sugestões', e)
        this.fetchProgress = 'Erro: ' + e.message
      } finally {
        this.fetching = false
      }
    },

    // ── Manual Meta Import ───────────────────────────────────────────────────

    importMetaManual() {
      const patch = _ddragonVersion.split('.').slice(0, 2).join('.')
      const result = ChampionSuggest.importMeta(this.metaJson, patch)
      if (result) {
        this.metaStatus = 'manual'
        this.metaJson = ''
      }
    },

    // ── Modal ────────────────────────────────────────────────────────────────

    openModal(champ) {
      // edits are initialized from flat fields (the confirmed values)
      // Use '' (empty string) for select-bound fields so Alpine binds to <option value="">
      this.modal = {
        champ,
        suggested: champ.suggested || {},
        edits: {
          class:       champ.class       || '',
          roles:       Array.isArray(champ.roles) ? [...champ.roles] : [],
          damage_type: champ.damage_type  || '',
          comp_fit:    champ.comp_type    || '',
          comp_fit_2:  champ.comp_type_2  || '',
          early:       champ.early        ?? null,
          mid:         champ.mid          ?? null,
          late:        champ.late         ?? null,
          tier:        champ.tier         || '',
        },
      }
    },

    closeModal() {
      this.modal = null
    },

    acceptSuggestion(field) {
      if (!this.modal) return
      const s = this.modal.suggested
      if (field === 'roles') {
        this.modal.edits.roles = s.roles ? [...s.roles] : []
      } else if (field === 'comp_fit') {
        this.modal.edits.comp_fit = s.comp_fit || ''
      } else {
        this.modal.edits[field] = s[field] || ''
      }
    },

    acceptAll() {
      if (!this.modal) return
      const s = this.modal.suggested
      this.modal.edits = {
        class:       s.class       || '',
        roles:       s.roles       ? [...s.roles] : [],
        damage_type: s.damage_type || '',
        comp_fit:    s.comp_fit    || '',
        comp_fit_2:  '',
        early:       null,
        mid:         null,
        late:        null,
        tier:        s.tier        || '',
      }
    },

    toggleRole(role) {
      if (!this.modal) return
      const idx = this.modal.edits.roles.indexOf(role)
      if (idx >= 0) this.modal.edits.roles.splice(idx, 1)
      else this.modal.edits.roles.push(role)
    },

    pickScale(phase, ci) {
      if (!this.modal) return
      this.modal.edits[phase] = this.modal.edits[phase] === ci ? null : ci
    },

    async saveModal() {
      if (!this.modal) return
      const { champ, edits } = this.modal

      // Save directly to flat fields — these ARE the confirmed values
      const payload = {
        comp_type:   edits.comp_fit   || null,
        comp_type_2: edits.comp_fit_2 || null,
        early:       edits.early      ?? null,
        mid:         edits.mid        ?? null,
        late:        edits.late       ?? null,
        class:       edits.class      || null,
        roles:       edits.roles?.length ? edits.roles : null,
        damage_type: edits.damage_type || null,
        tier:        edits.tier        || null,
      }

      this.saving = { ...this.saving, [champ.id]: 'saving' }
      try {
        await api.col('champions').update(champ.id, payload)
        Object.assign(champ, payload)

        const idx = Alpine.store('champions').list.findIndex(c => c.id === champ.id)
        if (idx >= 0) Object.assign(Alpine.store('champions').list[idx], champ)

        this.saving = { ...this.saving, [champ.id]: 'ok' }
        setTimeout(() => { this.saving = { ...this.saving, [champ.id]: null } }, 1500)
        this.closeModal()
      } catch (e) {
        console.error('Falha ao salvar campeão', e)
        this.saving = { ...this.saving, [champ.id]: null }
      }
    },

  }))
})
