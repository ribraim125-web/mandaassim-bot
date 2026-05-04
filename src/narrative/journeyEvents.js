/**
 * journeyEvents.js — logging e consulta de eventos comportamentais do usuário
 *
 * Eventos válidos:
 *   signup, first_message_sent, first_response_suggestion_received,
 *   first_print_analyzed, third_print_analyzed,
 *   first_coach_conversation,
 *   hit_daily_limit_response, hit_daily_limit_print, hit_daily_limit_coach,
 *   trial_ended, upgraded_wingman, upgraded_pro,
 *   first_profile_audit_done, first_her_profile_analyzed,
 *   conversation_marked_as_active,
 *   conversation_age_7_days, conversation_age_14_days
 *
 * Fire-and-forget: nunca lança exceção para não travar o fluxo principal.
 */

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

/**
 * Registra um evento de jornada para o usuário.
 * Se o evento já existe (unique por phone+event_type), ignora silenciosamente —
 * use logJourneyEvent com force=true para eventos que podem se repetir.
 *
 * @param {string} phone
 * @param {string} eventType
 * @param {object} eventData — dados extras (ex: { persona: '1', plan: 'trial' })
 * @param {boolean} allowRepeat — se false, não insere se já existe esse event_type pro phone
 */
async function logJourneyEvent(phone, eventType, eventData = {}, allowRepeat = false) {
  try {
    const supabase = getSupabase();

    if (!allowRepeat) {
      const { data: existing } = await supabase
        .from('user_journey_events')
        .select('id')
        .eq('phone', phone)
        .eq('event_type', eventType)
        .limit(1)
        .maybeSingle();
      if (existing) return; // já existe, não duplica
    }

    await supabase.from('user_journey_events').insert({
      phone,
      event_type: eventType,
      event_data: eventData,
    });

  } catch (err) {
    console.error(`[JourneyEvents] Erro ao logar ${eventType} para ${phone}:`, err.message);
  }
}

/**
 * Retorna todos os eventos de jornada de um usuário.
 * @param {string} phone
 * @returns {Promise<Array<{event_type: string, event_data: object, created_at: string}>>}
 */
async function getJourneyEvents(phone) {
  try {
    const { data } = await getSupabase()
      .from('user_journey_events')
      .select('event_type, event_data, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: true });
    return data || [];
  } catch (_) {
    return [];
  }
}

/**
 * Retorna true se o usuário já teve o evento especificado.
 * @param {string} phone
 * @param {string} eventType
 */
async function hasEvent(phone, eventType) {
  try {
    const { data } = await getSupabase()
      .from('user_journey_events')
      .select('id')
      .eq('phone', phone)
      .eq('event_type', eventType)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch (_) {
    return false;
  }
}

/**
 * Retorna o event_data do primeiro evento do tipo especificado.
 * @param {string} phone
 * @param {string} eventType
 * @returns {Promise<object|null>}
 */
async function getEventData(phone, eventType) {
  try {
    const { data } = await getSupabase()
      .from('user_journey_events')
      .select('event_data')
      .eq('phone', phone)
      .eq('event_type', eventType)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.event_data || null;
  } catch (_) {
    return null;
  }
}

/**
 * Conta quantas vezes o usuário teve o evento (para eventos repetíveis).
 */
async function countEvents(phone, eventType) {
  try {
    const { count } = await getSupabase()
      .from('user_journey_events')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone)
      .eq('event_type', eventType);
    return count || 0;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  logJourneyEvent,
  getJourneyEvents,
  hasEvent,
  getEventData,
  countEvents,
};
