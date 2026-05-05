/**
 * engine.js — engine de narrativa reativa
 *
 * getEligibleAct(user) — chamada após cada mensagem do usuário (index.js)
 *
 *   Regras globais:
 *     1. Janela 24h: só envia se usuário mandou msg nas últimas 24h (free API)
 *     2. Cooldown: mínimo 4h entre atos consecutivos
 *     3. Limite diário: máx 2 atos por dia por usuário
 *     4. Ato 12 ignora cooldown e limite diário (janela crítica H+70-72)
 *
 *   Itera PROACTIVE_ACTS em ordem e retorna o primeiro cujas
 *   trigger.conditions(ctx) retornam true.
 *
 * fireActForUser(user, act) — executa o envio após getEligibleAct retornar.
 *
 * startNarrativeEngine(client) — mantido por compatibilidade (registra client
 * para sender.js); não inicia mais cron.
 */

'use strict';

const { createClient }     = require('@supabase/supabase-js');
const { PROACTIVE_ACTS }   = require('./acts');
const { TriggerContext }   = require('./triggerContext');
const { loadAndApplyCopy } = require('./copyLoader');
const { sendNarrativeMessages, setClient } = require('./sender');
const { logActSent, getLastActSentAt, getActsCountToday } = require('./narrativeLog');
const { logJourneyEvent }  = require('./journeyEvents');

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const COOLDOWN_HOURS      = 4;   // mínimo entre atos consecutivos
const MAX_ACTS_PER_DAY    = 2;   // máximo de atos por dia
const WINDOW_24H_MS       = 24 * 3_600_000;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Verifica se o usuário mandou mensagem nas últimas 24h.
 * Sem isso, enviar seria cobrado pela API do WhatsApp.
 */
async function isWithin24hWindow(phone) {
  try {
    const { data } = await getSupabase()
      .from('api_requests')
      .select('created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.created_at) return false;
    return (Date.now() - new Date(data.created_at).getTime()) < WINDOW_24H_MS;
  } catch (_) {
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
 * Seleciona a variante correta para um ato.
 * Para atos com personaCondition (ato 2): match pela persona.
 * Para atos com A/B split: hash determinístico pelo phone.
 */
async function selectVariant(act, ctx) {
  if (act.variants.some(v => v.personaCondition)) {
    const persona = await ctx.getUserPersona();
    const match   = act.variants.find(v => v.personaCondition === persona);
    return match || act.variants[0];
  }

  if (act.abTestSplit && act.abTestSplit.length > 1) {
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

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Retorna o primeiro ato elegível para o usuário, ou null.
 *
 * Deve ser chamada após processar a resposta principal ao usuário,
 * apenas dentro da janela de 24h (mensagem iniciada pelo usuário).
 *
 * @param {{ phone: string, plan: string, plan_expires_at: string|null, created_at: string }} user
 * @returns {Promise<import('./acts').ActDefinition|null>}
 */
async function getEligibleAct(user) {
  try {
    // 1. Janela de 24h — não envia fora da janela free
    if (!await isWithin24hWindow(user.phone)) return null;

    const ctx = new TriggerContext(user);
    const hours = ctx.hoursSinceSignup();

    // Ato 12 tem prioridade absoluta na janela crítica (H+70-72)
    // e ignora cooldown e limite diário
    if (hours >= 71.5 && hours <= 72) {
      const act12 = PROACTIVE_ACTS.find(a => a.id === 'act_12_ultima_chamada');
      if (act12 && isActEnabled(act12) && act12.trigger) {
        try {
          if (await act12.trigger.conditions(ctx)) return act12;
        } catch (_) {}
      }
    }

    // 2. Cooldown entre atos (4h)
    const lastSentAt = await getLastActSentAt(user.phone);
    if (lastSentAt) {
      const hoursSinceLast = (Date.now() - lastSentAt.getTime()) / 3_600_000;
      if (hoursSinceLast < COOLDOWN_HOURS) return null;
    }

    // 3. Limite de 2 atos por dia
    const actsToday = await getActsCountToday(user.phone);
    if (actsToday >= MAX_ACTS_PER_DAY) return null;

    // 4. Itera em ordem — retorna o primeiro elegível
    for (const act of PROACTIVE_ACTS) {
      if (!isActEnabled(act)) continue;
      if (!act.trigger) continue;

      try {
        if (await act.trigger.conditions(ctx)) return act;
      } catch (err) {
        console.error(`[NarrativeEngine] Erro ao avaliar ${act.id} para ${user.phone}:`, err.message);
      }
    }

    return null;

  } catch (err) {
    console.error(`[NarrativeEngine] Erro em getEligibleAct para ${user.phone}:`, err.message);
    return null;
  }
}

/**
 * Executa o envio de um ato para o usuário.
 * Chamado pelo message handler após getEligibleAct retornar um ato.
 *
 * @param {{ phone: string, plan: string, plan_expires_at: string|null, created_at: string }} user
 * @param {import('./acts').ActDefinition} act
 * @returns {Promise<boolean>} true = enviado com sucesso
 */
async function fireActForUser(user, act) {
  try {
    const ctx      = new TriggerContext(user);
    const variant  = await selectVariant(act, ctx);
    const vars     = await act.templateVars(ctx);
    const messages = loadAndApplyCopy(variant.copyFile, vars);

    if (!messages || messages.length === 0) {
      console.warn(`[NarrativeEngine] Copy vazia para ${act.id} (${variant.copyFile}) — pulando.`);
      return false;
    }

    // Loga antes de enviar (UNIQUE constraint garante idempotência)
    const isNew = await logActSent(user.phone, act.id, variant.id, messages.join('\n---\n'));
    if (!isNew) {
      console.log(`[NarrativeEngine] ${act.id} já enviado para ${user.phone} — ignorado.`);
      return false;
    }

    const sent = await sendNarrativeMessages(user.phone, messages);
    if (!sent) {
      console.warn(`[NarrativeEngine] Falha no envio de ${act.id} para ${user.phone}.`);
    }

    logJourneyEvent(user.phone, `narrative_${act.id}_sent`, { variant: variant.id }).catch(() => {});
    console.log(`[NarrativeEngine] ✅ ${act.id} (${variant.id}) → ${user.phone}`);
    return true;

  } catch (err) {
    console.error(`[NarrativeEngine] Erro ao disparar ${act.id} para ${user.phone}:`, err.message);
    return false;
  }
}

/**
 * Registra o client do whatsapp-web.js.
 * Chamado em client.on('ready') — obrigatório antes de qualquer envio.
 *
 * @param {import('whatsapp-web.js').Client} client
 */
function startNarrativeEngine(client) {
  setClient(client);
  console.log('[NarrativeEngine] Engine reativa pronta — atos disparados por mensagem do usuário.');
}

module.exports = { startNarrativeEngine, getEligibleAct, fireActForUser };
