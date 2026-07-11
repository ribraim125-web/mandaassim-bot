/**
 * keepalive.js — ping leve no Supabase pra impedir que o projeto free
 * seja PAUSADO por inatividade (Supabase pausa após ~7 dias sem atividade).
 *
 * Faz um SELECT mínimo (HEAD, sem trazer linhas) na tabela users. Isso conta
 * como atividade e reseta o contador de inatividade do Supabase.
 *
 * Uso manual:  node scripts/keepalive.js
 *
 * Agendamento (VPS) — roda 1x por dia via cron. Adiciona no crontab do root:
 *   crontab -e
 *   0 9 * * *  cd /root/mandaassim-bot && /usr/bin/node scripts/keepalive.js >> /var/log/mandaassim-keepalive.log 2>&1
 *
 * (Ajuste o caminho do projeto/node conforme o servidor. Ver `which node`.)
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error(`[keepalive] ${new Date().toISOString()} — SUPABASE_URL/KEY ausentes no .env`);
    process.exit(1);
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  try {
    // head:true => não traz linhas, só valida acesso. count exact => atividade real de leitura.
    const { error, count } = await sb
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error(`[keepalive] ${new Date().toISOString()} — FALHOU: ${error.message}`);
      process.exit(2);
    }

    console.log(`[keepalive] ${new Date().toISOString()} — OK (users: ${count} linhas)`);
    process.exit(0);
  } catch (e) {
    console.error(`[keepalive] ${new Date().toISOString()} — EXCEÇÃO: ${e.message}`);
    process.exit(3);
  }
}

main();
