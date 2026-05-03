#!/usr/bin/env node
/**
 * pro-conversion-report.js
 *
 * Relatório de conversão Wingman Premium → Pro.
 * Mostra: quantos foram oferecidos, quantos pagaram, tempo médio até upgrade,
 * quantas análises de print/perfil o cara fez antes de converter.
 *
 * Uso:
 *   node scripts/pro-conversion-report.js
 *   node scripts/pro-conversion-report.js --days 14
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const args     = process.argv.slice(2);
const daysArg  = args.includes('--days') ? parseInt(args[args.indexOf('--days') + 1]) : 30;
const since    = new Date(Date.now() - daysArg * 86400000).toISOString();

async function main() {
  console.log(`\n📊 Relatório de Conversão Wingman Pro — últimos ${daysArg} dias\n`);

  // ── 1. Funil de eventos ──────────────────────────────────────────────────
  const { data: events } = await supabase
    .from('subscription_events')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (!events || events.length === 0) {
    console.log('Nenhum evento de assinatura no período.');
    process.exit(0);
  }

  const byType = {};
  for (const e of events) {
    byType[e.event_type] = (byType[e.event_type] || []);
    byType[e.event_type].push(e);
  }

  const offered = byType['upgrade_offered'] || [];
  const paid    = byType['upgrade_paid']    || [];
  const planAct = byType['plan_activated']  || [];

  console.log('── Funil ──────────────────────────────────────────────────');
  console.log(`  Upsells exibidos:       ${offered.length} (${new Set(offered.map(e => e.phone)).size} usuários únicos)`);
  console.log(`  Pagamentos confirmados: ${paid.length}`);
  console.log(`  Planos ativados:        ${planAct.filter(e => e.plan_to === 'pro').length}`);

  const convRate = offered.length > 0
    ? (paid.length / offered.length * 100).toFixed(1)
    : 'N/A';
  console.log(`  Taxa de conversão:      ${convRate}%`);

  // ── 2. Contexto de upsell (onde o cara foi ofertado) ────────────────────
  const ctxCount = {};
  for (const e of offered) {
    const ctx = e.trigger_ctx || 'unknown';
    ctxCount[ctx] = (ctxCount[ctx] || 0) + 1;
  }
  if (Object.keys(ctxCount).length > 0) {
    console.log('\n── Contexto do upsell ─────────────────────────────────────');
    for (const [ctx, count] of Object.entries(ctxCount).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ctx.padEnd(30)} ${count}`);
    }
  }

  // ── 3. Tempo até conversão ───────────────────────────────────────────────
  const paidPhones = new Set(paid.map(e => e.phone));
  const timesToConvert = [];

  for (const phone of paidPhones) {
    const firstOffered = offered.find(e => e.phone === phone);
    const firstPaid    = paid.find(e => e.phone === phone);
    if (firstOffered && firstPaid) {
      const diffH = (new Date(firstPaid.created_at) - new Date(firstOffered.created_at)) / 3600000;
      timesToConvert.push(diffH);
    }
  }

  if (timesToConvert.length > 0) {
    const avgH = timesToConvert.reduce((a, b) => a + b, 0) / timesToConvert.length;
    const minH = Math.min(...timesToConvert);
    const maxH = Math.max(...timesToConvert);
    console.log('\n── Tempo até conversão ────────────────────────────────────');
    console.log(`  Mínimo:  ${minH.toFixed(1)}h`);
    console.log(`  Médio:   ${avgH.toFixed(1)}h`);
    console.log(`  Máximo:  ${maxH.toFixed(1)}h`);
  }

  // ── 4. Uso antes de converter ────────────────────────────────────────────
  if (paidPhones.size > 0) {
    const { data: printsBefore } = await supabase
      .from('print_analyses')
      .select('phone, created_at')
      .in('phone', [...paidPhones]);

    const { data: profilesBefore } = await supabase
      .from('profile_analyses')
      .select('phone, created_at')
      .in('phone', [...paidPhones]);

    if (printsBefore?.length || profilesBefore?.length) {
      console.log('\n── Uso antes de converter ─────────────────────────────────');

      const printPerUser  = {};
      const profilePerUser = {};

      for (const phone of paidPhones) {
        const payDate = new Date(paid.find(e => e.phone === phone)?.created_at);
        printPerUser[phone]   = (printsBefore   || []).filter(r => r.phone === phone && new Date(r.created_at) < payDate).length;
        profilePerUser[phone] = (profilesBefore || []).filter(r => r.phone === phone && new Date(r.created_at) < payDate).length;
      }

      const avgPrints   = Object.values(printPerUser).reduce((a, b) => a + b, 0)   / paidPhones.size;
      const avgProfiles = Object.values(profilePerUser).reduce((a, b) => a + b, 0) / paidPhones.size;

      console.log(`  Análises de print antes do upgrade:   ${avgPrints.toFixed(1)} (média)`);
      console.log(`  Análises de perfil antes do upgrade:  ${avgProfiles.toFixed(1)} (média)`);
    }
  }

  // ── 5. Usuários Pro ativos ───────────────────────────────────────────────
  const { data: proUsers } = await supabase
    .from('users')
    .select('phone, plan, plan_expires_at, created_at')
    .eq('plan', 'pro');

  const now = new Date();
  const activePro = (proUsers || []).filter(u => !u.plan_expires_at || new Date(u.plan_expires_at) > now);
  const mrrPro = activePro.length * 79.90;

  console.log('\n── Usuários Wingman Pro ───────────────────────────────────');
  console.log(`  Ativos agora:  ${activePro.length}`);
  console.log(`  MRR Pro:       R$${mrrPro.toFixed(2)}`);

  // Lista
  if (activePro.length > 0) {
    for (const u of activePro) {
      const exp = u.plan_expires_at ? new Date(u.plan_expires_at).toLocaleDateString('pt-BR') : 'sem expiração';
      console.log(`  • ${u.phone}  (expira ${exp})`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
