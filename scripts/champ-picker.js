// ── champPicker ───────────────────────────────────────────────────────────────
// Unified Alpine.js component for champion autocomplete across all pages.
//
// Modes:
//   mode = 'value'    → value/display binding + x-modelable (champion-pool, MVP)
//   mode = 'slot'     → updates slot object properties (match-form)
//   mode = 'callback' → invokes onSelect(champ) callback (draft-page)
//
// Configuration:
//   maxResults = 20   → limit results shown (default 20, configurable)
//   slot = null       → slot object reference (mode 'slot')
//   onSelect = null   → callback function (mode 'callback')
//
// Usage Examples:
//
// 1. Value binding (champion-pool):
//    <div x-data="champPicker({ mode: 'value', maxResults: 15 })" x-modelable="value" x-model="addChampId">
//      <input x-model="query" @input="onInput(query)" @focus="onFocus()" @blur="onBlur()" />
//      <template x-for="c in results"><button @mousedown.prevent="pick(c)">{{ c.name }}</button></template>
//    </div>
//
// 2. Slot object (match-form):
//    <div x-data="champPicker({ mode: 'slot', slot: ourChamps[0], maxResults: 12 })">
//      <input x-model="query" @input="onInput(query)" @focus="onFocus()" @blur="onBlur()" />
//      <template x-for="c in results"><button @mousedown.prevent="pick(c)">{{ c.name }}</button></template>
//    </div>
//
// 3. Callback (draft-page):
//    <div x-data="champPicker({ mode: 'callback', onSelect(c) { draftPage.pickChamp(c) }, maxResults: 20 })">
//      <input x-model="query" @input="onInput(query)" @focus="onFocus()" @blur="onBlur()" />
//      <template x-for="c in results"><button @mousedown.prevent="pick(c)">{{ c.name }}</button></template>
//    </div>

document.addEventListener('alpine:init', () => {
  Alpine.data('champPicker', ({ 
    mode = 'value', 
    slot = null, 
    onSelect = null, 
    maxResults = 20 
  } = {}) => ({

    // ── Reactive State ──────────────────────────────────────────────────────
    value:    '',         // For x-modelable binding (mode 'value')
    display:  '',         // Human-readable display text
    query:    '',         // Current input query
    results:  [],         // Filtered champion results
    focused:  -1,         // Index of focused result (keyboard nav)
    open:     false,      // Whether dropdown is visible

    // ── Lifecycle ──────────────────────────────────────────────────────────
    async init() {
      await Alpine.store('champions').load()
      
      // In value mode, watch for external changes to value
      if (mode === 'value') {
        this.$watch('value', (newVal) => {
          if (newVal) {
            const c = Alpine.store('champions').byId(newVal)
            if (c) this.display = c.name
          } else {
            this.display = ''
          }
        })
      }

      // In slot mode, pre-populate query from existing slot data (edit mode / applyFromRiot)
      if (mode === 'slot' && slot?.query) {
        this.query = slot.query
      }
    },

    // ── Search/Input Methods ────────────────────────────────────────────────
    
    /**
     * Perform champion search
     */
    search() {
      if (!this.query.trim()) {
        this.results = []
        this.focused = -1
        // In slot mode, also sync to slot
        if (mode === 'slot' && slot) {
          slot.results = []
        }
        return
      }
      const all = Alpine.store('champions').search(this.query)
      this.results = all.slice(0, maxResults)
      this.focused = -1
      // In slot mode, sync to slot
      if (mode === 'slot' && slot) {
        slot.results = this.results
      }
    },

    /**
     * Handle input change
     */
    onInput() {
      this.search()
      this.open = this.results.length > 0
      // In slot mode, sync open to slot
      if (mode === 'slot' && slot) {
        slot.query = this.query
        slot.open = this.open
      }
    },

    /**
     * Handle input focus - show results if any exist
     */
    onFocus() {
      // Show results based on current query text
      const q = (mode === 'slot' ? this.query : this.display).trim()
      if (q) {
        const all = Alpine.store('champions').search(q)
        this.results = all.slice(0, maxResults)
        this.open = this.results.length > 0
        // In slot mode, sync to slot
        if (mode === 'slot' && slot) {
          slot.results = this.results
          slot.open = this.open
        }
      }
    },

    /**
     * Handle input blur - close dropdown after 150ms
     * (allows click to register before blur closes dropdown)
     */
    onBlur() {
      setTimeout(() => { 
        this.open = false
        // In slot mode, sync open to slot
        if (mode === 'slot' && slot) {
          slot.open = false
        }
      }, 150)
    },

    // ── Keyboard Navigation ─────────────────────────────────────────────────

    /**
     * Move focus to next result
     */
    focusNext() {
      if (this.focused < this.results.length - 1) {
        this.focused++
      }
    },

    /**
     * Move focus to previous result
     */
    focusPrev() {
      if (this.focused > 0) {
        this.focused--
      }
    },

    /**
     * Select currently focused result via keyboard
     */
    selectFocused() {
      if (this.focused >= 0 && this.focused < this.results.length) {
        this.pick(this.results[this.focused])
      }
    },

    // ── Selection ───────────────────────────────────────────────────────────

    /**
     * Main selection handler - branches by mode
     */
    pick(champ) {
      if (mode === 'slot') {
        // Mode: slot object - update slot properties, sync champPicker state
        slot.name  = champ.name
        slot.key   = champ.key
        slot.query = champ.name
        // Keep query in sync so the input shows the selected champion name
        this.query   = champ.name
        this.results = []
        this.open    = false
        this.focused = -1
      } else if (mode === 'callback') {
        // Mode: callback - invoke onSelect with champion object
        if (onSelect) {
          onSelect(champ)
        }
        // Clear picker state
        this.query = ''
        this.display = ''
        this.results = []
        this.open = false
        this.focused = -1
      } else if (mode === 'value') {
        // Mode: value binding - update value + display
        // Value will sync to parent via x-modelable binding
        this.value = champ.id
        this.display = champ.name
        // Clear query and results
        this.query = ''
        this.results = []
        this.open = false
        this.focused = -1
      }
    },
  }))
})
