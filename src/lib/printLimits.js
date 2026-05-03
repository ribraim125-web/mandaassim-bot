/**
 * printLimits.js — controle de limites para análise de prints
 *
 * Limites:
 * - Premium ativo: 5 análises/dia
 * - Trial ativo: 1 análise/dia
 * - Free (pós-trial): 0 (vê upsell)
 *
 * Cooldown: 30 segundos entre análises do mesmo usuário (evita duplo envio)
 *
 * Armazenamento: in-memory (reseta ao reiniciar o processo)
 * Resets diários: automático (compara date string YYYY-MM-DD)
 */

const PRINT_LIMITS = {
  premium: 5,
  trial:   1,
};

const PRINT_COOLDOWN_MS = 30_000; // 30 segundos

// phone → { date: 'YYYY-MM-DD', count: number }
const printDailyUsage = new Map();

// phone → timestamp (Date.now()) da última análise
const printLastTime = new Map();

/**
 * Retorna data atual no formato YYYY-MM-DD (fuso local do servidor).
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Retorna o número de análises de print usadas hoje pelo usuário.
 */
function getPrintCount(phone) {
  const entry = printDailyUsage.get(phone);
  if (!entry || entry.date !== today()) return 0;
  return entry.count;
}

/**
 * Incrementa o contador de análises de print do usuário.
 */
function incrementPrintCount(phone) {
  const count = getPrintCount(phone) + 1;
  printDailyUsage.set(phone, { date: today(), count });
  return count;
}

/**
 * Atualiza o timestamp da última análise (para cooldown).
 */
function setPrintLastTime(phone) {
  printLastTime.set(phone, Date.now());
}

/**
 * Verifica se o usuário pode realizar uma análise de print.
 *
 * @param {string} phone
 * @param {boolean} isPremium — plano premium ativo
 * @param {boolean} inTrial — dentro dos 3 dias de trial
 * @returns {{ allowed: boolean, reason: 'ok'|'no_plan'|'limit_reached'|'cooldown', remaining: number }}
 */
function checkPrintLimit(phone, isPremium, inTrial) {
  // Usuário sem acesso (pós-trial, sem premium)
  if (!isPremium && !inTrial) {
    return { allowed: false, reason: 'no_plan', remaining: 0 };
  }

  // Cooldown
  const lastTime = printLastTime.get(phone) || 0;
  const elapsed  = Date.now() - lastTime;
  if (elapsed < PRINT_COOLDOWN_MS) {
    const waitSecs = Math.ceil((PRINT_COOLDOWN_MS - elapsed) / 1000);
    return { allowed: false, reason: 'cooldown', remaining: waitSecs };
  }

  // Limite diário
  const limit   = isPremium ? PRINT_LIMITS.premium : PRINT_LIMITS.trial;
  const used    = getPrintCount(phone);
  const leftover = limit - used;

  if (leftover <= 0) {
    return { allowed: false, reason: 'limit_reached', remaining: 0 };
  }

  return { allowed: true, reason: 'ok', remaining: leftover };
}

/**
 * Limpa maps periodicamente (1x/hora) para evitar memory leak em produção.
 */
setInterval(() => {
  const t = today();
  for (const [phone, entry] of printDailyUsage.entries()) {
    if (entry.date !== t) printDailyUsage.delete(phone);
  }
  const cutoff = Date.now() - 2 * PRINT_COOLDOWN_MS;
  for (const [phone, ts] of printLastTime.entries()) {
    if (ts < cutoff) printLastTime.delete(phone);
  }
}, 60 * 60 * 1000);

module.exports = {
  checkPrintLimit,
  incrementPrintCount,
  setPrintLastTime,
  getPrintCount,
  PRINT_LIMITS,
  PRINT_COOLDOWN_MS,
};
