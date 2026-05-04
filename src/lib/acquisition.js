/**
 * acquisition.js — rastreamento de origem de usuários
 *
 * Fluxo:
 * 1. Cria link: wa.me/+55...?text=mandaassim_<slug>
 * 2. Usuário abre WhatsApp com esse texto pré-preenchido e envia
 * 3. Bot detecta o padrão na PRIMEIRA mensagem e atribui origem
 * 4. Atribuição é first-touch: nunca sobrescreve após salvo
 * 5. Sem slug → salva como "direct"
 *
 * Formato do slug no link: mandaassim_<slug>
 * Exemplo: mandaassim_instagram_reel_001
 */

const { createClient } = require('@supabase/supabase-js');

// Padrão: "mandaassim_" + slug alfanumérico com _ e -
const SLUG_REGEX = /^mandaassim_([a-z0-9][a-z0-9_-]{1,60})$/i;

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

/**
 * Extrai o slug de uma mensagem de texto.
 * Retorna o slug (ex: "instagram_reel_001") ou null se não for um slug de aquisição.
 */
function parseAcquisitionSlug(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.trim().match(SLUG_REGEX);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Resolve source/medium/campaign a partir de um slug.
 * Busca primeiro na tabela acquisition_links; se não encontrar,
 * tenta parsear o slug como source_medium_campaign.
 */
async function resolveAttribution(slug) {
  try {
    const { data } = await getSupabase()
      .from('acquisition_links')
      .select('source, medium, campaign')
      .eq('slug', slug)
      .maybeSingle();

    if (data) {
      return {
        source:   data.source,
        medium:   data.medium,
        campaign: data.campaign || slug,
      };
    }
  } catch (_) {
    // ignora erro de DB — cai no fallback
  }

  // Fallback: parseia slug como source_medium_...campaign...
  const parts = slug.split('_');
  return {
    source:   parts[0] || 'unknown',
    medium:   parts[1] || 'unknown',
    campaign: parts.length > 2 ? parts.slice(2).join('_') : slug,
  };
}

/**
 * Salva a atribuição de origem para um usuário.
 * - Se slug fornecido: resolve source/medium/campaign
 * - Se slug null: marca como "direct"
 * - Se usuário já tem attribution_source preenchido: NÃO sobrescreve (first-touch)
 *
 * Nunca lança exceção — falha silenciosamente.
 */
async function saveAttribution(phone, slug) {
  try {
    const supabase = getSupabase();

    // Verifica se já tem atribuição salva (first-touch: não sobrescreve)
    const { data: existing } = await supabase
      .from('users')
      .select('acquisition_source')
      .eq('phone', phone)
      .maybeSingle();

    if (existing?.acquisition_source) return; // já atribuído, não mexe

    let source = 'direct';
    let medium = 'direct';
    let campaign = null;

    if (slug) {
      const attr = await resolveAttribution(slug);
      source   = attr.source;
      medium   = attr.medium;
      campaign = attr.campaign;
      console.log(`[Aquisição] ${phone} → source:${source} medium:${medium} campaign:${campaign}`);
    } else {
      console.log(`[Aquisição] ${phone} → direct (sem slug)`);
    }

    const now = new Date().toISOString();
    await supabase.from('users').update({
      acquisition_slug:             slug || null,
      acquisition_source:           source,
      acquisition_medium:           medium,
      acquisition_campaign:         campaign,
      acquisition_first_seen_at:    now,
      acquisition_first_message_at: now,
    }).eq('phone', phone);

  } catch (err) {
    console.error('[Aquisição] Erro ao salvar atribuição:', err.message);
  }
}

/**
 * Retorna estatísticas de aquisição por canal para um período.
 * Inclui funil completo por plano e custo IA do cohort.
 *
 * @param {Date|string} periodStart
 * @param {Date|string} periodEnd
 * @returns {Promise<Array<{
 *   source, medium, campaign, signups,
 *   plan_free, plan_wingman, plan_wingman_pro,
 *   conv_trial_to_paid, conv_free_to_wingman, conv_wingman_to_pro,
 *   ia_cost_brl, ltv_avg_brl
 * }>>}
 */
async function getAcquisitionStats(periodStart, periodEnd) {
  const supabase = getSupabase();
  const start = new Date(periodStart).toISOString();
  const end   = new Date(periodEnd).toISOString();

  // Usuários cadastrados no período
  const { data: users } = await supabase
    .from('users')
    .select('phone, acquisition_source, acquisition_medium, acquisition_campaign, acquisition_slug, plan, created_at')
    .gte('created_at', start)
    .lte('created_at', end);

  if (!users || users.length === 0) return [];

  const phones = users.map(u => u.phone);

  // Pagamentos aprovados desses usuários (para LTV)
  const { data: payments } = await supabase
    .from('payments')
    .select('phone, amount, status, plan')
    .in('phone', phones)
    .eq('status', 'approved');

  // Custo IA total por usuário (via api_requests)
  const { data: apiCosts } = await supabase
    .from('api_requests')
    .select('phone, estimated_cost_brl')
    .in('phone', phones);

  // Mapa de plano atual por telefone
  const planByPhone = {};
  users.forEach(u => { planByPhone[u.phone] = u.plan || 'trial'; });

  // LTV por telefone (soma de pagamentos aprovados)
  const ltvByPhone = {};
  (payments || []).forEach(p => {
    ltvByPhone[p.phone] = (ltvByPhone[p.phone] || 0) + (parseFloat(p.amount) || 0);
  });

  // Custo IA por telefone
  const iaCostByPhone = {};
  (apiCosts || []).forEach(r => {
    iaCostByPhone[r.phone] = (iaCostByPhone[r.phone] || 0) + (parseFloat(r.estimated_cost_brl) || 0);
  });

  // Agrupa por source/medium/campaign
  const groups = {};
  users.forEach(u => {
    const key = [
      u.acquisition_source   || 'direct',
      u.acquisition_medium   || 'direct',
      u.acquisition_campaign || 'none',
    ].join('|||');

    if (!groups[key]) {
      groups[key] = {
        source:   u.acquisition_source   || 'direct',
        medium:   u.acquisition_medium   || 'direct',
        campaign: u.acquisition_campaign || null,
        phones:   [],
      };
    }
    groups[key].phones.push(u.phone);
  });

  return Object.values(groups).map(g => {
    const gPhones = g.phones;
    const signups = gPhones.length;

    // Distribuição por plano atual
    const planFree       = gPhones.filter(p => planByPhone[p] === 'free').length;
    const planWingman    = gPhones.filter(p => planByPhone[p] === 'wingman').length;
    const planWingmanPro = gPhones.filter(p => planByPhone[p] === 'wingman_pro').length;
    const planTrial      = gPhones.filter(p => planByPhone[p] === 'trial').length;

    // Conversões por etapa do funil
    const convTrialToPaid    = planWingman + planWingmanPro;            // saiu do trial/free para qualquer plano pago
    const convFreeToWingman  = planWingman + planWingmanPro;            // mesmo: atingiu wingman ou pro
    const convWingmanToPro   = planWingmanPro;                          // chegou ao Pro

    // Custo IA total e LTV médio do cohort
    const iaCostBrl = gPhones.reduce((s, p) => s + (iaCostByPhone[p] || 0), 0);
    const ltvTotal  = gPhones.reduce((s, p) => s + (ltvByPhone[p]   || 0), 0);
    const ltvAvg    = signups > 0 ? ltvTotal / signups : 0;

    return {
      source:               g.source,
      medium:               g.medium,
      campaign:             g.campaign,
      signups,
      plan_trial:           planTrial,
      plan_free:            planFree,
      plan_wingman:         planWingman,
      plan_wingman_pro:     planWingmanPro,
      conv_trial_to_paid:   convTrialToPaid,
      conv_free_to_wingman: convFreeToWingman,
      conv_wingman_to_pro:  convWingmanToPro,
      conv_rate_pct:        signups > 0 ? parseFloat((convTrialToPaid / signups * 100).toFixed(1)) : 0,
      ia_cost_brl:          parseFloat(iaCostBrl.toFixed(2)),
      ltv_avg_brl:          parseFloat(ltvAvg.toFixed(2)),
    };
  }).sort((a, b) => b.signups - a.signups);
}

module.exports = { parseAcquisitionSlug, saveAttribution, getAcquisitionStats };
