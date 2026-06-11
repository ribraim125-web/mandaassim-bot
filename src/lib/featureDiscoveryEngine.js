/**
 * featureDiscoveryEngine.js — Feature Discovery Engine (revelação progressiva)
 *
 * Implementa Caminho B com revelação progressiva orquestrada por evento.
 * Hierarquia: F1 (grátis, imediato) → F2 → F3 → F4 (Pro) → F5 (Pro) → F6 (Pro).
 *
 * A/B test:
 *   'event'   — revelação event-driven (padrão, 45% dos usuários)
 *   'time'    — revelação time-driven: 24h/48h/72h/96h/120h (45%)
 *   'control' — zero revelação proativa, só menu manual (10%)
 *
 * Feature flag: PROGRESSIVE_DISCLOSURE_ENABLED=true (default false)
 */

const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Copy de revelação
// ---------------------------------------------------------------------------

const REVEAL_COPY = {
  // F2 — analisar conversa inteira (print longo)
  F2:
    `Tá feito.\n\n` +
    `Se a conversa for longa, pode mandar o print inteiro. Eu leio do começo e te falo o tom dela.`,

  // F3 — modo conversa (texto livre, sem print)
  F3:
    `Aliás: se quiser só me contar o que tá rolando, sem print, é só falar. ` +
    `Eu leio o contexto e te devolvo o que fazer. Sem papo de guru.`,

  // F4 — analisar perfil dela (Pro) — soft
  F4_SOFT:
    `Cara, dá pra ir mais fundo.\n\n` +
    `Se ela ainda não te respondeu, manda o print do perfil dela (foto e bio). ` +
    `Eu leio antes de tu mandar a primeira mensagem e te falo o que pegar.\n\n` +
    `Funciona melhor que advinhar. Isso é Pro: primeiros 3 dias liberados, sem cartão. Bora ativar?`,

  // F4 — analisar perfil dela (Pro) — hard (ativado quando ele pergunta "como começo")
  F4_HARD:
    `Tu me perguntou como começar.\n\n` +
    `Manda o print do perfil dela. Eu te dou 3 ganchos específicos da bio e da foto, ` +
    `e a primeira mensagem que mais costuma destravar.\n\n` +
    `É feature Pro: 3 dias de trial, sem cartão. Posso ativar?`,

  // F5 — auditar próprio perfil (Pro)
  F5:
    `Posso ser honesto?\n\n` +
    `Antes de tu mandar mais 20 mensagens, vale eu olhar teu perfil. ` +
    `Manda print do teu Tinder ou Bumble: fotos e bio. ` +
    `Em 1 minuto eu te mando os 3 ajustes que mais movem agulha. ` +
    `Só o que dá match.\n\n` +
    `Tá no trial Pro. Quer?`,

  // F6 — preparar encontro
  F6_PRE:
    `Encontro marcado é dado.\n\n` +
    `Quer que eu te prepare? Me conta onde vão e manda a conversa que rolou até aqui. ` +
    `Eu te dou 3 perguntas que destravam ela, 1 sinal pra ler ao vivo e 1 erro pra evitar.`,

  // F6 — debrief pós-encontro
  F6_POST:
    `Como foi?\n\n` +
    `Se quiser, me conta em 3 linhas o que rolou. ` +
    `Eu te dou debrief honesto: o que funcionou, o que deu ruim, o que mandar amanhã.`,

  // Nudge 10 min após welcome sem ação
  NUDGE_10MIN:
    `ainda tô aqui\n\npra começar é simples: manda o print de uma conversa que tiver rolando — ou descreve a situação em texto mesmo, funciona do mesmo jeito`,

  // Nudge trial dia 2
  TRIAL_DAY2:
    `Teu trial ilimitado fecha amanhã.\n\n` +
    `Aproveita hoje: manda o print de qualquer conversa que tiver rolando ` +
    `que eu te devolvo as 3 mensagens prontas.`,

  // Menu completo (sob demanda) — produto é um só: mensagens (Pro descontinuado)
  MENU:
    `O que eu faço:\n\n` +
    `1. *Responder mensagem dela* — manda o print, eu te devolvo 3 opções prontas\n` +
    `2. *Ler a conversa inteira* — manda print longo, eu leio o tom dela e o que fazer\n` +
    `3. *Conversa direta* — descreve a situação em texto que eu te ajudo na hora\n\n` +
    `Trial: 3 dias ilimitado. Depois, 5 análises grátis por dia.\n` +
    `*Parceiro* (R$29,90/mês): mensagens ilimitadas + análise de print → digita *mensal*`,
};

// ---------------------------------------------------------------------------
// Padrões de sinal emocional/intencional no texto do usuário
// ---------------------------------------------------------------------------

