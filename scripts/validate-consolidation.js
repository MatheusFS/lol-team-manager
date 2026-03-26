#!/usr/bin/env node

/**
 * Script de Validação do Relatório "Mortes por Jogador"
 * 
 * Calcula o relatório com os dados consolidados para verificar
 * que os agregados estão corretos após a consolidação.
 */

const http = require('http');

const PB_URL = 'http://127.0.0.1:8090';
const API_BASE = '/api/collections';

function pbRequest(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(PB_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function validateReport() {
  console.log('📊 Validando Relatório "Mortes por Jogador"\n');

  try {
    // Carregar matches
    console.log('📥 Carregando matches...');
    const matchesResp = await pbRequest('GET', `${API_BASE}/matches/records?perPage=500`);
    const matches = matchesResp.items || [];
    const riotMatches = matches.filter(m => m.player_stats?.length);
    console.log(`✓ ${riotMatches.length} matches com dados Riot API\n`);

    // Agregar como o script stats-page.js faz
    const map = {};
    for (const m of riotMatches) {
      for (const ps of m.player_stats) {
        if (!ps.name) continue;
        const p = map[ps.name] ??= { n: 0, deathsTotal: 0, deathsW: 0, nW: 0, deathsL: 0, nL: 0, fbKills: 0 };
        p.n++;
        p.deathsTotal += ps.deaths ?? 0;
        if (m.win) { p.deathsW += ps.deaths ?? 0; p.nW++; }
        else { p.deathsL += ps.deaths ?? 0; p.nL++; }
        if (ps.firstBlood) p.fbKills++;
      }
    }

    // Montar rows como stats-page.js
    const rows = Object.entries(map)
      .map(([name, p]) => ({
        name,
        n: p.n,
        avgD: p.n ? p.deathsTotal / p.n : 0,
        avgDW: p.nW ? p.deathsW / p.nW : 0,
        avgDL: p.nL ? p.deathsL / p.nL : 0,
        fbKills: p.fbKills,
      }))
      .sort((a, b) => b.avgD - a.avgD);

    // Exibir resultados
    console.log('📋 Relatório Consolidado (ordenado por Mortes avg):\n');
    console.log('┌─────────────┬───┬──────────┬─────────┬─────────┬──────────┐');
    console.log('│ Jogador     │ N │ Mortes   │ avg(V)  │ avg(D)  │ FB Kills │');
    console.log('├─────────────┼───┼──────────┼─────────┼─────────┼──────────┤');

    for (const r of rows) {
      const jogador = r.name.padEnd(11);
      const n = String(r.n).padStart(3);
      const avgD = r.avgD.toFixed(1).padStart(8);
      const avgDW = r.nW ? r.avgDW.toFixed(1).padStart(7) : '—'.padStart(7);
      const avgDL = r.nL ? r.avgDL.toFixed(1).padStart(7) : '—'.padStart(7);
      const fbKills = String(r.fbKills).padStart(8);
      console.log(`│ ${jogador} │ ${n} │ ${avgD} │ ${avgDW} │ ${avgDL} │ ${fbKills} │`);
    }
    console.log('└─────────────┴───┴──────────┴─────────┴─────────┴──────────┘\n');

    // Verificações esperadas
    console.log('✅ Verificações:\n');

    const vitao = rows.find(r => r.name === 'Vitão');
    const kle = rows.find(r => r.name === 'Klé');

    if (vitao) {
      console.log(`  • Vitão: ${vitao.n} partidas (esperado: 94 = 25 + 69)`);
      console.log(`    → ${vitao.n === 94 ? '✓ CORRETO' : '✗ ERRADO'}`);
    } else {
      console.log('  • Vitão: NÃO ENCONTRADO');
    }

    if (kle) {
      console.log(`  • Klé: ${kle.n} partidas (esperado: 53 = 18 + 35)`);
      console.log(`    → ${kle.n === 53 ? '✓ CORRETO' : '✗ ERRADO'}`);
    } else {
      console.log('  • Klé: NÃO ENCONTRADO');
    }

    // Verificar que não há mais Conkreto ou Klebão
    const conkreto = rows.find(r => r.name === 'Conkreto');
    const klebao = rows.find(r => r.name === 'Klebão');

    console.log(`\n  • Conkreto residual: ${conkreto ? '✗ ENCONTRADO (ERRO!)' : '✓ Não encontrado'}`);
    console.log(`  • Klebão residual: ${klebao ? '✗ ENCONTRADO (ERRO!)' : '✓ Não encontrado'}`);

    if (!conkreto && !klebao && vitao?.n === 94 && kle?.n === 53) {
      console.log('\n✅ VALIDAÇÃO BEM-SUCEDIDA! Todos os dados estão consolidados corretamente.\n');
    } else {
      console.log('\n⚠️  VALIDAÇÃO FALHOU! Há inconsistências nos dados.\n');
    }

  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
}

validateReport().catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
