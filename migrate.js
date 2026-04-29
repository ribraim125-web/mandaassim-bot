require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function migrate() {
  console.log('Rodando migração...');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS girl_profiles (
        phone             TEXT PRIMARY KEY,
        girl_name         TEXT,
        girl_context      TEXT,
        current_situation TEXT,
        what_worked       TEXT,
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `
  }).single();

  if (error) {
    // Tenta via insert direto pra testar conexão
    const { error: e2 } = await supabase.from('girl_profiles').select('phone').limit(1);
    if (!e2) {
      console.log('✅ Tabela girl_profiles já existe!');
    } else {
      console.error('❌ Erro — cria a tabela manualmente no Supabase SQL Editor:');
      console.log(`
CREATE TABLE IF NOT EXISTS girl_profiles (
  phone             TEXT PRIMARY KEY,
  girl_name         TEXT,
  girl_context      TEXT,
  current_situation TEXT,
  what_worked       TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
      `);
    }
    return;
  }

  console.log('✅ Tabela girl_profiles criada com sucesso!');
}

migrate();
