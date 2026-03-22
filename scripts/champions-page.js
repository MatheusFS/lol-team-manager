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
      if (this.filterTier)  list = list.filter(c =>
        c.tier_by_role && Object.values(c.tier_by_role).includes(this.filterTier)
      )

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

    // ── Copy Bookmarklet ────────────────────────────────────────────────

    copyBookmarklet() {
      const bookmarklet = `
(function() {
  const TIER_BG = 'M2 0h20v18.056L12 23 2 18.056z';
  const TIER_PATHS = {
    'M10.148': 'A',    // tier 1 (linhas até 25)
    'M9.165': 'B',     // tier 2 (linhas até 96)
    'm10.124': 'C',    // tier 3 (linhas até 171)
    'M12.672': 'D',    // tier 4 (linhas até 220)
    'm10.327': 'D',    // tier 5 (linhas abaixo de 220)
  };
  const ROLE_PATHS = {
    'M5.14 2': 'jng',
    'm19 3': 'top',
    'm15 3': 'mid',
    'M9 21': 'adc',
    'M12.833': 'sup',
  };

  const meta = {};
  const unknownPaths = { tier: new Set(), role: new Set() };

  const rows = document.querySelectorAll('main tbody tr');
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (!cells.length) return;

    // Champion name from td:nth-of-type(2)
    const nameEl = cells[1]?.querySelector('a, span') || cells[1];
    const name = nameEl?.textContent?.trim()?.toLowerCase().replace(/[^a-z]/g, '') || '';
    if (!name) return;

    // Tier from td:nth-of-type(3) — check first few chars (discriminator prefix)
    const tierAllPaths = Array.from(cells[2]?.querySelectorAll('svg g path[d]') || [])
      .map(p => p.getAttribute('d'));
    let tier = null;
    for (const path of tierAllPaths) {
      if (path && path !== TIER_BG) {
        // Try to match by checking if path starts with known discriminator
        let matched = null;
        for (const [discrim, tierVal] of Object.entries(TIER_PATHS)) {
          if (path.startsWith(discrim)) {
            matched = tierVal;
            break;
          }
        }
        if (matched) {
          tier = matched;
        } else {
          unknownPaths.tier.add(path);
        }
        break; // Use first non-background path
      }
    }

    // Role from td:nth-of-type(4) — match by path start prefix
    const roleAllPaths = Array.from(cells[3]?.querySelectorAll('svg path[d]') || [])
      .map(p => p.getAttribute('d'));
    let role = null;
    for (const path of roleAllPaths) {
      if (path) {
        let matched = null;
        for (const [discrim, roleVal] of Object.entries(ROLE_PATHS)) {
          if (path.startsWith(discrim)) {
            matched = roleVal;
            break;
          }
        }
        if (matched) {
          role = matched;
        } else {
          unknownPaths.role.add(path);
        }
        break; // Use first path
      }
    }

    // Accumulate by champion
    if (tier && role) {
      if (!meta[name]) meta[name] = {};
      meta[name][role] = tier;
    }
  });

  // Add unknown paths for debugging
  if (unknownPaths.tier.size || unknownPaths.role.size) {
    meta._unknown_paths = {
      tier: [...unknownPaths.tier],
      role: [...unknownPaths.role],
    };
  }

  copy(JSON.stringify(meta));
  alert('✅ JSON copiado! ' + Object.keys(meta).filter(k => k !== '_unknown_paths').length + ' campeões extraídos.\\n' + (meta._unknown_paths ? '⚠️ Alguns paths SVG não foram reconhecidos. Verifique _unknown_paths no JSON.' : ''));
})();
      `.trim()

      try {
        navigator.clipboard.writeText(bookmarklet).then(() => {
          alert('✅ Comando copiado! Agora:\n1. Abra DevTools (F12) na aba op.gg\n2. Vá para Console\n3. Cole e pressione Enter\n4. O JSON será copiado automaticamente')
        })
      } catch {
        // Fallback: copy via textarea
        const ta = document.createElement('textarea')
        ta.value = bookmarklet
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        alert('✅ Comando copiado! Agora:\n1. Abra DevTools (F12) na aba op.gg\n2. Vá para Console\n3. Cole e pressione Enter\n4. O JSON será copiado automaticamente')
      }
    },

    // ── Import from OP.GG ──────────────────────────────────────────────────

    importFromOpGG() {
      // Show the meta import UI
      this.metaStatus = 'cors'
      this.metaJson = ''
    },

    // ── Fetch Suggestions (legacy, kept for reference) ────────────────────────────────────────────────────

    async fetchSuggestions() {
      this.fetching = true
      this.fetchProgress = 'Buscando DDragon…'
      this.metaStatus = ''

      try {
        const version = _ddragonVersion
        console.log('[fetchSuggestions] version:', version)
        const ddragonData = await ChampionSuggest.fetchDDragon(version)
        console.log('[fetchSuggestions] ddragonData loaded, champions:', Object.keys(ddragonData).length)

        const patchNum = version.split('.').slice(0, 2).join('.')
        let meta = null

        this.fetchProgress = 'Buscando meta (op.gg)…'
        meta = await ChampionSuggest.fetchOpGG(patchNum)
        console.log('[fetchSuggestions] fetchOpGG result:', meta)

        if (!meta) {
          this.fetchProgress = 'Buscando meta (Lolalytics)…'
          meta = await ChampionSuggest.fetchMeta(patchNum)
          console.log('[fetchSuggestions] fetchMeta result:', meta)
        }

        if (meta) {
          this.metaStatus = 'ok'
        } else {
          this.metaStatus = 'cors'
          meta = ChampionSuggest.getMetaCache(patchNum)
          console.log('[fetchSuggestions] getMetaCache result:', meta)
        }

        console.log('[fetchSuggestions] calling suggestAll with meta:', meta)
        const suggestions = ChampionSuggest.suggestAll(ddragonData, meta)
        console.log('[fetchSuggestions] suggestAll completed, got suggestions for', Object.keys(suggestions).length, 'champs')

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
            if (!champ.tier_by_role) { champ.tier_by_role = s.tier_by_role; payload.tier_by_role = s.tier_by_role }
            if (!champ.comp_type)   { champ.comp_type   = s.comp_fit;    payload.comp_type   = s.comp_fit }

            const result = await api.col('champions').update(champ.id, payload)
            // Update local object with API response for consistency
            Object.assign(champ, result)
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

    async importMetaManual() {
      const patch = _ddragonVersion.split('.').slice(0, 2).join('.')

      // Parse the JSON and extract unknown paths warning
      let metaData = null
      try {
        metaData = JSON.parse(this.metaJson)
      } catch {
        alert('JSON inválido. Verifique a sintaxe.')
        return
      }

      if (!metaData || typeof metaData !== 'object') {
        alert('JSON inválido. Deve ser um objeto.')
        return
      }

      // Warn about unknown paths if present
      if (metaData._unknown_paths) {
        const tierUnknown = Array.isArray(metaData._unknown_paths.tier) ? metaData._unknown_paths.tier : []
        const roleUnknown = Array.isArray(metaData._unknown_paths.role) ? metaData._unknown_paths.role : []

        if (tierUnknown.length || roleUnknown.length) {
          const unknownList = [
            tierUnknown.length ? `${tierUnknown.length} paths de tier` : '',
            roleUnknown.length ? `${roleUnknown.length} paths de role` : '',
          ].filter(Boolean).join(', ')
          alert(`⚠️ Importação parcial: ${unknownList} não reconhecidos.\n\nSe quiser completar o dict, copie e envie:\n\ntier: ${JSON.stringify(tierUnknown)}\nrole: ${JSON.stringify(roleUnknown)}`)
        }
      }

      // Remove internal fields before caching
      delete metaData._unknown_paths

      // Cache and proceed
      const result = ChampionSuggest.importMeta(metaData, patch)
      if (!result) {
        alert('Falha ao processar JSON.')
        return
      }

      this.fetching = true
      this.fetchProgress = 'Processando sugestões de tier…'
      this.metaStatus = 'manual'
      this.metaJson = ''

      try {
        // Get DDragon data to compute suggestions
        const version = _ddragonVersion
        const ddragonData = await ChampionSuggest.fetchDDragon(version)

        // Generate suggestions with the imported meta
        const suggestions = ChampionSuggest.suggestAll(ddragonData, metaData)

        // Count how many champions will be updated
        let updateCount = 0
        const updates = new Map()

        for (const champ of this.champs) {
          const s = suggestions[champ.key]
          if (!s) continue

          // Build payload
          const payload = { suggested: s, patch: version }

          // OP.GG import: only update tier_by_role, class and roles
          // damage_type heuristic is unreliable — saved only as suggestion for manual review
          // comp_type is a strategic decision, not determined by OP.GG meta
          if (s.class) payload.class = s.class
          if (s.roles) payload.roles = s.roles
          if (s.tier_by_role) payload.tier_by_role = s.tier_by_role

          console.log(`[importMetaManual] ${champ.name}: suggestion=`, s, 'payload=', payload)

          updateCount++
          updates.set(champ.id, { champ, payload })
        }

        // Ask for confirmation
        if (updateCount === 0) {
          alert('Nenhum campeão para atualizar (todos já têm dados preenchidos).')
          return
        }

        const confirmed = confirm(`Atualizar ${updateCount} campeões com dados do OP.GG?\n\nIsso vai preencher dados vazios como class, roles e tier_by_role.\n\nObs: damage_type é salvo apenas como sugestão (ver modal de revisão).`)
        if (!confirmed) {
          this.metaStatus = ''
          return
        }

        // Apply updates
        this.fetching = true
        this.fetchProgress = 'Salvando dados…'
        let done = 0
        const BATCH = 10
        const updatesList = Array.from(updates.values())
        const total = updatesList.length

        for (let i = 0; i < total; i += BATCH) {
          const batch = updatesList.slice(i, i + BATCH)
          await Promise.all(batch.map(async ({ champ, payload }) => {
            // Update local state
            champ.suggested = payload.suggested
            champ.patch = payload.patch
            if (payload.class) champ.class = payload.class
            if (payload.roles) champ.roles = payload.roles
            if (payload.tier_by_role) champ.tier_by_role = payload.tier_by_role
            if (payload.comp_type) champ.comp_type = payload.comp_type

            console.log(`[importMetaManual] Before save - ${champ.name}: payload=`, payload)

            try {
              // Save to database and update local object with API response
              const result = await api.col('champions').update(champ.id, payload)
              console.log(`[importMetaManual] After save - ${champ.name}: result.tier_by_role=`, result.tier_by_role)
              // Update local champion object with API response to ensure consistency
              Object.assign(champ, result)
            } catch (e) {
              console.error(`[importMetaManual] Error saving ${champ.name}:`, e)
              throw e
            }

            done++
            this.fetchProgress = `${done}/${total}`
          }))
        }

        Alpine.store('champions').list = [...this.champs]
        this.fetchProgress = ''
        this.metaStatus = ''
        alert(`✅ ${updateCount} campeões atualizados com sucesso!`)
      } catch (e) {
        console.error('Falha ao processar meta importada', e)
        this.fetchProgress = 'Erro: ' + e.message
      } finally {
        this.fetching = false
      }
    },

    // ── Modal ────────────────────────────────────────────────────────────────

    // Normalize role keys from legacy Title-case to lowercase short-form
    _normalizeRoleKeys(value) {
      const ROLE_MAP = { 'Top': 'top', 'Jungle': 'jng', 'Mid': 'mid', 'ADC': 'adc', 'Support': 'sup' }
      if (Array.isArray(value)) {
        return value.map(r => ROLE_MAP[r] || r)
      }
      if (value && typeof value === 'object') {
        const out = {}
        for (const [k, v] of Object.entries(value)) out[ROLE_MAP[k] || k] = v
        return out
      }
      return value
    },

    openModal(champ) {
      // edits are initialized from flat fields (the confirmed values)
      // Use '' (empty string) for select-bound fields so Alpine binds to <option value="">

      // Handle tier_by_role which might be a string or object
      let tierByRole = {}
      if (champ.tier_by_role) {
        if (typeof champ.tier_by_role === 'string') {
          try {
            tierByRole = this._normalizeRoleKeys(JSON.parse(champ.tier_by_role))
          } catch {
            tierByRole = {}
          }
        } else if (typeof champ.tier_by_role === 'object') {
          tierByRole = this._normalizeRoleKeys({ ...champ.tier_by_role })
        }
      }

      // Normalize suggested blob — it may have been saved with legacy role keys
      const rawSuggested = champ.suggested || {}
      const suggested = {
        ...rawSuggested,
        roles:        this._normalizeRoleKeys(rawSuggested.roles),
        tier_by_role: this._normalizeRoleKeys(rawSuggested.tier_by_role),
      }

      const edits = {
        class:       champ.class       || '',
        roles:       this._normalizeRoleKeys(Array.isArray(champ.roles) ? [...champ.roles] : []),
        damage_type: champ.damage_type  || '',
        comp_fit:    champ.comp_type    || '',
        comp_fit_2:  champ.comp_type_2  || '',
        early:       champ.early        ?? null,
        mid:         champ.mid          ?? null,
        late:        champ.late         ?? null,
        tier_by_role: tierByRole,
      }

      // Ensure tier_by_role has entries for all roles (even if empty)
      // This ensures Alpine reactivity works correctly
      for (const role of edits.roles) {
        if (!(role in edits.tier_by_role)) {
          edits.tier_by_role[role] = ''
        }
      }

      this.modal = {
        champ,
        suggested,
        edits,
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
      } else if (field === 'tier_by_role') {
        this.modal.edits.tier_by_role = s.tier_by_role ? { ...s.tier_by_role } : {}
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
        tier_by_role: s.tier_by_role ? { ...s.tier_by_role } : {},
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
        tier_by_role: Object.keys(edits.tier_by_role || {}).length ? edits.tier_by_role : null,
      }

      this.saving = { ...this.saving, [champ.id]: 'saving' }
      try {
        const result = await api.col('champions').update(champ.id, payload)
        Object.assign(champ, result)

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
