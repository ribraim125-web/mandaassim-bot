/**
 * narrativeInline.js — disparo de atos que acontecem dentro do fluxo de mensagem
 *
 * Chamado do index.js nos pontos certos:
 *   getAct1Message(phone)                 — na boas-vindas (substituí welcome msg 1)
 *   handleAct1Response(phone, text)       — detecta "1"–"4" e retorna { message, persona } ou null
 *   getDiagnosticQuestion(persona, index) — retorna Q2 ou Q3 do diagnóstico (0=Q2, 1=Q3)
 *   getAct3Suffix(phone)                  — retorna sufixo da primeira análise ou null
 *   getAct7Message(phone, limitType)      — retorna mensagem de limite A/B ou null
 *
 * Todas as funções retornam null se a feature flag estiver OFF
 * ou se o ato já foi enviado.
 */

const { hasActBeenSent, logActSent, assignVariant } = require('./narrativeLog');
const { logJourneyEvent, hasEvent }                 = require('./journeyEvents');

const act1 = require('./acts/act_1_welcome_diagnosis');
const act2 = require('./acts/act_2_mechanism_intro');
const act3 = require('./acts/act_3_first_analysis');
const act7 = require('./acts/act_7_free_friction');

function isEnabled(envKey) {
  const val = (process.env[envKey] || 'false').toLowerCase();
  return val === 'true' || val === '1';
}

// ── Ato 1 ─────────────────────────────────────────────────────────────────────

/**
 * Retorna a mensagem do Ato 1 se dever ser enviada, ou null.
 * Chamado na boas-vindas de novos usuários.
 * Salva o log do envio imediatamente.
 *
 * @param {string} phone
 * @returns {Promise<string|null>}
 */
async function getAct1Message(phone) {
  if (!isEnabled(act1.featureFlag)) return null;
  const alreadySent = await hasActBeenSent(phone, act1.id);
  if (alreadySent) return null;

  const variant = assignVariant(phone, Object.keys(act1.variants).length);
  const msg     = (act1.variants[variant] || act1.variants.A).message;

  await logActSent(phone, act1.id, variant);
  await logJourneyEvent(phone, 'narrative_act_1_sent', { variant });

  return msg;
}

// ── Ato 2 ─────────────────────────────────────────────────────────────────────

/**
 * Detecta resposta ao Ato 1 (texto "1", "2", "3", "4") e retorna a mensagem
 * do Ato 2 para a persona correspondente. Retorna null se não for resposta.
 *
 * @param {string} phone
 * @param {string} text — texto da mensagem enviada pelo usuário
 * @returns {Promise<string|null>}
 */
async function handleAct1Response(phone, text) {
  if (!isEnabled(act2.featureFlag)) return null;

  // Só processa se Ato 1 já foi enviado e Ato 2 ainda não
  const act1Sent = await hasActBeenSent(phone, act1.id);
  if (!act1Sent) return null;

  const act2Sent = await hasActBeenSent(phone, act2.id);
  if (act2Sent) return null;

  const cleaned = text.trim();
  const choice  = act1.personaLabels[cleaned];
  if (!choice) return null; // não é resposta ao Ato 1

  // Salva persona como evento de jornada
  await logJourneyEvent(phone, 'act_1_persona_selected', { persona: choice, raw: cleaned });

  const personaData = act2.byPersona[choice] || act2.byPersona.outro;
  await logActSent(phone, act2.id, personaData.variant || 'A');
  await logJourneyEvent(phone, 'narrative_act_2_sent', { persona: choice });

  return { message: personaData.message, persona: choice };
}

// ── Diagnóstico Ato 2 → 2.5 ──────────────────────────────────────────────────

/**
 * Retorna a pergunta diagnóstica Q2 (index=0) ou Q3 (index=1) para a persona.
 * Q1 já está embutida na mensagem do Ato 2.
 *
 * @param {string} persona
 * @param {number} index — 0 para Q2, 1 para Q3
 * @returns {string}
 */
function getDiagnosticQuestion(persona, index) {
  const questions = act2.diagnosticQuestions[persona] || act2.diagnosticQuestions.outro;
  return questions[index];
}

// ── Ato 3 ─────────────────────────────────────────────────────────────────────

/**
 * Retorna o sufixo do Ato 3 se for a PRIMEIRA análise do usuário, ou null.
 * Deve ser chamado após entregar a análise principal.
 *
 * @param {string} phone
 * @returns {Promise<string|null>}
 */
async function getAct3Suffix(phone) {
  if (!isEnabled(act3.featureFlag)) return null;
  const alreadySent = await hasActBeenSent(phone, act3.id);
  if (alreadySent) return null;

  await logActSent(phone, act3.id, 'A');
  await logJourneyEvent(phone, 'first_response_suggestion_received');

  return act3.suffix;
}

// ── Ato 7 ─────────────────────────────────────────────────────────────────────

/**
 * Retorna a mensagem de limite A/B do Ato 7 ou null se a flag estiver OFF.
 * Chamado quando free user bate o limite diário.
 * Apenas trackeia e retorna o copy certo — NÃO envia a mensagem (o caller envia).
 *
 * @param {string} phone
 * @param {'response'|'print'|'coach'} limitType
 * @returns {Promise<string|null>}
 */
async function getAct7Message(phone, limitType) {
  if (!isEnabled(act7.featureFlag)) return null;

  // Act 7 pode repetir (1x por dia, primeira vez do dia)
  // Usa a variante determinística do usuário
  const variant = assignVariant(phone, 2);

  // Loga o envio (allow repeat = true → contamos cada dia)
  // O unique index não existe pra act_7 pois precisamos de repeat
  // Usamos logActSent mas com fallback sem erro de unique
  await logActSent(phone, `${act7.id}_${limitType}`, variant).catch(() => {});
  await logJourneyEvent(phone, `hit_daily_limit_${limitType}`, { variant }, true);

  return act7.getMessage(limitType, variant);
}

module.exports = {
  getAct1Message,
  handleAct1Response,
  getDiagnosticQuestion,
  getAct3Suffix,
  getAct7Message,
};