const SIGNAL_PATTERNS = {
  lowMatch: /sem match|ninguém responde|ninguem responde|deu unmatch|ela sumiu|ninguem curte|ninguém curte|sem curtida|nenhuma curtida|não consigo match|nao consigo match/i,
  firstMessage: /como (começo|inicio|inicio|abro|abordo|falo pela primeira|mando a primeira)|primeira mensagem|como (eu )?abordo|não sei (como|o que) falar|nao sei (como|o que) falar/i,
  dateSignal: /encontro|vou sair|vamos sair|marcamos|vai rolar|vamos (nos )?encontrar|saímos|saimos|vou (encontrar|ver) ela|rola (hoje|amanhã|amanha)/i,
};

// ---------------------------------------------------------------------------
// Helpers de banco
// ---------------------------------------------------------------------------

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

/**
 * Calcula variant A/B deterministicamente a partir do número de telefone.
 * Distribuição: 45% event, 45% time, 10% control.
 */
function computeVariant(phone) {
  const num = String(phone).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const r = num % 100;
  if (r < 45) return 'event';
  if (r < 90) return 'time';
  return 'control';
}

/**
 * Garante que a linha existe no banco para este telefone.
 * Idempotente — usa upsert com ignoreDuplicates.
 */
async function ensureState(phone) {
  if (!process.env.SUPABASE_URL) return null;
  const supabase = getSupabase();
  const variant = computeVariant(phone);
  await supabase
    .from('feature_discovery_state')
    .upsert({ phone, ab_variant: variant }, { onConflict: 'phone', ignoreDuplicates: true });
}

/**
 * Busca estado atual. Retorna null se não encontrar.
 */
async function getState(phone) {
  if (!process.env.SUPABASE_URL) return null;
  const supabase = getSupabase();
  const { data } = await supabase
    .from('feature_discovery_state')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  return data || null;
}

/**
 * Incrementa total_analyses e seta f1_used_at na primeira vez.
 */
async function incrementAnalyses(phone) {
  if (!process.env.SUPABASE_URL) return;
  const supabase = getSupabase();
  const { data: cur } = await supabase
    .from('feature_discovery_state')
    .select('total_analyses, f1_used_at')
    .eq('phone', phone)
    .maybeSingle();

  const now = new Date().toISOString();
  const updates = {
    total_analyses: (cur?.total_analyses || 0) + 1,
    updated_at: now,
  };
  if (!cur?.f1_used_at) {
    updates.f1_used_at = now;
    updates.f1_revealed_at = now; // F1 é revelada imediatamente (é o core)
  }

  await supabase
    .from('feature_discovery_state')
    .update(updates)
    .eq('phone', phone);
}

/**
 * Marca uma feature como revelada (mensagem enviada ao usuário).
 */
