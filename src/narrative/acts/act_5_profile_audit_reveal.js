/**
 * Ato 5 — Profile Audit Reveal (upsell Pro via auditoria de perfil)
 *
 * Trigger (avaliado pelo narrativeWorker, a cada 30min):
 *   - user.plan IN ('trial', 'free', 'wingman')   — não disparar pra Pro
 *   - print_analyses_count >= 2                   — já usou o produto
 *   - 36h < (now - user.created_at) < 96h         — janela de interesse ativo
 *   - ato ainda não enviado
 *   - nenhum outro ato nas últimas 24h             — cooldown global
 *
 * EDITAR COPY: edite os campos `message` dos variants abaixo.
 */

const PRECO_PRO = process.env.PRECO_PRO || 'R$ 79,90/mês';
const LINK_PRO  = process.env.LINK_UPGRADE_PRO || 'https://mandaassim.com/pro';

module.exports = {
  id:          'act_5_profile_audit_reveal',
  description: 'Revela auditoria de perfil como benefício Pro — janela 36-96h',
  featureFlag: 'ENABLE_ACT_5',
  inline:      false, // agendado pelo worker
  cooldownDays: 1,    // respeitado pelo cooldown global do worker

  variants: {
    A: {
      message:
        `Ei. Vou ser honesto contigo.\n\n` +
        `Tô te ajudando a melhorar a resposta — mas tem uma coisa antes disso: ` +
        `e se o problema não for só a resposta?\n\n` +
        `No *Wingman Pro* eu olho teu perfil de Tinder ou Bumble na lata: ` +
        `foto por foto o que tá errado, a bio, a ordem. Com diagnóstico específico e o que mudar.\n\n` +
        `Nenhum amigo faz isso com você de verdade. Eu faço.\n\n` +
        `*Wingman Pro: ${PRECO_PRO}*\n${LINK_PRO}`,
      ctaAction: 'link_pro',
    },
    B: {
      message:
        `Uma coisa que você provavelmente não sabe:\n\n` +
        `No *Wingman Pro*, além de análise de conversa, eu analiso teu perfil de Tinder/Bumble. ` +
        `Foto a foto — qual funciona, qual afasta, qual trocar. Bio reescrita. Ordem de fotos.\n\n` +
        `Às vezes o problema não é a resposta. É o perfil que chega antes dela.\n\n` +
        `*Wingman Pro: ${PRECO_PRO}* → digita *pro* pra saber mais.`,
      ctaAction: 'keyword_pro',
    },
  },

  /**
   * Avalia se o ato deve ser disparado para o usuário.
   * Chamado pelo narrativeWorker antes de enviar.
   *
   * @param {object} user — linha da tabela users (plan, created_at, etc.)
   * @param {object} journeyCtx — { printCount, actsAlreadySent }
   * @returns {boolean}
   */
  shouldFire(user, journeyCtx) {
    const { plan, created_at } = user;

    // Não dispara pra Pro (já tem a feature)
    if (plan === 'wingman_pro') return false;

    // Janela de interesse: 36h–96h desde o cadastro
    const ageHours = (Date.now() - new Date(created_at).getTime()) / 3600000;
    if (ageHours < 36 || ageHours > 96) return false;

    // Precisa ter feito pelo menos 2 análises de print
    if ((journeyCtx.printCount || 0) < 2) return false;

    return true;
  },
};
