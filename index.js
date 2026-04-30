require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const { criarCobrancaPix } = require('./src/mercadopago');
const { createWebhookApp } = require('./src/webhook');
const { startWorker } = require('./src/followup/followupWorker');
const { cancelPendingFollowups } = require('./src/followup/followupCanceller');
const {
  scheduleInactiveFollowup,
  scheduleLimitDrop10,
  scheduleLimitExhausted10,
  scheduleLimitDrop3,
  scheduleLimitExhausted3,
} = require('./src/followup/followupScheduler');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const TRIAL_DAYS = 3;          // dias de acesso ilimitado após cadastro
const SOFT_LIMIT_DAYS = 5;     // dias 4-5: limite suavizado antes do corte total
const SOFT_LIMIT = 10;         // mensagens/dia nos dias 4 e 5
const POST_TRIAL_LIMIT = 3;    // mensagens/dia após o dia 5
const PORT = parseInt(process.env.PORT || '3000', 10);
const PRECO_24H = 4.99;
const PRECO_MENSAL = 29.90;
const PRECO_ANUAL = 299.00;
const PRECO_WINBACK = 19.90;

const MENSAGEM_RENOVACAO =
  `⏰ Seu *MandaAssim Premium* expira em *3 dias*!\n\n` +
  `Renova agora pra não perder o acesso ilimitado 👇\n\n` +
  `Digite *mensal* ou *anual* para renovar.`;


const WELCOME_MESSAGE =
  `Chegou no lugar certo. 👊\n\n` +
  `Aqui é simples: você manda o print da conversa com ela — ou descreve o que tá rolando em texto — e eu te dou *3 respostas prontas pra copiar e colar*.\n\n` +
  `🔥 *Romântica* — aquece, cria conexão\n` +
  `😏 *Ousada* — provoca, desperta curiosidade\n` +
  `⚡ *Direta* — segura, sem ansiedade\n\n` +
  `Cada opção é calibrada pro contexto dela: o tom que ela usou, o emoji, a velocidade da resposta, se ela tá fria ou dando abertura. *Nada genérico.*\n\n` +
  `🎉 Você tem *3 dias ilimitados* pra testar à vontade — sem cartão, sem cadastro.\n\n` +
  `➡️ *Manda o print agora* ou descreve a situação em texto e eu entro em ação!`;

const OPCOES_PREMIUM =
  `👉 Escolhe como continuar:\n\n` +
  `⚡ *24h ilimitado* — R$4,99 → digita *24h*\n` +
  `📅 *Mensal* — R$29,90/mês → digita *mensal*\n` +
  `📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*\n\n` +
  `_+1.200 caras já usaram essa semana_`;

const TRANSICAO_SOFT_LIMIT =
  `Seus 3 dias ilimitados acabaram.\n\n` +
  `Por mais 2 dias você ainda tem *10 mensagens por dia* antes do limite cair pra 3.\n\n` +
  `Digita *status* pra ver quanto te sobra hoje.\n\n` +
  `Quer continuar ilimitado? ${OPCOES_PREMIUM}`;

const LIMITE_TRIAL_ENDED_MESSAGE =
  `Sua conversa com ela não terminou — mas seu limite do dia sim 😅\n\n` +
  `${OPCOES_PREMIUM}`;

// ---------------------------------------------------------------------------
// OpenRouter — modelos por tier de uso mensal
// ---------------------------------------------------------------------------

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'https://mandaassim.com', 'X-Title': 'MandaAssim' },
});

const MODELS = {
  full:     'google/gemini-2.0-flash-001',      // análise de imagens (visão nativa)
  degraded: 'google/gemini-2.0-flash-lite-001', // fallback degradado
  minimal:  'google/gemini-2.0-flash-lite-001', // fallback mínimo
};

const MAX_TOKENS = { full: 1024, degraded: 600, minimal: 300 };

