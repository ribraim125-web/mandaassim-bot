#!/usr/bin/env node
/**
 * narrative-stats.js — relatório de performance dos atos narrativos
 *
 * Uso:
 *   npm run narrative-stats
 *   npm run narrative-stats -- --since=2026-05-01
 *   npm run narrative-stats -- --since=2026-04-01 --until=2026-04-30
 *
 * Mostra:
 *   - Eventos de jornada no período
 *   - Por ato: total, response rate, conversão Parceiro/Pro, vencedor A/B
 *   - Tabela de conversão por ato de oferta (act_10, act_11, act_12, act_13)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getNarrativeStats } = require('../src/narrative/narrativeLog');
const { createClient }      = require('@supabase/supabase-js');

function parseArgs(argv) {
  const args = {};
  argv.forEach(arg => {
    const m = arg.match(/^--([a-z_]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  });
  return args;
}

function pad(str, len, right = false) {
  const s = String(str ?? '-');
  return right ? s.padStart(len) : s.padEnd(len);
}

async function getJourneyEventCounts(since, until) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const { data } = await supabase
    .from('user_journey_events')
    .select('event_type')
    .gte('created_at', new Date(since).toISOString())
    .lte('created_at', new Date(until).toISOString());

  const counts = {};
  (data || []).forEach(r => {
    counts[r.event_type] = (counts[r.event_type] || 0) + 1;
  });
  return counts;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL e SUPABASE_KEY obrigatórios no .env');
    process.exit(1);
  }

  const args  = parseArgs(process.argv.slice(2));
  const until = args.until ? new Date(args.until) : new Date();
  const since = args.since ? new Date(args.since) : (() => {
    const d = new Date(until);
    d.setDate(d.getDate() - 30);
    return d;
  })();

  console.log(`\n🎭 Relatório de Narrativa Progressiva`);
  console.log(`   Período: ${since.toISOString().slice(0, 10)} → ${until.toISOString().slice(0, 10)}\n`);

  const [stats, eventCounts] = await Promise.all([
    getNarrativeStats(since, until),
    getJourneyEventCounts(since, until),
  ]);

  // ── Eventos de jornada ────────────────────────────────────────────────────
  console.log('📍 Eventos de Jornada\n');
  const importantEvents = [
    'signup', 'first_message_sent', 'first_response_suggestion_received',
    'first_print_analyzed', 'third_print_analyzed',
    'hit_daily_limit_response', 'hit_daily_limit_print',
    'trial_ended', 'upgraded_parceiro', 'upgraded_pro',
    'first_profile_audit_done', 'first_her_profile_analyzed',
  ];
  for (const evt of importantEvents) {
    const count = eventCounts[evt] || 0;
    if (count > 0) {
      console.log(`   ${pad(evt, 42)} ${pad(count, 5, true)}`);
    }
  }

  if (stats.length === 0) {
    console.log('\nNenhum ato disparado no período.\n');
    return;
  }

  // ── Atos por act_id ───────────────────────────────────────────────────────
  console.log('\n📊 Performance dos Atos\n');
  console.log(`  ${'act_id'.padEnd(38)} ${'Var'.padEnd(6)} ${'Env'.padStart(5)} ${'Resp%'.padStart(7)} ${'→Parceiro'.padStart(10)} ${'→Pro'.padStart(6)}`);
  console.log(`  ${'─'.repeat(80)}`);

  // Agrupa por act_id para determinar vencedor A/B
  const byAct = {};
  for (const row of stats) {
    if (!byAct[row.act_id]) byAct[row.act_id] = [];
    byAct[row.act_id].push(row);
  }

  const OFFER_ACTS = ['act_10_oferta', 'act_11_objecao_garantia', 'act_12_ultima_chamada', 'act_13_reoferta_d1'];

  for (const [actId, variants] of Object.entries(byAct)) {
    let winner = null;
    let bestRate = -1;
    const isOfferAct = OFFER_ACTS.includes(actId);

    for (const v of variants) {
      const rate    = v.sent > 0 ? (v.responded / v.sent * 100).toFixed(1) : '0.0';
      const rateNum = parseFloat(rate);
      if (rateNum > bestRate && v.sent >= 5) { bestRate = rateNum; winner = v.variant; }

      // Contagem de conversões por plano
      const convDireto = Object.entries(v.outcomes || {}) // subscribed_parceiro*
        .filter(([k]) => k.startsWith('subscribed_parceiro') && !k.includes('pro'))
        .reduce((s, [, n]) => s + n, 0);
      const convPro = Object.entries(v.outcomes || {})
        .filter(([k]) => k.startsWith('subscribed_parceiro_pro'))
        .reduce((s, [, n]) => s + n, 0);

      const convDiretoStr = isOfferAct ? String(convDireto).padStart(9) : '-'.padStart(9);
      const convProStr    = isOfferAct ? String(convPro).padStart(6)    : '-'.padStart(6);

      console.log(`  ${actId.padEnd(38)} ${v.variant.padEnd(6)} ${String(v.sent).padStart(5)} ${(rate + '%').padStart(7)} ${convDiretoStr} ${convProStr}`);
    }

    if (winner) {
      console.log(`  ${''.padEnd(38)} 🏆 Variante ${winner} na frente (${bestRate.toFixed(1)}% resp)`);
    }

    // Outcomes detalhados apenas para atos de oferta
    if (isOfferAct) {
      const allOutcomes = {};
      for (const v of variants) {
        for (const [oc, count] of Object.entries(v.outcomes || {})) {
          if (oc !== 'pending') allOutcomes[oc] = (allOutcomes[oc] || 0) + count;
        }
      }
      if (Object.keys(allOutcomes).length > 0) {
        const outcomeStr = Object.entries(allOutcomes)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${v}`)
          .join('  ');
        console.log(`  ${'Outcomes:'.padEnd(45)} ${outcomeStr}`);
      }
    }
  }

  console.log();
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
