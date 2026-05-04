/**
 * Ato 7 — Fricção do Free (A/B de copy no momento do limite)
 *
 * Não é uma mensagem proativa adicional — é um A/B test do copy de limite.
 * O engine retorna o texto certo para substituir o copy padrão de limite.
 *
 * Dispara inline: chamado quando free user bate limite de qualquer feature.
 * Trackeia outcome: se usuário upgradou após ver essa mensagem.
 *
 * EDITAR COPY: edite os campos `message` dos variants abaixo.
 */

const LINK_MENSAL = process.env.LINK_UPGRADE_WINGMAN || 'https://mandaassim.com/mensal';
const LINK_ANUAL  = process.env.LINK_UPGRADE_ANUAL   || 'https://mandaassim.com/anual';

module.exports = {
  id:          'act_7_free_friction',
  description: 'A/B test do copy de limite diário para usuários free',
  featureFlag: 'ENABLE_ACT_7',
  inline:      true,
  triggerEvent: 'hit_daily_limit',
  cooldownDays: 0, // pode disparar diariamente (1x por dia, primeira vez)

  // Copy por tipo de limite
  byLimitType: {
    response: {
      A: {
        message:
          `Deu 3 por hoje. Renova amanhã cedo.\n\n` +
          `Se a conversa tá quente e não dá pra esperar: ` +
          `*Wingman* (${LINK_MENSAL}) ou *anual* (${LINK_ANUAL}).`,
        ctaAction: 'link_upgrade',
      },
      B: {
        message:
          `3 respostas por hoje — acabou. Volta amanhã.\n\n` +
          `No *Wingman* é ilimitado. R$ 29,90/mês → ${LINK_MENSAL}`,
        ctaAction: 'link_upgrade',
      },
    },
    print: {
      A: {
        message:
          `Análise de print é só no Wingman.\n\n` +
          `Descreve a situação em texto — consigo ajudar assim também.\n\n` +
          `Ou se quiser análise de print: *Wingman* → ${LINK_MENSAL}`,
        ctaAction: 'link_upgrade',
      },
      B: {
        message:
          `Print de conversa é feature do *Wingman* (R$ 29,90/mês).\n\n` +
          `Enquanto isso: descreve a situação em texto, funciona bem.\n\n` +
          `*mensal* pra ter ilimitado → ${LINK_MENSAL}`,
        ctaAction: 'link_upgrade',
      },
    },
    coach: {
      A: {
        message:
          `Coach de Transição é do *Wingman*.\n\n` +
          `Digita *mensal* se quiser acessar → ${LINK_MENSAL}`,
        ctaAction: 'link_upgrade',
      },
      B: {
        message:
          `Essa feature é do *Wingman* (R$ 29,90/mês).\n\n` +
          `→ ${LINK_MENSAL}`,
        ctaAction: 'link_upgrade',
      },
    },
  },

  /**
   * Retorna a mensagem de limite para o tipo e variante do usuário.
   * @param {string} limitType — 'response' | 'print' | 'coach'
   * @param {'A'|'B'} variant
   * @returns {string}
   */
  getMessage(limitType, variant) {
    const byType = this.byLimitType[limitType] || this.byLimitType.response;
    return (byType[variant] || byType.A).message;
  },
};