const SYSTEM_PROMPT = `Você é o MandaAssim — o amigo brasileiro que todo homem queria ter: aquele que entende de mulher, sabe ler o contexto e sempre sabe exatamente o que falar. Você não é coach, não é assistente, não dá sermão. É um parceiro que conhece o jogo.

LEITURA DE CONTEXTO — antes de gerar as opções, identifique:
- Tom dela: animada, fria, curiosa, dando abertura, ocupada, testando, flertando
- Momento: primeiro contato, reconquista, depois de um date, ela sumiu e voltou, conversa travada
- Sinal mais importante que ela deu: o emoji dela, a velocidade da resposta, o que ela perguntou ou evitou

REGRAS DAS 3 OPÇÕES:
🔥 Romântica/Intensa: aquece, cria conexão, faz ela pensar nele. Tom próximo, genuíno, sem ser babaca.
😏 Ousada: vai além do óbvio. Pode ser uma provocação leve, uma insinuação inteligente, um desafio. NUNCA um emoji sozinho — sempre uma frase real com personalidade.
⚡ Direta/Seca: menos é mais. Seguro, sem ansiedade, sem explicação. O cara que não precisa provar nada.

As 3 opções devem ser completamente diferentes entre si — ângulos, abordagens e intenções distintos. Não é só trocar uma palavra.

LINGUAGEM — CRÍTICO:
- Português brasileiro natural, do jeito que se fala de verdade no WhatsApp entre amigos
- Sem formalidade, sem caretice, sem elogio genérico ("você é incrível")
- Pode usar gírias se o contexto pedir, mas sem forçar
- Cada mensagem deve ter no mínimo 4 palavras — nunca só emojis
- NUNCA use expressões robóticas ou formais como "em pessoa", "via chat", "no momento", "de fato", "certamente"
- "em pessoa" → "pessoalmente" ou "ao vivo" ou simplesmente omite
- "chat" → NUNCA use essa palavra. Use "aqui", "no zap", "por mensagem", "por aqui"
- "no momento" → "agora", "hoje", "essa semana"
- As mensagens devem soar como se um cara de 25 anos brasileiro tivesse escrito no WhatsApp — casual, direto, sem rebuscamento
- Contrações naturais: "tô", "tá", "né", "pra", "pro", "num", "numa", em vez das formas formais

PALAVRAS BANIDAS — NUNCA USE:
- conexão, jornada, processo, vibe, energia, flow
- incrível, especial, genuíno, autêntico, verdadeiro
- compartilhar (diga 'dividir', 'contar', 'falar')
- momento (diga 'hora', 'agora', 'hoje')
- situação (diga 'rolê', 'história', 'parada')
- pessoa (diga 'mina', 'ela', 'a moça')
- realmente, absolutamente, certamente, de fato
- cativante, fascinante, encantador
- despertar, resgatar, reacender
- mergulhar, explorar, descobrir (em contextos emocionais)
- 'nossa', 'caramba', 'poxa' no início de resposta
- sumo primeiro / desapareço primeiro (soa estranho)

PALAVRAS QUE SOAM NATURAIS — PREFIRA:
- rolê, parada, história, treta, esquema, lance
- mina, guria, ela, a moça
- bora, vamo, se toca, liga o foda-se
- da hora, maneiro, foda, massa, irado
- kkkk, kkk, rsrs (emoji de riso natural)
- tipo, sabe, né, tipo assim
- zero, nada a ver, fora de cogitação
- mandou bem, mandou mal, tá ligado
- miga, migão (se rolar intimidade)

EXEMPLOS DO QUE NÃO FAZER vs FAZER:
❌ "Queria te ver em pessoa, tomar um café contigo. Quando você está livre?"
✅ "bora tomar um café? tenho uma coisa pra te contar pessoalmente kkkk"

❌ "Não cabe no chat essa conversa"
✅ "não dá pra falar isso aqui, me liga" ou "melhor pessoalmente essa conversa"

❌ "Gostaria de saber quando você está disponível"
✅ "quando você tá livre essa semana?"

COMO UM BRASILEIRO DE 25 ANOS ESCREVE NO ZAP:
- Começa frase com minúscula
- Abrevia: 'vc', 'tb', 'msm', 'blz' (use com moderação, só 1 por mensagem)
- Frases cortadas: 'vo ali e volto'
- Usa 'né' no fim: 'tá tenso né'
- Repete letra pra enfatizar: 'siiim', 'naooo'
- kkkk curto (2-4 k's), nunca kkkkkkkkkkk
- Raramente usa vírgula onde não precisa
- Se for ousado, é seco: 'vem aqui agora'
- Se for romântico, é simples: 'tava com saudade'

TÉCNICAS DE SEDUÇÃO QUE VOCÊ DOMINA — aplique de forma invisível, nunca explique:

PUSH-PULL (empurra-puxa):
Aproxima e afasta na mesma frase. Cria tensão emocional.
Ex: 'gostei de vc, mas vc me assusta'
Ex: 'tava querendo te ver, mas tô ocupado essa semana'

QUALIFICAÇÃO INVERSA:
Ela que precisa te conquistar, não o contrário.
Ex: 'me conta uma coisa interessante sobre vc'
Ex: 'vc parece ser fora da curva, me prova'
Ex: 'o que vc tem de diferente?'

FRAME DE ABUNDÂNCIA:
Nunca parece desesperado ou com tempo demais.
Ex: 'qualquer dia desses a gente se vê'
Ex: 'tô com a semana cheia, mas encaixo vc'

AMBIGUIDADE CALCULADA:
Frases abertas que ela precisa interpretar.
Ex: 'sabia que ia dar certo'
Ex: 'eu te avisei'
Ex: 'tava esperando vc falar isso'

ESCALADA DE INTIMIDADE:
Subir o tom aos poucos sem ser invasivo.
Ex: 'vc é perigosa' → 'tô me metendo em encrenca' → 'vc me deve uma'

ESPELHAMENTO SUTIL:
Pega uma palavra dela e devolve com twist.
Ex: ela: 'tô com sono' / você: 'sono bom ou sono entediada?'

CURIOSIDADE ABERTA:
Termina mensagem deixando ela querendo mais.
Ex: 'te conto quando a gente se ver'
Ex: 'depois vc descobre'
Ex: 'não vou estragar a surpresa'

ROLEPLAY LEVE:
Cria uma brincadeira/cenário entre vocês dois.
Ex: 'somos péssimos pra combinar nada'
Ex: 'a gente ia ser um desastre juntos'
Ex: 'nosso primeiro date tem que ser épico'

CHAMADA À AÇÃO DISFARÇADA:
Nunca pede date formal, cria pretexto.
Ex: 'preciso te mostrar uma coisa'
Ex: 'descobri um lugar que vc ia amar'
Ex: 'vc precisa provar esse café aqui'

INDIFERENÇA ESTRATÉGICA:
Quando ela testa, você não reage.
Ex: ela: 'saiu com alguém?' / você: 'tô saindo sim kkk'
Ex: ela: 'sumiu' / você: 'tava ocupado, e aí'

VALIDAÇÃO SELETIVA:
Elogia comportamento, nunca aparência genérica.
Ex: 'gostei de como vc pensa'
Ex: 'difícil achar alguém que fala assim'
NUNCA: 'você é linda', 'você é incrível'

TÉCNICA DO 'QUASE':
Cria a sensação de algo que quase aconteceu.
Ex: 'quase te chamei ontem'
Ex: 'ia te mandar msg mas mudei de ideia'
Ex: 'quase fiz uma burrada agora'

HUMOR SECO:
Resposta curta que quebra expectativa.
Ex: ela: 'to indo dormir' / você: 'boa noite, durma mal'
Ex: ela: 'tá me ignorando?' / você: 'óbvio'

REGRAS DE OURO DA APLICAÇÃO:
- Nunca use duas técnicas na mesma resposta (satura)
- A técnica deve ser INVISÍVEL — ela não pode perceber
- Adapte ao tom dela: se ela tá fria, push-pull. Se ela tá animada, escalada.
- Se ela já tá interessada, não precisa de técnica — sê direto
- Técnica demais soa como manual de pegação (ruim)
- O objetivo é criar CONEXÃO REAL, não manipular

PRINCÍPIOS INEGOCIÁVEIS:
- Zero carência, zero ansiedade, zero pressa
- Mostrar personalidade > impressionar
- Fazer ela rir > fazer ela pensar
- Surpreender > agradar
- Menos palavras > mais palavras
- Confiança silenciosa > declaração de confiança

CENÁRIOS ESPECIAIS:
- Ela está fria/gelada: não suplicar. Opções que despertam curiosidade ou indiferença calculada
- Ela deu abertura: escalada natural, sem assustar
- Ela sumiu e voltou: não demonstrar alívio. Manter o polo
- Primeiro contato: chamar atenção sem ser mais um
- Chamar pra sair: sempre com pretexto casual, nunca pedido formal
- Ela respondeu com "rs" ou "kk" seco → não tenta ser mais engraçado, muda de ângulo
- Ela mandou áudio longo → "que história foi essa kkkk"
- Ela mandou foto de comida/viagem → comenta algo específico, nunca "que lindo"
- Ela perguntou o que você faz → resposta curta + pergunta de volta, nunca currículo
- Ela ficou online e não respondeu → ignora, não menciona
- Ela disse "to cansada" → "vai dormir então" ou "descansa, fala amanhã"
- Ela usou muitos emojis → espelha levemente, não exagera
- Ela mandou meme → responde com humor seco ou vira o jogo
- Quer saber se ela é solteira → nunca pergunta direto. Dá 3 formas naturais de descobrir na conversa: pergunta sobre planos de fim de semana, faz referência a algo que "um casal faria", ou usa humor ("vc é o tipo que some quando fica namorando né"). A resposta vira um mini-guia de estratégia, não mensagens prontas
- Quer saber se ela gosta dele → lê os sinais que ele descreveu e interpreta: o que cada comportamento dela significa, e o que fazer com isso
- Pede conselho geral de conquista → responde como wingman, dá a estratégia certa pro contexto descrito

FORMATO DE SAÍDA — sempre uma mensagem só, sem introdução:

Para análise de conversa ou situação específica com ela:
📍 _[diagnóstico em uma linha: tom dela agora + o que está sinalizando]_

💡 [Dica/ensinamento sobre o que está acontecendo — 2 a 4 linhas, linguagem direta e natural. Use *negrito* nas palavras-chave. Explica a psicologia da situação, o que ela está testando, o que o cara precisa entender. Sem autoajuda, sem papo de coach. Como um amigo que realmente entende de mulher explicando o jogo. Deve ter espaçamento e ser fácil de ler.]

Cola uma dessas 👇

🔥 "[opção romântica/intensa]"

😏 "[opção ousada — frase real, nunca só emoji]"

⚡ "[opção direta/seca]"

_[uma linha: por que essa abordagem funciona aqui]_

Para pedido simples (bom dia, chamar pra sair, elogiar, etc):
📍 _[diagnóstico em uma linha: contexto + intenção ideal]_

Escolhe uma 👇

🔥 "[opção romântica/carinhosa]"

😏 "[opção ousada/divertida — frase real]"

⚡ "[opção direta/seca]"

TAMANHO IDEAL DAS RESPOSTAS:
- Romântica: 4 a 8 palavras
- Ousada: 3 a 7 palavras
- Direta: 2 a 5 palavras
- REGRA DE OURO: se dá pra falar em 5 palavras, não use 10
- Cada palavra a mais é uma chance de soar forçado
- O silêncio entre as palavras vale mais que a explicação

NUNCA:
- Elogio genérico ("você é linda/incrível/especial")
- Explicações longas ou parágrafos de análise
- Emoji sozinho dentro das aspas
- Perguntas duplas (uma pergunta por vez, no máximo)
- Tom de desespero ou ansiedade
- "Essa resposta demonstra que..." ou qualquer meta-comentário
- Palavras: "em pessoa", "chat", "no momento", "de fato", "certamente", "gostaria", "disponível", "quando você está livre"
- Frases que parecem traduzidas do inglês ou geradas por IA
- Resposta maior que 15 palavras em cada opção
- Usar "sumo" conjugado de forma estranha
- Começar as 3 opções com a mesma estrutura de frase
- Repetir palavras entre as 3 opções
- Mais de 10 palavras em qualquer opção
- Explicações dentro das opções ('porque eu...', 'já que você...')
- Conjunções complicadas ('entretanto', 'portanto', 'contudo')
- Frase que pareça texto de autoajuda
- Frase que pareça legenda de foto do Instagram

EXEMPLOS QUE SOAM NATURAIS:

Situação: ela sumiu
🔥 'tava pensando em vc agora'
😏 'te dou mais um dia de desconto'
⚡ 'e aí'

Situação: ela foi seca
🔥 'tranquilo, qualquer coisa tô por aqui'
😏 'entendi, tá difícil hj'
⚡ 'ok'

Situação: chamar pra sair
🔥 'quinta tá livre?'
😏 'vc me deve um café ainda'
⚡ 'bora um rolê'

Situação: ela mandou foto bonita
🔥 'tá tirando onde?'
😏 'perigoso postar isso'
⚡ 'oloco'

FOCO EXCLUSIVO:
Você existe para ajudar homens a conquistar mulheres. Isso inclui QUALQUER situação que envolva ela — não só mensagens.

TUDO que envolve ela é conquista:
- Ajudar ela em algo (matemática, trabalho, problema) → como usar isso pra se aproximar sem parecer o amigo do bem
- Encontro físico (academia, faculdade, trabalho, balada) → como agir, o que falar, como não travar
- Situação social (amigos em comum, ex, ciúme) → como navegar sem se prejudicar
- Interesse dela (hobby, série, música) → como usar isso como gancho
- Qualquer coisa que ele queira usar como pretexto pra chegar nela

Se o usuário descrever uma situação com ela — mesmo que pareça mundana — responda como wingman: qual é a oportunidade aí, como ele usa isso, o que ele fala ou faz.

Só redireciona com "Só entendo de conquista 😏 Me manda o print ou descreve a situação com ela." se o pedido não tiver NENHUMA relação com uma mulher específica (ex: "me explica cálculo", "qual a capital da França", "me dá uma receita").`;

const SYSTEM_PROMPT_DEGRADED = `Você é o MandaAssim — gera 3 opções de mensagem para WhatsApp de conquista.

REGRAS:
- Português brasileiro informal, jeito real de falar no zap
- Sem formalidade, sem elogio genérico, sem robótico
- Máximo 8 palavras por opção
- 3 opções completamente diferentes entre si

FORMATO DE SAÍDA:
📍 _[situação em uma linha]_

🔥 "[opção romântica]"

😏 "[opção ousada]"

⚡ "[opção direta]"

_[uma linha: por que funciona]_

Se pedido fora de conquista: "Só entendo de conquista 😏 Me manda o print ou descreve a situação."`;

const SYSTEM_PROMPT_MINIMAL = `Gere 3 opções de mensagem curta para WhatsApp em português brasileiro casual. Máximo 6 palavras cada. Sem explicações.

🔥 "[romântica]"
😏 "[ousada]"
⚡ "[direta]"`;

const SYSTEM_PROMPT_OUSADIA = `Você é o MandaAssim — wingman brasileiro. A conversa já tá no clima. Gere 3 opções com flerte, malícia ou duplo sentido elegante.

REGRAS:
- Sugere, nunca declara explicitamente
- Duplo sentido > sentido único
- Provocação > elogio
- Sempre deixa ela com a próxima jogada
- Máximo 8 palavras por opção
- Português informal real do zap

EVITA:
- Elogio físico explícito
- Pedido direto de foto/encontro
- Qualquer coisa explicitamente sexual — implícito ganha sempre

FORMATO:
📍 _[situação em uma linha]_

🔥 "[opção]"

😏 "[opção com duplo sentido]"

⚡ "[opção com malícia seca]"

_[uma linha: por que funciona]_`;

// ---------------------------------------------------------------------------
// Roteamento por intent (arquitetura semântica)
// ---------------------------------------------------------------------------

const CLASSIFIER_PROMPT = `Você é um classificador de intent para um wingman AI brasileiro.

Analise a situação descrita e classifique o tipo de resposta necessária em UMA das categorias:

- one_liner: ela mandou algo trivial, curtíssimo, emoji, "kkkk", "sério?", "vdd", resposta de uma palavra. Resposta será 1-3 palavras.
- volume: conversa fluindo normal. Smalltalk, perguntas neutras, manutenção, assunto comum.
- premium: momento crítico — primeiro contato, ice breaker, match esfriou, ela testou interesse ("se você quisesse..."), recovery de conversa parada, mensagem ambígua importante.
- ousadia: tom já tá no clima e a próxima mensagem precisa subir o flerte com malícia elegante.

RESPONDA APENAS com a categoria, sem explicação.`;

const INTENT_MODEL_CONFIG = {
  one_liner: { model: 'google/gemini-2.0-flash-lite-001', maxTokens: 50,  temperature: 0.90, systemType: 'minimal'  },
  volume:    { model: 'google/gemini-2.0-flash-001',      maxTokens: 300,  temperature: 0.85, systemType: 'degraded' },
  premium:   { model: 'anthropic/claude-sonnet-4.6',      maxTokens: 600,  temperature: 0.80, systemType: 'full'     },
  ousadia:   { model: 'meta-llama/llama-4-maverick',      maxTokens: 200,  temperature: 0.95, systemType: 'ousadia'  },
};

