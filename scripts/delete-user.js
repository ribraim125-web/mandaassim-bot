/**
 * delete-user.js — reset COMPLETO de um número (apaga todos os dados do banco).
 *
 * Uso:  node scripts/delete-user.js 5561986115458
 *
 * ATENÇÃO: isto apaga só o BANCO. O bot rodando guarda contexto na RAM — depois
 * de rodar este script, REINICIE o bot (pm2 restart mandaassim-bot) pra limpar a
 * memória "de cabeça", senão o contexto antigo volta no próximo uso.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const phone = process.argv[2];
if (!phone || !/^\d{12,13}$/.test(phone)) {
  console.error('Uso: node scripts/delete-user.js <phone>  (ex.: 5561986115458)');
  process.exit(1);
}

// Tabelas com dado por número. Cada delete é filtrado por phone; tabela sem a
// coluna 'phone' dá SKIP (nada é apagado em massa).
const tables = [
  'users', 'user_sessions', 'daily_message_counts', 'daily_usage', 'girl_profiles',
  'print_analyses', 'profile_analyses', 'profile_audits', 'profile_her_analyses',
  'transition_coach_sessions', 'predate_sessions', 'postdate_sessions', 'mindset_opt_ins',
  'mindset_deliveries', 'feature_discovery_state', 'narrative_messages_log',
  'user_journey_events', 'nps_responses', 'format_violations', 'subscription_events',
  'cancellation_reasons', 'api_requests', 'payments',
];

(async () => {
  console.log(`=== Reset completo de ${phone} ===`);
  for (const t of tables) {
    try {
      const { error, count } = await sb.from(t).delete({ count: 'exact' }).eq('phone', phone);
      if (error) console.log(`  ${t}: SKIP (${error.message})`);
      else console.log(`  ${t}: ${count ?? '?'} linha(s) apagada(s)`);
    } catch (e) { console.log(`  ${t}: ERRO ${e.message}`); }
  }
  const { data: still } = await sb.from('users').select('phone').eq('phone', phone).maybeSingle();
  console.log(`=== FIM — conta ainda existe em users: ${still ? 'SIM (erro!)' : 'NÃO (ok, virou novo)'} ===`);
  console.log('>> AGORA REINICIE O BOT (pm2 restart mandaassim-bot) pra limpar a memória da RAM. <<');
  process.exit(0);
})();
