#!/usr/bin/env node
/**
 * test-message-breaks.js
 *
 * Testa se as respostas dinâmicas do MandaAssim seguem a regra de quebra de mensagem:
 *   - Usa separadores --- (cada --- = 1 mensagem WhatsApp separada)
 *   - Nenhum bloco tem mais que 6 linhas de conteúdo
 *   - Respostas longas geram >= 3 mensagens
 *
 * Uso:
 *   ANTHROPIC_API_KEY=... node scripts/test-message-breaks.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitByDashes(text) {
  return text.split(/\n[ \t]*---[ \t]*\n/).map(s => s.trim()).filter(Boolean);
}

function countContentLines(block) {
  return block.split('\n').filter(l => l.trim().length > 0).length;
}

function validate(label, response, { minBlocks = 3, maxLinesPerBlock = 6 } = {}) {
  const blocks = splitByDashes(response);
  const hasDashes = blocks.length > 1;
  const blockCount = blocks.length;
  const longBlocks = blocks.filter(b => countContentLines(b) > maxLinesPerBlock);

  const pass = hasDashes && blockCount >= minBlocks && longBlocks.length === 0;

  const icon = pass ? '✓' : '✗';
  console.log(`${icon} ${label}`);
  console.log(`  blocos: ${blockCount} (mín ${minBlocks}) | long blocks: ${longBlocks.length} (max ${maxLinesPerBlock} linhas)`);
  if (!hasDashes) console.log('  ⚠ Modelo não usou separador ---');
  if (longBlocks.length > 0) {
    longBlocks.forEach((b, i) => {
      console.log(`  ⚠ Bloco ${i + 1} tem ${countContentLines(b)} linhas: "${b.slice(0, 60)}..."`);
    });
  }
  console.log('');
  return pass;
}

// ── System prompts extraídos do index.js por regex (sem instanciar o servidor) ─

async function testPrompt(label, systemPrompt, userMessage, options = {}) {
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const text = msg.content[0]?.text || '';
    return validate(label, text, options);
  } catch (err) {
    console.log(`✗ ${label} — ERRO: ${err.message}\n`);
    return false;
  }
}

// ── Extrai system prompts do index.js (sem instanciar o servidor) ─────────────

function extractSystemPrompt(varName) {
  const fs = require('fs');
  const indexContent = fs.readFileSync(require('path').join(__dirname, '../index.js'), 'utf8');
  const regex = new RegExp(`const ${varName} = \`([\\s\\S]*?)\`;`, 'g');
  const match = regex.exec(indexContent);
  return match ? match[1] : null;
}

// ── Testes ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Test: Message Breaks ===\n');

  const SYSTEM_PROMPT = extractSystemPrompt('SYSTEM_PROMPT');
  const SYSTEM_PROMPT_COACH_RAW = extractSystemPrompt('SYSTEM_PROMPT_COACH');

  if (!SYSTEM_PROMPT || !SYSTEM_PROMPT_COACH_RAW) {
    console.error('Não consegui extrair os system prompts do index.js. Verifique o formato.');
    process.exit(1);
  }

  const results = [];

  // 1. Premium — situação com tensão
  results.push(await testPrompt(
    'premium (situação com tensão)',
    SYSTEM_PROMPT,
    'Ela me mandou "oi sumido" depois de 4 dias sem responder. O que falo?',
    { minBlocks: 3, maxLinesPerBlock: 6 }
  ));

  // 2. Premium — chamar pra sair
  results.push(await testPrompt(
    'premium (chamar pra sair)',
    SYSTEM_PROMPT,
    'Tamo trocando mensagem há 2 semanas, conversa fluindo. Quero chamar ela pra sair.',
    { minBlocks: 3, maxLinesPerBlock: 6 }
  ));

  // 3. Coaching — reconquista
  results.push(await testPrompt(
    'coaching (reconquista)',
    SYSTEM_PROMPT_COACH_RAW,
    'Minha ex de 2 anos terminou há 3 meses. Ela me bloqueou no Instagram mas não no WhatsApp. Quero tentar de novo.',
    { minBlocks: 4, maxLinesPerBlock: 6 }
  ));

  // 4. Coaching — relacionamento esfriando
  results.push(await testPrompt(
    'coaching (relacionamento esfriando)',
    SYSTEM_PROMPT_COACH_RAW,
    'Minha namorada tá fria há 2 semanas. Antes respondia rápido, agora demora horas. Não briguei com ela.',
    { minBlocks: 4, maxLinesPerBlock: 6 }
  ));

  // 5. Coaching — voltou pro mercado
  results.push(await testPrompt(
    'coaching (voltou pro mercado)',
    SYSTEM_PROMPT_COACH_RAW,
    'Fiquei 8 anos casado, separei há 6 meses. Nunca usei app. Não faço ideia de como funciona hoje.',
    { minBlocks: 3, maxLinesPerBlock: 6 }
  ));

  // Resultado final
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${'='.repeat(30)}`);
  console.log(`Resultado: ${passed}/${total} testes passaram`);
  if (passed === total) {
    console.log('ALL TESTS PASSED ✓');
  } else {
    console.log(`${total - passed} FAILED ✗`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
