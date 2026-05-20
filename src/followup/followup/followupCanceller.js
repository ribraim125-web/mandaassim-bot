require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

async function cancelPendingFollowups(userPhone, reason = 'user_replied') {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('followup_queue')
    .update({ cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq('user_phone', userPhone)
    .is('sent_at', null)
    .is('cancelled_at', null);

  if (error) console.error(`[Canceller] Erro ao cancelar follow ups de ${userPhone}:`, error.message);
}

module.exports = { cancelPendingFollowups };
