document.addEventListener('alpine:init', () => {
  Alpine.data('teamPage', () => ({
    formations: [],
    loading: false,
    modal: false,
    editId: null,
    saving: false,
    form: { name: '', top: '', jungle: '', mid: '', adc: '', support: '', active: false },

    async init() {
      await this.load()
    },

    async load() {
      this.loading = true
      try {
        const data = await api.col('formations').list({ sort: '-active,name', perPage: 100 })
        this.formations = data.items
      } catch (e) {
        console.error('[team] load failed:', e)
      }
      this.loading = false
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
      for (const role of ['top', 'jungle', 'mid', 'adc', 'support']) {
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
          jungle: this.form.jungle,
          mid: this.form.mid,
          adc: this.form.adc,
          support: this.form.support,
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
  }))
})
