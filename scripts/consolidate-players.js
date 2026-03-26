#!/usr/bin/env node

/**
 * Script de Consolidação de Jogadores
 * 
 * Objetivo: Consolidar dados duplicados:
 * - Conkreto → Vitão (manter apenas Vitão)
 * - Klebão → Klé (manter apenas Klé)
 * 
 * Ação: Renomear player_stats[].name em todos os matches
 */

const http = require('http');

const PB_URL = 'http://127.0.0.1:8090';
const API_BASE = '/api/collections';

// Helper: fazer requisições HTTP
function pbRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(PB_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Main consolidation function
async function consolidate() {
  console.log('🔄 Iniciando consolidação de jogadores...\n');

  try {
    // Step 1: Listar todos os matches
    console.log('📥 Carregando matches...');
    const matchesResponse = await pbRequest('GET', `${API_BASE}/matches/records?perPage=500`);
    const matches = matchesResponse.items || [];
    console.log(`✓ ${matches.length} matches carregados\n`);

    // Step 2: Processar cada match
    let totalUpdated = 0;
    let conkretoCount = 0;
    let klebaoCount = 0;
    const updatedIds = [];

    console.log('🔍 Procurando occorrências de "Conkreto" e "Klebão"...');
    for (const match of matches) {
      if (!match.player_stats || !Array.isArray(match.player_stats)) continue;

      let hasConkreto = false;
      let hasKlebao = false;

      // Verificar e renomear
      for (const ps of match.player_stats) {
        if (ps.name === 'Conkreto') {
          ps.name = 'Vitão';
          hasConkreto = true;
          conkretoCount++;
        } else if (ps.name === 'Klebão') {
          ps.name = 'Klé';
          hasKlebao = true;
          klebaoCount++;
        }
      }

      // Se houve mudanças, atualizar o match
      if (hasConkreto || hasKlebao) {
        updatedIds.push(match.id);
        totalUpdated++;
      }
    }

    console.log(`  • Conkreto encontrado: ${conkretoCount} ocorrências`);
    console.log(`  • Klebão encontrado: ${klebaoCount} ocorrências`);
    console.log(`  • Matches a atualizar: ${totalUpdated}\n`);

    if (totalUpdated === 0) {
      console.log('⚠️  Nenhuma ocorrência encontrada. Nada para fazer.');
      return;
    }

    // Step 3: Confirmar antes de atualizar
    console.log('⚠️  Você está prestes a atualizar os dados no PocketBase.');
    console.log(`    ${totalUpdated} matches serão modificados.`);
    console.log('    Ctrl+C para cancelar, ou aguarde 3 segundos...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Atualizar cada match no PocketBase
    console.log('📤 Atualizando matches no PocketBase...');
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (!updatedIds.includes(match.id)) continue;

      try {
        await pbRequest('PATCH', `${API_BASE}/matches/records/${match.id}`, {
          player_stats: match.player_stats,
        });
        successCount++;
        process.stdout.write(`\r  [${successCount}/${totalUpdated}] matches atualizados...`);
      } catch (err) {
        failCount++;
        console.error(`\n  ❌ Erro ao atualizar ${match.id}: ${err.message}`);
      }
    }

    console.log(`\n\n✅ Atualização concluída!`);
    console.log(`  • Sucessos: ${successCount}`);
    console.log(`  • Falhas: ${failCount}\n`);

    // Step 5: Verificação pós-consolidação
    console.log('🔍 Executando verificação pós-consolidação...');
    const verifyResponse = await pbRequest('GET', `${API_BASE}/matches/records?perPage=500`);
    const verifyMatches = verifyResponse.items || [];

    let verifyConkreto = 0;
    let verifyKlebao = 0;
    for (const m of verifyMatches) {
      for (const ps of m.player_stats ?? []) {
        if (ps.name === 'Conkreto') verifyConkreto++;
        if (ps.name === 'Klebão') verifyKlebao++;
      }
    }

    console.log(`  • Conkreto encontrado: ${verifyConkreto}`);
    console.log(`  • Klebão encontrado: ${verifyKlebao}`);

    if (verifyConkreto === 0 && verifyKlebao === 0) {
      console.log('\n✅ Consolidação verificada com sucesso! Nenhuma ocorrência residual encontrada.\n');
    } else {
      console.log('\n⚠️  AVISO: Ainda existem ocorrências dos nomes antigos!\n');
    }

  } catch (err) {
    console.error('❌ Erro fatal:', err.message);
    process.exit(1);
  }
}

// Executar
consolidate().catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
