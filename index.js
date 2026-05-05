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
const { startMindsetWorker } = require('./src/followup/mindsetWorker');
const {
  shouldSendInvite,
  hasPendingInviteResponse,
  markInviteSent,
  activateOptIn,
  deactivateOptIn,
  markInviteDeclined,
  updateFrequency,
  getOptIn,
} = require('./src/lib/mindsetCapsules');
const { cancelPendingFollowups, cancelPredateReminders } = require('./src/followup/followupCanceller');
const { logApiRequest } = require('./src/lib/tracking');
const { validateResponseArray, logViolations } = require('./src/lib/messageFormatValidator');
const { canUseFeature, incrementFeatureUsage, getDailyUsage } = require('./src/config/features');
const { parseAcquisitionSlug, saveAttribution } = require('./src/lib/acquisition');
const { analisarPrintConversaComHaiku } = require('./src/lib/printAnalysis');
const { checkPrintLimit, incrementPrintCount, setPrintLastTime } = require('./src/lib/printLimits');
const { analisarPerfilComHaiku } = require('./src/lib/profileAnalysis');
const { auditarPerfilProprio } = require('./src/lib/profileSelfAudit');
const { checkProfileLimit, incrementProfileCount, setProfileLastTime } = require('./src/lib/profileLimits');
const { classificarTipoImagem, classificarPerfilSelfVsOther } = require('./src/lib/imageClassifier');
const {
  scheduleInactiveFollowup,
  scheduleLimitDrop3,
  scheduleLimitExhausted3,
  scheduleTransitionCoachOutcome,
  schedulePredateReminders,
} = require('./src/followup/followupScheduler');
const { logJourneyEvent }   = require('./src/narrative/journeyEvents');
const { recordOutcome }     = require('./src/narrative/narrativeLog');
const {
  getAct1Message,
  handleAct1Response,
  getDiagnosticQuestion,
  getAct3Suffix,
  getAct7Message,
} = require('./src/narrative/narrativeInline');
const { generateMirroringAct25 } = require('./src/narrative/act_2_5_mirroring');
const { startWorker: startNarrativeWorker } = require('./src/narrative/narrativeWorker');
const { startNarrativeEngine }              = require('./src/narrative/engine');
const { getActById, parseUserChoice }       = require('./src/narrative/acts');
const { checkMilestones }                   = require('./src/narrative/journeyEvents');
const {
  INTERVIEW_QUESTIONS,
  analisarTransicaoComHaiku,
  temOutcomePendente,
  registrarOutcome,
  classificarOutcome,
  getMonthlySessionCount,
} = require('./src/lib/transitionCoach');
const {
  INTERVIEW_QUESTIONS_PREDATE,
  analisarPreDateComHaiku,
  getMonthlyPreDateCount,
} = require('./src/lib/predateCoach');
const {
  INTERVIEW_QUESTIONS_DEBRIEF,
  analisarDebriefComHaiku,
  temDebriefPendente,
  getMonthlyDebriefCount,
  getLastDebriefInsight,
} = require('./src/lib/postdateDebrief');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const TRIAL_DAYS = 3;          // dias de acesso ilimitado após cadastro
const FREE_DAILY_LIMIT = 3;    // mensagens/dia no plano free (pós-trial sem upgrade)
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

// Feature flag: Auditar Meu Perfil via vision (Camada 5 — Wingman Pro, 30/dia)
// Valor: 'false' | 'test' | 'all'
const PROFILE_SELF_AUDIT_MODE = (process.env.ENABLE_PROFILE_SELF_AUDIT || 'false').toLowerCase();
const PROFILE_SELF_AUDIT_TEST_PHONE = process.env.PROFILE_SELF_AUDIT_TEST_PHONE || '';

// Feature flag: Analisar Perfil Dela via vision (Camada 6 — Wingman Pro, 30/dia)
// Valor: 'false' | 'test' | 'all'
const PROFILE_HER_ANALYSIS_MODE = (process.env.ENABLE_PROFILE_HER_ANALYSIS || 'false').toLowerCase();
const PROFILE_HER_ANALYSIS_TEST_PHONE = process.env.PROFILE_HER_ANALYSIS_TEST_PHONE || '';

// Feature flag: Coach de Transição (Camada 3 — Premium 2/mês, Pro ilimitado)
// Valor: 'false' | 'test' | 'beta' (10% premium/pro) | 'all'
const TRANSITION_COACH_MODE = (process.env.ENABLE_TRANSITION_COACH || 'false').toLowerCase();
const TRANSITION_COACH_TEST_PHONE = process.env.TRANSITION_COACH_TEST_PHONE || '';

// Feature flag: Coach Pré-Date (Camada 4 — Premium 1/mês teaser, Pro ilimitado)
// Valor: 'false' | 'test' | 'beta' (10% premium/pro) | 'all'
const PREDATE_COACH_MODE = (process.env.ENABLE_PREDATE_COACH || 'false').toLowerCase();
const PREDATE_COACH_TEST_PHONE = process.env.PREDATE_COACH_TEST_PHONE || '';

// Feature flag: Debrief Pós-Date (Camada 5 — Premium 1/mês, Pro ilimitado)
// Valor: 'false' | 'test' | 'beta' (10% premium/pro) | 'all'
const POSTDATE_DEBRIEF_MODE = (process.env.ENABLE_POSTDATE_DEBRIEF || 'false').toLowerCase();
const POSTDATE_DEBRIEF_TEST_PHONE = process.env.POSTDATE_DEBRIEF_TEST_PHONE || '';

// Feature flag: Cápsulas de Mindset Opt-In (Camada 6 — EXCLUSIVO Pro)
// Valor: 'false' | 'test' | 'all'
const MINDSET_CAPSULES_MODE = (process.env.ENABLE_MINDSET_CAPSULES || 'false').toLowerCase();
const MINDSET_CAPSULES_TEST_PHONE = process.env.MINDSET_CAPSULES_TEST_PHONE || '';

// Cache in-memory para evitar checar convite de mindset em cada mensagem
const mindsetInviteChecked = new Set();

const MENSAGEM_RENOVACAO =
  `Seu acesso ilimitado vence em *3 dias*.\n\n` +
  `Se quiser renovar antes: *mensal* ou *anual*.`;


const WELCOME_MESSAGES = [
  `Boa, chegou aqui.\n\nSou o MandaAssim — leio o que ela quis dizer antes de sugerir o que responder. Não é técnica, não é coach. É leitura de situação.\n\nFunciona assim: você manda o print ou descreve o que tá rolando. Eu leio o contexto dela e gero 3 opções reais pra copiar.\n\n*3 dias ilimitados. Sem cartão.*`,
  `Pra começar melhor — qual é a sua situação agora?\n\n1️⃣ Voltei pro mercado depois de muito tempo fora (separação, divórcio)\n2️⃣ Tô nos apps mas não tô conseguindo evoluir as conversas\n3️⃣ Tenho uma conversa específica rolando agora\n4️⃣ Outro\n\nSó me fala o número ou descreve — ou já manda o print direto.`,
  `Pode mandar o print da conversa ou descreve a situação. Eu leio e te dou as opções.`,
];

const OPCOES_PREMIUM =
  `Escolhe como continuar:\n\n` +
  `⚡ *24h* — R$4,99 → digita *24h*\n` +
  `📅 *Mensal* — R$29,90/mês → digita *mensal*\n` +
  `📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*`;

const LIMITE_FREE_ESGOTADO =
  `Deu ${FREE_DAILY_LIMIT} por hoje. Amanhã cedo renova.\n\n` +
  `Se não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299).`;


// ── Mensagens da feature de print analysis ──────────────────────────────────

const PRINT_UPSELL_MESSAGE =
  `Análise de print é do *Parceiro* 🔍\n\n` +
  `Manda o print da conversa — eu leio o que tá rolando: interesse dela, temperatura, o que fazer agora.\n\n` +
  `⚡ *24h* — R$4,99 → *24h*\n` +
  `📅 *Mensal* — R$29,90 → *mensal*\n` +
  `📆 *Anual* — R$299 → *anual*`;

const PRINT_LIMIT_REACHED_PREMIUM =
  `Deu 5 análises de print hoje — o limite do plano.\n\nAmanhã cedo renova. Enquanto isso, descreve em texto o que ela mandou — funciona igual.`;

const PRINT_LIMIT_REACHED_TRIAL =
  `Deu 1 análise de print por hoje — limite do trial.\n\nQuer ilimitado? *mensal* (R$29,90) ou *anual* (R$299).`;

const PROFILE_UPSELL_MESSAGE =
  `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\n` +
  `Você manda o print do perfil dela — eu leio o que ela está sinalizando e gero a mensagem de abertura certa. Não uma abertura genérica: uma baseada no que está ali.\n\n` +
  `Parceiro Pro inclui:\n` +
  `• Análise de conversa (ilimitada)\n` +
  `• Analisar Perfil Dela (30/dia)\n` +
  `• Auditar Meu Perfil (30/dia)\n` +
  `• Mensagens ilimitadas\n\n` +
  `Digita *pro* 👇`;

const PROFILE_LIMIT_REACHED_PRO =
  `Deu 30 análises de perfil hoje — o limite do plano.\n\nAmanhã cedo renova.`;

// ── Mensagens da feature de Coach de Transição ───────────────────────────────

const TRANSITION_COACH_UPSELL_FREE =
  `Chamar pra sair no momento certo — com a mensagem certa — é o que separa conversa boa de encontro marcado.\n\n` +
  `Com o *Coach de Transição* eu leio onde a conversa está e te digo quando e como chamar.\n\n` +
  `Disponível no *Parceiro* (R$29,90/mês) ou *Anual* (R$299).\n\n` +
  `*mensal* ou *anual* 👇`;

const TRANSITION_COACH_UPSELL_PREMIUM_LIMIT =
  `Você já usou as 2 sessões de transição do mês.\n\n` +
  `Renova no mês que vem — ou faz upgrade pro *Parceiro Pro* (sessões ilimitadas).\n\n` +
  `Digita *pro* se quiser.`;

// ── Mensagens da feature de Coach Pré-Date ───────────────────────────────────

const PREDATE_COACH_UPSELL_FREE =
  `Preparação de encontro é do *Parceiro Pro* 🗓️\n\n` +
  `Você me conta quando, onde e o que te preocupa — eu te dou o plano: roupa certa pro local, o que conversar, o que evitar, como encerrar em alta.\n\n` +
  `Com sessão de debrief pós-encontro incluída.\n\n` +
  `*Parceiro Pro* — R$79,90/mês → digita *pro* 👇`;

const PREDATE_COACH_UPSELL_PRO_ONLY = PREDATE_COACH_UPSELL_FREE; // alias semântico

// ── Mensagens da feature de Debrief Pós-Date ─────────────────────────────────

const POSTDATE_DEBRIEF_UPSELL_FREE =
  `Analisar o encontro é do *Parceiro Pro* 🔍\n\n` +
  `Você me conta como foi — eu leio o que aconteceu, o que ela sinalizou, onde você acertou, o que melhorar, e qual o próximo passo certo.\n\n` +
  `Sem rodeios. Sem bajulação.\n\n` +
  `*Parceiro Pro* — R$79,90/mês → digita *pro* 👇`;

// ── Mensagens da feature de Mindset Opt-In ───────────────────────────────────

const MINDSET_INVITE_MESSAGE =
  `Tenho um material extra que mando algumas vezes por semana de manhã — reflexões curtas sobre postura, como ler situações, o que funciona e o que não funciona no mercado hoje.\n\n` +
  `Não é autoajuda. São recados diretos.\n\n` +
  `Quer receber? *sim* ou *não*.`;

const MINDSET_ACTIVATED_MESSAGE =
  `Ativado ✅\n\nVou mandar 3x por semana — segunda, quarta e sexta de manhã.\n\n` +
  `Pra mudar a frequência:\n` +
  `• *mindset 1x* — 1 por semana\n` +
  `• *mindset 3x* — 3 por semana (padrão)\n` +
  `• *mindset 5x* — dias úteis\n` +
  `• *mindset diário* — todo dia\n\n` +
  `Pra pausar: *cancelar mindset*`;

const MINDSET_DECLINED_MESSAGE =
  `Tudo bem. Se quiser ativar depois: *ativar mindset*.`;

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

