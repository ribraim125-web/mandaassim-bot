/**
 * features.js — Matriz de features e limites por plano
 *
 * Planos: trial | free | wingman | wingman_pro
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
    trial:       { daily: null },   // ilimitado nos 3 dias
    free:        { daily: 3    },
    wingman:     { daily: null },
    wingman_pro: { daily: null },
    upsell: {
      free: (remaining) =>
        remaining === 0
          ? `Deu 3 por hoje. Amanhã renova.\n\nSe a conversa tá quente e não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299).`
          : `_${3 - remaining}/3 análises usadas hoje._`,
    },
  },

  // Camada 1 — Análise de print de conversa
  print_analysis: {
    trial:       { daily: 1 },
    free:        { daily: 0 },     // bloqueado — upsell
    wingman:     { daily: 5 },
    wingman_pro: { daily: 5 },
    upsell: {
      free: () =>
        `Análise de print é uma feature do *Wingman* 🔍\n\n` +
        `Com ela: manda qualquer conversa do Tinder, WhatsApp ou Bumble e eu leio o que tá rolando.\n\n` +
        `⚡ *24h ilimitado* — R$4,99 → *24h*\n` +
        `📅 *Mensal* — R$29,90/mês → *mensal*\n` +
        `📆 *Anual* — R$299/ano → *anual*`,
      trial: () =>
        `Deu 1 análise de print por hoje — esse é o limite do trial.\n\nQuer ilimitado? *mensal* (R$29,90) ou *anual* (R$299).`,
      wingman: () =>
        `Chegou no limite de 5 análises de print hoje.\n\nAmanhã cedo tem mais 5. Usa texto enquanto isso.`,
      wingman_pro: () =>
        `Chegou no limite de 5 análises de print hoje.\n\nAmanhã cedo tem mais 5.`,
    },
  },

  // Camada 2 — Análise de perfil (Tinder/Bumble)
  profile_analysis: {
    trial:       { daily: 0 },     // bloqueado — upsell
    free:        { daily: 0 },
    wingman:     { daily: 0 },     // bloqueado — exclusivo Pro
    wingman_pro: { daily: 10 },
    upsell: {
      free: () =>
        `Análise de Perfil é do *Wingman Pro* (R$79,90/mês) 🔍\n\n` +
        `Você manda o print do perfil dela no Tinder, Bumble ou Instagram — eu leio o que ela revela e gero a primeira mensagem certa.\n\n` +
        `Digita *pro* 👇`,
      trial: () =>
        `Análise de Perfil é do *Wingman Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      wingman: () =>
        `Análise de Perfil é do *Wingman Pro* (R$79,90/mês) 🔍\n\nDigita *pro* 👇`,
      wingman_pro: () =>
        `Chegou no limite de 10 análises de perfil hoje.\n\nAmanhã cedo tem mais 10.`,
    },
  },

  // Camada 3 — Coach de Transição
  transition_coach: {
    trial:       { monthly: 0 },   // bloqueado
    free:        { monthly: 0 },
    wingman:     { monthly: 2 },
    wingman_pro: { monthly: null },
    upsell: {
      free: () =>
        `Marcar o primeiro encontro é o momento mais crítico — e a maioria erra aqui.\n\n` +
        `Com o *Coach de Transição* eu te guio pra hora certa, com a mensagem certa.\n\n` +
        `Disponível no *Wingman* (R$29,90/mês) ou *Anual* (R$299).\n\n` +
        `Digita *mensal* ou *anual* 👇`,
      trial: () =>
        `Coach de Transição é do *Wingman* (R$29,90/mês).\n\nDigita *mensal* ou *anual* 👇`,
      wingman: () =>
        `Você já usou as 2 sessões do Coach de Transição esse mês.\n\n` +
        `Renova no mês que vem, ou faz upgrade pro *Wingman Pro* (ilimitado) 🔥\n\n` +
        `Digita *pro* se quiser.`,
    },
  },

  // Camada 4 — Coach Pré-Date
  predate_coach: {
    trial:       { monthly: 0 },
    free:        { monthly: 0 },
    wingman:     { monthly: 1 },
    wingman_pro: { monthly: null },
    upsell: {
      free: () =>
        `Preparação para encontro é do *Wingman* 🗓️\n\n` +
        `Você me conta quando e onde — eu te dou o checklist completo.\n\n` +
        `Digita *mensal* ou *anual* 👇`,
      trial: () =>
        `Coach Pré-Date é do *Wingman* (R$29,90/mês).\n\nDigita *mensal* ou *anual* 👇`,
      wingman: () =>
        `Você já usou sua sessão pré-date do mês.\n\n` +
        `Renova no mês que vem, ou faz upgrade pro *Wingman Pro* (ilimitado) 🔥\n\n` +
        `Digita *pro* se quiser.`,
    },
  },

  // Camada 5 — Debrief Pós-Date
  postdate_debrief: {
    trial:       { monthly: 0 },
    free:        { monthly: 0 },
    wingman:     { monthly: 1 },
    wingman_pro: { monthly: null },
    upsell: {
      free: () =>
        `Debrief de encontro é do *Wingman* 🔍\n\n` +
        `Você me conta como foi — eu analiso o que rolou, o que funcionou, o que errou.\n\n` +
        `Sem rodeios. Honestidade total.\n\n` +
        `Digita *mensal* ou *anual* 👇`,
      trial: () =>
        `Debrief Pós-Date é do *Wingman* (R$29,90/mês).\n\nDigita *mensal* ou *anual* 👇`,
      wingman: () =>
        `Você já fez seu debrief do mês.\n\n` +
        `Renova no mês que vem, ou faz upgrade pro *Wingman Pro* (ilimitado) 🔥\n\n` +
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
async function canUseFeature(phone, plan, featureKey) {
  const feature = FEATURES[featureKey];
  if (!feature) return { allowed: true, reason: null, remaining: null, upsellMessage: null };

  const limits = feature[plan];
  if (!limits) return { allowed: true, reason: null, remaining: null, upsellMessage: null };

  const upsells = feature.upsell || {};

  // Limite diário
  if (limits.daily !== undefined) {
    if (limits.daily === 0) {
      return {
        allowed: false,
        reason: 'plan_blocked',
        remaining: 0,
        upsellMessage: upsells[plan]?.() || null,
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
        upsellMessage: upsells[plan]?.() || null,
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
        upsellMessage: upsells[plan]?.() || null,
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
        upsellMessage: upsells[plan]?.() || null,
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
  trial:       '🎉 Trial',
  free:        '🆓 Free',
  wingman:     '🌟 Wingman',
  wingman_pro: '🔥 Wingman Pro',
};

function getPlanLabel(plan) {
  return PLAN_LABELS[plan] || '🆓 Free';
}

module.exports = {
  FEATURES,
  canUseFeature,
  incrementFeatureUsage,
  getDailyUsage,
  getMonthlyUsage,
  getPlanLabel,
};
