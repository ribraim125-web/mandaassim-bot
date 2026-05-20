const MESSAGES = {
  day1_inactive: [
    `Oi! Tá rolando alguma conversa? Me manda ela aqui que eu te ajudo a responder 👀`,
    `E aí, sumiu! Tem alguma menina no radar? Me manda a conversa que eu ajudo 😏`,
    `Oi! Tô por aqui caso precise de ajuda com alguma conversa 👋`,
  ],

  limit_drop_10: [
    `A partir de hoje você tem 10 mensagens por dia. Me manda as conversas mais importantes que a gente foca no que vale 🎯`,
    `Daqui pra frente são 10 mensagens por dia — mais do que suficiente pra avançar com quem importa. Me manda o que tá rolando 🔥`,
  ],

  limit_exhausted_10: [
    `Por hoje é isso! Suas mensagens renovam amanhã cedo.\n\nSe quiser continuar agora sem limite, digita *mensal* 👇`,
    `Acabou as mensagens de hoje! Renova amanhã.\n\nOu continua agora sem parar — digita *mensal* 👇`,
  ],

  limit_drop_3: [
    `Suas mensagens diárias mudaram para 3 por dia. Pra não perder o ritmo com ela, digita *mensal* pra ter ilimitado 👇`,
    `A partir de hoje são 3 mensagens por dia. Usa com inteligência — ou digita *mensal* pra ter ilimitado 🚀`,
  ],

  limit_exhausted_3: [
    `Você tá indo bem nas conversas. Não para agora por causa de limite 🔥\n\nDigita *mensal* pra continuar.`,
    `Acabou por hoje... mas você tava indo bem! Digita *mensal* pra continuar sem limite 👇`,
    `Não deixa a conversa esfriar por causa de limite. Digita *mensal* e continua agora 💬`,
  ],
};

function getMessage(triggerType) {
  const options = MESSAGES[triggerType];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

module.exports = { getMessage };
