/**
 * engine.js — engine de avaliação da narrativa progressiva
 *
 * Roda a cada 15min. Para cada usuário ativo (criado nos últimos 7 dias):
 *   1. Verifica se já recebeu 1 ato proativo hoje → se sim, pula
 *   2. Verifica se está em conversa ativa (< 5min desde última msg) → se sim, pula
 *   3. Avalia cada ato em ordem, respeitando feature flags
 *   4. Dispara o PRIMEIRO ato cujas condições são verdadeiras
 *   5. Loga e para (no máximo 1 ato por tick por usuário)
 *
 * FEATURE FLAGS individuais:
 *   ENABLE_ACT_01_HOOK_DIAGNOSTICO=true
 *   ENABLE_ACT_02_PROMESSA_MECANISMO=true
 *   ... (todos false por default)
 *
 * Inicializado em index.js via startNarrativeEngine(client).
 */

'use strict';

const { createClient }       = require('@supabase/supabase-js');
const { PROACTIVE_ACTS }     = require('./acts');
const { TriggerContext }     = require('./triggerContext');
const { loadAndApplyCopy }   = require('./copyLoader');
const { sendNarrativeMessages, setClient } = require('./sender');
const { logActSent, getLastActSentAt }     = require('./narrativeLog');
const { logJourneyEvent }    = require('./journeyEvents');

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

const TICK_INTERVAL_MS    = 15 * 60_000; // 15 minutos
const USER_WINDOW_DAYS    = 7;           // avalia usuários criados nos últimos 7 dias
const ACTIVE_CONV_MINUTES = 5;           // considera conversa ativa se < 5min
const SAFE_HOUR_START_BRT = 8;           // não envia antes das 8h BRT
const SAFE_HOUR_END_BRT   = 21;          // não envia depois das 21h BRT

// ── Helpers ───────────────────────────────────────────────────────────────────

function isSafeHour() {
  const brt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
  const hour = parseInt(brt, 10);
  return hour >= SAFE_HOUR_START_BRT && hour < SAFE_HOUR_END_BRT;
}

/**
 * Verifica se o usuário já recebeu algum ato proativo hoje.
 * Limite: 1 ato por dia por usuário.
 */
async function alreadyReceivedActToday(phone) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data } = await getSupabase()
    .from('narrative_messages_log')
    .select('id')
    .eq('phone', phone)
    .gte('sent_at', todayStart.toISOString())
    .limit(1)
    .maybeSingle();

  return !!data;
}

/**
 * Retorna usuários candidatos à avaliação (criados nos últimos 7 dias).
 */
async function getCandidateUsers() {
  const cutoff = new Date(Date.now() - USER_WINDOW_DAYS * 24 * 3_600_000).toISOString();
  const { data } = await getSupabase()
    .from('users')
    .select('phone, plan, plan_expires_at, created_at')
    .gte('created_at', cutoff);
  return data || [];
}

/**
 * Seleciona a variante correta para um ato com base no usuário.
 * Para atos com personaCondition (ato 2): match pela persona.
 * Para atos com A/B split: hash determinístico.
 * @param {import('./acts').ActDefinition} act
 * @param {TriggerContext} ctx
 * @returns {Promise<import('./acts').Variant>}
 */
async function selectVariant(act, ctx) {
  // Ato 2: variante depende da persona
  if (act.variants.some(v => v.personaCondition)) {
    const persona = await ctx.getUserPersona();
    const match   = act.variants.find(v => v.personaCondition === persona);
    return match || act.variants[0];
  }

  // A/B com split percentual
  if (act.abTestSplit && act.abTestSplit.length > 1) {
    // Hash determinístico pelo phone
    let hash = 0;
    for (const c of ctx.phone) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    const pct = Math.abs(hash) % 100;
    let cumulative = 0;
    for (let i = 0; i < act.abTestSplit.length; i++) {
      cumulative += act.abTestSplit[i];
      if (pct < cumulative) return act.variants[i] || act.variants[0];
    }
  }

  return act.variants[0];
}

/**
 * Dispara um ato para um usuário.
 */
