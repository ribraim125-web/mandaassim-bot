/**
 * printAnalysis.js — análise de prints de conversa via Haiku 4.5 vision
 *
 * Fluxo:
 * 1. Recebe base64 da imagem + mimeType
 * 2. Chama Haiku 4.5 com system prompt estruturado (JSON output)
 * 3. Parseia o JSON, formata 2-3 mensagens humanas em PT-BR
 * 4. Salva resultado na tabela print_analyses (fire-and-forget, sem a imagem)
 * 5. Retorna { messages: string[], structuredResult: object, metrics: object }
 */

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { logApiRequest } = require('./tracking');

// ── Preços Haiku 4.5 ──────────────────────────────────────────────────────────
const PRICES = {
  input:        1.00,   // USD/1M tokens
  output:       5.00,   // USD/1M tokens
  cache_write:  1.25,
  cache_read:   0.10,
};
const USD_TO_BRL = 5.75;

// ── Tamanho máximo da imagem (5MB em bytes — limite Anthropic) ────────────────
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ── System prompt alinhado com o tom da Fase 1 (reposicionamento) ─────────────
const SYSTEM_PROMPT_PRINT = `Você é o MandaAssim — um wingman direto e maduro, sem papo de coach e sem julgamento.

Sua tarefa: analisar o print de uma conversa (WhatsApp, Tinder, Bumble ou Instagram DM) e retornar uma análise em JSON.

PRINCÍPIOS DO TOM:
- Nunca julgue o usuário negativamente — sempre construa, sempre oriente pra frente
- Se ele cometeu um erro, aponte o aprendizado, não o erro
- Se ela tá ghostando há tempo, seja honesto com cuidado — sem falsa esperança, sem drama
- Tom de amigo experiente que já viu tudo e fala a verdade com respeito
- Foco no que FAZER agora, não em análise psicológica longa

REGRAS:
- Retorne APENAS JSON válido, sem markdown, sem texto fora do JSON
- Se não identificar mensagens, retorne messages_extracted: []
- match_interest_level: "low" | "medium" | "high" | "very_high"
- conversation_temperature: "cold" | "warm" | "hot" | "unknown"
- Se a conversa estiver claramente morta (ghosting > 7 dias, respostas secas repetidas), seja honesto
- suggested_next_message: escolha UMA abordagem equilibrada para 'balanced' — nem demasiado ansioso, nem frio demais

Schema obrigatório:
{
  "platform_detected": "whatsapp" | "tinder" | "bumble" | "instagram" | "unknown",
  "messages_extracted": [
    { "sender": "user" | "match", "text": "...", "timestamp": "..." }
  ],
  "match_interest_level": "low" | "medium" | "high" | "very_high",
  "conversation_temperature": "cold" | "warm" | "hot" | "unknown",
  "red_flags": ["..."],
  "green_flags": ["..."],
  "user_mistakes_detected": ["..."],
  "situation_summary": "...",
  "suggested_next_message": {
    "safe": "...",
    "balanced": "...",
    "bold": "..."
  },
  "rationale": "..."
}`;

// ── Cliente Anthropic ─────────────────────────────────────────────────────────
let _anthropic = null;
function getAnthropicClient() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

/**
 * Calcula custo em USD/BRL com base nos tokens usados.
 */
function calcularCusto(usage) {
  const input       = (usage?.input_tokens || 0);
  const output      = (usage?.output_tokens || 0);
  const cacheWrite  = (usage?.cache_creation_input_tokens || 0);
  const cacheRead   = (usage?.cache_read_input_tokens || 0);
  const usd = (input / 1e6 * PRICES.input) +
              (output / 1e6 * PRICES.output) +
              (cacheWrite / 1e6 * PRICES.cache_write) +
              (cacheRead / 1e6 * PRICES.cache_read);
  return {
    usd: parseFloat(usd.toFixed(6)),
    brl: parseFloat((usd * USD_TO_BRL).toFixed(4)),
  };
}

/**
 * Salva análise estruturada no Supabase.
 * Fire-and-forget — nunca lança exceção.
 * NÃO salva a imagem.
 */