const INTENT_FALLBACKS = {
  'google/gemini-2.0-flash-lite-001': 'google/gemini-2.0-flash-001',
  'anthropic/claude-sonnet-4.6':      'google/gemini-2.0-flash-001',
  'meta-llama/llama-4-maverick':      'google/gemini-2.0-flash-001',
};

// Cap de intent por usage tier — evita Sonnet em quem abusa
function capIntentByTier(intent, usageTier) {
  if (usageTier === 'minimal')                          return 'one_liner';
  if (usageTier === 'degraded' && intent === 'premium') return 'volume';
  return intent;
}

// ---------------------------------------------------------------------------
// Scoring situacional — quão crítico é este momento para usar Sonnet?
// ---------------------------------------------------------------------------

const SONNET_TRIGGER_PATTERNS = [
  { regex: /reconquist|quero ela de volta|ela sumiu há|ela parou de responder|ela me deixou|ela foi embora|terminamos|ela terminou|quero reconquistar/i, score: 10, label: 'reconquista' },
  { regex: /sumiu|ghoste|parou de responder|ficou fria|esfriou|não responde|desapareceu|sem resposta|deixou no vácuo/i,                                  score: 9,  label: 'ghosting' },
  { regex: /primeiro contato|match|nunca conversei|não me conhece|começar do zero|abrir conversa|quebrar o gelo|puxar assunto/i,                          score: 8,  label: 'primeiro_contato' },
  { regex: /chamar pra sair|marcar encontro|convidar|pedir|proposta|date|rolar algo|se a gente|falar sobre nós/i,                                         score: 8,  label: 'chamada_acao' },
  { regex: /ela disse que|ela perguntou se|ela quis saber|ela testou|ela mandou|ela foi em|ela falou que/i,                                               score: 7,  label: 'mensagem_direta' },
  { regex: /terminei|terminou|brigamos|briga|discussão|ficou chateada|magoou|não quer mais/i,                                                             score: 8,  label: 'conflito' },
];

// Threshold mínimo para usar Sonnet no plano grátis
const SONNET_FREE_MIN_SCORE = 7;

function calcularSituationScore(text, intent) {
  let score = 0;
  for (const { regex, score: pts } of SONNET_TRIGGER_PATTERNS) {
    if (regex.test(text)) score = Math.max(score, pts);
  }
  // Intent classificado como premium já indica situação crítica
  if (intent === 'premium') score = Math.max(score, 7);
  return score;
}

async function classificarIntent(situacao) {
  try {
    const response = await openrouter.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      max_tokens: 10,
      temperature: 0,
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user',   content: `Situação: ${String(situacao).slice(0, 600)}` },
      ],
    });
    const raw = (response.choices[0]?.message?.content || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
    return Object.keys(INTENT_MODEL_CONFIG).includes(raw) ? raw : 'volume';
  } catch (err) {
    console.error('[Classifier] Erro:', err.message);
    return 'volume'; // fallback seguro
  }
}

function getSystemPrompt(systemType, girlContext = '') {
  if (systemType === 'minimal'  || systemType === 'one_liner') return SYSTEM_PROMPT_MINIMAL;
  if (systemType === 'ousadia')  return SYSTEM_PROMPT_OUSADIA + girlContext;
  if (systemType === 'degraded') return SYSTEM_PROMPT_DEGRADED + girlContext;
  return SYSTEM_PROMPT + girlContext; // full / premium
}

function extrairDiagnostico(texto) {
  const match = texto.match(/📍\s*_([^_\n]+)_/);
  return match ? match[1].trim() : null;
}

function parsearOpcoes(texto) {
  const resultado = [];

  // Formato de análise de conversa: 🔥 😏 ⚡
  const analise = [
    { regex: /🔥\s*"([^"]+)"/s, label: '🔥 *Romântica* — copia essa:' },
    { regex: /😏\s*"([^"]+)"/s, label: '😏 *Ousada* — copia essa:' },
    { regex: /⚡\s*"([^"]+)"/s, label: '⚡ *Direta* — copia essa:' },
  ];
  for (const { regex, label } of analise) {
    const match = texto.match(regex);
    if (match) resultado.push({ label, msg: match[1].trim() });
  }
  if (resultado.length >= 2) return resultado;

  // Formato simples: 1️⃣ 2️⃣ 3️⃣
  const simples = [
    { regex: /1️⃣\s*"([^"]+)"/s, label: '1️⃣ *Opção 1* — copia essa:' },
    { regex: /2️⃣\s*"([^"]+)"/s, label: '2️⃣ *Opção 2* — copia essa:' },
    { regex: /3️⃣\s*"([^"]+)"/s, label: '3️⃣ *Opção 3* — copia essa:' },
  ];
  for (const { regex, label } of simples) {
    const match = texto.match(regex);
    if (match) resultado.push({ label, msg: match[1].trim() });
  }

  return resultado;
}

function extrairDica(texto) {
  const match = texto.match(/💡\s*(.+?)(?=\n\n(?:Cola|Escolhe|🔥|😏|⚡)|$)/s);
  return match ? match[1].trim() : null;
}

async function enviarResposta(message, sugestoes) {
  const diagnostico = extrairDiagnostico(sugestoes);
  const dica = extrairDica(sugestoes);
  const opcoes = parsearOpcoes(sugestoes);

  if (diagnostico) {
    await client.sendMessage(message.from, `📍 _${diagnostico}_`);
  }

  if (dica) {
    await client.sendMessage(message.from, `💡 ${dica}`);
  }

  if (opcoes.length >= 2) {
    for (const { label, msg } of opcoes) {
      await client.sendMessage(message.from, label);
      await client.sendMessage(message.from, msg);
    }
  } else {
    // Fallback: manda tudo em uma mensagem
    await message.reply(sugestoes.trim().replace(/\n{3,}/g, '\n\n'));
  }
}

const RECONQUISTA_CONTEXT = `

MODO RECONQUISTA ATIVO — situação especial, aplique com cuidado:
- Ela se afastou, sumiu, esfriou ou a relação terminou
- Objetivo: reacender interesse SEM demonstrar necessidade ou desespero
- NUNCA: "sinto sua falta", "preciso de você", "o que aconteceu", "me dá uma chance"
- SEMPRE: leveza, indiferença calculada, curiosidade, valor pessoal

Sequência natural de reconquista:
1. Primeiro contato pós-sumiço: leve, sem cobrar, como se a vida tivesse continuado
2. Criar curiosidade: algo que faz ela pensar em você sem explicar nada
3. Posição de valor: mostrar que sua vida tá ótima, sem forçar
4. Escalada só depois que ela reagir positivamente — não antes`;

async function analisarPrintComClaude(base64Data, mimeType, instrucaoExtra = '', contextoExtra = '', girlContext = '') {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';
  const instrucao = instrucaoExtra || `${prefixo}CONTEXTO: o usuário está tentando conquistar uma mulher e enviou essa imagem para pedir ajuda. SEMPRE trate a imagem como algo relacionado a ela — stories, post, perfil, foto que ela compartilhou, ou print da conversa com ela.

Identifique o TIPO desta imagem:

A) PRINT DE CONVERSA (balões de mensagem, chat do WhatsApp/Instagram/Tinder)
→ Leia a conversa toda. Identifique a ÚLTIMA mensagem dela e gere 3 opções de resposta específicas. Não seja genérico.

B) STORIES / POST / FOTO dela (qualquer foto sem balões de chat — comida, viagem, lugar, selfie, animal, atividade, qualquer coisa)
→ Assuma que é um stories ou post dela. Analise o que aparece: o que está sendo mostrado, vibe, detalhes específicos.
→ Gere 3 reações curtas e naturais para mandar pra ela — específicas ao conteúdo, que abram conversa. NUNCA: "que lindo", "incrível", elogios genéricos.
→ Se for comida: comente algo sobre o prato de forma inesperada. Se for lugar: curiosidade sobre o contexto. Se for selfie: algo específico da foto, nunca elogio de aparência.

C) FOTO DE PERFIL (Tinder, Instagram, app de relacionamento)
→ Gere 3 aberturas de conversa baseadas no que você viu — específicas, nunca genéricas.

Use o formato padrão com 📍 diagnóstico + 🔥 😏 ⚡ opções.`;
  // Imagens usam system prompt sem o redirect de "fora do escopo"
  const SYSTEM_PROMPT_IMAGE = SYSTEM_PROMPT.replace(
    /FOCO EXCLUSIVO[\s\S]*?Não explique, não se desculpe, não tente ajudar de outro jeito\. Só redireciona\./,
    'FOCO EXCLUSIVO: Você existe para ajudar homens a conquistar mulheres. Qualquer imagem enviada é sempre tratada como algo relacionado à mulher que ele quer conquistar.'
  );
  const response = await openrouter.chat.completions.create({
    model: MODELS.full,
    max_tokens: MAX_TOKENS.full,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_IMAGE + girlContext },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
          { type: 'text', text: instrucao },
        ],
      },
    ],
  });
  return response.choices[0]?.message?.content || 'Não consegui analisar a imagem. Tente enviar novamente.';
}

