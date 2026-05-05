/**
 * features.js — Matriz de features e limites por plano
 *
 * Planos: trial | free | parceiro | parceiro_pro
 *
 * Uso:
 *   const { canUseFeature, incrementFeatureUsage } = require('./src/config/features');
 *   const check = await canUseFeature(phone, plan, 'messages');
 *   if (!check.allowed) { reply(check.upsellMessage); return; }
 *   await incrementFeatureUsage(phone, 'messages');
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Definição de limites por plano e feature
// null = ilimitado
// ---------------------------------------------------------------------------

const FEATURES = {
  // Feature principal: mensagens de conquista
  messages: {
    trial:        { daily: null },   // ilimitado nos 3 dias
    free:         { daily: 3    },
    parceiro:     { daily: null },
    parceiro_pro: { daily: null },
    upsell: {
      free: (remaining) =>
        remaining === 0
          ? `Deu 3 por hoje. Amanhã renova.\n\nSe a conversa tá quente e não dá pra esperar: *mensal* (R$29,90).`
          : `_${3 - remaining}/3 análises usadas hoje._`,
    },
  },

  // Camada 1 — Análise de print de conversa
  print_analysis: {
    trial:        { daily: 1 },
    free:         { daily: 0 },     // bloqueado — upsell
    parceiro:     { daily: 5 },
    parceiro_pro: { daily: 5 },
    upsell: {
      free: () =>
        `Análise de print é uma feature do *Parceiro* 🔍\n\n` +
        `Com ela: manda qualquer conversa do Tinder, WhatsApp ou Bumble e eu leio o que tá rolando.\n\n` +
        `📅 *Mensal* — R$29,90/mês → digita *mensal*`,
      trial: () =>
        `Deu 1 análise de print por hoje — esse é o limite do trial.\n\nQuer ilimitado? Digita *mensal* (R$29,90).`,
      parceiro: () =>
        `Chegou no limite de 5 análises de print hoje.\n\nAmanhã cedo tem mais 5. Usa texto enquanto isso.`,
      parceiro_pro: () =>
        `Chegou no limite de 5 análises de print hoje.\n\nAmanhã cedo tem mais 5.`,
    },
  },

  // Camada 2 — Análise de perfil (Tinder/Bumble)
  profile_analysis: {
    trial:        { daily: 0 },     // bloqueado — upsell
    free:         { daily: 0 },
    parceiro:     { daily: 0 },     // bloqueado — exclusivo Pro
    parceiro_pro: { daily: 10 },
    upsell: {
      free: () =>
        `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\n` +
        `Você manda o print do perfil dela no Tinder, Bumble ou Instagram — eu leio o que ela revela e gero a primeira mensagem certa.\n\n` +
        `Digita *pro* 👇`,
      trial: () =>
        `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      parceiro: () =>
        `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      parceiro_pro: () =>
        `Chegou no limite de 10 análises de perfil hoje.\n\nAmanhã cedo tem mais 10.`,
    },
  },

  // Camada 3 — Coach de Transição
  transition_coach: {
    trial:        { monthly: 0 },   // bloqueado
    free:         { monthly: 0 },
    parceiro:     { monthly: 2 },
    parceiro_pro: { monthly: null },
    upsell: {
      free: () =>
        `Marcar o primeiro encontro é o momento mais crítico — e a maioria erra aqui.\n\n` +
        `Com o *Coach de Transição* eu te guio pra hora certa, com a mensagem certa.\n\n` +
        `Disponível no *Parceiro* (R$29,90/mês).\n\n` +
        `Digita *mensal* 👇`,
      trial: () =>
        `Coach de Transição é do *Parceiro* (R$29,90/mês).\n\nDigita *mensal* 👇`,
      parceiro: () =>
        `Você já usou as 2 sessões do Coach de Transição esse mês.\n\n` +
        `Renova no mês que vem, ou faz upgrade pro *Parceiro Pro* (ilimitado) 🔥\n\n` +
        `Digita *pro* se quiser.`,
    },
  },

  // Camada 4 — Coach Pré-Date
  predate_coach: {
    trial:        { monthly: 0 },
    free:         { monthly: 0 },
    parceiro:     { monthly: 1 },
    parceiro_pro: { monthly: null },
    upsell: {
      free: () =>
        `Preparação para encontro é do *Parceiro* 🗓️\n\n` +
        `Você me conta quando e onde — eu te dou o checklist completo.\n\n` +
        `Digita *mensal* 👇`,
      trial: () =>
        `Coach Pré-Date é do *Parceiro* (R$29,90/mês).\n\nDigita *mensal* 👇`,
      parceiro: () =>
        `Você já usou sua sessão pré-date do mês.\n\n` +
        `Renova no mês que vem, ou faz upgrade pro *Parceiro Pro* (ilimitado) 🔥\n\n` +
        `Digita *pro* se quiser.`,
    },
  },

  // Camada 5 — Auditar Meu Perfil (Vision — Parceiro Pro)
  profile_self_audit: {
    trial:        { daily: 0 },
    free:         { daily: 0 },
    parceiro:     { daily: 0 },
    parceiro_pro: { daily: 30 },
    upsell: {
      free: () =>
        `Auditoria de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\n` +
        `Manda print do teu perfil — eu analiso foto a foto, bio e te dou as 3 mudanças mais impactantes.\n\n` +
        `Digita *pro* 👇`,
      trial: () =>
        `Auditoria de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      parceiro: () =>
        `Auditoria de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      parceiro_pro: () =>
        `Chegou no limite de 30 auditorias hoje.\n\nAmanhã cedo tem mais 30.`,
    },
  },

  // Camada 6 — Analisar Perfil Dela (Vision — Parceiro Pro)
  profile_her_analysis: {
    trial:        { daily: 0 },
    free:         { daily: 0 },
    parceiro:     { daily: 0 },
    parceiro_pro: { daily: 30 },
    upsell: {
      free: () =>
        `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\n` +
        `Você manda o print do perfil dela no Tinder, Bumble ou Instagram — eu leio o que ela revela e gero a primeira mensagem certa.\n\n` +
        `Digita *pro* 👇`,
      trial: () =>
        `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      parceiro: () =>
        `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      parceiro_pro: () =>
        `Chegou no limite de 30 análises de perfil hoje.\n\nAmanhã cedo tem mais 30.`,
    },
  },

  // Camada 7 — Debrief Pós-Date
  postdate_debrief: {
    trial:        { monthly: 0 },
    free:         { monthly: 0 },
    parceiro:     { monthly: 1 },
    parceiro_pro: { monthly: null },
    upsell: {
      free: () =>
        `Debrief de encontro é do *Parceiro* 🔍\n\n` +
        `Você me conta como foi — eu analiso o que rolou, o que funcionou, o que errou.\n\n` +
        `Sem rodeios. Honestidade total.\n\n` +
        `Digita *mensal* 👇`,
      trial: () =>
        `Debrief Pós-Date é do *Parceiro* (R$29,90/mês).\n\nDigita *mensal* 👇`,
      parceiro: () =>
        `Você já fez seu debrief do mês.\n\n` +
        `Renova no mês que vem, ou faz upgrade pro *Parceiro Pro* (ilimitado) 🔥\n\n` +
        `Digita *pro* se quiser.`,
    },
  },
};

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

// ---------------------------------------------------------------------------
// Consulta de uso atual
// ---------------------------------------------------------------------------

async function getDailyUsage(phone, featureKey) {
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('daily_usage')
    .select('count')
    .eq('phone', phone)
    .eq('usage_date', today)
    .eq('feature_key', featureKey)
    .maybeSingle();
  return data?.count ?? 0;
}

async function getMonthlyUsage(phone, featureKey) {
  const supabase = getSupabase();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const startDate = startOfMonth.toISOString().slice(0, 10);
  const { data } = await supabase
    .from('daily_usage')
    .select('count')
    .eq('phone', phone)
    .eq('feature_key', featureKey)
    .gte('usage_date', startDate);
  return (data || []).reduce((sum, row) => sum + (row.count ?? 0), 0);
}

// ---------------------------------------------------------------------------
// canUseFeature — verificação principal
// ---------------------------------------------------------------------------

/**
 * Verifica se o usuário pode usar uma feature.
 *
 * @param {string} phone
 * @param {string} plan — 'trial' | 'free' | 'wingman' | 'wingman_pro'
 * @param {string} featureKey — chave da feature em FEATURES
 * @returns {Promise<{ allowed: boolean, reason: string|null, remaining: number|null, upsellMessage: string|null }>}
 */
