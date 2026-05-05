/**
 * narrativeWorker.js — engine de avaliação e disparo de atos agendados
 *
 * Arquitetura (mesma do followupWorker):
 *   - startWorker(client) → inicia dois intervalos:
 *       30min: avalia atos de janela temporal (Act 5)
 *        5min: avalia atos de urgência (Act 6 — trial ending)
 *   - Avalia até N usuários elegíveis por ciclo
 *   - Cooldown global: nunca envia 2 atos num mesmo dia pra um usuário
 *   - Horário seguro: 8h–21h BRT
 *   - Todos os atos OFF por default (feature flags)
 *
 * Atos inline (1, 2, 3, 7) NÃO passam pelo worker — são disparados
 * diretamente no fluxo de mensagem via narrativeInline.js.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');
const { hasActBeenSent, getLastActSentAt, logActSent, assignVariant } = require('./narrativeLog');
const { logJourneyEvent } = require('./journeyEvents');

// ── Atos agendados ─────────────────────────────────────────────────────────────
const act5 = require('./acts/act_5_profile_audit_reveal');
const act6 = require('./acts/act_6_trial_ending');

const SCHEDULED_ACTS = [act5, act6];

// ── Feature flags ──────────────────────────────────────────────────────────────
function isActEnabled(act) {
  const val = (process.env[act.featureFlag] || 'false').toLowerCase();
  return val === 'true' || val === '1';
}

// ── Supabase ───────────────────────────────────────────────────────────────────
let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

// ── Cliente WhatsApp ───────────────────────────────────────────────────────────
let _client = null;
function setClient(client) { _client = client; }

// ── Horário seguro: 8h–21h BRT ─────────────────────────────────────────────────
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

// ── Cooldown global: nenhum ato no mesmo dia ───────────────────────────────────
const COOLDOWN_HOURS = 20; // 20h entre atos diferentes (não exato 24h pra dar margem)

async function isInCooldown(phone, actCooldownDays) {
  if (actCooldownDays === 0) return false; // esse ato não respeita cooldown global
  const lastSent = await getLastActSentAt(phone);
  if (!lastSent) return false;
  const hoursSince = (Date.now() - lastSent.getTime()) / 3600000;
  return hoursSince < COOLDOWN_HOURS;
}

// ── Contexto de jornada necessário para os shouldFire ─────────────────────────
async function buildJourneyCtx(phone) {
  const supabase = getSupabase();

  // Contagem de prints analisados (via daily_usage)
  const { data: printUsage } = await supabase
    .from('daily_usage')
    .select('count')
    .eq('phone', phone)
    .in('feature_key', ['print_analysis', 'messages']);

  const printCount = (printUsage || []).reduce((s, r) => s + (r.count || 0), 0);

  return { printCount };
}

// ── Busca usuários candidatos a receber atos agendados ─────────────────────────
async function getCandidateUsers() {
  const supabase = getSupabase();
  const cutoff96h = new Date(Date.now() - 96 * 3600000).toISOString();
  const cutoffTrial = new Date(Date.now() + 3 * 3600000).toISOString(); // trial terminando em 3h

  // Usuários criados nos últimos 96h (janela do Ato 5) OU trial terminando (Ato 6)
  const { data } = await supabase
    .from('users')
    .select('phone, plan, created_at, plan_expires_at, trial_ends_at, wa_chat_id')
    .or(`created_at.gte.${cutoff96h},trial_ends_at.lte.${cutoffTrial}`)
    .limit(100);

  return data || [];
}

// ── Avalia e envia atos agendados para um usuário ─────────────────────────────
async function evaluateUserActs(user) {
  const { phone } = user;
  const journeyCtx = await buildJourneyCtx(phone);

  for (const act of SCHEDULED_ACTS) {
    if (!isActEnabled(act)) continue;

    const alreadySent = await hasActBeenSent(phone, act.id);
    if (alreadySent) continue;

    const inCooldown = await isInCooldown(phone, act.cooldownDays);
    if (inCooldown) continue;

    let shouldFire = false;
    try {
      shouldFire = act.shouldFire(user, journeyCtx);
    } catch (_) { continue; }

    if (!shouldFire) continue;

    // Seleciona variante
    const numVariants = Object.keys(act.variants).length;
    const variant     = assignVariant(phone, numVariants);
    const variantData = act.variants[variant] || act.variants.A;

    // Registra antes de enviar (evita duplicata se worker rodar 2x)
    const registered = await logActSent(phone, act.id, variant);
    if (!registered) continue; // já foi enviado por outra instância

    // Envia mensagem
    const chatId = user.wa_chat_id || `${phone}@c.us`;
    try {
      await _client.sendMessage(chatId, variantData.message);
      console.log(`[NarrativeWorker] ✅ ${act.id} (${variant}) → ${phone}`);

      // Registra evento de jornada
      await logJourneyEvent(phone, `narrative_${act.id}_sent`, { variant }, true);

      // Delay humano entre mensagens
      await new Promise(r => setTimeout(r, 3000 + Math.floor(Math.random() * 3000)));

      // Só um ato por ciclo por usuário
      break;

    } catch (err) {
      console.error(`[NarrativeWorker] Erro ao enviar ${act.id} para ${phone}:`, err.message);
    }
  }
}

// ── Loop principal ──────────────────────────────────────────────────────────────
async function runScheduledCheck() {
  if (!isSafeHour()) return;
  if (!_client) return;

  try {
    const candidates = await getCandidateUsers();
    if (!candidates.length) return;

    console.log(`[NarrativeWorker] Avaliando ${candidates.length} usuários`);

    for (const user of candidates) {
      try {
        await evaluateUserActs(user);
      } catch (err) {
        console.error(`[NarrativeWorker] Erro em ${user.phone}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[NarrativeWorker] Erro no ciclo:', err.message);
  }
}

// ── Intervalos ─────────────────────────────────────────────────────────────────
function startWorker(client) {
  if ((process.env.NARRATIVE_PROACTIVE || 'false').toLowerCase() !== 'true') {
    console.log('[NarrativeWorker] Desabilitado (NARRATIVE_PROACTIVE != true). Atos inline ainda funcionam.');
    return;
  }
  setClient(client);
  console.log('[NarrativeWorker] Iniciado');

  // Ato 6 (trial ending): avalia a cada 5min
  setInterval(runScheduledCheck, 5 * 60 * 1000);

  // Execução imediata + agendamento de 30min para Ato 5
  runScheduledCheck();
  setInterval(runScheduledCheck, 30 * 60 * 1000);
}

module.exports = { startWorker, setClient };
