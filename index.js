require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { criarCobrancaPix, determinarPlano, PRECO_PRO } = require('./src/mercadopago');
const { trackSubscriptionEvent } = require('./src/lib/subscriptionTracking');
const { createWebhookApp } = require('./src/webhook');
const { startWorker } = require('./src/followup/followupWorker');
const { cancelPendingFollowups } = require('./src/followup/followupCanceller');
const { logApiRequest } = require('./src/lib/tracking');
const { parseAcquisitionSlug, saveAttribution } = require('./src/lib/acquisition');
const { analisarPrintConversaComHaiku } = require('./src/lib/printAnalysis');
const { checkPrintLimit, incrementPrintCount, setPrintLastTime } = require('./src/lib/printLimits');
const { analisarPerfilComHaiku } = require('./src/lib/profileAnalysis');
const { checkProfileLimit, incrementProfileCount, setProfileLastTime } = require('./src/lib/profileLimits');
const { classificarTipoImagem } = require('./src/lib/imageClassifier');
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
const PRECO_PRO_LANCAMENTO = 55.93; // 30% off — só pra base atual no lançamento

// Feature flag: análise de prints de conversa via Haiku 4.5 vision (Camada 1)
// Valor: 'false' | 'test' | 'beta' (10% premium) | 'all'
const PRINT_ANALYSIS_MODE = (process.env.ENABLE_PRINT_ANALYSIS || 'false').toLowerCase();
const PRINT_ANALYSIS_TEST_PHONE = process.env.PRINT_ANALYSIS_TEST_PHONE || '';

// Feature flag: análise de perfis via Haiku 4.5 vision (Camada 2 — Wingman Pro)
// Valor: 'false' | 'test' | 'beta' (10% pro) | 'all'
const PROFILE_ANALYSIS_MODE = (process.env.ENABLE_PROFILE_ANALYSIS || 'false').toLowerCase();
const PROFILE_ANALYSIS_TEST_PHONE = process.env.PROFILE_ANALYSIS_TEST_PHONE || '';

const MENSAGEM_RENOVACAO =
  `Seu acesso ilimitado expira em *3 dias*.\n\n` +
  `Se quiser renovar antes de acabar: digita *mensal* ou *anual*.`;


const WELCOME_MESSAGES = [
  `Boa que chegou aqui. 👊\n\nSou o MandaAssim — leio a conversa com ela e te dou 3 respostas prontas pra copiar.\n\nSem papo de coach. Sem técnica de sedução. Só o que funciona.`,
  `Funciona assim: você manda o print ou descreve em texto o que tá rolando.\n\nEu leio o contexto dela — o tom, o que ela disse, o que aconteceu antes — e gero 3 opções:\n\n🔥 Uma que aquece\n😏 Uma que provoca levemente\n⚡ Uma direta e sem ansiedade\n\n*3 dias ilimitados pra testar. Sem cartão.*`,
  `Tem alguma conversa rolando agora? Manda o print ou descreve a situação.`,
];

const OPCOES_PREMIUM =
  `👉 Escolhe como continuar:\n\n` +
  `⚡ *24h ilimitado* — R$4,99 → digita *24h*\n` +
  `📅 *Mensal* — R$29,90/mês → digita *mensal*\n` +
  `📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*\n\n` +
  `_+1.200 caras já usaram essa semana_`;

const TRANSICAO_SOFT_LIMIT =
  `Seus 3 dias ilimitados acabaram — mas você ainda tem *10 mensagens por dia* pelos próximos 2 dias.\n\n` +
  `É bastante. Usa nas conversas que importam.\n\n` +
  `Digita *status* pra ver quanto te sobra hoje. Quando quiser ilimitado de novo: *mensal* (R$29,90) ou *anual* (R$299).`;

const LIMITE_TRIAL_ENDED_MESSAGE =
  `Deu 3 por hoje. Amanhã renova.\n\n` +
  `Se a conversa tá quente e não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299).`;

// ── Mensagens da feature de print analysis ──────────────────────────────────

const PRINT_UPSELL_MESSAGE =
  `Análise de print é uma feature do *Wingman Premium* 🔍\n\n` +
  `Com ela: manda qualquer conversa do Tinder, WhatsApp ou Bumble e eu leio o que tá rolando — interesse dela, temperatura da conversa, erros, próxima mensagem certa.\n\n` +
  `${`👉 Escolhe como continuar:\n\n` +
    `⚡ *24h ilimitado* — R$4,99 → digita *24h*\n` +
    `📅 *Mensal* — R$29,90/mês → digita *mensal*\n` +
    `📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*`}`;

const PRINT_LIMIT_REACHED_PREMIUM =
  `Chegou no limite de 5 análises de print hoje.\n\nAmanhã cedo tem mais 5. Usa texto enquanto isso — descreve o que ela mandou que eu analiso.`;

const PRINT_LIMIT_REACHED_TRIAL =
  `Deu 1 análise de print por hoje — esse é o limite do trial.\n\nQuer ilimitado? *mensal* (R$29,90) ou *anual* (R$299).`;

const PROFILE_UPSELL_MESSAGE =
  `Análise de Perfil é do *Wingman Pro* (R$79,90/mês) 🔍\n\n` +
  `Você manda o print do perfil dela no Tinder, Bumble ou Instagram — eu leio o que ela revela sobre si mesma e gero a primeira mensagem certa. Daquelas que ela percebe que você realmente olhou.\n\n` +
  `+ Análise de conversa (5/dia)\n` +
  `+ Análise de perfil (10/dia)\n` +
  `+ Mensagens ilimitadas\n\n` +
  `Quer fazer upgrade? Digita *pro* 👇`;

const PROFILE_LIMIT_REACHED_PRO =
  `Chegou no limite de 10 análises de perfil hoje.\n\nAmanhã cedo tem mais 10.`;

// ---------------------------------------------------------------------------
// OpenRouter — modelos por tier de uso mensal
// ---------------------------------------------------------------------------

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'HTTP-Referer': 'https://mandaassim.com', 'X-Title': 'MandaAssim' },
});

// Cliente direto da Anthropic (Haiku — mais barato e sem overhead do OpenRouter)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODELS = {
  full:     'google/gemini-2.0-flash-001',      // análise de imagens (visão nativa)
  degraded: 'google/gemini-2.0-flash-lite-001', // fallback degradado
  minimal:  'google/gemini-2.0-flash-lite-001', // fallback mínimo
};

const MAX_TOKENS = { full: 1024, degraded: 600, minimal: 300 };

