/**
 * gptVision.js — cliente de visão/análise de imagem do projeto: GPT-5 mini via OpenRouter.
 *
 * Expõe a interface `messages.create(params)` no formato de blocos (system como
 * string ou array de blocos, content com blocos image/text) e devolve a resposta
 * no formato { content: [{ text }], usage: { input_tokens, ... } }. Esse formato
 * é o que todos os módulos de análise (print, perfil, coach) já leem.
 *
 * Rollback sem deploy: VISION_MODEL no .env (ex.: 'google/gemini-2.5-flash-lite').
 */

const OpenAI = require('openai');

const VISION_MODEL = process.env.VISION_MODEL || 'openai/gpt-5-mini';
const TIMEOUT_MS = Number(process.env.GEN_TIMEOUT_MS) || 30000;
const REASONING_EFFORT = process.env.GEN_REASONING_EFFORT || 'minimal';

let _client = null;
function client() {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://mandaassim.com', 'X-Title': 'MandaAssim' },
    });
  }
  return _client;
}

// system pode vir como string ou array de blocos { type:'text', text }
function systemToString(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system.map((b) => b?.text || '').join('\n');
}

// Converte um bloco de content (formato de blocos) pro formato OpenAI
function blocoParaOpenAI(bloco) {
  if (typeof bloco === 'string') return { type: 'text', text: bloco };
  if (bloco.type === 'image' && bloco.source?.type === 'base64') {
    return {
      type: 'image_url',
      image_url: { url: `data:${bloco.source.media_type};base64,${bloco.source.data}` },
    };
  }
  return { type: 'text', text: bloco.text || '' };
}

/**
 * messages.create(params). Ignora params.model — o modelo real é sempre
 * VISION_MODEL (GPT-5 mini), tunável via .env.
 */
async function create(params) {
  const messages = [];
  const sys = systemToString(params.system);
  if (sys) messages.push({ role: 'system', content: sys });
  for (const m of params.messages || []) {
    const content = Array.isArray(m.content) ? m.content.map(blocoParaOpenAI) : m.content;
    messages.push({ role: m.role, content });
  }

  const req = {
    model: VISION_MODEL,
    max_tokens: params.max_tokens || 1024,
    // GPT-5 mini é modelo de raciocínio — 'minimal' evita estourar a latência.
    reasoning: { effort: REASONING_EFFORT },
    messages,
  };
  if (typeof params.temperature === 'number') req.temperature = params.temperature;

  const resp = await client().chat.completions.create(req, { timeout: TIMEOUT_MS });

  const u = resp.usage || {};
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  // Formato de resposta espelha o que os callers já leem.
  return {
    content: [{ type: 'text', text: resp.choices[0]?.message?.content || '' }],
    usage: {
      input_tokens:                Math.max(0, (u.prompt_tokens || 0) - cached),
      output_tokens:               u.completion_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens:     cached,
    },
    model: resp.model || VISION_MODEL,
  };
}

module.exports = { messages: { create }, VISION_MODEL };
