/**
 * Ato 6 — Oferta de upgrade no fim do trial
 *
 * Trigger (avaliado pelo worker, a cada 5min):
 *   - user.plan === 'trial'
 *   - trial_ends_at BETWEEN now AND now + 2h
 *   - ato ainda não enviado
 *
 * EDITAR COPY: edite o campo `message` dos variants abaixo.
 */

const LINK_WINGMAN = process.env.LINK_UPGRADE_WINGMAN || 'https://mandaassim.com/mensal';
const LINK_ANUAL   = process.env.LINK_UPGRADE_ANUAL   || 'https://mandaassim.com/anual';
const PRECO_MENSAL = process.env.PRECO_MENSAL          || 'R$ 29,90/mês';

module.exports = {
  id:          'act_6_trial_ending',
  description: 'Oferta de upgrade 1-2h antes do trial acabar',
  featureFlag: 'ENABLE_ACT_6',
  inline:      false,
  cooldownDays: 0, // deve disparar mesmo se outro ato foi enviado hoje

  variants: {
    A: {
      message:
        `Ei. Teus 3 dias acabam em pouco tempo.\n\n` +
        `A partir daí, no plano gratuito:\n` +
        `• 3 respostas/dia\n` +
        `• Sem análise de print de conversa\n` +
        `• Sem análise de perfil\n\n` +
        `Pra continuar ilimitado é *${PRECO_MENSAL}* no Wingman. ` +
        `Cancela quando quiser, sem letra miúda.\n\n` +
        `→ ${LINK_WINGMAN}`,
      ctaAction: 'link_wingman',
    },
    B: {
      message:
        `Trial acabando.\n\n` +
        `Se te ajudou nesses dias, o Wingman continua por *${PRECO_MENSAL}/mês*.\n\n` +
        `*mensal* → ${LINK_WINGMAN}\n` +
        `*anual* → ${LINK_ANUAL} (melhor custo)`,
      ctaAction: 'keyword_plan',
    },
  },

  /**
   * Avalia se o ato deve ser disparado.
   *
   * @param {object} user — { plan, created_at, plan_expires_at, trial_ends_at }
   * @param {object} journeyCtx
   * @returns {boolean}
   */
  shouldFire(user, journeyCtx) {
    if (user.plan !== 'trial') return false;

    // Detecta fim do trial: 3 dias após o cadastro
    const trialStart   = new Date(user.created_at).getTime();
    const trialEndsAt  = user.trial_ends_at
      ? new Date(user.trial_ends_at).getTime()
      : trialStart + 3 * 24 * 3600 * 1000;

    const now      = Date.now();
    const hoursLeft = (trialEndsAt - now) / 3600000;

    // Janela: entre 2h antes e o momento do fim
    return hoursLeft >= 0 && hoursLeft <= 2;
  },
};