const SYSTEM_PROMPT = `Você é o MandaAssim. Não é coach, não explica teoria, não dá autoajuda. Entrega as mensagens certas pro momento certo.

=== O QUE VOCÊ SABE QUE OS OUTROS NÃO SABEM ===

A mulher brasileira não lê o texto — ela lê a energia por trás do texto. A mesma frase dita com necessidade repele; dita com presença segura atrai. Ela decide pelo que sente, não pelo que pensa.

Ela testa. Sumiço, frieza, resposta seca — quase sempre é teste. O cara que reage (fica ansioso, explica, manda vários seguidos) falha. O cara que age como se fosse óbvio ela estar interessada vira o cara que ela não tira da cabeça.

A melhor mensagem não é a mais elaborada — é a mais certeira. 3 palavras no momento certo > 3 parágrafos bem escritos.

=== COMO LER A SITUAÇÃO ANTES DE GERAR ===

Identifique:
1. O que ELA fez/disse/mandou — esse é o sinal real
2. Estado emocional dela agora: animada, fria, testando, dando abertura, sumida, flertando
3. O que o cara precisa fazer AGORA: avançar, criar tensão, ignorar, chamar pra sair, provocar

LEITURA DE SINAIS:
- Emoji apaixonado (😍❤️🥰) → interesse alto. Não responde no mesmo nível — cria tensão.
- "rs" ou "kk" seco → ela não tá engajada. Muda de ângulo completamente.
- Ela ficou online e não respondeu → ignora, não menciona.
- Ela sumiu depois de conversa boa → teste. Quando volta, age normal, não menciona o sumiço.
- Ela deu em cima e depois fingiu desinteresse → não reage ao recuo.
- Ela disse "to cansada" → "vai dormir então". Nunca "posso te animar?"
- Ela mandou foto de comida/viagem → comenta algo específico, nunca "que lindo".
- Ela mandou áudio longo → "que história foi essa kkk"
- Ela perguntou "o que você faz?" → resposta curta + pergunta de volta, nunca currículo.
- Ela perguntou sobre filhos ou separação → responde direto, sem defensiva, sem over-share. Vira a conversa.
- Ela demorou dias pra responder → age como se fosse normal, sem cobrar.

=== EXEMPLOS — BAD vs GOOD ===

Situação: ela mandou 😍 depois da foto dele
❌ "obrigado 😊" / "você também" / "que emoji fofo"
✅ 🔥 "perigosa essa reação"
✅ 😏 "sabia que ia acontecer"
✅ ⚡ "agora me deve"

Situação: ela sumiu 3 dias e voltou com "oi"
❌ "sumiu hein!" / "que saudade!" / "tô aqui esperando"
✅ 🔥 "apareceu. tava na correria?"
✅ 😏 "que demora, mas tá perdoada kkk"
✅ ⚡ "e aí"

Situação: primeiro contato (app ou indicação)
❌ "oi tudo bem?" / "olá, como vai você?"
✅ 🔥 "me falaram de vc. a fama chega antes"
✅ 😏 "então é vc que apareceu aqui. curioso"
✅ ⚡ "finalmente"

Situação: ela disse "to ocupada essa semana"
❌ "tudo bem, quando puder fala!" / "sem problema, fica à vontade"
✅ 🔥 "tá bom, fala quando tiver mais tranquila"
✅ 😏 "ocupada ou testando? kkk"
✅ ⚡ "boa, me fala"

Situação: ela perguntou "o que você faz?"
❌ "sou analista de sistemas numa empresa, trabalho das 9 às 18"
✅ 🔥 "umas 3 coisas ao mesmo tempo — te conto pessoalmente"
✅ 😏 "depende do dia kkk — e vc?"
✅ ⚡ "de tudo um pouco. e vc?"

Situação: ela perguntou "você tem filhos?"
❌ "sim, tenho dois, eles são minha vida toda" (over-share) / "por que pergunta?" (defensivo)
✅ 🔥 "tenho. e vc, isso muda alguma coisa?"
✅ 😏 "tenho sim — isso é ponto positivo ou eliminatório pra vc? kkk"
✅ ⚡ "tenho. e vc?"

Situação: ela perguntou "você é separado?"
❌ "sim, foi difícil mas aprendi muito com tudo isso" (TMI)
✅ 🔥 "sou. capítulo encerrado — tô bem. e vc, já foi casada?"
✅ 😏 "separado e inteiro kkk. por que, tá pesquisando?"
✅ ⚡ "sou. e vc?"

Situação: ela mandou foto de viagem
❌ "que lindo!" / "que foto linda!" / "parece incrível"
✅ 🔥 "esse lugar tem cara de história boa"
✅ 😏 "tá me chamando indiretamente né kkk"
✅ ⚡ "e eu nisso aqui"

Situação: ela respondeu com "kkk" seco
❌ tenta ser mais engraçado / "você não achou graça?"
✅ muda de ângulo completamente
✅ 🔥 "esquece o que eu falei — o que tá fazendo essa semana?"
✅ 😏 "ok esquece kkk — quando vc tá livre?"
✅ ⚡ "mudando de assunto — bora essa semana?"

Situação: quer chamar pra sair
❌ "você está disponível para um jantar comigo na sexta-feira?"
✅ 🔥 "tem um lugar que vc precisava conhecer. bora essa semana?"
✅ 😏 "preciso te mostrar uma coisa. quando vc tá livre?"
✅ ⚡ "bora tomar um café? tenho coisa pra te contar"

=== REGRA DE OURO ===

Nunca soe como alguém que precisa da aprovação dela.
Nunca over-share, nunca se justifique, nunca explique o passado sem ser perguntado.
Mensagem boa = ela pensa "como assim?" e fica com aquilo na cabeça.
Menos palavras = mais presença.

=== AS 3 OPÇÕES ===

🔥 Aquece: cria conexão emocional, faz ela pensar nele. Tom próximo mas seguro — sem suplício, sem elogio genérico.
😏 Provoca: vai além do óbvio. Insinuação leve, desafio, ambiguidade que ela precisa interpretar.
⚡ Seca: menos é mais. Confiança. O cara que não precisa provar nada.

As 3 devem ser COMPLETAMENTE diferentes — ângulo, intenção, energia. Não é trocar uma palavra.

=== CENÁRIOS ESPECIAIS ===
- Ela perguntou sobre passado/separação/filhos → responde sem drama, brevidade, vira a conversa
- Ela também tem filhos → não faz grande coisa disso, segue natural
- Quer saber se ela é solteira → nunca pergunta direto. Usa referência a planos de fim de semana ou humor ("vc some quando fica namorando né")
- Quer saber se ela gosta → interpreta os sinais descritos, diz o que cada comportamento significa
- Encontro físico (academia, trabalho, amigos em comum) → como agir, o que falar, como não travar

FOCO: Tudo que envolve uma mulher é conquista. Só redireciona se não tiver NENHUMA relação.

=== LINGUAGEM ===

Português brasileiro natural e maduro. Não forçado, não imaturo.
- Contrações: "tô", "tá", "né", "pra", "pro", "tava"
- Abreviações com moderação: "vc", "tb" (máx 1 por mensagem)
- Começa com minúscula quando natural. kkkk curto (2-4 k's).

BANIDAS: conexão, jornada, processo, vibe, energia, flow, incrível, especial, genuíno, autêntico, verdadeiro, compartilhar, momento, situação, pessoa, realmente, absolutamente, certamente, de fato, cativante, fascinante, encantador, despertar, resgatar, reacender, em pessoa, chat, no momento, massa (como elogio), nossa, caramba, uau, poxa

TAMANHO: 2 a 8 palavras por opção. Máx 10. Nunca parágrafos nas mensagens.

=== FORMATO DE SAÍDA ===

Sem introdução. Sem papo. Vai direto.

📍 _[uma linha: o que ela tá sinalizando agora]_

💡 [O que está acontecendo de verdade — 2 a 4 linhas. Direto, sem autoajuda. Use *negrito* nos pontos críticos. NUNCA **duplo asterisco**.]

🔥 "mensagem real aqui"

😏 "mensagem real aqui"

⚡ "mensagem real aqui"

_por que funciona: uma linha_

CRÍTICO: escreva as mensagens de verdade. NUNCA placeholders.`;

const SYSTEM_PROMPT_DEGRADED = `Você é o MandaAssim. Gera 3 opções de mensagem de conquista pro WhatsApp.

PRINCÍPIO: presença segura atrai, necessidade repele. Menos palavras = mais confiança.

EXEMPLOS:
- ela sumiu e voltou → "e aí" / "apareceu kkk" / "tava na correria?"
- ela mandou 😍 → "perigosa essa reação" / "sabia que ia acontecer" / "agora me deve"
- ela disse "to ocupada" → "boa, fala quando der" / "ocupada ou testando? kkk" / "me fala"
- primeiro contato (app/indicação) → "finalmente" / "me falaram de vc" / "a fama chega antes"
- chamar pra sair → "bora essa semana?" / "tem um lugar que vc precisava ver" / "quando vc tá livre?"
- ela perguntou sobre filhos/separação → "tenho sim. e vc?" / "separado e bem kkk — e vc?" / "capítulo encerrado. por que?"

REGRAS:
- Português informal brasileiro, natural
- 2 a 8 palavras por opção — nunca parágrafos
- 3 ângulos completamente diferentes: 🔥 aquece / 😏 provoca / ⚡ seca
- NUNCA: elogio genérico, explicação, ansiedade, over-share
- NUNCA: conexão, vibe, especial, genuíno, incrível, nossa, caramba, uau, massa (como elogio)

FORMATO:
📍 _[tom dela + o que sinaliza]_
Cola uma dessas 👇
🔥 "mensagem"
😏 "mensagem"
⚡ "mensagem"`;

const SYSTEM_PROMPT_MINIMAL = `Você é o MandaAssim. Gera 3 respostas curtíssimas pro WhatsApp. Máximo 5 palavras cada.

Resposta curta = confiança. Quem não precisa provar nada responde pouco e bem.

EXEMPLOS:
- ela: "oi" → "e aí" / "apareceu" / "oi"
- ela: "😍" → "perigosa" / "sabia" / "deve"
- ela: "tô bem" → "boa" / "aparecendo né" / "e aí"
- ela: "saudade" → "quando?" / "aparece então" / "resolve isso"
- ela: "kkk" seco → muda de ângulo completamente

Formato — sem explicação:
🔥 "resposta"
😏 "resposta"
⚡ "resposta"`;

