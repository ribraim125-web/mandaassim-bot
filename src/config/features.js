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

// Texto único para features desativadas (Pro descontinuado — foco no core de mensagens)
const FORA_DO_AR =
  `Esse recurso tá fora do ar por enquanto 🔧\n\n` +
  `Manda o print da *conversa* com ela (ou descreve a situação) que eu te devolvo as 3 mensagens prontas.`;

const FEATURES = {
  // Feature principal: mensagens de conquista
  messages: {
    trial:        { daily: null },   // ilimitado nos 3 dias
    free:         { daily: 5    },
    parceiro:     { daily: null },
    parceiro_pro: { daily: null },
    upsell: {
      free: (remaining) =>
        remaining === 0
          ? `Você usou suas 5 análises grátis de hoje 🔒\n\n` +
            `Acabou de descobrir que tem\n` +
            `um nível acima das respostas comuns\n\n` +
            `Por R$29,90/mês:\n` +
            `- Análises ilimitadas\n` +
            `- Acesso aos 5 tons\n` +
            `- Loop de upgrade liberado\n` +
            `- Suporte prioritário\n\n` +
            `Manda *quero assinar* que eu te envio o pix`
          : `_${5 - remaining}/5 análises usadas hoje._`,
    },
  },

  // Camada 1 — Análise de print de conversa
  print_analysis: {
    trial:        { daily: 3 },
    free:         { daily: 0 },     // bloqueado — upsell
    parceiro:     { daily: 15 },    // na prática ilimitado; teto anti-abuso
    parceiro_pro: { daily: 15 },
    upsell: {
      free: () =>
        `Análise de print é do *Parceiro* 🔍\n\n` +
        `Você manda o print da conversa, eu leio o que tá rolando — interesse dela, temperatura, o que faz sentido responder agora.\n\n` +
        `📅 *Mensal* — R$29,90/mês → digita *mensal*`,
      trial: () =>
        `Deu 3 análises de print por hoje — limite do trial.\n\nQuer mais? Digita *mensal* (R$29,90).`,
      parceiro: () =>
        `Deu 15 análises de print hoje — limite do plano. Amanhã cedo renova.\n\nEnquanto isso, descreve em texto o que ela mandou. Funciona igual.`,
      parceiro_pro: () =>
        `Deu 15 análises de print hoje — limite do plano. Amanhã cedo renova.`,
    },
  },

  // Camada 2 — Análise de perfil (Tinder/Bumble)
  profile_analysis: {
    trial:        { daily: 0 },     // bloqueado — upsell
    free:         { daily: 0 },
    parceiro:     { daily: 0 },     // bloqueado — exclusivo Pro
    parceiro_pro: { daily: 10 },
    upsell: {
      free: () => FORA_DO_AR,
      trial: () => FORA_DO_AR,
      parceiro: () => FORA_DO_AR,
      parceiro_pro: () =>
        `Deu 10 análises de perfil hoje — limite do plano. Amanhã cedo renova.`,
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
        `Tem um momento na conversa em que dá pra chamar pra sair — e tem um momento em que ainda não.\n\n` +
        `Eu leio onde a conversa tá e te falo quando e como chamar.\n\n` +
        `Tá no *Parceiro* (R$29,90/mês).\n\n` +
        `Digita *mensal* 👇`,
      trial: () =>
        `Saber quando e como chamar pra sair é do *Parceiro* (R$29,90/mês).\n\nDigita *mensal* 👇`,
      parceiro: () =>
        `Você já usou as 2 sessões desse recurso esse mês. Renova mês que vem.\n\n` +
        `Enquanto isso me conta a situação que eu te ajudo com as mensagens.`,
    },
  },

  // Camada 4 — Preparação pra encontro (Parceiro Pro exclusivo)
  predate_coach: {
    trial:        { monthly: 0 },
    free:         { monthly: 0 },
    parceiro:     { monthly: 0 },    // bloqueado — exclusivo Pro
    parceiro_pro: { monthly: null },
    upsell: {
      free: () => FORA_DO_AR,
      trial: () => FORA_DO_AR,
      parceiro: () => FORA_DO_AR,
    },
  },

  // Camada 5 — Auditar Meu Perfil (Vision — Parceiro Pro)
  profile_self_audit: {
    trial:        { daily: 0 },
    free:         { daily: 0 },
    parceiro:     { daily: 0 },
    parceiro_pro: { daily: 30 },
    upsell: {
      free: () => FORA_DO_AR,
      trial: () => FORA_DO_AR,
      parceiro: () => FORA_DO_AR,
      parceiro_pro: () =>
        `Deu 30 análises de perfil hoje — limite do plano. Amanhã cedo renova.`,
    },
  },

  // Camada 6 — Analisar Perfil Dela (Vision — Parceiro Pro)
  profile_her_analysis: {
    trial:        { daily: 0 },
    free:         { daily: 0 },
    parceiro:     { daily: 0 },
    parceiro_pro: { daily: 30 },
    upsell: {
      free: () => FORA_DO_AR,
      trial: () => FORA_DO_AR,
      parceiro: () => FORA_DO_AR,
      parceiro_pro: () =>
        `Deu 30 análises de perfil hoje — limite do plano. Amanhã cedo renova.`,
    },
  },

  // Camada 7 — Conversa sobre como foi o encontro (Parceiro Pro exclusivo)
  postdate_debrief: {
    trial:        { monthly: 0 },
    free:         { monthly: 0 },
    parceiro:     { monthly: 0 },    // bloqueado — exclusivo Pro
    parceiro_pro: { monthly: null },
    upsell: {
      free: () => FORA_DO_AR,
      trial: () => FORA_DO_AR,
      parceiro: () => FORA_DO_AR,
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
        upsellMessage: upsells[p]?.(0) || null,
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
