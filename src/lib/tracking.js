/**
 * tracking.js — logging de chamadas de IA para a tabela api_requests
 *
 * Regras de uso:
 * - logApiRequest() NUNCA lança exceção — falha silenciosamente
 * - insert assíncrono (fire-and-forget), não bloqueia a resposta ao usuário
 */

const { createClient } = require('@supabase/supabase-js');

const USD_TO_BRL = parseFloat(process.env.USD_TO_BRL || '5.50');

// Preços por 1M de tokens (USD)
// Fontes: openrouter.ai/models e console.anthropic.com/settings/billing
const MODEL_PRICES = {
  'google/gemini-2.0-flash-lite-001': {
    inputPer1M:  0.075,
    outputPer1M: 0.30,
  },
  'google/gemini-2.0-flash-001': {
    inputPer1M:  0.10,   // TODO: confirmar em openrouter.ai — user especificou $0.30 mas docs mostram $0.10
    outputPer1M: 0.40,   // TODO: confirmar — user especificou $2.50 mas docs mostram $0.40
  },
  'google/gemini-2.0-flash': {
    inputPer1M:  0.10,
    outputPer1M: 0.40,
  },
  'anthropic/claude-haiku-4-5-20251001': {
    inputPer1M:       1.00,
    outputPer1M:      5.00,
    cacheReadPer1M:   0.10,
    cacheWritePer1M:  1.25,
  },
  'claude-haiku-4-5-20251001': {  // alias sem prefixo "anthropic/"
    inputPer1M:       1.00,
    outputPer1M:      5.00,
    cacheReadPer1M:   0.10,
    cacheWritePer1M:  1.25,
  },
  'meta-llama/llama-4-maverick': {
    inputPer1M:  0.18,
    outputPer1M: 0.60,
  },
};

/**
 * Calcula custo estimado de uma chamada.
 * Retorna { usd, brl } ou null se modelo não mapeado / tokens ausentes.
 */
function estimateCost(model, inputTokens, outputTokens, cacheRead = 0, cacheWrite = 0) {
  const prices = MODEL_PRICES[model];
  if (!prices) return null;

  const inp = inputTokens || 0;
  const out = outputTokens || 0;
  const cr  = cacheRead   || 0;
  const cw  = cacheWrite  || 0;

  const usd =
    (inp / 1_000_000) * prices.inputPer1M +
    (out / 1_000_000) * prices.outputPer1M +
    (cr  / 1_000_000) * (prices.cacheReadPer1M  || 0) +
    (cw  / 1_000_000) * (prices.cacheWritePer1M || 0);

  return { usd, brl: usd * USD_TO_BRL };
}

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return _supabase;
}

/**
 * Registra uma chamada de IA na tabela api_requests.
 * Nunca lança exceção — usa fire-and-forget.
 *
 * @param {Object} params
 * @param {string}  params.phone
 * @param {string}  params.intent                  — intent final (após cap)
 * @param {string}  [params.rawIntent]              — intent antes do cap
 * @param {string}  [params.intentClassifierModel]  — modelo do classificador
 * @param {string}  params.targetModel              — modelo esperado pelo config
 * @param {string}  params.modelActuallyUsed        — modelo que foi chamado (pode ser fallback)
 * @param {string}  params.tierAtRequest            — 'full' | 'degraded' | 'minimal'
 * @param {boolean} [params.fallbackTriggered]
 * @param {string}  [params.fallbackReason]
 * @param {number}  [params.inputTokens]
 * @param {number}  [params.outputTokens]
 * @param {number}  [params.cacheReadTokens]
 * @param {number}  [params.cacheWriteTokens]
 * @param {number}  [params.latencyMs]
 * @param {number}  [params.responseLengthChars]
 * @param {number}  [params.userMessageLengthChars]
 * @param {number}  [params.conversationTurnNumber]
 * @param {string}  [params.error]                  — mensagem de erro (null = sucesso)
 */
async function logApiRequest(params) {
  try {
    const cost = estimateCost(
      params.modelActuallyUsed,
      params.inputTokens,
      params.outputTokens,
      params.cacheReadTokens,
      params.cacheWriteTokens,
    );

    const row = {
      phone:                      params.phone,
      intent:                     params.intent,
      raw_intent:                 params.rawIntent              || null,
      intent_classifier_model:    params.intentClassifierModel  || null,
      target_model:               params.targetModel            || null,
      model_actually_used:        params.modelActuallyUsed      || null,
      tier_at_request:            params.tierAtRequest          || 'full',
      fallback_triggered:         params.fallbackTriggered      || false,
      fallback_reason:            params.fallbackReason         || null,
      input_tokens:               params.inputTokens            || null,
      output_tokens:              params.outputTokens           || null,
      cache_read_tokens:          params.cacheReadTokens        || null,
      cache_write_tokens:         params.cacheWriteTokens       || null,
      estimated_cost_usd:         cost ? parseFloat(cost.usd.toFixed(6)) : null,
      estimated_cost_brl:         cost ? parseFloat(cost.brl.toFixed(4)) : null,
      latency_ms:                 params.latencyMs              || null,
      response_length_chars:      params.responseLengthChars    || null,
      user_message_length_chars:  params.userMessageLengthChars || null,
      conversation_turn_number:   params.conversationTurnNumber || null,
      error:                      params.error                  || null,
    };

    // Fire-and-forget: não await no caller
    getSupabase().from('api_requests').insert(row).then(({ error }) => {
      if (error) console.error('[Tracking] Insert falhou:', error.message);
    });
  } catch (err) {
    // Nunca propaga — log nunca pode quebrar a resposta ao usuário
    console.error('[Tracking] Erro inesperado:', err.message);
  }
}

module.exports = { logApiRequest, estimateCost };
