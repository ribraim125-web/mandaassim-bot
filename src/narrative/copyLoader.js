/**
 * copyLoader.js — carrega e parseia arquivos .md de copy para WhatsApp
 *
 * Convenção dos arquivos .md:
 *   - Blocos separados por linha "---" viram mensagens WhatsApp separadas
 *   - Linhas começando com # ou // são comentários e removidas antes de enviar
 *   - Placeholders: [CHAVE_EM_CAIXA_ALTA] são substituídos em runtime
 *   - Formatação WhatsApp: *negrito*, _itálico_, ~riscado~, `mono`
 *
 * Cache em memória de 5min. Em NODE_ENV=development, invalida a cada 30s.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const COPY_DIR  = path.join(__dirname, '../../docs/narrative');
const CACHE_TTL = process.env.NODE_ENV === 'development' ? 30_000 : 5 * 60_000;

/** @type {Map<string, { messages: string[], expiresAt: number }>} */
const _cache = new Map();

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parseia raw .md em array de mensagens (uma por bloco ---).
 * Remove linhas de comentário (# ou //).
 * @param {string} raw
 * @returns {string[]}
 */
function parseCopyFile(raw) {
  const withoutComments = raw
    .split('\n')
    .filter(line => {
      const t = line.trim();
      return t.length > 0 ? !t.startsWith('#') && !t.startsWith('//') : true;
    })
    .join('\n');

  return withoutComments
    .split(/\n\s*---\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);
}

/**
 * Substitui placeholders [CHAVE] pelos valores fornecidos.
 * @param {string[]} messages
 * @param {Record<string, string>} vars
 * @returns {string[]}
 */
function applyTemplate(messages, vars = {}) {
  return messages.map(msg => {
    let result = msg;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\[${key}\\]`, 'g'), value ?? '');
    }
    return result;
  });
}

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Carrega e parseia um arquivo de copy.
 * @param {string} copyFile — relativo a docs/narrative/ (ex: 'acts/act_01_hook_diagnostico.md')
 * @returns {string[]} mensagens
 */
function loadCopy(copyFile) {
  const filePath = path.join(COPY_DIR, copyFile);
  const now      = Date.now();

  const cached = _cache.get(filePath);
  if (cached && cached.expiresAt > now) return cached.messages;

  if (!fs.existsSync(filePath)) {
    throw new Error(`[CopyLoader] Arquivo de copy não encontrado: ${filePath}`);
  }

  const raw      = fs.readFileSync(filePath, 'utf-8');
  const messages = parseCopyFile(raw);

  _cache.set(filePath, { messages, expiresAt: now + CACHE_TTL });
  return messages;
}

/**
 * Carrega, aplica template vars e retorna mensagens prontas para envio.
 * @param {string} copyFile
 * @param {Record<string, string>} vars
 * @returns {string[]}
 */
function loadAndApplyCopy(copyFile, vars = {}) {
  const messages = loadCopy(copyFile);
  return applyTemplate(messages, vars);
}

/** Invalida o cache inteiro (útil após edição de copy em produção). */
function invalidateCache() {
  _cache.clear();
}

module.exports = { loadCopy, loadAndApplyCopy, parseCopyFile, applyTemplate, invalidateCache };