const PLAN_NORMALIZE = { wingman: 'parceiro', wingman_pro: 'parceiro_pro', premium: 'parceiro', pro: 'parceiro_pro', direto: 'parceiro', direto_pro: 'parceiro_pro' };

async function canUseFeature(phone, plan, featureKey) {
  const p = PLAN_NORMALIZE[plan] || plan;
  const feature = FEATURES[featureKey];
  if (!feature) return { allowed: true, reason: null, remaining: null, upsellMessage: null };

  const limits = feature[p];
  if (!limits) return { allowed: true, reason: null, remaining: null, upsellMessage: null };

  const upsells = feature.upsell || {};

  // Limite diário
  if (limits.daily !== undefined) {
    if (limits.daily === 0) {
      return {
        allowed: false,
        reason: 'plan_blocked',
        remaining: 0,
        upsellMessage: upsells[p]?.() || null,
      };
    }
    if (limits.daily === null) {
      return { allowed: true, reason: null, remaining: null, upsellMessage: null };
    }
    const used = await getDailyUsage(phone, featureKey);
    if (used >= limits.daily) {
      return {
        allowed: false,
        reason: 'daily_limit',
        remaining: 0,
        upsellMessage: upsells[p]?.() || null,
      };
    }
    return { allowed: true, reason: null, remaining: limits.daily - used, upsellMessage: null };
  }

  // Limite mensal
  if (limits.monthly !== undefined) {
    if (limits.monthly === 0) {
      return {
        allowed: false,
        reason: 'plan_blocked',
        remaining: 0,
        upsellMessage: upsells[p]?.() || null,
      };
    }
    if (limits.monthly === null) {
      return { allowed: true, reason: null, remaining: null, upsellMessage: null };
    }
    const used = await getMonthlyUsage(phone, featureKey);
    if (used >= limits.monthly) {
      return {
        allowed: false,
        reason: 'monthly_limit',
        remaining: 0,
        upsellMessage: upsells[p]?.() || null,
      };
    }
    return { allowed: true, reason: null, remaining: limits.monthly - used, upsellMessage: null };
  }

  return { allowed: true, reason: null, remaining: null, upsellMessage: null };
}

