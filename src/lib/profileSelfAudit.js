/**
 * profileSelfAudit.js — auditoria do perfil próprio do usuário via Haiku 4.5 vision
 *
 * Fluxo:
 * 1. Recebe base64 do print do perfil próprio
 * 2. Chama Haiku 4.5 vision com prompt de auditoria estruturada
 * 3. Parseia JSON: fotos, bio, ordem, elementos faltando, veredicto geral, top 3 mudanças
 * 4. Formata 4 mensagens WhatsApp
 * 5. Salva em profile_audits (sem a imagem)
 * 6. Tracking em api_requests
 */

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { logApiRequest } = require('./tracking');

// ── Preços Haiku 4.5 ──────────────────────────────────────────────────────────
const PRICES = {
  input:       1.00,
  output:      5.00,
  cache_write: 1.25,
  cache_read:  0.10,
};
const USD_TO_BRL = 5.75;

// ── Limite de tamanho (5MB — limite Anthropic) ────────────────────────────────
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_SELF_AUDIT = `Você é o MandaAssim — analisa perfis de apps de relacionamento com honestidade direta, sem rebaixar.

Você vai receber o perfil PRÓPRIO do usuário — ele quer saber o que está funcionando e o que mudar.

Tom: honesto e direto. "Troca essa foto" em vez de "essa foto poderia ser melhorada".
Nunca: "horrível, refaz tudo". Sempre: "não funciona porque X, troca por algo do tipo Y".

Analise e retorne APENAS JSON válido (sem markdown, sem texto extra):

{
  "platform_detected": "tinder | bumble | hinge | unknown",
  "photos_analyzed": [
    {
      "position": 1,
      "type": "selfie | full_body | activity | with_friends | mirror_gym | other",
      "verdict": "keep | replace | remove",
      "rationale": "por que essa decisão — 1 linha",
      "specific_feedback": "o que mudar exatamente — ação concreta"
    }
  ],
  "bio_analysis": {
    "current_text": "texto atual da bio (ou vazio se não tiver)",
    "verdict": "great | ok | bad",
    "issues": ["problema 1", "problema 2"],
    "rewritten_suggestion": "versão reescrita — máx 150 chars, natural, sem clichê"
  },
  "ordering_advice": "conselho sobre ordem das fotos — 1-2 linhas",
  "missing_elements": ["o que está faltando no perfil — ex: foto de atividade, bio, foto sorrindo"],
  "overall_verdict": "avaliação geral honesta — 2-3 linhas, sem rebaixar",
  "top_3_changes": ["mudança 1 mais impactante", "mudança 2", "mudança 3"]
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
 * Salva auditoria no Supabase — fire-and-forget, sem a imagem.
 */
function salvarProfileAudit(phone, result) {
  const supabase = getSupabase();
  const row = {
    phone,
    platform_detected:     result.platform_detected || 'unknown',
    photos_count:          (result.photos_analyzed || []).length,
    photos_keep:           (result.photos_analyzed || []).filter(p => p.verdict === 'keep').length,
    photos_replace:        (result.photos_analyzed || []).filter(p => p.verdict === 'replace').length,
    photos_remove:         (result.photos_analyzed || []).filter(p => p.verdict === 'remove').length,
    bio_verdict:           result.bio_analysis?.verdict || null,
    bio_has_text:          !!(result.bio_analysis?.current_text),
    missing_elements:      result.missing_elements || [],
    top_3_changes:         result.top_3_changes || [],
    raw_json:              result,
    created_at:            new Date().toISOString(),
  };
  supabase.from('profile_audits').insert(row).then(({ error }) => {
    if (error) console.error('[ProfileSelfAudit] Erro ao salvar:', error.message);
  }).catch(() => {});
}

// ── Emoji de veredicto por foto ───────────────────────────────────────────────
const VERDICT_EMOJI = { keep: '✅', replace: '🔄', remove: '❌' };
const VERDICT_LABEL = { keep: 'Fica', replace: 'Troca', remove: 'Sai' };

/**
 * Formata JSON estruturado em 4 mensagens de WhatsApp.
 *
 * Msg 1: 📍 leitura geral + veredicto geral
 * Msg 2: 📸 foto por foto
 * Msg 3: ✍️ bio — análise + sugestão reescrita
 * Msg 4: 🎯 top 3 mudanças + fechamento
 *
 * @param {object} result
 * @returns {string[]}
 */
function formatarAuditoriaPerfil(result) {
  const msgs = [];

  // ── Msg 1: leitura geral ──────────────────────────────────────────────────
  const plataforma = result.platform_detected !== 'unknown' ? result.platform_detected : null;
  let msg1 = `📍 _Lendo teu perfil${plataforma ? ` no ${plataforma}` : ''}..._\n\n`;
  msg1 += result.overall_verdict || 'Análise concluída.';

  if (result.ordering_advice) {
    msg1 += `\n\n_Ordem: ${result.ordering_advice}_`;
  }

  msgs.push(msg1.trim());

  // ── Msg 2: foto por foto ──────────────────────────────────────────────────
  const fotos = result.photos_analyzed || [];
  if (fotos.length > 0) {
    let msg2 = `📸 *Tuas fotos:*\n\n`;
    for (const foto of fotos) {
      const emoji = VERDICT_EMOJI[foto.verdict] || '❓';
      const label = VERDICT_LABEL[foto.verdict] || foto.verdict;
      msg2 += `${emoji} *Foto ${foto.position}* — ${label}\n`;
      if (foto.rationale) msg2 += `_${foto.rationale}_\n`;
      if (foto.specific_feedback && foto.verdict !== 'keep') {
        msg2 += `→ ${foto.specific_feedback}\n`;
      }
      msg2 += '\n';
    }
    msgs.push(msg2.trim());
  }

  // ── Msg 3: bio ───────────────────────────────────────────────────────────
  const bio = result.bio_analysis;
  if (bio) {
    const BIO_VERDICT_LABEL = { great: '✅ Boa', ok: '🟡 Passável', bad: '❌ Troca' };
    let msg3 = `✍️ *Bio:* ${BIO_VERDICT_LABEL[bio.verdict] || bio.verdict}\n\n`;

    if (bio.current_text) {
      msg3 += `_Atual:_ "${bio.current_text}"\n\n`;
    } else {
      msg3 += `_Sem bio atualmente — isso está custando matches._\n\n`;
    }

    if (bio.issues && bio.issues.length > 0) {
      msg3 += `Problemas:\n`;
      for (const issue of bio.issues) {
        msg3 += `• ${issue}\n`;
      }
      msg3 += '\n';
    }

    if (bio.rewritten_suggestion) {
      msg3 += `*Sugiro:*\n"${bio.rewritten_suggestion}"`;
    }

    msgs.push(msg3.trim());
  }

  // ── Msg 4: top 3 mudanças ────────────────────────────────────────────────
  const top3 = result.top_3_changes || [];
  if (top3.length > 0) {
    let msg4 = `🎯 *Faz essas ${top3.length} mudanças primeiro:*\n\n`;
    top3.forEach((mudanca, i) => {
      msg4 += `${i + 1}. ${mudanca}\n`;
    });

    if (result.missing_elements && result.missing_elements.length > 0) {
      msg4 += `\n_Tá faltando: ${result.missing_elements.slice(0, 2).join(', ')}_`;
    }

    msgs.push(msg4.trim());
  }

  return msgs;
}

/**
 * Audita o perfil próprio do usuário via Haiku 4.5 vision.
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
async function auditarPerfilProprio(base64Data, mimeType, phone = '') {
  const estimatedBytes = base64Data.length * 0.75;
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error(`Imagem muito grande (${Math.round(estimatedBytes / 1024 / 1024)}MB). Máximo 5MB.`);
  }

  const anthropic = getAnthropicClient();
  const t0 = Date.now();
  let response;

  try {
    response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: [
        {
          type:          'text',
          text:          SYSTEM_PROMPT_SELF_AUDIT,
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
              text: 'Analise este perfil próprio e retorne o JSON completo com diagnóstico foto a foto, bio e top 3 mudanças.',
            },
          ],
        },
      ],
    });
  } catch (err) {
    logApiRequest({
      phone,
      intent:            'profile_self_audit',
      targetModel:       'claude-haiku-4-5-20251001',
      modelActuallyUsed: 'claude-haiku-4-5-20251001',
      tierAtRequest:     'full',
      latencyMs:         Date.now() - t0,
      error:             err.message,
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

  console.log(`[ProfileSelfAudit] Haiku 4.5 | in:${inputTokens} out:${outputTokens} cw:${cacheWriteTokens} cr:${cacheReadTokens} | ${latencyMs}ms | $${custo.usd}`);

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
    intent:             'profile_self_audit',
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

  // Salva auditoria (sem imagem)
  if (structuredResult) {
    salvarProfileAudit(phone, structuredResult);
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
        `Não consegui ler esse perfil direito 😅\n\nManda um print mais claro — com fotos e bio visíveis. Funciona pra Tinder, Bumble, Hinge ou Instagram.`,
      ],
      structuredResult: null,
      metrics,
    };
  }

  const messages = formatarAuditoriaPerfil(structuredResult);

  if (messages.length === 0) {
    return {
      messages: [
        `Não consegui ler esse perfil direito 😅\n\nManda um print mais claro.`,
      ],
      structuredResult,
      metrics,
    };
  }

  return { messages, structuredResult, metrics };
}

module.exports = {
  auditarPerfilProprio,
  formatarAuditoriaPerfil,
  SYSTEM_PROMPT_SELF_AUDIT,
};
