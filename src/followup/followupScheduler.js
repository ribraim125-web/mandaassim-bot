require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

function jitter(minutes) {
  return Math.floor(Math.random() * minutes * 60 * 1000);
}
function hours(n) { return n * 60 * 60 * 1000; }
function minutes(n) { return n * 60 * 1000; }

async function alreadyScheduled(userPhone, triggerType) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('followup_queue')
    .select('id')
    .eq('user_phone', userPhone)
    .eq('trigger_type', triggerType)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .limit(1);
  return data && data.length > 0;
}

async function scheduleFollowup(userPhone, triggerType, delayMs) {
  const already = await alreadyScheduled(userPhone, triggerType);
  if (already) return;

  const supabase = getSupabase();
  const scheduledFor = new Date(Date.now() + delayMs).toISOString();

  const { error } = await supabase
    .from('followup_queue')
    .insert({ user_phone: userPhone, trigger_type: triggerType, scheduled_for: scheduledFor });

  if (error) console.error(`[Scheduler] Erro ao agendar ${triggerType} para ${userPhone}:`, error.message);
  else console.log(`[Scheduler] ${triggerType} agendado para ${userPhone} em ${scheduledFor}`);
}

async function scheduleInactiveFollowup(userPhone) {
  await scheduleFollowup(userPhone, 'day1_inactive', hours(27) + jitter(45));
}

async function scheduleLimitDrop10(userPhone) {
  await scheduleFollowup(userPhone, 'limit_drop_10', hours(2) + jitter(45));
}

async function scheduleLimitExhausted10(userPhone) {
  await scheduleFollowup(userPhone, 'limit_exhausted_10', minutes(8) + jitter(5));
}

async function scheduleLimitDrop3(userPhone) {
  await scheduleFollowup(userPhone, 'limit_drop_3', hours(1) + jitter(30));
}

async function scheduleLimitExhausted3(userPhone) {
  await scheduleFollowup(userPhone, 'limit_exhausted_3', minutes(5) + jitter(3));
}

async function scheduleTransitionCoachOutcome(userPhone) {
  // 7 dias = 168 horas, com até 2h de variação
  await scheduleFollowup(userPhone, 'transition_coach_outcome', hours(168) + jitter(120));
}

module.exports = {
  scheduleInactiveFollowup,
  scheduleLimitDrop10,
  scheduleLimitExhausted10,
  scheduleLimitDrop3,
  scheduleLimitExhausted3,
  scheduleTransitionCoachOutcome,
};
