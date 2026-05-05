const OPCOES = `*mensal* (R$29,90) ou *anual* (R$299)`;

const MESSAGES = {
  day1_inactive: [
    `Tem alguma conversa rolando? Manda o print ou descreve a situação. Eu leio e te devolvo as opções.`,
    `E aí, sumido. Alguma situação pra desenrolar? Manda aqui.`,
    `Tô por aqui. Se trancar uma conversa ou bater dúvida, me chama.`,
  ],

  limit_drop_10: [
    `A partir de hoje são 10 análises por dia. Usa nas que importam.`,
    `Daqui pra frente: 10 análises por dia. Manda o que tiver rolando de mais importante.`,
  ],

  limit_exhausted_10: [
    `Deu 10 por hoje. Amanhã cedo renova.\n\nSe não der pra esperar:\n• ${OPCOES}.`,
    `Por hoje, fechou. Amanhã tem mais 10.\n\nQuer ilimitado? ${OPCOES}.`,
  ],

  limit_drop_3: [
    `A partir de hoje são 3 análises por dia.\n\nSe quiser mais: ${OPCOES}.`,
    `Trial encerrado. Agora são 3/dia. Usa nas situações que realmente precisam.\n\nQuer ilimitado? ${OPCOES}.`,
  ],

  limit_exhausted_3: [
    `Deu 3 por hoje. Amanhã tem mais 3.\n\nSe não dá pra esperar:\n• ${OPCOES}.`,
    `Por hoje, fechou. Renova amanhã.\n\nQuer ilimitado? ${OPCOES}.`,
    `3 por hoje, encerrou. Se precisar agora: ${OPCOES}.`,
  ],

  predate_reminder_day_before: [
    `Amanhã é o encontro 🗓️\n\nConfirma o local hoje. Define a roupa à noite — casual mas arrumado pro lugar. Barba feita, perfume sutil. Chega 5 min antes, não 30.\n\nTá tudo encaminhado.\n\n_Pra parar os lembretes: digita *parar*_`,
    `Amanhã é o dia. Confirma o endereço, cuida dos detalhes: roupa, barba, perfume leve. Não precisa ser perfeito — só presente.\n\n_PARAR pra cancelar lembretes._`,
  ],

  predate_reminder_2h_before: [
    `Daqui a pouco é o encontro.\n\nSai com calma. Chega 5 min antes. Quando ela chegar, guarda o celular, foca nela.\n\nVai bem.`,
    `Chegando a hora. Guarda o celular quando ela aparecer, foca no momento.\n\nVai nessa.`,
  ],

  predate_debrief: [
    `E aí, como foi o encontro? Me conta — pode ser curto 👇`,
    `Como foi? Ela foi bem, esfriou, rolou alguma coisa? Me conta.`,
  ],
};

// Mensagem especial de outcome do Coach de Transição (não tem variações — é pessoal)
const TRANSITION_COACH_OUTCOME_MESSAGE =
  `Semana passada te ajudei a chamar ela pra sair. E aí, como foi? Ela topou? Me conta — pode ser curto 👇`;

function getMessage(triggerType) {
  if (triggerType === 'transition_coach_outcome') {
    return TRANSITION_COACH_OUTCOME_MESSAGE;
  }
  const options = MESSAGES[triggerType];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { getMessage };