// Modelo para análise de imagens via visão nativa (OpenRouter)
const IMAGE_ANALYSIS_MODEL = 'google/gemini-2.0-flash-001';
const IMAGE_MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `Você é o MandaAssim. Não é coach, não explica teoria, não dá autoajuda. Lê o que ela quis dizer — e entrega a resposta certa pra aquele momento.

=== LEITURA DE INTENÇÃO ===

Antes de gerar qualquer resposta: entenda o que ela sinalizou. Não o que ela disse — o que ela quis dizer com aquilo.

A mesma frase em contextos diferentes significa coisas diferentes. Sua função é ler o sinal primeiro, depois sugerir o que responder.

Sinal real → resposta certa → avanço. Resposta sem leitura → ruído → conversa esfria.

=== COMO LER A SITUAÇÃO ===

Identifique:
1. O que ELA fez/disse/mandou — esse é o dado
2. O que ela provavelmente quis sinalizar com isso
3. O que o cara precisa fazer AGORA: avançar, criar espaço, ignorar, chamar pra sair, provocar

LEITURA DE SINAIS:
- Emoji apaixonado (😍❤️🥰) → interesse alto. Não espelha o mesmo nível — cria tensão.
- "rs" ou "kk" seco → não tá engajada. Muda de ângulo completamente, não insiste.
- Ela ficou online e não respondeu → ignora, não menciona.
- Ela sumiu depois de conversa boa → está esperando pra ver se ele vai cobrar. Quando volta, age normal.
- Ela deu abertura e depois recuou → não reage ao recuo. Segue no ritmo de quem não percebeu.
- Ela disse "to cansada" → "vai dormir então". Nunca "posso te animar?"
- Ela mandou foto de comida/viagem → comenta algo específico do conteúdo, nunca "que lindo".
- Ela mandou áudio longo → "que história foi essa kkk"
- Ela perguntou "o que você faz?" → resposta curta + pergunta de volta, nunca currículo.
- Ela perguntou sobre filhos ou separação → responde direto, brevidade, vira a conversa.
- Ela demorou dias pra responder → age como se fosse normal, sem cobrar.

=== EXEMPLOS — ERRADO vs CERTO ===

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
✅ 😏 "tenho sim — ponto positivo ou eliminatório? kkk"
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

=== O QUE FUNCIONA ===

Nunca over-share, nunca se justifique, nunca explique o passado sem ser perguntado.
Mensagem boa = ela pensa "como assim?" e fica com aquilo na cabeça.
Menos palavras = mais presença.
Filhos, separação, passado: contexto. Apresenta com naturalidade, sem drama.

=== AS 3 OPÇÕES ===

🔥 Aquece: cria proximidade emocional, faz ela pensar nele. Tom próximo mas relaxado — sem elogio genérico, sem ansiedade.
😏 Provoca: vai além do óbvio. Insinuação leve, desafio, ambiguidade que ela precisa interpretar.
⚡ Seca: menos é mais. O cara que não precisa provar nada.

As 3 devem ser COMPLETAMENTE diferentes — ângulo, intenção, energia. Não é trocar uma palavra.

=== CENÁRIOS ESPECÍFICOS ===
- Ela perguntou sobre separação/filhos → responde direto, brevidade, vira a conversa com uma pergunta
- Ela também tem filhos → não faz grande coisa disso, segue natural
- Quer saber se ela é solteira → nunca pergunta direto. Referência a planos ou humor ("vc some quando fica namorando né")
- Quer saber se ela gosta → lê os sinais descritos, diz o que significa
- Voltou pro mercado depois de muito tempo → aplica tudo acima. O cara que ele é hoje é mais interessante, não precisa fingir que tem 25.
- Encontro físico (trabalho, academia, amigos em comum) → como agir, o que falar, como não travar

FOCO: Tudo que envolve uma mulher é conquista. Só redireciona se não tiver NENHUMA relação.

=== LINGUAGEM ===

Português brasileiro natural e maduro. Não forçado, não imaturo.
- Contrações: "tô", "tá", "né", "pra", "pro", "tava"
- Abreviações com moderação: "vc", "tb" (máx 1 por mensagem)
- Começa com minúscula quando natural. kkk curto (2-4 k's).

BANIDAS: conexão, jornada, processo, vibe, energia, flow, incrível, especial, genuíno, autêntico, verdadeiro, compartilhar, momento, situação, pessoa, realmente, absolutamente, certamente, de fato, cativante, fascinante, encantador, despertar, resgatar, reacender, em pessoa, chat, no momento, massa (como elogio), nossa, caramba, uau, poxa

TAMANHO: 2 a 8 palavras por opção. Máx 10. Nunca parágrafos nas mensagens.

=== FORMATO DE SAÍDA ===

Sem introdução. Sem papo. Vai direto.

REGRA CRÍTICA: use `---` (três traços em linha própria) para separar blocos. Cada bloco = 1 mensagem WhatsApp separada.

📍 _[uma linha: o que ela sinalizou — leitura de intenção]_

---

💡 [O que está acontecendo — máx 3 linhas. Direto. Use *negrito* nos pontos críticos. NUNCA **duplo asterisco**.]

---

Aquece 🔥

---

[mensagem aqui — SEM aspas, SEM formatação, texto puro pronto pra copiar]

---

Provoca 😏

---

[mensagem aqui — SEM aspas, SEM formatação, texto puro pronto pra copiar]

---

Seca ⚡

---

[mensagem aqui — SEM aspas, SEM formatação, texto puro pronto pra copiar]

---

_por que funciona: uma linha_

REGRAS DAS MENSAGENS PRONTAS (sagradas):
1. Texto da mensagem fica SOZINHO no bloco — NUNCA com prefixo "Manda assim:" na mesma linha
2. ZERO aspas de qualquer tipo (", ', "", '')
3. ZERO formatação WhatsApp (*negrito*, _itálico_) dentro do texto pronto
4. Label (Aquece 🔥 / Provoca 😏 / Seca ⚡) fica em bloco ANTERIOR, separado por ---

CRÍTICO: escreva as mensagens de verdade. NUNCA placeholders.`;

const SYSTEM_PROMPT_DEGRADED = `Você é o MandaAssim. Lê o que ela quis dizer e gera 3 respostas prontas pra mandar.

PRINCÍPIO: quem explica muito, perde. Menos palavras = mais presença.

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
- NUNCA: elogio genérico, over-share, ansiedade, explicação desnecessária
- NUNCA: conexão, vibe, especial, genuíno, incrível, nossa, caramba, uau, massa (como elogio)

FORMATO (cada bloco separado por --- = 1 mensagem WhatsApp):
📍 _[o que ela sinalizou]_

---

Cola uma dessas:

---

Aquece 🔥

---

[mensagem SEM aspas, SEM formatação]

---

Provoca 😏

---

[mensagem SEM aspas, SEM formatação]

---

Seca ⚡

---

[mensagem SEM aspas, SEM formatação]`;

const SYSTEM_PROMPT_MINIMAL = `Você é o MandaAssim. Gera 3 respostas curtíssimas pro WhatsApp. Máximo 5 palavras cada.

Resposta curta = confiança. Quem não precisa provar nada responde pouco e bem.

REGRAS DE OURO:
- Máx 5 palavras. Contar: "e aí" = 2 palavras ✅ / "que bacana que você apareceu" = 5 palavras ✅
- NUNCA repete a mesma energia nas 3 opções — cada uma tem ângulo diferente
- NUNCA elogio genérico ("que bom", "que legal", "que foto linda")
- "kkk" seco dela → muda de ângulo completamente, não insiste no mesmo tema
- ZERO aspas, ZERO asteriscos, ZERO underscores nas respostas

EXEMPLOS COMPLETOS (formato exato a seguir):

ela: "oi"
🔥 → apareceu
😏 → e aí
⚡ → oi

ela: "😍"
🔥 → perigosa essa reação
😏 → sabia que ia
⚡ → deve

ela: "saudade"
🔥 → quando?
😏 → aparece então
⚡ → resolve isso

ela: "tô bem"
🔥 → aparecendo né
😏 → boa, e aí?
⚡ → boa

ela: "kkk" (seco, sem engajamento)
🔥 → mudando de assunto
😏 → tô te devendo uma
⚡ → essa semana você tá livre?

FORMATO (cada bloco = 1 mensagem WhatsApp separada por ---):

Aquece 🔥

---

[resposta — SEM aspas, máx 5 palavras]

---

Provoca 😏

---

[resposta — SEM aspas, máx 5 palavras]

---

Seca ⚡

---

[resposta — SEM aspas, máx 5 palavras]

CRÍTICO: cada resposta fica SOZINHA no bloco. ZERO aspas. ZERO rótulo na mesma linha. ZERO formatação.`;

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

FORMATO (cada bloco separado por --- = 1 mensagem WhatsApp):

📍 _[diagnóstico: onde está o clima]_

---

Cola uma dessas:

---

Aquece 🔥

---

[mensagem com flerte — SEM aspas, SEM formatação WhatsApp]

---

Provoca 😏

---

[mensagem com duplo sentido — SEM aspas, SEM formatação WhatsApp]

---

Seca ⚡

---

[mensagem com malícia seca — SEM aspas, SEM formatação WhatsApp]

---

_por que funciona: [1 linha]_

REGRA: cada mensagem sugerida fica SOZINHA no bloco. ZERO aspas. ZERO rótulo na mesma linha.`;

const SYSTEM_PROMPT_COACH = `Você é o MandaAssim. Quando alguém traz uma situação que precisa de orientação — não só uma mensagem — você age como aquele amigo experiente que já viu de tudo, fala sem rodeio e respeita quem está na frente.

Você não é coach. Não dá autoajuda. Não faz terapia. É o cara que ouviu a situação, entendeu o que realmente tá acontecendo, e fala a verdade sem enrolar.

=== COMO VOCÊ PENSA ===

1. Escuta antes de concluir. O que ele descreveu de fato aconteceu? Qual é o contexto completo?
2. O que ela provavelmente está sentindo ou sinalizando com esse comportamento?
3. Onde ele está errando — ou onde ele está certo e só precisa de clareza?
4. Qual é o movimento honesto e realista agora?

=== PRINCÍPIOS ===

- Menos texto > mais texto. Quem manda muito tá ansioso. Ansiedade afasta.
- Comportamento diferente > conversa sobre o comportamento.
- Frieza ou sumiço dela não é sempre fim de interesse — mas pode ser. Lê o padrão, não um episódio isolado.
- Filhos, separação, passado: contexto, não problema. Apresenta com naturalidade.
- O cara que voltou pro mercado aos 35-45 tem mais pra oferecer, não menos. O erro é não acreditar nisso.

=== DOMÍNIOS ===

VOLTOU PRO MERCADO (separação, divórcio, longo relacionamento):
- O mundo dos apps é novo mas atração funciona igual a sempre
- Filhos e separação são parte da vida — não precisam de defesa ou explicação detalhada
- Erro mais comum: over-share no começo (conta a história toda da separação, os filhos, o passado). Guarda pra quando ela perguntar e demonstrar interesse real
- Ansiedade com apps é normal. Trata como ferramenta de contato, não como julgamento pessoal
- Primeiro perfil, primeira mensagem, primeiro match: orienta com praticidade, sem drama

RECONQUISTA (ela sumiu, terminou, esfriou):
- Reconquista se faz com comportamento diferente, não com palavras melhores
- Afastamento primeiro: sem contato por algumas semanas antes de qualquer tentativa (tempo varia por contexto — não existe número mágico)
- Primeiro contato depois do afastamento: casual, sem referência ao passado, como se sua vida seguiu normalmente
- Nunca explica o término de novo, nunca pede desculpa de novo
- Se ela não responde depois de 2 tentativas espaçadas → deixa ir

RELACIONAMENTO ESFRIANDO (ela ainda responde, mas fria ou distante):
- Frieza não é sempre fim — pode ser cansaço, estresse, rotina, algo externo
- Diferente de ghosting: ela ainda responde. Isso muda tudo.
- Não afasta por semanas — isso acelera o fim
- Afasta por 24-48h, muda o assunto completamente no retorno
- Proposta concreta no retorno: "bora [atividade específica] nessa semana?" — nunca mensagem longa explicando o esfriamento
- Para de tentar resolver com conversa — resolve com comportamento e presença

