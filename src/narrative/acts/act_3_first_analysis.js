/**
 * Ato 3 — Narrativa na primeira análise
 *
 * NÃO é uma mensagem proativa — é um sufixo adicionado à resposta da
 * PRIMEIRA análise de conversa ou print do usuário.
 *
 * Dispara inline: chamado de dentro do fluxo de resposta.
 * Marcar evento: first_response_suggestion_received
 *
 * EDITAR COPY: edite o campo `suffix` abaixo.
 */

module.exports = {
  id:          'act_3_first_analysis',
  description: 'Sufixo narrativo na primeira análise recebida pelo usuário',
  featureFlag: 'ENABLE_ACT_3',
  inline:      true,
  triggerEvent: 'first_analysis_delivered',
  cooldownDays: 0, // 1x por lifetime, não repete

  // Sufixo adicionado como mensagem separada APÓS a análise principal
  // Editar aqui sem tocar em código
  suffix:
    `📍 _Isso que acabei de fazer é Leitura de Intenção._\n\n` +
    `_Toda conversa que você me trouxer eu leio o que tá rolando primeiro — ` +
    `depois sugiro o que falar. É assim que funciona._`,
};
