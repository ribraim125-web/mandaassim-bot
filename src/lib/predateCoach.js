/**
 * predateCoach.js — Coach Pré-Date: preparação para o encontro
 *
 * Fluxo:
 * 1. Mini-entrevista de 4 perguntas (state machine em index.js)
 * 2. Haiku 4.5 analisa respostas + perfil dela (se houver)
 * 3. Formata em 4 mensagens: checklist, conversa, pós-encontro, incentivo
 * 4. Tenta parsear data do encontro → agenda 3 lembretes
 * 5. Salva sessão no Supabase (fire-and-forget)
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
const { logApiRequest } = require('./tracking');

// ── Preços Haiku 4.5 ─────────────────────────────────────────────────────────
const PRICES = { input: 1.00, output: 5.00, cache_write: 1.25, cache_read: 0.10 };
const USD_TO_BRL = 5.75;

// ── As 4 perguntas da mini-entrevista ────────────────────────────────────────
const INTERVIEW_QUESTIONS_PREDATE = [
  `Quando é o encontro? (ex: "amanhã às 19h", "sábado às 15h", "sexta à noite")`,
  `Onde vai ser? (tipo de lugar — café, bar, restaurante, parque, atividade)`,
  `É a primeira vez que vocês se encontram pessoalmente?`,
  `Tem alguma coisa específica te preocupando?`,
];

// ── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_PREDATE = `Você é o MandaAssim — wingman direto e maduro. Um usuário marcou um encontro e precisa de orientação prática pra se preparar.

PRINCÍPIOS:
- Prático e direto — como amigo experiente que já foi por esse caminho, não terapeuta
- PROIBIDO: "respira fundo", "conecta com seu eu interior", "trabalhe sua autoestima"
- Reconhece que voltar ao mercado depois de divórcio/longa relação é um feito real
- Não pressiona pra ser perfeito — só presente
- Tópicos de conversa SEMPRE específicos ao que ele sabe sobre ela — NUNCA genérico
- Se ele mencionou filhos/divórcio: orienta a mencionar apenas 1x se ela perguntar, nunca antes

REGRAS DE RECOMENDAÇÃO:
- Roupa casual-arrumada é o padrão para primeiro encontro. Para jantar/restaurante elegante: levemente mais formal.
  Para café/bar casual: calça escura + camisa limpa + tênis limpo. NUNCA social demais.
- Chegada: 5 min antes — não 30 min (parece ansioso)
- Bebida: máximo 2 doses ou 2 cervejas — encontro não é hora de soltar a fera
- Duração: 1h30 a 2h. Encerra EM ALTA quando o papo ainda tá bom, não espera esgotar
- Pós-encontro: mensagem em 1-3h, curta e positiva. NUNCA carta longa, NUNCA insiste se não responde em 24h
- encouragement: 2-4 linhas máximo. Honesto, direto, como amigo. Pode mencionar que voltar ao mercado é coragem.

Retorne APENAS JSON válido, sem markdown.

Schema:
{
  "date_summary": "string — resumo humano da data/hora (ex: 'amanhã, sábado às 19h')",
  "location_type": "café" | "restaurante" | "bar" | "atividade" | "desconhecido",
  "location_summary": "string — descrição do local mencionado",
  "is_first_date": boolean,
  "main_concern": "string — preocupação dele reformulada de forma útil (se não tiver: 'nenhuma específica')",
  "outfit_recommendation": "string — roupa específica pro local/horário",
  "conversation_topics": ["string", "string", "string"],
  "topics_to_avoid": ["string"],
  "drink_limit_note": "string",
  "timing_advice": "string — sobre chegada",
  "duration_advice": "string — sobre duração e como encerrar em alta",
  "post_date_message_suggestion": "string — mensagem real pra mandar depois, 1 linha",
  "encouragement": "string — 2-4 linhas, tom de amigo, honesto",
  "day_before_tip": "string — dica curta pro dia anterior (roupa + confirmar local)"
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

// ── Parse de data ─────────────────────────────────────────────────────────────

/**
 * Tenta extrair a data/hora do encontro a partir de texto em linguagem natural.
 * Usa Gemini Flash Lite (barato). Retorna Date ou null.
 */
