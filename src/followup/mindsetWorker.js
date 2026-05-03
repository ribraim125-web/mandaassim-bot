/**
 * mindsetWorker.js — Worker de envio de cápsulas de mindset
 *
 * Roda a cada 30 minutos. Para cada usuário com opt-in ativo:
 * 1. Verifica se hoje é dia de envio (schedule_days)
 * 2. Verifica se já enviou hoje
 * 3. Verifica se está na janela de horário (schedule_hour ± 30min)
 * 4. Seleciona cápsula priorizada pelo contexto
 * 5. Envia e registra entrega
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');
const {
  selectNextCapsule,
  recordDelivery,
  receivedCapsuleToday,
} = require('../lib/mindsetCapsules');

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

let whatsappClient = null;

function setWhatsappClient(c) {
  whatsappClient = c;
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

/**
 * Retorna hora atual em Brasília (0-23).
 */
function getBrasiliaHour() {
  return parseInt(
    new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }),
    10
  );
}

/**
 * Retorna dia da semana ISO em Brasília (1=Seg..7=Dom).
 */
function getBrasiliaIsoWeekday() {
  const dow = parseInt(
    new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
    }).slice(0, 3) === 'dom' ? 7
      : new Date().toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          weekday: 'short',
        }).slice(0, 3) === 'sáb' ? 6
        : new Date().toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            weekday: 'short',
          }).slice(0, 3) === 'sex' ? 5
          : new Date().toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
              weekday: 'short',
            }).slice(0, 3) === 'qui' ? 4
            : new Date().toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                weekday: 'short',
              }).slice(0, 3) === 'qua' ? 3
              : new Date().toLocaleString('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                  weekday: 'short',
                }).slice(0, 3) === 'ter' ? 2 : 1,
    0
  );
  // Alternativa mais robusta via getDay()
  const jsDay = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();
  return jsDay === 0 ? 7 : jsDay; // JS: 0=Dom..6=Sab → ISO: 1=Seg..7=Dom
}

async function processMindsetCapsules() {
  if (!whatsappClient) return;

  const supabase = getSupabase();
  const currentHour    = getBrasiliaHour();
  const currentWeekday = getBrasiliaIsoWeekday();

  // Busca todos os usuários com opt-in ativo
  const { data: optIns, error } = await supabase
    .from('mindset_opt_ins')
    .select('phone, schedule_days, schedule_hour, wa_chat_id:phone')
    .eq('enabled', true);

  if (error) { console.error('[MindsetWorker] Erro ao buscar opt-ins:', error.message); return; }
  if (!optIns || optIns.length === 0) return;

  // Filtra quem deve receber agora: hoje é dia de envio E está na janela de horário
  const candidates = optIns.filter(row => {
    const days = row.schedule_days || [1, 3, 5];
    const hour = row.schedule_hour ?? 9;
    return days.includes(currentWeekday) && currentHour === hour;
  });

  if (candidates.length === 0) return;
  console.log(`[MindsetWorker] ${candidates.length} candidato(s) para envio de cápsula`);

  for (const row of candidates) {
    const phone = row.phone;
    try {
      // Já recebeu hoje?
      const alreadySent = await receivedCapsuleToday(phone);
      if (alreadySent) continue;

      // Seleciona cápsula
      const capsule = await selectNextCapsule(phone);
      if (!capsule) {
        console.warn(`[MindsetWorker] Nenhuma cápsula disponível para ${phone}`);
        continue;
      }

      // Busca wa_chat_id para evitar erro de LID
      const { data: userRow } = await supabase
        .from('users')
        .select('wa_chat_id')
        .eq('phone', phone)
        .maybeSingle();
      const chatId = userRow?.wa_chat_id || `${phone}@c.us`;

      await whatsappClient.sendMessage(chatId, capsule.body);
      await recordDelivery(phone, capsule.id, capsule.category);
      console.log(`[MindsetWorker] ✅ Cápsula "${capsule.category}" enviada para ${phone}`);

      // Delay humano entre envios (2-5s)
      await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 3000)));

    } catch (err) {
      console.error(`[MindsetWorker] Erro ao enviar para ${phone}:`, err.message);
    }
  }
}

function startMindsetWorker(client) {
  setWhatsappClient(client);
  console.log('[MindsetWorker] Worker de mindset iniciado');
  setInterval(processMindsetCapsules, CHECK_INTERVAL_MS);
  // Roda na próxima hora cheia para alinhar com schedule_hour dos usuários
  const msUntilNextHour = (60 - new Date().getMinutes()) * 60 * 1000;
  setTimeout(() => {
    processMindsetCapsules();
    setInterval(processMindsetCapsules, CHECK_INTERVAL_MS);
  }, Math.min(msUntilNextHour, CHECK_INTERVAL_MS));
}

module.exports = { startMindsetWorker, setWhatsappClient };