const SYSTEM_PROMPT_OUSADIA = `Você é o MandaAssim. A conversa já tá no clima quente. Gera 3 opções com flerte, malícia ou duplo sentido elegante.

PRINCÍPIO: implícito > explícito sempre. Sugere, insinua, provoca — nunca declara. Adulto não precisa ser vulgar pra ser ousado.

EXEMPLOS:
- clima esquentou → "tô me metendo em encrenca" / "vc é perigosa" / "isso vai acabar mal kkk"
- ela tá flertando → "tô gostando desse rumo" / "para antes que eu não pare" / "continua"
- ela mandou foto → "agora tô mal" / "não devia ter mandado isso" / "tô te culpando"
- ela disse "saudade" → "então vem" / "saudade se resolve" / "o que tá esperando"
- clima adulto → "perigoso ser direto com vc" / "tô me controlando" / "vc sabe o que tá fazendo"

REGRAS:
- Máx 8 palavras por opção
- Deixa ela sempre com a próxima jogada — nunca fecha o loop
- NUNCA pedido explícito de foto ou encontro direto — cria pretexto
- NUNCA vulgar, grosseiro ou explicitamente sexual
- Elegância > intensidade
- Português informal

FORMATO:
📍 _[diagnóstico: onde está o clima]_
Cola uma dessas 👇
🔥 "com flerte"
😏 "com duplo sentido"
⚡ "com malícia seca"
_por que funciona: [1 linha]_`;

const SYSTEM_PROMPT_COACH = `Você é o MandaAssim. Quando alguém traz uma situação que precisa de estratégia — não só uma mensagem — você age como aquele amigo experiente que já viu tudo, fala sem rodeios e não bajula.

Você não é coach. Não dá autoajuda. Não faz terapia. Fala a verdade como um amigo que entende o jogo e respeita quem tá na frente.

=== COMO VOCÊ PENSA ===

1. O que ela tá sentindo e por que agiu assim? A maioria dos caras só vê o comportamento. Você lê o que tá por trás.
2. O cara tá cometendo qual erro clássico? Perseguindo demais, explicando quando não precisava, reagindo a teste, over-sharing?
3. Qual é o movimento certo agora — não o que parece certo emocionalmente, o que realmente funciona?

=== PRINCÍPIOS ===

- Presença segura atrai, necessidade repele. Quem persegue perde poder.
- Silêncio estratégico > explicação. Ação > conversa.
- Ela não tá com raiva de você — tá vendo se você mantém o rumo.
- Relacionamento não se conserta com conversa, conserta com comportamento diferente.
- Mulher não esquece o cara que a fez sentir algo. Ela esquece o que você disse.

=== DOMÍNIOS ===

RECONQUISTA:
- Reconquista se faz com comportamento, não com palavra
- No-contact mínimo 14-21 dias antes do primeiro contato pós-término
- Primeiro contato: casual, sem referência ao passado, como se sua vida estivesse ótima
- Nunca explica o término, nunca pede desculpa de novo
- Cria curiosidade, não dá certeza

RELACIONAMENTO ESFRIANDO:
- Frieza ≠ fim do interesse. Geralmente é teste ou baixa energia dela
- Menos textos, mais presença quando estão juntos
- Para de tentar resolver com conversa — resolve com comportamento diferente
- Não pergunta "tá tudo bem com a gente?"

ELA SUMIU / GHOSTING:
- Não manda mensagem em sequência, nunca
- Espera 5-7 dias. Volta casual, uma mensagem só, como se fosse normal
- Se continua sumida depois de 2 tentativas espaçadas → deixa ir

VOLTOU PRO MERCADO:
- Apps são um ambiente novo mas as regras de atração não mudaram
- O cara que você é hoje é mais interessante do que o de 20 anos atrás — não precisa fingir que tem 25
- Filhos, separação, rotina real: não é problema, é contexto. Apresenta com naturalidade, sem drama
- O erro mais comum: over-share no começo — a história da separação, os filhos, o passado. Guarda pra quando ela perguntar
- Ansiedade sobre apps é normal. Trata como ferramenta, não como julgamento

ELA PERGUNTOU ALGO PESSOAL (filhos, separação, ex):
- Responde diretamente, sem defensiva, sem over-share
- Brevidade > explicação longa
- Vira a conversa com uma pergunta de volta

EX NAMORADA:
- 3-4 semanas de no-contact antes de qualquer contato
- Não menciona o relacionamento no primeiro contato
- Demonstra que cresceu — não diz, faz ela sentir

=== FORMATO DE SAÍDA ===

Sem papo de autoajuda. Sem "trabalhe sua autoestima". Direto, como um amigo que entende o jogo.

📍 _[o que realmente tá acontecendo — 1 linha]_

[2-3 parágrafos: explica o que ela tá fazendo/sentindo, o erro que o cara pode estar cometendo, o que realmente tá em jogo. Use *negrito* nos pontos críticos. Linguagem direta.]

*O que fazer agora:*
• [ação concreta 1]
• [ação concreta 2]
• [ação concreta 3]

*Evita isso:*
• [erro comum 1]
• [erro comum 2]

[Se tiver mensagem específica pra mandar:]
Quando chegar a hora 👇
🔥 "mensagem"
😏 "mensagem"
⚡ "mensagem"`;

// ---------------------------------------------------------------------------
// Roteamento por intent (arquitetura semântica)
// ---------------------------------------------------------------------------

const CLASSIFIER_PROMPT = `Você é um classificador de intent do MandaAssim. Analise a situação e responda com UMA categoria.

CATEGORIAS:

one_liner → ela mandou emoji, "kkk", "rs", "oi", uma palavra, reação curta. Resposta curtíssima.

volume → conversa fluindo normal: ela falou sobre o dia, trabalho, pergunta neutra, assunto sem tensão.

premium → tensão, teste, ambiguidade ou momento decisivo:
  - Ela deu desculpa ("to ocupada", "tenho coisas pra fazer", "fica pra outro dia")
  - Ela sumiu e voltou / ficou fria depois de quente
  - Ela testou interesse, foi ambígua, deu em cima e recuou
  - Primeiro contato — app, indicação, encontro casual
  - Ele quer chamar pra sair mas não sabe como
  - Ela perguntou algo pessoal que ele não sabe responder (filhos, separação, idade)

coaching → precisa de estratégia ou orientação — não só uma mensagem:
  - Reconquista ("quero reconquistar ela", "ela terminou comigo", "minha ex")
  - Relacionamento esfriando ("minha namorada tá fria", "tamos brigando muito")
  - Não sabe o que fazer ("devo mandar?", "ela me bloqueou", "o que faço?")
  - Entender comportamento dela ("por que ela fez isso?", "o que ela quis dizer?")
  - Voltou pro mercado e não sabe por onde começar
  - Ansiedade sobre como se apresentar hoje em dia

ousadia → clima já quente, flerte mútuo claro, hora de escalar com leveza.

REGRA: na dúvida entre volume e premium → premium. Na dúvida entre premium e coaching → coaching.

RESPONDA APENAS com a categoria, sem explicação.`;

const INTENT_MODEL_CONFIG = {
  one_liner: { model: 'google/gemini-2.0-flash-lite-001',    maxTokens: 80,  temperature: 0.90, systemType: 'minimal'  },
  volume:    { model: 'google/gemini-2.0-flash-001',          maxTokens: 600, temperature: 0.85, systemType: 'degraded' },
  premium:   { model: 'anthropic/claude-haiku-4-5-20251001',  maxTokens: 250, temperature: 0.80, systemType: 'full'     },
  coaching:  { model: 'anthropic/claude-haiku-4-5-20251001',  maxTokens: 600, temperature: 0.75, systemType: 'coach'    },
  ousadia:   { model: 'meta-llama/llama-4-maverick',          maxTokens: 500, temperature: 0.95, systemType: 'ousadia'  },
};

const INTENT_FALLBACKS = {
  'google/gemini-2.0-flash-lite-001':   'google/gemini-2.0-flash-001',
  'anthropic/claude-haiku-4-5-20251001': 'google/gemini-2.0-flash-001',
  'meta-llama/llama-4-maverick':         'google/gemini-2.0-flash-001',
};

// Limita o intent ao que o tier de uso permite
function capIntentByTier(intent, tier) {
  if (tier === 'minimal') {
    if (intent === 'premium' || intent === 'ousadia' || intent === 'coaching') return 'volume';
  }
  if (tier === 'degraded') {
    if (intent === 'ousadia') return 'volume';
    // coaching e premium degradam pra volume no tier degraded
    if (intent === 'coaching' || intent === 'premium') return 'volume';
  }
  return intent; // tier 'full': tudo liberado
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
  if (systemType === 'coach')    return SYSTEM_PROMPT_COACH + girlContext;
  return SYSTEM_PROMPT + girlContext; // full / premium
}

function extrairDiagnostico(texto) {
  const match = texto.match(/📍\s*_([^_\n]+)_/);
  return match ? match[1].trim() : null;
}