async function parsearDataEncontro(texto) {
  if (!texto || texto.length < 3) return null;
  const agora = new Date();
  const hojeStr = agora.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });
  try {
    const openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    const resp = await openrouter.chat.completions.create({
      model: 'google/gemini-2.0-flash-lite-001',
      max_tokens: 30,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `Hoje é ${hojeStr} no fuso de Brasília.\nO usuário disse: "${texto.slice(0, 200)}"\n\nQual é a data e hora do encontro? Responda APENAS com formato ISO 8601 sem fuso horário (ex: 2024-03-15T19:00:00). Se não for possível determinar, responda apenas: desconhecida`,
      }],
    });
    const raw = (resp.choices[0]?.message?.content || '').trim();
    if (!raw || raw.toLowerCase().includes('desconhec')) return null;
    // Extrai padrão ISO da resposta (pode ter texto extra)
    const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/);
    if (!isoMatch) return null;
    const d = new Date(isoMatch[0]);
    if (isNaN(d.getTime())) return null;
    // Só aceita datas no futuro (até 60 dias)
    const diffDays = (d.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0 || diffDays > 60) return null;
    return d;
  } catch (_) {
    return null;
  }
}

// ── Persistência ──────────────────────────────────────────────────────────────

/**
 * Salva sessão pré-date no Supabase. Retorna o ID.
 */
async function salvarPreDateSessao(phone, answers, result, dateParsed) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('predate_sessions')
      .insert({
        phone,
        interview_answers:  answers,
        assessment_result:  result,
        date_parsed:        dateParsed ? dateParsed.toISOString() : null,
        location_summary:   result?.location_summary || null,
        location_type:      result?.location_type    || null,
        is_first_date:      result?.is_first_date    ?? null,
        model_used:         'claude-haiku-4-5-20251001',
        created_at:         new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();
    if (error) console.error('[PreDateCoach] Erro ao salvar sessão:', error.message);
    return data?.id || null;
  } catch (err) {
    console.error('[PreDateCoach] Erro ao salvar sessão:', err.message);
    return null;
  }
}

/**
 * Quantas sessões pré-date no mês corrente.
 */
