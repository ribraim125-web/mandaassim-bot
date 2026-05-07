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

// ── Lifecycle — Trial ──────────────────────────────────────────────────────

async function scheduleTrialD2Push(userPhone) {
  // 48h após signup, com até 3h de variação (evita horário ruim)
  await scheduleFollowup(userPhone, 'trial_d2_push', hours(48) + jitter(180));
}

// ── Lifecycle — Pós-pagamento ─────────────────────────────────────────────
// Chamado quando o primeiro pagamento é confirmado.

async function scheduleLifecycleD7(userPhone) {
  await scheduleFollowup(userPhone, 'lifecycle_d7_tour', hours(7 * 24) + jitter(120));
}

async function scheduleLifecycleD14(userPhone) {
  await scheduleFollowup(userPhone, 'lifecycle_d14_checkin', hours(14 * 24) + jitter(120));
}

async function scheduleLifecycleD30NPS(userPhone) {
  await scheduleFollowup(userPhone, 'lifecycle_d30_nps', hours(30 * 24) + jitter(120));
}

async function scheduleLifecycleD60Anual(userPhone) {
  await scheduleFollowup(userPhone, 'lifecycle_d60_anual', hours(60 * 24) + jitter(120));
}

async function scheduleLifecycleD90Loyalty(userPhone) {
  await scheduleFollowup(userPhone, 'lifecycle_d90_loyalty', hours(90 * 24) + jitter(120));
}

/**
 * Agenda todos os lifecycle pós-pagamento de uma vez.
 * Idempotente: alreadyScheduled() previne duplicatas.
 */
async function scheduleAllLifecycle(userPhone) {
  await scheduleLifecycleD7(userPhone);
  await scheduleLifecycleD14(userPhone);
  await scheduleLifecycleD30NPS(userPhone);
  await scheduleLifecycleD60Anual(userPhone);
  await scheduleLifecycleD90Loyalty(userPhone);
}

// ── Pós-cancelamento ──────────────────────────────────────────────────────

async function scheduleReactivationD1(userPhone) {
  await scheduleFollowup(userPhone, 'reactivation_d1', hours(24) + jitter(60));
}

/**
 * Agenda os 3 lembretes do Coach Pré-Date com base na data/hora do encontro.
 * Silencioso se a data já passou ou é muito próxima.
 * @param {string} userPhone
 * @param {Date} encontroDate — data/hora do encontro
 */
async function schedulePredateReminders(userPhone, encontroDate) {
  const now = Date.now();
  const encounterMs = encontroDate.getTime();
  const msUntilEncounter = encounterMs - now;

  if (msUntilEncounter <= 0) return; // encontro no passado — não agenda

  // 1 dia antes (ou a partir de agora se for amanhã ou depois de amanhã)
  const dayBeforeDelay = msUntilEncounter - hours(24);
  if (dayBeforeDelay > minutes(10)) {
    await scheduleFollowup(userPhone, 'predate_reminder_day_before', dayBeforeDelay);
  }

  // 2h antes
  const twoHBeforeDelay = msUntilEncounter - hours(2);
  if (twoHBeforeDelay > minutes(10)) {
    await scheduleFollowup(userPhone, 'predate_reminder_2h_before', twoHBeforeDelay);
  }

  // Debrief: 10h após o encontro (normalmente no dia seguinte de manhã)
  const debriefDate = new Date(encounterMs + hours(10));
  const debriefHour = debriefDate.getHours();
  // Garante que caia em horário humano (8h–21h BRT)
  if (debriefHour < 8)  { debriefDate.setHours(9,  0, 0, 0); }
  if (debriefHour > 21) { debriefDate.setDate(debriefDate.getDate() + 1); debriefDate.setHours(9, 0, 0, 0); }
  const debriefDelay = debriefDate.getTime() - now;
  if (debriefDelay > minutes(10)) {
    await scheduleFollowup(userPhone, 'predate_debrief', debriefDelay);
  }
}

module.exports = {
  scheduleInactiveFollowup,
  scheduleLimitDrop10,
  scheduleLimitExhausted10,
  scheduleLimitDrop3,
  scheduleLimitExhausted3,
  scheduleTransitionCoachOutcome,
  schedulePredateReminders,
  scheduleTrialD2Push,
  scheduleAllLifecycle,
  scheduleReactivationD1,
};
