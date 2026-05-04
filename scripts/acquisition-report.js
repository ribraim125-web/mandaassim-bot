#!/usr/bin/env node
/**
 * acquisition-report.js — relatório de aquisição por canal
 *
 * Uso:
 *   npm run acquisition-report
 *   npm run acquisition-report -- --since=2026-05-01
 *   npm run acquisition-report -- --since=2026-04-01 --until=2026-04-30
 *
 * Mostra funil completo por source/medium/campaign:
 *   Cadastros → trial → free → wingman → pro
 *   Custo IA do cohort, LTV médio
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getAcquisitionStats } = require('../src/lib/acquisition');

// ── Parse args ────────────────────────────────────────────────────────────────

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
  if (right) return s.padStart(len);
  return s.padEnd(len);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL e SUPABASE_KEY obrigatórios no .env');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));

  const until = args.until ? new Date(args.until) : new Date();
  const since = args.since ? new Date(args.since) : (() => {
    const d = new Date(until);
    d.setDate(d.getDate() - 30);
    return d;
  })();

  console.log(`\n📊 Relatório de Aquisição`);
  console.log(`   Período: ${since.toISOString().slice(0, 10)} → ${until.toISOString().slice(0, 10)}\n`);

  let rows;
  try {
    rows = await getAcquisitionStats(since, until);
  } catch (err) {
    console.error('❌ Erro ao buscar dados:', err.message);
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log('Nenhum cadastro no período.\n');
    return;
  }

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  const cols = [
    { label: 'Source',    width: 12 },
    { label: 'Medium',    width: 12 },
    { label: 'Campaign',  width: 20 },
    { label: 'Cadastros', width: 10, right: true },
    { label: 'Trial',     width: 7,  right: true },
    { label: 'Free',      width: 6,  right: true },
    { label: 'Wingman',   width: 8,  right: true },
    { label: 'Pro',       width: 5,  right: true },
    { label: 'Conv%',     width: 7,  right: true },
    { label: 'Custo IA',  width: 10, right: true },
    { label: 'LTV Méd',   width: 10, right: true },
  ];

  const header = cols.map(c => pad(c.label, c.width, c.right)).join('  ');
  const divider = cols.map(c => '─'.repeat(c.width)).join('──');

  console.log(header);
  console.log(divider);

  // ── Linhas ────────────────────────────────────────────────────────────────
  rows.forEach(r => {
    const line = [
      pad(r.source,                 12),
      pad(r.medium,                 12),
      pad(r.campaign || '—',        20),
      pad(r.signups,                10, true),
      pad(r.plan_trial,             7,  true),
      pad(r.plan_free,              6,  true),
      pad(r.plan_wingman,           8,  true),
      pad(r.plan_wingman_pro,       5,  true),
      pad(`${r.conv_rate_pct}%`,    7,  true),
      pad(`R$${r.ia_cost_brl.toFixed(2)}`,  10, true),
      pad(`R$${r.ltv_avg_brl.toFixed(2)}`,  10, true),
    ].join('  ');
    console.log(line);
  });

  // ── Totais ────────────────────────────────────────────────────────────────
  const total = {
    signups:         rows.reduce((s, r) => s + r.signups,         0),
    plan_trial:      rows.reduce((s, r) => s + r.plan_trial,      0),
    plan_free:       rows.reduce((s, r) => s + r.plan_free,       0),
    plan_wingman:    rows.reduce((s, r) => s + r.plan_wingman,    0),
    plan_wingman_pro:rows.reduce((s, r) => s + r.plan_wingman_pro,0),
    ia_cost_brl:     rows.reduce((s, r) => s + r.ia_cost_brl,     0),
    ltv_total:       rows.reduce((s, r) => s + (r.ltv_avg_brl * r.signups), 0),
  };
  const totalConvRate = total.signups > 0
    ? ((total.plan_wingman + total.plan_wingman_pro) / total.signups * 100).toFixed(1)
    : '0.0';
  const totalLtvAvg = total.signups > 0
    ? (total.ltv_total / total.signups).toFixed(2)
    : '0.00';

  console.log(divider);
  const totalLine = [
    pad('TOTAL',                   12),
    pad('',                        12),
    pad('',                        20),
    pad(total.signups,             10, true),
    pad(total.plan_trial,          7,  true),
    pad(total.plan_free,           6,  true),
    pad(total.plan_wingman,        8,  true),
    pad(total.plan_wingman_pro,    5,  true),
    pad(`${totalConvRate}%`,       7,  true),
    pad(`R$${total.ia_cost_brl.toFixed(2)}`, 10, true),
    pad(`R$${totalLtvAvg}`,        10, true),
  ].join('  ');
  console.log(totalLine);

  console.log(`\n   Funil: ${total.signups} cadastros → ${total.plan_trial} em trial → ${total.plan_free} free → ${total.plan_wingman} wingman → ${total.plan_wingman_pro} pro`);
  console.log(`   Custo IA total: R$${total.ia_cost_brl.toFixed(2)} | LTV médio: R$${totalLtvAvg}\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
