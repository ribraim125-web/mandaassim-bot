const OPCOES = `*mensal* (R$29,90) ou *anual* (R$299)`;

const MESSAGES = {
  day1_inactive: [
    `Tem alguma conversa rolando? Manda o print ou descreve a situação — leio o contexto e te dou as opções.`,
    `E aí, apareceu. Alguma conversa pra resolver? Manda aqui.`,
    `Tô por aqui. Se tiver alguma conversa travada ou situação pra entender, manda.`,
  ],

  limit_drop_10: [
    `A partir de hoje são 10 análises por dia. Usa nas conversas que importam.`,
    `10 análises por dia daqui pra frente. Manda o que tiver rolando.`,
  ],

  limit_exhausted_10: [
    `Deu 10 por hoje. Renova amanhã.\n\nSe não der pra esperar: ${OPCOES}.`,
    `Por hoje acabou. Amanhã cedo tem mais 10.\n\nQuer ilimitado? ${OPCOES}.`,
  ],

  limit_drop_3: [
    `A partir de hoje são 3 análises por dia.\n\nSe quiser mais: ${OPCOES}.`,
    `Mudou pra 3 análises por dia. Usa nas situações que realmente precisam.\n\nQuer ilimitado? ${OPCOES}.`,
  ],

  limit_exhausted_3: [
    `Deu 3 por hoje. Amanhã tem mais 3.\n\nSe a conversa tá no ponto e não dá pra esperar: ${OPCOES}.`,
    `Por hoje acabou. Renova amanhã.\n\nQuer ilimitado? ${OPCOES}.`,
    `3 por hoje, acabou. Se precisar continuar agora: ${OPCOES}.`,
  ],

  predate_reminder_day_before: [
    `Amanhã é o encontro 🗓️\n\nConfirma o local no Maps, define a roupa hoje à noite (casual-arrumado), barba e perfume sutil.\n\nSai com 15 min de folga, chega 5 min antes — não 30 min. Você tá pronto 💪\n\n_Manda PARAR se não quiser mais lembretes._`,
    `Amanhã é o dia. Confirma o endereço, cuida dos detalhes: roupa, barba, perfume sutil. Não precisa ser perfeito — só presente.\n\n_Manda PARAR pra cancelar lembretes._`,
  ],

  predate_reminder_2h_before: [
    `Daqui a pouco é o encontro 👊\n\nSem pressa — sai com calma, chega 5 min antes. Guarda o celular quando ela chegar, foca nela.\n\nVai bem.`,
    `Chegando a hora. Você não precisa ser perfeito, precisa ser você. Guarda o celular quando ela aparecer, foca no momento.\n\nVai nessa 💪`,
  ],

  predate_debrief: [
    `E aí, como foi o encontro? Me conta — pode ser curto 👇`,
    `Como foi? Ela foi simpática, rolou química, esfriou? Me conta aqui.`,
  ],
};

// Mensagem especial de outcome do Coach de Transição (não tem variações — é pessoal)
const TRANSITION_COACH_OUTCOME_MESSAGE =
  `Ei, lembra que te ajudei a chamar ela pra sair semana passada?\n\n` +
  `Como foi? Ela topou? Me conta aqui — pode ser curto, só quero saber o resultado 👇`;

function getMessage(triggerType) {
  if (triggerType === 'transition_coach_outcome') {
    return TRANSITION_COACH_OUTCOME_MESSAGE;
  }
  const options = MESSAGES[triggerType];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { getMessage };
