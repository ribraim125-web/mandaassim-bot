const OPCOES = `*mensal* (R$29,90) ou *anual* (R$299)`;
const OPCOES_PRO = `*pro* (R$79,90/mês) ou *anual pro* (R$799/ano)`;

const MESSAGES = {
  day1_inactive: [
    `Aquela situação que a gente tava destrinchando — chegou a mandar uma das opções? Como ela respondeu?`,
    `Curiosidade: você chegou a usar alguma das opções que te dei? Me conta como foi — mesmo que tenha dado errado, eu calibro melhor na próxima.`,
    `Separei uma coisa que pode te ajudar: a maioria dos caras trava porque trata WhatsApp como questionário. Tenta comentar em vez de perguntar — comentário gera resposta emocional, pergunta gera resposta robótica. Manda um print quando travar que eu mostro na prática.`,
  ],

  limit_drop_10: [
    `A partir de hoje são 10 análises por dia. Usa nas que importam.`,
    `Daqui pra frente: 10 análises por dia. Manda o que tiver rolando de mais importante.`,
  ],

  limit_exhausted_10: [
    `Deu 10 por hoje. Amanhã cedo renova.\n\nSe não der pra esperar: ${OPCOES}`,
    `Por hoje, fechou. Amanhã tem mais 10.\n\nQuer ilimitado? ${OPCOES}`,
  ],

  limit_drop_3: [
    `A partir de hoje são 3 análises por dia.\n\nSe quiser mais: ${OPCOES}`,
    `Trial encerrado. Agora são 3/dia. Usa nas situações que realmente precisam.\n\nQuer ilimitado? ${OPCOES}`,
  ],

  limit_exhausted_3: [
    `Deu 3 por hoje. Amanhã tem mais 3.\n\nSe não dá pra esperar: ${OPCOES}`,
    `Por hoje, fechou. Renova amanhã.\n\nQuer ilimitado? ${OPCOES}`,
    `3 por hoje, encerrou. Se precisar agora: ${OPCOES}`,
  ],

  predate_reminder_day_before: [
    `Amanhã é o encontro\n\nConfirma o local hoje. Define a roupa à noite, casual mas arrumado pro lugar. Barba feita, perfume sutil. Chega 5 min antes, não 30.\n\nTá tudo encaminhado\n\n_Pra parar os lembretes: digita PARAR_`,
    `Amanhã é o dia. Confirma o endereço, cuida dos detalhes: roupa, barba, perfume leve. Não precisa ser perfeito, só presente\n\n_PARAR pra cancelar lembretes_`,
  ],

  predate_reminder_2h_before: [
    `Daqui a pouco é o encontro\n\nSai com calma. Chega 5 min antes. Quando ela chegar, guarda o celular, foca nela\n\nVai bem`,
    `Chegando a hora. Guarda o celular quando ela aparecer, foca no momento\n\nVai nessa`,
  ],

  predate_debrief: [
    `E aí, como foi o encontro? Me conta, pode ser curto`,
    `Como foi? Ela foi bem, esfriou, rolou alguma coisa? Me conta`,
  ],

  // ── Lifecycle — Trial ────────────────────────────────────────────────────

  trial_d2_push: [
    `ó, você tá no trial, ainda tem acesso a tudo\n\ntrês features que a maioria não testa e que valem muito:\n\nler o perfil dela antes de mandar a primeira mensagem\nauditar as suas próprias fotos e bio\npreparar pra um encontro e debriefar depois\n\ntesta pelo menos uma hoje que vale a pena ver na prática`,
  ],

  // ── Lifecycle — Pós-pagamento ────────────────────────────────────────────

  lifecycle_d7_tour: [
    `você tá há uma semana aqui, cada análise vai ficando mais afinada\n\nqueria te lembrar que tem coisas que talvez você nem testou ainda:\n\n🔍 análise de conversa completa\n📸 auditoria do seu perfil (fotos + bio)\n👤 leitura do perfil dela antes de mandar a primeira mensagem\n🗓️ preparação pra encontro + conversa depois sobre como foi\n\nmanda *menu* pra ver tudo, ou me pede direto que eu te mostro`,
  ],

  lifecycle_d14_checkin: [
    `e aí, como tá indo\n\nvoltou pra balada, pro tinder, pro que for\n\nsem pressão de responder, só queria saber se as conversas tão fluindo melhor desde que você começou aqui`,
  ],

  lifecycle_d30_nps: [
    `um mês juntos, valeu por chegar até aqui\n\nqueria te perguntar uma coisa rápida\n\nde 0 a 10, o quanto você indicaria o MandaAssim pra um amigo seu que tá voltando pro mercado igual você voltou\n\nsó o número, sem precisar justificar`,
  ],

  lifecycle_d60_anual: [
    `dois meses juntos, fechado\n\nquero te fazer uma oferta que só vale pra quem tá há mais de 60 dias aqui\n\n*Parceiro Pro anual* por *R$799* (sai R$66/mês, contra R$79,90)\ndois meses no bolso\n\noferece válida por 7 dias\nsem cobrança automática surpresa, é só responder *anual pro* aqui que eu troco e devolvo o pro-rata do que você já pagou`,
  ],

  lifecycle_d90_loyalty: [
    `três meses, você já é da casa\n\nabri uma conversa fechada só pra quem tá há 90 dias ou mais aqui\nzero coach, zero curso, só par-a-par mesmo\n\nnão é obrigatório, mas se quiser entrar, responde *mesa* aqui`,
  ],

  // ── Pós-cancelamento ─────────────────────────────────────────────────────

  reactivation_d1: [
    `sem cobrança, prometido\n\nsó queria te dizer que se um dia você voltar a usar, é só mandar print de novo\nseus históricos antigos ficam comigo por 30 dias — se voltar dentro desse prazo, retoma exatamente de onde parou\n\nboa sorte aí fora`,
    `e aí, sumiu\n\nfaz uma semana que não trocamos figurinha. tô curioso: fechou alguém, deu ruim, ou simplesmente sem ânimo?\n\nsem resposta errada, só me conta que eu ajudo na real — ou solto sua mão pra você focar em outra coisa`,
  ],

  // ── Indicação (enviada pelo handler, não pelo worker) ────────────────────
  referral_invite: [],
};

