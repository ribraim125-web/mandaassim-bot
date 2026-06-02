/**
 * mainGeneration.js — adapter da geração de TODOS os intents de texto.
 *
 * Roda 100% via OpenRouter (ZERO Anthropic na geração de texto):
 *  - MAIN_MODEL = 'openai/gpt-5-mini' (primário)
 *  - fallback automático = MAIN_MODEL_ROLLBACK = 'google/gemini-2.5-flash-lite'
 *
 * Dois modos (param `structured`):
 *  - structured=true  (volume/premium): response_format json_schema ESTRITO com
 *    3 opções {tom, mensagem}. Os separadores 🎯/🌹/... são montados NO CÓDIGO
 *    (montarRespostaEstruturada) — nunca pedimos formato em texto livre.
 *  - structured=false (coaching/ousadia/outcome/one_liner): texto livre com o
 *    prompt ORIGINAL intacto; o formato nativo do intent é renderizado no
 *    enviarResposta (splitByDashes / parsearOpcoes / etc.).
 *
 * Cache de prompt da OpenAI é automático (prompts grandes), em prompt_tokens_details.
 * Rollback manual: setar MAIN_MODEL no .env (sem deploy).
 */

const OpenAI = require('openai');
const MODELS = require('../config/models');
const { estimateCost } = require('./tracking');
const { aplicarFormatoEstruturado } = require('../../prompts/structuredFormat');

// Cliente OpenRouter (lazy). Geração de texto roda 100% via OpenRouter
// (GPT-5 mini + fallback Gemini) — zero Anthropic aqui.
let _openrouter = null;
function openrouter() {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://mandaassim.com', 'X-Title': 'MandaAssim' },
    });
  }
  return _openrouter;
}

// Tom → emoji (bate com TONE_EMOJI_RE / splitByToneBlocks do index.js).
const TONE_EMOJI = {
  'DIRETO': '🎯', 'ROMÂNTICO': '🌹', 'BRINCALHÃO': '😏', 'MISTERIOSO': '💭', 'CONFIANTE': '👑',
};

// Schema do json_schema estrito (OpenRouter/OpenAI) pro modo structured.
// Espelha os blocos reais do Tom Certo (3 opções tom+mensagem).
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    opcoes: {
      type: 'array',
      // SEM minItems/maxItems: o structured output ESTRITO da OpenAI rejeita essas
      // keywords (400). O "máx 3" é garantido pela descrição + slice(0,3) no código.
      description: 'De 1 a 3 opções de mensagem pronta (normalmente 3), cada uma com um tom diferente que se encaixe na situação.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tom: {
            type: 'string',
            enum: ['DIRETO', 'ROMÂNTICO', 'BRINCALHÃO', 'MISTERIOSO', 'CONFIANTE'],
            description: 'O tom desta opção.',
          },
          mensagem: {
            type: 'string',
            description: 'A mensagem pronta pra ele copiar e mandar pra ela — UMA linha fluida, natural e coloquial, do jeito que um brasileiro digitaria no WhatsApp. Sem emoji de tom, sem header, sem aspas, sem ponto final, respeitando o limite de palavras do tom.',
          },
        },
        required: ['tom', 'mensagem'],
      },
    },
  },
  required: ['opcoes'],
};

/**
 * Monta o texto final no formato exato que splitByToneBlocks já lê (header +
 * mensagem, blocos separados por linha em branco). Como é o código que monta,
 * é SEMPRE válido — saída visual idêntica à atual.
 */
function montarRespostaEstruturada(input) {
  // máx 3 (garantia em código, já que o schema estrito não pode usar maxItems)
  const opcoes = (Array.isArray(input?.opcoes) ? input.opcoes : []).slice(0, 3);
  const segs = [];
  for (const o of opcoes) {
    const tom = String(o?.tom || '').toUpperCase();
    const emoji = TONE_EMOJI[tom] || '🎯';
    const msg = String(o?.mensagem || '').trim();
    if (!msg) continue;
    segs.push(`${emoji} ${tom}\n${msg}`);
  }
  return segs.join('\n\n');
}

function opcoesValidas(input) {
  return !!(input && Array.isArray(input.opcoes) && input.opcoes.length);
}

