require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// Triggers que NÃO devem ser cancelados quando o usuário manda mensagem:
// são lembretes agendados para momentos específicos no futuro.
const STICKY_TRIGGER_TYPES = [
  'predate_reminder_day_before',
  'predate_reminder_2h_before',
  'predate_debrief',
  'transition_coach_outcome',
];

/**
 * Cancela todos os follow-ups pendentes do usuário, exceto os lembretes
 * de pré-date e outcomes de coach (que são "sticky" — persistem entre mensagens).
 */
async function cancelPendingFollowups(userPhone, reason = 'user_replied') {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('followup_queue')
    .update({ cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq('user_phone', userPhone)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .not('trigger_type', 'in', `(${STICKY_TRIGGER_TYPES.join(',')})`);

  if (error) console.error(`[Canceller] Erro ao cancelar follow ups de ${userPhone}:`, error.message);
}

/**
 * Cancela especificamente os lembretes de pré-date (opt-out explícito do usuário).
 */
async function cancelPredateReminders(userPhone) {
  const supabase = getSupabase();
  const predateTriggers = ['predate_reminder_day_before', 'predate_reminder_2h_before', 'predate_debrief'];
  const { error } = await supabase
    .from('followup_queue')
    .update({ cancelled_at: new Date().toISOString(), cancel_reason: 'user_opt_out' })
    .eq('user_phone', userPhone)
    .in('trigger_type', predateTriggers)
    .is('sent_at', null)
    .is('cancelled_at', null);

  if (error) console.error(`[Canceller] Erro ao cancelar predate de ${userPhone}:`, error.message);
  else console.log(`[Canceller] Lembretes pré-date cancelados para ${userPhone}`);
}

module.exports = { cancelPendingFollowups, cancelPredateReminders };