function salvarPrintAnalysis(phone, result) {
  const supabase = getSupabase();
  const row = {
    phone,
    platform_detected:        result.platform_detected || 'unknown',
    messages_count:           (result.messages_extracted || []).length,
    match_interest_level:     result.match_interest_level || null,
    conversation_temperature: result.conversation_temperature || null,
    red_flags_count:          (result.red_flags || []).length,
    green_flags_count:        (result.green_flags || []).length,
    mistakes_count:           (result.user_mistakes_detected || []).length,
    has_suggested_messages:   !!(result.suggested_next_message?.balanced),
    raw_json:                 result,
    created_at:               new Date().toISOString(),
  };
  supabase.from('print_analyses').insert(row).then(({ error }) => {
    if (error) console.error('[PrintAnalysis] Erro ao salvar:', error.message);
  }).catch(() => {});
}

/**
 * Formata o JSON estruturado em 2-3 mensagens de WhatsApp.
 *
 * Msg 1: leitura da situação (temperatura + diagnóstico)
 * Msg 2: sugestão de próxima mensagem (balanced)
 * Msg 3 (opcional): pergunta se quer alternativa
 *
 * @param {object} result — JSON parseado do Haiku
 * @returns {string[]}
 */
function formatarRespostaPrint(result) {
  const msgs = [];

  // ── Msg 1: Leitura da situação ───────────────────────────────────────────
  const tempEmoji = {
    cold:    '🧊',
    warm:    '🌡️',
    hot:     '🔥',
    unknown: '📍',
  }[result.conversation_temperature] || '📍';

  const interestLabel = {
    low:       'interesse baixo',
    medium:    'interesse médio',
    high:      'interesse alto',
    very_high: 'muito interesse',
  }[result.match_interest_level] || 'sinal indefinido';

  const situacao = result.situation_summary
    ? result.situation_summary
    : `${interestLabel} — conversa ${result.conversation_temperature || 'sem leitura clara'}`;

  let msg1 = `${tempEmoji} _${situacao}_`;

  // Adiciona leitura de red flags ou green flags relevantes
  const redFlags = result.red_flags || [];
  const greenFlags = result.green_flags || [];
  const mistakes = result.user_mistakes_detected || [];

  if (mistakes.length > 0) {
    // Aponta o aprendizado, não o erro
    msg1 += `\n\n💡 ${mistakes[0].replace(/^erro:/i, 'próxima vez:').replace(/^você /i, 'daqui pra frente: ')}`;
  } else if (greenFlags.length > 0) {
    msg1 += `\n\n✅ ${greenFlags[0]}`;
  } else if (redFlags.length > 0) {
    msg1 += `\n\n⚠️ ${redFlags[0]}`;
  }

  if (result.rationale) {
    msg1 += `\n\n${result.rationale}`;
  }

  msgs.push(msg1);

  // ── Msg 2: Sugestão (balanced como padrão) ───────────────────────────────
  const sugestao = result.suggested_next_message?.balanced;
  if (sugestao) {
    msgs.push(`Manda isso 👇`);
    msgs.push(sugestao.trim());
  }

  // ── Msg 3 (opcional): oferta de alternativas se a conversa tiver leitura clara ──
  const temAlternativas =
    result.suggested_next_message?.safe &&
    result.suggested_next_message?.bold &&
    result.conversation_temperature !== 'unknown';

  if (temAlternativas) {
    msgs.push(`Quer uma _mais segura_ ou uma _mais ousada_? Só falar 😏`);
  }

  // ── Msg extra (Forma B): sugestão proativa quando conversa está hot ──────
  const isHot = result.conversation_temperature === 'hot';
  const isHighInterest = result.match_interest_level === 'high' || result.match_interest_level === 'very_high';
  if (isHot && isHighInterest) {
    msgs.push(
      `Pela temperatura da conversa, tá maduro pra você chamar pra sair. Quer ajuda com isso? Digita *como marco encontro* 👇`
    );
  }

  return msgs;
}

