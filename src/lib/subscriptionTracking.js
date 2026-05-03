/**
 * subscriptionTracking.js — registra eventos do funil de upgrade
 *
 * Todos os métodos são fire-and-forget: nunca bloqueiam o fluxo principal.
 * Usar para medir: onde ofereço upsell, quem paga, quando cancela.
 */

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

/**
 * Registra um evento de assinatura. Nunca lança exceção.
 *
 * @param {object} params
 * @param {string} params.phone
 * @param {'upgrade_offered'|'upgrade_paid'|'downgrade'|'cancel'|'plan_activated'} params.eventType
 * @param {string} [params.planFrom]   — plano anterior
 * @param {string} [params.planTo]     — plano novo
 * @param {number} [params.amountBrl]  — valor pago
 * @param {string} [params.triggerCtx] — o que disparou o evento
 * @param {object} [params.metadata]   — dados extras
 */
function trackSubscriptionEvent({ phone, eventType, planFrom, planTo, amountBrl, triggerCtx, metadata } = {}) {
  const supabase = getSupabase();
  const row = {
    phone,
    event_type:  eventType,
    plan_from:   planFrom   || null,
    plan_to:     planTo     || null,
    amount_brl:  amountBrl  || null,
    trigger_ctx: triggerCtx || null,
    metadata:    metadata   || null,
    created_at:  new Date().toISOString(),
  };
  supabase.from('subscription_events').insert(row)
    .then(({ error }) => {
      if (error) console.error('[SubTracking] Erro:', error.message);
    })
    .catch(() => {});
}

module.exports = { trackSubscriptionEvent };
