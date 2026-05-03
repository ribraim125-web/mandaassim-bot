require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');
const { getMessage } = require('./followupMessages');
const { marcarOutcomeSolicitado } = require('../lib/transitionCoach');
const { atualizarDebriefEnviado } = require('../lib/predateCoach');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // roda a cada 5 min
let whatsappClient = null;

function setWhatsappClient(client) {
  whatsappClient = client;
}

// Horário permitido: 8h-21h no fuso de Brasília
function isSafeHour() {
  const hour = parseInt(
    new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }),
    10
  );
  return hour >= 8 && hour <= 21;
}

// Retorna true se o usuário já foi notificado e não respondeu nas últimas 72h
async function wasRecentlyIgnored(userPhone) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('followup_queue')
    .select('sent_at')
    .eq('user_phone', userPhone)
    .not('sent_at', 'is', null)
    .is('cancelled_at', null)
    .gte('sent_at', cutoff)
    .limit(1);
  return data && data.length > 0;
}

async function processFollowups() {
  if (!isSafeHour()) return;
  if (!whatsappClient) return;

  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: pending, error } = await supabase
    .from('followup_queue')
    .select('*')
    .lte('scheduled_for', now)
    .is('sent_at', null)
    .is('cancelled_at', null)
    .order('scheduled_for', { ascending: true })
    .limit(10);

  if (error) { console.error('[Worker] Erro ao buscar follow ups:', error.message); return; }
  if (!pending || pending.length === 0) return;

  console.log(`[Worker] ${pending.length} follow ups para processar`);

  for (const followup of pending) {
    try {
      const ignored = await wasRecentlyIgnored(followup.user_phone);
      if (ignored) {
        await supabase
          .from('followup_queue')
          .update({ cancelled_at: now, cancel_reason: 'recently_ignored' })
          .eq('id', followup.id);
        continue;
      }

      let message = getMessage(followup.trigger_type);
      if (!message) continue;

      // Personaliza lembrete do dia anterior com a dica salva na sessão
      if (followup.trigger_type === 'predate_reminder_day_before') {
        const { data: session } = await supabase
          .from('predate_sessions')
          .select('assessment_result')
          .eq('phone', followup.user_phone)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const tip = session?.assessment_result?.day_before_tip;
        if (tip) {
          message = `🗓️ *Amanhã é o encontro*\n\n${tip}\n\nBora 💪\n\n_Manda PARAR pra cancelar lembretes._`;
        }
      }

      // Usa wa_chat_id salvo no banco para evitar erro de LID
      const { data: userRow } = await supabase
        .from('users')
        .select('wa_chat_id')
        .eq('phone', followup.user_phone)
        .maybeSingle();

      const chatId = userRow?.wa_chat_id || `${followup.user_phone}@c.us`;

      await whatsappClient.sendMessage(chatId, message);
      console.log(`[Worker] ✅ Enviado ${followup.trigger_type} para ${followup.user_phone}`);

      await supabase
        .from('followup_queue')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', followup.id);

      // Marca outcome_requested_at na sessão do coach de transição
      if (followup.trigger_type === 'transition_coach_outcome') {
        marcarOutcomeSolicitado(followup.user_phone).catch(() => {});
      }

      // Marca debrief enviado na sessão de pré-date
      if (followup.trigger_type === 'predate_debrief') {
        atualizarDebriefEnviado(followup.user_phone).catch(() => {});
      }

      // Delay humano entre mensagens (3-7s)
      await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 4000)));

    } catch (err) {
      console.error(`[Worker] Erro ao enviar para ${followup.user_phone}:`, err.message);
    }
  }
}

function startWorker(client) {
  setWhatsappClient(client);
  console.log('[Worker] Follow up worker iniciado');
  setInterval(processFollowups, CHECK_INTERVAL_MS);
  processFollowups();
}

module.exports = { startWorker, setWhatsappClient };
