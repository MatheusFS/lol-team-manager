# Riot Match v5 — Dados Disponíveis

## Visão Geral

Cada partida importada usa duas chamadas de API:

- `GET /lol/match/v5/matches/{matchId}` — dados estáticos da partida
- `GET /lol/match/v5/matches/{matchId}/timeline` — frames minuto a minuto

Ambas são armazenadas em `riot_match_snapshot` no PocketBase.

---

## Dados da Partida (`match.info`)

### Nível de Equipe (`info.teams[]`)

| Campo | Descrição |
|-------|-----------|
| `teamId` | 100 = Blue, 200 = Red |
| `win` | Resultado da equipe |
| `objectives.tower.kills` / `.first` | Torres derrubadas + first tower |
| `objectives.champion.kills` / `.first` | Kills totais + first blood |
| `objectives.horde.kills` | Void Grubs |
| `objectives.riftHerald.kills` | Herald |
| `objectives.dragon.kills` | Dragões |
| `objectives.baron.kills` | Baron |
| `objectives.inhibitor.kills` | Inibidores |
| `objectives.nexus.kills` | Nexus |

### Nível Individual (`info.participants[]`)

| Campo | Descrição |
|-------|-----------|
| `championName` | ID interno do campeão (ex: `"Kaisa"`) |
| `teamPosition` / `individualPosition` | Role (TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY) |
| `teamId` | Liga ao time |
| `puuid` | Identificador único do jogador |
| `kills`, `deaths`, `assists` | KDA individual |
| `totalDamageDealtToChampions` | Dano causado a campeões inimigos |
| `totalDamageTaken` | Dano recebido total |
| `damageSelfMitigated` | Dano absorvido (escudos + resistências) |
| `goldEarned`, `goldSpent` | Ouro no jogo |
| `totalMinionsKilled`, `neutralMinionsKilled` | CS (lane + jungle) |
| `visionScore` | Pontuação de visão |
| `wardsPlaced`, `wardsKilled` | Wards colocadas / destruídas |
| `visionWardsBoughtInGame` | Control wards compradas |
| `champLevel` | Nível final do campeão |
| `firstBloodKill`, `firstBloodAssist` | Participou do first blood |
| `summoner1Id`, `summoner2Id` | IDs das summoner spells |
| `item0` … `item6` | Itens no final da partida |

### Bloco `challenges` (destaques)

| Campo | Descrição |
|-------|-----------|
| `kda` | KDA pré-computado pela Riot |
| `killParticipation` | % dos kills do time em que participou |
| `teamDamagePercentage` | Fatia do dano total da equipe |
| `damageTakenOnTeamPercentage` | Fatia do dano recebido (útil para tanks) |
| `visionScorePerMinute` | Visão normalizada por minuto |

---

## Dados de Timeline (`timeline.info.frames[]`)

Um frame por minuto do jogo. Cada frame contém:

- `participantFrames` — por participante: `totalGold`, `xp`, `minionsKilled`, `currentGold`, `level`
- `events` — kills, torres derrubadas, itens comprados, etc.

Permite calcular gold diff (ou XP diff) em qualquer minuto.

---

## Cálculos Derivados (o que já computamos)

| Campo salvo | Fórmula |
|-------------|---------|
| `duration` | `info.gameDuration / 60` (arredondado) |
| `team_kills`, `team_deaths`, `team_assists` | soma dos participantes do time |
| `total_gold` | soma de `goldEarned` do time |
| `damage` | soma de `totalDamageDealtToChampions` do time |
| `da_di` | `damage / totalDamageTaken` |
| `gold_per_min` | `total_gold / duration` |
| `wards_per_min` | `wardsPlaced / duration` |
| `vision_score` | soma de `visionScore` do time |
| `cs_total` | soma de minions + neutros do time |
| `cs_per_min` | `cs_total / duration` |
| `first_blood` | `objectives.champion.first` |
| `first_tower` | `objectives.tower.first` |
| `obj_flow` | `t/v/g/d/b/i/n` (kills de cada objetivo) |
| `gd_10` / `gd_20` | gold diff via frames do timeline no minuto 10/20 |
| `gd_f` | gold diff no último frame do timeline |
| `mvc` | campeão com maior `totalDamageDealtToChampions` |

---

## MVP (sugestão automática, confirmação humana)

### Algoritmo atual

```
score = (kills × 2) + assists − (deaths × 0.5)
sugestão = jogador com maior score
```

**Limitações:**
- Ignora visão, controle de objetivos e impacto de engage
- Sem penalidade para desconexão (0 kills, 0 mortes = score 0, não "ganha")
- Funciona razoavelmente bem para Clash carry-heavy, mas erra em jogadas de Engage ou Support

**Dados disponíveis para MVP mais rico (futuro):**
- `challenges.killParticipation` — participação em kills do time
- `challenges.teamDamagePercentage` — fatia de dano
- `challenges.damageTakenOnTeamPercentage` — fatia de dano recebido (tanks)
- `challenges.visionScorePerMinute` — impacto de visão

**Recomendação:** Pré-preenche o select com a sugestão, mas **requer confirmação humana**. O algoritmo é direcional, não captura quem "ganhou o jogo" com uma jogada decisiva.

---

## MVC (derivado do MVP — sem input humano)

```
mvc = campeão jogado pelo MVP
```

MVC não é uma métrica independente — é o campeão usado pelo jogador eleito MVP. Não faz sentido dissociar: o mesmo jogador que foi o mais valioso jogou com aquele campeão.

**Recomendação:** Calculado automaticamente a partir do MVP selecionado. Sem input manual.

---

## Dados NÃO disponíveis na API (input manual obrigatório)

| Campo | Motivo |
|-------|--------|
| `game_n` | Qual game do dia (1º, 2º, 3º…) — não existe na API |
| `comp_type` | Classificação estratégica da composição nossa |
| `comp_subtype` | Tags estratégicas (Siege, Dive, Reset…) |
| `scaling` | Avaliação Early/Mid/Late da nossa comp |
| `enemy_type` | Classificação da composição inimiga |
| `enemy_scaling` | Avaliação Early/Mid/Late do inimigo |
| `mvp` | Confirmação humana da sugestão automática |

---

## Campos read-only quando snapshot existe

| Campo | Fonte |
|-------|-------|
| `win` | `teams[].win` — determinístico |
| `side` | `teamId === 100` → Blue, 200 → Red — determinístico |

## Campos com auto-preenchimento + confirmação humana

| Campo | Fonte | Por quê manter como input |
|-------|-------|--------------------------|
| `date` | `info.gameStartTimestamp` | Correções de fuso horário acontecem |
| `top_player` | `teamPosition === TOP` + puuid→nome | Role swaps acontecem no Clash |
| `our_champs[5]` | participants ordenados | Role swaps acontecem no Clash |
| `enemy_champs[5]` | participants ordenados | Role swaps acontecem no Clash |
| `mvp` | score heurístico | Heurística ≠ julgamento humano |