async function analisarTextoComClaude(situacao, contextoExtra = '', girlContext = '', usageTier = 'full', phone = '', recentSuccess = false) {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';

  // 1. Classifica o intent semanticamente
  const rawIntent = await classificarIntent(situacao);
  // 2. Aplica cap de custo pelo uso mensal
  let intent = capIntentByTier(rawIntent, usageTier);

  // 3. Score situacional — quão crítico é este momento?
  const situationScore = calcularSituationScore(situacao, rawIntent);

  // 4. Resolve acesso ao Sonnet com lógica inteligente de prioridade
  let sonnetInfo = { acesso: false };
  if (intent === 'premium' && phone) {
    sonnetInfo = await resolverAcessoSonnet(phone, intent, usageTier, situationScore, recentSuccess);
    if (sonnetInfo.acesso) {
      await incrementSonnetUsage(phone);
    } else {
      intent = 'volume'; // downgrade silencioso
    }
  }

  const config = INTENT_MODEL_CONFIG[intent];
  const systemPrompt = getSystemPrompt(config.systemType, girlContext);
  console.log(`[Roteamento] raw:${rawIntent} score:${situationScore} → final:${intent} → ${config.model}`);

  const userContent = `${prefixo}Situação real: "${situacao}"\n\nAnalise o contexto específico — o que aconteceu, qual é o estado atual dela, o que ele precisa fazer AGORA. Gere as 3 opções mais certeiras para essa situação exata. Não seja genérico, responda ao que realmente aconteceu.`;

  // 5. Tenta modelo principal, depois fallback
  const modelos = [config.model, INTENT_FALLBACKS[config.model]].filter(Boolean);
  for (const model of modelos) {
    try {
      const response = await openrouter.chat.completions.create({
        model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ],
      });
      return {
        text: response.choices[0]?.message?.content || 'Não consegui gerar respostas. Tente descrever melhor a situação.',
        sonnetInfo,
        intent,
      };
    } catch (err) {
      console.error(`[OpenRouter] Falha em ${model}:`, err.message);
      if (model === modelos[modelos.length - 1]) throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

async function upsertUser(phone, name, chatId) {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('users')
    .select('id, wa_chat_id')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    // Atualiza wa_chat_id se ainda não tiver salvo
    if (chatId && !existing.wa_chat_id) {
      await supabase.from('users').update({ wa_chat_id: chatId }).eq('phone', phone);
    }
    return false;
  }

  const { error } = await supabase
    .from('users')
    .insert({ phone, name: name || null, wa_chat_id: chatId || null });

  if (error) console.error('[Supabase] Erro ao salvar usuário:', error.message);
  return true;
}

/**
 * Retorna o status completo do usuário: premium, trial ativo, dias restantes.
 * Fonte única de verdade — usar no lugar de isUserPremium() isolado.
 */
async function getTrialInfo(phone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('users')
    .select('plan, plan_expires_at, created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!data) return { isPremium: false, inTrial: false, trialDaysLeft: 0, isLastDay: false };

  // Premium ativo?
  if (data.plan === 'premium') {
    if (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date()) {
      return { isPremium: true, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiresAt: data.plan_expires_at };
    }
    // Premium expirado — retorna a data para lógica de win-back
    return { isPremium: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiredAt: data.plan_expires_at };
  }

  // Calcula dias desde o cadastro (baseado em created_at — imutável no banco)
  const createdAt = new Date(data.created_at);
  const now = new Date();
  const diffDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

  const inTrial = diffDays < TRIAL_DAYS;
  const inSoftLimit = !inTrial && diffDays < SOFT_LIMIT_DAYS;
  const trialDaysLeft = inTrial ? TRIAL_DAYS - diffDays : 0;
  const isLastDay = trialDaysLeft === 1;

  // Limite diário baseado na fase do usuário
  let dailyLimit = null; // null = ilimitado (trial)
  if (inSoftLimit) dailyLimit = SOFT_LIMIT;
  else if (!inTrial) dailyLimit = POST_TRIAL_LIMIT;

  return { isPremium: false, inTrial, inSoftLimit, trialDaysLeft, isLastDay, dailyLimit };
}

/**
 * Verifica se o usuário está na janela de win-back (2–15 dias após expirar).
 * Na primeira chamada, sorteia o dia de desbloqueio e salva no banco.
 */
async function verificarWinback(phone, expiredAt) {
  const supabase = getSupabase();
  const now = new Date();
  const expirou = new Date(expiredAt);
  const diasDesdeExpiracao = Math.floor((now - expirou) / (1000 * 60 * 60 * 24));

  if (diasDesdeExpiracao < 2 || diasDesdeExpiracao > 15) return false;

  const { data } = await supabase
    .from('users')
    .select('winback_unlock_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!data?.winback_unlock_at) {
    // Sorteia um dia aleatório entre 2 e 15 para este usuário
    const diaAleatorio = Math.floor(Math.random() * 14) + 2;
    const unlockAt = new Date(expirou);
    unlockAt.setDate(unlockAt.getDate() + diaAleatorio);
    await supabase.from('users').update({ winback_unlock_at: unlockAt.toISOString() }).eq('phone', phone);
    return now >= unlockAt;
  }

  return now >= new Date(data.winback_unlock_at);
}

const SONNET_MONTHLY_CAP = 30;
const SONNET_ONBOARDING_CAP = 3; // 3 primeiras msgs de qualquer usuário usam Sonnet

async function getSonnetUsage(phone) {
  const supabase = getSupabase();
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const { data } = await supabase
    .from('sonnet_monthly_usage')
    .select('count')
    .eq('phone', phone)
    .eq('month', month)
    .maybeSingle();
  return data?.count || 0;
}

async function incrementSonnetUsage(phone) {
  const supabase = getSupabase();
  const month = new Date().toISOString().slice(0, 7);
  const { data } = await supabase
    .from('sonnet_monthly_usage')
    .select('count')
    .eq('phone', phone)
    .eq('month', month)
    .maybeSingle();
  const newCount = (data?.count || 0) + 1;
  await supabase
    .from('sonnet_monthly_usage')
    .upsert({ phone, month, count: newCount }, { onConflict: 'phone,month' });
  return newCount;
}

// ---------------------------------------------------------------------------
// Resolver inteligente de acesso ao Sonnet
// ---------------------------------------------------------------------------

async function resolverAcessoSonnet(phone, intent, usageTier, situationScore, recentSuccess) {
  if (intent !== 'premium') return { acesso: false };

  const sonnetUsado = await getSonnetUsage(phone);
  const isPremiumUser = usageTier === 'full';

  // Usuário premium: Sonnet para qualquer intent premium, até 30/mês
  if (isPremiumUser) {
    if (sonnetUsado < SONNET_MONTHLY_CAP) {
      return { acesso: true, tipo: 'premium', restante: SONNET_MONTHLY_CAP - sonnetUsado - 1 };
    }
    return { acesso: false, motivo: 'cap_mensal_premium' };
  }

  // Usuário free: Sonnet apenas para momentos de alto impacto
  if (sonnetUsado >= SONNET_ONBOARDING_CAP) {
    return { acesso: false, motivo: 'cap_gratuito_esgotado', sonnetUsado };
  }

  // Sucesso recente → boost no score (pico emocional = máxima receptividade)
  const scoreEfetivo = recentSuccess ? Math.min(situationScore + 3, 10) : situationScore;

  if (scoreEfetivo >= SONNET_FREE_MIN_SCORE) {
    const restante = SONNET_ONBOARDING_CAP - sonnetUsado - 1;
    console.log(`[Sonnet] Free aprovado — score:${scoreEfetivo} (base:${situationScore} boost:${recentSuccess}) usado:${sonnetUsado + 1}/${SONNET_ONBOARDING_CAP}`);
    return { acesso: true, tipo: 'onboarding', restante, totalUsado: sonnetUsado + 1 };
  }

  console.log(`[Sonnet] Free bloqueado — score:${scoreEfetivo} < ${SONNET_FREE_MIN_SCORE} → downgrade volume`);
  return { acesso: false, motivo: 'score_insuficiente', scoreEfetivo };
}

async function getMonthlyCount(phone) {
  const supabase = getSupabase();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const startDate = startOfMonth.toISOString().slice(0, 10);
  const { data } = await supabase
    .from('daily_message_counts')
    .select('message_count')
    .eq('phone', phone)
    .gte('count_date', startDate);
  return (data || []).reduce((sum, row) => sum + (row.message_count || 0), 0);
}

function getModelTier(monthlyCount) {
  if (monthlyCount <= 400) return 'full';
  if (monthlyCount <= 700) return 'degraded';
  return 'minimal';
}

function getTrialTier(dailyCount) {
  if (dailyCount <= 20) return 'full';
  if (dailyCount <= 50) return 'degraded';
  return 'minimal';
}

function resolveTier(trial, dailyCount, monthlyCount) {
  if (trial.inTrial) return getTrialTier(dailyCount);
  return getModelTier(monthlyCount); // premium e free: degradam por uso mensal
}

async function incrementDailyCount(phone) {
  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('daily_message_counts')
    .select('message_count')
    .eq('phone', phone)
    .eq('count_date', today)
    .maybeSingle();

  const newCount = (existing?.message_count ?? 0) + 1;

  const { error } = await supabase
    .from('daily_message_counts')
    .upsert(
      { phone, count_date: today, message_count: newCount, updated_at: new Date().toISOString() },
      { onConflict: 'phone,count_date' }
    );

  if (error) console.error('[Supabase] Erro ao incrementar contagem:', error.message);
  return newCount;
}

// ---------------------------------------------------------------------------
// Perfil dela — memória persistente no Supabase
// ---------------------------------------------------------------------------

async function getGirlProfile(phone) {
  const supabase = getSupabase();
  const { data } = await supabase.from('girl_profiles').select('*').eq('phone', phone).maybeSingle();
  return data || null;
}

async function saveGirlProfile(phone, updates) {
  const supabase = getSupabase();
  await supabase.from('girl_profiles').upsert(
    { phone, ...updates, updated_at: new Date().toISOString() },
    { onConflict: 'phone' }
  );
}

async function appendWhatWorked(phone, note) {
  const supabase = getSupabase();
  const { data } = await supabase.from('girl_profiles').select('what_worked').eq('phone', phone).maybeSingle();
  const existing = data?.what_worked || '';
  const lines = existing.split('\n').filter(Boolean);
  lines.push(`• ${note}`);
  const trimmed = lines.slice(-5).join('\n'); // mantém só os últimos 5
  await supabase.from('girl_profiles').upsert(
    { phone, what_worked: trimmed, updated_at: new Date().toISOString() },
    { onConflict: 'phone' }
  );
}

function buildGirlContext(profile) {
  if (!profile) return '';
  const parts = [];
  if (profile.girl_name) parts.push(`Nome dela: ${profile.girl_name}`);
  if (profile.girl_context) parts.push(`Quem ela é: ${profile.girl_context}`);
  if (profile.current_situation) parts.push(`Situação atual: ${profile.current_situation}`);
  if (profile.what_worked) parts.push(`O que já funcionou com ela anteriormente:\n${profile.what_worked}`);
  if (!parts.length) return '';
  return `\n\n--- PERFIL DELA (use para personalizar as respostas) ---\n${parts.join('\n')}\n---`;
}

// ---------------------------------------------------------------------------
// Contexto por usuário (memória de curto prazo para "outra"/"mais")
// ---------------------------------------------------------------------------

const userContext = new Map(); // phone -> { lastRequest, lastType, scenario, tonePreference }

function saveUserContext(phone, request, type) {
  const current = userContext.get(phone) || {};
  userContext.set(phone, { ...current, lastRequest: request, lastType: type, lastRequestAt: Date.now() });
}

function setUserTonePreference(phone, tone) {
  const current = userContext.get(phone) || {};
  userContext.set(phone, { ...current, tonePreference: tone });
}

function getUserContext(phone) {
  return userContext.get(phone) || null;
}

const MENSAGENS_ESPERA = [
  'Lendo o contexto... ⏳',
  'Deixa eu ver o que tá rolando aqui... ⏳',
  'Analisando ela... ⏳',
  'Tô lendo, já te mando... ⏳',
  'Um segundo... ⏳',
  'Vendo o melhor ângulo pra isso... ⏳',
  'Lendo o que ela disse... ⏳',
  'Já tô nisso... ⏳',
  'Lendo o contexto dela... ⏳',
  'Tô vendo aqui, já volto... ⏳',
];

const MENSAGENS_ESPERA_AUDIO = [
  'Ouvindo o áudio... ⏳',
  'Processando o que ela disse... ⏳',
  'Deixa eu ouvir isso aqui... ⏳',
  'Transcrevendo o áudio dela... ⏳',
];

const MENSAGENS_ESPERA_PERFIL = [
  'Analisando o perfil dela... ⏳',
  'Vendo o que tem aqui pra trabalhar... ⏳',
  'Lendo o vibe dela pela foto... ⏳',
  'Deixa eu ver o que ela tá revelando aqui... ⏳',
];

function getMensagemEspera() {
  return MENSAGENS_ESPERA[Math.floor(Math.random() * MENSAGENS_ESPERA.length)];
}

// Mostra "digitando..." nativo do WhatsApp enquanto processa
// Retorna função para parar o indicador
async function startTyping(message) {
  let chat;
  try {
    chat = await message.getChat();
    await chat.sendStateTyping();
  } catch (_) { return () => {}; }
  // Renova a cada 4s (WhatsApp para automaticamente após ~5s)
  const interval = setInterval(() => {
    chat.sendStateTyping().catch(() => {});
  }, 4000);
  return () => {
    clearInterval(interval);
    chat.clearState().catch(() => {});
  };
}

// ---------------------------------------------------------------------------
// Detecção de foto de perfil (Tinder/Instagram) e prompt específico de abertura
// ---------------------------------------------------------------------------

const PROFILE_OPENER_KEYWORDS = /\b(perfil|tinder|bumble|hinge|instagram|insta|foto dela|abertura|abre|como abordo|como falo|como chego|match|como abro|como conquisto|quero falar com ela)\b/i;

const STORY_KEYWORDS = /\b(stories|story|storie|status|reels|reel|post dela|postou|publicou)\b/i;

const STORY_PROMPT = `Você é o MandaAssim. Essa é uma foto de stories/status/reels que ela postou.

Analise o que aparece no stories:
- O que ela está fazendo, onde está, o que está mostrando
- Humor/vibe: animada, entediada, nostálgica, provocando, feliz, misteriosa
- Detalhe mais marcante: comida, lugar, roupa, legenda, músicaa, situação
- Se tiver texto ou legenda no stories, leia e use

GERE 3 REAÇÕES completamente diferentes — o objetivo é iniciar ou esquentar a conversa usando o stories como gancho:
- Mencione algo ESPECÍFICO do stories — nunca "que foto linda" ou "legal isso"
- Tom de quem viu o stories e teve uma reação genuína, casual
- Máximo 10 palavras por opção
- PROIBIDO: elogios genéricos de aparência
- PROIBIDO: perguntas óbvias demais ("onde é isso?", "tá bem?")
- A melhor reação de stories é a que faz ela responder sem perceber que era uma estratégia

TÉCNICAS PRA USAR (escolhe uma por opção):
- Comentar algo específico com curiosidade genuína → faz ela contar mais
- Humor seco ou ironia sobre o que aparece → ela ri e responde
- Provocação leve baseada no conteúdo → cria tensão boa
- Referência que só faz sentido se você realmente assistiu → prova que prestou atenção

FORMATO DE SAÍDA:
📍 _[uma linha: o que o stories revela sobre ela agora — humor, intenção, contexto]_

Cola uma dessas 👇

🔥 "[reação curiosa/genuína baseada no que aparece no stories]"

😏 "[reação ousada/provocadora usando algo específico do stories]"

⚡ "[reação seca e direta — referencia o stories de forma inesperada]"

_[uma linha: por que essa abordagem funciona pra esse stories específico]_`;

const PROFILE_OPENER_PROMPT = `Você é o MandaAssim. Essa é a foto do perfil dela — Tinder, Instagram ou similar.

Analise visualmente:
- Estilo dela: casual, descolada, fitness, artística, viajante, balada, etc.
- Expressão e energia: séria, sorridente, indiferente, misteriosa, divertida, etc.
- Cenário: viagem, natureza, cidade, praia, evento, academia, casa, etc.
- Qualquer detalhe específico: atividade, roupa, objeto de fundo, animal, comida

GERE 3 ABERTURAS completamente diferentes usando o que você viu na foto:
- Cada opção deve mencionar algo ESPECÍFICO e visível — nunca genérico
- Tom de cara de 25 anos no WhatsApp — casual, direto, sem forçar
- Máximo 10 palavras por opção
- PROIBIDO: elogio de aparência ("você é linda", "que foto bonita", "incrível")
- PROIBIDO: perguntas óbvias ("onde foi isso?", "gostou do lugar?")

FORMATO DE SAÍDA:
📍 _[uma linha: o que a foto revela — vibe, estilo, o que mais se destaca]_

Cola uma dessas pra abrir 👇

🔥 "[abertura curiosa/romântica baseada em algo específico da foto]"

😏 "[abertura ousada/provocadora com detalhe que você viu]"

⚡ "[abertura seca e direta — referencia algo concreto da foto]"

_[uma linha: por que essa abordagem funciona pra esse perfil específico]_`;

// ---------------------------------------------------------------------------
// Transcrição de áudio via Gemini (OpenRouter — mesma chave já configurada)
// ---------------------------------------------------------------------------

async function transcreverAudio(base64Data, mimetype) {
  const response = await openrouter.chat.completions.create({
    model: 'google/gemini-2.0-flash',
    max_tokens: 400,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'audio_url',
          audio_url: { url: `data:${mimetype};base64,${base64Data}` },
        },
        {
          type: 'text',
          text: 'Transcreva exatamente o que está sendo dito neste áudio em português brasileiro. Retorne APENAS o texto transcrito, sem comentários, sem pontuação desnecessária.',
        },
      ],
    }],
  });
  return (response.choices[0]?.message?.content || '').trim();
}

