/**
 * profileLimits.js — controle de limites para análise de perfis
 *
 * Limites:
 * - Wingman Pro: 10 análises/dia
 * - Outros planos: 0 → upsell
 *
 * Cooldown: 60 segundos entre análises do mesmo usuário
 * Armazenamento: in-memory (reseta ao reiniciar o processo)
 */

const PROFILE_LIMITS = {
  pro: 10,
};

const PROFILE_COOLDOWN_MS = 60_000; // 60 segundos

// phone → { date: 'YYYY-MM-DD', count: number }
const profileDailyUsage = new Map();

// phone → timestamp da última análise
const profileLastTime = new Map();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getProfileCount(phone) {
  const entry = profileDailyUsage.get(phone);
  if (!entry || entry.date !== today()) return 0;
  return entry.count;
}

function incrementProfileCount(phone) {
  const count = getProfileCount(phone) + 1;
  profileDailyUsage.set(phone, { date: today(), count });
  return count;
}

function setProfileLastTime(phone) {
  profileLastTime.set(phone, Date.now());
}

/**
 * Verifica se o usuário pode realizar uma análise de perfil.
 *
 * @param {string}  phone
 * @param {boolean} isPro — plano Pro ativo
 * @returns {{ allowed: boolean, reason: 'ok'|'no_plan'|'limit_reached'|'cooldown', remaining: number }}
 */
function checkProfileLimit(phone, isPro) {
  if (!isPro) {
    return { allowed: false, reason: 'no_plan', remaining: 0 };
  }

  // Cooldown
  const lastTime = profileLastTime.get(phone) || 0;
  const elapsed  = Date.now() - lastTime;
  if (elapsed < PROFILE_COOLDOWN_MS) {
    const waitSecs = Math.ceil((PROFILE_COOLDOWN_MS - elapsed) / 1000);
    return { allowed: false, reason: 'cooldown', remaining: waitSecs };
  }

  // Limite diário
  const used     = getProfileCount(phone);
  const leftover = PROFILE_LIMITS.pro - used;

  if (leftover <= 0) {
    return { allowed: false, reason: 'limit_reached', remaining: 0 };
  }

  return { allowed: true, reason: 'ok', remaining: leftover };
}

// Limpeza periódica (1x/hora)
setInterval(() => {
  const t = today();
  for (const [phone, entry] of profileDailyUsage.entries()) {
    if (entry.date !== t) profileDailyUsage.delete(phone);
  }
  const cutoff = Date.now() - 2 * PROFILE_COOLDOWN_MS;
  for (const [phone, ts] of profileLastTime.entries()) {
    if (ts < cutoff) profileLastTime.delete(phone);
  }
}, 60 * 60 * 1000);

module.exports = {
  checkProfileLimit,
  incrementProfileCount,
  setProfileLastTime,
  getProfileCount,
  PROFILE_LIMITS,
  PROFILE_COOLDOWN_MS,
};
