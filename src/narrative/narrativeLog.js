/**
 * narrativeLog.js — log de atos enviados, variante A/B e outcomes
 *
 * Cada ato é enviado no máximo 1x por usuário (UNIQUE phone + act_id).
 */

const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

/**
 * Atribui variante A/B de forma determinística pelo número de telefone.
 * Mesmo usuário sempre recebe a mesma variante para o mesmo ato.
 */
function assignVariant(phone, numVariants = 2) {
  let hash = 0;
  for (const c of phone) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const idx = Math.abs(hash) % numVariants;
  return String.fromCharCode(65 + idx); // 'A', 'B', 'C'...
}

/**
 * Verifica se um ato já foi enviado para o usuário.
 */
async function hasActBeenSent(phone, actId) {
  try {
    const { data } = await getSupabase()
      .from('narrative_messages_log')
      .select('id')
      .eq('phone', phone)
      .eq('act_id', actId)
      .limit(1)
      .maybeSingle();
    return !!data;
  } catch (_) {
    return false;
  }
}

/**
 * Retorna timestamp do último ato enviado ao usuário (para cooldown de 1/dia).
 */
async function getLastActSentAt(phone) {
  try {
    const { data } = await getSupabase()
      .from('narrative_messages_log')
      .select('sent_at')
      .eq('phone', phone)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.sent_at ? new Date(data.sent_at) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Registra o envio de um ato.
 * Retorna false se já foi enviado (não duplica).
 *
 * @param {string} phone
 * @param {string} actId
 * @param {string} variant — 'A' | 'B' | 'C'
 * @param {string} [copyUsed] — texto exato enviado (para auditoria)
 * @returns {Promise<boolean>} true = novo, false = já existia
 */
async function logActSent(phone, actId, variant, copyUsed) {
  try {
    const row = { phone, act_id: actId, variant };
    if (copyUsed) row.copy_used = copyUsed.slice(0, 2000); // trunca pra não explodir
    const { error } = await getSupabase()
      .from('narrative_messages_log')
      .insert(row);

    if (error?.code === '23505') return false; // unique violation — já enviado
    if (error) throw error;
    return true;
  } catch (err) {
    console.error(`[NarrativeLog] Erro ao logar ato ${actId} para ${phone}:`, err.message);
    return false;
  }
}

/**
 * Registra que o usuário respondeu ao ato e o outcome.
 */
async function recordOutcome(phone, actId, outcome) {
  try {
    await getSupabase()
      .from('narrative_messages_log')
      .update({
        user_responded:     true,
        responded_at:       new Date().toISOString(),
        conversion_outcome: outcome,
      })
      .eq('phone', phone)
      .eq('act_id', actId);
  } catch (err) {
    console.error(`[NarrativeLog] Erro ao registrar outcome ${actId} para ${phone}:`, err.message);
  }
}

/**
 * Retorna estatísticas de todos os atos para o período.
 *
 * @param {Date|string} since
 * @param {Date|string} until
 */
async function getNarrativeStats(since, until) {
  try {
    const start = new Date(since).toISOString();
    const end   = new Date(until).toISOString();

    const { data } = await getSupabase()
      .from('narrative_messages_log')
      .select('act_id, variant, user_responded, conversion_outcome, sent_at')
      .gte('sent_at', start)
      .lte('sent_at', end);

    if (!data || data.length === 0) return [];

    // Agrupa por act_id + variant
    const groups = {};
    for (const row of data) {
      const key = `${row.act_id}|||${row.variant}`;
      if (!groups[key]) {
        groups[key] = {
          act_id:   row.act_id,
          variant:  row.variant,
          sent:     0,
          responded:0,
          outcomes: {},
        };
      }
      groups[key].sent++;
      if (row.user_responded) groups[key].responded++;
      const oc = row.conversion_outcome || 'pending';
      groups[key].outcomes[oc] = (groups[key].outcomes[oc] || 0) + 1;
    }

    return Object.values(groups).sort((a, b) =>
      a.act_id.localeCompare(b.act_id) || a.variant.localeCompare(b.variant)
    );
  } catch (err) {
    console.error('[NarrativeLog] Erro ao buscar stats:', err.message);
    return [];
  }
}

module.exports = {
  assignVariant,
  hasActBeenSent,
  getLastActSentAt,
  logActSent,
  recordOutcome,
  getNarrativeStats,
};
