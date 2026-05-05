/**
 * postdateDebrief.js — Debrief Pós-Date: análise honesta do encontro
 *
 * Fluxo:
 * 1. Mini-entrevista de 6 perguntas (state machine em index.js)
 * 2. Haiku 4.5 analisa respostas com HONESTIDADE BRUTAL
 * 3. Formata em 4 mensagens: avaliação, sinais dela, performance dele, próximo passo
 * 4. Salva sessão no Supabase (fire-and-forget)
 * 5. Outcome alimenta loop de aprendizado da Camada 4 (Pré-Date)
 *
 * PRINCÍPIO: HONESTIDADE BRUTAL > BAJULAÇÃO
 * ANTI-PADRÕES PROIBIDOS:
 * - "Você merece alguém melhor"
 * - "Foque em você primeiro"
 * - "Talvez não fosse a pessoa certa"
 * - "Mulher é complicada mesmo"
 */

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { logApiRequest } = require('./tracking');

// ── Preços Haiku 4.5 ─────────────────────────────────────────────────────────
const PRICES = { input: 1.00, output: 5.00, cache_write: 1.25, cache_read: 0.10 };
const USD_TO_BRL = 5.75;

// ── As 7 perguntas da mini-entrevista ────────────────────────────────────────
const INTERVIEW_QUESTIONS_DEBRIEF = [
  `Como você se sentiu durante o encontro? De 0 a 10 — e me conta brevemente por quê.`,
  `Ela pareceu engajada? O que você notou — expressões, perguntas que ela fez, ou ausência delas?`,
  `Falaram de quê? Teve algum tema que esquentou o papo, ou algo que esfriou?`,
  `Aconteceu algum momento estranho — silêncio pesado, uma coisa que você disse, uma reação inesperada dela?`,
  `Como foi a despedida? Quem propôs o encerramento? Teve abraço, beijo, ou foi seco?`,
  `Ela falou em se ver de novo? Espontaneamente ou você quem perguntou?`,
  `Você mandou mensagem depois? Se sim, o que ela respondeu — e quando?`,
];

// ── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_DEBRIEF = `Você é o MandaAssim — wingman direto e honesto. Um usuário acabou de ter um encontro e precisa de análise honesta do que aconteceu.

PRINCÍPIO ABSOLUTO: HONESTIDADE BRUTAL > BAJULAÇÃO
Se o encontro foi mal, você diz que foi mal. Se ele cometeu erros, você os aponta claramente.
Elogiar quando não há o que elogiar é a pior coisa que você pode fazer — paralisa o crescimento.

ANTI-PADRÕES ABSOLUTAMENTE PROIBIDOS:
- "Você merece alguém melhor"
- "Foque em você primeiro"
- "Talvez não fosse a pessoa certa"
- "Mulher é complicada mesmo"
- "O importante é que você tentou"
- "Cada experiência é um aprendizado" (genérico e inútil)
- Qualquer frase de autoajuda que não resolve o problema concreto

O QUE VOCÊ FAZ EM VEZ DISSO:
- Nomeia o erro específico: "você falou demais sobre o ex" / "você chegou ansioso e ela sentiu"
- Diz o que estava faltando: "ela estava engajada mas você não criou tensão"
- Dá próximo passo concreto: "você tem 48h para mandar uma mensagem casual ou o momento passa"
- Reconhece quando foi genuinamente bem — sem exagero, sem cheerleader

COMO LER OS SINAIS ELA:
- Ela foi embora cedo → desinteresse ou compromisso real (diferença: ela pediu outra vez ou não)
- Ela foi distante mas educada → estava educada, não interessada
- Ela riu muito, fez perguntas, tocou no braço → alto interesse
- Ela olhou no celular várias vezes → baixo engajamento
- Ela falou da "próxima vez" espontaneamente → interesse real
- Mensagem seca depois → processou, não se sentiu arrastada
- Não respondeu depois → ou está ocupada ou achou ok mas não achou ótimo

AVALIAÇÃO DE QUALIDADE:
- "great": ela demonstrou interesse claro, clima ótimo, vontade de rever
- "good": encontro positivo, mas faltou algo — tensão, timing, clareza de próximos passos
- "neutral": educado mas sem química clara dos dois lados
- "poor": sinais evidentes de desinteresse, clima pesado ou vazio
- "unclear": muito cedo pra saber, dados insuficientes

