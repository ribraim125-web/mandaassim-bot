/**
 * transitionCoach.js — Coach de Transição: conversa → encontro presencial
 *
 * Fluxo:
 * 1. Mini-entrevista de 5 perguntas (gerenciada pelo state machine em index.js)
 * 2. Haiku 4.5 analisa respostas + contexto de print anterior (se houver)
 * 3. Retorna JSON com readiness, estratégia e 3 versões de mensagem
 * 4. Formata em 4 mensagens curtas de WhatsApp
 * 5. Salva sessão no Supabase (fire-and-forget)
 */

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { logApiRequest } = require('./tracking');

// ── Preços Haiku 4.5 ─────────────────────────────────────────────────────────
const PRICES = { input: 1.00, output: 5.00, cache_write: 1.25, cache_read: 0.10 };
const USD_TO_BRL = 5.75;

// ── As 5 perguntas da mini-entrevista ────────────────────────────────────────
const INTERVIEW_QUESTIONS = [
  `Você já tentou chamar ela pra sair antes, ou seria a primeira vez?`,
  `Há quantos dias vocês estão conversando?`,
  `Vocês já trocaram número de WhatsApp ou ainda tão no app?`,
  `Que tipo de encontro você imagina — café, drink, jantar ou uma atividade juntos?`,
  `Você sabe de alguma coisa específica que ela curte? Tipo hobby, lugar, comida — pode pular se não souber.`,
];

// ── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_TRANSITION = `Você é o MandaAssim — wingman direto, maduro, sem papo de guru de sedução.

Sua tarefa: avaliar se a situação está madura para chamar a mulher para um encontro presencial, e se sim, gerar a estratégia e a mensagem certa.

PRINCÍPIOS:
- Honestidade acima de tudo: se a situação indica "não agora", fala claramente
- Nenhuma técnica manipulativa, fake urgency ou jogo psicológico
- Tom de amigo experiente — estratégico, não ansioso
- Brasileiro, prático, direto
- Encontro informal é sempre melhor para um primeiro encontro: café, caminhada, drink rápido
- A melhor mensagem para chamar pra sair é específica, casual e sem pressão de "jantar romântico"

AVALIAÇÃO DE PRONTIDÃO:
- "ready": conversam há 5+ dias, ela está engajada (responde rápido, faz perguntas), já trocaram número ou estão no WhatsApp
- "wait_a_bit": conversa fluindo mas < 5 dias, ainda no app, ou clima ficou frio recentemente
- "not_yet": conversa seca, ela responde só quando ele manda, respostas curtas demais
- "red_flags": sinais claros de desinteresse, fantasma recente, ou ela está se afastando

FORMATO DAS MENSAGENS SUGERIDAS:
- Curtas, naturais, diretas — como uma mensagem de WhatsApp de verdade
- Nenhuma mensagem deve parecer script ou copiada
- Específica ao que ele disse sobre ela (hobby, interesse)
- Soft: mais leve, abre espaço ("bora tomar um café?")
- Balanced: direta mas sem pressão ("tenho um lugar legal aqui, bora na sexta?")
- Direct: assume que vai acontecer ("sábado à tarde eu passo onde você estiver")

Retorne APENAS JSON válido, sem markdown.

Schema:
{
  "readiness_assessment": "ready" | "wait_a_bit" | "not_yet" | "red_flags",
  "rationale": "...",
  "suggested_approach": "casual" | "semi_planned" | "structured",
  "suggested_format": "...",
  "suggested_location_type": "público_movimentado" | "semi_privado" | "atividade",
  "suggested_message_to_send": {
    "soft": "...",
    "balanced": "...",
    "direct": "..."
  },
  "timing_recommendation": "...",
  "follow_up_strategy": {
    "if_yes": "...",
    "if_stalling": "...",
    "if_no": "..."
  },
  "red_flags_to_watch": ["..."]
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
    ((usage?.input_tokens                 || 0) / 1e6 * PRICES.input)       +
    ((usage?.output_tokens                || 0) / 1e6 * PRICES.output)      +
    ((usage?.cache_creation_input_tokens  || 0) / 1e6 * PRICES.cache_write) +
    ((usage?.cache_read_input_tokens      || 0) / 1e6 * PRICES.cache_read);
  return { usd: parseFloat(usd.toFixed(6)), brl: parseFloat((usd * USD_TO_BRL).toFixed(4)) };
}

// ── Salvar sessão ─────────────────────────────────────────────────────────────

/**
 * Salva uma sessão do coach de transição e retorna o ID.
 * @returns {Promise<string|null>} session ID
 */
