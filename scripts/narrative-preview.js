#!/usr/bin/env node
/**
 * narrative-preview.js — preview de um ato narrativo sem enviar de verdade
 *
 * Uso:
 *   npm run narrative-preview -- --phone=5511999999999 --act=act_05_identificacao_amplificada
 *   npm run narrative-preview -- --phone=5511999999999 --act=act_10_oferta --variant=B
 *   npm run narrative-preview -- --list     (lista todos os atos com flag status)
 *
 * Imprime no terminal exatamente o que seria enviado, com separação visual
 * entre mensagens. Não faz nenhum envio real.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { ACTS, getActById }   = require('../src/narrative/acts');
const { TriggerContext }     = require('../src/narrative/triggerContext');
const { loadAndApplyCopy }   = require('../src/narrative/copyLoader');
const { createClient }       = require('@supabase/supabase-js');

function parseArgs(argv) {
  const args = {};
  argv.forEach(arg => {
    const m = arg.match(/^--([a-z_-]+)=?(.*)$/);
    if (m) args[m[1]] = m[2] || true;
  });
  return args;
}

function separator(label) {
  const line = '─'.repeat(60);
  return label ? `\n${line}\n📨 ${label}\n${line}` : `\n${line}`;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL e SUPABASE_KEY obrigatórios no .env');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));

  // ── Modo --list ─────────────────────────────────────────────────────────────
  if (args.list) {
    console.log('\n🎭 Catálogo de Atos Narrativos\n');
    for (const act of ACTS) {
      const enabled   = process.env[act.featureFlag] === 'true';
      const proactive = act.isProactive !== false && act.trigger !== null;
      const status    = enabled ? '✅ ON ' : '⬜ OFF';
      const type      = proactive ? 'proativo' : 'inline ';
      const variants  = act.variants.map(v => v.id).join(', ');
      console.log(`  ${status}  ${type}  ${act.id.padEnd(38)}  [${variants}]`);
    }
    console.log(`\n  Flag: ENABLE_ACT_XX=true no .env pra ligar\n`);
    return;
  }

  // ── Modo preview ─────────────────────────────────────────────────────────────
  const actId   = args.act;
  const phone   = args.phone;
  const variant = args.variant; // opcional

  if (!actId || !phone) {
    console.error('Uso: npm run narrative-preview -- --phone=5511999999999 --act=act_01_hook_diagnostico');
    console.error('     npm run narrative-preview -- --list');
    process.exit(1);
  }

  const act = getActById(actId);
  if (!act) {
    console.error(`❌ Ato não encontrado: "${actId}"`);
    console.error('Use --list para ver todos os atos disponíveis.');
    process.exit(1);
  }

  // Busca dados do usuário
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const { data: user } = await supabase
    .from('users')
    .select('phone, plan, plan_expires_at, created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!user) {
    console.error(`❌ Usuário não encontrado: ${phone}`);
    process.exit(1);
  }

  const ctx = new TriggerContext(user);

  // Seleciona variante
  let selectedVariant;
  if (variant) {
    selectedVariant = act.variants.find(v => v.id === variant || v.id.includes(variant));
    if (!selectedVariant) {
      console.error(`❌ Variante "${variant}" não encontrada. Disponíveis: ${act.variants.map(v => v.id).join(', ')}`);
      process.exit(1);
    }
  } else {
    // Para ato 2, usa persona se disponível
    if (act.variants.some(v => v.personaCondition)) {
      const persona = await ctx.getUserPersona();
      selectedVariant = act.variants.find(v => v.personaCondition === persona) || act.variants[0];
    } else {
      selectedVariant = act.variants[0];
    }
  }

  // Carrega vars do template
  const vars     = await act.templateVars(ctx);
  let   messages;
  try {
    messages = loadAndApplyCopy(selectedVariant.copyFile, vars);
  } catch (err) {
    // Copy ainda não escrita
    console.log(`\n⚠️  Copy ainda não preenchida: ${selectedVariant.copyFile}`);
    console.log(`   Edite o arquivo em docs/narrative/${selectedVariant.copyFile}\n`);
    messages = ['[COPY PENDENTE — arquivo existe mas conteúdo ainda não foi escrito]'];
  }

  // Avalia condições (preview only)
  let conditionResult = 'N/A (isProactive=false)';
  if (act.trigger) {
    try {
      conditionResult = (await act.trigger.conditions(ctx)) ? '✅ Dispararia' : '❌ Não dispararia';
    } catch (err) {
      conditionResult = `⚠️  Erro: ${err.message}`;
    }
  }

  // Output
  console.log(`\n🎭 Preview: ${act.id}`);
  console.log(`   Descrição : ${act.description}`);
  console.log(`   Feature   : ${act.featureFlag} = ${process.env[act.featureFlag] || 'não definido (OFF)'}`);
  console.log(`   Usuário   : ${phone} (plano: ${user.plan})`);
  console.log(`   Variante  : ${selectedVariant.id} (${selectedVariant.copyFile})`);
  console.log(`   Template  : ${JSON.stringify(vars)}`);
  console.log(`   Condição  : ${conditionResult}`);
  console.log(`   Mensagens : ${messages.length}`);

  for (let i = 0; i < messages.length; i++) {
    console.log(separator(`Mensagem ${i + 1} de ${messages.length}`));
    console.log(messages[i]);
  }
  console.log(separator());
  console.log();
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