// Chama um modelo via OpenRouter (zero Anthropic na geração de texto).
//   structured=true  → json_schema estrito (3 opções) + [P1]; o código monta os
//                       separadores. Pra volume/premium (Tom Certo).
//   structured=false → texto livre, prompt ORIGINAL intacto (sem [P1]); o
//                       enviarResposta renderiza o formato nativo do intent.
async function chamarModelo(model, { systemPrompt, userContent, maxTokens, temperature, structured }) {
  // [P1] só no caminho estruturado — em texto livre o output_format original
  // de cada intent (---, 🔥/😏/⚡, etc.) precisa ficar intacto.
  const sys = structured ? aplicarFormatoEstruturado(systemPrompt) : systemPrompt;

  const req = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ],
  };
  if (structured) {
    req.response_format = {
      type: 'json_schema',
      json_schema: { name: 'tom_certo', strict: true, schema: RESPONSE_SCHEMA },
    };
  }

  const resp = await openrouter().chat.completions.create(req);
  const raw = resp.choices[0]?.message?.content || '';
  const u = resp.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  const usage = {
    // estimateCost soma input cheio + cacheRead à parte; pra OpenAI o
    // prompt_tokens já inclui o cache, então subtraímos pra não duplicar.
    inputTokens:      Math.max(0, (u.prompt_tokens || 0) - cached),
    outputTokens:     u.completion_tokens || 0,
    cacheReadTokens:  cached,
    cacheWriteTokens: 0,
  };

  if (!structured) {
    // Texto livre: devolve cru. "malformado" não se aplica (formato nativo é
    // validado/renderizado no enviarResposta).
    return { text: raw || 'Não consegui gerar respostas. Tente descrever melhor a situação.', malformed: false, modelUsed: model, usage };
  }

  // Estruturado: parseia o JSON e monta os blocos no código.
  let input = null;
  try { input = JSON.parse(raw); } catch (_) { /* malformado */ }
  const malformed = !opcoesValidas(input);
  return {
    text: malformed ? raw : montarRespostaEstruturada(input),
    malformed,
    modelUsed: model,
    usage,
  };
}

// Métrica acumulada de formato malformado (meta < 1%).
let _total = 0, _malformed = 0;

/**
 * Gera a resposta de um intent de texto. Tenta MAIN_MODEL (GPT-5 mini); se
 * falhar, fallback automático pro MAIN_MODEL_ROLLBACK (Gemini 2.5 Flash-Lite).
 * Zero Anthropic. `structured` decide schema de 3 opções vs texto livre.
 *
 * @returns {Promise<{ text, malformed, modelUsed, usage, latencyMs, fallbackTriggered, cost, error }>}
 */
async function gerarRespostaPrincipal({ systemPrompt, userContent, maxTokens = 900, temperature = 0.85, intent = 'volume', structured = false }) {
  const t0 = Date.now();
  const opts = { systemPrompt, userContent, maxTokens, temperature, structured };
  let r, fallbackTriggered = false, error = null;
  try {
    r = await chamarModelo(MODELS.MAIN_MODEL, opts);
  } catch (e) {
    error = e.message;
    fallbackTriggered = true;
    console.error(`[MainGen] ${MODELS.MAIN_MODEL} falhou (${e.message}) — fallback pro ${MODELS.MAIN_MODEL_ROLLBACK}`);
    r = await chamarModelo(MODELS.MAIN_MODEL_ROLLBACK, opts);
  }

  const latencyMs = Date.now() - t0;
  _total++;
  if (r.malformed) _malformed++;
  const pct = (100 * _malformed / _total).toFixed(1);
  const cost = estimateCost(r.modelUsed, r.usage.inputTokens, r.usage.outputTokens, r.usage.cacheReadTokens, r.usage.cacheWriteTokens);

  console.log(
    `[MainGen] model:${r.modelUsed}${fallbackTriggered ? ' (fallback)' : ''} | intent:${intent} [${structured ? 'structured' : 'livre'}] | ` +
    `malformado:${r.malformed ? 'SIM' : 'nao'} (${_malformed}/${_total} = ${pct}%) | ${latencyMs}ms | ` +
    `in:${r.usage.inputTokens} cache_read:${r.usage.cacheReadTokens} out:${r.usage.outputTokens} | ` +
    `$${cost ? cost.usd.toFixed(5) : '?'}`
  );

  return { ...r, latencyMs, fallbackTriggered, cost, error };
}

module.exports = {
  gerarRespostaPrincipal,
  montarRespostaEstruturada,
  RESPONSE_SCHEMA,
  TONE_EMOJI,
  // exportados pra teste/harness
  chamarModelo,
  _stats: () => ({ total: _total, malformed: _malformed }),
};
