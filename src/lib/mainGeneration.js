/**
 * mainGeneration.js — adapter da geração principal (Tom Certo).
 *
 * Abstrai o provedor: o resto do código chama `gerarRespostaPrincipal()` e recebe
 * o texto final montado, SEM saber se rodou no GPT-5 mini (OpenRouter) ou no
 * Haiku (Anthropic).
 *
 *  - MODELS.MAIN_MODEL = 'openai/gpt-5-mini'  → SDK OpenAI / baseURL OpenRouter,
 *    structured output via response_format json_schema ESTRITO. Cache de prompt
 *    da OpenAI é automático (prompts grandes), reportado em prompt_tokens_details.
 *  - MODELS.MAIN_MODEL anthropic/claude... → SDK Anthropic, tool use forçado +
 *    prompt caching ephemeral.
 *
 * O FORMATO é montado NO CÓDIGO a partir do JSON (montarRespostaEstruturada) —
 * nunca pedimos separadores em texto livre. Saída visual idêntica à atual.
 *
 * Rollback: setar MAIN_MODEL='claude-haiku-4-5-20251001' no .env (sem deploy).
 */

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const MODELS = require('../config/models');
const { estimateCost } = require('./tracking');
const { aplicarFormatoEstruturado } = require('../../prompts/structuredFormat');

// Clientes próprios (lazy) — mantém o adapter independente do index.js.
let _openrouter = null, _anthropic = null;
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
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Tom → emoji (bate com TONE_EMOJI_RE / splitByToneBlocks do index.js).
const TONE_EMOJI = {
  'DIRETO': '🎯', 'ROMÂNTICO': '🌹', 'BRINCALHÃO': '😏', 'MISTERIOSO': '💭', 'CONFIANTE': '👑',
};

// Schema ÚNICO, neutro de provedor (serve tanto pro tool use Anthropic quanto
// pro json_schema estrito da OpenAI). Espelha os blocos reais do Tom Certo.
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    opcoes: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      description: 'Normalmente 3 opções de mensagem pronta, cada uma com um tom diferente que se encaixe na situação.',
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

const TOOL_NAME = 'entregar_resposta';

/**
 * Monta o texto final no formato exato que splitByToneBlocks já lê (header +
 * mensagem, blocos separados por linha em branco). Como é o código que monta,
 * é SEMPRE válido — saída visual idêntica à atual.
 */
function montarRespostaEstruturada(input) {
  const opcoes = Array.isArray(input?.opcoes) ? input.opcoes : [];
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

function isAnthropicModel(model) {
  return model.startsWith('anthropic/') || model.startsWith('claude');
}

function opcoesValidas(input) {
  return !!(input && Array.isArray(input.opcoes) && input.opcoes.length);
}

// Chama um modelo específico e devolve { text, malformed, usage }.
async function chamarModelo(model, { systemPrompt, userContent, maxTokens, temperature }) {
  // [P1] Caminho ESTRUTURADO (vale pra QUALQUER modelo aqui — GPT-5 mini ou Haiku
  // no rollback): troca a instrução velha de "imprima 🎯/⎯⎯⎯" pela nota de formato
  // estruturado, pra nenhum modelo enfiar emoji/header dentro do campo `mensagem`.
  const sys = aplicarFormatoEstruturado(systemPrompt);

  if (isAnthropicModel(model)) {
    const modelId = model.replace('anthropic/', '');
    const msg = await anthropic().messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: TOOL_NAME, description: 'Entrega a resposta do MandaAssim de forma estruturada.', input_schema: RESPONSE_SCHEMA }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: userContent }],
    });
    const toolUse = msg.content.find(b => b.type === 'tool_use');
    const malformed = !opcoesValidas(toolUse?.input);
    return {
      text: malformed
        ? (msg.content.find(b => b.type === 'text')?.text || '')
        : montarRespostaEstruturada(toolUse.input),
      malformed,
      modelUsed: modelId,
      usage: {
        inputTokens:      msg.usage?.input_tokens                || 0,
        outputTokens:     msg.usage?.output_tokens               || 0,
        cacheReadTokens:  msg.usage?.cache_read_input_tokens     || 0,
        cacheWriteTokens: msg.usage?.cache_creation_input_tokens || 0,
      },
    };
  }

  // OpenRouter (GPT-5 mini e compatíveis) — json_schema estrito.
  const resp = await openrouter().chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'tom_certo', strict: true, schema: RESPONSE_SCHEMA },
    },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userContent },
    ],
  });
  const raw = resp.choices[0]?.message?.content || '';
  let input = null;
  try { input = JSON.parse(raw); } catch (_) { /* malformado */ }
  const malformed = !opcoesValidas(input);
  const u = resp.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return {
    text: malformed ? raw : montarRespostaEstruturada(input),
    malformed,
    modelUsed: model,
    usage: {
      // estimateCost soma input cheio + cacheRead à parte; pra OpenAI o
      // prompt_tokens já inclui o cache, então subtraímos pra não duplicar.
      inputTokens:      Math.max(0, (u.prompt_tokens || 0) - cached),
      outputTokens:     u.completion_tokens || 0,
      cacheReadTokens:  cached,
      cacheWriteTokens: 0,
    },
  };
}

// Métrica acumulada de formato malformado (meta < 1%).
let _total = 0, _malformed = 0;

/**
 * Gera a resposta principal do Tom Certo. Tenta MAIN_MODEL; se falhar, faz
 * rollback automático pro MAIN_MODEL_ROLLBACK (Haiku). Loga modelo, taxa de
 * malformado, latência, tokens e custo.
 *
 * @returns {Promise<{ text, malformed, modelUsed, usage, latencyMs, fallbackTriggered, cost, error }>}
 */
async function gerarRespostaPrincipal({ systemPrompt, userContent, maxTokens = 900, temperature = 0.85, intent = 'volume' }) {
  const t0 = Date.now();
  let r, fallbackTriggered = false, error = null;
  try {
    r = await chamarModelo(MODELS.MAIN_MODEL, { systemPrompt, userContent, maxTokens, temperature });
  } catch (e) {
    error = e.message;
    fallbackTriggered = true;
    console.error(`[MainGen] ${MODELS.MAIN_MODEL} falhou (${e.message}) — rollback pro ${MODELS.MAIN_MODEL_ROLLBACK}`);
    r = await chamarModelo(MODELS.MAIN_MODEL_ROLLBACK, { systemPrompt, userContent, maxTokens, temperature });
  }

  const latencyMs = Date.now() - t0;
  _total++;
  if (r.malformed) _malformed++;
  const pct = (100 * _malformed / _total).toFixed(1);
  const cost = estimateCost(r.modelUsed, r.usage.inputTokens, r.usage.outputTokens, r.usage.cacheReadTokens, r.usage.cacheWriteTokens);

  console.log(
    `[MainGen] model:${r.modelUsed}${fallbackTriggered ? ' (rollback)' : ''} | intent:${intent} | ` +
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
