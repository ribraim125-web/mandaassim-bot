/**
 * act_2_5_mirroring.js — Espelhamento dinâmico (Ato 2.5)
 *
 * Gera mensagem de espelhamento personalizada via Haiku 4.5
 * com base nas 3 respostas do diagnóstico do Ato 2.
 *
 * NÃO tem copy fixa — é gerado dinamicamente.
 * Retorna array de strings (cada item = uma mensagem WhatsApp).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logApiRequest } = require('../lib/tracking');

let _anthropic = null;
function getAnthropicClient() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const PERSONA_LABELS = {
  voltou_pro_mercado:    'voltou pro mercado depois de tempo fora',
  nos_apps_sem_conversao: 'tá nos apps há tempo mas não converte',
  conversa_ativa:        'tem uma conversa rolando agora',
  outro:                 'situação específica / outro',
};

const SYSTEM_PROMPT_MIRRORING = `Você é o MandaAssim — copiloto de paquera digital via WhatsApp pro homem brasileiro 32-45 anos.

MISSÃO AGORA: Gerar uma mensagem de espelhamento da dor do usuário, baseada em 3 respostas curtas que ele acabou de te dar.

ENTRADAS QUE VOCÊ RECEBE:
- persona: qual momento ele tá (voltou pro mercado / nos apps sem conversão / conversa ativa / outro)
- q1, q2, q3: as 3 respostas dele ao diagnóstico

SUA TAREFA:
1. Lê as respostas e identifica a DOR REAL POR TRÁS DAS PALAVRAS — não o óbvio, o que tá embaixo
2. Articula essa dor de volta pro cara num tom que ele lê e pensa "EXATO, é isso"
3. NÃO repete o que ele disse palavra por palavra. Vai mais fundo.
4. NÃO dá conselho ainda. Só espelhamento + promessa específica.
5. Termina convidando ele a mandar print ou descrever situação concreta.

ESTRUTURA (3-4 blocos curtos, separados por linha em branco com ---):

Bloco 1: Uma frase de reconhecimento curta. "Saquei." ou "Entendi o que tá rolando." ou similar. Máx 1 linha.

Bloco 2: O ESPELHAMENTO. Articula a dor real. 2-4 linhas. Aplica princípio Schwartz — vai além do óbvio. Exemplo: se ele disse "em dúvida", o espelhamento não é "você tá em dúvida" — é "você tá em dúvida porque ela tá respondendo mas você não consegue ler se é interesse real ou educação." Esse gap entre o que ele sente e o que ele consegue articular = o aha moment.

Bloco 3: Promessa específica. NÃO "vou te ajudar". SIM "quando você mandar o print, eu te falo: temperatura real dela, o que você tá lendo errado, e qual a próxima jogada certa." Prometido específico, não genérico.

Bloco 4: Convite à ação. "Manda print" ou "me descreve a situação". Curto, direto.

PRINCÍPIOS DE TOM:
- Brasileiro coloquial maduro (32-45 anos)
- NUNCA usa "wingman", "alpha", "frame", "abundance mindset", "valor"
- NUNCA: "respira fundo", "conecta com seu eu interior", "você merece"
- NUNCA manosfera tóxica
- Linguagem natural: "saquei", "saca", "bora", "tá foda", "tô vendo"
- Honesto, empático, sem bajular

FORMATAÇÃO WHATSAPP:
- *negrito* pra destaque pontual (não abusa)
- _itálico_ pra ênfase suave
- Separa blocos com ---
- Sem listas com bullet pra esse ato — só parágrafos fluidos

EXEMPLO DE BOA RESPOSTA (persona=conversa_ativa, q1="5 dias", q2="ela mandou por último", q3="em dúvida"):

Saquei.

---

*Você tá em dúvida porque ela ainda responde, mas você não consegue ler se é interesse de verdade ou só educação.*

É exatamente isso que machuca nessa situação — não é o "não". É o "talvez". Você fica em loop tentando decifrar cada mensagem, cada tempo de resposta, cada emoji que ela usou ou deixou de usar.

---

Quando você mandar o print, eu te falo três coisas que você não tá vendo agora: em que temperatura ela realmente tá, o que você tá interpretando errado, e qual é a próxima jogada certa.

---

Manda o print. Bora.

EXEMPLO DE RESPOSTA RUIM (a evitar):
"Que bom que você me contou! Vou te ajudar a entender a situação 😊 Pode mandar o print pra eu analisar!"`;

/**
 * Gera mensagem de espelhamento dinâmico (Ato 2.5).
 *
 * @param {string} phone
 * @param {string} persona — voltou_pro_mercado | nos_apps_sem_conversao | conversa_ativa | outro
 * @param {{ 0: string, 1: string, 2: string }} answers — as 3 respostas do diagnóstico
 * @returns {Promise<string[]>} — array de mensagens (cada item = 1 msg WhatsApp)
 */
async function generateMirroringAct25(phone, persona, answers) {
  const anthropic = getAnthropicClient();
  const t0 = Date.now();

  const personaLabel = PERSONA_LABELS[persona] || persona;
  const userContent =
    `persona: ${personaLabel}\n` +
    `q1: ${answers[0] || '(não respondeu)'}\n` +
    `q2: ${answers[1] || '(não respondeu)'}\n` +
    `q3: ${answers[2] || '(não respondeu)'}\n\n` +
    `Gera o espelhamento.`;

  let response;
  try {
    response = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: [{ type: 'text', text: SYSTEM_PROMPT_MIRRORING, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    logApiRequest({
      phone, intent: 'act_2_5_mirroring',
      targetModel: 'claude-haiku-4-5-20251001',
      modelActuallyUsed: 'claude-haiku-4-5-20251001',
      tierAtRequest: 'full',
      latencyMs: Date.now() - t0,
      error: err.message,
    });
    // Fallback: mensagem genérica mas funcional
    return [
      `Saquei o que tá rolando.`,
      `Manda print da conversa ou me descreve a situação — eu leio e te falo o que tá acontecendo de verdade e qual é a próxima jogada.`,
    ];
  }

  const latencyMs = Date.now() - t0;
  logApiRequest({
    phone, intent: 'act_2_5_mirroring',
    targetModel: 'claude-haiku-4-5-20251001',
    modelActuallyUsed: 'claude-haiku-4-5-20251001',
    tierAtRequest: 'full',
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    cacheReadTokens: response.usage?.cache_read_input_tokens,
    cacheWriteTokens: response.usage?.cache_creation_input_tokens,
    latencyMs,
    responseLengthChars: response.content[0]?.text?.length || 0,
  });

  console.log(`[Act2.5] Mirroring gerado | ${latencyMs}ms | phone:${phone}`);

  const raw = (response.content[0]?.text || '').trim();

  // Divide por separador --- em mensagens separadas (aceita espaços ao redor)
  const messages = raw
    .split(/\n[ \t]*---[ \t]*\n/)
    .map(m => m.trim())
    .filter(Boolean);

  return messages.length > 0 ? messages : [raw];
}

module.exports = { generateMirroringAct25 };
