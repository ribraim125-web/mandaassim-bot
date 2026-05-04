const OPCOES = `*mensal* (R$29,90) ou *anual* (R$299)`;

const MESSAGES = {
  day1_inactive: [
    `Tem alguma conversa rolando? Manda o print ou descreve a situação — leio e te dou as opções.`,
    `E aí, apareceu. Alguma situação pra resolver? Manda aqui.`,
    `Tô por aqui. Conversa travada, situação pra entender — manda.`,
  ],

  limit_drop_10: [
    `A partir de hoje são 10 análises por dia. Usa nas que importam.`,
    `10 análises por dia daqui pra frente. Manda o que tiver rolando.`,
  ],

  limit_exhausted_10: [
    `Deu 10 por hoje. Amanhã cedo renova.\n\nSe não der pra esperar: ${OPCOES}.`,
    `Por hoje acabou. Amanhã tem mais 10.\n\nQuer ilimitado? ${OPCOES}.`,
  ],

  limit_drop_3: [
    `A partir de hoje são 3 análises por dia.\n\nSe quiser mais: ${OPCOES}.`,
    `Trial encerrado — agora são 3/dia. Usa nas situações que realmente precisam.\n\nQuer ilimitado? ${OPCOES}.`,
  ],

  limit_exhausted_3: [
    `Deu 3 por hoje. Amanhã tem mais 3.\n\nSe não dá pra esperar: ${OPCOES}.`,
    `Por hoje acabou. Renova amanhã.\n\nQuer ilimitado? ${OPCOES}.`,
    `3 por hoje, encerrou. Se precisar agora: ${OPCOES}.`,
  ],

  predate_reminder_day_before: [
    `Amanhã é o encontro 🗓️\n\nConfirma o local, define a roupa hoje à noite (casual-arrumado), barba e perfume sutil.\n\nChega 5 min antes — não 30. Você tá pronto.\n\n_Manda PARAR se não quiser lembretes._`,
    `Amanhã é o dia. Confirma o endereço, cuida dos detalhes: roupa, barba, perfume leve. Não precisa ser perfeito — só presente.\n\n_PARAR pra cancelar lembretes._`,
  ],

  predate_reminder_2h_before: [
    `Daqui a pouco é o encontro.\n\nSai com calma, chega 5 min antes. Guarda o celular quando ela chegar, foca nela.\n\nVai bem.`,
    `Chegando a hora. Guarda o celular quando ela aparecer, foca no momento.\n\nVai nessa.`,
  ],

  predate_debrief: [
    `E aí, como foi o encontro? Me conta — pode ser curto 👇`,
    `Como foi? Ela foi bem, esfriou, rolou algo? Me conta aqui.`,
  ],
};

// Mensagem especial de outcome do Coach de Transição (não tem variações — é pessoal)
const TRANSITION_COACH_OUTCOME_MESSAGE =
  `Semana passada te ajudei a chamar ela pra sair.\n\n` +
  `Como foi? Ela topou? Me conta — pode ser curto 👇`;

function getMessage(triggerType) {
  if (triggerType === 'transition_coach_outcome') {
    return TRANSITION_COACH_OUTCOME_MESSAGE;
  }
  const options = MESSAGES[triggerType];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { getMessage };
