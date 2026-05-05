/**
 * profileAnalysis.js — análise de perfis de apps de relacionamento via Haiku 4.5 vision
 *
 * Fluxo:
 * 1. Recebe base64 do print de perfil
 * 2. Chama Haiku 4.5 vision com prompt focado em gerar primeira mensagem personalizada
 * 3. Parseia JSON estruturado
 * 4. Formata 2-3 mensagens WhatsApp
 * 5. Salva em profile_analyses (sem a imagem)
 * 6. Tracking em api_requests
 */

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { logApiRequest } = require('./tracking');

// ── Preços Haiku 4.5 ─────────────────────────────────────────────────────────
const PRICES = {
  input:       1.00,
  output:      5.00,
  cache_write: 1.25,
  cache_read:  0.10,
};
const USD_TO_BRL = 5.75;

// ── Tamanho máximo (5MB — limite Anthropic) ─────────────────────────────────���
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_PROFILE = `Você é o MandaAssim — lê a intenção por trás do perfil dela para gerar a primeira mensagem certa.

PRINCÍPIO CENTRAL: a melhor primeira mensagem é aquela que ela lê e pensa "esse cara realmente olhou meu perfil". Específico > genérico sempre.

LEITURA DE INTENÇÃO: antes de gerar a mensagem, entenda o que ela sinalizou — o que as fotos, a bio e os interesses revelam sobre o que ela busca e como ela quer ser abordada.

REGRA DE OURO DAS PRIMEIRAS MENSAGENS:
- NUNCA: "oi linda", "que perfil incrível", "você caiu do céu", elogio de aparência
- NUNCA: perguntas fechadas (sim/não)
- NUNCA: template ou frase que poderia ser pra qualquer pessoa
- SEMPRE: baseia em detalhe específico do perfil — bio, foto, interesse, localização, legenda
- SEMPRE: abre conversa naturalmente, deixa ela com vontade de responder
- SEMPRE: tom de cara interessante no WhatsApp, não de roteiro de sedução

EXEMPLOS DE BOA PRIMEIRA MENSAGEM:
- Bio dela: "apaixonada por café e viagens" → "qual foi a viagem que te fez mais falta de voltar?"
- Foto em montanha → "parece que você é do tipo que planeja ou vai sem GPS?"
- Bio: "pet lover 🐕" com foto de cachorro → "esse cachorro aí tem nome ou só cargo de CEO da casa?"
- Interesse: música → "qual foi o último show que valeu a fila?"
- Bio vazia mas foto em restaurante/bar específico → "esse lugar ali na [cidade] é bom mesmo?"

Tom: maduro, direto, interessante. Não ansioso, não genérico, não vulgar.

Retorne APENAS JSON válido, sem markdown, sem texto fora do JSON.

Schema:
{
  "platform": "tinder" | "bumble" | "instagram" | "hinge" | "unknown",
  "name_detected": "...",
  "age_detected": "...",
  "bio_text": "...",
  "interests_detected": ["..."],
  "photos_themes": ["academia", "viagem", "pet", "comida", "natureza", "praia", "balada", "trabalho", "arte"],
  "personality_signals": ["aventureira", "intelectual", "fitness", "artística", "tranquila", "agitada", "divertida", "séria"],
  "potential_hooks": [
    {"hook": "...", "rationale": "..."},
    {"hook": "...", "rationale": "..."},
    {"hook": "...", "rationale": "..."}
  ],
  "risks_to_watch": ["sinal de alerta 1", "sinal de alerta 2"],
  "recommended_first_message": {
    "soft_curious": "...",
    "playful_clever": "...",
    "direct_charming": "..."
  },
  "what_NOT_to_send": ["erro clássico 1 pra evitar com esse perfil", "erro 2"]
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcularCusto(usage) {
  const input      = usage?.input_tokens                  || 0;
  const output     = usage?.output_tokens                 || 0;
  const cacheWrite = usage?.cache_creation_input_tokens   || 0;
  const cacheRead  = usage?.cache_read_input_tokens       || 0;
  const usd =
    (input      / 1e6 * PRICES.input)       +
    (output     / 1e6 * PRICES.output)      +
    (cacheWrite / 1e6 * PRICES.cache_write) +
    (cacheRead  / 1e6 * PRICES.cache_read);
  return {
    usd: parseFloat(usd.toFixed(6)),
    brl: parseFloat((usd * USD_TO_BRL).toFixed(4)),
  };
}

/**
 * Salva análise no Supabase — fire-and-forget, sem a imagem.
 */
function salvarProfileAnalysis(phone, result) {
  const supabase = getSupabase();
  const row = {
    phone,
    platform_detected:       result.platform || 'unknown',
    name_detected:           result.name_detected || null,
    age_detected:            result.age_detected || null,
    bio_text:                result.bio_text ? result.bio_text.slice(0, 500) : null,
    interests_count:         (result.interests_detected || []).length,
    photos_themes:           result.photos_themes || [],
    personality_signals:     result.personality_signals || [],
    potential_hooks_count:   (result.potential_hooks || []).length,
    risks_count:             (result.risks_to_watch || []).length,
    has_first_message:       !!(result.recommended_first_message?.playful_clever),
    raw_json:                result,
    created_at:              new Date().toISOString(),
  };
  supabase.from('profile_analyses').insert(row).then(({ error }) => {
    if (error) console.error('[ProfileAnalysis] Erro ao salvar:', error.message);
  }).catch(() => {});
}

/**
 * Formata JSON estruturado em 3 mensagens de WhatsApp.
 *
 * Msg 1: 📍 leitura dela — quem ela é, o que sinalizou, o hook mais forte
 * Msg 2: mensagem principal recomendada (playful_clever)
 * Msg 3: variações + o que não mandar
 *
 * @param {object} result
 * @returns {string[]}
 */
function formatarRespostaPerfil(result) {
  const msgs = [];

  // ── Msg 1: leitura dela ───────────────────────────────────────────────────
  const plataforma = result.platform !== 'unknown' ? result.platform : null;
  const nome = result.name_detected || null;
  const sinais = (result.personality_signals || []).slice(0, 2);
  const temas  = (result.photos_themes || []).slice(0, 2);
  const hooks  = result.potential_hooks || [];

  let leitura = `📍 _Lendo a intenção dela..._\n\n`;

  if (nome) {
    leitura += `*${nome}*`;
    if (plataforma) leitura += ` (${plataforma})`;
  } else if (plataforma) {
    leitura += `Perfil ${plataforma}`;
  }

  if (sinais.length > 0) {
    leitura += leitura.includes('\n\n') && !nome && !plataforma ? '' : ' — ';
    leitura += sinais.join(', ');
  }

  if (temas.length > 0) {
    leitura += `, curte ${temas.join(' e ')}`;
  }

  // Hook mais forte como diagnóstico da intenção
  const melhorHook = hooks[0];
  if (melhorHook?.rationale) {
    leitura += `\n\n💡 _${melhorHook.rationale}_`;
  }

  if (result.risks_to_watch?.length > 0) {
    leitura += `\n\n⚠️ ${result.risks_to_watch[0]}`;
  }

  msgs.push(leitura.trim());

  // ── Msg 2: mensagem principal ─────────────────────────────────────────────
  const sugestao = result.recommended_first_message?.playful_clever;
  if (sugestao) {
    msgs.push(`Manda isso pra abrir 👇`);
    msgs.push(sugestao.trim());
  }

  // ── Msg 3: variações + o que não mandar ──────────────────────────────────
  const softCurious    = result.recommended_first_message?.soft_curious;
  const directCharming = result.recommended_first_message?.direct_charming;
  const naoMandar      = result.what_NOT_to_send || [];

  // Variações: cada opção em bloco próprio (label + mensagem separados)
  if (softCurious) {
    msgs.push(`Mais suave:`);
    msgs.push(softCurious.trim());
  }
  if (directCharming) {
    msgs.push(`Mais direta:`);
    msgs.push(directCharming.trim());
  }

  // Não manda — isso é orientação, não mensagem a copiar: mantém junto
  if (naoMandar.length > 0) {
    let msgNao = `Não manda:\n`;
    for (const erro of naoMandar.slice(0, 2)) {
      msgNao += `• ${erro}\n`;
    }
    msgs.push(msgNao.trim());
  }

  return msgs;
}

/**
 * Analisa um print de perfil via Haiku 4.5 vision.
 *
 * @param {string} base64Data
 * @param {string} mimeType
 * @param {string} phone
 * @returns {Promise<{
 *   messages: string[],
 *   structuredResult: object|null,
 *   metrics: object
 * }>}
 */
async function analisarPerfilComHaiku(base64Data, mimeType, phone = '') {
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
          type:          'text',
          text:          SYSTEM_PROMPT_PROFILE,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type:   'image',
              source: { type: 'base64', media_type: mimeType, data: base64Data },
            },
            {
              type: 'text',
              text: 'Analise este perfil e retorne o JSON conforme o schema. Gere primeiras mensagens personalizadas com base no que você realmente viu no perfil — nunca genéricas.',
            },
          ],
        },
      ],
    });
  } catch (err) {
    trackingError = err.message;
    logApiRequest({
      phone,
      intent:            'profile_analysis',
      targetModel:       'claude-haiku-4-5-20251001',
      modelActuallyUsed: 'claude-haiku-4-5-20251001',
      tierAtRequest:     'full',
      latencyMs:         Date.now() - t0,
      error:             trackingError,
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

  console.log(`[ProfileAnalysis] Haiku 4.5 | in:${inputTokens} out:${outputTokens} cw:${cacheWriteTokens} cr:${cacheReadTokens} | ${latencyMs}ms | $${custo.usd}`);

  // Parse JSON
  const rawText = response.content[0]?.text || '';
  let structuredResult = null;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    structuredResult = JSON.parse(cleaned);
  } catch (_) {
    structuredResult = null;
  }

  // Tracking
  logApiRequest({
    phone,
    intent:             'profile_analysis',
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

  // Salva análise (sem imagem)
  if (structuredResult) {
    salvarProfileAnalysis(phone, structuredResult);
  }

  const metrics = {
    latencyMs,
    costUsd: custo.usd,
    costBrl: custo.brl,
    inputTokens,
    outputTokens,
  };

  if (!structuredResult) {
    return {
      messages: [
        `Não consegui ler esse perfil.\n\nManda um print mais claro — com nome, bio e pelo menos uma foto. Funciona pra Tinder, Bumble, Hinge ou Instagram.`,
      ],
      structuredResult: null,
      metrics,
    };
  }

  const messages = formatarRespostaPerfil(structuredResult);

  if (messages.length === 0) {
    return {
      messages: [
        `Não consegui ler esse perfil.\n\nManda um print mais claro — com nome, bio e pelo menos uma foto.`,
      ],
      structuredResult,
      metrics,
    };
  }

  return { messages, structuredResult, metrics };
}

module.exports = {
  analisarPerfilComHaiku,
  formatarRespostaPerfil,
  SYSTEM_PROMPT_PROFILE,
};
