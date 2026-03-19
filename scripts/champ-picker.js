// ── champPicker ───────────────────────────────────────────────────────────────
// Standalone Alpine component for champion autocomplete.
// mode = 'id'   → value holds the PocketBase record ID
// mode = 'name' → value holds the champion name string
//
// Usage:
//   <div x-data="champPicker({ mode: 'id' })" x-modelable="value" x-model="parentProp">
//     <input :value="display" @input="onInput($event.target.value)"
//            @focus="onFocus()" @blur="onBlur()" placeholder="Buscar…">
//     <div x-show="open">
//       <template x-for="c in results" :key="c.id">
//         <button @mousedown.prevent="pick(c)" x-text="c.name"></button>
//       </template>
//     </div>
//   </div>

document.addEventListener('alpine:init', () => {
  Alpine.data('champPicker', ({ mode = 'name' } = {}) => ({
    value:   '',
    display: '',
    results: [],
    open:    false,

    init() {
      Alpine.store('champions').load()
      this.$watch('value', v => {
        if (!v) { this.display = ''; return }
        if (mode === 'id') {
          const c = Alpine.store('champions').byId(v)
          if (c) this.display = c.name
        } else {
          this.display = v
        }
      })
    },

    onInput(query) {
      this.results = Alpine.store('champions').search(query)
      this.open    = this.results.length > 0
    },

    onFocus() {
      const q = this.display
      if (q) {
        this.results = Alpine.store('champions').search(q)
        this.open    = this.results.length > 0
      }
    },

    pick(champ) {
      this.value   = mode === 'id' ? champ.id : champ.name
      this.display = champ.name
      this.results = []
      this.open    = false
    },

    onBlur() {
      setTimeout(() => { this.open = false }, 150)
    },
  }))
})
