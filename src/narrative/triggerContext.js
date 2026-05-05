/**
 * triggerContext.js — contexto de avaliação de triggers para a engine narrativa
 *
 * Fornece métodos helper para que as condições de cada ato possam consultar:
 * - Eventos de jornada do usuário
 * - Quais atos já foram enviados
 * - Contagens de uso (prints, análises, interações)
 * - Tempo desde o signup
 *
 * Plan mapping: DB usa 'parceiro'/'parceiro_pro'; ctx.user.plan expõe o mesmo valor.
 * Aliases legados (wingman/wingman_pro/premium/pro) são normalizados transparentemente.
 */

'use strict';

const { createClient }   = require('@supabase/supabase-js');
const { hasActBeenSent, getLastActSentAt } = require('./narrativeLog');
const { hasEvent, getEventData, countEvents } = require('./journeyEvents');

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

// Normaliza aliases legados → nome canônico atual
const PLAN_NORMALIZE = {
  wingman:     'parceiro',
  wingman_pro: 'parceiro_pro',
  premium:     'parceiro',
  pro:         'parceiro_pro',
};

class TriggerContext {
  /**
   * @param {{ phone: string, plan: string, plan_expires_at: string|null, created_at: string }} user
   */
  constructor(user) {
    this.phone = user.phone;
    this.user  = {
      ...user,
      plan: PLAN_NORMALIZE[user.plan] || user.plan,
    };
  }

  // ── Atos ─────────────────────────────────────────────────────────────────────

  async actAlreadySent(actId) {
    return hasActBeenSent(this.phone, actId);
  }

  /** Retorna o timestamp em que o ato foi enviado, ou null. */
  async getActSentTime(actId) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('narrative_messages_log')
      .select('sent_at')
      .eq('phone', this.phone)
      .eq('act_id', actId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.sent_at ? new Date(data.sent_at) : null;
  }

  // ── Tempo ─────────────────────────────────────────────────────────────────────

  /** Horas desde o cadastro. */
  hoursSinceSignup() {
    const created = new Date(this.user.created_at);
    return (Date.now() - created.getTime()) / 3_600_000;
  }

  // ── Eventos de jornada ────────────────────────────────────────────────────────

  async hasEvent(eventType)              { return hasEvent(this.phone, eventType); }
  async getEventData(eventType)          { return getEventData(this.phone, eventType); }
  async getEventCount(eventType)         { return countEvents(this.phone, eventType); }

  /** Retorna o timestamp do primeiro evento do tipo, ou null. */
  async getEventTime(eventType) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('user_journey_events')
      .select('created_at')
      .eq('phone', this.phone)
      .eq('event_type', eventType)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.created_at ? new Date(data.created_at) : null;
  }

  /** Persona escolhida no ato 1 ('1'|'2'|'3'|'4' ou null). */
  async getUserPersona() {
    const data = await getEventData(this.phone, 'act_01_persona_selected');
    return data?.choice || null;
  }

  // ── Uso / contagens ──────────────────────────────────────────────────────────

  /** Total de mensagens enviadas pelo usuário (todos os dias). */
  async getTotalInteractions() {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('daily_message_counts')
      .select('message_count')
      .eq('phone', this.phone);
    return (data || []).reduce((s, r) => s + (r.message_count || 0), 0);
  }

  async getPrintCount() {
    const supabase = getSupabase();
    const { count } = await supabase
      .from('print_analyses')
      .select('*', { count: 'exact', head: true })
      .eq('phone', this.phone);
    return count || 0;
  }

  async getAuditCount() {
    const supabase = getSupabase();
    const { count } = await supabase
      .from('profile_audits')
      .select('*', { count: 'exact', head: true })
      .eq('phone', this.phone);
    return count || 0;
  }

  async getHerAnalysisCount() {
    const supabase = getSupabase();
    const { count } = await supabase
      .from('profile_her_analyses')
      .select('*', { count: 'exact', head: true })
      .eq('phone', this.phone);
    return count || 0;
  }

  async getPapoCount() {
    const supabase = getSupabase();
    const { count } = await supabase
      .from('transition_coach_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('phone', this.phone)
      .catch(() => ({ count: 0 }));
    return count || 0;
  }

  /** Verifica se o usuário bateu qualquer limite hoje. */
  async hitAnyLimitToday() {
    const today = new Date().toISOString().slice(0, 10);
    const supabase = getSupabase();
    const { data } = await supabase
      .from('user_journey_events')
      .select('id')
      .eq('phone', this.phone)
      .in('event_type', ['hit_daily_limit_response', 'hit_daily_limit_print', 'hit_daily_limit_papo'])
      .gte('created_at', `${today}T00:00:00.000Z`)
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  // ── Links de assinatura ───────────────────────────────────────────────────────

  /** Retorna link de checkout ou instrução textual se não configurado. */
  getCheckoutLink(plan) {
    if (plan === 'parceiro_pro') {
      return process.env.LINK_PARCEIRO_PRO || process.env.LINK_PRO || 'Digita *pro* aqui mesmo 👇';
    }
    return process.env.LINK_PARCEIRO || 'Digita *mensal* aqui mesmo 👇';
  }

  /** Persiste um campo no registro do usuário no banco. */
  async setUserField(field, value) {
    await getSupabase()
      .from('users')
      .update({ [field]: value })
      .eq('phone', this.phone);
  }

  // ── Última mensagem do usuário ────────────────────────────────────────────────

  /** Minutos desde a última mensagem do usuário (usa daily_message_counts como proxy). */
  async minutesSinceLastMessage() {
    const supabase = getSupabase();
    // Busca a última entrada na tabela de requests
    const { data } = await supabase
      .from('api_requests')
      .select('created_at')
      .eq('phone', this.phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.created_at) return Infinity;
    return (Date.now() - new Date(data.created_at).getTime()) / 60_000;
  }
}

module.exports = { TriggerContext };
