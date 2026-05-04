#!/usr/bin/env node
/**
 * narrative-stats.js — relatório de performance dos atos narrativos
 *
 * Uso:
 *   npm run narrative-stats
 *   npm run narrative-stats -- --since=2026-05-01
 *   npm run narrative-stats -- --since=2026-04-01 --until=2026-04-30
 *
 * Mostra por ato:
 *   - Total disparado por variante (A/B)
 *   - Response rate
 *   - Distribuição de outcomes
 *   - Vencedor A/B se response rate significativo
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
    'trial_ended', 'upgraded_wingman', 'upgraded_pro',
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

  // Agrupa por act_id para determinar vencedor A/B
  const byAct = {};
  for (const row of stats) {
    if (!byAct[row.act_id]) byAct[row.act_id] = [];
    byAct[row.act_id].push(row);
  }

  for (const [actId, variants] of Object.entries(byAct)) {
    console.log(`  ─── ${actId} ───`);

    const header = `  ${pad('Variante', 10)} ${pad('Enviados', 9, true)} ${pad('Responderam', 12, true)} ${pad('Rate', 7, true)}`;
    console.log(header);

    let winner = null;
    let bestRate = -1;

    for (const v of variants) {
      const rate = v.sent > 0 ? (v.responded / v.sent * 100).toFixed(1) : '0.0';
      const rateNum = parseFloat(rate);
      if (rateNum > bestRate && v.sent >= 5) { bestRate = rateNum; winner = v.variant; }
      console.log(`  ${pad(v.variant, 10)} ${pad(v.sent, 9, true)} ${pad(v.responded, 12, true)} ${pad(rate + '%', 7, true)}`);
    }

    if (winner) {
      console.log(`  🏆 Variante ${winner} na frente (${bestRate.toFixed(1)}% response rate)`);
    }

    // Outcomes
    const allOutcomes = {};
    for (const v of variants) {
      for (const [oc, count] of Object.entries(v.outcomes || {})) {
        allOutcomes[oc] = (allOutcomes[oc] || 0) + count;
      }
    }
    if (Object.keys(allOutcomes).length > 0) {
      const outcomeStr = Object.entries(allOutcomes)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`)
        .join('  ');
      console.log(`  Outcomes: ${outcomeStr}`);
    }

    console.log('');
  }
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
