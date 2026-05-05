#!/usr/bin/env node
/**
 * test-message-paste-format.js
 *
 * Valida as "4 Propriedades Sagradas" das mensagens sugeridas:
 *   1. Mensagem isolada no bloco (enforcement via splitByDashes)
 *   2. ZERO aspas de qualquer tipo
 *   3. ZERO prefixo inline ("Manda assim: texto")
 *   4. ZERO formatação WhatsApp dentro do texto (sem *bold* / _italic_)
 *
 * Testa todos os intents onde o bot sugere mensagens para o user copiar.
 *
 * Uso:
 *   ANTHROPIC_API_KEY=... node scripts/test-message-paste-format.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Anthropic = require('@anthropic-ai/sdk');
const { validateResponseArray } = require('../src/lib/messageFormatValidator');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitByDashes(text) {
  return text.split(/\n[ \t]*---[ \t]*\n/).map(s => s.trim()).filter(Boolean);
}

function extractSystemPrompt(varName) {
  const fs = require('fs');
  const indexContent = fs.readFileSync(require('path').join(__dirname, '../index.js'), 'utf8');
  const regex = new RegExp(`const ${varName} = \`([\\s\\S]*?)\`;`, 'g');
  const match = regex.exec(indexContent);
  return match ? match[1] : null;
}

// ── Validação principal ───────────────────────────────────────────────────────

function runPasteValidation(label, messages) {
  const { valid, violations } = validateResponseArray(messages);

  const icon = valid ? '✓' : '✗';
  console.log(`${icon} ${label}`);
  console.log(`  blocos: ${messages.length}`);

  if (!valid) {
    violations.forEach(v => {
      console.log(`  ⚠ bloco[${v.blockIndex}] ${v.type}: "${v.snippet.slice(0, 70)}"`);
    });
  }
  console.log('');
  return valid;
}

async function testIntent(label, systemPrompt, userMessage) {
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const text = msg.content[0]?.text || '';
    const blocks = splitByDashes(text);
    return runPasteValidation(label, blocks.length > 1 ? blocks : [text]);
  } catch (err) {
    console.log(`✗ ${label} — ERRO: ${err.message}\n`);
    return false;
  }
}

// ── Testa formatadores de lib (sem chamar Haiku) ──────────────────────────────

function testLibFormatter(label, messages) {
  return runPasteValidation(label, messages);
}

// ── Simula formatarRespostaPrint ──────────────────────────────────────────────

function simulatePrintFormatter() {
  // Simula um resultado típico do Haiku com sugestão de mensagem
  const { formatarRespostaPrint } = (() => {
    try { return require('../src/lib/printAnalysis'); } catch (_) { return {}; }
  })();

  if (!formatarRespostaPrint) return null;

  const mockResult = {
    conversation_temperature: 'warm',
    match_interest_level: 'high',
    suggested_next_message: {
      balanced: 'adorei a foto da viagem, onde foi isso?',
      safe: 'oi tudo bem?',
      bold: 'você parece interessante',
    },
    analysis_summary: 'Conversa fluindo bem, interesse mútuo evidente.',
    recommended_action: 'engage',
    what_NOT_to_send: ['mensagem muito longa', 'oi tudo bem'],
  };

  return formatarRespostaPrint(mockResult);
}

function simulateProfileFormatter() {
  const { formatarRespostaPerfil } = (() => {
    try { return require('../src/lib/profileAnalysis'); } catch (_) { return {}; }
  })();

  if (!formatarRespostaPerfil) return null;

  const mockResult = {
    profile_summary: 'Perfil feminino com interesse em viagens e música.',
    match_potential: 'high',
    recommended_first_message: {
      playful_clever: 'aquela foto no Japão — você foi pro anime ou pela comida?',
      soft_curious: 'você parece ser do tipo que tem histórias interessantes',
      direct_charming: 'aquela foto te entregou — você ama viajar ou foi só essa vez?',
    },
    what_NOT_to_send: ['oi linda', 'tudo bem?'],
    key_interests: ['viagens', 'música'],
    opening_angle: 'viagem recente detectada no perfil',
  };

  return formatarRespostaPerfil(mockResult);
}

function simulatePreDateFormatter() {
  const { formatarRespostaPreDate } = (() => {
    try { return require('../src/lib/predateCoach'); } catch (_) { return {}; }
  })();

  if (!formatarRespostaPreDate) return null;

  const mockResult = {
    date_summary: 'amanhã, sábado às 19h',
    location_type: 'bar',
    location_summary: 'Bar no centro',
    is_first_date: true,
    main_concern: 'nervoso com o silêncio',
    outfit_recommendation: 'calça escura + camisa casual + tênis limpo',
    conversation_topics: ['viagem que ela mencionou', 'série que vocês curtem', 'trabalho de forma leve'],
    topics_to_avoid: ['ex', 'política'],
    drink_limit_note: 'máximo 2 cervejas',
    timing_advice: 'chega 5 min antes',
    duration_advice: '1h30 — sai em alta quando o papo ainda tá bom',
    post_date_message_suggestion: 'curti muito, bora repetir isso em breve',
    encouragement: 'Você tá pronto. Relaxa, aparece, fica presente.',
    day_before_tip: 'confirma o local amanhã de manhã com uma mensagem curta',
  };

  return formatarRespostaPreDate(mockResult);
}

function simulateDebriefFormatter() {
  const { formatarRespostaDebrief } = (() => {
    try { return require('../src/lib/postdateDebrief'); } catch (_) { return {}; }
  })();

  if (!formatarRespostaDebrief) return null;

  const mockResult = {
    encounter_quality_assessment: 'good',
    quality_rationale: 'Encontro positivo, ela demonstrou interesse mas faltou tensão no final.',
    her_interest_signals: ['riu bastante', 'fez perguntas sobre você', 'ficou 2h e meia'],
    her_disinterest_signals: [],
    user_performance_feedback: {
      what_worked: ['foi pontual', 'papo fluiu bem'],
      what_to_improve: ['podia ter criado mais tensão', 'saiu antes de criar momento'],
      biggest_mistake: 'Não propôs próximo encontro antes de sair',
    },
    next_step_recommendation: 'Manda mensagem hoje à noite — curta e positiva, sem cobrar resposta',
    next_step_timing: 'now',
    message_suggestions: {
      warm_followup: 'curti muito hoje, precisamos repetir isso',
      playful_callback: 'ainda pensando naquele papo sobre viagem — onde foi mesmo?',
      next_invite: 'na sexta tem um lugar que combina com você, bora?',
    },
  };

  return formatarRespostaDebrief(mockResult);
}

function simulateTransitionFormatter() {
  const { formatarRespostaCoach } = (() => {
    try { return require('../src/lib/transitionCoach'); } catch (_) { return {}; }
  })();
  const formatarRespostaTransicao = formatarRespostaCoach;

  if (!formatarRespostaTransicao) return null;

  const mockResult = {
    readiness_assessment: 'ready',
    rationale: 'Conversa fluindo há 7 dias, ela engajada, já no WhatsApp.',
    suggested_approach: 'casual',
    suggested_format: 'proposta leve e específica',
    suggested_location_type: 'público_movimentado',
    suggested_message_to_send: {
      soft: 'bora tomar um café essa semana?',
      balanced: 'sexta à tarde tenho um lugar ótimo aqui, bora?',
      direct: 'sábado de manhã eu passo onde você estiver',
    },
    timing_recommendation: 'Agora é o momento — manda hoje',
    follow_up_strategy: {
      if_yes: 'Confirma local e horário, nada mais',
      if_stalling: 'Espera 2 dias e tenta de novo com algo diferente',
      if_no: 'Respeita, continua a conversa normal',
    },
    red_flags_to_watch: [],
  };

  return formatarRespostaTransicao(mockResult);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Test: Zero-Friction Paste Format ===\n');
  console.log('Valida: zero aspas, zero prefixo inline, zero formatação WhatsApp\n');

  const results = [];

  // ── 1-2. System prompts via Haiku ─────────────────────────────────────────
  const SYSTEM_PROMPT = extractSystemPrompt('SYSTEM_PROMPT');
  const SYSTEM_PROMPT_MINIMAL = extractSystemPrompt('SYSTEM_PROMPT_MINIMAL');
  const SYSTEM_PROMPT_OUSADIA = extractSystemPrompt('SYSTEM_PROMPT_OUSADIA');
  const SYSTEM_PROMPT_COACH = extractSystemPrompt('SYSTEM_PROMPT_COACH');

  if (SYSTEM_PROMPT) {
    results.push(await testIntent(
      'premium — sugestão de mensagem (situação com tensão)',
      SYSTEM_PROMPT,
      'Ela me mandou "oi sumido" depois de 4 dias sem responder. O que falo?'
    ));
  }

  if (SYSTEM_PROMPT_MINIMAL) {
    results.push(await testIntent(
      'minimal/one_liner — 3 respostas curtas',
      SYSTEM_PROMPT_MINIMAL,
      'ela mandou "oi sumido"'
    ));
  }

  if (SYSTEM_PROMPT_OUSADIA) {
    results.push(await testIntent(
      'ousadia — flerte com duplo sentido',
      SYSTEM_PROMPT_OUSADIA,
      'ela mandou foto dela na praia e disse "tô gostando do sol"'
    ));
  }

  if (SYSTEM_PROMPT_COACH) {
    results.push(await testIntent(
      'coaching — orientação com mensagem pra mandar',
      SYSTEM_PROMPT_COACH,
      'Minha namorada tá fria há 2 semanas. O que eu mando pra ela hoje?'
    ));
  }

  console.log('--- Formatadores de lib (sem Haiku) ---\n');

  // ── 3-7. Formatadores de lib ──────────────────────────────────────────────
  const printMsgs = simulatePrintFormatter();
  if (printMsgs) {
    results.push(testLibFormatter('print_analysis — formatarRespostaPrint', printMsgs));
  } else {
    console.log('⚠ printAnalysis: formatarRespostaPrint não exportado (skip)\n');
  }

  const profileMsgs = simulateProfileFormatter();
  if (profileMsgs) {
    results.push(testLibFormatter('profile_analysis — formatarRespostaPerfil', profileMsgs));
  } else {
    console.log('⚠ profileAnalysis: formatarRespostaPerfil não exportado (skip)\n');
  }

  const preDateMsgs = simulatePreDateFormatter();
  if (preDateMsgs) {
    results.push(testLibFormatter('predate_coach — formatarRespostaPreDate', preDateMsgs));
  } else {
    console.log('⚠ predateCoach: formatarRespostaPreDate não exportado (skip)\n');
  }

  const debriefMsgs = simulateDebriefFormatter();
  if (debriefMsgs) {
    results.push(testLibFormatter('postdate_debrief — formatarRespostaDebrief', debriefMsgs));
  } else {
    console.log('⚠ postdateDebrief: formatarRespostaDebrief não exportado (skip)\n');
  }

  const transitionMsgs = simulateTransitionFormatter();
  if (transitionMsgs) {
    results.push(testLibFormatter('transition_coach — formatarRespostaTransicao', transitionMsgs));
  } else {
    console.log('⚠ transitionCoach: formatarRespostaTransicao não exportado (skip)\n');
  }

  // ── Resultado ─────────────────────────────────────────────────────────────
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`${'='.repeat(40)}`);
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