// Mensagem especial de outcome do Coach de Transição (não tem variações — é pessoal)
const TRANSITION_COACH_OUTCOME_MESSAGE =
  `Semana passada te ajudei a chamar ela pra sair. E aí, como foi? Ela topou? Me conta, pode ser curto`;

/**
 * Retorna texto de convite de indicação com o código do usuário.
 * Chamado pelo handler inline — não pelo worker.
 */
function getReferralInviteMessage(referralCode) {
  return (
    `fico feliz com isso\n\n` +
    `eu sei que você tem amigo divorciado, separado, ou que ficou muito tempo num relacionamento que acabou e tá sem saber por onde começar\n\n` +
    `*seu código de indicação:* ${referralCode}\n\n` +
    `cada amigo seu que assinar usando esse código te dá *R$30 de desconto* na próxima mensalidade\n` +
    `e ele entra com *7 dias de Pro liberado* em vez dos 3 normais\n\n` +
    `é só mandar pra ele no zap: "olha cara, achei essa parada, tem me ajudado, usa o código ${referralCode} na hora de assinar"`
  );
}

/**
 * Retorna mensagem de pedido de feedback (NPS ≤6).
 */
function getFeedbackRequestMessage() {
  return (
    `obrigado pela honestidade, vale mais que nota alta de boca\n\n` +
    `se você puder, me manda em uma frase o que tá te frustrando aqui\n` +
    `não precisa amaciar, eu leio tudo pessoalmente\n` +
    `e se for o caso, eu cancelo e devolvo o último mês na hora`
  );
}

function getMessage(triggerType) {
  if (triggerType === 'transition_coach_outcome') {
    return TRANSITION_COACH_OUTCOME_MESSAGE;
  }
  const options = MESSAGES[triggerType];
  if (!options || options.length === 0) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { getMessage, getReferralInviteMessage, getFeedbackRequestMessage };