async function getMonthlyPreDateCount(phone) {
  try {
    const supabase = getSupabase();
    const startOfMonth = new Date();
    startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('predate_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('phone', phone)
      .gte('created_at', startOfMonth.toISOString());
    return count || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Marca debrief como enviado na sessão mais recente (chamado pelo followupWorker).
 */
async function atualizarDebriefEnviado(phone) {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('predate_sessions')
      .select('id')
      .eq('phone', phone)
      .is('debrief_sent_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.id) return;
    await supabase
      .from('predate_sessions')
      .update({ debrief_sent_at: new Date().toISOString() })
      .eq('id', data.id);
  } catch (_) {}
}

// ── Formatação ────────────────────────────────────────────────────────────────

/**
 * Formata o JSON do Haiku em 4 mensagens de WhatsApp.
 * @returns {string[]}
 */
function formatarRespostaPreDate(result) {
  const msgs = [];
  const isFirst = result.is_first_date !== false; // default true se não informado

  // ── Msg 1: Checklist do dia ───────────────────────────────────────────────
  const header = result.date_summary
    ? `🗓️ *Encontro — ${result.date_summary}*`
    : `🗓️ *Preparo para o encontro*`;

  let msg1 = `${header}\n\n`;
  msg1 += `*Antes de sair:*\n`;
  msg1 += `✅ ${result.outfit_recommendation || 'Roupa casual-arrumada — calça escura + camisa limpa'}\n`;
  msg1 += `✅ Barba aparada, perfume sutil — não exagera\n`;
  msg1 += `✅ Levar cartão/dinheiro — sem vexame\n`;
  msg1 += `✅ Confirma o local no Maps antes de sair\n`;
  msg1 += `✅ Sai com 15 min de folga\n\n`;
  msg1 += `*Na chegada:*\n`;
  msg1 += `✅ ${result.timing_advice || 'Chega 5 min antes — não 30 min'}\n`;
  msg1 += `✅ Guarda o celular quando ela chegar\n`;
  if (isFirst) {
    msg1 += `✅ Quando ela chegar: levanta, sorriso natural, abraço leve se o clima pedir`;
  } else {
    msg1 += `✅ Vocês já se conhecem — vai ser mais fácil que o primeiro`;
  }
  msgs.push(msg1.trim());

  // ── Msg 2: Conversa + bebida + duração ────────────────────────────────��──
  const topics = (result.conversation_topics || []).slice(0, 4);
  const avoid  = result.topics_to_avoid || [
    'Ex (a sua e a dela)',
    'Reclamação de trabalho',
    'Política',
    'Falar mal de outras mulheres',
  ];

  let msg2 = `*Puxar esses tópicos:*\n`;
  topics.forEach(t => { msg2 += `• ${t}\n`; });
  msg2 += `\n*Evitar:*\n`;
  avoid.forEach(t => { msg2 += `• ${t}\n`; });
  msg2 += `\n`;
  msg2 += `*Bebida:* ${result.drink_limit_note || 'máximo 2 — encontro não é hora de soltar a fera'}\n`;
  msg2 += `\n*Duração:* ${result.duration_advice || '1h30 a 2h — encerra em alta, não quando o papo esgota'}`;
  msgs.push(msg2.trim());

  // ── Msg 3: Depois do encontro ─────────────────────────────────────────────
  const postMsg = result.post_date_message_suggestion || `curti muito, bora repetir?`;
  let msg3 = `*Depois do encontro:*\n\n`;
  msg3 += `Manda em 1-3h 👇\n\n`;
  msg3 += `"${postMsg}"\n\n`;
  msg3 += `NÃO manda carta longa\n`;
  msg3 += `NÃO insiste se ela não responder em 24h`;
  msgs.push(msg3.trim());

  // ── Msg 4: Incentivo personalizado ───────────────────────────────────────
  if (result.encouragement) {
    msgs.push(result.encouragement);
  }

  return msgs.filter(Boolean);
}

// ── Análise principal ─────────────────────────────────────────────────────────

/**
 * Analisa via Haiku 4.5 e retorna plano de preparação + data parseada.
 *
 * @param {object} answers — { 0: '...', 1: '...', 2: '...', 3: '...' }
 * @param {string} girlContext — contexto da menina (de buildGirlContext)
 * @param {string} phone
 * @returns {Promise<{ messages, result, metrics, sessionId, dateParsed }>}
 */
async function analisarPreDateComHaiku(answers, girlContext = '', phone = '') {
  const anthropic = getAnthropicClient();
  const t0 = Date.now();

  const answerLines = INTERVIEW_QUESTIONS_PREDATE.map((q, i) => {
    const a = answers[i];
    return a ? `P: ${q}\nR: ${a}` : null;
  }).filter(Boolean).join('\n\n');

  const contextExtra = girlContext
    ? `\n\nPERFIL DELA (usa para personalizar tópicos de conversa):\n${girlContext}`
    : '';

  const userContent =
    `Mini-entrevista de preparação para encontro:\n\n${answerLines}${contextExtra}\n\n` +
    `Gere o plano de preparação completo conforme o schema.`;

  let response;
  let trackingError = null;

  try {
    response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 900,
      system: [{ type: 'text', text: SYSTEM_PROMPT_PREDATE, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    trackingError = err.message;
    logApiRequest({
      phone, intent: 'predate_coach',
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

  console.log(`[PreDateCoach] Haiku 4.5 | in:${inputTokens} out:${outputTokens} | ${latencyMs}ms | $${custo.usd}`);

  logApiRequest({
    phone, intent: 'predate_coach',
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
        `Não consegui fazer a análise completa 😅\n\nTenta de novo — me fala quando é, onde vai ser, e se é a primeira vez que vocês se encontram.`,
      ],
      result: null, metrics, sessionId: null, dateParsed: null,
    };
  }

  const messages = formatarRespostaPreDate(result);

  // Parse da data para agendamento de lembretes (faz em paralelo com o save)
  const [dateParsed, sessionId] = await Promise.all([
    parsearDataEncontro(answers[0] || ''),
    salvarPreDateSessao(phone, answers, result, null), // salva sem data por ora
  ]);

  // Atualiza sessão com a data parseada se conseguiu
  if (dateParsed && sessionId) {
    getSupabase()
      .from('predate_sessions')
      .update({ date_parsed: dateParsed.toISOString() })
      .eq('id', sessionId)
      .then(({ error }) => { if (error) console.error('[PreDateCoach] Erro ao atualizar data:', error.message); })
      .catch(() => {});
  }

  return { messages, result, metrics, sessionId, dateParsed };
}

module.exports = {
  INTERVIEW_QUESTIONS_PREDATE,
  analisarPreDateComHaiku,
  formatarRespostaPreDate,
  parsearDataEncontro,
  salvarPreDateSessao,
  getMonthlyPreDateCount,
  atualizarDebriefEnviado,
};