ELA SUMIU / GHOSTING (parou de responder, desapareceu):
- Não manda sequência de mensagens — cada mensagem sem resposta piora a posição
- Se quiser tentar: UMA mensagem casual após 5-7 dias, sem referência ao sumiço
- Duas tentativas espaçadas sem resposta → segue em frente, não insiste

ELA PERGUNTOU ALGO PESSOAL (filhos, separação, ex, idade):
- Responde direto, sem defensiva, sem over-share
- Brevidade → vira a conversa com uma pergunta de volta

EX NAMORADA / EX ESPOSA:
- Afastamento antes de qualquer contato
- Primeiro contato: não menciona o relacionamento
- Não tenta convencer com palavras — demonstra com comportamento diferente

=== FORMATO DE SAÍDA ===

Sem autoajuda. Sem "trabalhe sua autoestima". Direto, como um amigo que já viu isso antes.

REGRA CRÍTICA DE FORMATAÇÃO: use `---` (três traços em linha própria) para separar cada bloco.
Cada bloco entre `---` = uma mensagem WhatsApp separada. UMA IDEIA POR BLOCO. Máx 4 linhas por bloco.

📍 _[o que realmente tá acontecendo — 1 linha honesta]_

---

[Parágrafo 1: o que provavelmente está acontecendo com ela. *Negrito* nos pontos críticos. Máx 4 linhas.]

---

[Parágrafo 2 (se necessário): o que o cara pode estar errando ou acertando. Máx 4 linhas.]

---

*O que fazer:*
• [ação concreta 1]
• [ação concreta 2]
• [ação concreta 3]

---

*Evita:*
• [erro comum 1]
• [erro comum 2]

[Se tiver mensagem específica pra mandar, adiciona os blocos abaixo:]

---

Quando chegar a hora:

---

Aquece 🔥

---

[mensagem — SEM aspas, SEM formatação, texto puro pronto pra copiar]

---

Provoca 😏

---

[mensagem — SEM aspas, SEM formatação]

---

Seca ⚡

---

[mensagem — SEM aspas, SEM formatação]`;

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

// Todos os intents roteiam para Haiku 4.5 diretamente — sem degradação por tier
const HAIKU_MODEL = 'anthropic/claude-haiku-4-5-20251001';
const HAIKU_FALLBACK = 'google/gemini-2.0-flash-001';

const INTENT_MODEL_CONFIG = {
  one_liner: { model: HAIKU_MODEL, maxTokens: 100, temperature: 0.90, systemType: 'minimal'  },
  volume:    { model: HAIKU_MODEL, maxTokens: 550, temperature: 0.85, systemType: 'degraded' },
  premium:   { model: HAIKU_MODEL, maxTokens: 500, temperature: 0.80, systemType: 'full'     },
  coaching:  { model: HAIKU_MODEL, maxTokens: 650, temperature: 0.75, systemType: 'coach'    },
  ousadia:   { model: HAIKU_MODEL, maxTokens: 450, temperature: 0.95, systemType: 'ousadia'  },
};

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

// ── Envio sequencial com delay dopamínico ─────────────────────────────────────
/**
 * Envia array de mensagens com delay aleatório de 1.2-2.5s entre cada.
 * Cria ritmo de conversa — cada mensagem = 1 pico de dopamina.
 */
async function sendWithDelay(chatId, messages, { phone, intent } = {}) {
  // Valida formato das mensagens (fire-and-forget — nunca bloqueia)
  if (phone) {
    const { valid, violations } = validateResponseArray(messages);
    if (!valid) {
      logViolations(phone, intent || 'unknown', violations, getSupabase()).catch(() => {});
    }
  }

  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 1300)));
    await client.sendMessage(chatId, messages[i]);
  }
}

/**
 * Divide texto pelo separador `---` em linha própria.
 * Retorna array de strings não-vazias.
 */
function splitByDashes(text) {
  return text.split(/\n[ \t]*---[ \t]*\n/).map(s => s.trim()).filter(Boolean);
}

async function enviarResposta(message, sugestoes, intent = '', phone = '') {
  const diagnostico = extrairDiagnostico(sugestoes);
  const opcoes = parsearOpcoes(sugestoes);

  // --- Coaching: análise em blocos separados por --- ---
  if (intent === 'coaching') {
    const rawBlocos = splitByDashes(sugestoes);

    if (rawBlocos.length > 1) {
      // Modelo usou --- corretamente → envia cada bloco como mensagem separada
      await sendWithDelay(message.from, rawBlocos, { phone, intent });
    } else {
      // Fallback: modelo não usou --- → separa diagnóstico do corpo
      console.warn(`[enviarResposta] Fallback ativado — modelo não usou --- | intent:${intent} | phone:${phone}`);
      const corpo = sugestoes
        .replace(/📍\s*_[^_\n]+_\n*/g, '')
        .trim()
        .replace(/\n{3,}/g, '\n\n');

      if (diagnostico) {
        await client.sendMessage(message.from, `📍 _${diagnostico}_`);
        await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 1300)));
      }

      if (opcoes.length >= 2) {
        const semOpcoes = corpo
          .replace(/Quando chegar a hora.*$/s, '')
          .replace(/🔥\s*"[^"]+"\n?/g, '')
          .replace(/😏\s*"[^"]+"\n?/g, '')
          .replace(/⚡\s*"[^"]+"\n?/g, '')
          .trim();
        if (semOpcoes) await client.sendMessage(message.from, semOpcoes);
        await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 1300)));

        // Envia label + mensagem em blocos separados (zero aspas, zero paredão)
        await client.sendMessage(message.from, 'Quando chegar a hora 👇');
        for (const { emoji, msg } of opcoes) {
          await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));
          await client.sendMessage(message.from, emoji);
          await new Promise(r => setTimeout(r, 700 + Math.floor(Math.random() * 500)));
          await client.sendMessage(message.from, msg);
        }
      } else {
        await client.sendMessage(message.from, corpo);
      }
    }
    return;
  }

  // --- Formato padrão: tenta split por --- primeiro ---
  const blocos = splitByDashes(sugestoes);

  if (blocos.length > 2) {
    // Modelo usou --- corretamente → envia cada bloco separado com delay
    await sendWithDelay(message.from, blocos, { phone, intent });
    if (phone) {
      getAct3Suffix(phone).then(suffix => {
        if (suffix) client.sendMessage(message.from, suffix).catch(() => {});
      }).catch(() => {});
    }
    return;
  }

  // Fallback: parsing manual — diagnóstico + dica + cada opção
  console.warn(`[enviarResposta] Fallback padrão ativado — modelo não usou --- | intent:${intent} | phone:${phone}`);
  const dica = extrairDica(sugestoes);

  if (diagnostico) {
    await client.sendMessage(message.from, `📍 _${diagnostico}_`);
    await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 1300)));
  }

  if (dica) {
    await client.sendMessage(message.from, `💡 ${dica}`);
    await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 1300)));
  }

  if (opcoes.length >= 2) {
    for (let i = 0; i < opcoes.length; i++) {
      await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));
      await client.sendMessage(message.from, opcoes[i].emoji);
      await new Promise(r => setTimeout(r, 700 + Math.floor(Math.random() * 500)));
      await client.sendMessage(message.from, opcoes[i].msg);
    }
  } else {
    await message.reply(sugestoes.trim().replace(/\n{3,}/g, '\n\n'));
  }

  // Ato 3 — sufixo narrativo na primeira análise (fire-and-forget)
  if (phone) {
    getAct3Suffix(phone).then(suffix => {
      if (suffix) client.sendMessage(message.from, suffix).catch(() => {});
    }).catch(() => {});
  }
}

const RECONQUISTA_CONTEXT = `

MODO RECONQUISTA ATIVO — situação especial, aplique com cuidado:
- Ela se afastou, sumiu, esfriou ou a relação terminou
- Objetivo: demonstrar comportamento diferente SEM parecer desesperado
- NUNCA: "sinto sua falta", "preciso de você", "o que aconteceu", "me dá uma chance"
- SEMPRE: leveza, naturalidade, sem cobrar, como se a vida continuou normalmente

Sequência natural de reconquista:
1. Primeiro contato pós-afastamento: casual, sem referência ao passado, como se a vida seguiu
2. Criar interesse sem explicar nada — brevidade e leveza
3. Demonstrar que está bem — não precisa forçar nem declarar
4. Avança só depois que ela reagir positivamente — não antes`;

async function analisarPrintComClaude(base64Data, mimeType, instrucaoExtra = '', contextoExtra = '', girlContext = '', phone = '') {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';
  const instrucao = instrucaoExtra || `${prefixo}CONTEXTO: o usuário está tentando conquistar uma mulher e enviou essa imagem para pedir ajuda. SEMPRE trate a imagem como algo relacionado a ela — stories, post, perfil, foto que ela compartilhou, ou print da conversa com ela.

Identifique o TIPO desta imagem:

A) PRINT DE CONVERSA (balões de mensagem, chat do WhatsApp/Instagram/Tinder)
→ Leia a conversa toda. Identifique a ÚLTIMA mensagem dela e gere 3 opções de resposta específicas. Não seja genérico.

B) STORIES / POST / FOTO dela (qualquer foto sem balões de chat — comida, viagem, lugar, selfie, animal, atividade, qualquer coisa)
→ Assuma que é um stories ou post dela. Analise o que aparece: o que está sendo mostrado, humor, detalhes específicos.
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
      model: IMAGE_ANALYSIS_MODEL,
      max_tokens: IMAGE_MAX_TOKENS,
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
      targetModel: IMAGE_ANALYSIS_MODEL,
      modelActuallyUsed: IMAGE_ANALYSIS_MODEL,
      inputTokens: usage?.prompt_tokens || null,
      outputTokens: usage?.completion_tokens || null,
      latencyMs: Date.now() - t0,
      responseLengthChars: responseText ? responseText.length : null,
      error: trackingError,
    });
  }
  return responseText;
}