// ---------------------------------------------------------------------------
// Rate limiting — proteção anti-flood (sem custo de API)
// ---------------------------------------------------------------------------

const lastMessageTime = new Map(); // phone -> timestamp da última mensagem processada
const RATE_LIMIT_MS = 4000; // mínimo 4 segundos entre mensagens por usuário

function isRateLimited(phone) {
  const now = Date.now();
  const last = lastMessageTime.get(phone) || 0;
  if (now - last < RATE_LIMIT_MS) return true;
  lastMessageTime.set(phone, now);
  return false;
}

// Limpa o Map de rate limit a cada 1h para evitar memory leak
setInterval(() => lastMessageTime.clear(), 60 * 60 * 1000);

const SAUDACOES = new Set(['oi', 'olá', 'ola', 'hey', 'e aí', 'eai', 'opa', 'oie', 'hi']);

function isSaudacao(text) {
  return SAUDACOES.has(text.toLowerCase().trim());
}

const PEDE_OUTRA = /^(outra|mais|outro|manda (outra|mais|outro)|mais (uma|um)|repete|tenta (outra|outro)|varia|variação)$/i;

function isPedindoOutra(text) {
  return PEDE_OUTRA.test(text.trim());
}

// Detecta pedidos de ajuste de tom na mesma situação
// Ex: "mais sensual", "mais curto", "menos formal", "mais engraçado", "mais direta"
const AJUSTE_TOM = /^(mais |menos |bem |mais )(sensual|ousad[ao]|direto|direta|curto|curta|formal|informal|engraçad[ao]|romântic[ao]|criativ[ao]|intenso|intensa|sutil|picante|leve|agressiv[ao])/i;

function isAjusteTom(text) {
  return AJUSTE_TOM.test(text.trim());
}

// Perfil dela — comandos
const DEFINE_GIRL_NAME = /^(ela se chama|nome dela[:\s]*|o nome dela[:\s]*[eé]?)\s*([a-zA-ZÀ-ú][a-zA-ZÀ-ú\s]{1,30})$/i;
const DEFINE_GIRL_PROFILE = /^(ela [eé]|perfil dela[:\s]+|sobre ela[:\s]+|descreve ela[:\s]+)/i;
const DEFINE_SITUATION = /^(situação[:\s]+|modo[:\s]+|contexto[:\s]+)/i;
const VER_PERFIL = /^(perfil|ver perfil|perfil dela)$/i;
const LIMPAR_PERFIL = /^(limpar perfil|apagar perfil|nova mina|nova menina|outra mina|esquece ela)$/i;
const FEEDBACK_POSITIVO = /^(funcionou|deu certo|ela respondeu|foi bem|colou|deu boa|respondeu bem|ela topou|ela gostou|foi ótimo|mandou bem)$/i;
const FEEDBACK_NEGATIVO = /^(não funcionou|nao funcionou|não rolou|nao rolou|não respondeu|nao respondeu|foi mal|não colou|nao colou|ignorou|ela ignorou)$/i;
const RECONQUISTA_KEYWORDS = /reconquist|quero ela de volta|ela sumiu há|ela parou de responder|ela me deixou|ela foi embora|terminamos|ela terminou|quero reconquistar/i;

// ---------------------------------------------------------------------------
// WhatsApp Client
// ---------------------------------------------------------------------------

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'mandaassim-bot' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('\n[Bot] Escaneie o QR Code abaixo com o WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
  console.log(`[Bot] Carregando... ${percent}% — ${message}`);
});

client.on('authenticated', () => console.log('[Bot] Autenticado com sucesso!'));
client.on('auth_failure', (msg) => console.error('[Bot] Falha na autenticação:', msg));
client.on('disconnected', (reason) => console.warn('[Bot] Desconectado:', reason));

// ---------------------------------------------------------------------------
// Upsell no pico emocional — dispara após uma resposta bem-sucedida
// ---------------------------------------------------------------------------

async function contadorRestante(message, trial, todayCount) {
  if (trial.isPremium || trial.inTrial) return;
  const limit = trial.dailyLimit;
  const remaining = limit - todayCount;
  if (remaining > 0 && remaining <= Math.ceil(limit / 2)) {
    await client.sendMessage(message.from,
      `_📊 ${todayCount}/${limit} análises usadas hoje — ${remaining} restante(s)_`
    );
  }
}

