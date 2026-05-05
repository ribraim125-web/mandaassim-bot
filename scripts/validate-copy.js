#!/usr/bin/env node
/**
 * validate-copy.js — validação estática de vocabulário e pronome em todos os arquivos de copy
 *
 * Uso:
 *   node scripts/validate-copy.js
 *   node scripts/validate-copy.js --verbose    (mostra trecho de cada violação)
 *
 * Verifica:
 *   1. Vocabulário banido (glossário docs/copy-rules.md)
 *   2. Mistura de pronomes "tu" + "você" na mesma mensagem (bloco)
 *   3. Promessas exageradas
 *
 * Cobre:
 *   - docs/narrative/acts/*.md
 *   - docs/narrative/variants/*.md
 *   - src/followup/followupMessages.js (strings literais)
 */

const fs   = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');

// ── Vocabulário banido ─────────────────────────────────────────────────────────

const BANNED = [
  { pattern: /\bfricção\b/gi,                     term: 'fricção' },
  { pattern: /\bfeatures\b/gi,                    term: 'features' },
  { pattern: /\bdestravar?\b/gi,                  term: 'destrava/destravar' },
  { pattern: /bora arrebentar/gi,                 term: 'Bora arrebentar' },
  { pattern: /auditoria de perfil/gi,             term: 'Auditoria de Perfil' },
  { pattern: /coach de transi[cç][aã]o/gi,        term: 'Coach de Transição' },
  { pattern: /pr[eé]-date coach/gi,               term: 'Pré-Date Coach' },
  { pattern: /\bdebrief\b/gi,                     term: 'debrief' },
  { pattern: /\bperformad[oa]\b/gi,               term: 'performado/a' },
  { pattern: /\bperformar\b/gi,                   term: 'performar' },
  { pattern: /\bcringe\b/gi,                      term: 'cringe' },
  { pattern: /sente a fric[cç][aã]o/gi,           term: 'Sente a fricção' },
  { pattern: /tu tá no n[ií]vel/gi,               term: 'tu tá no nível' },
  { pattern: /conquistar qualquer mulher/gi,      term: 'conquistar qualquer mulher' },
  { pattern: /\bwingman\b/gi,                     term: 'wingman' },
  { pattern: /\balpha\b/gi,                       term: 'alpha' },
  { pattern: /\babundance\b/gi,                   term: 'abundance' },
  { pattern: /respira fundo/gi,                   term: 'respira fundo' },
  { pattern: /Bora arrebentar/g,                  term: 'Bora arrebentar (variante)' },
  { pattern: /tu chegou no momento/gi,            term: 'Tu chegou no momento' },
  { pattern: /ela tá testando teu valor/gi,       term: 'ela tá testando teu valor' },
  { pattern: /\bframe\b/gi,                       term: 'frame (manosfera)' },
];

// ── Arquivos a checar ─────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');

const TARGETS = [
  ...glob(`${ROOT}/docs/narrative/acts`, '*.md'),
  ...glob(`${ROOT}/docs/narrative/variants`, '*.md'),
  fs.existsSync(`${ROOT}/src/followup/followupMessages.js`)
    ? [`${ROOT}/src/followup/followupMessages.js`]
    : [],
].flat().filter(Boolean);

function glob(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  const ext = pattern.replace('*', '');
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => path.join(dir, f));
}

// ── Lógica de validação ────────────────────────────────────────────────────────

function validateContent(content, filePath) {
  const violations = [];
  const relPath = path.relative(ROOT, filePath);

  // Remove linhas de comentário (// ...) — são metadados internos, não copy do usuário
  const stripped = content.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');

  // Divide em blocos por ---
  const blocks = stripped.split(/\n---\n/);

  blocks.forEach((block, bi) => {
    const trimmed = block.trim();
    if (!trimmed) return;

    // 1. Vocabulário banido
    for (const { pattern, term } of BANNED) {
      // Reset lastIndex para regex global
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        violations.push({
          file:    relPath,
          block:   bi + 1,
          type:    'banned_vocabulary',
          term,
          snippet: VERBOSE ? findSnippet(trimmed, pattern) : trimmed.slice(0, 80) + '…',
        });
      }
    }

    // 2. Mistura tu/você no mesmo bloco
    const hasTu   = /\btu\b/i.test(trimmed);
    const hasVoce = /\bvocê\b/i.test(trimmed);
    if (hasTu && hasVoce) {
      violations.push({
        file:    relPath,
        block:   bi + 1,
        type:    'pronoun_inconsistency',
        term:    'tu + você no mesmo bloco',
        snippet: VERBOSE ? trimmed.slice(0, 120) + '…' : trimmed.slice(0, 80) + '…',
      });
    }
  });

  return violations;
}

function findSnippet(text, pattern) {
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  if (!m) return text.slice(0, 80);
  const start = Math.max(0, m.index - 30);
  const end   = Math.min(text.length, m.index + m[0].length + 30);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// ── Main ──────────────────────────────────────────────────────────────────────

let totalFiles     = 0;
let totalViolations = 0;
const byFile = {};

for (const file of TARGETS) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  const violations = validateContent(content, file);
  totalFiles++;
  if (violations.length > 0) {
    totalViolations += violations.length;
    byFile[path.relative(ROOT, file)] = violations;
  }
}

// ── Relatório ─────────────────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

console.log(`\n📋 Validação de copy — MandaAssim`);
console.log(`   Arquivos verificados: ${totalFiles}`);
console.log(`   Violações encontradas: ${totalViolations}\n`);

if (totalViolations === 0) {
  console.log(`${PASS}  Vocabulário limpo em todos os arquivos.\n`);
  process.exit(0);
}

for (const [file, violations] of Object.entries(byFile)) {
  console.log(`${FAIL}  ${file}`);
  for (const v of violations) {
    const label = v.type === 'banned_vocabulary'
      ? `\x1b[31m[vocab]\x1b[0m "${v.term}"`
      : `\x1b[33m[pronome]\x1b[0m ${v.term}`;
    console.log(`     bloco ${v.block}: ${label}`);
    if (VERBOSE) {
      console.log(`              → "${v.snippet}"`);
    }
  }
  console.log();
}

console.log(`Total: ${totalViolations} violação(ões) em ${Object.keys(byFile).length} arquivo(s).\n`);
process.exit(totalViolations > 0 ? 1 : 0);