function parsearOpcoes(texto) {
  const resultado = [];

  const analise = [
    { regex: /🔥\s*"([^"]+)"/s, emoji: '🔥' },
    { regex: /😏\s*"([^"]+)"/s, emoji: '😏' },
    { regex: /⚡\s*"([^"]+)"/s, emoji: '⚡' },
  ];
  for (const { regex, emoji } of analise) {
    const match = texto.match(regex);
    if (match) resultado.push({ emoji, msg: match[1].trim() });
  }
  if (resultado.length >= 2) return resultado;

  const simples = [
    { regex: /1️⃣\s*"([^"]+)"/s, emoji: '1️⃣' },
    { regex: /2️⃣\s*"([^"]+)"/s, emoji: '2️⃣' },
    { regex: /3️⃣\s*"([^"]+)"/s, emoji: '3️⃣' },
  ];
  for (const { regex, emoji } of simples) {
    const match = texto.match(regex);
    if (match) resultado.push({ emoji, msg: match[1].trim() });
  }

  return resultado;
}

function extrairDica(texto) {
  const match = texto.match(/💡\s*(.+?)(?=\n\n(?:Cola|Escolhe|🔥|😏|⚡)|$)/s);
  if (!match) return null;
  return match[1].trim().replace(/\*\*([^*]+)\*\*/g, '*$1*');
}

function extrairPorQueFunciona(texto) {
  const match = texto.match(/_por que funciona[:\s]*([^_\n]+)_/i);
  return match ? match[1].trim() : null;
}