async function fireAct(user, act, ctx) {
  try {
    const variant  = await selectVariant(act, ctx);
    const vars     = await act.templateVars(ctx);
    const messages = loadAndApplyCopy(variant.copyFile, vars);

    if (!messages || messages.length === 0) {
      console.warn(`[NarrativeEngine] Copy vazia para ${act.id} (${variant.copyFile}) — pulando.`);
      return false;
    }

    // Loga primeiro (idempotência: UNIQUE constraint protege de duplicatas)
    const isNew = await logActSent(user.phone, act.id, variant.id, messages.join('\n---\n'));
    if (!isNew) {
      console.log(`[NarrativeEngine] ${act.id} já enviado para ${user.phone} — ignorado.`);
      return false;
    }

    // Envia com delays dopamínicos
    const sent = await sendNarrativeMessages(user.phone, messages);
    if (!sent) {
      console.warn(`[NarrativeEngine] Falha no envio de ${act.id} para ${user.phone}.`);
    }

    // Log de jornada
    logJourneyEvent(user.phone, `narrative_${act.id}_sent`, { variant: variant.id }).catch(() => {});

    console.log(`[NarrativeEngine] ✅ ${act.id} (${variant.id}) → ${user.phone}`);
    return true;

  } catch (err) {
    console.error(`[NarrativeEngine] Erro ao disparar ${act.id} para ${user.phone}:`, err.message);
    return false;
  }
}

/**
 * Verifica se o ato tem feature flag ativada.
 */
function isActEnabled(act) {
  const flag = process.env[act.featureFlag];
  return flag === 'true' || flag === 'all';
}

/**
 * Avalia e potencialmente dispara atos para um único usuário.
 */
async function evaluateUserActs(user) {
  try {
    // Janela segura de horário
    if (!isSafeHour()) return;

    // Já recebeu ato hoje → pula
    if (await alreadyReceivedActToday(user.phone)) return;

    const ctx = new TriggerContext(user);

    // Conversa ativa → pula (não interrompe)
    const minsSinceLastMsg = await ctx.minutesSinceLastMessage().catch(() => Infinity);
    if (minsSinceLastMsg < ACTIVE_CONV_MINUTES) return;

    // Avalia atos em ordem (para no primeiro que dispara)
    for (const act of PROACTIVE_ACTS) {
      if (!isActEnabled(act)) continue;
      if (!act.trigger) continue;

      try {
        const shouldFire = await act.trigger.conditions(ctx);
        if (!shouldFire) continue;

        const fired = await fireAct(user, act, ctx);
        if (fired) return; // 1 ato por tick
      } catch (err) {
        console.error(`[NarrativeEngine] Erro ao avaliar ${act.id} para ${user.phone}:`, err.message);
        // Continua pro próximo ato
      }
    }

  } catch (err) {
    console.error(`[NarrativeEngine] Erro ao avaliar usuário ${user.phone}:`, err.message);
  }
}

/**
 * Tick principal da engine.
 */
async function tick() {
  try {
    const users = await getCandidateUsers();
    console.log(`[NarrativeEngine] Tick — ${users.length} usuário(s) candidato(s).`);

    for (const user of users) {
      await evaluateUserActs(user);
    }
  } catch (err) {
    console.error('[NarrativeEngine] Erro no tick:', err.message);
  }
}

/**
 * Inicia a engine. Chamado em client.on('ready').
 * @param {import('whatsapp-web.js').Client} client
 */
function startNarrativeEngine(client) {
  if ((process.env.NARRATIVE_PROACTIVE || 'false').toLowerCase() !== 'true') {
    console.log('[NarrativeEngine] Desabilitado (NARRATIVE_PROACTIVE != true). Atos inline ainda funcionam.');
    return;
  }
  setClient(client);
  console.log('[NarrativeEngine] Engine iniciada — tick a cada 15min.');
  // Primeiro tick em 2min (deixa o bot estabilizar)
  setTimeout(tick, 2 * 60_000);
  setInterval(tick, TICK_INTERVAL_MS);
}

module.exports = { startNarrativeEngine, tick, evaluateUserActs };