PRÓXIMO PASSO — deve ser 1 ação específica:
- Se foi bem: "Manda mensagem hoje ou amanhã — curta e positiva"
- Se foi ok: "Espera 24h, aí manda algo que faça ela pensar em você — não 'oi, tudo bem'"
- Se foi mal: "Dá 3-4 dias. Se quiser tentar, volta com algo casual — não comenta o encontro"
- Se não sabe: "Você não tem informação suficiente. Uma mensagem simples em 24h resolve a dúvida"

Retorne APENAS JSON válido, sem markdown.

Schema:
{
  "encounter_quality_assessment": "great" | "good" | "neutral" | "poor" | "unclear",
  "quality_rationale": "string — 2-3 frases explicando a avaliação de forma direta",
  "her_interest_signals": ["string"] — sinais de interesse que ela demonstrou (lista pode ser vazia),
  "her_disinterest_signals": ["string"] — sinais de desinteresse ou distância (lista pode ser vazia),
  "user_performance_feedback": {
    "what_worked": ["string"] — o que ele fez bem (1-3 itens, concreto),
    "what_to_improve": ["string"] — o que ele deveria ter feito diferente (1-3 itens, concreto),
    "biggest_mistake": "string | null" — o erro mais relevante se houver, ou null
  },
  "next_step_recommendation": "string — 1 ação específica e concreta para as próximas 48h",
  "next_step_timing": "now" | "24h" | "48h-72h" | "wait",
  "message_suggestions": {
    "warm_followup": "string — mensagem calorosa de seguimento (1 linha, para usar se foi bem)",
    "playful_callback": "string — mensagem leve que referencia algo do encontro (1 linha)",
    "next_invite": "string | null — proposta para se ver de novo, se aplicável"
  },
  "lessons_for_next_time": ["string"] — 1-2 lições aplicáveis ao próximo encontro (específicas, não genéricas),
  "red_flags_observed": ["string"] — sinais de alerta sobre ela ou a situação (pode ser vazia),
  "honest_truth_if_needed": "string | null" — se há algo importante que ele precisa ouvir mas pode não querer, diz aqui. Se não, null. NUNCA autoajuda genérica."
}`;

// ── Clientes ──────────────────────────────────────────────────────────────────
let _anthropic = null;
function getAnthropicClient() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

function calcularCusto(usage) {
  const usd =
    ((usage?.input_tokens                || 0) / 1e6 * PRICES.input)       +
    ((usage?.output_tokens               || 0) / 1e6 * PRICES.output)      +
    ((usage?.cache_creation_input_tokens || 0) / 1e6 * PRICES.cache_write) +
    ((usage?.cache_read_input_tokens     || 0) / 1e6 * PRICES.cache_read);
  return { usd: parseFloat(usd.toFixed(6)), brl: parseFloat((usd * USD_TO_BRL).toFixed(4)) };
}

// ── Persistência ──────────────────────────────────────────────────────────────

async function salvarDebriefSessao(phone, answers, result) {
  try {
    const supabase = getSupabase();

    // Tenta linkar com a sessão pré-date mais recente (que teve debrief enviado)
    const { data: predateRow } = await supabase
      .from('predate_sessions')
      .select('id')
      .eq('phone', phone)
      .not('debrief_sent_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const outcomeSummary = result?.encounter_quality_assessment
      ? `${result.encounter_quality_assessment}: ${(result.quality_rationale || '').slice(0, 150)}`
      : null;

    const { data, error } = await supabase
      .from('postdate_sessions')
      .insert({
        phone,
        predate_session_id:  predateRow?.id || null,
        interview_answers:   answers,
        assessment_result:   result,
        outcome_summary:     outcomeSummary,
        encounter_quality:   result?.encounter_quality_assessment || null,
        next_step:           result?.next_step_recommendation || null,
        model_used:          'claude-haiku-4-5-20251001',
        created_at:          new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();

    if (error) console.error('[PostdateDebrief] Erro ao salvar sessão:', error.message);
    return data?.id || null;
  } catch (err) {
    console.error('[PostdateDebrief] Erro ao salvar sessão:', err.message);
    return null;
  }
}

/**
 * Verifica se há um pré-date com debrief_sent_at recente (< 48h) para o qual
 * ainda não foi feito um debrief. Usado para Trigger A (proativo).
 */
async function temDebriefPendente(phone) {
  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Pré-date com debrief_sent_at recente
    const { data: predateRow } = await supabase
      .from('predate_sessions')
      .select('id')
      .eq('phone', phone)
      .not('debrief_sent_at', 'is', null)
      .gte('debrief_sent_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!predateRow?.id) return false;

    // Verifica se já existe postdate para esse pré-date
    const { data: existingDebrief } = await supabase
      .from('postdate_sessions')
      .select('id')
      .eq('phone', phone)
      .eq('predate_session_id', predateRow.id)
      .limit(1)
      .maybeSingle();

    return !existingDebrief?.id;
  } catch (_) {
    return false;
  }
}

/**
 * Contagem mensal de debriefs.
 */
async function getMonthlyDebriefCount(phone) {
  try {
    const supabase = getSupabase();
    const startOfMonth = new Date();
    startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('postdate_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('phone', phone)
      .gte('created_at', startOfMonth.toISOString());
    return count || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Retorna insight do último debrief para alimentar o Pré-Date Coach (loop de aprendizado).
 * Retorna string ou null.
 */
async function getLastDebriefInsight(phone) {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('postdate_sessions')
      .select('assessment_result, encounter_quality, created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.assessment_result) return null;

    const r = data.assessment_result;
    const quality = r.encounter_quality_assessment || data.encounter_quality;
    const lessons = r.lessons_for_next_time || [];
    const mistakes = r.user_performance_feedback?.what_to_improve || [];

    if (!quality) return null;

    const lines = [`Último encontro dele (${new Date(data.created_at).toLocaleDateString('pt-BR')}): avaliação "${quality}".`];
    if (lessons.length > 0) lines.push(`Lições aprendidas: ${lessons.slice(0, 2).join('; ')}.`);
    if (mistakes.length > 0) lines.push(`O que melhorar: ${mistakes.slice(0, 2).join('; ')}.`);

    return lines.join(' ');
  } catch (_) {
    return null;
  }
}

// ── Formatação ────────────────────────────────────────────────────────────────

const QUALITY_LABEL = {
  great:   '✅ Encontro foi bem',
  good:    '👍 Encontro positivo — com ajustes',
  neutral: '😐 Encontro neutro',
  poor:    '❌ Encontro foi mal',
  unclear: '🔍 Ainda difícil saber',
};

/**
 * Formata o JSON do Haiku em 4 mensagens de WhatsApp.
 * @returns {string[]}
 */
function formatarRespostaDebrief(result) {
  const msgs = [];
  const quality = result.encounter_quality_assessment || 'unclear';
  const label   = QUALITY_LABEL[quality] || '📍 Análise do encontro';

  // ── Msg 1: Avaliação geral ────────────────────────────────────────────────
  let msg1 = `${label}\n\n`;
  msg1 += result.quality_rationale || '';
  if (result.honest_truth_if_needed) {
    msg1 += `\n\n⚠️ ${result.honest_truth_if_needed}`;
  }
  msgs.push(msg1.trim());

  // ── Msg 2: Sinais dela + performance dele ────────────────────────────────
  let msg2 = '';

  const interestSignals    = result.her_interest_signals    || [];
  const disinterestSignals = result.her_disinterest_signals || [];

  if (interestSignals.length > 0 || disinterestSignals.length > 0) {
    msg2 += `*Sinais dela:*\n`;
    interestSignals.forEach(s    => { msg2 += `✅ ${s}\n`; });
    disinterestSignals.forEach(s => { msg2 += `⚠️ ${s}\n`; });
    msg2 += '\n';
  }

  const perf = result.user_performance_feedback || {};
  const worked  = perf.what_worked    || [];
  const improve = perf.what_to_improve || [];
  const mistake = perf.biggest_mistake;

  if (worked.length > 0 || improve.length > 0) {
    if (worked.length > 0) {
      msg2 += `*O que foi bem:*\n`;
      worked.forEach(w => { msg2 += `• ${w}\n`; });
      msg2 += '\n';
    }
    if (improve.length > 0) {
      msg2 += `*O que ajustar:*\n`;
      improve.forEach(i => { msg2 += `• ${i}\n`; });
      if (mistake) msg2 += `\n🎯 *Principal erro:* ${mistake}`;
    }
  }

  if (msg2.trim()) msgs.push(msg2.trim());

  // ── Msg 3: Próximo passo + sugestões de mensagem ────────────────────────
  if (result.next_step_recommendation) {
    const timingMap = {
      now:        '⏰ *Agora*',
      '24h':      '⏰ *Nas próximas 24h*',
      '48h-72h':  '⏰ *Em 48-72h*',
      wait:       '⏰ *Espera por agora*',
    };
    const timing = timingMap[result.next_step_timing] || '⏰ *Próximo passo*';
    let msg3 = `${timing}\n\n${result.next_step_recommendation}`;

    msgs.push(msg3.trim());

    const sugestoes = result.message_suggestions;
    if (sugestoes) {
      const quality = result.encounter_quality_assessment || 'unclear';
      // Cada sugestão: label no próprio bloco, mensagem sozinha no próximo
      if (['great', 'good'].includes(quality) && sugestoes.warm_followup) {
        msgs.push(`Manda algo assim 👇`);
        msgs.push(sugestoes.warm_followup.trim());
        if (sugestoes.playful_callback) {
          msgs.push(`Ou com referência ao encontro:`);
          msgs.push(sugestoes.playful_callback.trim());
        }
      } else if (sugestoes.playful_callback && quality === 'neutral') {
        msgs.push(`Se quiser tentar algo:`);
        msgs.push(sugestoes.playful_callback.trim());
      }
      if (sugestoes.next_invite && ['great', 'good'].includes(quality)) {
        msgs.push(`Pra marcar de novo:`);
        msgs.push(sugestoes.next_invite.trim());
      }
    }
  }

  // ── Msg 4: Lições pra próxima vez ────────────────────────────────────────
  const lessons = result.lessons_for_next_time || [];
  if (lessons.length > 0) {
    let msg4 = `*Pro próximo encontro:*\n\n`;
    lessons.slice(0, 2).forEach(l => { msg4 += `→ ${l}\n`; });
    msgs.push(msg4.trim());
  }

  return msgs.filter(Boolean);
}

// ── Análise principal ─────────────────────────────────────────────────────────

/**
 * Analisa o debrief do encontro via Haiku 4.5.
 *
 * @param {object} answers — { 0: '...', 1: '...', ..., 5: '...' }
 * @param {string} phone
 * @returns {Promise<{ messages, result, metrics, sessionId }>}
 */
async function analisarDebriefComHaiku(answers, phone = '') {
  const anthropic = getAnthropicClient();
  const t0 = Date.now();

  const answerLines = INTERVIEW_QUESTIONS_DEBRIEF.map((q, i) => {
    const a = answers[i];
    return a ? `P: ${q}\nR: ${a}` : null;
  }).filter(Boolean).join('\n\n');

  const userContent =
    `Mini-entrevista de debrief pós-encontro:\n\n${answerLines}\n\n` +
    `Faça a análise honesta do encontro conforme o schema.`;

  let response;
  let trackingError = null;

  try {
    response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system: [{ type: 'text', text: SYSTEM_PROMPT_DEBRIEF, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    trackingError = err.message;
    logApiRequest({
      phone, intent: 'postdate_debrief',
      targetModel: 'claude-haiku-4-5-20251001', modelActuallyUsed: 'claude-haiku-4-5-20251001',
      tierAtRequest: 'full', latencyMs: Date.now() - t0, error: trackingError,
    });
    throw err;
  }

  const latencyMs        = Date.now() - t0;
  const usage            = response.usage;
  const inputTokens      = usage?.input_tokens                  || 0;
  const outputTokens     = usage?.output_tokens                 || 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens   || 0;
  const cacheReadTokens  = usage?.cache_read_input_tokens       || 0;
  const custo            = calcularCusto(usage);

  console.log(`[PostdateDebrief] Haiku 4.5 | in:${inputTokens} out:${outputTokens} | ${latencyMs}ms | $${custo.usd}`);

  logApiRequest({
    phone, intent: 'postdate_debrief',
    targetModel: 'claude-haiku-4-5-20251001', modelActuallyUsed: 'claude-haiku-4-5-20251001',
    tierAtRequest: 'full', inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    latencyMs, responseLengthChars: response.content[0]?.text?.length || 0,
  });

  const rawText = response.content[0]?.text || '';
  let result = null;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    result = JSON.parse(cleaned);
  } catch (_) { result = null; }

  const metrics = { latencyMs, costUsd: custo.usd, costBrl: custo.brl, inputTokens, outputTokens };

  if (!result) {
    return {
      messages: [
        `Não consegui processar. Tenta me contar de forma diferente — como foi o clima, o que ela disse e o que você fez.`,
      ],
      result: null, metrics, sessionId: null,
    };
  }

  const messages  = formatarRespostaDebrief(result);
  const sessionId = await salvarDebriefSessao(phone, answers, result);

  return { messages, result, metrics, sessionId };
}

module.exports = {
  INTERVIEW_QUESTIONS_DEBRIEF,
  analisarDebriefComHaiku,
  formatarRespostaDebrief,
  salvarDebriefSessao,
  temDebriefPendente,
  getMonthlyDebriefCount,
  getLastDebriefInsight,
};