async function salvarSessao(phone, answers, result, printContext, modelUsed) {
  try {
    const supabase = getSupabase();
    const row = {
      phone,
      interview_answers:      answers,
      assessment_result:      result,
      print_analysis_context: printContext || null,
      readiness_assessment:   result?.readiness_assessment || null,
      model_used:             modelUsed,
      created_at:             new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('transition_coach_sessions')
      .insert(row)
      .select('id')
      .maybeSingle();
    if (error) console.error('[TransitionCoach] Erro ao salvar sessão:', error.message);
    return data?.id || null;
  } catch (err) {
    console.error('[TransitionCoach] Erro ao salvar sessão:', err.message);
    return null;
  }
}

/**
 * Marca o outcome de uma sessão (chamado quando o usuário responde ao follow-up de 7 dias).
 */
async function registrarOutcome(phone, outcome) {
  try {
    const supabase = getSupabase();
    // Encontra a sessão mais recente com outcome_requested_at mas sem outcome
    const { data } = await supabase
      .from('transition_coach_sessions')
      .select('id')
      .eq('phone', phone)
      .is('outcome', null)
      .not('outcome_requested_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.id) return false;

    await supabase
      .from('transition_coach_sessions')
      .update({ outcome, outcome_received_at: new Date().toISOString() })
      .eq('id', data.id);

    console.log(`[TransitionCoach] Outcome "${outcome}" registrado para ${phone}`);
    return true;
  } catch (err) {
    console.error('[TransitionCoach] Erro ao registrar outcome:', err.message);
    return false;
  }
}

/**
 * Verifica se o usuário tem uma sessão com outcome_requested_at recente (< 48h) sem resposta.
 */
async function temOutcomePendente(phone) {
  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('transition_coach_sessions')
      .select('id')
      .eq('phone', phone)
      .is('outcome', null)
      .not('outcome_requested_at', 'is', null)
      .gte('outcome_requested_at', cutoff)
      .limit(1)
      .maybeSingle();
    return !!data?.id;
  } catch (_) {
    return false;
  }
}

/**
 * Marca que o outcome foi solicitado (chamado quando o worker envia o follow-up).
 */
async function marcarOutcomeSolicitado(phone) {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('transition_coach_sessions')
      .select('id')
      .eq('phone', phone)
      .is('outcome', null)
      .is('outcome_requested_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.id) return;
    await supabase
      .from('transition_coach_sessions')
      .update({ outcome_requested_at: new Date().toISOString() })
      .eq('id', data.id);
  } catch (_) {}
}

// ── Contagem mensal ───────────────────────────────────────────────────────────

/**
 * Retorna quantas sessões o usuário usou no mês corrente.
 */
async function getMonthlySessionCount(phone) {
  try {
    const supabase = getSupabase();
    const startOfMonth = new Date();
    startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('transition_coach_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('phone', phone)
      .gte('created_at', startOfMonth.toISOString());
    return count || 0;
  } catch (_) {
    return 0;
  }
}

// ── Formatação das mensagens ──────────────────────────────────────────────────

const READINESS_EMOJI = {
  ready:       '✅',
  wait_a_bit:  '⏳',
  not_yet:     '🚧',
  red_flags:   '🚩',
};

const READINESS_LABEL = {
  ready:      'tá pronto pra chamar',
  wait_a_bit: 'quase — espera mais um pouco',
  not_yet:    'ainda não — aquece mais a conversa',
  red_flags:  'sinal de alerta — precisa mudar algo antes',
};

/**
 * Formata o JSON do Haiku em 4 mensagens de WhatsApp.
 * @returns {string[]}
 */
function formatarRespostaCoach(result) {
  const msgs = [];
  const emoji = READINESS_EMOJI[result.readiness_assessment] || '📍';
  const label = READINESS_LABEL[result.readiness_assessment] || '';

  // ── Msg 1: leitura de prontidão ──────────────────────────────────────────
  let msg1 = `${emoji} *${label.charAt(0).toUpperCase() + label.slice(1)}*\n\n`;
  msg1 += result.rationale || '';
  if (result.timing_recommendation) {
    msg1 += `\n\n⏰ ${result.timing_recommendation}`;
  }
  msgs.push(msg1.trim());

  // ── Msg 2: estratégia ────────────────────────────────────────────────────
  if (result.suggested_format || result.suggested_approach) {
    let msg2 = `*Estratégia:*\n\n`;
    if (result.suggested_format) {
      msg2 += `📍 ${result.suggested_format}\n`;
    }
    if (result.suggested_location_type) {
      const locLabel = {
        'público_movimentado': 'local público e movimentado (tira pressão de encontro íntimo)',
        'semi_privado': 'lugar mais reservado (boa se a conversa já esquentou)',
        'atividade': 'atividade juntos (reduz tensão, cria memória compartilhada)',
      }[result.suggested_location_type] || result.suggested_location_type;
      msg2 += `🏠 ${locLabel}\n`;
    }
    if (result.red_flags_to_watch?.length > 0) {
      msg2 += `\n⚠️ Fique de olho: ${result.red_flags_to_watch[0]}`;
    }
    msgs.push(msg2.trim());
  }

  // ── Msg 3: a mensagem pronta ─────────────────────────────────────────────
  const sugestao = result.suggested_message_to_send?.balanced;
  if (sugestao) {
    msgs.push(`Manda isso 👇\n\n"${sugestao}"`);
  }

  // ── Msg 4: contingência ──────────────────────────────────────────────────
  const fs = result.follow_up_strategy;
  if (fs && (fs.if_yes || fs.if_stalling || fs.if_no)) {
    let msg4 = `*E se...*\n`;
    if (fs.if_yes)       msg4 += `\n✅ *Ela topar:* ${fs.if_yes}`;
    if (fs.if_stalling)  msg4 += `\n⏳ *Ela enrolar:* ${fs.if_stalling}`;
    if (fs.if_no)        msg4 += `\n❌ *Ela negar:* ${fs.if_no}`;
    msgs.push(msg4.trim());
  }

  return msgs.filter(Boolean);
}

// ── Chamada ao Haiku ──────────────────────────────────────────────────────────

/**
 * Analisa a situação via Haiku 4.5 e retorna assessment estruturado.
 *
 * @param {object} answers — respostas das 5 perguntas { 0: '...', 1: '...', ... }
 * @param {object|null} printContext — structuredResult de uma print analysis recente
 * @param {string} phone
 * @returns {Promise<{ messages: string[], result: object, metrics: object, sessionId: string|null }>}
 */
async function analisarTransicaoComHaiku(answers, printContext, phone = '') {
  const anthropic = getAnthropicClient();
  const t0 = Date.now();

  // Monta o contexto em texto
  const answerLines = INTERVIEW_QUESTIONS.map((q, i) => {
    const a = answers[i];
    return a ? `P: ${q}\nR: ${a}` : null;
  }).filter(Boolean).join('\n\n');

  let contextExtra = '';
  if (printContext) {
    contextExtra = `\n\nCONTEXTO DA ÚLTIMA ANÁLISE DE PRINT (usa como referência adicional):\n` +
      `- Plataforma: ${printContext.platform_detected || 'desconhecida'}\n` +
      `- Temperatura da conversa: ${printContext.conversation_temperature || 'desconhecida'}\n` +
      `- Nível de interesse dela: ${printContext.match_interest_level || 'desconhecido'}\n` +
      (printContext.green_flags?.length ? `- Green flags: ${printContext.green_flags.join(', ')}\n` : '') +
      (printContext.red_flags?.length   ? `- Red flags: ${printContext.red_flags.join(', ')}\n` : '');
  }

  const userContent =
    `Mini-entrevista com o usuário:\n\n${answerLines}${contextExtra}\n\n` +
    `Com base nessas informações, avalie se ele está pronto para chamar ela pra sair, ` +
    `e gere a estratégia e as mensagens conforme o schema.`;

  let response;
  let trackingError = null;

  try {
    response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system: [{ type: 'text', text: SYSTEM_PROMPT_TRANSITION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    trackingError = err.message;
    logApiRequest({
      phone, intent: 'transition_coach', targetModel: 'claude-haiku-4-5-20251001',
      modelActuallyUsed: 'claude-haiku-4-5-20251001', tierAtRequest: 'full',
      latencyMs: Date.now() - t0, error: trackingError,
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

  console.log(`[TransitionCoach] Haiku 4.5 | in:${inputTokens} out:${outputTokens} | ${latencyMs}ms | $${custo.usd}`);

  logApiRequest({
    phone, intent: 'transition_coach',
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

  const metrics = {
    latencyMs, costUsd: custo.usd, costBrl: custo.brl, inputTokens, outputTokens,
  };

  if (!result) {
    return {
      messages: [
        `Não consegui fazer a análise completa 😅\n\nTenta me contar a situação de forma diferente — o que você sabe sobre ela e há quanto tempo vocês conversam.`,
      ],
      result: null, metrics, sessionId: null,
    };
  }

  const messages = formatarRespostaCoach(result);
  const sessionId = await salvarSessao(phone, answers, result, printContext, 'claude-haiku-4-5-20251001');

  return { messages, result, metrics, sessionId };
}

/**
 * Classifica o outcome da sessão via Gemini Flash Lite (cheap).
 * Retorna uma das strings de outcome ou null.
 */
async function classificarOutcome(text) {
  const OpenAI = require('openai');
  try {
    const openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    const resp = await openrouter.chat.completions.create({
      model: 'google/gemini-2.0-flash-lite-001',
      max_tokens: 10,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `Classifique a seguinte mensagem de um usuário respondendo como foi sua tentativa de marcar encontro:\n\n"${text.slice(0, 300)}"\n\nResponda APENAS com uma das opções:\naccepted_and_happened\naccepted_but_postponed\naccepted_but_canceled\nrejected\nnever_responded\nuser_didnt_send`,
      }],
    });
    const raw = (resp.choices[0]?.message?.content || '').trim().toLowerCase().replace(/\s+/g, '_');
    const valid = ['accepted_and_happened','accepted_but_postponed','accepted_but_canceled','rejected','never_responded','user_didnt_send'];
    return valid.find(v => raw.includes(v)) || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  INTERVIEW_QUESTIONS,
  analisarTransicaoComHaiku,
  formatarRespostaCoach,
  salvarSessao,
  registrarOutcome,
  temOutcomePendente,
  marcarOutcomeSolicitado,
  getMonthlySessionCount,
  classificarOutcome,
};
