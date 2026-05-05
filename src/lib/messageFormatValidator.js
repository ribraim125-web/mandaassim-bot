/**
 * messageFormatValidator.js
 *
 * Detecta violações das "4 Propriedades Sagradas" nas mensagens enviadas pelo bot.
 * Regras: zero aspas envolvendo a mensagem, zero prefixo inline, mensagem isolada no bloco.
 *
 * Fire-and-forget — NUNCA bloqueia o pipeline de envio.
 * Usar para monitorar regressões quando system prompts são alterados.
 *
 * Propriedades sagradas:
 *   1. Mensagem sugerida fica sozinha no bloco (enforcement via sendWithDelay + splitByDashes)
 *   2. ZERO aspas de qualquer tipo (" ' « »)
 *   3. ZERO prefixo na mesma linha ("Manda assim: texto")
 *   4. ZERO formatação WhatsApp dentro do texto pronto (*bold*, _italic_)
 */

// ── Vocabulário banido ────────────────────────────────────────────────────────

const BANNED_VOCABULARY = [
  { pattern: /\bfricção\b/i,                  term: 'fricção' },
  { pattern: /\bfeatures\b/i,                 term: 'features' },
  { pattern: /\bdestravar?\b/i,               term: 'destrava/destravar' },
  { pattern: /bora arrebentar/i,              term: 'Bora arrebentar' },
  { pattern: /auditoria de perfil/i,          term: 'Auditoria de Perfil' },
  { pattern: /coach de transi[cç][aã]o/i,     term: 'Coach de Transição' },
  { pattern: /pr[eé]-date coach/i,            term: 'Pré-Date Coach' },
  { pattern: /\bdebrief\b/i,                  term: 'debrief' },
  { pattern: /\bperformad[oa]\b/i,            term: 'performado/a' },
  { pattern: /\bperformar\b/i,                term: 'performar' },
  { pattern: /\bcringe\b/i,                   term: 'cringe' },
  { pattern: /sente a fric[cç][aã]o/i,        term: 'Sente a fricção' },
  { pattern: /tu tá no n[ií]vel/i,            term: 'tu tá no nível' },
  { pattern: /conquistar qualquer mulher/i,   term: 'conquistar qualquer mulher' },
];

// ── Padrões de violação ───────────────────────────────────────────────────────

// Mensagem que começa com aspas (qualquer tipo)
const QUOTE_START = /^["'"«»]/;

// Mensagem que começa E termina com aspas (claramente wrapped)
const QUOTE_WRAP = /^["'"«][\s\S]*["'"»]$/;

// Label inline: "Manda assim: texto" ou "🔥 "texto"" na mesma linha
const INLINE_PREFIX = /^(Manda|Cola|Envia|Use|Tenta|Aquece|Provoca|Seca)\b.*[:\uFF1A].+/i;

// Emoji de opção seguido de aspas (em qualquer posição da linha)
const EMOJI_QUOTE = /[🔥😏⚡]\s*["'"`«»]/;

// Formatação WhatsApp *dentro* do texto (asterisco ou underline no meio da frase)
// Só conta se estiver dentro de palavras (não em início de linha como marcador de lista)
const WHATSAPP_FORMAT_INLINE = /\w[*_]\w/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Heurística: o bloco parece ser uma mensagem pronta pra copiar?
 * (curto, sem bullets, sem emojis de diagnóstico)
 */
function looksLikeCopyableMessage(text) {
  const trimmed = text.trim();
  // Diagnósticos e análises não são mensagens pra copiar
  if (trimmed.startsWith('📍') || trimmed.startsWith('💡')) return false;
  if (trimmed.startsWith('*') && trimmed.includes(':')) return false; // título formatado
  if (trimmed.includes('\n•') || trimmed.includes('\n✓') || trimmed.includes('\n✗')) return false;
  // Mensagem curta (< 200 chars) sem quebra de linha = candidata a copy
  if (trimmed.length < 200 && !trimmed.includes('\n')) return true;
  return false;
}

// ── Validação ─────────────────────────────────────────────────────────────────

/**
 * Valida um bloco individual.
 *
 * @param {string} text — texto do bloco
 * @returns {Array<{type: string, snippet: string}>}
 */
function validateBlock(text) {
  const trimmed = text.trim();
  const violations = [];

  if (QUOTE_WRAP.test(trimmed)) {
    violations.push({ type: 'quote_wrap', snippet: trimmed.slice(0, 100) });
    return violations; // quote_wrap já engloba quote_start
  }

  if (QUOTE_START.test(trimmed)) {
    violations.push({ type: 'quote_start', snippet: trimmed.slice(0, 100) });
  }

  if (INLINE_PREFIX.test(trimmed)) {
    violations.push({ type: 'inline_prefix', snippet: trimmed.slice(0, 100) });
  }

  if (EMOJI_QUOTE.test(trimmed)) {
    violations.push({ type: 'emoji_quote', snippet: trimmed.slice(0, 100) });
  }

  // Só checa formatação interna em blocos que parecem mensagens prontas
  if (looksLikeCopyableMessage(trimmed) && WHATSAPP_FORMAT_INLINE.test(trimmed)) {
    violations.push({ type: 'whatsapp_format_inside', snippet: trimmed.slice(0, 100) });
  }

  // Vocabulário banido
  for (const { pattern, term } of BANNED_VOCABULARY) {
    if (pattern.test(trimmed)) {
      violations.push({ type: 'banned_vocabulary', term, snippet: trimmed.slice(0, 100) });
    }
  }

  // Inconsistência de pronome: mistura "você" e "tu" na mesma mensagem
  const hasTu   = /\btu\b/i.test(trimmed);
  const hasVoce = /\bvocê\b/i.test(trimmed);
  if (hasTu && hasVoce) {
    violations.push({ type: 'pronoun_inconsistency', snippet: trimmed.slice(0, 100) });
  }

  return violations;
}

/**
 * Valida um array de blocos (já splitado por splitByDashes).
 *
 * @param {string[]} messages
 * @returns {{ valid: boolean, violations: Array<{type, snippet, blockIndex}> }}
 */
function validateResponseArray(messages) {
  const violations = [];

  messages.forEach((msg, i) => {
    const blockViolations = validateBlock(msg);
    blockViolations.forEach(v => violations.push({ ...v, blockIndex: i }));
  });

  return { valid: violations.length === 0, violations };
}

// ── Persistência ──────────────────────────────────────────────────────────────

/**
 * Loga violações no Supabase. Fire-and-forget — nunca lança exceção.
 *
 * @param {string} phone
 * @param {string} intent
 * @param {Array} violations — output de validateResponseArray
 * @param {object} supabase  — cliente Supabase já inicializado
 */
async function logViolations(phone, intent, violations, supabase) {
  if (!supabase || !violations || violations.length === 0) return;

  try {
    await supabase.from('format_violations').insert(
      violations.map(v => ({
        phone:          phone || 'unknown',
        intent:         intent || 'unknown',
        violation_type: v.type,
        snippet:        v.term ? `[${v.term}] ${v.snippet || ''}` : (v.snippet || ''),
        block_index:    v.blockIndex ?? null,
      }))
    );
  } catch (_) {
    // Silencioso — nunca bloqueia o pipeline
  }
}

module.exports = { validateBlock, validateResponseArray, logViolations };
