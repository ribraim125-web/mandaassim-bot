require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function migrate() {
  console.log('Rodando migração...');

  // Testa girl_profiles
  const { error: e1 } = await supabase.from('girl_profiles').select('phone').limit(1);
  if (e1) {
    console.log('⚠️  Tabela girl_profiles não encontrada. Crie manualmente no Supabase SQL Editor.');
  } else {
    console.log('✅ Tabela girl_profiles OK');
  }

  // Testa sonnet_monthly_usage
  const { error: e2 } = await supabase.from('sonnet_monthly_usage').select('phone').limit(1);
  if (e2) {
    console.log('⚠️  Tabela sonnet_monthly_usage não encontrada. Crie manualmente:');
    console.log(`
CREATE TABLE IF NOT EXISTS sonnet_monthly_usage (
  phone  TEXT NOT NULL,
  month  TEXT NOT NULL,
  count  INT  NOT NULL DEFAULT 0,
  UNIQUE (phone, month)
);
    `);
  } else {
    console.log('✅ Tabela sonnet_monthly_usage OK');
  }

  if (!e1 && !e2) {
    console.log('\n✅ Todas as tabelas OK!');
  }
}

migrate();