async function markRevealed(phone, featureId) {
  if (!process.env.SUPABASE_URL) return;
  const supabase = getSupabase();
  const col = `${featureId.toLowerCase()}_revealed_at`;
  await supabase
    .from('feature_discovery_state')
    .update({ [col]: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('phone', phone);
}

/**
 * Marca uma feature como usada de fato.
 */
async function markUsed(phone, featureId) {
  if (!process.env.SUPABASE_URL) return;
  const supabase = getSupabase();
  const col = `${featureId.toLowerCase()}_used_at`;
  await supabase
    .from('feature_discovery_state')
    .update({ [col]: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('phone', phone);
}

/**
 * Salva último evento registrado (debug).
 */
async function logEvent(phone, event) {
  if (!process.env.SUPABASE_URL) return;
  const supabase = getSupabase();
  await supabase
    .from('feature_discovery_state')
    .update({ last_event: event, updated_at: new Date().toISOString() })
    .eq('phone', phone);
}

// ---------------------------------------------------------------------------
// Motor de revelação
// ---------------------------------------------------------------------------

/**
 * Detecta sinais especiais no texto do usuário.
 * Retorna null | 'low_match_complaint' | 'first_message_question' | 'date_signal'
 */
function detectSignals(text) {
  if (!text || typeof text !== 'string') return null;
  if (SIGNAL_PATTERNS.dateSignal.test(text))    return 'date_signal';
  if (SIGNAL_PATTERNS.lowMatch.test(text))       return 'low_match_complaint';
  if (SIGNAL_PATTERNS.firstMessage.test(text))   return 'first_message_question';
  return null;
}

/**
 * Núcleo do motor: avalia qual feature deve ser revelada agora.
 *
 * @param {object} state — linha completa de feature_discovery_state
 * @param {string} eventType — evento que disparou (ex: 'analysis_completed')
 * @returns {{ feature: string, copy: string } | null}
 */
function computeReveal(state, eventType) {
  const variant = state.ab_variant || 'event';
  if (variant === 'control') return null;

  const total = state.total_analyses || 0;
  const revealed = (f) => !!state[`${f}_revealed_at`];

  const eligible = [];

  if (variant === 'event') {
    // F2 — após 1ª análise
    if (!revealed('f2') && total >= 1) {
      eligible.push({ feature: 'F2', copy: REVEAL_COPY.F2 });
    }
    // F3 — após 2ª análise OU texto livre
    if (!revealed('f3') && (total >= 2 || eventType === 'free_text_received')) {
      eligible.push({ feature: 'F3', copy: REVEAL_COPY.F3 });
    }
    // F4 — após 3ª análise OU pergunta de primeira mensagem
    if (!revealed('f4') && (total >= 3 || eventType === 'first_message_question')) {
      const copy = eventType === 'first_message_question' ? REVEAL_COPY.F4_HARD : REVEAL_COPY.F4_SOFT;
      eligible.push({ feature: 'F4', copy });
    }
    // F5 — após 5ª análise OU reclamação de match OU segunda sessão
    if (!revealed('f5') && (total >= 5 || eventType === 'low_match_complaint' || eventType === 'session_count_2')) {
      eligible.push({ feature: 'F5', copy: REVEAL_COPY.F5 });
    }
    // F6 — sinal de encontro detectado
    if (!revealed('f6') && eventType === 'date_signal') {
      eligible.push({ feature: 'F6', copy: REVEAL_COPY.F6_PRE });
    }

  } else if (variant === 'time') {
    // Time-driven: baseado em f1_used_at (primeira análise)
    const anchor = state.f1_used_at ? new Date(state.f1_used_at) : null;
    if (!anchor) return null;
    const h = (Date.now() - anchor.getTime()) / (1000 * 60 * 60);

    if (!revealed('f2') && h >= 24)  eligible.push({ feature: 'F2', copy: REVEAL_COPY.F2 });
    if (!revealed('f3') && h >= 48)  eligible.push({ feature: 'F3', copy: REVEAL_COPY.F3 });
    if (!revealed('f4') && h >= 72)  eligible.push({ feature: 'F4', copy: REVEAL_COPY.F4_SOFT });
    if (!revealed('f5') && h >= 96)  eligible.push({ feature: 'F5', copy: REVEAL_COPY.F5 });
    if (!revealed('f6') && h >= 120) eligible.push({ feature: 'F6', copy: REVEAL_COPY.F6_PRE });
  }

  // Máximo 1 revelação por turno — prioridade F2 > F3 > F4 > F5 > F6
  return eligible.length > 0 ? eligible[0] : null;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Chamado após cada análise bem-sucedida (texto ou print).
 * Incrementa contador, detecta sinais no texto e devolve revelação se houver.
 *
 * @param {string} phone
 * @param {string} [userText] — texto que o usuário enviou (para detecção de sinais)
 * @returns {Promise<{ feature: string, copy: string } | null>}
 */
async function onAnalysisCompleted(phone, userText = '') {
  if (process.env.PROGRESSIVE_DISCLOSURE_ENABLED !== 'true') return null;
  try {
    await ensureState(phone);
    await incrementAnalyses(phone);
    const state = await getState(phone);
    if (!state) return null;

    const signal = detectSignals(userText);
    const eventType = signal || 'analysis_completed';
    await logEvent(phone, eventType);

    const reveal = computeReveal(state, eventType);
    if (reveal) {
      await markRevealed(phone, reveal.feature);
    }
    return reveal;
  } catch (err) {
    console.error('[FDE] onAnalysisCompleted error:', err.message);
    return null;
  }
}

/**
 * Chamado quando o usuário manda texto livre sem ser análise.
 * Detecta sinais e devolve revelação se houver.
 *
 * @param {string} phone
 * @param {string} text — texto do usuário
 * @returns {Promise<{ feature: string, copy: string } | null>}
 */
async function onFreeTextReceived(phone, text) {
  if (process.env.PROGRESSIVE_DISCLOSURE_ENABLED !== 'true') return null;
  try {
    await ensureState(phone);
    const state = await getState(phone);
    if (!state) return null;

    const signal = detectSignals(text);
    const eventType = signal || 'free_text_received';
    await logEvent(phone, eventType);

    const reveal = computeReveal(state, eventType);
    if (reveal) {
      await markRevealed(phone, reveal.feature);
    }
    return reveal;
  } catch (err) {
    console.error('[FDE] onFreeTextReceived error:', err.message);
    return null;
  }
}

/**
 * Retorna copy do menu completo (sem sanitização — o caller passa por sanitizeOutput).
 */
function getMenuCopy() {
  return REVEAL_COPY.MENU;
}

/**
 * Retorna copy do nudge de inatividade (10 min sem ação).
 */
function getNudgeCopy() {
  return REVEAL_COPY.NUDGE_10MIN;
}

module.exports = {
  ensureState,
  onAnalysisCompleted,
  onFreeTextReceived,
  markUsed,
  getMenuCopy,
  getNudgeCopy,
  detectSignals,
  REVEAL_COPY,
};