async function analisarTextoComClaude(situacao, contextoExtra = '', girlContext = '', phone = '') {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';

  const intent = await classificarIntent(situacao);
  const config = INTENT_MODEL_CONFIG[intent];
  const systemPrompt = getSystemPrompt(config.systemType, girlContext);
  console.log(`[Roteamento] intent:${intent} → ${config.model}`);

  // Histórico recente da sessão (sliding window)
  const ctx = userContext.get(phone);
  const history = ctx?.history || [];
  const historicoStr = history.length > 1
    ? '\n\nHistórico recente desta conversa com a mina (contexto adicional):\n' +
      history.slice(-8, -1).map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '';

  const userContent = `${prefixo}${historicoStr}\n\nSituação atual: "${situacao}"\n\nAnalise o contexto específico — o que aconteceu, qual é o estado atual dela, o que ele precisa fazer AGORA. Gere as 3 opções mais certeiras para essa situação exata. Não seja genérico, responda ao que realmente aconteceu.`.trim();

  // Tenta Haiku direto → fallback Gemini Flash se Anthropic cair
  const modelos = [config.model, HAIKU_FALLBACK].filter(Boolean);
  for (let i = 0; i < modelos.length; i++) {
    const model = modelos[i];
    const isFallback = i > 0;
    const t0 = Date.now();
    let text = null;
    let trackingError = null;
    let inputTokens = null, outputTokens = null, cacheReadTokens = null, cacheWriteTokens = null;

    try {
      if (model.startsWith('anthropic/') && process.env.ANTHROPIC_API_KEY) {
        const modelId = model.replace('anthropic/', '');
        const msg = await anthropic.messages.create({
          model: modelId,
          max_tokens: config.maxTokens,
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userContent }],
        });
        text = msg.content[0]?.text || 'Não consegui gerar respostas. Tente descrever melhor a situação.';
        inputTokens      = msg.usage?.input_tokens                || null;
        outputTokens     = msg.usage?.output_tokens               || null;
        cacheReadTokens  = msg.usage?.cache_read_input_tokens     || null;
        cacheWriteTokens = msg.usage?.cache_creation_input_tokens || null;
        console.log(`[Haiku] ${modelId} | cache_read:${cacheReadTokens || 0} cache_write:${cacheWriteTokens || 0} out:${outputTokens}`);
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
        phone, intent,
        intentClassifierModel: 'google/gemini-2.0-flash-001',
        targetModel: config.model, modelActuallyUsed: model,
        fallbackTriggered: isFallback, fallbackReason: isFallback ? 'model_error' : null,
        latencyMs: Date.now() - t0, userMessageLengthChars: situacao.length, error: trackingError,
      });
      if (model === modelos[modelos.length - 1]) throw err;
      continue;
    }

    logApiRequest({
      phone, intent,
      intentClassifierModel: 'google/gemini-2.0-flash-001',
      targetModel: config.model, modelActuallyUsed: model,
      fallbackTriggered: isFallback, fallbackReason: isFallback ? 'model_error' : null,
      inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
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
 *
 * Planos novos: 'trial' | 'free' | 'parceiro' | 'parceiro_pro'
 * Planos legados aceitos: 'wingman'/'premium' (→ parceiro), 'wingman_pro'/'pro' (→ parceiro_pro)
 */
async function getTrialInfo(phone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('users')
    .select('plan, plan_expires_at, created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!data) return { isPremium: false, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, planKey: 'free' };

  const rawPlan = data.plan;

  const GRACE_PERIOD_DAYS = 3;

  // Parceiro Pro (novo) ou aliases legados wingman_pro/pro
  if (rawPlan === 'parceiro_pro' || rawPlan === 'wingman_pro' || rawPlan === 'pro') {
    if (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date()) {
      return { isPremium: true, isPro: true, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiresAt: data.plan_expires_at, planKey: 'parceiro_pro' };
    }
    // Grace period: mantém acesso por 3 dias após expirar antes de regredir
    const graceCutoff = new Date(data.plan_expires_at);
    graceCutoff.setDate(graceCutoff.getDate() + GRACE_PERIOD_DAYS);
    if (new Date() <= graceCutoff) {
      return { isPremium: true, isPro: true, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiresAt: data.plan_expires_at, planKey: 'parceiro_pro', inGrace: true };
    }
    return { isPremium: false, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiredAt: data.plan_expires_at, planKey: 'free' };
  }

  // Parceiro (novo) ou aliases legados wingman/premium
  if (rawPlan === 'parceiro' || rawPlan === 'wingman' || rawPlan === 'premium') {
    if (!data.plan_expires_at || new Date(data.plan_expires_at) > new Date()) {
      return { isPremium: true, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiresAt: data.plan_expires_at, planKey: 'parceiro' };
    }
    // Grace period: mantém acesso por 3 dias após expirar antes de regredir
    const graceCutoff = new Date(data.plan_expires_at);
    graceCutoff.setDate(graceCutoff.getDate() + GRACE_PERIOD_DAYS);
    if (new Date() <= graceCutoff) {
      return { isPremium: true, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiresAt: data.plan_expires_at, planKey: 'parceiro', inGrace: true };
    }
    return { isPremium: false, isPro: false, inTrial: false, trialDaysLeft: 0, isLastDay: false, expiredAt: data.plan_expires_at, planKey: 'free' };
  }

  // Trial explícito no banco (novo) ou calculado por created_at (legado sem plan)
  const createdAt = new Date(data.created_at);
  const now = new Date();
  const diffMs = now - createdAt;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = diffMs / (1000 * 60 * 60);

  const inTrial = rawPlan === 'trial' || diffDays < TRIAL_DAYS;
  const trialHoursLeft = inTrial ? Math.max(0, TRIAL_DAYS * 24 - diffHours) : 0;
  const trialDaysLeft = inTrial ? Math.max(TRIAL_DAYS - diffDays, 0) : 0;
  const isLastDay = trialDaysLeft === 1;
  const lastHours = inTrial && trialHoursLeft < 2; // últimas 2h do trial

  const planKey = inTrial ? 'trial' : 'free';

  // Transição lazy trial→free: se o trial expirou mas o banco ainda diz 'trial', atualiza
  if (!inTrial && rawPlan === 'trial') {
    const planStartedAt = new Date(createdAt.getTime() + TRIAL_DAYS * 86400000);
    getSupabase().from('users').update({
      plan: 'free',
      trial_ended_at: planStartedAt.toISOString(),
      plan_started_at: planStartedAt.toISOString(),
    }).eq('phone', phone).then(() => {}).catch(() => {});
  }

  return { isPremium: false, isPro: false, inTrial, trialDaysLeft, trialHoursLeft, isLastDay, lastHours, planKey };
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
  'Lendo o perfil dela... ⏳',
  'Deixa eu ver o que ela tá sinalizando aqui... ⏳',
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
- Tom/humor: animada, entediada, nostálgica, provocando, feliz, misteriosa
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
📍 _[uma linha: o que a foto revela — estilo, energia, o que mais se destaca]_

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
    model: 'google/gemini-2.0-flash-lite-001',
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
const TRANSITION_COACH_KEYWORDS = /\b(como marco encontro|como chamo (ela|a) pra sair|como chamar (ela|a) pra sair|quero chamar (ela|a) pra sair|t[aá] na hora de marcar|como marco um encontro|ajuda (pra|para) chamar pra sair|quero marcar (um )?encontro|quando (devo|posso) chamar pra sair|como chamo pra sair)\b/i;
const PREDATE_COACH_KEYWORDS = /\b(tenho encontro|vou (ao|no|para o|pra o) encontro|marquei (um )?encontro|preparar (o )?encontro|encontro amanhã|encontro hoje|encontro (nessa?|na|nesse?) (sexta|s[aá]bado|domingo|segunda|ter[cç]a|quarta|quinta|fim de semana|fds)|encontro marcado|encontro essa semana|vou (me )?encontrar (ela|com ela)|encontro com ela)\b/i;
const POSTDATE_DEBRIEF_KEYWORDS = /\b(como foi (o )?encontro|o encontro foi|debrief|analisar encontro|analisa (o )?encontro|encontro ontem|encontro hoje|foi o encontro|rolou o encontro|voltei do encontro|tive o encontro|encontro aconteceu)\b/i;
// Padrões detectados automaticamente de relato pós-encontro (Trigger C)
const POSTDATE_AUTO_TRIGGER_PATTERNS = /\b(o encontro foi (bem|mal|ok|ótimo|horrível|incrível|razo[aá]vel)|ela (pareceu|ficou|estava) (animada|fria|distante|legal|estranha|indiferente)|encontro foi (ontem|hoje de manhã|essa tarde|essa noite)|voltei do encontro|saímos (ontem|hoje)|rolou (o|um) encontro|(o encontro|a date) (acabou|terminou))\b/i;

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

function isProfileSelfAuditEnabled(phone) {
  switch (PROFILE_SELF_AUDIT_MODE) {
    case 'all':  return true;
    case 'test': return phone === PROFILE_SELF_AUDIT_TEST_PHONE;
    default: return false;
  }
}

function isProfileHerAnalysisEnabled(phone) {
  switch (PROFILE_HER_ANALYSIS_MODE) {
    case 'all':  return true;
    case 'test': return phone === PROFILE_HER_ANALYSIS_TEST_PHONE;
    default: return false;
  }
}

function isTransitionCoachEnabled(phone) {
  switch (TRANSITION_COACH_MODE) {
    case 'all':  return true;
    case 'test': return phone === TRANSITION_COACH_TEST_PHONE;
    case 'beta': {
      if (!phone) return false;
      let hash = 0;
      for (const c of phone) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
      // Seed diferente do print e profile
      return (Math.abs(hash ^ 0xcafebabe) % 100) < 10;
    }
    default: return false;
  }
}

function isPreDateCoachEnabled(phone) {
  switch (PREDATE_COACH_MODE) {
    case 'true':
    case 'all':  return true;
    case 'test': return phone === PREDATE_COACH_TEST_PHONE;
    case 'beta': {
      if (!phone) return false;
      let hash = 0;
      for (const c of phone) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
      // Seed diferente dos outros features
      return (Math.abs(hash ^ 0xbeefdead) % 100) < 10;
    }
    default: return false;
  }
}

function isPostdateDebriefEnabled(phone) {
  switch (POSTDATE_DEBRIEF_MODE) {
    case 'true':
    case 'all':  return true;
    case 'test': return phone === POSTDATE_DEBRIEF_TEST_PHONE;
    case 'beta': {
      if (!phone) return false;
      let hash = 0;
      for (const c of phone) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
      // Seed diferente dos outros features
      return (Math.abs(hash ^ 0xf00dcafe) % 100) < 10;
    }
    default: return false;
  }
}

function isMindsetCapsulesEnabled(phone) {
  switch (MINDSET_CAPSULES_MODE) {
    case 'all':  return true;
    case 'test': return phone === MINDSET_CAPSULES_TEST_PHONE;
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
  // Free: mostra contador quando sobra 1 análise
  if (todayCount === FREE_DAILY_LIMIT) {
    await client.sendMessage(message.from,
      `_${todayCount}/${FREE_DAILY_LIMIT} — última análise de hoje_`
    );
  }
}

async function upsellPicoPremium(message, trial, todayCount) {
  if (trial.isPremium) return;

  // Último dia do trial + 3+ msgs hoje → oferta contextual
  if (trial.inTrial && trial.isLastDay && todayCount >= 3) {
    await client.sendMessage(message.from,
      `Hoje é seu último dia ilimitado.\n\n` +
      `${OPCOES_PREMIUM}`
    );
    return;
  }

  // Últimas horas do trial (< 2h)
  if (trial.inTrial && trial.lastHours && todayCount >= 1) {
    await client.sendMessage(message.from,
      `Fecha em menos de *2h*. Se quiser continuar:\n\n` +
      `${OPCOES_PREMIUM}`
    );
    return;
  }

  // Free (pós-trial): última análise do dia
  if (!trial.inTrial && todayCount === FREE_DAILY_LIMIT) {
    await client.sendMessage(message.from,
      `Última análise de hoje.\n\nSe não dá pra esperar amanhã: *mensal* (R$29,90) ou *anual* (R$299).`
    );
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
      `*Parceiro Pro — R$79,90/mês*\n\n` +
      `• Mensagens ilimitadas\n` +
      `• Análise de conversa (ilimitada)\n` +
      `• Analisar Perfil Dela (30/dia)\n` +
      `• Auditar Meu Perfil (30/dia)\n\n` +
      `_Pix aparece no nome *Rafael Cabral Ibraim* — responsável pelo MandaAssim. Pode pagar normalmente ✅_`
    );

    const media = new MessageMedia('image/png', qrCodeBase64, 'pix-pro.png');
    await client.sendMessage(message.from, media);
    await client.sendMessage(message.from, qrCodeText);
    await client.sendMessage(message.from,
      `_Confirmação chega em menos de 1 minuto. Se demorar: *paguei*_`
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

    await message.reply('Gerado 👇\n\n_O Pix aparece no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Pode pagar normalmente ✅_');

    const media = new MessageMedia('image/png', qrCodeBase64, 'pix-qrcode.png');
    await client.sendMessage(message.from, media);

    await client.sendMessage(message.from, qrCodeText);

    await client.sendMessage(message.from,
      `_Confirmação chega aqui em menos de 1 minuto. Se demorar: *paguei*_`
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
    await message.reply('Tá longo demais. Resume o essencial em até 2000 caracteres e manda de novo.');
    return;
  }

  // Cancela qualquer follow up pendente quando usuário manda mensagem
  cancelPendingFollowups(phone).catch(() => {});

  // Detecta slug de aquisição na mensagem (ex: "mandaassim_instagram_reel_001")
  const acquisitionSlug = parseAcquisitionSlug(message.type === 'chat' ? message.body : null);

  // Boas-vindas para novos usuários (não conta no limite)
  const isNewUser = await upsertUser(phone, contactName, message.from);
  if (isNewUser) {
    saveAttribution(phone, acquisitionSlug).catch(() => {});

    // Evento: signup
    logJourneyEvent(phone, 'signup', { acquisition_slug: acquisitionSlug || 'direct' }).catch(() => {});

    // Ato 1 — Boas-vindas com diagnóstico (substitui WELCOME_MESSAGES[1] quando ativo)
    const act1Msg = await getAct1Message(phone).catch(() => null);

    for (let i = 0; i < WELCOME_MESSAGES.length; i++) {
      if (i === 1 && act1Msg) {
        await client.sendMessage(message.from, act1Msg); // Ato 1 no lugar da msg[1]
      } else {
        await client.sendMessage(message.from, WELCOME_MESSAGES[i]);
      }
    }

    console.log(`[Boas-vindas] Enviada para: ${phone}${act1Msg ? ' (Ato 1 ativo)' : ''}`);
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
      const used = await getDailyUsage(phone, 'messages');

      let statusText;
      if (trial.isPro) {
        const validade = trial.expiresAt ? new Date(trial.expiresAt).toLocaleDateString('pt-BR') : null;
        const graceNote = trial.inGrace ? `\n_⚠️ Venceu — renova pra não perder acesso. Digita *pro*._` : (validade ? `\n_Válido até ${validade}_` : '');
        statusText = `🔥 *Parceiro Pro* — mensagens ilimitadas + Análise de Perfil${graceNote}`;
      } else if (trial.isPremium) {
        const validade = trial.expiresAt ? new Date(trial.expiresAt).toLocaleDateString('pt-BR') : null;
        const graceNote = trial.inGrace ? `\n_⚠️ Venceu — renova pra não perder acesso. Digita *mensal* ou *anual*._` : (validade ? `\n_Válido até ${validade}_` : '');
        statusText = `🌟 *Parceiro* — mensagens ilimitadas${graceNote}`;
      } else if (trial.inTrial) {
        const horasLabel = trial.lastHours
          ? `menos de 2h`
          : `*${trial.trialDaysLeft} dia(s)*`;
        statusText = `⏳ *Trial* — ilimitado por mais ${horasLabel}\n_Usado hoje: ${used} análise(s)_`;
      } else {
        const remaining = Math.max(0, FREE_DAILY_LIMIT - used);
        statusText = `🆓 *Free* — ${used}/${FREE_DAILY_LIMIT} hoje · ${remaining} restante(s)`;
      }

      await message.reply(`*Seu plano:*\n\n${statusText}`);
      return;
    }

    if (cmd === 'premium') {
      const trial = await getTrialInfo(phone);
      if (trial.isPremium) {
        await message.reply('Você já é *Parceiro* — pode mandar à vontade.');
      } else {
        await message.reply(OPCOES_PREMIUM);
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

    if (cmd === 'pro' || cmd === 'parceiro pro' || cmd === 'wingman pro' || cmd === 'upgrade') {
      const trial = await getTrialInfo(phone);
      if (trial.isPro) {
        await message.reply('🔥 Você já é *Parceiro Pro*! Pode usar todas as features à vontade.');
        return;
      }
      // Gera Pix Pro (R$79,90 padrão)
      await enviarCobrancaPixPro(message, phone);
      trackSubscriptionEvent({
        phone,
        eventType:  'upgrade_offered',
        planFrom:   trial.planKey || (trial.isPremium ? 'parceiro' : (trial.inTrial ? 'trial' : 'free')),
        planTo:     'parceiro_pro',
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
      const isPaidActive = ['parceiro','parceiro_pro','wingman','wingman_pro'].includes(user?.plan) && (!user.plan_expires_at || new Date(user.plan_expires_at) > new Date());
      if (isPaidActive) {
        await message.reply('✅ *Parceiro ativo* — pode mandar à vontade.');
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
          `Não encontrei nenhum pagamento pendente. Digita *mensal* pra gerar um novo Pix.`
        );
        return;
      }

      // Se já aprovado no banco mas usuário não tem plano ativo, ativa agora
      if (pagamento.status === 'approved') {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await supabase.from('users').update({ plan: 'parceiro', plan_expires_at: expiresAt.toISOString() }).eq('phone', phone);
        await message.reply('✅ *Parceiro ativo* — pode mandar à vontade.');
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
              ? '✅ *24h ativado* — acesso ilimitado pelas próximas 24 horas. Manda o print.'
              : newPlan === 'parceiro_pro'
              ? `✅ *Parceiro Pro ativado* — Análise de Perfil liberada. Manda o print do perfil dela 👇`
              : '✅ *Parceiro ativado* — mensagens ilimitadas. Manda o próximo print ou descreve a situação.';
            await message.reply(confirmMsg);
          } else {
            await message.reply(
              `Pix ainda não confirmado pelo banco.\n\nNormalmente cai em menos de 1 minuto. Tenta de novo em instantes.`
            );
          }
        } catch (e) {
          console.error('[Paguei] Erro ao consultar MP:', e.message);
          await message.reply(`Verificando seu pagamento. Tenta de novo em 1 minuto.`);
        }
      } else {
        await message.reply(
          `Pix ainda não confirmado pelo banco.\n\nNormalmente cai em menos de 1 minuto. Tenta de novo em instantes.`
        );
      }
      return;
    }

    // ── Cancelamento de assinatura ───────────────────────────────────────────
    if (cmd === 'cancelar' || cmd === '/cancelar') {
      const trialForCancel = await getTrialInfo(phone);
      if (!trialForCancel.isPremium) {
        await message.reply(`Você está no plano *free* — não há assinatura ativa pra cancelar.\n\nSe quiser assinar: *mensal* (R$29,90) ou *anual* (R$299).`);
        return;
      }

      userContext.set(phone, { ...(getUserContext(phone) || {}), awaitingCancelReason: true });
      const expiresMsg = trialForCancel.expiresAt
        ? `\n\nSeu acesso continua ativo até *${new Date(trialForCancel.expiresAt).toLocaleDateString('pt-BR')}*.`
        : '';

      await message.reply(
        `Entendido. Só me conta o motivo:\n\n` +
        `1️⃣ Preço\n` +
        `2️⃣ Não uso o suficiente\n` +
        `3️⃣ Não gostei dos resultados\n` +
        `4️⃣ Problema técnico\n` +
        `5️⃣ Outro${expiresMsg}\n\n` +
        `_Manda o número._`
      );
      return;
    }

    // Resposta ao motivo de cancelamento (quando aguardando)
    if (getUserContext(phone)?.awaitingCancelReason && /^[1-5]$/.test(text.trim())) {
      const trialForCancel = await getTrialInfo(phone);
      const reasons = { '1': 'preco', '2': 'nao_uso', '3': 'nao_gostei', '4': 'problema_tecnico', '5': 'outro' };
      const finalReason = reasons[text.trim()];

      const supabase = getSupabase();
      await supabase.from('cancellation_reasons').insert({
        phone,
        plan: trialForCancel.planKey,
        reason: finalReason,
        plan_expires_at: trialForCancel.expiresAt || null,
      }).catch(() => {});

      userContext.set(phone, { ...(getUserContext(phone) || {}), awaitingCancelReason: false });

      const expiresMsg = trialForCancel.expiresAt
        ? `\n\nSeu acesso continua até *${new Date(trialForCancel.expiresAt).toLocaleDateString('pt-BR')}*.`
        : '';

      await message.reply(
        `Cancelamento registrado ✅${expiresMsg}\n\n` +
        `Se mudar de ideia: *mensal*, *anual* ou *pro* 👋`
      );
      console.log(`[Cancelamento] ${phone} cancelou (${finalReason})`);
      return;
    }

    // ── Resposta ao Ato 1 (escolha 1-4 de persona) ───────────────────────────
    if (process.env.ENABLE_ACT_01_HOOK_DIAGNOSTICO === 'true') {
      const choice = parseUserChoice(text);
      if (choice) {
        const act01 = getActById('act_01_hook_diagnostico');
        if (act01?.onResponse) {
          const { TriggerContext } = require('./src/narrative/triggerContext');
          const supabaseForAct = getSupabase();
          const { data: userForAct } = await supabaseForAct
            .from('users')
            .select('phone, plan, plan_expires_at, created_at')
            .eq('phone', phone)
            .maybeSingle();
          if (userForAct) {
            const ctx = new TriggerContext(userForAct);
            const alreadySent = await ctx.actAlreadySent('act_01_hook_diagnostico');
            if (alreadySent) {
              await act01.onResponse(ctx, text);
            }
          }
        }
      }
    }

    // ── Comandos de Mindset Opt-In ────────────────────────────────────────────
    if (isMindsetCapsulesEnabled(phone)) {
      if (/^(ativar mindset|mindset ativar)$/i.test(cmd)) {
        const trialForMindset = await getTrialInfo(phone);
        if (!trialForMindset.isPro) {
          await message.reply(`Cápsulas de mindset são exclusivas do *Parceiro Pro* 🔥\n\nDigita *pro* pra fazer upgrade.`);
        } else {
          await activateOptIn(phone);
          await message.reply(MINDSET_ACTIVATED_MESSAGE);
        }
        return;
      }

      if (/^(cancelar mindset|pausar mindset|mindset cancelar|mindset pausar)$/i.test(cmd)) {
        await deactivateOptIn(phone);
        await message.reply(`Mindset pausado ✅\n\nPra ativar de novo: *ativar mindset*.`);
        return;
      }

      const freqMatch = cmd.match(/^mindset\s+(1x|3x|5x|di[aá]rio)$/i);
      if (freqMatch) {
        const freqMap = { '1x': 1, '3x': 3, '5x': 5, 'diário': 7, 'diario': 7 };
        const freq = freqMap[freqMatch[1].toLowerCase()] || 3;
        await updateFrequency(phone, freq);
        const freqLabel = { 1: '1x por semana', 3: '3x por semana', 5: 'dias úteis', 7: 'todo dia' }[freq];
        await message.reply(`Frequência atualizada: ${freqLabel} ✅`);
        return;
      }

      if (/^mindset$/i.test(cmd)) {
        const trialForMindset = await getTrialInfo(phone);
        if (!trialForMindset.isPro) {
          await message.reply(`Cápsulas de mindset são exclusivas do *Parceiro Pro* 🔥\n\nDigita *pro* pra fazer upgrade.`);
        } else {
          const optIn = await getOptIn(phone);
          if (!optIn || !optIn.enabled) {
            await message.reply(`Mindset inativo.\n\nDigita *ativar mindset* pra começar.`);
          } else {
            const freqLabel = { 1: '1x por semana', 3: '3x por semana', 5: 'dias úteis', 7: 'todo dia' }[optIn.frequency] || '3x por semana';
            await message.reply(
              `✅ *Mindset ativo* — ${freqLabel} às ${optIn.schedule_hour}h\n\n` +
              `Pra mudar: *mindset 1x*, *mindset 3x*, *mindset 5x* ou *mindset diário*\n` +
              `Pra pausar: *cancelar mindset*`
            );
          }
        }
        return;
      }
    }

  }

  // ---------------------------------------------------------------------------
  // Verificação de trial e limite diário
  // ---------------------------------------------------------------------------

  const trial = await getTrialInfo(phone);

  if (!trial.isPremium) {
    // Verifica limite ANTES de incrementar (corrige bug de contagem antecipada)
    const limitCheck = await canUseFeature(phone, trial.planKey, 'messages');
    if (!limitCheck.allowed) {
      console.log(`[Limite] ${phone} (${trial.planKey}) esgotou mensagens hoje.`);
      scheduleLimitExhausted3(phone).catch(() => {});

      const ctx = getUserContext(phone);
      const conversaQuente = ctx?.lastRequestAt && (Date.now() - ctx.lastRequestAt) < 5 * 60 * 1000;

      // Win-back: ex-wingman na janela de 2-15 dias
      if (trial.expiredAt && await verificarWinback(phone, trial.expiredAt)) {
        await message.reply(
          `Deu ${FREE_DAILY_LIMIT} por hoje.\n\n` +
          `Como você já assinou antes, tem uma oferta de volta: *voltar* por R$19,90 no primeiro mês.`
        );
      } else if (conversaQuente) {
        await message.reply(`Deu o limite por hoje. Se não dá pra esperar: *mensal* (R$29,90) ou *anual* (R$299).`);
      } else {
        await message.reply(limitCheck.upsellMessage || LIMITE_FREE_ESGOTADO);
      }
      return;
    }
  }

  // Incrementa uso após verificação (sem double-count em msgs bloqueadas)
  const todayCount = await incrementFeatureUsage(phone, 'messages');
  // Dual-write para manter dashboard funcionando durante transição
  incrementDailyCount(phone).catch(() => {});

  // Trial ativo: aviso informativo na 1ª msg do dia
  if (trial.inTrial && todayCount === 1) {
    if (trial.lastHours) {
      await message.reply(
        `Acesso ilimitado fecha em menos de *2h*.\n\n` +
        `*mensal* (R$29,90) ou *anual* (R$299) se quiser continuar.`
      );
    } else if (trial.isLastDay) {
      await message.reply(
        `Hoje é o último dia ilimitado.\n\n` +
        `Amanhã passa pra *${FREE_DAILY_LIMIT} análises/dia* — ou continua ilimitado:\n\n` +
        `*mensal* (R$29,90) · *anual* (R$299)`
      );
    } else {
      await message.reply(
        `*${trial.trialDaysLeft} dia(s)* ilimitados. Manda o que tiver.\n\n` +
        `_*status* pra ver seu plano_`
      );
    }
  }

  // Free (pós-trial): agenda follow-up na 1ª msg do dia
  if (!trial.isPremium && !trial.inTrial && todayCount === 1) {
    scheduleLimitDrop3(phone).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Processamento normal
  // ---------------------------------------------------------------------------

  // ── Convite de mindset: envia uma vez após 14 dias Pro (fire-and-forget) ───
  if (trial.isPro && isMindsetCapsulesEnabled(phone) && !mindsetInviteChecked.has(phone)) {
    mindsetInviteChecked.add(phone);
    shouldSendInvite(phone).then(async (yes) => {
      if (!yes) return;
      await client.sendMessage(message.from, MINDSET_INVITE_MESSAGE);
      await markInviteSent(phone);
      const ctx = userContext.get(phone) || {};
      userContext.set(phone, { ...ctx, pendingMindsetOptIn: true });
      console.log(`[Mindset] Convite enviado para ${phone}`);
    }).catch(() => {});
  }

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
                  ? `Aguarda ${lc.remaining}s antes de mandar outro print.`
                  : (trial.isPremium ? PRINT_LIMIT_REACHED_PREMIUM : PRINT_LIMIT_REACHED_TRIAL);
                await client.sendMessage(message.from, msg);
              } else {
                await message.reply('Lendo a conversa... ⏳');
                try {
                  const { messages: pm, structuredResult: printResultAmbig } = await analisarPrintConversaComHaiku(imgData, imgMime, phone);
                  incrementPrintCount(phone); setPrintLastTime(phone);
                  saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
                  if (printResultAmbig) {
                    const ctxAfterAmbigPrint = userContext.get(phone) || {};
                    userContext.set(phone, { ...ctxAfterAmbigPrint, lastPrintResult: printResultAmbig });
                  }
                  await sendWithDelay(message.from, pm, { phone, intent: 'print_analysis' });
                } catch (_) {
                  await client.sendMessage(message.from, 'Print tá difícil de ler. Manda um mais nítido, mostrando as últimas 5-10 mensagens.');
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
                  ? `Aguarda ${pl.remaining}s antes de mandar outro perfil.`
                  : PROFILE_LIMIT_REACHED_PRO;
                await client.sendMessage(message.from, msg);
              } else {
                await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
                try {
                  const { messages: pm } = await analisarPerfilComHaiku(imgData, imgMime, phone);
                  incrementProfileCount(phone); setProfileLastTime(phone);
                  saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
                  await sendWithDelay(message.from, pm, { phone, intent: 'profile_analysis' });
                } catch (_) {
                  await client.sendMessage(message.from, 'Print do perfil tá difícil de ler. Manda um mais claro — com nome, bio e ao menos uma foto.');
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
              await client.sendMessage(message.from, 'Não consegui ler o perfil. Manda um print mais claro — com nome, bio e pelo menos uma foto.');
            }
          }
        }
        return;
      }
      // Se não for resposta de desambiguação — limpa o estado e segue o fluxo normal
      const currentCtx2 = userContext.get(phone) || {};
      userContext.set(phone, { ...currentCtx2, pendingImageClassification: null });
    }

    // ── Resposta de desambiguação "meu" / "dela" (self vs other) ────────────
    const ctxSelfOther = getUserContext(phone);
    if (ctxSelfOther?.pendingProfileClassification) {
      const lower = text.toLowerCase().trim();
      const isSelf  = /^(meu|minha|meu perfil|é meu|próprio)$/.test(lower);
      const isOther = /^(dela|o dela|perfil dela|é dela|de alguém)$/.test(lower);

      if (isSelf || isOther) {
        const { data: imgData, mimetype: imgMime } = ctxSelfOther.pendingProfileClassification;
        const currentCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtx, pendingProfileClassification: null });

        if (isSelf && isProfileSelfAuditEnabled(phone)) {
          const needsPlanCheck = PROFILE_SELF_AUDIT_MODE !== 'test';
          if (needsPlanCheck && !trial.isPro) {
            const { upsellMessage } = await canUseFeature(phone, trial.plan || 'free', 'profile_self_audit');
            await client.sendMessage(message.from, upsellMessage ||
              `Auditoria de Perfil é do *Parceiro Pro* 🔍\n\nDigita *pro* pra conhecer.`
            );
          } else {
            const pl = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
            if (!pl.allowed) {
              await client.sendMessage(message.from,
                pl.reason === 'cooldown' ? `Aguarda ${pl.remaining}s antes de mandar outro perfil.` : PROFILE_LIMIT_REACHED_PRO
              );
            } else {
              await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
              try {
                const { messages: am } = await auditarPerfilProprio(imgData, imgMime, phone);
                incrementProfileCount(phone); setProfileLastTime(phone);
                await incrementFeatureUsage(phone, 'profile_self_audit');
                saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
                await sendWithDelay(message.from, am, { phone, intent: 'profile_self_audit' });
              } catch (_) {
                await client.sendMessage(message.from, 'Print do perfil tá difícil de ler. Manda um mais claro — com nome, bio e ao menos uma foto.');
              }
            }
          }
        } else {
          // isOther (ou self sem flag de auditoria)
          const needsPlanCheck = PROFILE_HER_ANALYSIS_MODE !== 'test';
          if (needsPlanCheck && !trial.isPro) {
            const { upsellMessage } = await canUseFeature(phone, trial.plan || 'free', 'profile_her_analysis');
            await client.sendMessage(message.from, upsellMessage ||
              `Análise de Perfil é do *Parceiro Pro* 🔍\n\nDigita *pro* pra conhecer.`
            );
          } else {
            const pl = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
            if (!pl.allowed) {
              await client.sendMessage(message.from,
                pl.reason === 'cooldown' ? `Aguarda ${pl.remaining}s antes de mandar outro perfil.` : PROFILE_LIMIT_REACHED_PRO
              );
            } else {
              await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
              try {
                const { messages: pm } = await analisarPerfilComHaiku(imgData, imgMime, phone);
                incrementProfileCount(phone); setProfileLastTime(phone);
                await incrementFeatureUsage(phone, 'profile_her_analysis');
                saveUserContext(phone, { data: imgData, mimetype: imgMime }, 'image');
                await sendWithDelay(message.from, pm, { phone, intent: 'profile_her_analysis' });
              } catch (_) {
                await client.sendMessage(message.from, 'Print do perfil tá difícil de ler. Manda um mais claro — com nome, bio e ao menos uma foto.');
              }
            }
          }
        }
        return;
      }
      // Não era resposta de desambiguação — limpa e segue fluxo normal
      const currentCtx2 = userContext.get(phone) || {};
      userContext.set(phone, { ...currentCtx2, pendingProfileClassification: null });
    }

    // ── Resposta ao Ato 1 (persona 1-4) → dispara Ato 2 + inicia diagnóstico ─
    const act2Result = await handleAct1Response(phone, text).catch(() => null);
    if (act2Result) {
      await client.sendMessage(message.from, act2Result.message);
      logJourneyEvent(phone, 'first_message_sent').catch(() => {});
      // Inicia estado de diagnóstico: aguarda Q1 response (questionIndex=0)
      const currentCtxAct2 = userContext.get(phone) || {};
      userContext.set(phone, {
        ...currentCtxAct2,
        diagnosticState: { persona: act2Result.persona, questionIndex: 0, answers: {} },
      });
      return;
    }

    // ── Resposta ao convite de mindset (SIM / NÃO) ───────────────────────────
    const mindsetCtx = getUserContext(phone);
    const pendingMindset = mindsetCtx?.pendingMindsetOptIn
      || (isMindsetCapsulesEnabled(phone) && await hasPendingInviteResponse(phone).catch(() => false));

    if (pendingMindset && isMindsetCapsulesEnabled(phone)) {
      const isYes = /^(sim|s|ativar|quero|yes|ativo)$/i.test(text.trim());
      const isNo  = /^(n[aã]o|n|nao|agora n[aã]o|agora nao|depois|talvez)$/i.test(text.trim());
      if (isYes) {
        const currentCtxM = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtxM, pendingMindsetOptIn: false });
        await activateOptIn(phone);
        await message.reply(MINDSET_ACTIVATED_MESSAGE);
        return;
      }
      if (isNo) {
        const currentCtxM = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtxM, pendingMindsetOptIn: false });
        await markInviteDeclined(phone);
        await message.reply(MINDSET_DECLINED_MESSAGE);
        return;
      }
      // Se não for SIM/NÃO, limpa o estado pendente e segue o fluxo normal
      const currentCtxM = userContext.get(phone) || {};
      userContext.set(phone, { ...currentCtxM, pendingMindsetOptIn: false });
    }

    // ── Coach de Transição: continua entrevista em andamento ─────────────────
    const tcCtx = getUserContext(phone);
    if (tcCtx?.transitionCoachState) {
      const tcState = tcCtx.transitionCoachState;
      const { questionIndex, answers, printContext } = tcState;
      const updatedAnswers = { ...answers, [questionIndex]: text };

      if (questionIndex < INTERVIEW_QUESTIONS.length - 1) {
        // Ainda tem perguntas — avança para a próxima
        const nextIndex = questionIndex + 1;
        const currentCtxTC = userContext.get(phone) || {};
        userContext.set(phone, {
          ...currentCtxTC,
          transitionCoachState: { questionIndex: nextIndex, answers: updatedAnswers, printContext },
        });
        await client.sendMessage(message.from, INTERVIEW_QUESTIONS[nextIndex]);
      } else {
        // Todas as perguntas respondidas — analisa
        const currentCtxTC = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtxTC, transitionCoachState: null });

        await message.reply('Analisando sua situação... ⏳');
        const stopTypingTC = await startTyping(message);
        try {
          const { messages: tcMsgs } = await analisarTransicaoComHaiku(updatedAnswers, printContext, phone);
          stopTypingTC();
          await sendWithDelay(message.from, tcMsgs, { phone, intent: 'transition_coach' });
          scheduleTransitionCoachOutcome(phone).catch(() => {});
        } catch (_) {
          stopTypingTC();
          await client.sendMessage(message.from, 'Deu problema aqui. Tenta de novo em alguns minutos.');
        }
      }
      return;
    }

    // ── Diagnóstico Ato 2 → 2.5 (espelhamento dinâmico) ─────────────────────
    const diagCtxCheck = getUserContext(phone);
    if (diagCtxCheck?.diagnosticState) {
      const diagState = diagCtxCheck.diagnosticState;
      const { persona: diagPersona, questionIndex: diagQIdx, answers: diagAnswers } = diagState;
      const updatedDiagAnswers = { ...diagAnswers, [diagQIdx]: text };

      if (diagQIdx < 2) {
        // Ainda tem perguntas (0→Q2, 1→Q3)
        const nextIdx = diagQIdx + 1;
        const currentCtxDiag = userContext.get(phone) || {};
        userContext.set(phone, {
          ...currentCtxDiag,
          diagnosticState: { persona: diagPersona, questionIndex: nextIdx, answers: updatedDiagAnswers },
        });
        await client.sendMessage(message.from, getDiagnosticQuestion(diagPersona, diagQIdx));
      } else {
        // 3 respostas coletadas → gera espelhamento
        const currentCtxDiag = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtxDiag, diagnosticState: null });

        const stopTypingDiag = await startTyping(message);
        try {
          const mirrorMsgs = await generateMirroringAct25(phone, diagPersona, updatedDiagAnswers);
          stopTypingDiag();
          await sendWithDelay(message.from, mirrorMsgs, { phone, intent: 'act_2_5_mirroring' });
          logJourneyEvent(phone, 'narrative_act_2_5_sent', { persona: diagPersona }).catch(() => {});
        } catch (_) {
          stopTypingDiag();
          await client.sendMessage(message.from, 'Manda o print ou me descreve a situação — eu leio agora.');
        }
      }
      return;
    }

    // ── Coach Pré-Date: continua entrevista em andamento ─────────────────────
    const pdCtx = getUserContext(phone);
    if (pdCtx?.predateCoachState) {
      const pdState = pdCtx.predateCoachState;
      const { questionIndex, answers } = pdState;
      const updatedAnswers = { ...answers, [questionIndex]: text };

      if (questionIndex < INTERVIEW_QUESTIONS_PREDATE.length - 1) {
        const nextIndex = questionIndex + 1;
        const currentCtxPD = userContext.get(phone) || {};
        userContext.set(phone, {
          ...currentCtxPD,
          predateCoachState: { questionIndex: nextIndex, answers: updatedAnswers },
        });
        await client.sendMessage(message.from, INTERVIEW_QUESTIONS_PREDATE[nextIndex]);
      } else {
        // Todas as 4 perguntas respondidas — analisa
        const currentCtxPD = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtxPD, predateCoachState: null });

        const girlProfilePD = await getGirlProfile(phone);
        const girlContextPD = buildGirlContext(girlProfilePD);

        // Loop de aprendizado: busca insight do último debrief (Camada 5 → Camada 4)
        const lastDebriefCtx = await getLastDebriefInsight(phone).catch(() => null);
        const girlContextWithDebrief = lastDebriefCtx
          ? `${girlContextPD}\n\nCONTEXTO DO ÚLTIMO ENCONTRO DELE:\n${lastDebriefCtx}`
          : girlContextPD;

        await message.reply('Preparando seu plano... ⏳');
        const stopTypingPD = await startTyping(message);
        try {
          const { messages: pdMsgs, dateParsed } = await analisarPreDateComHaiku(updatedAnswers, girlContextWithDebrief, phone);
          stopTypingPD();
          await sendWithDelay(message.from, pdMsgs, { phone, intent: 'predate_coach' });
          if (dateParsed) {
            schedulePredateReminders(phone, dateParsed).catch(() => {});
            await client.sendMessage(message.from,
              `_Vou te mandar lembretes no dia anterior e 2h antes do encontro. Manda *PARAR* se não quiser receber._`
            );
          }
        } catch (_) {
          stopTypingPD();
          await client.sendMessage(message.from, 'Deu problema aqui. Tenta de novo em alguns minutos.');
        }
      }
      return;
    }

    // ── Debrief Pós-Date: continua entrevista em andamento ──────────────────
    const dbCtx = getUserContext(phone);
    if (dbCtx?.postdateDebriefState) {
      const dbState = dbCtx.postdateDebriefState;
      const { questionIndex, answers } = dbState;
      const updatedAnswers = { ...answers, [questionIndex]: text };

      if (questionIndex < INTERVIEW_QUESTIONS_DEBRIEF.length - 1) {
        const nextIndex = questionIndex + 1;
        const currentCtxDB = userContext.get(phone) || {};
        userContext.set(phone, {
          ...currentCtxDB,
          postdateDebriefState: { questionIndex: nextIndex, answers: updatedAnswers },
        });
        await client.sendMessage(message.from, INTERVIEW_QUESTIONS_DEBRIEF[nextIndex]);
      } else {
        // Todas as 6 perguntas respondidas — analisa
        const currentCtxDB = userContext.get(phone) || {};
        userContext.set(phone, { ...currentCtxDB, postdateDebriefState: null });

        await message.reply('Analisando o encontro... ⏳');
        const stopTypingDB = await startTyping(message);
        try {
          const { messages: dbMsgs } = await analisarDebriefComHaiku(updatedAnswers, phone);
          stopTypingDB();
          await sendWithDelay(message.from, dbMsgs, { phone, intent: 'postdate_debrief' });
        } catch (_) {
          stopTypingDB();
          await client.sendMessage(message.from, 'Deu problema aqui. Tenta de novo em alguns minutos.');
        }
      }
      return;
    }

    // ── Opt-out de lembretes de pré-date ─────────────────────────────────────
    if (/^parar( lembretes?)?$/i.test(text.trim())) {
      await cancelPredateReminders(phone);
      await message.reply('Lembretes cancelados ✅\n\nSe precisar de algo, é só mandar aqui.');
      return;
    }

    // Filtra saudações puras — orienta sem gastar API
    if (isSaudacao(text)) {
      await message.reply('Manda o print ou descreve o que tá rolando — eu leio e gero as opções.');
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

    // ── Trigger A: Coach de Transição ────────────────────────────────────────
    if (isTransitionCoachEnabled(phone) && TRANSITION_COACH_KEYWORDS.test(text)) {
      // Plano livre: upsell
      if (!trial.isPremium) {
        await client.sendMessage(message.from, TRANSITION_COACH_UPSELL_FREE);
        trackSubscriptionEvent({
          phone,
          eventType:  'upgrade_offered',
          planFrom:   trial.inTrial ? 'trial' : 'free',
          planTo:     'parceiro',
          triggerCtx: 'transition_coach',
        });
        return;
      }
      // Premium com limite mensal de 2/mês (Pro: ilimitado)
      if (!trial.isPro) {
        const tcSessionCount = await getMonthlySessionCount(phone);
        if (tcSessionCount >= 2) {
          await client.sendMessage(message.from, TRANSITION_COACH_UPSELL_PREMIUM_LIMIT);
          return;
        }
      }
      // Pega contexto de print recente (se houver) para enriquecer a análise
      const tcTrigCtx = getUserContext(phone);
      const printCtxForTC = tcTrigCtx?.lastPrintResult || null;
      // Inicia entrevista
      const currentCtxForTC = userContext.get(phone) || {};
      userContext.set(phone, {
        ...currentCtxForTC,
        transitionCoachState: { questionIndex: 0, answers: {}, printContext: printCtxForTC },
      });
      await client.sendMessage(message.from,
        `Bora. Preciso de algumas informações rápidas pra te dar a análise certa 👇\n\n${INTERVIEW_QUESTIONS[0]}`
      );
      return;
    }

    // ── Trigger A/C: Coach Pré-Date (Wingman Pro only) ──────────────────────
    if (isPreDateCoachEnabled(phone) &&
        (PREDATE_COACH_KEYWORDS.test(text) || /^preparar encontro$/i.test(text))) {
      // Journey event: encontro mencionado (alimenta act_08 da narrativa)
      logJourneyEvent(phone, 'encounter_mentioned', {}, false).catch(() => {});
      if (!trial.isPro) {
        await client.sendMessage(message.from, PREDATE_COACH_UPSELL_FREE);
        trackSubscriptionEvent({
          phone,
          eventType:  'upgrade_offered',
          planFrom:   trial.planKey,
          planTo:     'parceiro_pro',
          triggerCtx: 'predate_coach',
        });
        return;
      }
      const currentCtxPDTrig = userContext.get(phone) || {};
      userContext.set(phone, {
        ...currentCtxPDTrig,
        predateCoachState: { questionIndex: 0, answers: {} },
      });
      await client.sendMessage(message.from,
        `Bora te preparar. Algumas perguntas rápidas 👇\n\n${INTERVIEW_QUESTIONS_PREDATE[0]}`
      );
      return;
    }

    // ── Trigger B/C: Debrief Pós-Date (Wingman Pro only) ────────────────────
    if (isPostdateDebriefEnabled(phone) &&
        (POSTDATE_DEBRIEF_KEYWORDS.test(text) || POSTDATE_AUTO_TRIGGER_PATTERNS.test(text) ||
         /^debrief( encontro)?$/i.test(text))) {
      if (!trial.isPro) {
        await client.sendMessage(message.from, POSTDATE_DEBRIEF_UPSELL_FREE);
        trackSubscriptionEvent({
          phone,
          eventType:  'upgrade_offered',
          planFrom:   trial.planKey,
          planTo:     'parceiro_pro',
          triggerCtx: 'postdate_debrief',
        });
        return;
      }
      const currentCtxDBTrig = userContext.get(phone) || {};
      userContext.set(phone, {
        ...currentCtxDBTrig,
        postdateDebriefState: { questionIndex: 0, answers: {} },
      });
      await client.sendMessage(message.from,
        `Bora analisar como foi. Algumas perguntas rápidas 👇\n\n${INTERVIEW_QUESTIONS_DEBRIEF[0]}`
      );
      return;
    }

    // ── Trigger A: Debrief proativo (resposta ao follow-up do worker) ─────────
    if (isPostdateDebriefEnabled(phone)) {
      const hasPendingDebrief = await temDebriefPendente(phone);
      if (hasPendingDebrief) {
        if (!trial.isPro) {
          await client.sendMessage(message.from, POSTDATE_DEBRIEF_UPSELL_FREE);
          return;
        }
        const currentCtxDBA = userContext.get(phone) || {};
        userContext.set(phone, {
          ...currentCtxDBA,
          postdateDebriefState: { questionIndex: 0, answers: {} },
        });
        await client.sendMessage(message.from,
          `Bora analisar como foi. Algumas perguntas rápidas 👇\n\n${INTERVIEW_QUESTIONS_DEBRIEF[0]}`
        );
        return;
      }
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

      const stopTyping1 = await startTyping(message);
      try {
        const result = ctx.lastType === 'image'
          ? { text: await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype, '', '', girlContext, phone) }
          : await analisarTextoComClaude(ctx.lastRequest + '\n\n(Gere 3 variações COMPLETAMENTE DIFERENTES das anteriores. Mude os ângulos, metáforas e abordagens.)', '', girlContext, phone);
        stopTyping1();
        await enviarResposta(message, result.text, result.intent, phone);
      } catch (err) {
        stopTyping1();
        console.error('[OpenRouter] Erro ao gerar variações:', err.message);
        await message.reply('Não consegui processar. Manda de novo.');
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

      const stopTyping2 = await startTyping(message);
      try {
        const result = ctx.lastType === 'image'
          ? { text: await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype, `Analise essa conversa e gere 3 opções com tom "${text.trim()}". Seja fiel ao estilo pedido.`, '', girlContext, phone) }
          : await analisarTextoComClaude(`Situação: ${ctx.lastRequest}\n\nGere 3 opções com tom "${text.trim()}". Adapte completamente o estilo.`, '', girlContext, phone);
        stopTyping2();
        saveUserContext(phone, ctx.lastRequest, ctx.lastType);
        await enviarResposta(message, result.text, result.intent, phone);
      } catch (err) {
        stopTyping2();
        console.error('[OpenRouter] Erro ao ajustar tom:', err.message);
        await message.reply('Não consegui processar. Tenta de novo.');
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

        const stopTypingFinal = await startTyping(message);
        try {
          const result = await analisarTextoComClaude(situacaoCompleta, '', girlContextCtx, phone);
          stopTypingFinal();
          saveUserContext(phone, situacaoCompleta, 'text');
          await enviarResposta(message, result.text, result.intent, phone);
          await contadorRestante(message, trial, todayCount);
          await upsellPicoPremium(message, trial, todayCount);
        } catch (err) {
          stopTypingFinal();
          console.error('[Coaching] Erro na análise final:', err.message);
          await message.reply('Não consegui processar. Tenta de novo.');
        }
      }
      return;
    }

    // ── Outcome de Coach de Transição: captura resposta ao follow-up ─────────
    if (isTransitionCoachEnabled(phone)) {
      const hasPendingOutcome = await temOutcomePendente(phone);
      if (hasPendingOutcome) {
        const outcome = await classificarOutcome(text);
        if (outcome) {
          await registrarOutcome(phone, outcome);
          const pdHint = isPreDateCoachEnabled(phone)
            ? `\n\n_Quando chegar perto do encontro: digita *preparar encontro* pra minha ajuda com o dia._`
            : '';
          const outcomeAck = {
            accepted_and_happened: `Foi bem. Boa pra você 👊\nSe tiver outra conversa rolando, manda aqui.`,
            accepted_but_postponed: `Tá crescendo. Segura a ansiedade quando ela confirmar a data — aparece normal.${pdHint}`,
            accepted_but_canceled: `Acontece. Não comenta sobre o cancelamento. Age normal quando ela retomar contato.`,
            rejected: `Tudo bem. Pelo menos você tentou. Se quiser entender o que pode ter influenciado, manda a conversa aqui.`,
            never_responded: `Ainda sem resposta? Espera mais 5-7 dias antes do próximo contato. Se precisar de ajuda, manda.`,
            user_didnt_send: `Ainda dá tempo. Se travar na hora de mandar, me conta o que tá segurando — eu ajusto a mensagem.`,
          }[outcome] || `Anotado. Se quiser mais ajuda, manda aqui.`;
          await client.sendMessage(message.from, outcomeAck);
          return;
        }
      }
    }

    const toneHint = ctx?.tonePreference ? `\nPreferência do usuário: ele tende a preferir tom "${ctx.tonePreference}" — leve isso em conta sem ignorar as outras opções.` : '';
    const recentSuccess = ctx?.recentSuccess || false;
    const girlProfile = await getGirlProfile(phone);
    const girlContext = buildGirlContext(girlProfile);
    const reconquistaExtra = RECONQUISTA_KEYWORDS.test(text) ? RECONQUISTA_CONTEXT : '';

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
      const result = await analisarTextoComClaude(text, toneHint, girlContext + reconquistaExtra, phone);
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
      await message.reply('Não consegui processar. Tenta de novo.');
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
        await message.reply('Não consegui ler o stories. Manda um print mais claro.');
      }

    } else {
      // ── Camada de classificação automática (quando alguma flag está ativa) ─
      const usaClassificador = isPrintAnalysisEnabled(phone) || isProfileAnalysisEnabled(phone)
        || isProfileSelfAuditEnabled(phone) || isProfileHerAnalysisEnabled(phone);

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
        const current = userContext.get(phone) || {};
        userContext.set(phone, {
          ...current,
          pendingImageClassification: { data: media.data, mimetype: media.mimetype },
        });
        return;
      }

      // ── Perfil ───────────────────────────────────────────────────────────
      if (imageType === 'profile') {
        const usaVisionProfile = isProfileSelfAuditEnabled(phone) || isProfileHerAnalysisEnabled(phone);

        if (usaVisionProfile) {
          // ── Vision: classifica se é perfil próprio ou dela ─────────────
          const selfVsOther = await classificarPerfilSelfVsOther(media.data, media.mimetype);
          console.log(`[SelfVsOther] ${phone} → ${selfVsOther}`);

          if (selfVsOther === 'ambiguous') {
            await client.sendMessage(message.from,
              `Esse perfil é *teu* ou *dela*?\n\n_Responde: "meu" ou "dela"_`
            );
            const current = userContext.get(phone) || {};
            userContext.set(phone, {
              ...current,
              pendingProfileClassification: { data: media.data, mimetype: media.mimetype },
            });
            return;
          }

          // ── Validação tamanho ─────────────────────────────────────────
          const estimatedBytes = (media.data || '').length * 0.75;
          if (estimatedBytes > 10 * 1024 * 1024) {
            await client.sendMessage(message.from,
              `Esse print tá muito pesado. Tira um screenshot menor e manda de novo.`
            );
            return;
          }

          if (selfVsOther === 'self' && isProfileSelfAuditEnabled(phone)) {
            // ── Auditar Meu Perfil ──────────────────────────────────────
            const needsPlanCheck = PROFILE_SELF_AUDIT_MODE !== 'test';
            if (needsPlanCheck && !trial.isPro) {
              const { upsellMessage } = await canUseFeature(phone, trial.plan || 'free', 'profile_self_audit');
              await client.sendMessage(message.from, upsellMessage ||
                `Auditoria de Perfil é do *Parceiro Pro* 🔍\n\nDigita *pro* pra conhecer.`
              );
              return;
            }

            const profileLimit = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
            if (!profileLimit.allowed) {
              if (profileLimit.reason === 'cooldown') {
                await client.sendMessage(message.from,
                  `Aguarda ${profileLimit.remaining}s antes da próxima análise.`
                );
              } else {
                const { upsellMessage } = await canUseFeature(phone, trial.plan || 'free', 'profile_self_audit');
                await client.sendMessage(message.from, upsellMessage || PROFILE_LIMIT_REACHED_PRO);
              }
              return;
            }

            await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
            const stopTypingAudit = await startTyping(message);
            try {
              const { messages: auditMsgs } = await auditarPerfilProprio(media.data, media.mimetype, phone);
              stopTypingAudit();

              incrementProfileCount(phone);
              setProfileLastTime(phone);
              await incrementFeatureUsage(phone, 'profile_self_audit');
              logJourneyEvent(phone, 'first_profile_audit_done').catch(() => {});

              saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');

              for (const msg of auditMsgs) {
                await client.sendMessage(message.from, msg);
              }
            } catch (err) {
              stopTypingAudit();
              console.error('[ProfileSelfAudit] Erro:', err.message);
              if (err.message?.includes('muito grande')) {
                await client.sendMessage(message.from, `Esse print tá muito pesado. Tira um screenshot menor.`);
              } else {
                await client.sendMessage(message.from,
                  `Não consegui ler esse perfil. Manda um print mais claro — com fotos e bio visíveis.`
                );
              }
            }

          } else {
            // selfVsOther === 'other' — Analisar Perfil Dela
            const needsPlanCheck = PROFILE_HER_ANALYSIS_MODE !== 'test';
            if (needsPlanCheck && !trial.isPro) {
              const { upsellMessage } = await canUseFeature(phone, trial.plan || 'free', 'profile_her_analysis');
              await client.sendMessage(message.from, upsellMessage ||
                `Análise de Perfil é do *Parceiro Pro* 🔍\n\nDigita *pro* pra conhecer.`
              );
              trackSubscriptionEvent({
                phone,
                eventType:  'upgrade_offered',
                planFrom:   trial.isPremium ? 'parceiro' : (trial.inTrial ? 'trial' : 'free'),
                planTo:     'parceiro_pro',
                triggerCtx: 'profile_her_analysis',
              });
              return;
            }

            const profileLimit = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
            if (!profileLimit.allowed) {
              if (profileLimit.reason === 'cooldown') {
                await client.sendMessage(message.from,
                  `Aguarda ${profileLimit.remaining}s antes de analisar outro perfil.`
                );
              } else {
                const { upsellMessage } = await canUseFeature(phone, trial.plan || 'free', 'profile_her_analysis');
                await client.sendMessage(message.from, upsellMessage || PROFILE_LIMIT_REACHED_PRO);
              }
              return;
            }

            await message.reply(MENSAGENS_ESPERA_PERFIL[Math.floor(Math.random() * MENSAGENS_ESPERA_PERFIL.length)]);
            const stopTypingProfile = await startTyping(message);
            try {
              const { messages: profileMsgs } = await analisarPerfilComHaiku(media.data, media.mimetype, phone);
              stopTypingProfile();

              incrementProfileCount(phone);
              setProfileLastTime(phone);
              await incrementFeatureUsage(phone, 'profile_her_analysis');

              saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');

              for (const msg of profileMsgs) {
                await client.sendMessage(message.from, msg);
              }
            } catch (err) {
              stopTypingProfile();
              console.error('[ProfileHerAnalysis] Erro:', err.message);
              if (err.message?.includes('muito grande')) {
                await client.sendMessage(message.from, `Esse print tá muito pesado. Tira um screenshot menor.`);
              } else {
                await client.sendMessage(message.from,
                  `Não consegui ler esse perfil. Manda um print mais claro — com nome, bio e pelo menos uma foto.`
                );
              }
            }
          }

        } else if (isProfileAnalysisEnabled(phone)) {
          // ── Pipeline legado: Haiku 4.5 vision sem self/other routing ───
          const needsPlanCheck = PROFILE_ANALYSIS_MODE !== 'test';
          if (needsPlanCheck && !trial.isPro) {
            await client.sendMessage(message.from, PROFILE_UPSELL_MESSAGE);
            trackSubscriptionEvent({
              phone,
              eventType:  'upgrade_offered',
              planFrom:   trial.isPremium ? 'parceiro' : (trial.inTrial ? 'trial' : 'free'),
              planTo:     'parceiro_pro',
              triggerCtx: 'profile_analysis',
            });
            return;
          }

          const profileLimit = checkProfileLimit(phone, trial.isPro || !needsPlanCheck);
          if (!profileLimit.allowed) {
            if (profileLimit.reason === 'cooldown') {
              await client.sendMessage(message.from,
                `Aguarda ${profileLimit.remaining}s antes de analisar outro perfil.`
              );
            } else if (profileLimit.reason === 'limit_reached') {
              await client.sendMessage(message.from, PROFILE_LIMIT_REACHED_PRO);
            }
            return;
          }

          const estimatedBytesLegacy = (media.data || '').length * 0.75;
          if (estimatedBytesLegacy > 10 * 1024 * 1024) {
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
                `Não consegui ler esse perfil. Manda um print mais claro — com nome, bio e pelo menos uma foto.`
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
            await message.reply('Não consegui ler o perfil. Manda um print mais claro.');
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
                `Aguarda ${limitCheck.remaining}s antes de mandar outro print.`
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
            const { messages: printMsgs, structuredResult: printResultMain } = await analisarPrintConversaComHaiku(media.data, media.mimetype, phone);
            stopTypingPrint();

            incrementPrintCount(phone);
            setPrintLastTime(phone);

            saveUserContext(phone, { data: media.data, mimetype: media.mimetype }, 'image');
            if (printResultMain) {
              const ctxAfterPrint = userContext.get(phone) || {};
              userContext.set(phone, { ...ctxAfterPrint, lastPrintResult: printResultMain });
            }

            for (const msg of printMsgs) {
              await client.sendMessage(message.from, msg);
            }

            // Journey events: first_print_analyzed, third_print_analyzed, milestones
            logJourneyEvent(phone, 'first_print_analyzed').catch(() => {});
            incrementFeatureUsage(phone, 'print_count_narrative').catch(() => {});
            getDailyUsage(phone, 'print_analysis').then(usedToday => {
              if (usedToday >= 3) logJourneyEvent(phone, 'third_print_analyzed').catch(() => {});
            }).catch(() => {});
            // Milestones para engine narrativa
            checkMilestones(phone, async () => {
              const { count } = await require('@supabase/supabase-js').createClient(
                process.env.SUPABASE_URL, process.env.SUPABASE_KEY
              ).from('print_analyses').select('*', { count: 'exact', head: true }).eq('phone', phone);
              return count || 0;
            }, [
              { threshold: 2, eventType: 'print_count_2' },
              { threshold: 5, eventType: 'print_count_5' },
            ]).catch(() => {});

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
        await message.reply('Não consegui entender o áudio. Descreve em texto o que ela disse.');
        return;
      }

      console.log(`[Áudio] Transcrição (${transcricao.length} chars): "${transcricao.slice(0, 100)}..."`);

      // Mostra o que foi transcrito — o usuário sabe que foi entendido
      await client.sendMessage(message.from, `📝 _"${transcricao}"_`);

      // Analisa o texto transcrito normalmente
      const girlProfileAudio = await getGirlProfile(phone);
      const girlContextAudio = buildGirlContext(girlProfileAudio);
      const reconquistaExtraAudio = RECONQUISTA_KEYWORDS.test(transcricao) ? RECONQUISTA_CONTEXT : '';

      const result = await analisarTextoComClaude(transcricao, '', girlContextAudio + reconquistaExtraAudio, phone);
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
      await message.reply('Não consegui processar o áudio. Descreve em texto o que ela disse.');
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
    .in('plan', ['parceiro', 'parceiro_pro', 'wingman', 'wingman_pro'])
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

  // Journey event: trial encerrado (plano trial → free)
  // Detecta usuários com plan='trial' que deveriam ter virado free
  const trialCutoff = new Date(now);
  trialCutoff.setDate(trialCutoff.getDate() - TRIAL_DAYS);
  const { data: trialExpired } = await supabase
    .from('users')
    .select('phone')
    .eq('plan', 'trial')
    .lte('created_at', trialCutoff.toISOString());
  for (const u of trialExpired ?? []) {
    logJourneyEvent(u.phone, 'trial_ended', {}, false).catch(() => {});
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
  startMindsetWorker(client);
  startNarrativeWorker(client);
  startNarrativeEngine(client);
  setTimeout(verificarExpiracoes, 15000);
  setInterval(verificarExpiracoes, 6 * 60 * 60 * 1000);
});

client.initialize();
