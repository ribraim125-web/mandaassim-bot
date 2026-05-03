/**
 * mindsetCapsules.js — Cápsulas de Mindset Opt-In (Camada 6)
 *
 * IMPORTANTE: bot NÃO gera cápsulas com IA.
 * Apenas seleciona/prioriza do banco. Conteúdo é 100% curado por humano.
 *
 * Fluxo:
 * 1. Pro user com 14+ dias → convite opt-in
 * 2. Usuário aceita → ativado com frequência padrão 3x/semana
 * 3. Worker envia cápsulas no horário configurado
 * 4. Priorização: lê histórico para escolher categoria mais relevante
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

// Dias antes de mandar convite após ativação Pro
const INVITE_DELAY_DAYS = 14;

// Janela de resposta ao convite antes de considerar ignorado (dias)
const INVITE_RESPONSE_WINDOW_DAYS = 7;

// Não manda convite de novo por N dias se declinou
const REINVITE_COOLDOWN_DAYS = 90;

// Categorias disponíveis
const CATEGORIES = [
  'postura_masculina_madura',
  'lidar_com_rejeicao',
  'construir_abundancia',
  'honestidade_emocional',
  'identidade_pos_divorcio',
  'equilibrio_paquera_vida',
  'ler_intencao_dela',
  'boundaries_saudaveis',
  'quando_insistir_soltar',
  'auto_percepcao',
];

// Mapeamento de context signals → categoria prioritária
const CONTEXT_PRIORITY = {
  'rejected':              'lidar_com_rejeicao',
  'never_responded':       'quando_insistir_soltar',
  'poor_encounter':        'lidar_com_rejeicao',
  'insisting_pattern':     'quando_insistir_soltar',
  'divorced_context':      'identidade_pos_divorcio',
};

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

// ── Opt-in record ─────────────────────────────────────────────────────────────

/**
 * Retorna (ou cria) o registro de opt-in do usuário.
 */
async function getOptIn(phone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('mindset_opt_ins')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  return data || null;
}

/**
 * Cria registro de opt-in se não existe, registrando first_pro_at.
 */
async function ensureOptInRecord(phone) {
  const supabase = getSupabase();
  await supabase
    .from('mindset_opt_ins')
    .upsert(
      { phone, first_pro_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'phone', ignoreDuplicates: false }
    );
  // Only sets first_pro_at on insert — existing rows keep their value
  // Use a separate update to set only if null
  await supabase
    .from('mindset_opt_ins')
    .update({ updated_at: new Date().toISOString() })
    .eq('phone', phone)
    .is('first_pro_at', null)
    .then(() => supabase
      .from('mindset_opt_ins')
      .update({ first_pro_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('phone', phone)
      .is('first_pro_at', null)
    ).catch(() => {});
}

/**
 * Verifica se deve enviar o convite opt-in para este usuário Pro.
 * Retorna true se:
 * - first_pro_at + INVITE_DELAY_DAYS <= agora
 * - invite_sent_at IS NULL
 * - invite_declined_at IS NULL (ou > REINVITE_COOLDOWN_DAYS)
 */
async function shouldSendInvite(phone) {
  try {
    const supabase = getSupabase();

    // Garante que o registro existe
    await supabase
      .from('mindset_opt_ins')
      .upsert(
        { phone, updated_at: new Date().toISOString() },
        { onConflict: 'phone', ignoreDuplicates: true }
      );

    const { data } = await supabase
      .from('mindset_opt_ins')
      .select('first_pro_at, invite_sent_at, invite_declined_at, opted_in_at')
      .eq('phone', phone)
      .maybeSingle();

    if (!data) return false;

    // Já optou em
    if (data.opted_in_at) return false;

    // Já enviou convite
    if (data.invite_sent_at) return false;

    // Declinou recentemente
    if (data.invite_declined_at) {
      const daysSinceDecline = (Date.now() - new Date(data.invite_declined_at).getTime()) / 86400000;
      if (daysSinceDecline < REINVITE_COOLDOWN_DAYS) return false;
    }

    // Verifica se passou a janela de espera
    if (!data.first_pro_at) return false;
    const daysSincePro = (Date.now() - new Date(data.first_pro_at).getTime()) / 86400000;
    return daysSincePro >= INVITE_DELAY_DAYS;
  } catch (_) {
    return false;
  }
}

/**
 * Verifica se o usuário está aguardando resposta ao convite recente.
 */
async function hasPendingInviteResponse(phone) {
  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - INVITE_RESPONSE_WINDOW_DAYS * 86400000).toISOString();
    const { data } = await supabase
      .from('mindset_opt_ins')
      .select('invite_sent_at, opted_in_at, invite_declined_at')
      .eq('phone', phone)
      .maybeSingle();
    if (!data?.invite_sent_at) return false;
    if (data.opted_in_at || data.invite_declined_at) return false;
    return data.invite_sent_at >= cutoff;
  } catch (_) {
    return false;
  }
}

async function markInviteSent(phone) {
  const supabase = getSupabase();
  await supabase
    .from('mindset_opt_ins')
    .upsert(
      { phone, invite_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'phone' }
    );
}

async function activateOptIn(phone) {
  const supabase = getSupabase();
  await supabase
    .from('mindset_opt_ins')
    .upsert(
      {
        phone,
        enabled: true,
        opted_in_at: new Date().toISOString(),
        opted_out_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'phone' }
    );
}

