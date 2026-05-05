/**
 * Ato 2 — Introdução do mecanismo único (Leitura de Intenção)
 *
 * Dispara < 5min após o usuário responder o Ato 1.
 * Variante selecionada com base na persona escolhida no Ato 1.
 *
 * Após enviar a mensagem, o bot aguarda 3 respostas diagnósticas
 * (gerenciadas via diagnosticState em index.js) e então dispara o
 * Ato 2.5 (espelhamento dinâmico via Haiku).
 *
 * EDITAR COPY: edite os campos `message` e `diagnosticQuestions` abaixo.
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
        `Entendi. Voltou pro mercado depois de tempo fora — provavelmente os apps mudaram, as regras parecem outras.\n\n` +
        `Aqui funciona diferente de qualquer IA. ChatGPT te dá uma resposta. Eu faço *Leitura de Intenção* primeiro — ` +
        `leio o que ela sinalizou, o que tá rolando de fato, antes de sugerir o que falar.\n\n` +
        `Mas antes de qualquer análise, preciso entender sua situação. Três perguntas rápidas:\n\n` +
        `*1.* Faz quanto tempo você tá fora do mercado, mais ou menos?`,
    },
    nos_apps_sem_conversao: {
      variant: 'A',
      message:
        `Claro. Tá nos apps mas as conversas morrem antes de ir a lugar algum — clássico.\n\n` +
        `Eu funciono diferente. ChatGPT te dá uma resposta. Eu faço *Leitura de Intenção* primeiro — ` +
        `entendo o que ela quis dizer com aquela mensagem antes de sugerir o que responder.\n\n` +
        `Mas antes de qualquer análise, preciso entender sua situação. Três perguntas rápidas:\n\n` +
        `*1.* Faz quanto tempo você tá nos apps sem converter uma conversa num encontro?`,
    },
    conversa_ativa: {
      variant: 'A',
      message:
        `Beleza. Tá no momento crítico — conversa rolando agora.\n\n` +
        `Aqui funciona diferente de qualquer ChatGPT. Eu faço *Leitura de Intenção* primeiro — ` +
        `leio o que ela quis dizer e o que tá rolando antes de sugerir o que falar.\n\n` +
        `Três perguntas rápidas pra eu entender a situação:\n\n` +
        `*1.* Faz quanto tempo essa conversa tá rolando?`,
    },
    outro: {
      variant: 'A',
      message:
        `Entendido. Pra eu entender sua situação e te ajudar direito, três perguntas rápidas:\n\n` +
        `*1.* Me conta: o que tá rolando especificamente — app, conversa que esfriou, ou outra coisa?`,
    },
  },

  // Perguntas de diagnóstico por persona (Q2 e Q3 — Q1 já está na `message` acima)
  // diagnosticQuestions[persona][0] = Q2, [1] = Q3
  diagnosticQuestions: {
    voltou_pro_mercado: [
      `*2.* Maior dificuldade agora — entender como os apps funcionam, saber o que falar, ou ler o interesse dela?`,
      `*3.* Você tem alguma conversa rolando hoje ou tá começando do zero?`,
    ],
    nos_apps_sem_conversao: [
      `*2.* Quando a conversa esfria, o que geralmente acontece — você não sabe o que falar, ela para de responder, ou vira monossílabo?`,
      `*3.* Tem alguma conversa rolando agora ou tá travado antes disso?`,
    ],
    conversa_ativa: [
      `*2.* Quem mandou a última mensagem — você ou ela?`,
      `*3.* Como você tá lendo a situação agora — ela parece interessada, fria, ou você simplesmente não consegue ler?`,
    ],
    outro: [
      `*2.* O que você tá tentando agora — apps, reconquista, ou resolver uma situação que complicou?`,
      `*3.* Qual é o maior bloqueio: não sabe como agir, não consegue ler o interesse dela, ou tá travado na indecisão?`,
    ],
  },
};
