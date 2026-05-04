#!/usr/bin/env node
/**
 * create-slug.js — cria um link de rastreamento de aquisição
 *
 * Uso:
 *   npm run create-slug -- --slug=ig_reel_001 --source=instagram --medium=reel
 *   npm run create-slug -- --slug=ig_reel_001 --source=instagram --medium=reel --campaign=hook_divorciado_001 --notes="Reel sobre abordagem no app"
 *
 * Retorna o link wa.me pronto pra colar na bio/vídeo.
 *
 * Requer no .env:
 *   SUPABASE_URL, SUPABASE_KEY, BOT_PHONE (ex: 5511999999999)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BOT_PHONE    = process.env.BOT_PHONE; // ex: 5511999999999

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL e SUPABASE_KEY obrigatórios no .env');
  process.exit(1);
}

if (!BOT_PHONE) {
  console.error('❌ BOT_PHONE obrigatório no .env (ex: 5511999999999)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Parse args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  argv.forEach(arg => {
    const m = arg.match(/^--([a-z_]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  });
  return args;
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{1,60}$/i;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { slug, source, medium, campaign, notes } = args;

  if (!slug || !source || !medium) {
    console.log(`
Uso:
  npm run create-slug -- --slug=<slug> --source=<source> --medium=<medium> [--campaign=<campaign>] [--notes="..."]

Exemplos:
  npm run create-slug -- --slug=ig_reel_001 --source=instagram --medium=reel
  npm run create-slug -- --slug=tiktok_001 --source=tiktok --medium=shorts --campaign=lancamento_pro
  npm run create-slug -- --slug=indicacao_alex --source=indicacao --medium=boca_a_boca --notes="indicado pelo Alex"
    `);
    process.exit(1);
  }

  if (!SLUG_REGEX.test(slug)) {
    console.error(`❌ Slug inválido: "${slug}"\n   Use apenas letras, números, _ e - (mín 2, máx 61 chars)`);
    process.exit(1);
  }

  // Verifica se slug já existe
  const { data: existing } = await supabase
    .from('acquisition_links')
    .select('slug')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();

  if (existing) {
    console.error(`❌ Slug já existe: "${slug}"\n   Escolha outro nome.`);
    process.exit(1);
  }

  // Insere no Supabase
  const { error } = await supabase.from('acquisition_links').insert({
    slug:       slug.toLowerCase(),
    source,
    medium,
    campaign:   campaign || null,
    notes:      notes    || null,
    created_by: 'rafa',
  });

  if (error) {
    console.error('❌ Erro ao salvar no Supabase:', error.message);
    process.exit(1);
  }

  // Gera link wa.me
  const text    = encodeURIComponent(`mandaassim_${slug.toLowerCase()}`);
  const waLink  = `https://wa.me/${BOT_PHONE}?text=${text}`;

  console.log('\n✅ Slug criado com sucesso!\n');
  console.log(`  Slug      : ${slug.toLowerCase()}`);
  console.log(`  Source    : ${source}`);
  console.log(`  Medium    : ${medium}`);
  if (campaign) console.log(`  Campaign  : ${campaign}`);
  if (notes)    console.log(`  Notes     : ${notes}`);
  console.log(`\n  Link wa.me ↓\n`);
  console.log(`  ${waLink}\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