async function deactivateOptIn(phone) {
  const supabase = getSupabase();
  await supabase
    .from('mindset_opt_ins')
    .update({ enabled: false, opted_out_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('phone', phone);
}

async function markInviteDeclined(phone) {
  const supabase = getSupabase();
  await supabase
    .from('mindset_opt_ins')
    .update({ invite_declined_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('phone', phone);
}

/**
 * Atualiza frequência e dias de envio.
 */
async function updateFrequency(phone, frequency) {
  const supabase = getSupabase();
  const daysByFreq = {
    1: [1],           // só segunda
    3: [1, 3, 5],     // seg, qua, sex
    5: [1, 2, 3, 4, 5], // seg a sex
    7: [1, 2, 3, 4, 5, 6, 7], // todos os dias
  };
  const days = daysByFreq[frequency] || [1, 3, 5];
  await supabase
    .from('mindset_opt_ins')
    .update({ frequency, schedule_days: days, updated_at: new Date().toISOString() })
    .eq('phone', phone);
}

// ── Seleção de cápsula ────────────────────────────────────────────────────────

/**
 * Retorna contagem de entregas por categoria para este usuário.
 */
async function getDeliveryCountsPerCategory(phone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('mindset_deliveries')
    .select('category')
    .eq('phone', phone);

  const counts = {};
  for (const cat of CATEGORIES) counts[cat] = 0;
  for (const row of (data || [])) {
    if (counts[row.category] !== undefined) counts[row.category]++;
  }
  return counts;
}

/**
 * Determina categoria prioritária baseada no histórico do usuário.
 * Consulta postdate_sessions e transition_coach_sessions.
 */
async function getPriorityCategory(phone) {
  try {
    const supabase = getSupabase();

    // Verifica últimos debriefs pós-date
    const { data: debriefs } = await supabase
      .from('postdate_sessions')
      .select('encounter_quality')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(3);

    const recentPoorEncounters = (debriefs || []).filter(d =>
      d.encounter_quality === 'poor' || d.encounter_quality === 'neutral'
    ).length;

    if (recentPoorEncounters >= 2) return CONTEXT_PRIORITY['poor_encounter'];

    // Verifica últimos outcomes de transition coach
    const { data: transitions } = await supabase
      .from('transition_coach_sessions')
      .select('outcome')
      .eq('phone', phone)
      .not('outcome', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3);

    const outcomes = (transitions || []).map(t => t.outcome);
    if (outcomes.includes('rejected') || outcomes.includes('never_responded')) {
      return CONTEXT_PRIORITY['rejected'];
    }

    return null; // sem prioridade contextual
  } catch (_) {
    return null;
  }
}

/**
 * Seleciona a próxima cápsula para envio.
 * Prioriza variedade e contexto do usuário.
 *
 * @param {string} phone
 * @returns {Promise<{id, category, body} | null>}
 */
async function selectNextCapsule(phone) {
  try {
    const supabase = getSupabase();

    const [counts, priorityCategory] = await Promise.all([
      getDeliveryCountsPerCategory(phone),
      getPriorityCategory(phone),
    ]);

    // Score de cada categoria: -count (favorece menos usadas) + bônus de contexto
    const scores = CATEGORIES.map(cat => ({
      cat,
      score: -counts[cat] + (cat === priorityCategory ? 5 : 0),
    }));

    // Ordena por score desc, com tie-break aleatório
    scores.sort((a, b) => b.score - a.score || Math.random() - 0.5);

    // Tenta encontrar cápsula não enviada na categoria de maior score
    for (const { cat } of scores) {
      // IDs de cápsulas já enviadas nesta categoria
      const { data: sent } = await supabase
        .from('mindset_deliveries')
        .select('capsule_id')
        .eq('phone', phone)
        .eq('category', cat);

      const sentIds = (sent || []).map(r => r.capsule_id);

      // Busca cápsulas ativas desta categoria não enviadas ainda
      let query = supabase
        .from('mindset_capsules')
        .select('id, category, body')
        .eq('category', cat)
        .eq('is_active', true);

      if (sentIds.length > 0) {
        query = query.not('id', 'in', `(${sentIds.join(',')})`);
      }

      const { data: available } = await query;

      if (available && available.length > 0) {
        // Escolhe aleatoriamente entre as disponíveis
        return available[Math.floor(Math.random() * available.length)];
      }
    }

    // Fallback: todas as cápsulas já foram enviadas — repete a menos recente
    const { data: oldest } = await supabase
      .from('mindset_deliveries')
      .select('capsule_id, category, mindset_capsules(id, category, body)')
      .eq('phone', phone)
      .order('sent_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    return oldest?.mindset_capsules || null;
  } catch (err) {
    console.error('[MindsetCapsules] Erro ao selecionar cápsula:', err.message);
    return null;
  }
}

/**
 * Registra entrega de cápsula.
 */
async function recordDelivery(phone, capsuleId, category) {
  try {
    const supabase = getSupabase();
    await supabase
      .from('mindset_deliveries')
      .insert({ phone, capsule_id: capsuleId, category, sent_at: new Date().toISOString() });
  } catch (err) {
    console.error('[MindsetCapsules] Erro ao registrar entrega:', err.message);
  }
}

/**
 * Verifica se o usuário já recebeu cápsula hoje.
 */
async function receivedCapsuleToday(phone) {
  try {
    const supabase = getSupabase();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('mindset_deliveries')
      .select('id')
      .eq('phone', phone)
      .gte('sent_at', todayStart.toISOString())
      .limit(1)
      .maybeSingle();
    return !!data?.id;
  } catch (_) {
    return false;
  }
}

module.exports = {
  CATEGORIES,
  INVITE_DELAY_DAYS,
  getOptIn,
  ensureOptInRecord,
  shouldSendInvite,
  hasPendingInviteResponse,
  markInviteSent,
  activateOptIn,
  deactivateOptIn,
  markInviteDeclined,
  updateFrequency,
  selectNextCapsule,
  recordDelivery,
  receivedCapsuleToday,
};