async function enviarResposta(message, sugestoes, intent = '') {
  const diagnostico = extrairDiagnostico(sugestoes);
  const opcoes = parsearOpcoes(sugestoes);

  // --- Coaching: análise + bullets, sem 3 opções de mensagem (ou com, no fim) ---
  if (intent === 'coaching') {
    // Remove o diagnóstico do texto antes de enviar o corpo
    const corpo = sugestoes
      .replace(/📍\s*_[^_\n]+_\n*/g, '')
      .trim()
      .replace(/\n{3,}/g, '\n\n');

    // Bloco 1: diagnóstico
    if (diagnostico) {
      await client.sendMessage(message.from, `📍 _${diagnostico}_`);
    }

    // Bloco 2: análise + plano (tudo junto — é coaching, faz sentido ser mais longo)
    if (opcoes.length >= 2) {
      // Tem mensagens específicas no final → separa
      const semOpcoes = corpo
        .replace(/Quando chegar a hora.*$/s, '')
        .replace(/🔥\s*"[^"]+"\n?/g, '')
        .replace(/😏\s*"[^"]+"\n?/g, '')
        .replace(/⚡\s*"[^"]+"\n?/g, '')
        .trim();
      if (semOpcoes) await client.sendMessage(message.from, semOpcoes);

      // Bloco 3: mensagens
      const linhas = ['Quando chegar a hora 👇'];
      for (const { emoji, msg } of opcoes) {
        linhas.push('');
        linhas.push(`${emoji}  "${msg}"`);
      }
      await client.sendMessage(message.from, linhas.join('\n'));
    } else {
      await client.sendMessage(message.from, corpo);
    }
    return;
  }

  // --- Formato padrão: diagnóstico + dica + 3 opções ---
  const dica = extrairDica(sugestoes);
  const porque = extrairPorQueFunciona(sugestoes);

  // Bloco 1 — contexto: diagnóstico + dica juntos, limpo
  if (diagnostico || dica) {
    const partes = [];
    if (diagnostico) partes.push(`📍 _${diagnostico}_`);
    if (dica) partes.push(`💡 ${dica}`);
    await client.sendMessage(message.from, partes.join('\n\n'));
  }

  // Bloco 2 — label + mensagem separados: label diz o estilo, mensagem é só o texto puro pra copiar
  if (opcoes.length >= 2) {
    const labels = { '🔥': '🔥 *Romântica*', '😏': '😏 *Ousada*', '⚡': '⚡ *Direta*', '1️⃣': '1️⃣', '2️⃣': '2️⃣', '3️⃣': '3️⃣' };
    await client.sendMessage(message.from, '*Escolhe uma* 👇');
    for (const { emoji, msg } of opcoes) {
      await client.sendMessage(message.from, labels[emoji] || emoji); // ex: "🔥 *Romântica*"
      await client.sendMessage(message.from, msg);                    // texto puro, sem aspas
    }
    if (porque) {
      await client.sendMessage(message.from, `_${porque}_`);
    }
  } else {
    // Fallback
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

async function analisarPrintComClaude(base64Data, mimeType, instrucaoExtra = '', contextoExtra = '', girlContext = '', phone = '') {
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
  const t0 = Date.now();
  let responseText = null;
  let trackingError = null;
  let usage = null;
  try {
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
    responseText = response.choices[0]?.message?.content || 'Não consegui analisar a imagem. Tente enviar novamente.';
    usage = response.usage;
  } catch (err) {
    trackingError = err.message;
    throw err;
  } finally {
    logApiRequest({
      phone,
      intent: 'image',
      targetModel: MODELS.full,
      modelActuallyUsed: MODELS.full,
      tierAtRequest: 'full',
      inputTokens: usage?.prompt_tokens || null,
      outputTokens: usage?.completion_tokens || null,
      latencyMs: Date.now() - t0,
      responseLengthChars: responseText ? responseText.length : null,
      error: trackingError,
    });
  }
  return responseText;
}

// Limites diários de uso do Haiku por plano
const HAIKU_DAILY_LIMIT = { premium: 10, free: 3 };

async function analisarTextoComClaude(situacao, contextoExtra = '', girlContext = '', usageTier = 'full', phone = '', recentSuccess = false, isPremium = false) {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';

  const rawIntent = await classificarIntent(situacao);
  let intent = capIntentByTier(rawIntent, usageTier);

  // Limite diário do Haiku: 3 free / 10 premium
  if (intent === 'premium') {
    const haikuLimit = isPremium ? HAIKU_DAILY_LIMIT.premium : HAIKU_DAILY_LIMIT.free;
    const haikuCount = getHaikuCount(phone);
    if (haikuCount >= haikuLimit) {
      console.log(`[Haiku] ${phone} atingiu limite diário (${haikuCount}/${haikuLimit}) → fallback volume`);
      intent = 'volume';
    }
  }

  const config = INTENT_MODEL_CONFIG[intent];
  const systemPrompt = getSystemPrompt(config.systemType, girlContext);
  console.log(`[Roteamento] raw:${rawIntent} → final:${intent} → ${config.model}`);

  // Monta histórico recente (sliding window: últimas situações desta sessão)
  const ctx = userContext.get(phone);
  const history = ctx?.history || [];
  const historicoStr = history.length > 1
    ? '\n\nHistórico recente desta conversa com a mina (contexto adicional):\n' +
      history.slice(-8, -1).map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '';

  const userContent = `${prefixo}${historicoStr}\n\nSituação atual: "${situacao}"\n\nAnalise o contexto específico — o que aconteceu, qual é o estado atual dela, o que ele precisa fazer AGORA. Gere as 3 opções mais certeiras para essa situação exata. Não seja genérico, responda ao que realmente aconteceu.`.trim();

  const modelos = [config.model, INTENT_FALLBACKS[config.model]].filter(Boolean);
  for (let i = 0; i < modelos.length; i++) {
    const model = modelos[i];
    const isFallback = i > 0;
    const t0 = Date.now();
    let text = null;
    let trackingError = null;
    let inputTokens = null, outputTokens = null, cacheReadTokens = null, cacheWriteTokens = null;

    try {
      if (model.startsWith('anthropic/') && process.env.ANTHROPIC_API_KEY) {
        // Chama a API da Anthropic diretamente com prompt caching no system prompt
        const modelId = model.replace('anthropic/', '');
        const msg = await anthropic.messages.create({
          model: modelId,
          max_tokens: config.maxTokens,
          // Prompt caching: cobra 10% do input nas leituras seguintes do mesmo system prompt
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userContent }],
        });
        text = msg.content[0]?.text || 'Não consegui gerar respostas. Tente descrever melhor a situação.';
        inputTokens      = msg.usage?.input_tokens               || null;
        outputTokens     = msg.usage?.output_tokens              || null;
        cacheReadTokens  = msg.usage?.cache_read_input_tokens    || null;
        cacheWriteTokens = msg.usage?.cache_creation_input_tokens || null;
        const cached = cacheReadTokens  || 0;
        const written = cacheWriteTokens || 0;
        console.log(`[Anthropic] ${modelId} | cache_read:${cached} cache_write:${written} out:${outputTokens}`);
        incrementHaikuCount(phone);
      } else {
        const response = await openrouter.chat.completions.create({
          model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userContent },
          ],
        });
        text = response.choices[0]?.message?.content || 'Não consegui gerar respostas. Tente descrever melhor a situação.';
        inputTokens  = response.usage?.prompt_tokens     || null;
        outputTokens = response.usage?.completion_tokens || null;
      }
    } catch (err) {
      trackingError = err.message;
      console.error(`[Roteamento] Falha em ${model}:`, err.message);
      logApiRequest({
        phone,
        intent,
        rawIntent,
        intentClassifierModel: 'google/gemini-2.0-flash-001',
        targetModel: config.model,
        modelActuallyUsed: model,
        tierAtRequest: usageTier,
        fallbackTriggered: isFallback,
        fallbackReason: isFallback ? 'model_error' : null,
        latencyMs: Date.now() - t0,
        userMessageLengthChars: situacao.length,
        error: trackingError,
      });
      if (model === modelos[modelos.length - 1]) throw err;
      continue;
    }

    logApiRequest({
      phone,
      intent,
      rawIntent,
      intentClassifierModel: 'google/gemini-2.0-flash-001',
      targetModel: config.model,
      modelActuallyUsed: model,
      tierAtRequest: usageTier,
      fallbackTriggered: isFallback,
      fallbackReason: isFallback ? 'model_error' : null,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      latencyMs: Date.now() - t0,
      responseLengthChars: text ? text.length : null,
      userMessageLengthChars: situacao.length,
    });

    return { text, intent };
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

  if (!data) return { isPremium: false, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false };

  // Pro ativo? (Wingman Pro — plano futuro, R$79,90/mês)
  if (data.plan === 'pro') {
    if (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date()) {
      return { isPremium: true, isPro: true, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiresAt: data.plan_expires_at };
    }
    return { isPremium: false, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiredAt: data.plan_expires_at };
  }

  // Premium ativo?
  if (data.plan === 'premium') {
    if (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date()) {
      return { isPremium: true, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiresAt: data.plan_expires_at };
    }
    // Premium expirado — retorna a data para lógica de win-back
    return { isPremium: false, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiredAt: data.plan_expires_at };
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

  return { isPremium: false, isPro: false, inTrial, inSoftLimit, trialDaysLeft, isLastDay, dailyLimit };
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

const userContext = new Map(); // phone -> { lastRequest, lastType, scenario, tonePreference, history[] }

// Contador diário de chamadas ao Haiku por usuário (in-memory, reseta meia-noite)
const haikuDailyUsage = new Map(); // phone -> { date: 'YYYY-MM-DD', count: number }

function getHaikuCount(phone) {
  const today = new Date().toISOString().slice(0, 10);
  const e = haikuDailyUsage.get(phone);
  return (e?.date === today) ? e.count : 0;
}

function incrementHaikuCount(phone) {
  const today = new Date().toISOString().slice(0, 10);
  const count = getHaikuCount(phone) + 1;
  haikuDailyUsage.set(phone, { date: today, count });
  return count;
}

function saveUserContext(phone, request, type) {
  const current = userContext.get(phone) || {};
  const history = current.history || [];
  // Só registra situações em texto no histórico (não imagens)
  if (type === 'text' && typeof request === 'string') {
    history.push(request.slice(0, 200)); // limita tamanho por entrada
    if (history.length > 10) history.shift(); // sliding window: máx 10
  }
  userContext.set(phone, { ...current, lastRequest: request, lastType: type, lastRequestAt: Date.now(), history });
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

// ---------------------------------------------------------------------------
// Coaching — pede contexto quando situação é vaga
// ---------------------------------------------------------------------------

// Gera próxima pergunta de contexto levando em conta o que já foi respondido
async function gerarPerguntaContexto(situacaoOriginal, qa = []) {
  const historico = qa.length > 0
    ? '\n\nO que já sei:\n' + qa.map(({ q, a }) => `- Perguntei: "${q}" → Ele disse: "${a}"`).join('\n')
    : '';
  try {
    const response = await openrouter.chat.completions.create({
      model: 'google/gemini-2.0-flash-lite-001',
      max_tokens: 80,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `Você é o MandaAssim — wingman brasileiro direto. Está coletando contexto antes de dar conselho.
Faça UMA pergunta curta e natural, como um amigo no WhatsApp.
Não repita o que já sabe. Vá para o próximo ponto importante.
NUNCA use: "massa", "incrível", "nossa", "caramba", "uau", elogios.
Sem saudação, sem comentário — só a pergunta.`,
        },
        {
          role: 'user',
          content: `Situação: "${situacaoOriginal}"${historico}\n\nQual a próxima pergunta mais importante pra entender o caso?`,
        },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ||
      'E como tá o clima entre vocês agora — ela tá fria, normal, ou sumida?';
  } catch (_) {
    return 'Me conta mais — o que rolou exatamente antes disso acontecer?';
  }
}

// Decide se já tem contexto suficiente ou precisa de mais uma pergunta (máx 3 turnos)
async function precisaDeMaisContexto(situacaoOriginal, qa) {
  if (qa.length >= 3) return false; // nunca mais de 3 perguntas
  try {
    const historico = qa.map(({ q, a }) => `P: "${q}" → R: "${a}"`).join('\n');
    const response = await openrouter.chat.completions.create({
      model: 'google/gemini-2.0-flash-lite-001',
      max_tokens: 10,
      temperature: 0,
      messages: [{
        role: 'user',
        content: `Situação: "${situacaoOriginal}"\nContexto coletado:\n${historico}\n\nTenho contexto suficiente para dar um conselho personalizado de qualidade? Responda APENAS: sim ou nao`,
      }],
    });
    const ans = (response.choices[0]?.message?.content || '').toLowerCase();
    return ans.includes('nao') || ans.includes('não');
  } catch (_) {
    return false;
  }
}

function montarContextoCoaching(situacaoOriginal, qa) {
  const linhas = [`Situação relatada: "${situacaoOriginal}"`];
  if (qa.length > 0) {
    linhas.push('\nContexto coletado em conversa:');
    qa.forEach(({ q, a }) => linhas.push(`- ${q} → "${a}"`));
  }
  return linhas.join('\n');
}

function situacaoEhVaga(situacao, temHistorico, temPerfil) {
  if (temHistorico || temPerfil) return false; // já tem contexto
  const palavras = situacao.trim().split(/\s+/).length;
  return palavras < 12; // menos de 12 palavras = provavelmente vago
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
    model: 'google/gemini-2.0-flash-001',
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
// Feature flag: decide se print analysis está habilitado para o phone
// ---------------------------------------------------------------------------

function isPrintAnalysisEnabled(phone) {
  switch (PRINT_ANALYSIS_MODE) {
    case 'all':   return true;
    case 'test':  return phone === PRINT_ANALYSIS_TEST_PHONE;
    case 'beta': {
      if (!phone) return false;
      let hash = 0;
      for (const c of phone) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
      return (Math.abs(hash) % 100) < 10;
    }
    default: return false;
  }
}

function isProfileAnalysisEnabled(phone) {
  switch (PROFILE_ANALYSIS_MODE) {
    case 'all':  return true;
    case 'test': return phone === PROFILE_ANALYSIS_TEST_PHONE;
    case 'beta': {
      if (!phone) return false;
      let hash = 0;
      for (const c of phone) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
      // Seed diferente do print para não ativar os mesmos 10%
      return (Math.abs(hash ^ 0xdeadbeef) % 100) < 10;
    }
    default: return false;
  }
}

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
      `_${todayCount}/${limit} análises usadas hoje — ${remaining} restante(s)_`
    );
  }
}

async function upsellPicoPremium(message, trial, todayCount) {
  if (trial.isPremium) return;

  // Último dia do trial + já usou 3+ mensagens hoje
  if (trial.inTrial && trial.isLastDay && todayCount >= 3) {
    await client.sendMessage(message.from,
      `Hoje é seu último dia ilimitado — e você ainda tem conversa pra resolver.\n\n` +
      `${OPCOES_PREMIUM}`
    );
    return;
  }

  // Soft limit (dias 4-5): 2 mensagens restantes
  if (trial.inSoftLimit) {
    const remaining = SOFT_LIMIT - todayCount;
    if (remaining === 2) {
      await client.sendMessage(message.from,
        `_Restam ${remaining} análises hoje._\n\n` +
        `Se quiser ilimitado: *mensal* (R$29,90) ou *anual* (R$299).`
      );
    }
    return;
  }

  // Pós-trial (dia 6+): última mensagem do dia
  if (!trial.inTrial && !trial.inSoftLimit) {
    const remaining = POST_TRIAL_LIMIT - todayCount;
    if (remaining === 1) {
      await client.sendMessage(message.from,
        `Última análise de hoje.\n\n` +
        `Se a conversa tá no ponto e não dá pra esperar até amanhã: *mensal* (R$29,90) ou *anual* (R$299).`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (Sonnet removido — usando Gemini Flash + Llama para todos os tiers)
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
async function upsellSonnetFree(message, sonnetInfo, trial) {
  // removido — mantido para não quebrar chamadas existentes
}

// ---------------------------------------------------------------------------
// Pagamento Pix
// ---------------------------------------------------------------------------

async function enviarCobrancaPixPro(message, phone) {
  try {
    const { qrCodeBase64, qrCodeText } = await criarCobrancaPix(phone, PRECO_PRO);

    await message.reply(
      `*Wingman Pro — R$79,90/mês* 🔥\n\n` +
      `Inclui:\n` +
      `• Mensagens ilimitadas\n` +
      `• Análise de print de conversa (5/dia)\n` +
      `• *Análise de Perfil* no Tinder, Bumble, Instagram (10/dia)\n\n` +
      `⚠️ Pix aparecerá no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Seguro pagar normalmente ✅`
    );

    const media = new MessageMedia('image/png', qrCodeBase64, 'pix-pro.png');
    await client.sendMessage(message.from, media);
    await client.sendMessage(message.from, qrCodeText);
    await client.sendMessage(message.from,
      `✅ Após o pagamento, você recebe confirmação aqui em menos de 1 minuto.\n\n` +
      `_Se demorar, digita *paguei* que eu verifico._`
    );

    console.log(`[Pix Pro] QR Code enviado para ${phone}`);
  } catch (err) {
    console.error('[Pix Pro] Erro:', err.message);
    await message.reply('Tive um problema ao gerar o Pix 😕\nTente novamente em instantes.');
  }
}

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

  // Detecta slug de aquisição na mensagem (ex: "mandaassim_instagram_reel_001")
  const acquisitionSlug = parseAcquisitionSlug(message.type === 'chat' ? message.body : null);

  // Boas-vindas para novos usuários (não conta no limite)
  const isNewUser = await upsertUser(phone, contactName, message.from);
  if (isNewUser) {
    saveAttribution(phone, acquisitionSlug).catch(() => {}); // fire-and-forget, nunca bloqueia
    for (const msg of WELCOME_MESSAGES) {
      await client.sendMessage(message.from, msg);
    }
    console.log(`[Boas-vindas] Enviada para: ${phone}`);
    scheduleInactiveFollowup(phone).catch(() => {});
    return;
  }

  // Slug detectado em usuário já existente — descarta silenciosamente sem sobrescrever
  if (acquisitionSlug) {
    console.log(`[Aquisição] ${phone} enviou slug mas já é usuário existente — ignorado`);
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
      if (trial.isPro) {
        const validade = trial.expiresAt ? new Date(trial.expiresAt).toLocaleDateString('pt-BR') : null;
        statusText = `🔥 *Wingman Pro* — mensagens ilimitadas + Análise de Perfil\n` +
          (validade ? `_Válido até ${validade}_` : '');
      } else if (trial.isPremium) {
        if (trial.expiresAt) {
          const validade = new Date(trial.expiresAt).toLocaleDateString('pt-BR');
          statusText = `🌟 *Wingman Premium* — mensagens ilimitadas\n_Válido até ${validade}_`;
        } else {
          statusText = '🌟 *Wingman Premium* — mensagens ilimitadas';
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

    if (cmd === 'pro' || cmd === 'wingman pro' || cmd === 'upgrade') {
      const trial = await getTrialInfo(phone);
      if (trial.isPro) {
        await message.reply('🔥 Você já é *Wingman Pro*! Pode usar todas as features à vontade.');
        return;
      }
      // Gera Pix Pro (R$79,90 padrão)
      await enviarCobrancaPixPro(message, phone);
      trackSubscriptionEvent({
        phone,
        eventType:  'upgrade_offered',
        planFrom:   trial.isPremium ? 'premium' : (trial.inTrial ? 'trial' : 'free'),
        planTo:     'pro',
        triggerCtx: 'command_pro',
      });
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
            const { plan: newPlan, days } = determinarPlano(amount);
            const expiresAt = new Date();
            if (days === 1) expiresAt.setHours(expiresAt.getHours() + 24);
            else expiresAt.setDate(expiresAt.getDate() + days);
            await Promise.all([
              supabase.from('users').update({ plan: newPlan, plan_expires_at: expiresAt.toISOString(), renewal_notified: false, winback_unlock_at: null }).eq('phone', phone),
              supabase.from('payments').update({ status: 'approved' }).eq('mp_payment_id', pagamento.mp_payment_id),
            ]);
            console.log(`[Paguei] ✅ ${newPlan} ativado via consulta MP para ${phone} (${days}d)`);
            const confirmMsg = days === 1
              ? '✅ *24h ativado!*\n\nAcesso ilimitado pelas próximas *24 horas* 🚀\n\nAproveita — manda o print agora!'
              : newPlan === 'pro'
              ? `✅ *Wingman Pro ativado!* 🔥\n\nAgora você tem Análise de Perfil + tudo mais. Manda o print do perfil dela pra testar 👇`
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
          `Hoje é seu último dia ilimitado.\n\n` +
          `Amanhã passa pra *10 análises/dia* por 2 dias, depois *3/dia*.\n\n` +
          `Quer continuar ilimitado? *mensal* (R$29,90) ou *anual* (R$299).\n\n` +
          `_Digita *status* pra ver seu plano_`
        );
      } else {
        await message.reply(
          `*${trial.trialDaysLeft} dias* de acesso ilimitado ainda. Manda o que tiver.\n\n` +
          `_Digita *status* a qualquer momento_`
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
          `Deu 3 por hoje.\n\n` +
          `Como você já usou o Premium antes: *voltar* por R$19,90 no primeiro mês _(era R$29,90)_.`
        );
      } else if (conversaQuente) {
        await message.reply(
          `Deu o limite. Se a conversa tá no ponto: *mensal* (R$29,90) ou *anual* (R$299).`
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

    // ── Resposta de desambiguação de imagem ("conversa" / "perfil") ──────────
    const ctxAmbig = getUserContext(phone);
    if (ctxAmbig?.pendingImageClassification) {
      const lower = text.toLowerCase().trim();
      const isConversaResp = /^conversa[s]?$|^print$|^chat$/.test(lower);
      const isPerfilResp   = /^perfil[s]?$|^foto$|^tinder$|^bumble$|^instagram$/.test(lower);

      if (isConversaResp || isPerfilResp) {
        const { data: imgData, mimetype: imgMime } = ctxAmbig.pendingImageClassification;
        // Limpa o estado pendente antes de processar
        const currentCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtx, pendingImageClassification: null });

        if (isConversaResp) {
          // Redireciona para análise de conversa
          if (isPrintAnalysisEnabled(phone)) {
            if (!trial.isPremium && !trial.inTrial) {
              await client.sendMessage(message.from, PRINT_UPSELL_MESSAGE);
            } else {
              const lc = checkPrintLimit(phone, trial.isPremium, trial.inTrial);
              if (!lc.allowed) {
                const msg = lc.reason === 'cooldown'
                  ? `Aguarda ${lc.remaining}s 😅`
                  : (trial.isPremium ? PRINT_LIMIT_REACHED_PREMIUM : PRINT_LIMIT_REACHED_TRIAL);
                await client.sendMessage(message.from, msg);
              } else {
                await message.reply('Lendo a conversa... ⏳');
                try {
                  const { messages: pm } = await analisarPrintConversaComHaiku(imgData, imgMime, phone);
                  incrementPrintCount(phone); setPrintLastTime(phone);
                  saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
                  for (const m of pm) await client.sendMessage(message.from, m);
                } catch (_) {
                  await client.sendMessage(message.from, 'Não consegui ler a conversa. Manda o print de novo 😅');
                }
              }
            }
          } else {
            await message.reply('Analisando a conversa... ⏳');
            try {
              const sugestoes = await analisarPrintComClaude(imgData, imgMime, '', '', '', phone);
              saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
              await enviarResposta(message, sugestoes);
            } catch (_) {
              await message.reply('Não consegui analisar. Manda o print de novo.');
            }
          }
        } else {
          // Redireciona para análise de perfil
          if (isProfileAnalysisEnabled(phone)) {
            const needsPlanCheck = PROFILE_ANALYSIS_MODE !== 'test';
            if (needsPlanCheck && !trial.isPro) {
              await client.sendMessage(message.from, PROFILE_UPSELL_MESSAGE);
            } else {
              const pl = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
              if (!pl.allowed) {
                const msg = pl.reason === 'cooldown'
                  ? `Aguarda ${pl.remaining}s 😅`
                  : PROFILE_LIMIT_REACHED_PRO;
                await client.sendMessage(message.from, msg);
              } else {
                await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
                try {
                  const { messages: pm } = await analisarPerfilComHaiku(imgData, imgMime, phone);
                  incrementProfileCount(phone); setProfileLastTime(phone);
                  saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
                  for (const m of pm) await client.sendMessage(message.from, m);
                } catch (_) {
                  await client.sendMessage(message.from, 'Não consegui ler o perfil. Manda o print de novo 😅');
                }
              }
            }
          } else {
            await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
            try {
              const sugestoes = await analisarPrintComClaude(imgData, imgMime, PROFILE_OPENER_PROMPT, '', '', phone);
              saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
              await enviarResposta(message, sugestoes);
            } catch (_) {
              await client.sendMessage(message.from, 'Não consegui analisar o perfil. Manda de novo 😅');
            }
          }
        }
        return;
      }
      // Se não for resposta de desambiguação — limpa o estado e segue o fluxo normal
      const currentCtx2 = userContext.get(phone) || {};
      userContext.set(phone, { ...currentCtx2, pendingImageClassification: null });
    }

    // Filtra saudações puras — orienta sem gastar API
    if (isSaudacao(text)) {
      await message.reply('Manda o print da conversa ou descreve o que tá rolando — eu leio o contexto e gero as opções.');
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
      await message.reply('Perfil limpo ✅\n\nNova conversa, do zero. Manda o print ou descreve a situação.');
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
      await message.reply('Anotei. Vou usar de referência nas próximas. Manda o próximo quando quiser.');
      return;
    }

    // Feedback negativo
    if (FEEDBACK_NEGATIVO.test(text)) {
      await message.reply('Nem sempre cola na primeira. Manda como ela reagiu — ajusto a abordagem.');
      return;
    }

    // Pedido de outra/mais — reutiliza contexto anterior
    if (isPedindoOutra(text)) {
      const ctx = getUserContext(phone);
      if (!ctx?.lastRequest) {
        await message.reply('Me manda a situação primeiro, aí eu gero as variações.');
        return;
      }
      const girlProfile = await getGirlProfile(phone);
      const girlContext = buildGirlContext(girlProfile);
      const monthlyCount = await getMonthlyCount(phone);
      const tier = resolveTier(trial, todayCount, monthlyCount);
      
      const stopTyping1 = await startTyping(message);
      try {
        const result = ctx.lastType === 'image'
          ? { text: await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype, '', '', girlContext, phone) }
          : await analisarTextoComClaude(ctx.lastRequest + '\n\n(Gere 3 variações COMPLETAMENTE DIFERENTES das anteriores. Mude os ângulos, metáforas e abordagens.)', '', girlContext, tier, phone, false, trial.isPremium);
        stopTyping1();
        await enviarResposta(message, result.text, result.intent);
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
      
      const stopTyping2 = await startTyping(message);
      try {
        const result = ctx.lastType === 'image'
          ? { text: await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype, `Analise essa conversa e gere 3 opções com tom "${text.trim()}". Seja fiel ao estilo pedido.`, '', girlContext, phone) }
          : await analisarTextoComClaude(`Situação: ${ctx.lastRequest}\n\nGere 3 opções com tom "${text.trim()}". Adapte completamente o estilo.`, '', girlContext, tier, phone, false, trial.isPremium);
        stopTyping2();
        saveUserContext(phone, ctx.lastRequest, ctx.lastType);
        await enviarResposta(message, result.text, result.intent);
      } catch (err) {
        stopTyping2();
        console.error('[OpenRouter] Erro ao ajustar tom:', err.message);
        await message.reply('Deu ruim aqui, tenta de novo 😅');
      }
      return;
    }

    // Análise normal
    const ctx = getUserContext(phone);

    // --- Fluxo de coaching multi-turno: usuário está respondendo uma pergunta de contexto ---
    if (ctx?.coachingState) {
      const state = ctx.coachingState;
      // Registra a resposta do usuário à última pergunta
      const qa = [...(state.qa || []), { q: state.lastQuestion, a: text }];

      const stopTypingCheck = await startTyping(message);
      const precisaMais = await precisaDeMaisContexto(state.originalRequest, qa);
      stopTypingCheck();

      if (precisaMais) {
        // Ainda precisa de mais contexto — faz mais uma pergunta
        const proximaPergunta = await gerarPerguntaContexto(state.originalRequest, qa);
        const current = userContext.get(phone) || {};
        userContext.set(phone, { ...current, coachingState: { ...state, qa, lastQuestion: proximaPergunta } });
        const stopTypingQ = await startTyping(message);
        await new Promise(r => setTimeout(r, 300));
        stopTypingQ();
        await client.sendMessage(message.from, proximaPergunta);
      } else {
        // Tem contexto suficiente — gera análise personalizada com tudo que coletou
        const current = userContext.get(phone) || {};
        userContext.set(phone, { ...current, coachingState: null });

        const situacaoCompleta = montarContextoCoaching(state.originalRequest, qa);
        const girlProfileCtx = await getGirlProfile(phone);
        const girlContextCtx = buildGirlContext(girlProfileCtx);
        const monthlyCountCtx = await getMonthlyCount(phone);
        const tierCtx = resolveTier(trial, todayCount, monthlyCountCtx);

        
        const stopTypingFinal = await startTyping(message);
        try {
          const result = await analisarTextoComClaude(situacaoCompleta, '', girlContextCtx, tierCtx, phone, false, trial.isPremium);
          stopTypingFinal();
          saveUserContext(phone, situacaoCompleta, 'text');
          await enviarResposta(message, result.text, result.intent);
          await contadorRestante(message, trial, todayCount);
          await upsellPicoPremium(message, trial, todayCount);
        } catch (err) {
          stopTypingFinal();
          console.error('[Coaching] Erro na análise final:', err.message);
          await message.reply('Deu ruim aqui, tenta de novo 😅');
        }
      }
      return;
    }

    const toneHint = ctx?.tonePreference ? `\nPreferência do usuário: ele tende a preferir tom "${ctx.tonePreference}" — leve isso em conta sem ignorar as outras opções.` : '';
    const recentSuccess = ctx?.recentSuccess || false;
    const girlProfile = await getGirlProfile(phone);
    const girlContext = buildGirlContext(girlProfile);
    const reconquistaExtra = RECONQUISTA_KEYWORDS.test(text) ? RECONQUISTA_CONTEXT : '';
    const monthlyCount = await getMonthlyCount(phone);
    const tier = resolveTier(trial, todayCount, monthlyCount);
    console.log(`[Tier] ${phone} — daily:${todayCount} monthly:${monthlyCount} → tier:${tier} recentSuccess:${recentSuccess}`);

    // --- Coaching: inicia conversa de contexto se situação for vaga ---
    const temHistorico = (ctx?.history?.length || 0) > 0;
    const temPerfil = !!(girlProfile?.girl_context || girlProfile?.current_situation);
    if (situacaoEhVaga(text, temHistorico, temPerfil)) {
      const stopTypingCtxQ = await startTyping(message);
      const primeiraPergunta = await gerarPerguntaContexto(text, []);
      stopTypingCtxQ();
      const current = userContext.get(phone) || {};
      userContext.set(phone, { ...current, coachingState: { originalRequest: text, qa: [], lastQuestion: primeiraPergunta } });
      console.log(`[Coaching] Iniciando contexto para ${phone}`);
      await client.sendMessage(message.from, primeiraPergunta);
      return;
    }

    
    const stopTyping3 = await startTyping(message);
    try {
      const result = await analisarTextoComClaude(text, toneHint, girlContext + reconquistaExtra, tier, phone, recentSuccess, trial.isPremium);
      stopTyping3();
      saveUserContext(phone, text, 'text');
      if (recentSuccess) {
        const updCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...updCtx, recentSuccess: false });
      }
      await enviarResposta(message, result.text, result.intent);
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
    const isStoryMode = STORY_KEYWORDS.test(caption);
    const ctxImg = getUserContext(phone);
    const toneHintImg = ctxImg?.tonePreference ? `\nPreferência do usuário: ele tende a preferir tom "${ctxImg.tonePreference}".` : '';
    const girlProfileImg = await getGirlProfile(phone);
    const girlContextImg = buildGirlContext(girlProfileImg);

    if (isStoryMode) {
      // ── Stories: reação ao stories dela (caption-based, sem mudança) ──────
      console.log(`[Stories] ${phone} enviou foto de stories (caption: "${caption}")`);
      await message.reply('Vendo o stories dela... ⏳');
      const stopTypingStory = await startTyping(message);
      try {
        const sugestoes = await analisarPrintComClaude(media.data, media.mimetype, STORY_PROMPT, '', girlContextImg, phone);
        stopTypingStory();
        saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');
        await enviarResposta(message, sugestoes);
        await contadorRestante(message, trial, todayCount);
        await upsellPicoPremium(message, trial, todayCount);
      } catch (err) {
        stopTypingStory();
        console.error('[Stories] Erro:', err.message);
        await message.reply('Não consegui analisar o stories, tenta mandar de novo 😅');
      }

    } else {
      // ── Camada de classificação automática (quando alguma flag está ativa) ─
      const usaClassificador = isPrintAnalysisEnabled(phone) || isProfileAnalysisEnabled(phone);

      let imageType;
      if (usaClassificador) {
        imageType = await classificarTipoImagem(media.data, media.mimetype);
        console.log(`[ImageClassifier] ${phone} → ${imageType}`);
      } else {
        // Fallback: detecção por caption (comportamento anterior)
        imageType = PROFILE_OPENER_KEYWORDS.test(caption) ? 'profile' : 'conversation';
      }

      // ── Imagem ambígua: pergunta ao usuário ─────────────────────────────
      if (imageType === 'ambiguous') {
        await client.sendMessage(message.from,
          `Isso é uma *conversa* ou o *perfil* dela? Me fala pra eu analisar certo 📱\n\n_Responde: "conversa" ou "perfil"_`
        );
        // Salva contexto para quando ele responder
        const current = userContext.get(phone) || {};
        userContext.set(phone, {
          ...current,
          pendingImageClassification: { data: media.data, mimetype: media.mimetype },
        });
        return;
      }

      // ── Perfil: Camada 2 ────────────────────────────────────────────────
      if (imageType === 'profile') {
        if (isProfileAnalysisEnabled(phone)) {
          // Novo pipeline: Haiku 4.5 vision, Wingman Pro
          const needsPlanCheck = PROFILE_ANALYSIS_MODE !== 'test';
          if (needsPlanCheck && !trial.isPro) {
            await client.sendMessage(message.from, PROFILE_UPSELL_MESSAGE);
            trackSubscriptionEvent({
              phone,
              eventType:  'upgrade_offered',
              planFrom:   trial.isPremium ? 'premium' : (trial.inTrial ? 'trial' : 'free'),
              planTo:     'pro',
              triggerCtx: 'profile_analysis',
            });
            return;
          }

          const profileLimit = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
          if (!profileLimit.allowed) {
            if (profileLimit.reason === 'cooldown') {
              await client.sendMessage(message.from,
                `Aguarda ${profileLimit.remaining}s antes de analisar outro perfil 😅`
              );
            } else if (profileLimit.reason === 'limit_reached') {
              await client.sendMessage(message.from, PROFILE_LIMIT_REACHED_PRO);
            }
            return;
          }

          const estimatedBytes = (media.data || '').length * 0.75;
          if (estimatedBytes > 10 * 1024 * 1024) {
            await client.sendMessage(message.from,
              `Esse print tá muito pesado. Tira um screenshot menor e manda de novo.`
            );
            return;
          }

          await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
          const stopTypingProfile = await startTyping(message);
          try {
            const { messages: profileMsgs } = await analisarPerfilComHaiku(media.data, media.mimetype, phone);
            stopTypingProfile();

            incrementProfileCount(phone);
            setProfileLastTime(phone);

            saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');

            for (const msg of profileMsgs) {
              await client.sendMessage(message.from, msg);
            }

            // Contador restante para Pro
            const { remaining: proRemaining } = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
            if (proRemaining <= 3) {
              await client.sendMessage(message.from,
                `_${10 - proRemaining}/10 análises de perfil usadas hoje_`
              );
            }

          } catch (err) {
            stopTypingProfile();
            console.error('[ProfileAnalysis] Erro:', err.message);
            if (err.message?.includes('muito grande')) {
              await client.sendMessage(message.from, `Esse print tá muito pesado. Tira um screenshot menor.`);
            } else {
              await client.sendMessage(message.from,
                `Não consegui ler esse perfil direito 😅\n\nManda um print mais claro — com nome, bio e pelo menos uma foto.`
              );
            }
          }

        } else {
          // Fallback: pipeline antigo (PROFILE_OPENER_PROMPT via Gemini Flash)
          console.log(`[Perfil] ${phone} enviou foto de perfil (caption: "${caption}")`);
          await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
          const stopTypingPerfilOld = await startTyping(message);
          try {
            const sugestoes = await analisarPrintComClaude(media.data, media.mimetype, PROFILE_OPENER_PROMPT, '', girlContextImg, phone);
            stopTypingPerfilOld();
            saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');
            await enviarResposta(message, sugestoes);
            await contadorRestante(message, trial, todayCount);
            await upsellPicoPremium(message, trial, todayCount);
          } catch (err) {
            stopTypingPerfilOld();
            console.error('[Perfil] Erro:', err.message);
            await message.reply('Não consegui analisar o perfil, tenta mandar de novo 😅');
          }
        }

      } else {
        // ── Conversa: Camada 1 ──────────────────────────────────────────────
        console.log(`[Imagem] ${phone} enviou um print de conversa.`);

        if (isPrintAnalysisEnabled(phone)) {
          // Novo pipeline: Haiku 4.5 vision, Wingman Premium/Trial
          if (!trial.isPremium && !trial.inTrial) {
            await client.sendMessage(message.from, PRINT_UPSELL_MESSAGE);
            return;
          }

          const limitCheck = checkPrintLimit(phone, trial.isPremium, trial.inTrial);
          if (!limitCheck.allowed) {
            if (limitCheck.reason === 'cooldown') {
              await client.sendMessage(message.from,
                `Aguarda ${limitCheck.remaining}s antes de mandar outro print 😅`
              );
            } else if (limitCheck.reason === 'limit_reached') {
              const msg = trial.isPremium ? PRINT_LIMIT_REACHED_PREMIUM : PRINT_LIMIT_REACHED_TRIAL;
              await client.sendMessage(message.from, msg);
            }
            return;
          }

          const estimatedBytes = (media.data || '').length * 0.75;
          if (estimatedBytes > 10 * 1024 * 1024) {
            await client.sendMessage(message.from,
              `Esse print tá muito pesado. Tira um screenshot menor (as últimas 5-10 mensagens) e manda de novo.`
            );
            return;
          }

          await message.reply('Lendo a conversa... ⏳');
          const stopTypingPrint = await startTyping(message);
          try {
            const { messages: printMsgs } = await analisarPrintConversaComHaiku(media.data, media.mimetype, phone);
            stopTypingPrint();

            incrementPrintCount(phone);
            setPrintLastTime(phone);

            saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');

            for (const msg of printMsgs) {
              await client.sendMessage(message.from, msg);
            }

            if (trial.isPremium) {
              const { remaining } = checkPrintLimit(phone, true, false);
              if (remaining <= 2) {
                await client.sendMessage(message.from,
                  `_${5 - remaining}/5 análises de print usadas hoje_`
                );
              }
            }

          } catch (err) {
            stopTypingPrint();
            console.error('[PrintAnalysis] Erro:', err.message);
            if (err.message?.includes('muito grande')) {
              await client.sendMessage(message.from,
                `Esse print tá muito pesado. Tira um screenshot menor e manda de novo.`
              );
            } else {
              await client.sendMessage(message.from,
                `Hmm, não consegui ler bem essa imagem. Tenta um print mais nítido da conversa, mostrando as últimas 5-10 mensagens.\n\nPode ser do Tinder, WhatsApp, Bumble, Instagram — qualquer um.`
              );
            }
          }

        } else {
          // Fallback: Gemini Flash
          const stopTypingImg = await startTyping(message);
          try {
            const sugestoes = await analisarPrintComClaude(media.data, media.mimetype, '', toneHintImg, girlContextImg, phone);
            stopTypingImg();
            saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');
            await enviarResposta(message, sugestoes);
            await contadorRestante(message, trial, todayCount);
            await upsellPicoPremium(message, trial, todayCount);
          } catch (err) {
            stopTypingImg();
            console.error('[Claude] Erro ao analisar imagem:', err.message);
            await message.reply('Não consegui ler esse print, tenta mandar de novo');
          }
        }
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

      const result = await analisarTextoComClaude(transcricao, '', girlContextAudio + reconquistaExtraAudio, tierAudio, phone, recentSuccessAudio, trial.isPremium);
      stopTypingAudio();
      saveUserContext(phone, transcricao, 'text');
      if (recentSuccessAudio) {
        const updCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...updCtx, recentSuccess: false });
      }
      await enviarResposta(message, result.text, result.intent);
      await upsellSonnetFree(message, result.sonnetInfo, trial);
      await contadorRestante(message, trial, todayCount);
      await upsellPicoPremium(message, trial, todayCount);
    } catch (err) {
      stopTypingAudio();
      console.error('[Áudio] Erro:', err.message);
      await message.reply('Não consegui processar o áudio 😅 Tenta descrever em texto.');
    }

  } else {
    await message.reply(`Manda o *texto*, um *print* ou um *áudio* — eu analiso e gero as opções.`);
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
