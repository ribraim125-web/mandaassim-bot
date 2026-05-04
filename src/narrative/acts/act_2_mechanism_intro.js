/**
 * Ato 2 — Introdução do mecanismo único (Leitura de Intenção)
 *
 * Dispara < 5min após o usuário responder o Ato 1.
 * Variante selecionada com base na persona escolhida no Ato 1.
 *
 * EDITAR COPY: edite os campos `message` abaixo.
 */

module.exports = {
  id:          'act_2_mechanism_intro',
  description: 'Apresenta Leitura de Intenção com base na persona do Ato 1',
  featureFlag: 'ENABLE_ACT_2',
  inline:      true,
  triggerEvent: 'act_1_response',
  cooldownDays: 0,

  // Mensagem por persona do Ato 1
  // Editar copy aqui — sem tocar no engine
  byPersona: {
    voltou_pro_mercado: {
      variant: 'A',
      message:
        `Entendi. Voltou pro mercado depois de tempo fora — provavelmente apps mudaram, as regras parecem outras.\n\n` +
        `Aqui funciona diferente de qualquer IA. ChatGPT te dá uma resposta. Eu faço *Leitura de Intenção* primeiro — ` +
        `leio o que ela sinalizou, o que tá rolando de fato, antes de sugerir o que falar.\n\n` +
        `Resultado: você não manda resposta genérica. Você manda a certa.\n\n` +
        `Bora testar? Manda o print de uma conversa que tá travada ou me descreve a situação.`,
    },
    nos_apps_sem_conversao: {
      variant: 'A',
      message:
        `Claro. Tá nos apps mas as conversas morrem antes de ir a lugar algum — clássico.\n\n` +
        `Eu funciono diferente. ChatGPT te dá uma resposta. Eu faço *Leitura de Intenção* primeiro — ` +
        `entendo o que ela quis dizer com aquela mensagem antes de sugerir o que responder.\n\n` +
        `A conversa avança quando a resposta é certa pra aquele momento. Não quando é "boa no geral".\n\n` +
        `Bora testar? Manda o print da última conversa que esfriou.`,
    },
    conversa_ativa: {
      variant: 'A',
      message:
        `Beleza. Tá no momento crítico — conversa rolando agora.\n\n` +
        `Aqui funciona diferente de qualquer ChatGPT. ChatGPT te dá uma resposta. ` +
        `Eu faço *Leitura de Intenção* primeiro — leio o que ela quis dizer e o que tá rolando antes de sugerir o que falar.\n\n` +
        `Bora testar? Manda print da conversa ou me descreve a situação.`,
    },
    outro: {
      variant: 'A',
      message:
        `Entendido. Aqui o funcionamento é simples:\n\n` +
        `Você me manda o print de uma conversa ou descreve a situação. ` +
        `Eu faço *Leitura de Intenção* — leio o que ela sinalizou — e te dou 3 opções de resposta reais pra copiar.\n\n` +
        `Manda o que tiver rolando.`,
    },
  },
};