// ---------------------------------------------------------------------------
// incrementFeatureUsage — registra uso
// ---------------------------------------------------------------------------

/**
 * Incrementa o contador de uso de uma feature para hoje.
 *
 * @param {string} phone
 * @param {string} featureKey
 * @returns {Promise<number>} novo total do dia
 */
async function incrementFeatureUsage(phone, featureKey) {
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('daily_usage')
    .select('count')
    .eq('phone', phone)
    .eq('usage_date', today)
    .eq('feature_key', featureKey)
    .maybeSingle();

  const newCount = (existing?.count ?? 0) + 1;

  await supabase
    .from('daily_usage')
    .upsert(
      { phone, usage_date: today, feature_key: featureKey, count: newCount, updated_at: new Date().toISOString() },
      { onConflict: 'phone,usage_date,feature_key' }
    );

  return newCount;
}

// ---------------------------------------------------------------------------
// Helpers de leitura de plano
// ---------------------------------------------------------------------------

const PLAN_LABELS = {
  trial:        '🎉 Trial',
  free:         '🆓 Free',
  parceiro:     '🌟 Parceiro',
  parceiro_pro: '🔥 Parceiro Pro',
};

function getPlanLabel(plan) {
  const p = PLAN_NORMALIZE[plan] || plan;
  return PLAN_LABELS[p] || '🆓 Free';
}

module.exports = {
  FEATURES,
  canUseFeature,
  incrementFeatureUsage,
  getDailyUsage,
  getMonthlyUsage,
  getPlanLabel,
};
