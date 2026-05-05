#!/usr/bin/env node
/**
 * subscription-stats.js — métricas de assinatura e cancelamento
 *
 * Uso:
 *   npm run subscription-stats
 *   npm run subscription-stats -- --since=2026-05-01
 *   npm run subscription-stats -- --since=2026-04-01 --until=2026-04-30
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

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

function fmtBrl(n) {
  return `R$${Number(n || 0).toFixed(2)}`;
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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  console.log(`\n💳 Relatório de Assinaturas`);
  console.log(`   Período: ${since.toISOString().slice(0, 10)} → ${until.toISOString().slice(0, 10)}\n`);

  // ── Usuários ativos por plano ─────────────────────────────────────────────
  const { data: users } = await supabase
    .from('users')
    .select('phone, plan, plan_expires_at, created_at');

  const now = new Date();
  const GRACE_DAYS = 3;

  const PAID_KEYS = ['parceiro', 'parceiro_pro', 'wingman', 'wingman_pro']; // legados incluídos
  const isActive = (u) => {
    if (!PAID_KEYS.includes(u.plan)) return false;
    if (!u.plan_expires_at) return true; // sem expiração = vitalício
    const grace = new Date(u.plan_expires_at);
    grace.setDate(grace.getDate() + GRACE_DAYS);
    return now <= grace;
  };

  const activeParceiro    = (users || []).filter(u => ['parceiro','wingman'].includes(u.plan)     && isActive(u)).length;
  const activeParceiroP = (users || []).filter(u => ['parceiro_pro','wingman_pro'].includes(u.plan) && isActive(u)).length;
  const inGrace          = (users || []).filter(u => {
    if (!PAID_KEYS.includes(u.plan)) return false;
    if (!u.plan_expires_at) return false;
    return now > new Date(u.plan_expires_at) && isActive(u);
  }).length;
  const mrr = +(activeParceiro * 29.90 + activeParceiroP * 79.90).toFixed(2);

  console.log('📊 Planos Ativos\n');
  console.log(`   ${pad('Parceiro', 20)}  ${pad(activeParceiro, 6, true)}`);
  console.log(`   ${pad('Parceiro Pro', 20)}  ${pad(activeParceiroP, 6, true)}`);
  console.log(`   ${pad('Em período de graça', 20)}  ${pad(inGrace, 6, true)}`);
  console.log(`   ${pad('MRR estimado', 20)}  ${pad(fmtBrl(mrr), 10, true)}`);
  console.log(`   ${pad('ARR estimado', 20)}  ${pad(fmtBrl(mrr * 12), 10, true)}\n`);

  // ── Ativações no período ───────────────────────────────────────────────────
  const { data: events } = await supabase
    .from('subscription_events')
    .select('event_type, plan_to, amount_brl, created_at')
    .gte('created_at', since.toISOString())
    .lte('created_at', until.toISOString());

  const activations = (events || []).filter(e => e.event_type === 'plan_activated');
  const parceiroActivations    = activations.filter(e => ['parceiro','wingman'].includes(e.plan_to)).length;
  const parceiroProActivations = activations.filter(e => ['parceiro_pro','wingman_pro'].includes(e.plan_to)).length;
  const revenue = activations.reduce((s, e) => s + (e.amount_brl || 0), 0);

  console.log('💰 Ativações no Período\n');
  console.log(`   ${pad('Parceiro', 20)}  ${pad(parceiroActivations, 6, true)}`);
  console.log(`   ${pad('Parceiro Pro', 20)}  ${pad(parceiroProActivations, 6, true)}`);
  console.log(`   ${pad('Receita total', 20)}  ${pad(fmtBrl(revenue), 10, true)}\n`);

  // ── Cancelamentos no período ───────────────────────────────────────────────
  const { data: cancels } = await supabase
    .from('cancellation_reasons')
    .select('reason, plan, created_at')
    .gte('created_at', since.toISOString())
    .lte('created_at', until.toISOString());

  if ((cancels || []).length > 0) {
    console.log('❌ Cancelamentos no Período\n');

    const byReason = {};
    for (const c of cancels) {
      byReason[c.reason] = (byReason[c.reason] || 0) + 1;
    }

    const total = cancels.length;
    const reasonLabels = {
      preco: 'Preço',
      nao_uso: 'Não usa o suficiente',
      nao_gostei: 'Não gostei dos resultados',
      problema_tecnico: 'Problema técnico',
      outro: 'Outro',
    };

    for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
      const label = reasonLabels[reason] || reason;
      const pct = ((count / total) * 100).toFixed(0);
      console.log(`   ${pad(label, 30)}  ${pad(count, 4, true)}  (${pct}%)`);
    }
    console.log(`   ${'─'.repeat(45)}`);
    console.log(`   ${pad('Total', 30)}  ${pad(total, 4, true)}\n`);

    // Churn rate (cancelamentos / ativações no período)
    const totalActivations = activations.length;
    if (totalActivations > 0) {
      const churnRate = ((total / totalActivations) * 100).toFixed(1);
      console.log(`   Churn rate no período: ${churnRate}% (${total} cancel / ${totalActivations} ativações)\n`);
    }
  } else {
    console.log('   Nenhum cancelamento registrado no período.\n');
  }

  // ── Win-back ──────────────────────────────────────────────────────────────
  const winbacks = activations.filter(e => {
    // Winback = ativação com valor PRECO_WINBACK (R$19,90)
    return e.amount_brl && Math.abs(e.amount_brl - 19.90) < 0.50;
  }).length;

  if (winbacks > 0) {
    console.log(`♻️  Win-backs no período: ${winbacks}\n`);
  }
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