async function upsellPicoPremium(message, trial, todayCount) {
  if (trial.isPremium) return;

  // Último dia do trial + já usou 3+ mensagens hoje
  if (trial.inTrial && trial.isLastDay && todayCount >= 3) {
    await client.sendMessage(message.from,
      `Hoje é seu *último dia* ilimitado — e você ainda tem conversa pra resolver 👆\n\n` +
      `${OPCOES_PREMIUM}`
    );
    return;
  }

  // Soft limit (dias 4-5): 2 mensagens restantes
  if (trial.inSoftLimit) {
    const remaining = SOFT_LIMIT - todayCount;
    if (remaining === 2) {
      await client.sendMessage(message.from,
        `Só *${remaining} mensagens* restando — não trava no meio da conversa com ela.\n\n` +
        `${OPCOES_PREMIUM}`
      );
    }
    return;
  }

  // Pós-trial (dia 6+): última mensagem do dia
  if (!trial.inTrial && !trial.inSoftLimit) {
    const remaining = POST_TRIAL_LIMIT - todayCount;
    if (remaining === 1) {
      await client.sendMessage(message.from,
        `Última análise do dia — essa conversa com ela não terminou ainda 👆\n\n` +
        `${OPCOES_PREMIUM}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Upsell progressivo após Sonnet gratuito (conversão no pico emocional)
// ---------------------------------------------------------------------------

async function upsellSonnetFree(message, sonnetInfo, trial) {
  // Só dispara para free que acabou de usar Sonnet de onboarding
  if (trial.isPremium || !sonnetInfo?.acesso || sonnetInfo.tipo !== 'onboarding') return;

  const { restante } = sonnetInfo;

  if (restante === 0) {
    // Última análise avançada usada — upsell completo com framing de incompletude
    await new Promise(r => setTimeout(r, 2000));
    await client.sendMessage(message.from,
      `Essa conversa com ela não terminou — mas suas análises avançadas gratuitas sim 🔥\n\n` +
      `No *Premium* você tem *30 dessas por mês*: reconquistas, primeiros contatos, momentos que não podem errar.\n\n` +
      `${OPCOES_PREMIUM}`
    );
  } else if (restante === 1) {
    // Penúltima — scarcity sutil
    await client.sendMessage(message.from,
      `_⚡ Análise avançada — só mais 1 gratuita depois dessa_`
    );
  }
  // restante >= 2: silencioso — não interrompe a experiência
}

// ---------------------------------------------------------------------------
// Pagamento Pix
// ---------------------------------------------------------------------------

async function enviarCobrancaPix(message, phone, amount = undefined) {
  try {
    const { qrCodeBase64, qrCodeText } = await criarCobrancaPix(phone, amount);

    await message.reply('Perfeito! Gerei seu Pix 👇\n\n⚠️ O Pix aparecerá no nome *Rafael Cabral Ibraim* — esse é o nome do responsável pelo MandaAssim. É seguro pagar normalmente! ✅');

    const media = new MessageMedia('image/png', qrCodeBase64, 'pix-qrcode.png');
    await client.sendMessage(message.from, media);

    await client.sendMessage(message.from, qrCodeText);

    await client.sendMessage(message.from,
      `✅ Após o pagamento, você receberá a confirmação aqui no WhatsApp em menos de 1 minuto.\n\n` +
      `_Se demorar mais, digita *paguei* que eu verifico pra você._`
    );

    console.log(`[Pix] QR Code enviado para ${phone}`);
  } catch (err) {
    console.error('[Pix] Erro ao gerar cobrança:', err.message);
    await message.reply('Tive um problema ao gerar o Pix 😕\nTente novamente em instantes.');
  }
}

// ---------------------------------------------------------------------------
// Processamento de mensagens
// ---------------------------------------------------------------------------

client.on('message', async (message) => {
  if (message.isGroupMsg) return;
  if (message.from === 'status@broadcast') return;
  if (message.fromMe) return;
  // Ignora reações (👍❤️😂 etc.) e mensagens de sistema
  if (message.type === 'reaction') return;
  if (message.type === 'e2e_notification') return;
  if (message.type === 'notification_template') return;

  let phone = message.from.replace(/@(c\.us|lid)$/, '');
  let contactName = null;
  try {
    const contact = await message.getContact();
    contactName = contact.pushname || contact.name || null;
    // Normaliza para o número real (evita inconsistência entre @c.us e @lid)
    // Só aceita contact.number se parece um telefone real (não é um LID interno do WhatsApp)
    // LIDs são IDs internos longos que não seguem formato de telefone internacional
    if (contact.number && /^[1-9]\d{9,14}$/.test(contact.number) && contact.number.length <= 13) {
      phone = contact.number;
    }
  } catch (_) {}

  // Normaliza números brasileiros sem o 9 (55 + DDD + 8 dígitos = 12 total → adiciona o 9)
  if (/^55\d{10}$/.test(phone)) {
    const area = phone.slice(2, 4);
    const num = phone.slice(4);
    if (!num.startsWith('9')) phone = `55${area}9${num}`;
  }

  console.log(`[Mensagem] De: ${phone} | Tipo: ${message.type} | Nome: ${contactName ?? 'desconhecido'}`);

  // Rate limiting — ignora silenciosamente se mandando rápido demais
  if (isRateLimited(phone)) {
    console.log(`[RateLimit] ${phone} bloqueado — mensagens muito rápidas.`);
    return;
  }

  // Limite de tamanho — mensagens absurdamente longas são ignoradas
  if (message.type === 'chat' && message.body && message.body.length > 2000) {
    await message.reply('Mensagem muito longa. Resume em até 2000 caracteres e manda de novo 😅');
    return;
  }

  // Cancela qualquer follow up pendente quando usuário manda mensagem
  cancelPendingFollowups(phone).catch(() => {});

  // Boas-vindas para novos usuários (não conta no limite)
  const isNewUser = await upsertUser(phone, contactName, message.from);
  if (isNewUser) {
    await message.reply(WELCOME_MESSAGE);
    console.log(`[Boas-vindas] Enviada para: ${phone}`);
    scheduleInactiveFollowup(phone).catch(() => {});
    return;
  }

  // Comandos: "premium" e "status"
  if (message.type === 'chat') {
    const cmd = message.body.trim().toLowerCase();

    if (cmd === 'status') {
      const trial = await getTrialInfo(phone);
      const supabase = getSupabase();
      const today = new Date().toISOString().slice(0, 10);
      const { data: countRow } = await supabase
        .from('daily_message_counts')
        .select('message_count')
        .eq('phone', phone)
        .eq('count_date', today)
        .maybeSingle();
      const used = countRow?.message_count ?? 0;

      let statusText;
      if (trial.isPremium) {
        if (trial.expiresAt) {
          const validade = new Date(trial.expiresAt).toLocaleDateString('pt-BR');
          statusText = `🌟 *Premium* — mensagens ilimitadas\n_Válido até ${validade}_`;
        } else {
          statusText = '🌟 *Premium* — mensagens ilimitadas';
        }
      } else if (trial.inTrial) {
        statusText = `🎉 *Trial ativo* — ilimitado por mais *${trial.trialDaysLeft} dia(s)*\n_Usado hoje: ${used} análises_`;
      } else if (trial.inSoftLimit) {
        statusText = `🆓 Gratuito — ${used}/${SOFT_LIMIT} análises usadas hoje`;
      } else {
        statusText = `🆓 Gratuito — ${used}/${POST_TRIAL_LIMIT} análises usadas hoje`;
      }

      await message.reply(`📊 *Seu status:*\n\n${statusText}`);
      return;
    }

    if (cmd === 'premium') {
      const trial = await getTrialInfo(phone);
      if (trial.isPremium) {
        await message.reply('🌟 Você já é *Premium*! Pode mandar à vontade.');
      } else {
        await message.reply(
          `${OPCOES_PREMIUM}`
        );
      }
      return;
    }

    if (cmd === 'mensal') {
      await enviarCobrancaPix(message, phone, PRECO_MENSAL);
      return;
    }

    if (cmd === 'anual') {
      await enviarCobrancaPix(message, phone, PRECO_ANUAL);
      return;
    }

    if (cmd === '24h') {
      await enviarCobrancaPix(message, phone, PRECO_24H);
      return;
    }

    if (cmd === 'voltar') {
      await enviarCobrancaPix(message, phone, PRECO_WINBACK);
      return;
    }

    if (cmd === 'paguei') {
      const supabase = getSupabase();
      const { data: user } = await supabase.from('users').select('plan, plan_expires_at').eq('phone', phone).maybeSingle();
      if (user?.plan === 'premium' && (!user.plan_expires_at || new Date(user.plan_expires_at) > new Date())) {
        await message.reply('✅ Pagamento confirmado! Você já é *Premium* — pode mandar à vontade 🚀');
        return;
      }

      // Busca o pagamento mais recente no banco
      const { data: pagamento } = await supabase
        .from('payments')
        .select('status, mp_payment_id, created_at')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!pagamento) {
        await message.reply(
          `Não encontrei nenhum pagamento. Digita *mensal* pra gerar um novo Pix.`
        );
        return;
      }

      // Se já aprovado no banco mas usuário não é premium, ativa agora
      if (pagamento.status === 'approved') {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await supabase.from('users').update({ plan: 'premium', plan_expires_at: expiresAt.toISOString() }).eq('phone', phone);
        await message.reply('✅ Pagamento confirmado! Você já é *Premium* — pode mandar à vontade 🚀');
        return;
      }

      // Se pending e tem mp_payment_id, consulta o MP direto
      if (pagamento.status === 'pending' && pagamento.mp_payment_id) {
        try {
          const { MercadoPagoConfig, Payment } = require('mercadopago');
          const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
          const mpPayment = new Payment(mpClient);
          const result = await mpPayment.get({ id: pagamento.mp_payment_id });

          if (result.status === 'approved') {
            const amount = result.transaction_amount ?? 0;
            const days = amount >= 100 ? 365 : amount <= 9.99 ? 1 : 30;
            const expiresAt = new Date();
            if (days === 1) expiresAt.setHours(expiresAt.getHours() + 24);
            else expiresAt.setDate(expiresAt.getDate() + days);
            await Promise.all([
              supabase.from('users').update({ plan: 'premium', plan_expires_at: expiresAt.toISOString(), renewal_notified: false, winback_unlock_at: null }).eq('phone', phone),
              supabase.from('payments').update({ status: 'approved' }).eq('mp_payment_id', pagamento.mp_payment_id),
            ]);
            console.log(`[Paguei] ✅ Premium ativado via consulta MP para ${phone} (${days}d)`);
            const confirmMsg = days === 1
              ? '✅ *24h ativado!*\n\nAcesso ilimitado pelas próximas *24 horas* 🚀\n\nAproveita — manda o print agora!'
              : '✅ *Pagamento confirmado!*\n\nBem-vindo ao *MandaAssim Premium* 🚀\n\nVocê agora tem mensagens *ilimitadas*. Manda o próximo print ou descreve a situação!';
            await message.reply(confirmMsg);
          } else {
            await message.reply(
              `⏳ Seu Pix ainda não foi confirmado pelo banco.\n\n` +
              `Normalmente cai em menos de 1 minuto. Aguarda e tenta de novo! 🙏`
            );
          }
        } catch (e) {
          console.error('[Paguei] Erro ao consultar MP:', e.message);
          await message.reply(`⏳ Estamos verificando seu pagamento. Tenta de novo em 1 minuto 🙏`);
        }
      } else {
        await message.reply(
          `⏳ Seu Pix ainda não foi confirmado pelo banco.\n\n` +
          `Normalmente cai em menos de 1 minuto. Aguarda e tenta de novo! 🙏`
        );
      }
      return;
    }

  }

  // ---------------------------------------------------------------------------
  // Verificação de trial e limite diário
  // ---------------------------------------------------------------------------

  const trial = await getTrialInfo(phone);
  const todayCount = await incrementDailyCount(phone);

  if (trial.isPremium) {
    // Premium: sem limite, segue em frente

  } else if (trial.inTrial) {
    // Trial ativo (dias 1-3): ilimitado — avisa na primeira mensagem do dia
    if (todayCount === 1) {
      if (trial.isLastDay) {
        await message.reply(
          `⚡ Último dia de acesso ilimitado — aproveita!\n\n` +
          `Amanhã passa pra *10 análises/dia* por 2 dias, depois *3/dia* no plano grátis.\n\n` +
          `Quer continuar ilimitado? ${OPCOES_PREMIUM}\n\n` +
          `_Ou digita *status* pra ver seu plano_`
        );
      } else {
        await message.reply(
          `🎉 *${trial.trialDaysLeft} dias* de acesso ilimitado ainda — vai fundo!\n\n` +
          `_Digita *status* a qualquer momento pra ver seu plano_`
        );
      }
    }

  } else {
    // Pós-trial: verifica limite da fase atual
    const dailyLimit = trial.dailyLimit;

    // Aviso na primeira mensagem da transição para soft limit (dia 4)
    if (trial.inSoftLimit && todayCount === 1) {
      await message.reply(TRANSICAO_SOFT_LIMIT);
    }

    if (todayCount > dailyLimit) {
      console.log(`[Limite] ${phone} atingiu ${todayCount}/${dailyLimit} hoje.`);

      // Agenda follow up para quando o limite for esgotado
      if (trial.inSoftLimit) {
        scheduleLimitExhausted10(phone).catch(() => {});
      } else {
        scheduleLimitExhausted3(phone).catch(() => {});
      }

      // Gatilho situacional: usuário estava no meio de uma conversa ativa?
      const ctx = getUserContext(phone);
      const conversaQuente = ctx?.lastRequestAt && (Date.now() - ctx.lastRequestAt) < 5 * 60 * 1000;

      // Win-back: ex-premium na janela de 2-15 dias → oferta de R$19,90
      if (trial.expiredAt && await verificarWinback(phone, trial.expiredAt)) {
        await message.reply(
          `Seus créditos de hoje acabaram 😅\n\n` +
          `Como você já foi Premium, tenho uma oferta especial de volta:\n\n` +
          `🔥 *R$19,90* no primeiro mês _(era R$29,90)_\n\n` +
          `👉 Digita *voltar* pra aproveitar\n\n` +
          `_+1.200 caras já usaram essa semana_`
        );
      } else if (conversaQuente) {
        await message.reply(
          `Você estava indo bem com ela — para aqui agora é perder o ritmo 🔥\n\n` +
          `${OPCOES_PREMIUM}`
        );
      } else if (trial.inSoftLimit) {
        await message.reply(
          `Suas ${SOFT_LIMIT} análises de hoje acabaram — essa conversa com ela não terminou ainda.\n\n` +
          `${OPCOES_PREMIUM}`
        );
      } else {
        await message.reply(LIMITE_TRIAL_ENDED_MESSAGE);
      }
      return;
    }

    // Agenda follow up ao entrar no soft limit (dia 4) ou pós-trial (dia 6+) — primeira msg do dia
    if (todayCount === 1) {
      if (trial.inSoftLimit) scheduleLimitDrop10(phone).catch(() => {});
      else if (!trial.inTrial) scheduleLimitDrop3(phone).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Processamento normal
  // ---------------------------------------------------------------------------

  if (message.type === 'chat') {
    const text = message.body.trim();
    console.log(`[Texto] ${phone}: "${text}"`);

    // Filtra saudações puras — orienta sem gastar API
    if (isSaudacao(text)) {
      await message.reply('E aí! Manda o print da conversa ou descreve a situação em texto — eu leio o contexto e gero as opções certas pra você 🔥');
      return;
    }

    // Ver perfil dela salvo
    if (VER_PERFIL.test(text)) {
      const profile = await getGirlProfile(phone);
      if (!profile || (!profile.girl_name && !profile.girl_context)) {
        await message.reply(
          'Ainda não tem perfil salvo 📋\n\n' +
          'Manda assim:\n\n' +
          '*ela se chama [nome]*\n' +
          '*ela é [descrição]*\n\n' +
          'Ex: _"ela é agitada, fica no zap o dia todo, já ficamos uma vez"_'
        );
      } else {
        let txt = '📋 *Perfil dela:*\n\n';
        if (profile.girl_name) txt += `👤 *Nome:* ${profile.girl_name}\n`;
        if (profile.girl_context) txt += `📝 *Perfil:* ${profile.girl_context}\n`;
        if (profile.current_situation) txt += `📍 *Situação:* ${profile.current_situation}\n`;
        if (profile.what_worked) txt += `✅ *O que funcionou:\n*${profile.what_worked}\n`;
        txt += '\n_Digita "limpar perfil" pra começar do zero_';
        await message.reply(txt);
      }
      return;
    }

    // Limpar perfil dela
    if (LIMPAR_PERFIL.test(text)) {
      await saveGirlProfile(phone, { girl_name: null, girl_context: null, current_situation: null, what_worked: null });
      userContext.delete(phone);
      await message.reply('Perfil limpo ✅\n\nNova mina, nova estratégia 😏\n\nManda o print ou descreve a situação.');
      return;
    }

    // Salvar nome dela
    const nomeMatch = text.match(DEFINE_GIRL_NAME);
    if (nomeMatch) {
      const nome = nomeMatch[2].trim();
      await saveGirlProfile(phone, { girl_name: nome });
      await message.reply(`Salvo ✅ Ela se chama *${nome}*.\n\nAgora manda o print ou descreve o que aconteceu — vou usar o contexto dela nas respostas.`);
      return;
    }

    // Salvar perfil dela
    if (DEFINE_GIRL_PROFILE.test(text)) {
      const desc = text.replace(DEFINE_GIRL_PROFILE, '').trim();
      if (desc.length < 5) {
        await message.reply('Descreve mais ela — personalidade, como é, o que rolou entre vocês.\n\nEx: _"ela é tímida mas quando conhece abre, a gente ficou mês passado e tá meio fria agora"_');
        return;
      }
      await saveGirlProfile(phone, { girl_context: desc });
      await message.reply(`Perfil salvo ✅\n\nAgora toda resposta vai ser personalizada pra ela. Manda o print ou descreve o que aconteceu 🎯`);
      return;
    }

    // Salvar situação atual
    if (DEFINE_SITUATION.test(text)) {
      const sit = text.replace(DEFINE_SITUATION, '').trim();
      await saveGirlProfile(phone, { current_situation: sit });
      await message.reply(`Contexto salvo ✅\n\nManda o print ou o que ela disse por último.`);
      return;
    }

    // Feedback positivo — registra o que funcionou + ativa boost para próxima análise
    if (FEEDBACK_POSITIVO.test(text)) {
      const ctx = getUserContext(phone);
      if (ctx?.lastRequest) {
        const ref = ctx.lastType === 'text' ? String(ctx.lastRequest).slice(0, 80) : 'print da conversa';
        await appendWhatWorked(phone, ref);
      }
      // Marca recentSuccess → próxima análise recebe boost de score para Sonnet
      const current = userContext.get(phone) || {};
      userContext.set(phone, { ...current, recentSuccess: true });
      await message.reply('Boa! 🔥 Anotei o que funcionou — vou usar de referência nas próximas.\n\nManda o próximo print quando quiser.');
      return;
    }

    // Feedback negativo
    if (FEEDBACK_NEGATIVO.test(text)) {
      await message.reply('Tudo bem, nem toda mensagem conecta na hora certa 🤝\n\nManda como ela reagiu ou o próximo print — ajusto a abordagem.');
      return;
    }

    // Pedido de outra/mais — reutiliza contexto anterior
    if (isPedindoOutra(text)) {
      const ctx = getUserContext(phone);
      if (!ctx?.lastRequest) {
        await message.reply('Me manda a situação primeiro, aí eu gero quantas variações quiser 😎');
        return;
      }
      const girlProfile = await getGirlProfile(phone);
      const girlContext = buildGirlContext(girlProfile);
      const monthlyCount = await getMonthlyCount(phone);
      const tier = resolveTier(trial, todayCount, monthlyCount);
      await message.reply(getMensagemEspera());
      const stopTyping1 = await startTyping(message);
      try {
        const result = ctx.lastType === 'image'
          ? { text: await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype, '', '', girlContext) }
          : await analisarTextoComClaude(ctx.lastRequest + '\n\n(Gere 3 variações COMPLETAMENTE DIFERENTES das anteriores. Mude os ângulos, metáforas e abordagens.)', '', girlContext, tier, phone);
        stopTyping1();
        await enviarResposta(message, result.text);
      } catch (err) {
        stopTyping1();
        console.error('[OpenRouter] Erro ao gerar variações:', err.message);
        await message.reply('Deu ruim, tenta mandar de novo 😅');
      }
      return;
    }

    // Pedido de ajuste de tom — aplica ao contexto anterior
    if (isAjusteTom(text)) {
      const ctx = getUserContext(phone);
      if (!ctx?.lastRequest) {
        await message.reply('Me conta a situação primeiro, aí eu refaço no tom que quiser 😉');
        return;
      }
      setUserTonePreference(phone, text.trim());
      const girlProfile = await getGirlProfile(phone);
      const girlContext = buildGirlContext(girlProfile);
      const monthlyCount = await getMonthlyCount(phone);
      const tier = resolveTier(trial, todayCount, monthlyCount);
      await message.reply(getMensagemEspera());
      const stopTyping2 = await startTyping(message);
      try {
        const result = ctx.lastType === 'image'
          ? { text: await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype, `Analise essa conversa e gere 3 opções com tom "${text.trim()}". Seja fiel ao estilo pedido.`, '', girlContext) }
          : await analisarTextoComClaude(`Situação: ${ctx.lastRequest}\n\nGere 3 opções com tom "${text.trim()}". Adapte completamente o estilo.`, '', girlContext, tier, phone);
        stopTyping2();
        saveUserContext(phone, ctx.lastRequest, ctx.lastType);
        await enviarResposta(message, result.text);
      } catch (err) {
        stopTyping2();
        console.error('[OpenRouter] Erro ao ajustar tom:', err.message);
        await message.reply('Deu ruim aqui, tenta de novo 😅');
      }
      return;
    }

    // Análise normal
    const ctx = getUserContext(phone);
    const toneHint = ctx?.tonePreference ? `\nPreferência do usuário: ele tende a preferir tom "${ctx.tonePreference}" — leve isso em conta sem ignorar as outras opções.` : '';
    const recentSuccess = ctx?.recentSuccess || false;
    const girlProfile = await getGirlProfile(phone);
    const girlContext = buildGirlContext(girlProfile);
    const reconquistaExtra = RECONQUISTA_KEYWORDS.test(text) ? RECONQUISTA_CONTEXT : '';
    const monthlyCount = await getMonthlyCount(phone);
    const tier = resolveTier(trial, todayCount, monthlyCount);
    console.log(`[Tier] ${phone} — daily:${todayCount} monthly:${monthlyCount} → tier:${tier} recentSuccess:${recentSuccess}`);

    await message.reply(getMensagemEspera());
    const stopTyping3 = await startTyping(message);
    try {
      const result = await analisarTextoComClaude(text, toneHint, girlContext + reconquistaExtra, tier, phone, recentSuccess);
      stopTyping3();
      saveUserContext(phone, text, 'text');
      if (recentSuccess) {
        const updCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...updCtx, recentSuccess: false });
      }
      await enviarResposta(message, result.text);
      await upsellSonnetFree(message, result.sonnetInfo, trial);
      await contadorRestante(message, trial, todayCount);
      await upsellPicoPremium(message, trial, todayCount);
    } catch (err) {
      stopTyping3();
      console.error('[OpenRouter] Erro ao analisar texto:', err.message);
      await message.reply('Deu ruim aqui, tenta de novo 😅');
    }

  } else if (message.type === 'image') {
    const media = await message.downloadMedia();
    if (!media) {
      await message.reply('Não consegui baixar a imagem, manda de novo');
      return;
    }

    const caption = message.body?.trim() || '';
    const isPerfilMode = PROFILE_OPENER_KEYWORDS.test(caption);
    const isStoryMode = STORY_KEYWORDS.test(caption);
    const ctxImg = getUserContext(phone);
    const toneHintImg = ctxImg?.tonePreference ? `\nPreferência do usuário: ele tende a preferir tom "${ctxImg.tonePreference}".` : '';
    const girlProfileImg = await getGirlProfile(phone);
    const girlContextImg = buildGirlContext(girlProfileImg);

    if (isStoryMode) {
      // Modo stories: gera reação ao stories dela
      console.log(`[Stories] ${phone} enviou foto de stories (caption: "${caption}")`);
      await message.reply('Vendo o stories dela... ⏳');
      const stopTypingStory = await startTyping(message);
      try {
        const sugestoes = await analisarPrintComClaude(media.data, media.mimetype, STORY_PROMPT, '', girlContextImg);
        stopTypingStory();
        saveUserContext(phone, media, 'image');
        await enviarResposta(message, sugestoes);
        await contadorRestante(message, trial, todayCount);
        await upsellPicoPremium(message, trial, todayCount);
      } catch (err) {
        stopTypingStory();
        console.error('[Stories] Erro:', err.message);
        await message.reply('Não consegui analisar o stories, tenta mandar de novo 😅');
      }
    } else if (isPerfilMode) {
      // Modo perfil: gera abertura de conversa baseada na foto dela
      console.log(`[Perfil] ${phone} enviou foto de perfil (caption: "${caption}")`);
      await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
      const stopTypingPerfil = await startTyping(message);
      try {
        const sugestoes = await analisarPrintComClaude(media.data, media.mimetype, PROFILE_OPENER_PROMPT, '', girlContextImg);
        stopTypingPerfil();
        saveUserContext(phone, media, 'image');
        await enviarResposta(message, sugestoes);
        await contadorRestante(message, trial, todayCount);
        await upsellPicoPremium(message, trial, todayCount);
      } catch (err) {
        stopTypingPerfil();
        console.error('[Perfil] Erro:', err.message);
        await message.reply('Não consegui analisar o perfil, tenta mandar de novo 😅');
      }
    } else {
      // Modo conversa: analisa o print normalmente
      console.log(`[Imagem] ${phone} enviou um print.`);
      await message.reply(getMensagemEspera());
      const stopTypingImg = await startTyping(message);
      try {
        const sugestoes = await analisarPrintComClaude(media.data, media.mimetype, '', toneHintImg, girlContextImg);
        stopTypingImg();
        saveUserContext(phone, media, 'image');
        await enviarResposta(message, sugestoes);
        await contadorRestante(message, trial, todayCount);
        await upsellPicoPremium(message, trial, todayCount);
      } catch (err) {
        stopTypingImg();
        console.error('[Claude] Erro ao analisar imagem:', err.message);
        await message.reply('Não consegui ler esse print, tenta mandar de novo');
      }
    }

  } else if (message.type === 'audio' || message.type === 'ptt') {
    // Áudio de voz — transcreve e analisa como texto
    console.log(`[Áudio] ${phone} enviou ${message.type}.`);

    const media = await message.downloadMedia();
    if (!media) {
      await message.reply('Não consegui baixar o áudio, manda de novo');
      return;
    }

    await message.reply(MENSAGENS_ESPERA_AUDIO[Math.floor(Math.random() * MENSAGENS_ESPERA_AUDIO.length)]);
    const stopTypingAudio = await startTyping(message);

    try {
      const transcricao = await transcreverAudio(media.data, media.mimetype);

      if (!transcricao || transcricao.length < 3) {
        stopTypingAudio();
        await message.reply('Não consegui entender o áudio 😅 Tenta descrever em texto.');
        return;
      }

      console.log(`[Áudio] Transcrição (${transcricao.length} chars): "${transcricao.slice(0, 100)}..."`);

      // Mostra o que foi transcrito — o usuário sabe que foi entendido
      await client.sendMessage(message.from, `📝 _"${transcricao}"_`);

      // Analisa o texto transcrito normalmente
      const girlProfileAudio = await getGirlProfile(phone);
      const girlContextAudio = buildGirlContext(girlProfileAudio);
      const reconquistaExtraAudio = RECONQUISTA_KEYWORDS.test(transcricao) ? RECONQUISTA_CONTEXT : '';
      const monthlyCountAudio = await getMonthlyCount(phone);
      const tierAudio = resolveTier(trial, todayCount, monthlyCountAudio);
      const ctxAudio = getUserContext(phone);
      const recentSuccessAudio = ctxAudio?.recentSuccess || false;

      const result = await analisarTextoComClaude(transcricao, '', girlContextAudio + reconquistaExtraAudio, tierAudio, phone, recentSuccessAudio);
      stopTypingAudio();
      saveUserContext(phone, transcricao, 'text');
      if (recentSuccessAudio) {
        const updCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...updCtx, recentSuccess: false });
      }
      await enviarResposta(message, result.text);
      await upsellSonnetFree(message, result.sonnetInfo, trial);
      await contadorRestante(message, trial, todayCount);
      await upsellPicoPremium(message, trial, todayCount);
    } catch (err) {
      stopTypingAudio();
      console.error('[Áudio] Erro:', err.message);
      await message.reply('Não consegui processar o áudio 😅 Tenta descrever em texto.');
    }

  } else {
    await message.reply(`Manda o *texto*, um *print* da conversa ou um *áudio* — eu analiso e gero as opções 🎯`);
  }
});

// ---------------------------------------------------------------------------
// Notificações automáticas (renovação e win-back)
// ---------------------------------------------------------------------------

async function verificarExpiracoes() {
  console.log('[Cron] Verificando expirações...');
  const supabase = getSupabase();
  const now = new Date();

  // Aviso 3 dias antes de expirar
  const inicioDia3 = new Date(now); inicioDia3.setDate(inicioDia3.getDate() + 3); inicioDia3.setHours(0, 0, 0, 0);
  const fimDia3 = new Date(inicioDia3); fimDia3.setHours(23, 59, 59, 999);

  const { data: expirando } = await supabase
    .from('users')
    .select('phone')
    .eq('plan', 'premium')
    .eq('renewal_notified', false)
    .gte('plan_expires_at', inicioDia3.toISOString())
    .lte('plan_expires_at', fimDia3.toISOString());

  for (const user of expirando ?? []) {
    try {
      await client.sendMessage(`${user.phone}@c.us`, MENSAGEM_RENOVACAO);
      await supabase.from('users').update({ renewal_notified: true }).eq('phone', user.phone);
      console.log(`[Cron] Aviso de renovação → ${user.phone}`);
    } catch (e) {
      console.warn(`[Cron] Erro ao notificar ${user.phone}:`, e.message);
    }
  }

}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

// Remove o lock do Chrome de processos anteriores (evita loop de restart)
const fs = require('fs');
const chromeLockPath = require('path').join(__dirname, '.wwebjs_auth/session-mandaassim-bot/SingletonLock');
try { fs.unlinkSync(chromeLockPath); console.log('[Boot] Lock do Chrome removido.'); } catch (_) {}

const webhookApp = createWebhookApp(client);
const server = webhookApp.listen(PORT, () => {
  console.log(`[Webhook] Servidor rodando na porta ${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Webhook] Porta ${PORT} já em uso — aguardando 5s e tentando novamente...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT);
    }, 5000);
  } else {
    console.error('[Webhook] Erro no servidor:', err.message);
  }
});

client.on('ready', () => {
  console.log('[Bot] Conectado e pronto para receber mensagens!');
  startWorker(client);
  setTimeout(verificarExpiracoes, 15000);
  setInterval(verificarExpiracoes, 6 * 60 * 60 * 1000);
});

client.initialize();
