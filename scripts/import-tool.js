document.addEventListener('alpine:init', () => {
  Alpine.data('importTool', () => ({

    // ── Config ─────────────────────────────────────────────────────────────
    apiKey:        '',
    region:        'BR1',
    summoner:      '',
    startDate:     '2025-01-01',
    endDate:       '',
    playerRiotIds: [],

    // ── Missing data ───────────────────────────────────────────────────────
    missingRows:        [],
    unpairedPbMatches:  [],
    wrongImports:       [],   // registros com riot_match_id de remake (duration < 10)
    mismatchImports:    [],   // registros com riot_match_id mas campeões incompatíveis
    brokenPlayerRefs:      [],   // partidas com snapshot mas sem mvp ou formação
    showBrokenPlayerRefs:  false,
    snapshotCount:         0,
    fetchingSnapshots:     false,
    reprocessing:          false,

    // ── Formation assignment ────────────────────────────────────────────────
    unformationedCount:      0,
    assigningFormations:     false,
    assignResult:            null,   // { assigned, skipped } | null
    showSkippedFormations:   false,

    // ── Results ────────────────────────────────────────────────────────────
    matchPairs:  [],
    cards:       [],
    showResults: false,

    // ── Status ─────────────────────────────────────────────────────────────
    statusMsg:  '',
    statusType: 'info',

    // ── Init ───────────────────────────────────────────────────────────────
    init() {
      this.apiKey   = localStorage.getItem('riot-api-key')  || ''
      this.region   = localStorage.getItem('riot-region')   || 'BR1'
      this.summoner = localStorage.getItem('riot-summoner') || ''
      this.endDate  = new Date().toISOString().slice(0, 10)
      this.loadMissing()
      this.loadWrongImports()
      this.loadMismatchImports()
      this.loadBrokenPlayerRefs()
      this._loadPlayerRiotIds()
      this.previewFormations()
    },

    async _loadUnformationedCount() {
      try {
        const enc = s => encodeURIComponent(s)
        const res = await fetch(
          `${PB}/api/collections/matches/records?perPage=1&filter=${enc('formation="" && player_stats!=""')}`
        ).then(r => r.json())
        this.unformationedCount = res.totalItems ?? 0
      } catch (_) {}
    },

    async _computeFormationMatches() {
      const [fData, mData, pData] = await Promise.all([
        api.col('formations').list({ perPage: 100 }),
        api.col('matches').list({ perPage: 500, filter: 'formation="" && player_stats!=""' }),
        api.col('players').list({ perPage: 200 }),
      ])
      const formations = fData.items
      const matches    = mData.items
      const players    = pData.items
      const idToName   = Object.fromEntries(players.map(p => [p.id, p.name]))

      const toUpdate   = []
      const allMatches = []
      for (const m of matches) {
        const { match: f, score, total, candidates } = detectFormation(m, formations, players)
        const lineup = extractLineup(m, players)
        const missing = ['top','jungle','mid','adc','support'].filter(r => !lineup[r])
        const lineupNames = Object.fromEntries(
          Object.entries(lineup).map(([role, id]) => [role, id ? (idToName[id] ?? id) : null])
        )
        const base = {
          id: m.id, date: m.date?.slice(0, 10) ?? '—', game_n: m.game_n,
          lineup, lineupNames, score, total, missing,
          candidates: candidates.map(c => c.name),
        }
        if (f && score === 5 && total === 5) {
          toUpdate.push({ matchId: m.id, formationId: f.id })
          allMatches.push({ ...base, confidence: 'safe', formationName: f.name })
        } else {
          let reason = ''
          if (missing.length > 0)         reason = `Roles sem dados: ${missing.join(', ')}`
          else if (candidates.length > 1) reason = `Ambíguo: ${candidates.map(c => c.name ?? c).join(' / ')}`
          else if (score < 5)             reason = `Nenhuma formação compatível (${score}/${total})`
          allMatches.push({ ...base, confidence: 'partial', reason })
        }
      }
      return { formations, players, toUpdate, allMatches }
    },

    async previewFormations() {
      try {
        const { toUpdate, allMatches } = await this._computeFormationMatches()
        this.assignResult = {
          assigned: 0,
          skipped:  allMatches.filter(m => m.confidence === 'partial').length,
          allMatches,
          skippedMatches: allMatches.filter(m => m.confidence === 'partial'),
        }
        this.unformationedCount = toUpdate.length
      } catch (e) {
        console.error('[import] previewFormations failed:', e)
      }
    },

    async assignFormations() {
      this.assigningFormations = true
      this.assignResult = null
      try {
        const { toUpdate, allMatches } = await this._computeFormationMatches()

        await Promise.all(
          toUpdate.map(({ matchId, formationId }) =>
            api.col('matches').update(matchId, { formation: formationId })
          )
        )

        // Clear the message after successful import
        this.assignResult = null
        this.unformationedCount = Math.max(0, this.unformationedCount - toUpdate.length)
      } catch (e) {
        console.error('[import] assignFormations failed:', e)
        alert('Erro ao atribuir formações: ' + (e.message ?? JSON.stringify(e)))
      }
      this.assigningFormations = false
    },

    // ── Missing data ───────────────────────────────────────────────────────
    async loadMissing() {
      try {
        const enc = s => encodeURIComponent(s)
        const [gd, kda, snap] = await Promise.all([
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('gd_f = null')}`).then(r => r.json()),
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('team_kills = null')}`).then(r => r.json()),
          fetch(`${PB}/api/collections/matches/records?perPage=1&filter=${enc('riot_match_id != "" && riot_match_snapshot = null')}`).then(r => r.json()),
        ])
        this.missingRows = []
        if (gd.totalItems)  this.missingRows.push({ n: gd.totalItems,  label: 'sem diferença de ouro (GD@F)' })
        if (kda.totalItems) this.missingRows.push({ n: kda.totalItems, label: 'sem K/D do time' })
        this.snapshotCount = snap.totalItems ?? 0
      } catch (_) {}

      try {
        const enc = s => encodeURIComponent(s)
        const res = await fetch(
          `${PB}/api/collections/matches/records?perPage=200&sort=-date&filter=${enc('riot_match_id = ""')}&fields=id,date,win,side,game_n,duration`
        ).then(r => r.json())
        this.unpairedPbMatches = res.items ?? []
      } catch (_) {}
    },

    async fetchMissingSnapshots() {
      if (!this.apiKey) return alert('Configure a chave de API primeiro.')
      this.fetchingSnapshots = true
      const onStatus = m => this.setStatus(m)
      try {
        const enc = s => encodeURIComponent(s)
        const res = await fetch(
          `${PB}/api/collections/matches/records?perPage=200&filter=${enc('riot_match_id != "" && riot_match_snapshot = null')}&fields=id,riot_match_id`
        ).then(r => r.json())
        const matches = res.items ?? []
        let done = 0
        for (const m of matches) {
          const base = `https://${RiotApi.clusterFromMatchId(m.riot_match_id)}.api.riotgames.com`
          this.setStatus(`Snapshot ${++done}/${matches.length}…`)
          const match    = await RiotApi.fetch(`${base}/lol/match/v5/matches/${m.riot_match_id}`, this.apiKey, { onStatus })
          await RiotApi.sleep(80)
          const timeline = await RiotApi.fetch(`${base}/lol/match/v5/matches/${m.riot_match_id}/timeline`, this.apiKey, { onStatus })
          await RiotApi.sleep(80)
          await api.col('matches').update(m.id, { riot_match_snapshot: stripSnapshot({ match, timeline }) })
        }
        this.setStatus(`${matches.length} snapshot(s) atualizados.`, 'ok')
        await this.loadMissing()
      } catch (e) {
        this.setStatus(e.message, 'error')
      }
      this.fetchingSnapshots = false
    },

    async loadWrongImports() {
      try {
        const enc = s => encodeURIComponent(s)
        const res = await fetch(
          `${PB}/api/collections/matches/records?perPage=200&sort=-date&filter=${enc('riot_match_id != "" && duration > 0 && duration < 10')}&fields=id,date,win,side,game_n,duration,mvp`
        ).then(r => r.json())
        this.wrongImports = res.items ?? []
      } catch (_) {}
    },

    async clearWrongImport(id) {
      const payload = {
        riot_match_id: '', riot_match_snapshot: null, player_stats: [], our_champs: [],
        team_kills: null, team_deaths: null, team_assists: null,
        total_gold: null, damage: null, da_di: null,
        gold_per_min: null, wards_per_min: null, vision_score: null,
        cs_total: null, cs_per_min: null,
        first_blood: false, first_tower: false, obj_flow: '',
        gd_f: null, gd_10: null, gd_20: null, duration: null,
      }
      await api.col('matches').update(id, payload)
      this.wrongImports = this.wrongImports.filter(m => m.id !== id)
    },

    async clearAllWrongImports() {
      if (!confirm(`Limpar ${this.wrongImports.length} associação(ões) incorreta(s)?\n\nStats e composição serão apagados. Data e resultado são mantidos — corrija pelo CSV se necessário.`)) return
      try {
        for (const m of [...this.wrongImports]) {
          await this.clearWrongImport(m.id)
          await RiotApi.sleep(80)
        }
      } catch (e) { this.setStatus(e.message, 'error') }
    },

    async loadMismatchImports() {
      try {
        const enc = s => encodeURIComponent(s)
        const res = await fetch(
          `${PB}/api/collections/matches/records?perPage=500&sort=-date` +
          `&filter=${enc('riot_match_id != ""')}&fields=id,date,win,side,game_n,our_champs,player_stats`
        ).then(r => r.json())

        const items = res.items ?? []

        this.mismatchImports = items.filter(m => {
          const parseArr = v => {
            if (Array.isArray(v)) return v
            if (typeof v === 'string') { try { return JSON.parse(v) } catch { return [] } }
            return []
          }
          const ourNorm  = parseArr(m.our_champs).map(normChampKey).filter(Boolean)
          const riotNorm = parseArr(m.player_stats).map(p => normChampKey(p?.champion)).filter(Boolean)
          if (riotNorm.length < 5) return false   // sem dados Riot importados
          if (ourNorm.length < 3)  return false   // poucos campeões cadastrados
          return ourNorm.filter(c => riotNorm.includes(c)).length < 5  // qualquer diferença é suspeita
        })
      } catch (e) {
        console.error('[mismatch] erro ao carregar:', e)
      }
    },

    async clearMismatchImport(id) {
      const payload = {
        riot_match_id: '', riot_match_snapshot: null, player_stats: [],
        // our_champs: NÃO apagado — dado original do CSV
        team_kills: null, team_deaths: null, team_assists: null,
        total_gold: null, damage: null, da_di: null,
        gold_per_min: null, wards_per_min: null, vision_score: null,
        cs_total: null, cs_per_min: null,
        first_blood: false, first_tower: false, obj_flow: '',
        gd_f: null, gd_10: null, gd_20: null, duration: null,
      }
      await api.col('matches').update(id, payload)
      this.mismatchImports = this.mismatchImports.filter(m => m.id !== id)
    },

    async clearAllMismatchImports() {
      if (!confirm(`Limpar ${this.mismatchImports.length} associação(ões) com campeões errados?\n\nStats Riot apagados. Campeões cadastrados (our_champs) são mantidos.`)) return
      try {
        for (const m of [...this.mismatchImports]) {
          await this.clearMismatchImport(m.id)
          await RiotApi.sleep(80)
        }
      } catch (e) { this.setStatus(e.message, 'error') }
    },

    async loadBrokenPlayerRefs() {
      try {
        const [mData, pData, fData] = await Promise.all([
          api.col('matches').list({
            perPage: 200, sort: '-date',
            filter: 'riot_match_snapshot != "" && (mvp = "" || formation = "")',
            expand: 'mvc',
            fields: 'id,date,win,side,game_n,player_stats,mvc,mvp,formation,expand.mvc.key',
          }),
          api.col('players').list({ perPage: 200, fields: 'id,name,riot_id,puuid' }),
          api.col('formations').list({ perPage: 200 }),
        ])

        const players = pData.items ?? []
        const formations = fData.items ?? []
        const puuidToId = Object.fromEntries(players.filter(p => p.puuid).map(p => [p.puuid, p.id]))
        const idToName = Object.fromEntries(players.map(p => [p.id, p.name]))
        const findPlayerId = buildPlayerLookup(players, puuidToId)

        this.brokenPlayerRefs = (mData.items ?? []).map(m => {
          const stats = Array.isArray(m.player_stats) ? m.player_stats
            : (typeof m.player_stats === 'string' ? JSON.parse(m.player_stats) : [])
          const mvcKey = m.expand?.mvc?.key ?? null
          const needsMvp = !m.mvp
          const needsFormation = !m.formation

          let confidence = 'partial', reason = ''
          let _mvpName = null, _formationName = null

          // ── MVP classification (only if mvp is empty) ──
          if (needsMvp) {
            if (mvcKey) {
              const mvcEntry = stats.find(ps => normChampKey(ps.champion) === normChampKey(mvcKey))
              if (mvcEntry) {
                confidence = 'safe'
                const resolvedId = findPlayerId(mvcEntry.name, mvcEntry.puuid)
                _mvpName = resolvedId ? idToName[resolvedId] : mvcEntry.name
              } else {
                reason = `Campeão MVC "${mvcKey}" não encontrado em player_stats`
              }
            } else {
              reason = 'Sem MVC cadastrado — MVP pelo maior KDA'
            }
          }

          // ── Formation classification (only if formation is empty) ──
          if (needsFormation) {
            if (!needsMvp) {
              // MVP já preenchido → só falta formação → snapshot garante resolução → sempre Garantido
              confidence = 'safe'
            }
            const detection = detectFormation(m, formations, players)
            _formationName = detection.match?.name ?? null

            // If formation not detected in preview, extract the 5 players for display
            if (!_formationName) {
              const lineup = extractLineup(m, players)
              const ROLES = ['top', 'jng', 'mid', 'adc', 'sup']
              const playerNames = ROLES.map(r => lineup[r] ? (idToName[lineup[r]] ?? '?') : '?').filter(n => n !== '?')
              if (playerNames.length === 5) {
                _formationName = playerNames.join(', ')
              }
            }
          }

          return { ...m, confidence, reason, _mvpName, _formationName, needsMvp, needsFormation }
        })
      } catch (_) {}
    },

    async _reprocessMatches(ids) {
      if (!ids.length) return
      const idFilter = ids.map(id => `id="${id}"`).join(' || ')
      try {
        const [mData, pData, fData] = await Promise.all([
          api.col('matches').list({
            perPage: 200,
            filter: `(${idFilter}) && riot_match_snapshot != ""`,
            expand: 'mvc',
            fields: 'id,player_stats,riot_match_snapshot,top_player,mvc,mvp,formation,expand.mvc.key',
          }),
          api.col('players').list({ perPage: 200, fields: 'id,name,riot_id,puuid' }),
          api.col('formations').list({ perPage: 200 }),
        ])

        const players = pData.items ?? []
        const formations = fData.items ?? []
        const puuidToPlayerId = Object.fromEntries(
          players.filter(p => p.puuid).map(p => [p.puuid, p.id])
        )

        let updated = 0
        for (const m of (mData.items ?? [])) {
          const snapshot = m.riot_match_snapshot
          if (!snapshot) continue

          const participants = snapshot.match?.info?.participants ?? []

          // Build champion+role → PUUID map from snapshot
          const champRoleToInfo = {}
          for (const p of participants) {
            const champKey = normChampKey(p.championName)
            const role = p.teamPosition
            if (champKey && role) champRoleToInfo[`${champKey}_${role}`] = p.puuid
          }

          // Enrich player_stats with puuid via champion+role cross-reference
          const stats = Array.isArray(m.player_stats) ? m.player_stats
            : (typeof m.player_stats === 'string' ? JSON.parse(m.player_stats) : [])

          const enrichedStats = stats.map(ps => {
            if (ps.puuid) return ps
            const champKey = normChampKey(ps.champion)
            const puuid = champRoleToInfo[`${champKey}_${ps.role}`]
            return puuid ? { ...ps, puuid } : ps
          })

          // MVP: prioridade = jogador que usou o campeão do mvc cadastrado
          //      fallback   = maior KDA score entre jogadores identificados
          let mvpId = null
          const mvcKey = m.expand?.mvc?.key ?? null
          if (mvcKey) {
            const mvcEntry = enrichedStats.find(ps => normChampKey(ps.champion) === normChampKey(mvcKey))
            if (mvcEntry?.puuid) mvpId = puuidToPlayerId[mvcEntry.puuid] ?? null
          }
          if (!mvpId) {
            let bestScore = -Infinity
            for (const ps of enrichedStats) {
              if (!ps.puuid) continue
              const pId = puuidToPlayerId[ps.puuid]
              if (!pId) continue
              const score = (ps.kills ?? 0) * 2 + (ps.assists ?? 0) - (ps.deaths ?? 0) * 0.5
              if (score > bestScore) { bestScore = score; mvpId = pId }
            }
          }

          // Formation: detect with PUUID-enriched stats
          const detection = detectFormation({ ...m, player_stats: enrichedStats }, formations, players)
          const formationId = detection.match?.id ?? ''

          const payload = { player_stats: enrichedStats }
          // Only set fields that are currently empty (don't overwrite existing data)
          if (!m.mvp && mvpId) payload.mvp = mvpId
          if (!m.formation && formationId) payload.formation = formationId

          await api.col('matches').update(m.id, payload)
          await RiotApi.sleep(80)
          updated++
        }

        this.setStatus(`Re-processadas ${updated} partida(s).`, 'ok')
        await this.loadBrokenPlayerRefs()
        await this.previewFormations()
      } catch (e) {
        this.setStatus('Erro ao re-processar: ' + (e.message ?? JSON.stringify(e)), 'error')
      }
    },

    async reprocessSafePlayerRefs() {
      const safe = this.brokenPlayerRefs.filter(m => m.confidence === 'safe')
      if (!safe.length) return
      if (!confirm(`Re-processar ${safe.length} partida(s) Garantido?`)) return
      this.reprocessing = true
      try {
        await this._reprocessMatches(safe.map(m => m.id))
      } finally {
        this.reprocessing = false
      }
    },

    async reprocessPlayerRefs() {
      if (!this.brokenPlayerRefs.length) return
      if (!confirm(`Re-processar ${this.brokenPlayerRefs.length} partida(s)?`)) return
      this.reprocessing = true
      try {
        await this._reprocessMatches(this.brokenPlayerRefs.map(m => m.id))
      } finally {
        this.reprocessing = false
      }
    },

    async _loadPlayerRiotIds() {
      try {
        const res = await api.col('players').list({ perPage: 50, fields: 'riot_id' })
        this.playerRiotIds = res.items.map(p => p.riot_id).filter(Boolean)
      } catch (_) {}
    },

    // ── Fetch Riot matches ─────────────────────────────────────────────────
    async fetchMatches() {
      if (!this.apiKey) { this.setStatus('Insira uma chave de API primeiro.', 'error'); return }
      if (!this.summoner.includes('#')) {
        this.setStatus('Insira o Riot ID no formato Nome#Tag (ex: GdN#BR1)', 'error'); return
      }
      if (!this.startDate || !this.endDate || this.startDate > this.endDate) {
        this.setStatus('Intervalo de datas inválido.', 'error'); return
      }

      localStorage.setItem('riot-api-key',  this.apiKey)
      localStorage.setItem('riot-region',   this.region)
      localStorage.setItem('riot-summoner', this.summoner)

      const base    = RiotApi.baseUrl(this.region)
      const onStatus = m => this.setStatus(m)
      this.showResults = false

      try {
        // ── 1. PUUID (cache 24h) ───────────────────────────────────────────
        this.setStatus('Buscando conta…')
        const puuid = await RiotApi.resolvePuuid(this.summoner, this.apiKey, base)

        // ── 2. Jogadores ───────────────────────────────────────────────────
        this.setStatus('Carregando jogadores…')
        const puuidToName = {}
        const puuidToId   = {}
        const knownPuuids = new Set()
        try {
          const players = await api.col('players').list({ perPage: 50 })
          for (const p of players.items) {
            if (p.puuid) {
              puuidToName[p.puuid] = p.name
              puuidToId[p.puuid]   = p.id
              knownPuuids.add(p.puuid)
            }
          }
        } catch (_) {}

        // ── 3. IDs semanais (cache para semanas passadas) ──────────────────
        const weeks  = this._buildWeeks(this.startDate, this.endDate)
        const nowSec = Math.floor(Date.now() / 1000)
        const allMatchIds = []

        for (let wi = 0; wi < weeks.length; wi++) {
          const { startTime, endTime, label } = weeks[wi]
          const idsKey = `riot-ids-${puuid}-${startTime}-${endTime}`
          const isPast = endTime < nowSec - 3600
          let ids = isPast ? RiotApi.cache.get(idsKey) : null

          if (!ids) {
            this.setStatus(`Buscando semana ${wi + 1}/${weeks.length} (${label})…`)
            ids = await RiotApi.fetch(
              `${base}/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${startTime}&endTime=${endTime}&count=100`,
              this.apiKey, { onStatus }
            )
            if (isPast) RiotApi.cache.set(idsKey, ids)
            if (ids.length > 0) await RiotApi.sleep(80)
          }
          allMatchIds.push(...ids)
        }

        const uniqueIds = [...new Set(allMatchIds)]
        if (!uniqueIds.length) { this.setStatus('Nenhuma partida encontrada no período.'); return }

        // ── 4. Registros manuais carregados antes do scan (associação imediata) ──
        this.setStatus('Carregando registros manuais…')
        const pbRes = await fetch(
          `${PB}/api/collections/matches/records?perPage=200&sort=-date&fields=id,date,side,win,game_n,gd_f,team_kills,riot_match_id,player_stats,our_champs,duration`
        ).then(r => r.json())
        const pbMatches = pbRes.items || []

        // Mostra área de resultados agora — cards aparecem conforme são encontrados
        this.matchPairs  = []
        this.cards       = []
        this.showResults = true

        // ── 5. Summary por partida (cache agressivo, cards progressivos) ───
        const n = uniqueIds.length

        for (let i = 0; i < n; i++) {
          const matchId = uniqueIds[i]
          let summary = RiotApi.cache.get(`riot-summary-${matchId}`)

          if (!summary) {
            this.setStatus(`Verificando ${i + 1}/${n} (${this.cards.length} do time)…`)
            const match = await RiotApi.fetch(`${base}/lol/match/v5/matches/${matchId}`, this.apiKey, { onStatus })
            await RiotApi.sleep(80)

            const participants = match.info?.participants ?? []
            if (!participants.find(p => p.puuid === puuid)) {
              RiotApi.cache.set(`riot-summary-${matchId}`, { teamComplete: false, _ts: Date.now() })
              continue
            }

            if (RiotApi.countRosterOnSameTeam(participants, knownPuuids) < 5) {
              RiotApi.cache.set(`riot-summary-${matchId}`, { teamComplete: false, _ts: Date.now() })
              continue
            }

            this.setStatus(`Timeline — partida do time ${this.cards.length + 1}…`)
            const timeline = await RiotApi.fetch(`${base}/lol/match/v5/matches/${matchId}/timeline`, this.apiKey, { onStatus })
            await RiotApi.sleep(80)

            const stats = extractMatchStats(match, timeline, { knownPuuidSet: knownPuuids, puuidToName, puuidToId })
            if (!stats) {
              RiotApi.cache.set(`riot-summary-${matchId}`, { teamComplete: false, _ts: Date.now() })
              continue
            }

            summary = {
              teamComplete: true,
              ourChamps:   stats.ourChampKeys,
              enemyChamps: stats.enemyChampKeys,
              stats,
            }
            RiotApi.cache.set(`riot-summary-${matchId}`, summary)
          }

          if (!summary.teamComplete) continue
          if ((summary.stats?.duration ?? 99) < 10) continue  // remake

          // Adiciona o card imediatamente — UI atualiza em tempo real
          this._addCard(matchId, summary, pbMatches)
        }

        if (!this.cards.length) {
          this.showResults = false
          this.setStatus('Nenhuma partida com o time completo encontrada no período.')
          return
        }
        this.setStatus('')

      } catch (e) {
        this.setStatus(e.message, 'error')
        console.error(e)
      }
    },

    _buildWeeks(startStr, endStr) {
      const weeks = []
      const end = new Date(endStr)
      end.setHours(23, 59, 59, 999)
      let cur = new Date(startStr)
      while (cur <= end) {
        const weekEnd = new Date(cur)
        weekEnd.setDate(weekEnd.getDate() + 6)
        weekEnd.setHours(23, 59, 59, 999)
        if (weekEnd > end) weekEnd.setTime(end.getTime())
        weeks.push({
          startTime: Math.floor(cur.getTime() / 1000),
          endTime:   Math.floor(weekEnd.getTime() / 1000),
          label:     cur.toISOString().slice(0, 10),
        })
        cur.setDate(cur.getDate() + 7)
      }
      return weeks
    },

    // ── Cache delegates ──────────────────────────────────────────────────
    _cacheCount() { return RiotApi.cache.count() },

    clearCache() {
      const count = RiotApi.cache.clear()
      this.setStatus(`Cache limpo (${count} entradas removidas).`, 'ok')
    },

    // Retorna nomes de campeões do registro manual:
    // prefere player_stats (Riot API key), cai back em our_champs (DDragon display name).
    _pbChampNames(pb) {
      if (!pb) return []
      if (pb.player_stats?.length >= 5) return pb.player_stats.map(p => p.champion)
      if (pb.our_champs?.length  >= 5) return pb.our_champs
      return []
    },

    // ── Add single card (called progressively as each team match is found) ──
    _addCard(riotId, summary, pbMatches) {
      const stats = summary.stats

      if (pbMatches.some(m => m.riot_match_id === riotId)) return

      const candidates = this._rankPbCandidates(stats, summary, pbMatches)
      const best       = candidates[0] ?? null
      const autoSafe   = best != null && best.confidence >= 3
      const canImport  = best != null

      this.matchPairs.push({ riotId, stats, pbId: best?.pb?.id ?? null, canImport })
      const pb = best?.pb ?? null
      this.cards.push({
        riotId,
        stats,
        summary,
        pb,
        confidence:   best?.confidence ?? 0,
        confLabel:    best?.label ?? 'Sem registro',
        champScore:   best?.champScore ?? 0,
        confDetail:   best?.detail ?? '',
        candidates,
        hasData:      false,
        autoSafe,
        canImport,
        manualPbId:   best?.pb?.id ?? null,
        pbChampNames: this._pbChampNames(pb),
        riotChamps:   stats.playerStats.map(p => ({
          champion: p.champion,
          name:     p.name,
          kda:      `${p.kills}/${p.deaths}/${p.assists}`,
        })),
      })
    },

    _rankPbCandidates(stats, summary, pbMatches) {
      const ourNorm   = (summary.ourChamps   ?? stats.ourChampKeys ?? stats.playerStats.map(p => p.champion))
        .map(normChampKey).filter(Boolean)
      const enemyNorm = (summary.enemyChamps ?? stats.enemyChampKeys ?? [])
        .map(normChampKey).filter(Boolean)

      return pbMatches
        .filter(m => !m.riot_match_id)
        .map(m => {
          const pbChamps = this._pbChampNames(m).map(normChampKey).filter(Boolean)
          let champScore = 0
          if (pbChamps.length === 5) {
            champScore = ourNorm.filter(c => pbChamps.includes(c)).length
          }

          const dateDiff = Math.abs(
            new Date(m.date?.slice(0,10)).getTime() - new Date(stats.date).getTime()
          ) / 86400000
          const sideMatch = m.side === stats.side
          const winMatch  = m.win  === stats.win

          let confidence, label, detail
          if (champScore === 5) {
            confidence = 4; label = 'Garantido'; detail = ''
          } else if (champScore >= 3) {
            confidence = 3; label = 'Alta confiança'
            detail = `Campeões: ${champScore}/5 coincidem — faltam ${5 - champScore} para Garantido`
          } else if (champScore >= 2) {
            confidence = 2; label = 'Confiança média'
            const missing = ourNorm.filter(c => !pbChamps.includes(c))
            detail = `Campeões: ${champScore}/5 coincidem — falta 1 para Alta confiança`
                   + (missing.length ? ` (sem match: ${missing.join(', ')})` : '')
          } else if (dateDiff === 0 && sideMatch && winMatch) {
            if (pbChamps.length === 5 && champScore === 0) {
              confidence = 1; label = 'Baixa confiança'
              detail = 'Data, lado e vitória coincidem — campeões no registro não correspondem (verifique)'
            } else if (pbChamps.length === 5 && champScore === 1) {
              confidence = 2; label = 'Confiança média'
              detail = `Data, lado e vitória coincidem — apenas 1/5 campeões correspondem`
            } else {
              confidence = 3; label = 'Alta confiança'
              if (pbChamps.length === 0) {
                detail = 'Data, lado e vitória coincidem — sem campeões no registro para confirmar'
              } else {
                detail = `Data, lado e vitória coincidem — campeões incompletos no registro (${pbChamps.length}/5 preenchidos)`
              }
            }
          } else if (dateDiff <= 1 && sideMatch && winMatch) {
            confidence = 2; label = 'Confiança média'
            detail = `Data ±1 dia — Riot: ${stats.date} · Manual: ${m.date?.slice(0,10)} (possível virada de meia-noite)`
          } else if (dateDiff <= 1 && (sideMatch || winMatch)) {
            confidence = 1; label = 'Baixa confiança'
            const sideTxt = !sideMatch ? `lado diverge (Riot: ${stats.side} · Manual: ${m.side ?? '—'})` : null
            const winTxt  = !winMatch  ? `vitória diverge (Riot: ${stats.win ? 'V' : 'D'} · Manual: ${m.win ? 'V' : 'D'})` : null
            detail = [sideTxt, winTxt].filter(Boolean).join(' · ')
          } else {
            confidence = 0; label = 'Sem sinal'; detail = ''
          }

          return { pb: m, confidence, label, detail, champScore, dateDiff, sideMatch, winMatch }
        })
        .filter(c => c.confidence > 0)
        .sort((a, b) => b.confidence - a.confidence)
    },

    pbSelectOptions(card) {
      const riotNorms = card.riotChamps.map(r => normChampKey(r.champion))
      const fmt = m => {
        const gameN = m.game_n != null ? `J${m.game_n}` : '—'
        const date  = m.date?.slice(0,10) ?? '—'
        const wr    = m.win ? 'V' : 'D'
        const side  = m.side ?? '—'
        const dur   = m.duration ? ` · ${m.duration}min` : ''
        return `${gameN} · ${date} · ${wr} · ${side}${dur}`
      }
      const champHint = m => {
        const champs = this._pbChampNames(m)
        if (!champs.length) return ''
        const hits = champs.filter(c => riotNorms.includes(normChampKey(c))).length
        return ` · ${hits}/5 champs`
      }
      const candIds = new Set(card.candidates.map(c => c.pb.id))
      return [
        ...card.candidates.map(c => ({ id: c.pb.id, label: `[${c.label}${champHint(c.pb)}] ${fmt(c.pb)}` })),
        ...this.unpairedPbMatches.filter(m => !candIds.has(m.id)).map(m => ({ id: m.id, label: fmt(m) })),
      ]
    },

    selectPb(card) {
      const pbId = card.manualPbId
      const pair = this.matchPairs.find(p => p.riotId === card.riotId)

      if (!pbId) {
        card.pb         = null
        card.confidence = 0
        card.confLabel  = 'Sem registro'
        card.canImport  = false
        card.autoSafe   = false
        if (pair) { pair.pbId = null; pair.canImport = false }
        return
      }

      const cand = card.candidates.find(c => c.pb.id === pbId)
      if (cand) {
        card.pb         = cand.pb
        card.confidence = cand.confidence
        card.confLabel  = cand.label
        card.confDetail = cand.detail ?? ''
        card.champScore = cand.champScore
      } else {
        card.pb         = this.unpairedPbMatches.find(m => m.id === pbId) ?? null
        card.confidence = 0
        card.confLabel  = 'Manual'
        card.confDetail = ''
        card.champScore = 0
      }

      card.pbChampNames = this._pbChampNames(card.pb)
      card.canImport = true
      card.autoSafe  = card.confidence >= 3
      if (pair) { pair.pbId = pbId; pair.canImport = true }
    },

    // ── Import — full JSON fetched here, never cached in localStorage ──────
    async importSingle(riotId) {
      const pair = this.matchPairs.find(p => p.riotId === riotId)
      const card = this.cards.find(c => c.riotId === riotId)
      const pbId = card?.manualPbId ?? pair?.pbId ?? null
      if (!pbId || !pair) return

      const base     = RiotApi.baseUrl(this.region)
      const onStatus = m => this.setStatus(m)
      this.setStatus('Baixando dados completos para importar…')
      try {
        const match    = await RiotApi.fetch(`${base}/lol/match/v5/matches/${riotId}`, this.apiKey, { onStatus })
        await RiotApi.sleep(80)
        const timeline = await RiotApi.fetch(`${base}/lol/match/v5/matches/${riotId}/timeline`, this.apiKey, { onStatus })

        const payload = RiotApi.buildMatchPayload(pair.stats, { riotId, snapshot: { match, timeline } })
        await api.col('matches').update(pbId, payload)

        this.setStatus('Importado. Atualizando…', 'ok')
        await this.loadMissing()
        await this.fetchMatches()
      } catch (e) { this.setStatus(e.message, 'error') }
    },

    async importAll() {
      const safeCards = this.cards.filter(c => c.autoSafe && c.manualPbId && !c.hasData)
      if (!safeCards.length) { this.setStatus('Nenhuma partida segura para importar automaticamente.'); return }
      this.setStatus(`Baixando e importando ${safeCards.length} partidas…`)
      try {
        const base     = RiotApi.baseUrl(this.region)
        const onStatus = m => this.setStatus(m)
        for (const card of safeCards) {
          const pair = this.matchPairs.find(p => p.riotId === card.riotId)
          if (!pair) continue
          this.setStatus(`Importando ${card.riotId.slice(-6)}…`)
          const match    = await RiotApi.fetch(`${base}/lol/match/v5/matches/${card.riotId}`, this.apiKey, { onStatus })
          await RiotApi.sleep(80)
          const timeline = await RiotApi.fetch(`${base}/lol/match/v5/matches/${card.riotId}/timeline`, this.apiKey, { onStatus })

          const payload = RiotApi.buildMatchPayload(pair.stats, { riotId: card.riotId, snapshot: { match, timeline } })
          await api.col('matches').update(card.manualPbId, payload)
          await RiotApi.sleep(80)
        }
        this.setStatus(`Concluído — ${safeCards.length} partidas importadas.`, 'ok')
        await this.loadMissing()
        await this.fetchMatches()
      } catch (e) { this.setStatus(e.message, 'error') }
    },

    // ── Helpers ────────────────────────────────────────────────────────────
    setStatus(msg, type = 'info') {
      this.statusMsg  = msg
      this.statusType = type
    },

    get statusCls() {
      return ({ info:'text-slate-400', error:'text-red-400', ok:'text-green-400' })[this.statusType] ?? 'text-slate-400'
    },

    fmtGdf(v)  { return (v >= 0 ? '+' : '') + v.toLocaleString('en') },
    gdfCls(v)  { return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-slate-400' },
  }))
})