/**
 * Analisa um print de conversa via Haiku 4.5 vision.
 *
 * @param {string} base64Data — imagem em base64 (sem prefixo data:)
 * @param {string} mimeType — ex: 'image/jpeg'
 * @param {string} phone — número do usuário (para tracking)
 * @returns {Promise<{
 *   messages: string[],
 *   structuredResult: object,
 *   metrics: { latencyMs, costUsd, costBrl, inputTokens, outputTokens }
 * }>}
 */
async function analisarPrintConversaComHaiku(base64Data, mimeType, phone = '') {
  // Valida tamanho — base64 tem overhead de ~33%
  const estimatedBytes = base64Data.length * 0.75;
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error(`Imagem muito grande (${Math.round(estimatedBytes / 1024 / 1024)}MB). Máximo 5MB.`);
  }

  const anthropic = getAnthropicClient();
  const t0 = Date.now();
  let response;
  let trackingError = null;

  try {
    response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT_PRINT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type:       'base64',
                media_type: mimeType,
                data:       base64Data,
              },
            },
            {
              type: 'text',
              text: 'Analise este print de conversa e retorne o JSON conforme o schema. Se não conseguir ler a conversa claramente, retorne messages_extracted: [] e conversation_temperature: "unknown".',
            },
          ],
        },
      ],
    });
  } catch (err) {
    trackingError = err.message;
    logApiRequest({
      phone,
      intent:             'print_analysis',
      targetModel:        'claude-haiku-4-5-20251001',
      modelActuallyUsed:  'claude-haiku-4-5-20251001',
      tierAtRequest:      'full',
      latencyMs:          Date.now() - t0,
      error:              trackingError,
    });
    throw err;
  }

  const latencyMs       = Date.now() - t0;
  const usage           = response.usage;
  const inputTokens     = usage?.input_tokens                  || 0;
  const outputTokens    = usage?.output_tokens                 || 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens  || 0;
  const cacheReadTokens  = usage?.cache_read_input_tokens      || 0;
  const custo           = calcularCusto(usage);

  console.log(`[PrintAnalysis] Haiku 4.5 | in:${inputTokens} out:${outputTokens} cache_write:${cacheWriteTokens} cache_read:${cacheReadTokens} | ${latencyMs}ms | $${custo.usd}`);

  // Parse do JSON
  const rawText = response.content[0]?.text || '';
  let structuredResult;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    structuredResult = JSON.parse(cleaned);
  } catch (_) {
    structuredResult = null;
  }

  // Tracking
  logApiRequest({
    phone,
    intent:             'print_analysis',
    targetModel:        'claude-haiku-4-5-20251001',
    modelActuallyUsed:  'claude-haiku-4-5-20251001',
    tierAtRequest:      'full',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    latencyMs,
    responseLengthChars: rawText.length,
  });

  // Salva análise no Supabase (sem a imagem)
  if (structuredResult && !structuredResult.parse_error) {
    salvarPrintAnalysis(phone, structuredResult);
  }

  const metrics = {
    latencyMs,
    costUsd: custo.usd,
    costBrl: custo.brl,
    inputTokens,
    outputTokens,
  };

  if (!structuredResult) {
    // Fallback: imagem ilegível
    return {
      messages: [
        `Hmm, não consegui ler bem essa imagem. Tenta um print mais nítido da conversa, mostrando as últimas 5-10 mensagens.\n\nPode ser do Tinder, WhatsApp, Bumble, Instagram — qualquer um.`,
      ],
      structuredResult: null,
      metrics,
    };
  }

  const messages = formatarRespostaPrint(structuredResult);

  // Fallback se mensagens vazias (JSON parseou mas não tem conteúdo útil)
  if (messages.length === 0) {
    return {
      messages: [
        `Hmm, não consegui ler bem essa imagem. Tenta um print mais nítido da conversa, mostrando as últimas 5-10 mensagens.\n\nPode ser do Tinder, WhatsApp, Bumble, Instagram — qualquer um.`,
      ],
      structuredResult,
      metrics,
    };
  }

  return { messages, structuredResult, metrics };
}

module.exports = {
  analisarPrintConversaComHaiku,
  formatarRespostaPrint,
  SYSTEM_PROMPT_PRINT,
  MAX_IMAGE_BYTES,
};
