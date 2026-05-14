/**
 * Ato 1 — Boas-vindas com diagnóstico de persona
 *
 * Substitui WELCOME_MESSAGES[1] quando ENABLE_ACT_1=true.
 * Dispara na primeira mensagem do usuário (evento: signup).
 * Aguarda resposta 1-4 para disparar Ato 2.
 *
 * EDITAR COPY: edite os campos `message` abaixo.
 */

module.exports = {
  id:          'act_1_welcome_diagnosis',
  description: 'Boas-vindas com diagnóstico de persona (substitui welcome msg 1)',
  featureFlag: 'ENABLE_ACT_1',
  inline:      true,            // dispara no fluxo de mensagem, não no worker
  triggerEvent: 'signup',
  cooldownDays: 0,              // dispara 1x por lifetime, sem cooldown adicional

  variants: {
    A: {
      message:
        `Antes de começar — me conta em uma frase: qual é o seu jogo agora?\n\n` +
        `🎯 Conquistar alguém específico\n` +
        `🔄 Voltei pro mercado e quero recalibrar\n` +
        `💬 Travo em conversas e quero soltar mais\n` +
        `📲 Quero arrumar meu perfil antes de tudo\n\n` +
        `Responde com o número ou suas palavras mesmo — a gente já sai resolvendo.`,
      ctaAction: 'await_persona_response',
    },
  },

  // Mapeamento de persona para contexto da resposta (usado pelo Ato 2)
  personaLabels: {
    '1': 'voltou_pro_mercado',
    '2': 'nos_apps_sem_conversao',
    '3': 'conversa_ativa',
    '4': 'outro',
  },
};
