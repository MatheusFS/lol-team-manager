document.addEventListener('alpine:init', () => {
  Alpine.data('playersPage', () => ({
    players: [],
    loading: false,
    modal: false,
    editId: null,
    saving: false,
    form: { name: '', role: '', secondary_role: '', is_sub: false, riot_id: '', puuid: '' },

    async init() {
      await this.load()
    },

    async load() {
      this.loading = true
      try {
        const data = await api.col('players').list({ sort: 'name', perPage: 200 })
        this.players = data.items
      } catch (e) {
        console.error('[players] load failed:', e)
      }
      this.loading = false
    },

    openNew() {
      this.editId = null
      this.form = { name: '', role: '', secondary_role: '', is_sub: false, riot_id: '', puuid: '' }
      this.modal = true
    },

    openEdit(p) {
      this.editId = p.id
      this.form = {
        name:           p.name,
        role:           p.role,
        secondary_role: p.secondary_role || '',
        is_sub:         p.is_sub,
        riot_id:        p.riot_id,
        puuid:          p.puuid,
      }
      this.modal = true
    },

    async save() {
      if (!this.form.name.trim()) return alert('Preencha o nome do jogador.')
      if (!this.form.role)        return alert('Selecione a lane do jogador.')

      this.saving = true
      try {
        const payload = {
          name:            this.form.name.trim(),
          role:            this.form.role,
          secondary_role:  this.form.secondary_role,
          is_sub:          this.form.is_sub,
          riot_id:         this.form.riot_id.trim(),
          puuid:           this.form.puuid.trim(),
        }

        if (this.editId) {
          await api.col('players').update(this.editId, payload)
        } else {
          await api.col('players').create(payload)
        }

        this.closeModal()
        await this.load()
      } catch (e) {
        console.error('[players] save failed:', e)
        alert('Erro ao salvar jogador.')
      }
      this.saving = false
    },

    async del(id) {
      if (!confirm('Excluir este jogador?')) return
      try {
        await api.col('players').delete(id)
        await this.load()
      } catch (e) {
        console.error('[players] delete failed:', e)
        alert('Erro ao excluir jogador.')
      }
    },

    closeModal() {
      this.modal = false
      this.editId = null
    },

    truncate(str, n = 16) {
      if (!str) return '—'
      return str.length > n ? str.slice(0, n) + '…' : str
    },
  }))
})
