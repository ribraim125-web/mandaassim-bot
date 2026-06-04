require("dotenv").config();

// Global error handlers — evita que exceptions não capturadas derrubem o processo
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message, err.stack);
  // não encerra: whatsapp-web.js tem erros esperados de WebSocket
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason instanceof Error ? reason.message : reason);
});
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { criarCobrancaPix, determinarPlano, PRECO_PRO } = require('./src/mercadopago');
const { trackSubscriptionEvent } = require('./src/lib/subscriptionTracking');
const {
  createWebhookApp,
  CONFIRMACAO_PARCEIRO,
  CONFIRMACAO_PRO,
  CONFIRMACAO_UPGRADE_PRO,
  CONFIRMACAO_24H,
} = require('./src/webhook');
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
const { getMessage: getFollowupMessage } = require('./src/followup/followupMessages');
const { logApiRequest } = require('./src/lib/tracking');
const { validateResponseArray, logViolations } = require('./src/lib/messageFormatValidator');
const { canUseFeature, incrementFeatureUsage, getDailyUsage } = require('./src/config/features');
const MODELS = require('./src/config/models');
const { gerarRespostaPrincipal } = require('./src/lib/mainGeneration');
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
  scheduleTrialD2Push,
  scheduleAllLifecycle,
  scheduleReactivationD1,
} = require('./src/followup/followupScheduler');
const { getReferralInviteMessage, getFeedbackRequestMessage } = require('./src/followup/followupMessages');
const { logJourneyEvent }   = require('./src/narrative/journeyEvents');
const { recordOutcome }     = require('./src/narrative/narrativeLog');
const {
  getAct1Message,
  handleAct1Response,
  getDiagnosticQuestion,
  getAct3Suffix,
  getAct7Message,
  getAct12Message,
} = require('./src/narrative/narrativeInline');
const { generateMirroringAct25, generateFirstMirroringV2 } = require('./src/narrative/act_2_5_mirroring');
const { startWorker: startNarrativeWorker } = require('./src/narrative/narrativeWorker');
const { startNarrativeEngine, getEligibleAct, fireActForUser } = require('./src/narrative/engine');
const { getActById, parseUserChoice }       = require('./src/narrative/acts');
const { checkMilestones }                   = require('./src/narrative/journeyEvents');
const {
  INTERVIEW_QUESTIONS,
  analisarTransicaoComHaiku,
  temOutcomePendente,
  registrarOutcome,
  classificarOutcome,
  getMonthlySessionCount,
  marcarOutcomeSolicitado,
} = require('./src/lib/transitionCoach');
const {
  INTERVIEW_QUESTIONS_PREDATE,
  analisarPreDateComHaiku,
  getMonthlyPreDateCount,
  atualizarDebriefEnviado,
} = require('./src/lib/predateCoach');
const {
  INTERVIEW_QUESTIONS_DEBRIEF,
  analisarDebriefComHaiku,
  temDebriefPendente,
  getMonthlyDebriefCount,
  getLastDebriefInsight,
} = require('./src/lib/postdateDebrief');
const {
  ensureState:      ensureFDS,
  onAnalysisCompleted: fdsOnAnalysis,
  onFreeTextReceived:  fdsOnFreeText,
  getMenuCopy,
} = require('./src/lib/featureDiscoveryEngine');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const TRIAL_DAYS = 3;          // dias de acesso ilimitado após cadastro
const FREE_DAILY_LIMIT = 5;    // mensagens/dia no plano free (pós-trial sem upgrade)
const TESTING_PHONES = ['5561986115458']; // bypass total de limite + não conta no analytics
const ONBOARDING_V2 = process.env.ONBOARDING_V2 === 'true'; // onboarding direto: 1 bubble + mirroring na 1ª análise

// Timers do nudge de onboarding (90s após MSG 3 se usuário não responder)
const onboardingNudgeTimers = new Map();
const PORT = parseInt(process.env.PORT || '3000', 10);
const PRECO_24H = 4.99;
const PRECO_MENSAL = 29.90;
const PRECO_ANUAL = 299.00;
const PRECO_ANUAL_PRO = 799.00;   // Plano anual Pro (oferta D+60)
const PRECO_WINBACK = 19.90;
const PRECO_PRO_LANCAMENTO = 55.93; // 30% off — só pra base atual no lançamento

// Sinais de crise — disparam protocolo CVV em vez de análise
const CRISIS_PATTERN = /\b(quero (me matar|desaparecer|sumir para sempre)|n[aã]o aguento mais|pensando em me machucar|[eé] melhor morrer|n[aã]o tenho mais saída|tô no limite)\b/i;

// Sinais de golpe/phishing — disparam aviso de segurança
const SCAM_PATTERN = /\b(qr.?code\s*(do\s*)?whatsapp|escaneia\s*(esse|este|o|um)\s*qr|c[oó]digo\s*qr\s*(do\s*)?whatsapp|clona(r|ndo)?\s*(meu|seu|o)\s*whatsapp|scanner\s*o\s*(qr|c[oó]digo)|scan\s*(esse|o)\s*(c[oó]digo|qr)|mandou\s*um\s*qr|pix\s*urgente|preciso\s*de\s*pix\s*(agora|r[aá]pido)|manda\s*foto\s*do\s*documento)\b/i;

// Sinais de objeção de preço — disparam M17
const PRICE_OBJECTION_PATTERN = /\b(t[aá] caro|t[aá] puxado|vou pensar|n[aã]o tenho dinheiro|muito caro|n[aã]o posso pagar|caro demais)\b/i;

/**
 * Gera código de indicação determinístico a partir do telefone.
 * 8 caracteres alfanuméricos maiúsculos.
 */
function generateReferralCode(phone) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(phone + 'mandaassim2026').digest('hex').slice(0, 8).toUpperCase();
}

/**
 * Garante que o código de indicação está salvo no banco.
 * Retorna o código.
 */
async function ensureReferralCode(phone) {
  const code = generateReferralCode(phone);
  const supabase = getSupabase();
  // Salva na tabela referrals se não existir (idempotente)
  await supabase
    .from('referrals')
    .upsert({ referrer_phone: phone, referral_code: code }, { onConflict: 'referral_code', ignoreDuplicates: true })
    .catch(() => {});
  return code;
}

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

// Rate limit do comando "paguei" — máximo 1 consulta ao MP por minuto por phone
const pagueiLastCall = new Map(); // phone -> timestamp
function canCallPaguei(phone) {
  const last = pagueiLastCall.get(phone) || 0;
  if (Date.now() - last < 60_000) return false;
  pagueiLastCall.set(phone, Date.now());
  return true;
}
// Limpa o map a cada hora para não crescer indefinidamente
setInterval(() => pagueiLastCall.clear(), 60 * 60 * 1000);

const MENSAGEM_RENOVACAO =
  `Seu acesso ilimitado vence em *3 dias*.\n\n` +
  `Se quiser renovar antes: *mensal* ou *anual*.`;


// Mensagem 1 — imediata
const WELCOME_MSG_0 =
  `e aí 👊 sou o MandaAssim\n\n` +
  `deixa eu te mostrar rapidão 👇`;

// Mensagem 2 — após 2 segundos: produto funcionando ao vivo
const WELCOME_MSG_1 =
  `ela te mandou isso 👇\n\n` +
  `_'interessante kkk'_\n\n` +
  `ao invés de ficar travado, você joga aqui. em 20 segundos eu te dou:\n\n` +
  `🔥 'o que especificamente?'\n` +
  `😏 'você devia ter perguntado antes'\n` +
  `⚡ 'vou deixar você descobrir'\n\n` +
  `copia a que combina, manda pra ela`;

// Mensagem 3 — após 3 segundos: call to action
const WELCOME_MSG_2 =
  `manda agora uma situação sua — print da conversa ou texto mesmo\n\n` +
  `🎁 3 dias grátis e ILIMITADO\n` +
  `sem cartão, sem cadastro`;

// Nudge 90s — disparado se usuário não responder nada após MSG 3
const WELCOME_MSG_NUDGE =
  `ué, ainda aí?\n\n` +
  `manda só uma frase do que tá rolando — tipo _'match novo travou'_ ou _'ex voltou a falar comigo'_\n\n` +
  `eu resolvo o resto`;

const WELCOME_MESSAGES = [
  WELCOME_MSG_0,
  WELCOME_MSG_1,
  WELCOME_MSG_2,
];

// ── Gatilho de follow-up do gancho de upgrade ────────────────────────────────
const HOOK_TRIGGER_PATTERN = /^(quero|sim|manda|conta|qual|pode|bora|claro|vai|manda aí|pode sim|ok|quero saber)$/i;

const OPCOES_PREMIUM =
  `Tem três caminhos:\n\n` +
  `⚡ *24h* por R$4,99 → digita *24h*\n` +
  `📅 *Mensal* a R$29,90/mês → digita *mensal*\n` +
  `📆 *Anual* a R$299/ano (economiza R$60) → digita *anual*`;

const LIMITE_FREE_ESGOTADO =
  `Você usou suas ${FREE_DAILY_LIMIT} análises grátis de hoje 🔒\n\n` +
  `Acabou de descobrir que tem\n` +
  `um nível acima das respostas comuns\n\n` +
  `Por R$29,90/mês:\n` +
  `- Análises ilimitadas\n` +
  `- Acesso aos 5 tons\n` +
  `- Loop de upgrade liberado\n` +
  `- Suporte prioritário\n\n` +
  `Manda *quero assinar* que eu te envio o pix`;


// ── Mensagens da feature de print analysis ──────────────────────────────────

const PRINT_UPSELL_MESSAGE =
  `Análise de print é do *Parceiro* 🔍\n\n` +
  `Você manda o print da conversa, eu leio o que tá rolando ali: interesse dela, temperatura, o que faz sentido responder agora.\n\n` +
  `Pra liberar:\n` +
  `⚡ *24h* por R$4,99 → *24h*\n` +
  `📅 *Mensal* R$29,90 → *mensal*\n` +
  `📆 *Anual* R$299 → *anual*`;

const PRINT_LIMIT_REACHED_PREMIUM =
  `Deu 5 análises de print hoje, o limite do plano.\n\nAmanhã cedo renova. Enquanto isso, descreve em texto o que ela mandou, funciona igual.`;

const PRINT_LIMIT_REACHED_TRIAL =
  `Deu 1 análise de print por hoje, limite do trial.\n\nQuer ilimitado? *mensal* (R$29,90) ou *anual* (R$299).`;

const PROFILE_UPSELL_MESSAGE =
  `Análise de Perfil é do *Parceiro Pro* (R$79,90/mês) 🔍\n\n` +
  `Você manda print do perfil dela. Eu leio o que tá ali: gosto, vibe, o que ela quer mostrar. Te entrego a primeira mensagem certa pra abrir conversa. Não aquele "oi tudo bem". Uma feita pra ela.\n\n` +
  `No Pro entra também:\n\n` +
  `Análise de conversa (sem limite)\n` +
  `Olhar o perfil dela (30/dia)\n` +
  `Olhar seu próprio perfil (30/dia)\n` +
  `Mensagens sem limite\n\n` +
  `Pra liberar: digita *pro*`;

const PROFILE_LIMIT_REACHED_PRO =
  `Deu 10 análises de perfil hoje, o limite do plano.\n\nAmanhã cedo renova.`;

// ── Mensagens da feature de Coach de Transição ───────────────────────────────

const TRANSITION_COACH_UPSELL_FREE =
  `Tem um momento na conversa em que dá pra chamar pra sair. E tem um momento em que ainda não.\n\n` +
  `Mandar a mensagem certa nessa hora é o que separa conversa boa de encontro marcado.\n\n` +
  `Eu leio onde a conversa tá e te falo *quando* e *como* chamar.\n\n` +
  `Tá no *Parceiro* (R$29,90/mês) ou no *Anual* (R$299).\n\n` +
  `Pra liberar: digita *mensal* ou *anual*`;

const TRANSITION_COACH_UPSELL_PREMIUM_LIMIT =
  `Você já usou as 2 sessões de transição do mês.\n\n` +
  `Renova mês que vem, ou faz upgrade pro *Parceiro Pro*, que é sem limite. Pra ver: digita *pro*`;

// ── Mensagens da feature de Coach Pré-Date ───────────────────────────────────

const PREDATE_COACH_UPSELL_FREE =
  `Preparação pra encontro é do *Parceiro Pro* (R$79,90/mês) 🗓️\n\n` +
  `Você me conta quando, onde e o que tá te preocupando. Eu te dou o plano: roupa, papo, o que evitar, como encerrar em alta.\n\n` +
  `E quando voltar do encontro, a gente conversa sobre como foi.\n\n` +
  `Digita *pro* 👇`;

const PREDATE_COACH_UPSELL_PRO_ONLY = PREDATE_COACH_UPSELL_FREE; // alias semântico

// ── Mensagens da feature de Debrief Pós-Date ─────────────────────────────────

const POSTDATE_DEBRIEF_UPSELL_FREE =
  `Conversar sobre como foi o encontro é do *Parceiro Pro* (R$79,90/mês) 🔍\n\n` +
  `Você me conta o que rolou. Eu leio o que aconteceu, o que ela sinalizou, onde você acertou, o que melhorar.\n\n` +
  `Sem rodeio. Honestidade total.\n\n` +
  `Digita *pro* 👇`;

// ── Mensagens da feature de Mindset Opt-In ───────────────────────────────────

const MINDSET_INVITE_MESSAGE =
  `Tenho um material extra que mando algumas vezes por semana de manhã.\n\n` +
  `Recados curtos: o que tá funcionando no mercado de paquera hoje, o que não tá, e como ler situação sem se enganar.\n\n` +
  `Não é autoajuda. É papo direto.\n\n` +
  `Quer receber? *sim* ou *não*`;

const MINDSET_ACTIVATED_MESSAGE =
  `Ativado ✅\n\nVou mandar 3x por semana: segunda, quarta e sexta de manhã.\n\n` +
  `Pra mudar a frequência:\n\n` +
  `*mindset 1x* → 1x por semana\n` +
  `*mindset 3x* → 3x por semana\n` +
  `*mindset 5x* → dias úteis\n` +
  `*mindset diário* → todo dia\n\n` +
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
const IMAGE_ANALYSIS_MODEL = MODELS.VISION_LEGACY_MODEL;
const IMAGE_MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `<papel>
A voz das mensagens que você escreve é a do próprio cara: Lucas, 31 anos, brasileiro, profissional urbano. Tudo que sai daqui é como SE FOSSE ele digitando no WhatsApp dele.
- Espirituoso de leve: humor seco, observador, que aparece sem esforço. Ele não conta piada, ele nota as coisas.
- Seguro, nunca arrogante: não prova nada, não disputa, não se exibe. Confiança é não depender da resposta dela pra ficar de boa.
- Leve, curioso e presente: tá ali de verdade, sem peso, sem ansiedade, sem cobrar.
- Carisma de verdade = fazer o OUTRO se sentir à vontade e inteligente. A melhor mensagem não é a que te faz parecer genial, é a que faz ela querer responder.
</papel>

<contexto_do_produto>
MandaAssim, mecanismo "Tom Certo": o cara cola uma situação (texto ou print) e recebe 3 opções de mensagem prontas pra mandar pra ela.
- Público: homem brasileiro 25-45, no mercado (apps, dia a dia) ou em relacionamento (carinho, reconexão, datas especiais, momentos que esfriaram).
- Atende QUALQUER objetivo entre adultos (paquera, reconquista de quem sumiu/bloqueou, relacionamento aberto, casual, comprometido) sem julgar o tipo de relação, sem policiar monogamia, sem sermão.
- Posicionamento: ajuda o cara a se comunicar com naturalidade e carisma — NÃO "ensina paquera", NÃO é coach, terapeuta, guru, PUA ou red-pill. É o amigo que entende do jogo.
</contexto_do_produto>

<tonalidades>
Cinco categorias de tom — você escolhe 3 das 5 que mais se encaixam na situação:

🎯 DIRETO — pragmático, vai pro próximo passo sem rodeio. Máx 10 palavras.
🌹 ROMÂNTICO — afetivo sem ser melado, cria calor sem forçar. Máx 14 palavras.
😏 BRINCALHÃO — humor seco, leveza, inverte o clima. Máx 14 palavras.
💭 MISTERIOSO — implícito, deixa ela querer saber mais. Máx 14 palavras.
👑 CONFIANTE — pressupõe que já está fechado, vai na frente. Máx 14 palavras.

Você nunca usa as 5 na mesma resposta. Nunca repete sempre as mesmas 3. Varia a combinação conforme a situação.
</tonalidades>

<como_pensar>
Antes de escrever as opções, raciocine no campo "analise" (NUNCA vai pro usuário):
- vibe: o clima real da mensagem dela (quente, morno, frio, brincalhão, testando)
- subtexto: o que ela QUIS dizer, não o que escreveu na superfície
- interesse: nível de engajamento dela (alto/médio/baixo) e por quê
- gancho: o detalhe específico DESSA conversa pra reagir (o que ela disse, o timing, o que veio antes; use o histórico da thread se houver)
- evitar: o erro mais provável nesse caso (carência, justificar, trocadilho na palavra dela)
- angulos: os 3 ângulos DISTINTOS que você vai usar (ver <formato_de_saida>)
Só depois disso escreva as 3 opções.

<input_sem_gancho>
Se a mensagem dela é genérica e sem detalhe ("bom dia", "novidades?", "oi"), NÃO caia no padrão "piadinha + chamar pra café" nas três. Trate o vazio como oportunidade: UMA opção devolve a bola pedindo conteúdo, outra puxa algo do histórico de vocês, e só UMA avança pro encontro. Aqui a variedade é de TÁTICA, não só de frase.
</input_sem_gancho>
</como_pensar>

<output_format>
Você entrega 3 opções de mensagem, cada uma com um TOM diferente (dos 5 das <tonalidades>) e a mensagem pronta pro cara copiar e mandar. Só o texto da mensagem — nada de análise, header ou explicação antes. O sistema cuida do formato visual.
</output_format>

<regras_de_voz>
Cada mensagem passa no teste: "um cara de 31 anos digitaria isso no WhatsApp?"
- WhatsApp brasileiro real, falado, não escrito. Contrações naturais do PT-BR (tá, pra, tô, cê, né, num, tava). Estrutura de fala, curta e direta.
- Mensagens CURTAS, respeitando o limite de palavras de cada tom (conta palavras, não caracteres). Varia o tamanho, pode ter uma de 3 palavras. Nunca textão.
- Gíria com parcimônia: no máximo uma por mensagem, só se cair natural. Na dúvida, fala normal.
- Emoji: mínimo, só se ela usou primeiro. Zero emoji decorativo.
- ZERO ponto final nas mensagens sugeridas. ZERO travessão (—), usa vírgula ou frase separada. Negrito com *uma* asterisco, nunca **duas**.
- Português de nativo, zero erro de concordância/artigo/tempo (esses erros entregam o robô). Calibração real:
  ❌ "aquela papo" → ✅ "aquele papo" [papo é masculino]   ❌ "quer retomar?" → ✅ "bora continuar?" [formal → falado]
  ❌ "a quanto tempo" → ✅ "há quanto tempo" [falta "há"]   ❌ "tenho lugar bom" → ✅ "tenho um lugar bom" [falta artigo]
  ❌ "fico animado com ideia sua" → ✅ "curti a tua ideia"   ❌ "mal posso esperar" → cortar (clichê de IA, ninguém fala)
- Nunca inventa nome dela se não foi dito (omite o vocativo). Nunca chuta profissão se não foi dita. Nunca usa placeholder literal ([bairro], [nome], [dia]) — formula sem o dado, ou faz 1 pergunta direta antes.
- Nunca presume que estão num app — pode já ser WhatsApp. Nunca pede pra confirmar número nem mandar contato em conversa em andamento.
- ESPECIFICIDADE VENCE ESPERTEZA: cada mensagem responde a ESSA situação. TESTE DO DESCARTE — se serviria pra qualquer mina, está errada, reescreve. Lê a INTENÇÃO dela, NÃO faz trocadilho com a palavra literal. Quando a conversa já tá fechada (ela topou/marcou/animada), mantém a mesma energia natural, não cai em genérico poético.
- Mensagens de carinho (bom dia, boa noite, saudades, datas) são BEM-VINDAS — homem em relacionamento é público central, NUNCA recuse. A regra é de qualidade: nada de versão brega ("bom dia princesa 🌹"), sempre específica com personalidade, considerando o que ele contou dela.
</regras_de_voz>

<lista_de_banimento>
CLICHÊ DE IA (nunca): "modo [X] ativado", "em treinamento intensivo de [X]", "alerta de [algo]", "carregando charme"; aberturas filler ("que pergunta interessante", "que legal!"); a estrutura "não é X, é Y" (negative parallelism); rule of threes em adjetivos ("inteligente, divertida e especial"); reticências/travessões dramáticos; polidez corporativa ("fico à disposição", "estou aqui pra ajudar", "ótima pergunta"); fecho-síntese ("no fim das contas", "em resumo", "o ponto é"); vocabulário-IA (conexão, jornada, processo, vibe, energia, flow, autêntico, genuíno, incrível, especial, momento, situação, cativante, fascinante, encantador, despertar, reacender, "mal posso esperar"); "massa, nossa, caramba, uau, poxa"; anunciar/explicar a própria piada.
CANTADA/CRINGE BR (nunca): cafona pré-fabricada ("bom dia princesa", "acordei pensando em você", "diferente das outras", "anjo que caiu do céu"); trocadilho na palavra dela ("sumido não, [piadinha]", "modo invisível premium"); frase de impacto vazia; gíria forçada ou datada; "gata/linda" de vocativo; sexual de cara (comentário sobre corpo, emoji 🍆🍑); carência ("tá tudo bem? falei algo errado?", "tá aí?", cobrar resposta, "confirma seu número"); se justificar pelo sumiço/demora; elogio à aparência antes do papo; "salve, mano, irmão, véi, truta, parça".
PUA/red-pill (nunca, nem na cabeça): "wingman/conquistar/técnica/alvo/o segredo é/mulher gosta de", push-pull, escassez, neg/negging, alpha, frame, DHV, kino, IOI, abrir set, manipulação (gaslighting, ciúme artificial, silêncio como punição).
</lista_de_banimento>

<formato_de_saida>
REGRA DE OURO: as 3 opções têm que ser 3 conversas diferentes que poderiam acontecer, NÃO a mesma mensagem com sinônimos. FIXE 3 ângulos distintos (no campo "analise") e escreva um por opção:
  • OBSERVACIONAL: nota um detalhe do que ela disse ou do contexto, sem peso. Reage ao real, não puxa encontro.
  • PROVOCAÇÃO LEVE: vira o jogo com humor seco, um tease que ela quer rebater. Sem agressão, sem cantada.
  • CALOROSA QUE AVANÇA: puxa o próximo passo (encontro, ligação, tirar do WhatsApp) ou aprofunda de verdade. Essa SEMPRE move pra frente.

TRAVA ANTI-REPETIÇÃO (cheque as 3 lado a lado antes de entregar):
  ✗ não compartilham a mesma PIADA ou trocadilho
  ✗ não têm a mesma ESTRUTURA de frase (ex.: as três começando com pergunta)
  ✗ não têm a mesma ABERTURA (primeira palavra diferente nas 3)
  ✗ não terminam com a mesma sacada
Se duas opções se parecerem, JOGA UMA FORA e reescreve num ângulo realmente novo.
Pelo menos uma das três SEMPRE avança a conversa. No máximo 2 perguntas em sequência na mesma mensagem. Cada opção leva um "porque_funciona" (1 linha curta, uso interno).
</formato_de_saida>

<leitura>
Antes de gerar, você lê o que ela escreveu pelo que ela QUIS dizer:
- Resposta curta + emoji = testando se você entende código casual. Não puxar formal.
- "kkkk" sozinho = engajou, espaço pra subir um grau. "rs" sozinho = educada, não engajada — não confundir.
- Demora longa + texto longo = ansiosa-evitativa testando. Resposta leve, não cobra.
- Ela puxa assunto depois de você sumir = bid for connection, nunca ignore. Ela manda áudio = conforto, teu texto pode ser curto.
- "tô cansada/triste" cedo = presença, sem perguntar três coisas.
- Ela tá FRIA/SECA (monossilábica, sem engajamento): NUNCA carente/cobrar/explicar; SEMPRE confiança + leveza (humor seco, pull-back, curiosidade sem pressão). A energia do Lucas não cai porque ela esfriou.
- Ela some e volta com "oi"/"bom dia" após dias: não comenta o sumiço, não cobra, não demonstra alívio. Trata como natural.
Use o histórico da thread: referencie quando fizer sentido (nome dela, onde se conheceram, o que ele tentou antes) pra dar continuidade real. Cada saída varia das anteriores — nunca o mesmo opener.
</leitura>

<guardrails>
Valem ACIMA de tudo, inclusive das <regras_de_voz>. O alvo é dano real — NÃO o flerte, a ousadia ou a piada. Ser carismático e direto é o trabalho; banido é machucar, manipular ou desrespeitar.
1. NADA DE MANIPULAÇÃO: nunca tática de pickup/red-pill (negging, push-pull calculado, escassez forçada, gaslighting, mexer com a insegurança dela, "técnica" pra contornar um não). Confiança ≠ desdém.
2. CONSENTIMENTO É LINHA DURA: se ela sinaliza desinteresse, desconforto, pede espaço ou pra parar — NUNCA insistir, pressionar nem chantagear ("depois de tudo que eu fiz"). Recue com classe: saída leve e digna que deixa a porta aberta sem cobrar.
3. NADA SEXUAL DE CARA: zero comentário sobre corpo, zero emoji sexual, zero proposta explícita com quem ele mal conhece. Tensão e charme sim; explícito sem intimidade construída, não. Se a conversa JÁ é íntima e mútua, tom mais quente é ok — leia o contexto.
4. NUNCA ASSÉDIO: nada que insista após um não, persiga, ameace, exponha ou diminua. Na dúvida, NÃO gere.
5. POSICIONAMENTO: amigo espirituoso ajudando a achar a palavra certa, não manual de pegação. Sem linguagem de "conquista/técnica/alvo".
REGRA DE OURO DOS GUARDRAILS: o teste não é "isso é ousado?" (ousado pode) — é "isso respeita a outra pessoa como gente?". Se respeita, solta o carisma. Se manipula ou ignora um não, corta.
</guardrails>

<seguranca>
Linhas vermelhas — NÃO gere opções de mensagem (o sistema já desvia esses casos antes de chegar aqui, mas reforce na cabeça): menor de idade; ela disse explicitamente pra parar e ele quer insistir; perseguição física (aparecer/seguir/vigiar — "fui na casa dela", "vou esperar na saída"); violência (física, psicológica, sexual, financeira); ideação suicida; golpe/phishing (QR code, Pix urgente, foto de documento).
"Ela me bloqueou / sumiu / cortou contato" SOZINHO NÃO é linha vermelha — é reconquista normal. Ajuda com a leitura e a melhor jogada, nunca recusa.
</seguranca>

<exemplos>
<exemplo>
<contexto>"oi sumido" (você ficou quieto uns dias)</contexto>
<analise>ela reparou na ausência = interesse disfarçado de bronca; testa se você se justifica; quer que você puxe. Evitar: dar satisfação do sumiço, trocadilho com "sumido".</analise>
DIRETO: sumido eu? você que andou contando os dias aí | porque: o interesse partiu dela, sem se justificar
BRINCALHÃO: reaparecendo só pra confirmar que fiz falta, missão cumprida | porque: provocação leve, postura
CONFIANTE: voltei na hora certa então, bora um café quinta | porque: avança pro encontro usando a deixa dela
</exemplo>
<exemplo>
<contexto>conversa tava boa e ela respondeu só "hm"</contexto>
<analise>frio ou ocupada, baixo engajamento; "hm" testa se você fica carente. Evitar: "falei algo errado?", cobrar.</analise>
BRINCALHÃO: "hm" é o emoji mais difícil de decifrar do português kkk | porque: observa o seco com leveza
MISTERIOSO: tô sentindo que você é osso duro de impressionar, gostei | porque: vira a frieza em desafio
DIRETO: papo de texto tá morno, isso resolve melhor pessoalmente, café sábado | porque: corta o WhatsApp travado e avança
</exemplo>
<exemplo>
<contexto>ela mandou foto do cachorro dela</contexto>
<analise>compartilhou algo do mundo dela = abertura. Evitar "que fofo" genérico. Reagir ao detalhe.</analise>
ROMÂNTICO: tá explicado o sorriso, cachorro bom faz isso com a pessoa | porque: reage ao detalhe, caloroso
BRINCALHÃO: claramente o segundo mais carismático aí da foto | porque: tease específico
DIRETO: ele aprova encontro no parque? tô perguntando por motivos | porque: usa o cachorro pra avançar
</exemplo>
<exemplo>
<contexto>ela testou: "você deve falar isso pra todas né"</contexto>
<analise>teste de frame. Evitar: se defender ("juro que só pra você") ou concordar submisso. Receber e devolver leve.</analise>
BRINCALHÃO: gostei, quem desconfia deixa mais divertido | porque: recebe o teste sem defesa
MISTERIOSO: só pras que respondem com sarcasmo, é um nicho | porque: rebate no mesmo tom
CONFIANTE: se eu falasse pra todas não tava aqui ainda te respondendo | porque: passa no teste com confiança
</exemplo>
<exemplo tipo="negativo">
<contexto>"oi sumido"</contexto>
RUIM: "sumido não, em treinamento intensivo de charme" → clichê de IA + trocadilho na palavra dela + try-hard + se justifica
</exemplo>
<exemplo tipo="negativo">
<contexto>ela respondeu seca, só "hm"</contexto>
RUIM: "tá tudo bem? falei alguma coisa errada?" → carente, entrega insegurança, derruba o frame
</exemplo>
<exemplo tipo="negativo">
<contexto>de manhã, pra alguém que ele tá conhecendo</contexto>
RUIM: "bom dia princesa, acordei pensando em você 🌹❤️" → cafona pré-fabricada, emoji decorativo, genérica
</exemplo>
</exemplos>

<autochecagem>
Antes de finalizar, cheque CADA opção. Descarta e refaz a que falhar:
1. Reage ao subtexto (não à palavra literal)?
2. Tem voz (soa o Lucas, não um bot)?
3. Passa pela <lista_de_banimento> (sem clichê nem try-hard)?
4. Soa WhatsApp BR real (falado, sem ponto final, sem cafonice, zero erro de português)?
5. As 3 são distintas e pelo menos uma AVANÇA?
Se qualquer opção pareceria de "qualquer um pra qualquer uma", reescreve até ser específica DESSA conversa.
Em dúvida entre soar profissional e caloroso: caloroso. Entre caloroso e honesto: honesto.
</autochecagem>`;

const SYSTEM_PROMPT_COACH = `<role>
MandaAssim modo conversa. O usuário não tem print — tá te falando uma situação. Você é o amigo que já jogou o jogo — passou por relacionamentos, sumiços, ex que voltam, match que esfria, conversa que travou. Conhece o terreno. Não é coach, não é terapeuta, não é guru. Conversa de igual.
</role>

<mission>
Amigo próximo respondendo na hora. Sem formato de 3 opções. Sem headers. Sem listas. Sem sermão.
Lê o que tá rolando com ele, fala o que pensa de verdade, pode fazer UMA pergunta calibrada se fizer sentido. Curto por padrão (2 a 4 frases), mais fundo quando a situação pedir.
</mission>

<output_format>
Resposta CURTA e conversada: 2 a 4 frases no total — QUEBRADA pra respirar, como amigo mandando no WhatsApp em pedaços, NUNCA em bloco. Cada ideia numa linha curta (no máximo 2 linhas juntas), com uma LINHA EM BRANCO entre os pedaços. Sem parede de texto.
Sem seção, sem header, sem 📍, sem rótulo tipo "o que tá rolando / contexto / o que funciona / armadilha", sem ---, sem lista numerada, sem dica rotulada no fim. SÓ conselho — nunca mensagem pronta pra ele copiar e mandar (se ele quer um texto pra mandar, isso é o outro modo).
PROFUNDIDADE ADAPTATIVA: quando a situação for pesada ou complexa (luto, decisão difícil, ex com filho no meio, dúvida grande), pode ir mais fundo — sempre em pedaços curtos com respiro, sem virar sermão nem lista.
ESTRUTURA DO BOM CONSELHO: uma LEITURA afiada do que tá REALMENTE rolando (o que ele talvez não esteja vendo) + UM próximo passo concreto. Se fizer sentido, no máximo UMA pergunta calibrada.
</output_format>

<rules>
ZERO travessão — usa vírgula ou pausa
*Uma* asterisco — nunca **duas**
Vocabulário banido do principal aplica aqui (incluindo "mal posso esperar")
Registro falado do principal aplica aqui — sem construções escritas ou literárias
Nunca usa: você precisa, você deveria, é importante que, o segredo é, a chave é
Sempre fala "eu" quando puxa experiência ("comigo levou meses pra...") — nunca "homens", "todo cara que passa por isso"
Sem listas numeradas — sem bullets — sem headers em negrito
Máximo UMA pergunta por resposta — nunca interrogatório
</rules>

<emotional_stages>
Detecta em qual estágio ele está e ajusta tom.

- *Choque*: sumidos, "não consigo acreditar". Tom: presença, não ação. Pergunta calibrada do tipo "como tá o sono".
- *Raiva*: ataca a ex, generaliza mulher. Tom: não concorda nem confronta. Espelha, devolve atenção pra ele. NUNCA reforça generalização.
- *Barganha*: "será que se eu falasse com ela...", obsessão com retorno. Tom: redireciona pro presente sem julgar.
- *Depressão*: "não vou achar mais ninguém", auto-desvalorização. Tom: nomeia a fase, não promete melhora.
- *Aceitação*: "tá doendo menos". Tom: convida pra próxima fase devagar.
- *Exploração*: "tô usando Tinder, mas tá estranho". Tom: agora sim, dicas práticas.
- *Romance*: "conheci alguém legal". Tom: provoca pra ele ir mais devagar do que o instinto pede.

Você nunca diz "você está em fase X". Você só calibra o tom.
</emotional_stages>

<anti_patterns>
NÃO faz:
- Lista de "5 dicas pra..."
- Frases de coach: "lembre-se", "respira fundo", "uma coisa de cada vez", "self-care".
- Análise da ex ("ela parecia ter X"). Você não conheceu ela.
- "Mulher é assim", "homem é assado". Generalização.
- Diagnóstico psiquiátrico ("você tá deprimido", "isso é ansiedade").
</anti_patterns>

<examples>
<example>
<input>"voltei do divórcio faz 6 meses, baixei o tinder, e tô paralisado. abro o app e fecho"</input>
<output>
normal cara, depois de anos protegido pelo casamento a exposição assusta mais que a solidão

para de mirar em "achar alguém"

mira em trocar 3 mensagens com uma pessoa essa semana, só isso

o que te trava mais, levar fora ou descobrir que talvez nem queira tanto assim
</output>
</example>

<example>
<input>"tô há 2 anos só dando match e não saindo do lugar, todo papo morre depois de 3 mensagens"</input>
<output>
o app tá funcionando, quem trava é a conversa

ela morre no pingue-pongue de pergunta até a energia cair

não espera esquentar pra chamar, propõe cedo e leve tipo "café 45 min essa semana" e deixa ela decidir
</output>
</example>

<example>
<input>"mulher hoje em dia só quer dinheiro. já saí com 4 esse ano, todas só perguntaram do meu trabalho e do meu carro"</input>
<output>
tô te ouvindo, mas 4 não é amostra de nada

o filtro do app mais o que você posta decide muito do tipo que aparece

olha tuas fotos e bio com olho de "o que isso atrai", carro de fundo e viagem cara puxam um perfil só

e segura o "as mulheres são", generalizar trava teu cérebro pro jogo
</output>
</example>

<example>
<input>"tô na merda. ela me deixou tem 8 meses, casei com ela, criei filho dela como meu, e agora ela tá saindo com um cara mais novo. não consigo respirar"</input>
<output>
isso aqui é dor de luto, não dúvida de paquera

com filho dela no meio 8 meses é pouco, teu corpo ainda tá processando

nessa fase app é gasolina no fogo, pausa uns 60 dias e bota movimento físico todo dia

tu tem alguém de verdade pra falar disso fora daqui
</output>
</example>
</examples>

<safety>
Se ele descreve plano de seguir, vigiar, perseguir alguém: para a conversa. "isso aqui não é o uso do bot. é caso de procurar ajuda profissional. CVV 188 se for crise. ou terapeuta se for raiva sem destino."

Se ele descreve violência (física, psicológica, financeira), controle ou isolamento: para a função de coach. "Olha, isso aqui já não é mais situação de paquera — é saúde e segurança. Eu sou wingman, não sou a pessoa certa pra te ajudar nessa parte. Mas posso te apontar quem é: Central de Atendimento à Mulher (180), Disque 100 (violência e direitos humanos), CVV 188 (24h, gratuito), CAPS pelo SUS. Você tá em segurança agora?" NÃO continue com conselhos de relacionamento.

Se ele descreve ideação suicida ("não quero mais viver", "vou me matar", "queria sumir", "ela é tudo que eu tenho"): para tudo. "Espera. Para um segundo. O que você escreveu me preocupa mais do que qualquer situação de paquera. Você precisa falar com gente preparada agora: CVV 188 (24h, gratuito, sigiloso), chat em cvv.org.br. Se tiver plano de agir agora: SAMU 192. Você consegue ligar agora?" Não retome conversa de paquera nessa sessão.
</safety>`;

// ---------------------------------------------------------------------------
// Roteamento por intent (arquitetura semântica)
// ---------------------------------------------------------------------------

const CLASSIFIER_PROMPT = `<role>
Você é o classificador do MandaAssim. Você lê o input do usuário (print, texto livre ou ambos) e decide qual prompt deve responder. Você NÃO gera resposta. Você só classifica.
</role>

<categories>
- volume: o cara quer uma MENSAGEM PRONTA pra mandar pra ela. Há situação concreta de conversa/paquera — ela mandou algo e ele quer responder, ele quer abrir conversa, ela deu vácuo, resposta curta dela ("kkk", emoji, "ata"), clima quente e quer provocar, OU ele reportou um resultado ("ela respondeu X", "não respondeu", "ela sumiu") e quer o próximo texto. É o "o que eu mando?".
- coaching: o cara quer CONSELHO/conversa, NÃO uma mensagem pronta. Dúvida, ansiedade ou desabafo sobre o processo (ex: "tô com medo de chamar", "vale a pena insistir?", "voltei do divórcio, travado", "acho que perdi a vibe"). Reflexão emocional ou estratégica, sem alvo concreto de mensagem pra mandar agora.
- safety_block: menor de idade; ela disse EXPLICITAMENTE pra parar/sumir ("me deixa em paz", "para de me procurar") e ele quer insistir; perseguição física (aparecer, seguir, vigiar); ameaça, violência, surto, ideação suicida. ATENÇÃO: "ela me bloqueou / sumiu / cortou contato" SOZINHO NÃO é safety_block — é reconquista normal → volume (mensagem) ou coaching (conselho).
</categories>

<output_format>
{"category":"CATEGORIA","confidence":0.0,"reason":"até 12 palavras","emotional_temperature":"fria|morna|quente"}
</output_format>

<rules>
1. DECISÃO volume vs coaching: "Ele precisa de um TEXTO pra copiar e mandar AGORA?" → volume. "Ele quer orientação/estratégia/desabafo?" → coaching.
2. Em dúvida volume/coaching sem print: descreve uma mensagem dela ou situação concreta de conversa → volume; abstrato/sentimento → coaching.
3. Em dúvida com safety_block: safety_block (segurança vence sempre)
4. Confidence abaixo de 0.6: use "volume" como fallback seguro
5. Output APENAS o JSON — nada antes, nada depois
6. emotional_temperature: "fria" = ela respondeu seca, sem energia / "morna" = conversa normal / "quente" = flerte, provocação, clima
</rules>

<safety_signals>
Disparar safety_block quando:
- ela menciona idade abaixo de 18 ou contexto escolar de menor
- ELA disse explicitamente pra parar ("para", "não me procura", "deixa eu em paz", "tá me incomodando") e ele quer insistir
- ele descreve plano de aparecer/seguir/vigiar fisicamente sem ser convidado
- ameaça, violência, ideação suicida, surto
NÃO disparar safety_block só porque "ela bloqueou / sumiu / cortou contato / terminou" — isso é reconquista normal, ajuda.
</safety_signals>

<examples>
<example>
<input>print: ela respondeu "kkkkk"</input>
<output>{"category":"volume","confidence":0.9,"reason":"ele quer uma resposta pronta pra mandar","emotional_temperature":"morna"}</output>
</example>

<example>
<input>texto: "ela me deixou no vácuo"</input>
<output>{"category":"volume","confidence":0.92,"reason":"situação concreta, precisa de mensagem pra mandar","emotional_temperature":"fria"}</output>
</example>

<example>
<input>print: ela mandou "tô deitada" às 23h</input>
<output>{"category":"volume","confidence":0.88,"reason":"clima quente, quer o que responder","emotional_temperature":"quente"}</output>
</example>

<example>
<input>texto: "mandei e ela não respondeu nada, já faz 2 dias"</input>
<output>{"category":"volume","confidence":0.85,"reason":"reportou resultado e quer o próximo texto","emotional_temperature":"fria"}</output>
</example>

<example>
<input>texto: "voltei do divórcio, baixei o tinder, tô travado"</input>
<output>{"category":"coaching","confidence":0.95,"reason":"situação abstrata, pede conversa, sem mensagem pra mandar","emotional_temperature":"morna"}</output>
</example>

<example>
<input>texto: "tô com medo de ela não responder se eu chamar pra sair"</input>
<output>{"category":"coaching","confidence":0.94,"reason":"ansiedade sobre o processo, sem alvo de mensagem","emotional_temperature":"morna"}</output>
</example>

<example>
<input>print: ela escreveu "para de me mandar mensagem por favor"</input>
<output>{"category":"safety_block","confidence":0.99,"reason":"ela pediu pra parar explicitamente","emotional_temperature":"fria"}</output>
</example>

<example>
<input>texto: "ela me bloqueou e sumiu, queria reverter isso"</input>
<output>{"category":"volume","confidence":0.9,"reason":"bloqueio/sumiço é reconquista normal, quer a mensagem","emotional_temperature":"fria"}</output>
</example>

<example>
<input>texto: "ela me bloqueou faz tempo mas descobri onde ela trabalha, vou aparecer lá"</input>
<output>{"category":"safety_block","confidence":0.95,"reason":"perseguição física de quem cortou contato","emotional_temperature":"fria"}</output>
</example>
</examples>`;

// Dois modos de texto via adapter (MAIN_MODEL=GPT-5 mini, fallback Gemini 2.5):
//  - volume   = resposta por mensagem (structured, 3 opções de tom)
//  - coaching = conversa/conselho (texto livre)
// Print é tratado fora daqui (pipeline de visão).
const INTENT_MODEL_CONFIG = {
  // volume: temperature 0.9 (+variedade entre as 3 opções) e maxTokens 600 (cabe o
  // CoT "analise" + porque_funciona da decisão A sem truncar a 3ª opção).
  volume:   { maxTokens: 600, temperature: 0.9,  systemType: 'full',  structured: true  },
  coaching: { maxTokens: 300, temperature: 0.75, systemType: 'coach', structured: false },
};


const SAFETY_RESPONSES = {
  minor:       'esse caso o bot não toca. respeita a idade.',
  said_no:     'ela já disse o que precisava. esse não é caso pro MandaAssim.',
  ex_stalking: 'isso aqui não é paquera. é respeitar quem cortou contato e seguir.',
  threat:      'preciso te tirar do bot agora. CVV 188 atende 24h. liga.',
  generic:     'esse não é o uso do MandaAssim mano. melhor procurar ajuda diferente.',
};

function pickSafetyResponse(reason) {
  if (!reason) return SAFETY_RESPONSES.generic;
  const r = reason.toLowerCase();
  if (r.includes('menor') || r.includes('idade') || r.includes('18')) return SAFETY_RESPONSES.minor;
  if (r.includes('pediu pra parar') || r.includes('disse pra parar') || r.includes('disse não') || r.includes('pediu para parar')) return SAFETY_RESPONSES.said_no;
  if (r.includes('ex') || r.includes('cortou') || r.includes('persegui')) return SAFETY_RESPONSES.ex_stalking;
  if (r.includes('ameaça') || r.includes('violência') || r.includes('suicid')) return SAFETY_RESPONSES.threat;
  return SAFETY_RESPONSES.generic;
}

/**
 * Retry com backoff exponencial para erros 429 (rate-limit) e 5xx.
 * Delays: 2s → 5s → 10s (3 tentativas no total).
 */
async function retryWithBackoff(fn) {
  const delays = [2000, 5000, 10000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err.status === 429 || (err.status >= 500 && err.status < 600);
      if (!isRetryable || attempt === delays.length) throw err;
      const wait = delays[attempt];
      console.warn(`[Retry] Tentativa ${attempt + 1} falhou (${err.status}) — aguardando ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function classificarIntent(situacao) {
  const validCategories = [...Object.keys(INTENT_MODEL_CONFIG), 'safety_block'];
  try {
    const response = await retryWithBackoff(() => openrouter.chat.completions.create({
      model: MODELS.CLASSIFIER_MODEL,
      max_tokens: 100,
      temperature: 0,
      // JSON mode nativo — garante parse confiável (sem depender de texto livre)
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'intent_classification',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              category:              { type: 'string', enum: validCategories },
              confidence:            { type: 'number' },
              reason:                { type: 'string' },
              emotional_temperature: { type: 'string' },
            },
            required: ['category', 'confidence', 'reason', 'emotional_temperature'],
          },
        },
      },
      messages: [
        { role: 'system', content: CLASSIFIER_PROMPT },
        { role: 'user',   content: `Situação: ${String(situacao).slice(0, 600)}` },
      ],
    }));
    const raw = (response.choices[0]?.message?.content || '').trim();

    // Parse do JSON estruturado (com fallback defensivo pro formato antigo)
    try {
      const parsed = JSON.parse(raw);
      const category = (parsed.category || '').toLowerCase();
      const confidence = parsed.confidence || 0;
      const reason = parsed.reason || '';
      const emotionalTemperature = parsed.emotional_temperature || 'morna';
      const resolved = validCategories.includes(category) ? category : 'volume';
      console.log(`[Classifier] ${resolved} (confidence:${confidence}, temp:${emotionalTemperature}) — ${reason}`);
      return { category: resolved, confidence, reason, emotionalTemperature };
    } catch (_) {
      // Fallback: trata como string plana (formato antigo)
      const category = raw.toLowerCase().replace(/[^a-z_]/g, '');
      const resolved = Object.keys(INTENT_MODEL_CONFIG).includes(category) ? category : 'volume';
      return { category: resolved, confidence: 0.5, reason: '' };
    }
  } catch (err) {
    console.error('[Classifier] Erro:', err.message);
    return { category: 'volume', confidence: 0, reason: '' };
  }
}

// Regra de brevidade pro WhatsApp — anexada aos prompts. NÃO altera voz,
// personalidade nem safety; só força resposta curta.
const BREVITY_RULE = `

<brevidade_whatsapp>
REGRA DE TAMANHO (WhatsApp): resposta CURTA e direta — o cara bate o olho e manda. Só o essencial.
- SEM textão. SEM recap do que ele disse. SEM explicar o "porquê" longo. SEM pergunta no final.
- Mantém o formato/estrutura, mas com o MÍNIMO de palavras. Corta tudo que não for a jogada em si.
(Voz, tom, ousadia e regras de segurança continuam exatamente iguais — só mais curto.)
</brevidade_whatsapp>`;

function getSystemPrompt(systemType, girlContext = '') {
  if (systemType === 'coach') return SYSTEM_PROMPT_COACH + girlContext + BREVITY_RULE; // coaching
  return SYSTEM_PROMPT + girlContext + BREVITY_RULE; // full (volume)
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

// ── Sanitização de saída ──────────────────────────────────────────────────────
/**
 * Converte markdown duplo asterisco (**text**) para negrito WhatsApp (*text*).
 * Também remove ponto final de frases que terminam com ponto simples.
 */
function sanitizeOutput(text) {
  if (!text) return text;
  return text
    .replace(/<\/?output>/gi, '')                      // remove tags <output> e </output> do modelo
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')              // **bold** → *bold*
    .replace(/ — /g, ' ')                              // travessão — → espaço
    .replace(/(\w)\/(\w)/g, '$1 ou $2')               // barra entre palavras → " ou "
    .replace(/\n+[\-•]\s+/g, '\n\n')                  // \n- ou \n\n- item → linha em branco + texto
    .replace(/^[\-•]\s+/, '')                          // remove traço/bullet no início absoluto
    .replace(/\n{3,}/g, '\n\n')                        // limpa triple+ newlines
    .replace(/([^\.\!\?…])\.(\s*)$/gm, '$1$2')        // ponto final no fim de qualquer linha
    .replace(/([^\.\!\?…])\.\s*$/g, '$1')             // ponto final no fim do texto inteiro (fallback)
    .trim();
}

// ── Envio sequencial com delay por tempo de leitura ──────────────────────────
/**
 * Calcula delay baseado no tempo de leitura da mensagem anterior.
 * ~250 palavras/min (leitura rápida no WhatsApp) = ~240ms/palavra.
 * Mínimo 1.2s, máximo 3.5s.
 */
function readingDelay(text) {
  const words = (text || '').trim().split(/\s+/).length;
  return Math.max(1200, Math.min(3500, words * 240));
}

/**
 * Envia array de mensagens com delay proporcional ao tempo de leitura de cada uma.
 * Cria ritmo de conversa — cada mensagem chega quando o usuário terminou de ler a anterior.
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
    if (i > 0) await new Promise(r => setTimeout(r, readingDelay(messages[i - 1])));
    await client.sendMessage(chatId, sanitizeOutput(messages[i]));
  }
}

/**
 * Divide texto pelo separador '---' em linha própria.
 * Aceita ---, ─── (box drawing), ——— (em dashes) e ⎯⎯⎯ como separador de seção.
 */
function splitByDashes(text) {
  return text.split(/\n[ \t]*(?:[-─—⎯]{3,})[ \t]*\n/).map(s => s.trim()).filter(Boolean);
}

/**
 * Remove o gancho de upgrade (tudo a partir de ⎯⎯⎯ / ━━━ e linhas iniciadas por →).
 * O gancho é interno do prompt e nunca deve chegar ao usuário nos caminhos de fallback.
 */
function stripUpgradeHook(text) {
  if (!text) return text;
  const sep = text.match(/\n?[ \t]*[⎯━─—]{3,}/);
  const cut = sep ? text.slice(0, sep.index) : text;
  return cut.replace(/^[ \t]*→.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Remove pontos finais de mensagens sugeridas (Problem 4).
 * Preserva reticências (...). Converte ". " mid-sentence em quebra de linha.
 */
function stripPeriods(text) {
  if (!text) return text;
  return text
    .replace(/\.{3,}/g, '…')  // protege ...
    .replace(/\.$/gm, '')      // remove ponto no fim de linha — sem converter mid-sentence
    .replace(/…/g, '...')     // restaura ...
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Regex para detectar headers de tom no formato emoji (novo) ou ━━━ (legado)
const TONE_EMOJI_RE = /^(?:🎯|🌹|😏|💭|👑) (?:DIRETO|ROMÂNTICO|BRINCALHÃO|MISTERIOSO|CONFIANTE)/;

// Ganchos de retenção — enviados após as 3 opções (varia a cada turno)
const RETENTION_HOOKS = [
  'copia uma e me manda o que ela responder que eu penso o próximo passo contigo',
  'manda qual você vai usar e me conta como ela responde',
  'escolhe uma, manda pra ela, e volta aqui com a resposta dela',
  'usa uma dessas e me fala como ela reagiu que a gente ajusta',
];

// ---------------------------------------------------------------------------
// Camada de revisão pós-geração (Opção C — híbrida)
// Valida mensagens antes de enviar; roda Haiku só se detectar problema
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\[[a-zA-ZÀ-ú ]{2,25}\]/;
const BANNED_QUICK   = ['mal posso esperar', 'a quanto tempo', 'fico animado com ideia', 'fica animado com'];

function hasQuickIssue(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PLACEHOLDER_RE.test(text) || BANNED_QUICK.some(p => lower.includes(p));
}

async function reviewIfNeeded(parts, phone) {
  // Separa mensagens (não-headers) para validação
  const msgIndices = [];
  parts.forEach((p, i) => {
    if (!TONE_EMOJI_RE.test(p)) msgIndices.push(i);
  });
  const msgs = msgIndices.map(i => parts[i]);

  if (!msgs.some(hasQuickIssue)) return parts; // Tudo limpo — sem custo extra

  console.log(`[Revisão] Problema detectado — rodando revisão Haiku | phone:${phone}`);
  try {
    const resp = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Você é revisor de mensagens de WhatsApp do MandaAssim. Recebe mensagens curtas em português brasileiro e corrige APENAS os erros detectados, mantendo exatamente o mesmo tom e ousadia.

Corrige:
- Placeholder literal ([bairro], [lugar], [nome], [dia]) → formula sem o dado ou remove
- "a quanto tempo" → "há quanto tempo"
- "mal posso esperar" → remove ou substitui por algo natural e falado
- Artigo faltando ("tenho lugar bom" → "tenho um lugar bom")
- Concordância de gênero ("aquela papo" → "aquele papo")
- Construção formal → falada ("quer retomar?" → "bora continuar?")

NÃO muda tom, ousadia, estrutura, nem o que está correto. Só corrige o que está errado.
Responde SOMENTE as mensagens corrigidas, uma por linha separada por ---. Mesma quantidade e ordem.`,
      messages: [{ role: 'user', content: msgs.join('\n---\n') }],
    });

    const corrected = (resp.content[0]?.text || '')
      .trim().split(/\n---\n/).map(m => m.trim()).filter(Boolean);

    if (corrected.length !== msgs.length) {
      console.warn('[Revisão] Contagem incorreta — usando original');
      return parts;
    }

    logApiRequest({
      phone, intent: 'review_haiku',
      targetModel: 'claude-haiku-4-5-20251001', modelActuallyUsed: 'claude-haiku-4-5-20251001',
      tierAtRequest: 'full',
      inputTokens: resp.usage?.input_tokens, outputTokens: resp.usage?.output_tokens,
    });

    const result = [...parts];
    msgIndices.forEach((idx, ci) => { result[idx] = corrected[ci]; });
    return result;
  } catch (err) {
    console.error('[Revisão] Erro no Haiku review:', err.message);
    return parts; // Fail-safe — usa original
  }
}

/**
 * Parseia o formato de tom com emoji headers (novo) ou ━━━ headers (legado).
 * Retorna array: preamble (se houver) + blocos de tom + gancho de upgrade.
 * Retorna [] se o texto não usa nenhum dos formatos.
 */
function splitByToneBlocks(text) {
  const hasEmojiHeaders = /(?:^|\n)(?:🎯|🌹|😏|💭|👑) /.test(text);
  const hasDashHeaders  = text.includes('━━━');
  if (!hasEmojiHeaders && !hasDashHeaders) return [];

  const isToneHeader = (line) => hasEmojiHeaders
    ? TONE_EMOJI_RE.test(line)
    : line.trimStart().startsWith('━━━');

  const parts = [];

  // Posição do primeiro header de tom
  let firstIdx;
  if (hasEmojiHeaders) {
    const m = text.match(/(?:^|\n)((?:🎯|🌹|😏|💭|👑) )/);
    if (!m) return [];
    firstIdx = m.index + (m[0].startsWith('\n') ? 1 : 0);
  } else {
    firstIdx = text.indexOf('━━━');
  }

  // Qualquer texto antes do primeiro header é ignorado — REGRA CRÍTICA do prompt

  // Divide o restante por linhas em branco
  const segments = text.slice(firstIdx).split(/\n{2,}/);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const firstLine = trimmed.split('\n')[0].trim();

    if (isToneHeader(firstLine)) {
      // Bloco de tom: header e mensagem em bolhas separadas (facilita copy-paste)
      const lines   = trimmed.split('\n');
      const header  = lines[0].trim();
      const msgLines = lines.slice(1)
        .map(l => stripPeriods(l.trim()))
        .filter(Boolean);
      parts.push(header);
      if (msgLines.length > 0) parts.push(msgLines.join(' '));
    } else if (trimmed.startsWith('⎯⎯⎯') || trimmed.startsWith('→')) {
      // Hook de upgrade descartado — fluxo termina nas 3 opções
    }
  }

  return parts.length >= 2 ? parts : [];
}

async function enviarResposta(message, sugestoes, intent = '', phone = '') {
  const diagnostico = extrairDiagnostico(sugestoes);
  const opcoes = parsearOpcoes(sugestoes);

  // --- Coaching: análise em blocos separados por --- ---
  if (intent === 'coaching') {
    // Coaching vem quebrado em pedaços (linha em branco entre ideias) → cada
    // pedaço vira uma bolha, com respiro, como amigo mandando no WhatsApp.
    const rawBlocos = sugestoes
      .split(/\n{2,}/)
      .map(s => s.trim())
      .filter(s => s && !/^[-—–]{2,}$/.test(s));

    if (rawBlocos.length > 1) {
      // Quebrado em pedaços → envia cada um como mensagem separada
      await sendWithDelay(message.from, rawBlocos, { phone, intent });
    } else {
      // Fallback: modelo não usou --- → separa diagnóstico do corpo
      console.log(`[enviarResposta] Fallback coaching — sem separadores | intent:${intent} | phone:${phone}`);
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

  // --- Novo formato: ━━━ tone blocks + ⎯⎯⎯ upgrade hook ---
  const toneBlocks = splitByToneBlocks(sugestoes);
  if (toneBlocks.length >= 2) {
    const reviewed = await reviewIfNeeded(toneBlocks, phone);
    console.log(`[Resposta] gerada com ${sugestoes.length} chars, ${reviewed.length} blocos detectados, formato: tone | intent:${intent} | phone:${phone}`);
    await sendWithDelay(message.from, reviewed, { phone, intent });
    if (phone) {
      getAct3Suffix(phone).then(suffix => {
        if (suffix) client.sendMessage(message.from, suffix).catch(() => {});
      }).catch(() => {});
    }
    return;
  }

  // --- Formato legado: tenta split por --- primeiro ---
  const blocos = splitByDashes(sugestoes);

  if (blocos.length > 2) {
    console.log(`[Resposta] gerada com ${sugestoes.length} chars, ${blocos.length} blocos detectados, formato: dashes | intent:${intent} | phone:${phone}`);
    await sendWithDelay(message.from, blocos, { phone, intent });
    if (phone) {
      getAct3Suffix(phone).then(suffix => {
        if (suffix) client.sendMessage(message.from, suffix).catch(() => {});
      }).catch(() => {});
    }
    return;
  }

  // Fallback: parsing manual — diagnóstico + dica + cada opção
  console.log(`[Resposta] gerada com ${sugestoes.length} chars, 0 blocos detectados, formato: fallback | intent:${intent} | phone:${phone}`);
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
    // Último recurso (ex.: MODO ANÁLISE/OUTCOME, sem opções de tom): nunca manda
    // paredão e nunca vaza o gancho de upgrade. Tira diagnóstico/dica já enviados
    // e quebra o resto em bolhas separadas por linha em branco.
    const corpo = stripUpgradeHook(sugestoes)
      .replace(/📍\s*_[^_\n]+_\n*/g, '')   // diagnóstico (já enviado acima)
      .replace(/💡[^\n]*\n*/g, '')         // dica (já enviada acima)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const bolhas = corpo.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    if (bolhas.length > 1) {
      await sendWithDelay(message.from, bolhas, { phone, intent });
    } else if (corpo) {
      await message.reply(corpo);
    }
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
      responseText: responseText || null,
      error: trackingError,
    });
  }
  return responseText;
}

async function analisarTextoComClaude(situacao, contextoExtra = '', girlContext = '', phone = '') {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';

  const classResult = await classificarIntent(situacao);
  const intent = classResult.category;
  const classConfidence = classResult.confidence;

  // Safety block — responde com mensagem curta, não chama modelo
  if (intent === 'safety_block') {
    const safeMsg = pickSafetyResponse(classResult.reason);
    console.log(`[Safety] Bloqueado: ${classResult.reason}`);
    return { text: safeMsg, intent: 'safety_block' };
  }

  const config = INTENT_MODEL_CONFIG[intent] || INTENT_MODEL_CONFIG['volume'];
  const systemPrompt = getSystemPrompt(config.systemType, girlContext);
  console.log(`[Roteamento] intent:${intent} (confidence:${classConfidence}) → ${MODELS.MAIN_MODEL} [${config.structured ? 'structured' : 'livre'}]`);

  // Histórico recente da sessão (sliding window)
  const ctx = userContext.get(phone);
  const history = ctx?.history || [];
  const historicoStr = history.length > 1
    ? '\n\nHistórico recente desta conversa com a mina (contexto adicional):\n' +
      history.slice(-8, -1).map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '';

  const userContent = `${prefixo}${historicoStr}\n\nSituação atual: "${situacao}"\n\nAnalise o contexto específico — o que aconteceu, qual é o estado atual dela, o que ele precisa fazer AGORA. Gere as 3 opções mais certeiras para essa situação exata. Não seja genérico, responda ao que realmente aconteceu.`.trim();

  // Geração de texto — TODOS os intents via adapter: GPT-5 mini (MAIN_MODEL) com
  // fallback automático Gemini 2.5 Flash-Lite. Zero Anthropic/Haiku aqui.
  // `structured` = schema de 3 opções (volume/premium); demais = texto livre,
  // preservando o formato nativo de cada systemType (renderizado no enviarResposta).
  try {
    const r = await gerarRespostaPrincipal({
      systemPrompt, userContent,
      maxTokens: config.maxTokens, temperature: config.temperature,
      intent, structured: config.structured,
    });
    logApiRequest({
      phone, intent,
      intentClassifierModel: MODELS.CLASSIFIER_MODEL,
      targetModel: MODELS.MAIN_MODEL, modelActuallyUsed: r.modelUsed,
      fallbackTriggered: r.fallbackTriggered, fallbackReason: r.fallbackTriggered ? 'model_error' : null,
      inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens,
      cacheReadTokens: r.usage.cacheReadTokens, cacheWriteTokens: r.usage.cacheWriteTokens,
      latencyMs: r.latencyMs, responseLengthChars: r.text ? r.text.length : null,
      responseText: r.text || null, userMessageLengthChars: situacao.length,
      error: r.error,
    });
    return { text: r.text, intent };
  } catch (err) {
    // MAIN (GPT-5 mini) e fallback (Gemini) caíram — sem caminho legado. Resposta graciosa.
    console.error(`[MainGen] falha total (GPT-5 mini + Gemini): ${err.message}`);
    logApiRequest({
      phone, intent,
      intentClassifierModel: MODELS.CLASSIFIER_MODEL,
      targetModel: MODELS.MAIN_MODEL, modelActuallyUsed: null,
      error: err.message, userMessageLengthChars: situacao.length,
    });
    return { text: 'travei aqui. manda de novo em 1 minuto', intent };
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

  return { isPremium: false, isPro: false, inTrial, trialDaysLeft, trialHoursLeft, isLastDay, lastHours, planKey, createdAt: data.created_at };
}

/**
 * Retorna registro mínimo do usuário para a engine narrativa reativa.
 * @param {string} phone
 * @returns {Promise<{phone:string,plan:string,plan_expires_at:string|null,created_at:string}|null>}
 */
async function getUserForNarrative(phone) {
  try {
    const { data } = await getSupabase()
      .from('users')
      .select('phone, plan, plan_expires_at, created_at')
      .eq('phone', phone)
      .maybeSingle();
    return data || null;
  } catch (_) {
    return null;
  }
}

/**
 * Retorna contexto de persona para injetar no prompt de análise.
 * Calibra a leitura para o momento específico do usuário.
 */
function getPersonaContext(persona) {
  const contexts = {
    voltou_pro_mercado:
      `\n\nCONTEXTO DO USUÁRIO: voltou pro mercado recentemente após relacionamento longo ou tempo fora. ` +
      `Pode estar desatualizado com apps e dinâmicas atuais. Calibra a leitura para quem precisa de clareza e segurança, não de teoria. ` +
      `Histórico de relacionamento — filhos, separação, tempo fora do mercado — são dados neutros, não problemas. O fato de estar aqui e mandar mensagem já é o passo certo.`,
    nos_apps_sem_conversao:
      `\n\nCONTEXTO DO USUÁRIO: nos apps há algum tempo mas as conversas não convertem. ` +
      `Foca em onde a conversa pode estar quebrando: resposta sem gancho, timing errado, leitura equivocada de sinal. ` +
      `A análise precisa identificar o padrão, não só dar a próxima mensagem.`,
    conversa_ativa:
      `\n\nCONTEXTO DO USUÁRIO: tem uma conversa rolando agora. ` +
      `Foco total na jogada certa para este momento específico. Leitura precisa do sinal dela e próximo passo concreto.`,
  };
  return contexts[persona] || '';
}

/**
 * Dispara pergunta de contexto V2 após a primeira análise.
 * Fire-and-forget — não bloqueia o handler principal.
 */
function fireContextQuestion(phone, chatId) {
  if (!ONBOARDING_V2) return;
  const ctx = userContext.get(phone) || {};
  if (ctx.contextQuestionAsked || ctx.userPersona) return;
  userContext.set(phone, { ...ctx, contextQuestionAsked: true });

  setTimeout(async () => {
    try {
      await client.sendMessage(chatId,
        `Última coisa pra calibrar melhor:\n\n` +
        `Você tá voltando pro mercado depois de um tempo, nos apps sem converter, ou tem uma conversa específica rolando?\n\n` +
        `1, 2 ou 3`
      );
      const ctx2 = userContext.get(phone) || {};
      userContext.set(phone, { ...ctx2, awaitingContextQuestion: true });
    } catch (_) {}
  }, 4000);
}

/**
 * Avalia e dispara um ato narrativo reativo após a resposta principal.
 * Fire-and-forget — não bloqueia o handler.
 */
async function tryReactiveNarrative(phone, chatId) {
  try {
    const user = await getUserForNarrative(phone);
    if (!user) return;
    const act = await getEligibleAct(user);
    if (!act) return;
    // Delay antes de enviar — parece que o bot "lembrou de algo" em vez de roteiro
    await new Promise(r => setTimeout(r, 45_000));
    await fireActForUser(user, act);
  } catch (err) {
    console.error('[ReactiveNarrative] Erro:', err.message);
  }
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

/**
 * Sanitiza campo de perfil para prevenir prompt injection.
 * Remove quebras de linha (previne injeção de novas seções no prompt)
 * e limita o tamanho.
 */
function sanitizeProfileField(str, maxLen = 300) {
  if (!str) return '';
  return String(str)
    .slice(0, maxLen)
    .replace(/[\n\r]+/g, ' ') // newlines viram espaço — bloqueia injeção multi-linha
    .replace(/---+/g, '—')    // impede fechar o bloco de contexto prematuramente
    .trim();
}

function buildGirlContext(profile) {
  if (!profile) return '';
  const parts = [];
  if (profile.girl_name)        parts.push(`Nome dela: ${sanitizeProfileField(profile.girl_name, 100)}`);
  if (profile.girl_context)     parts.push(`Quem ela é: ${sanitizeProfileField(profile.girl_context, 300)}`);
  if (profile.current_situation) parts.push(`Situação atual: ${sanitizeProfileField(profile.current_situation, 200)}`);
  if (profile.what_worked)      parts.push(`O que já funcionou com ela:\n${sanitizeProfileField(profile.what_worked, 300)}`);
  if (!parts.length) return '';
  return `\n\n--- PERFIL DELA (use para personalizar as respostas) ---\n${parts.join('\n')}\n--- FIM DO PERFIL ---`;
}

// ---------------------------------------------------------------------------
// Contexto por usuário (memória de curto prazo para "outra"/"mais")
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// userContext — estado de sessão por telefone.
// Map em memória com write-through para Supabase (tabela user_sessions), pra
// sobreviver a restart/deploy. Todos os call sites usam .get/.set/.delete como
// um Map normal; a persistência é transparente (debounced + fire-and-forget).
// ---------------------------------------------------------------------------
const USER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // só hidrata sessões dos últimos 7 dias
const USER_SESSION_FLUSH_MS = 2000;                  // coalesce múltiplos sets do mesmo turno

class PersistentContextMap extends Map {
  constructor() {
    super();
    this._flushTimers = new Map(); // phone -> timeout
  }

  set(phone, value) {
    super.set(phone, value); // memória primeiro — nunca pode falhar
    try { this._scheduleFlush(phone); } catch (err) {
      console.error('[Context] scheduleFlush erro:', err.message); // persistência é best-effort
    }
    return this;
  }

  delete(phone) {
    const existed = super.delete(phone); // memória primeiro
    try {
      const t = this._flushTimers.get(phone);
      if (t) { clearTimeout(t); this._flushTimers.delete(phone); }
      getSupabase().from('user_sessions').delete().eq('phone', phone).then(({ error }) => {
        if (error) console.error('[Context] delete falhou:', error.message);
      }, (err) => console.error('[Context] delete rejeitou:', err.message));
    } catch (err) {
      console.error('[Context] delete erro:', err.message);
    }
    return existed;
  }

  _scheduleFlush(phone) {
    if (this._flushTimers.has(phone)) return; // já agendado — coalesce
    const t = setTimeout(() => {
      this._flushTimers.delete(phone);
      try {
        const value = this.get(phone);
        if (value === undefined) return;
        getSupabase()
          .from('user_sessions')
          .upsert({ phone, context: value, updated_at: new Date().toISOString() }, { onConflict: 'phone' })
          .then(({ error }) => { if (error) console.error('[Context] upsert falhou:', error.message); },
                (err) => console.error('[Context] upsert rejeitou:', err.message));
      } catch (err) {
        console.error('[Context] flush erro:', err.message); // nunca propaga — não pode crashar o processo
      }
    }, USER_SESSION_FLUSH_MS);
    if (t.unref) t.unref();
    this._flushTimers.set(phone, t);
  }

  async hydrate() {
    try {
      const since = new Date(Date.now() - USER_SESSION_TTL_MS).toISOString();
      const { data, error } = await getSupabase()
        .from('user_sessions')
        .select('phone, context')
        .gte('updated_at', since);
      if (error) { console.error('[Context] hydrate falhou:', error.message); return; }
      let n = 0;
      for (const row of data || []) { super.set(row.phone, row.context || {}); n++; }
      console.log(`[Context] hidratado ${n} sessões do banco`);
    } catch (err) {
      console.error('[Context] hydrate erro:', err.message);
    }
  }
}

const userContext = new PersistentContextMap(); // phone -> { lastRequest, lastType, scenario, tonePreference, history[] }

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
      model: MODELS.UTILITY_MODEL,
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
      model: MODELS.UTILITY_MODEL,
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
    model: MODELS.AUDIO_MODEL,
    max_tokens: 800,
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
// Debounce de mensagens — junta o "tiro rápido" do usuário numa resposta só.
// No WhatsApp as pessoas digitam em pedaços ("oi" / "preciso de ajuda" / "com
// uma mina") em poucos segundos. Em vez de descartar as mensagens rápidas (o
// que deixava o bot mudo), a gente espera o usuário terminar (~3s sem mandar
// nada), junta tudo num texto só e processa UMA vez. Nada é descartado.
// ---------------------------------------------------------------------------

const MSG_DEBOUNCE_MS = 1800; // espera 1.8s de silêncio antes de processar o burst
const messageBuffer = new Map(); // phone -> { parts: [], timer, lastMessage }

function flushMessageBuffer(chatId) {
  const buf = messageBuffer.get(chatId);
  if (!buf) return;
  messageBuffer.delete(chatId);
  if (buf.timer) clearTimeout(buf.timer);
  const combined = buf.parts.join('\n').trim();
  const msg = buf.lastMessage;
  // Reescreve o corpo com o texto combinado (preserva o resto do objeto: from, getContact, etc.)
  try { msg.body = combined; } catch (_) {}
  if (buf.parts.length > 1) {
    console.log(`[Debounce] processando ${buf.parts.length} msgs juntas | ${chatId}`);
  }
  handleIncomingMessage(msg).catch((err) => {
    console.error('[Debounce] erro ao processar burst:', err.message);
  });
}

// Listener real: bufferiza texto, processa mídia/comandos na hora.
// IMPORTANTE: só a função aqui — o registro client.on('message', ...) acontece
// DEPOIS de `const client = new Client(...)`, pra evitar TDZ no top-level do módulo.
function onMensagemRecebida(message) {
  try {
    // Filtros baratos — não bufferiza o que nunca seria processado
    if (message.isGroupMsg) return;
    if (message.from === 'status@broadcast') return;
    if (message.fromMe) return;
    if (message.type === 'reaction') return;
    if (message.type === 'e2e_notification') return;
    if (message.type === 'notification_template') return;

    const chatId = message.from;

    // Só mensagens de texto entram no buffer de debounce
    if (message.type === 'chat' && typeof message.body === 'string') {
      const buf = messageBuffer.get(chatId) || { parts: [], timer: null, lastMessage: message };
      buf.parts.push(message.body);
      buf.lastMessage = message;
      if (buf.timer) clearTimeout(buf.timer);
      // SEM unref: o timer SEMPRE dispara enquanto o processo viver — nunca segura mensagem pra sempre
      buf.timer = setTimeout(() => {
        try { flushMessageBuffer(chatId); }
        catch (err) { console.error('[Debounce] erro no flush:', err.message); }
      }, MSG_DEBOUNCE_MS);
      messageBuffer.set(chatId, buf);
      return;
    }

    // Mídia/áudio/outros: esvazia qualquer texto pendente antes (preserva ordem), depois processa
    if (messageBuffer.has(chatId)) flushMessageBuffer(chatId);
    handleIncomingMessage(message).catch((err) => {
      console.error('[Handler] erro:', err.message);
    });
  } catch (err) {
    console.error('[Debounce] erro no listener:', err.message);
  }
}

const SAUDACOES = new Set(['oi', 'olá', 'ola', 'hey', 'e aí', 'eai', 'opa', 'oie', 'hi']);

function isSaudacao(text) {
  return SAUDACOES.has(text.toLowerCase().trim());
}

// Agradecimento / fim de papo COM o bot — não é situação pra analisar.
const AGRADECIMENTO_RE = /^(vlw|vale[uw]|obrigad[oa]|obg|brigad[oa]|tmj|tamo junto|show|top|fechou|de boa|belez(a|inha)|blz|perfeito|ajudou|salvou|suave|tranquilo|massa|maravilha|isso a[íi])( (mano|cara|man|demais|mesmo|a[íi]|bro|brother|chefe|parceiro))?[\s.!🙏👊🤙💪😎]*$/i;

function isAgradecimento(text) {
  return AGRADECIMENTO_RE.test(String(text).trim());
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

// Registra o listener de mensagens DEPOIS da declaração de `client` (evita o TDZ).
client.on('message', onMensagemRecebida);

client.on('qr', (qr) => {
  console.log('\n[Bot] Escaneie o QR Code abaixo com o WhatsApp:\n');
  qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
  console.log(`[Bot] Carregando... ${percent}% — ${message}`);
});

client.on('authenticated', () => console.log('[Bot] Autenticado com sucesso!'));
client.on('auth_failure', (msg) => {
  console.error('[Bot] Falha na autenticação:', msg, '— encerrando para PM2 reiniciar');
  process.exit(1);
});
client.on('disconnected', (reason) => {
  console.error('[Bot] Desconectado:', reason, '— encerrando para PM2 reiniciar');
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Upsell no pico emocional — dispara após uma resposta bem-sucedida
// ---------------------------------------------------------------------------

async function contadorRestante(message, trial, todayCount) {
  if (trial.isPremium || trial.inTrial) return;
  const count = todayCount || 0;
  const limit = FREE_DAILY_LIMIT || 5;
  console.log('[Contador]', { count, limit, phone: message.from });
  if (isNaN(count) || isNaN(limit)) return;
  if (count === limit) {
    await client.sendMessage(message.from,
      `_${count}/${limit} — última análise de hoje_`
    );
  } else if (count === limit - 1) {
    await client.sendMessage(message.from,
      `⚠️ você tem 1 análise grátis restante hoje\namanhã o contador zera ou desbloqueia ilimitado por R$29,90/mês`
    );
  }
}

/**
 * Armazena situação no userContext para follow-up do gancho de upgrade.
 * Chamado após enviarResposta — o gancho de upgrade está embutido na resposta do LLM.
 */
function storeUpgradeHookContext(phone, situation) {
  if (!situation) return;
  const ctx = userContext.get(phone) || {};
  userContext.set(phone, { ...ctx, lastHook: { situation: String(situation).slice(0, 400), sentAt: Date.now() } });
}

/**
 * Entrega insight de nível superior via Haiku quando usuário responde ao gancho de upgrade.
 */
async function deliverHookFollowUp(message, phone, situation) {
  try {
    const msg = await retryWithBackoff(() => anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 280,
      system: `Você é o MandaAssim. O usuário respondeu ao seu gancho — ele quer saber mais sobre a situação específica dele.

Entregue 1 insight de nível superior sobre essa situação. Direto, específico, sem coach language. Máx 4 linhas. Sem ponto final nas sugestões de mensagem.

Após o insight, adicione exatamente:

⎯⎯⎯
Análise completa com histórico: *Parceiro* por R$29,90/mês. Digita *mensal* pra liberar.`,
      messages: [{ role: 'user', content: `situação: ${String(situation).slice(0, 400)}\n\nEntrega o insight.` }],
    }));
    const response = (msg.content[0]?.text || '').trim();
    if (response) await client.sendMessage(message.from, response);
    logApiRequest({ phone, intent: 'hook_followup', targetModel: 'claude-haiku-4-5-20251001',
      modelActuallyUsed: 'claude-haiku-4-5-20251001', tierAtRequest: 'full',
      inputTokens: msg.usage?.input_tokens, outputTokens: msg.usage?.output_tokens }).catch?.(() => {});
  } catch (_) {
    await message.reply('deixa eu puxar isso... manda de novo em 1 minuto').catch(() => {});
  }
}

/**
 * Hook de retenção disparado após a 1ª e 3ª análise.
 * Fire-and-forget com 4s de delay — não bloqueia o fluxo principal.
 */
function fireRetentionHook(chatId, todayCount, trial) {
  if (trial.isPremium) return;
  if (todayCount !== 1 && todayCount !== 3) return;

  const remaining = Math.max(0, FREE_DAILY_LIMIT - todayCount);

  setTimeout(async () => {
    try {
      if (todayCount === 1) {
        await client.sendMessage(chatId,
          `se uma dessas funcionar, me conta depois 👀\n\n` +
          `ah, e qualquer conversa nova q travar, manda o print q eu te ajudo\n` +
          `te restam *${remaining}* análises hoje`
        );
      } else {
        await client.sendMessage(chatId,
          `vc tá pegando o jeito 🔥\n\n` +
          `usa eu sempre que travar:\n` +
          `- antes de responder ela\n` +
          `- antes de mandar a primeira msg\n` +
          `- antes de chamar pra sair\n\n` +
          `faltam *${remaining}* análises hoje`
        );
      }
    } catch (_) {}
  }, 4000);
}

async function upsellPicoPremium(message, trial, todayCount) {
  if (trial.isPremium) return;

  // Último dia do trial + 3+ msgs hoje → oferta contextual
  if (trial.inTrial && trial.isLastDay && todayCount >= 3) {
    await client.sendMessage(message.from,
      `Hoje é seu último dia ilimitado. Tem três jeitos de continuar:\n\n` +
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
      `Essa foi a última de hoje. Se não dá pra esperar amanhã:\n\n*mensal* — R$29,90\n*anual* — R$299`
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
      `O que entra:\n\n` +
      `Mensagens ilimitadas\n` +
      `Análise de conversa (sem limite)\n` +
      `Analisar o perfil dela (30/dia)\n` +
      `Olhar e revisar seu perfil (30/dia)\n\n` +
      `O Pix aparece no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Pode pagar tranquilo ✅`
    );

    const media = new MessageMedia('image/png', qrCodeBase64, 'pix-pro.png');
    await client.sendMessage(message.from, media);
    await client.sendMessage(message.from, qrCodeText);
    await client.sendMessage(message.from,
      `_Confirmação chega em menos de 1 minuto. Se demorar: digita *paguei*_`
    );

    console.log(`[Pix Pro] QR Code enviado para ${phone}`);
  } catch (err) {
    console.error('[Pix Pro] Erro:', err.message);
    await message.reply('Deu um problema na hora de gerar o Pix 😕 Tenta de novo daqui a pouco.');
  }
}

async function enviarCobrancaPix(message, phone, amount = undefined) {
  try {
    const { qrCodeBase64, qrCodeText } = await criarCobrancaPix(phone, amount);

    await message.reply('Gerado 👇\n\n_O Pix aparece no nome *Rafael Cabral Ibraim* — é o responsável pelo MandaAssim. Pode pagar tranquilo ✅_');

    const media = new MessageMedia('image/png', qrCodeBase64, 'pix-qrcode.png');
    await client.sendMessage(message.from, media);

    await client.sendMessage(message.from, qrCodeText);

    await client.sendMessage(message.from,
      `_Confirmação chega aqui em menos de 1 minuto. Se demorar: digita *paguei*_`
    );

    console.log(`[Pix] QR Code enviado para ${phone}`);
  } catch (err) {
    console.error('[Pix] Erro ao gerar cobrança:', err.message);
    await message.reply('Deu um problema na hora de gerar o Pix 😕 Tenta de novo daqui a pouco.');
  }
}

// ---------------------------------------------------------------------------
// Notificações inline (modo reativo — sem workers proativos)
// ---------------------------------------------------------------------------

/**
 * Quando o usuário manda mensagem, entrega qualquer notificação "sticky"
 * que esteja vencida na fila (predate reminders, debrief, outcome).
 * Esses itens não são cancelados pelo cancelPendingFollowups normal.
 * Fire-and-forget seguro — nunca bloqueia o fluxo principal.
 */
async function processInlineNotifications(phone, chatId) {
  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data: pending } = await supabase
      .from('followup_queue')
      .select('*')
      .eq('user_phone', phone)
      .lte('scheduled_for', now)
      .is('sent_at', null)
      .is('cancelled_at', null)
      .in('trigger_type', [
        'predate_reminder_day_before',
        'predate_reminder_2h_before',
        'predate_debrief',
        'transition_coach_outcome',
      ])
      .order('scheduled_for', { ascending: true })
      .limit(2);

    if (!pending || pending.length === 0) return;

    for (const item of pending) {
      const msg = getFollowupMessage(item.trigger_type);
      if (!msg) continue;

      await client.sendMessage(chatId, msg);
      await new Promise(r => setTimeout(r, 800));

      await supabase
        .from('followup_queue')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', item.id);

      if (item.trigger_type === 'transition_coach_outcome') {
        marcarOutcomeSolicitado(phone).catch(() => {});
      }
      if (item.trigger_type === 'predate_debrief') {
        atualizarDebriefEnviado(phone).catch(() => {});
      }

      console.log(`[InlineNotif] Entregue ${item.trigger_type} para ${phone}`);
    }
  } catch (err) {
    console.error('[InlineNotif] Erro:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Processamento de mensagens
// ---------------------------------------------------------------------------

async function handleIncomingMessage(message) {
  if (message.isGroupMsg) return;
  if (message.from === 'status@broadcast') return;
  if (message.fromMe) return;
  // Ignora reações (👍❤️😂 etc.) e mensagens de sistema
  if (message.type === 'reaction') return;

  // Intercepta message.reply() para sanitizar igual ao client.sendMessage
  const _origReply = message.reply.bind(message);
  message.reply = (content, chatId, opts) => {
    const clean = typeof content === 'string' ? sanitizeOutput(content) : content;
    return _origReply(clean, chatId, opts);
  };
  if (message.type === 'e2e_notification') return;
  if (message.type === 'notification_template') return;

  let phone = message.from.replace(/@(c\.us|lid)$/, '');
  let contactName = null;
  try {
  let isBusinessAccount = false;
  try {
    const contact = await message.getContact();
    contactName = contact.pushname || contact.name || null;
    isBusinessAccount = contact.isBusiness === true;
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

  // Silencia contas WhatsApp Business (operadoras, bancos, apps, marketing)
  if (isBusinessAccount) {
    console.log(`[Comercial] ${phone} é conta Business — ignorado silenciosamente`);
    return;
  }

  // Detecta mensagens de sistema/automação por padrões inequívocos de empresas
  const BUSINESS_MSG_PATTERN = /\b(bloqueio de (linha|servi[çc]o|conta)|falta de recarga|c[oó]digo de verifica[çc][aã]o|senha (tempor[aá]ria|descart[aá]vel|[úu]nica)|atendente virtual|falar com (atendente|especialista|consultor)|n[aã]o entendi sua resposta|canal de atendimento|sac 0800|fatura em aberto|vencimento da fatura)\b/i;
  if (message.type === 'chat' && BUSINESS_MSG_PATTERN.test(message.body || '')) {
    console.log(`[Spam] ${phone} — padrão de mensagem comercial automática detectado`);
    return;
  }

  // Detecta bots de pesquisa de satisfação / survey bots (ex: botm.cc, NPS externo)
  const SURVEY_BOT_PATTERN = /como foi (o (nosso|seu)|sua|nossa) atendimento|escolha uma op[çc][aã]o e clique|obrigado por responder|botm\.(cc|io)\/|pesquisa de satisfa[çc][aã]o|avalie (nosso|o) atendimento|👍\s*(Bom|Ruim):|👎\s*(Bom|Ruim):|clique no link (abaixo|aqui)|nota para (nosso|o) atendimento|como foi nosso servi[çc]o/i;
  if (message.type === 'chat' && SURVEY_BOT_PATTERN.test(message.body || '')) {
    console.log(`[Spam] ${phone} — survey bot detectado, ignorado silenciosamente`);
    return;
  }

  console.log(`[Mensagem] De: ${phone} | Tipo: ${message.type} | Nome: ${contactName ?? 'desconhecido'}`);

  // Typing imediato — usuário vê que o bot recebeu antes de qualquer processamento
  let stopEarlyTyping = () => {};
  try {
    const earlyChat = await message.getChat();
    await earlyChat.sendStateTyping();
    const earlyInterval = setInterval(() => earlyChat.sendStateTyping().catch(() => {}), 4000);
    stopEarlyTyping = () => { clearInterval(earlyInterval); earlyChat.clearState().catch(() => {}); };
  } catch (_) {}

  // Limite de tamanho — mensagens absurdamente longas são ignoradas
  if (message.type === 'chat' && message.body && message.body.length > 2000) {
    stopEarlyTyping();
    await message.reply('Tá longo demais. Resume o essencial em até 2000 caracteres e manda de novo.');
    return;
  }

  // Modo reativo: entrega notificações sticky vencidas quando usuário manda mensagem
  processInlineNotifications(phone, message.from).catch(() => {});
  // Cancela follow-ups simples (não-sticky) que ficaram pendentes
  cancelPendingFollowups(phone).catch(() => {});

  // Cancela nudge de onboarding se usuário respondeu antes do timer
  if (onboardingNudgeTimers.has(phone)) {
    clearTimeout(onboardingNudgeTimers.get(phone));
    onboardingNudgeTimers.delete(phone);
    logJourneyEvent(phone, 'onboarding_nudge_cancelled_user_responded', {}).catch(() => {});
  }

  // Detecta slug de aquisição na mensagem (ex: "mandaassim_instagram_reel_001")
  const acquisitionSlug = parseAcquisitionSlug(message.type === 'chat' ? message.body : null);

  // Boas-vindas para novos usuários (não conta no limite)
  const isNewUser = await upsertUser(phone, contactName, message.from);
  if (isNewUser) {
    saveAttribution(phone, acquisitionSlug).catch(() => {});

    // Evento: signup
    logJourneyEvent(phone, 'signup', { acquisition_slug: acquisitionSlug || 'direct' }).catch(() => {});

    stopEarlyTyping();

    if (ONBOARDING_V2) {
      // V2: onboarding em 3 mensagens — mostra o produto funcionando antes de pedir qualquer coisa
      await client.sendMessage(message.from, WELCOME_MSG_0);
      await new Promise(r => setTimeout(r, 2000));
      await client.sendMessage(message.from, WELCOME_MSG_1);
      await new Promise(r => setTimeout(r, 3000));
      await client.sendMessage(message.from, WELCOME_MSG_2);
      ensureFDS(phone).catch(() => {});
      logJourneyEvent(phone, 'onboarding_v2_started', {}).catch(() => {});
      console.log(`[Boas-vindas] Enviada para: ${phone} (V2)`);

      // Nudge 90s: dispara se usuário não mandar nada após MSG 3
      const nudgeTimer = setTimeout(async () => {
        onboardingNudgeTimers.delete(phone);
        try {
          await client.sendMessage(message.from, WELCOME_MSG_NUDGE);
          logJourneyEvent(phone, 'onboarding_nudge_sent', {}).catch(() => {});
          console.log(`[Nudge] Onboarding 90s enviado para: ${phone}`);
        } catch (err) {
          console.error(`[Nudge] Falha ao enviar nudge para ${phone}:`, err.message);
        }
      }, 90_000);
      onboardingNudgeTimers.set(phone, nudgeTimer);
    } else {
      // V1: 3 mensagens com delays
      await client.sendMessage(message.from, WELCOME_MESSAGES[0]);
      await new Promise(r => setTimeout(r, 2000));
      await client.sendMessage(message.from, WELCOME_MESSAGES[1]);
      await new Promise(r => setTimeout(r, 3000));
      await client.sendMessage(message.from, WELCOME_MESSAGES[2]);
      console.log(`[Boas-vindas] Enviada para: ${phone}`);
    }

    // scheduleInactiveFollowup(phone).catch(() => {});   // desativado — sem msg proativa
    // scheduleTrialD2Push(phone).catch(() => {});          // desativado — sem msg proativa
    return;
  }

  // Slug detectado em usuário já existente — descarta silenciosamente sem sobrescrever
  if (acquisitionSlug) {
    stopEarlyTyping();
    console.log(`[Aquisição] ${phone} enviou slug mas já é usuário existente — ignorado`);
    return;
  }

  // Comandos: "premium", "status", "menu" e outros
  if (message.type === 'chat') {
    const text = message.body.trim();
    const cmd = text.toLowerCase();
    stopEarlyTyping(); // transfere controle do typing para os fluxos específicos

    if (cmd === 'menu') {
      await client.sendMessage(message.from, getMenuCopy());
      return;
    }

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
          ? `fecha em menos de 2h`
          : `ilimitado por mais *${trial.trialDaysLeft} dia(s)*`;
        statusText = `⏳ *Trial* — ${horasLabel}\n_Usado hoje: ${used} análise(s)_`;
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
        await message.reply('Você já é *Parceiro*. Pode mandar à vontade.');
      } else {
        await message.reply(OPCOES_PREMIUM);
      }
      return;
    }

    if (cmd === 'mensal' || cmd === 'quero assinar' || cmd === 'assinar' || cmd === 'vou pagar' || cmd === 'quero o premium') {
      await enviarCobrancaPix(message, phone, PRECO_MENSAL);
      return;
    }

    if (cmd === 'anual') {
      await enviarCobrancaPix(message, phone, PRECO_ANUAL);
      return;
    }

    // Plano anual Pro (R$799) — oferta D+60
    if (cmd === 'anual pro' || cmd === '/anual pro') {
      const trial = await getTrialInfo(phone);
      if (trial.isPro) {
        await message.reply(`Você já tá no *Parceiro Pro*. Pra migrar pro plano anual (R$799), manda *mensal* e a gente troca na hora.`);
        return;
      }
      await enviarCobrancaPix(message, phone, PRECO_ANUAL_PRO);
      return;
    }

    if (cmd === 'pro' || cmd === 'parceiro pro' || cmd === 'wingman pro' || cmd === 'upgrade') {
      const trial = await getTrialInfo(phone);
      if (trial.isPro) {
        await message.reply('🔥 Você já tá no *Parceiro Pro*. Tudo liberado, pode usar à vontade.');
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
        await message.reply('✅ *Parceiro ativo*. Pode mandar à vontade.');
        return;
      }

      // Rate limit: 1 consulta ao MP por minuto (evita spam e race condition)
      if (!canCallPaguei(phone)) {
        await message.reply('Espera 1 minuto e tenta de novo — o banco ainda pode estar processando.');
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
          `Não achei nenhum pagamento pendente. Se quiser gerar um Pix novo, digita *mensal*.`
        );
        return;
      }

      // Se já aprovado no banco mas usuário não tem plano ativo, ativa agora
      if (pagamento.status === 'approved') {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await supabase.from('users').update({ plan: 'parceiro', plan_expires_at: expiresAt.toISOString() }).eq('phone', phone);
        await message.reply('✅ *Parceiro ativo*. Pode mandar à vontade.');
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
            const planAnterior = user?.plan || 'free';
            const welcomeSeq =
              days === 1 ? CONFIRMACAO_24H :
              newPlan === 'parceiro_pro' && planAnterior === 'parceiro' ? CONFIRMACAO_UPGRADE_PRO :
              newPlan === 'parceiro_pro' ? CONFIRMACAO_PRO :
              CONFIRMACAO_PARCEIRO;
            await sendWithDelay(message.from, welcomeSeq, { phone, intent: 'upgrade_welcome' });
          } else {
            await message.reply(
              `O banco ainda não confirmou o Pix. Costuma cair em menos de 1 minuto. Tenta de novo daqui a pouco.`
            );
          }
        } catch (e) {
          console.error('[Paguei] Erro ao consultar MP:', e.message);
          await message.reply(`Tô verificando seu pagamento aqui. Tenta de novo em 1 minuto.`);
        }
      } else {
        await message.reply(
          `O banco ainda não confirmou o Pix. Costuma cair em menos de 1 minuto. Tenta de novo daqui a pouco.`
        );
      }
      return;
    }

    // ── Cancelamento de assinatura ───────────────────────────────────────────
    if (cmd === 'cancelar' || cmd === '/cancelar') {
      const trialForCancel = await getTrialInfo(phone);
      if (!trialForCancel.isPremium) {
        await message.reply(`Você tá no plano *free* — não há assinatura ativa pra cancelar.\n\nSe quiser assinar:\n\n*mensal* — R$29,90\n*anual* — R$299`);
        return;
      }

      userContext.set(phone, { ...(getUserContext(phone) || {}), awaitingCancelReason: true });
      const expiresMsg = trialForCancel.expiresAt
        ? `\n\nSeu acesso continua ativo até *${new Date(trialForCancel.expiresAt).toLocaleDateString('pt-BR')}*.`
        : '';

      await message.reply(
        `Entendido. Antes de finalizar, me conta o motivo:\n\n` +
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
        `Se mudar de ideia: *mensal*, *anual* ou *pro*. Tô por aqui`
      );
      // Agenda mensagem de reativação D+1
      scheduleReactivationD1(phone).catch(() => {});
      console.log(`[Cancelamento] ${phone} cancelou (${finalReason})`);
      return;
    }

    // ── Comando /ajuda ────────────────────────────────────────────────────────
    if (cmd === 'ajuda' || cmd === '/ajuda') {
      await client.sendMessage(message.from,
        `qualquer dúvida, fala comigo igual fala com amigo\n\n` +
        `se for problema técnico, descreve o que tava fazendo\n` +
        `se for problema de cobrança, manda *cobrança* que eu pulo pra suporte em até 12h\n\n` +
        `outros comandos:\n` +
        `*menu* — ver tudo que faço\n` +
        `*status* — ver seu plano atual\n` +
        `*pausar* — congelar cobrança por 30, 60 ou 90 dias\n` +
        `*cancelar* — encerrar plano\n` +
        `*dados* — ver os dados que tenho de você`
      );
      return;
    }

    // ── Comando /pausar ───────────────────────────────────────────────────────
    if (cmd === 'pausar' || cmd === '/pausar' || cmd.startsWith('pausar ') || cmd.startsWith('/pausar ')) {
      const trialForPause = await getTrialInfo(phone);
      if (!trialForPause.isPremium) {
        await message.reply(`você tá no plano free, não tem cobrança ativa pra pausar\n\nse quiser assinar: *mensal* (R$29,90) ou *pro* (R$79,90)`);
        return;
      }
      // Verifica se já especificou os dias
      const diasMatch = cmd.match(/\b(30|60|90)\b/);
      if (!diasMatch) {
        await client.sendMessage(message.from,
          `beleza, por quantos dias?\n\nresponde *pausar 30*, *pausar 60* ou *pausar 90*\n\nnesse período eu paro de cobrar, paro de mandar mensagem proativa, e seu histórico fica intacto\nquando voltar, é só mandar print de novo`
        );
        return;
      }
      const diasPausa = parseInt(diasMatch[1], 10);
      const pausadoAte = new Date(Date.now() + diasPausa * 24 * 60 * 60 * 1000).toISOString();
      const supabase = getSupabase();
      await supabase.from('users').update({ paused_until: pausadoAte }).eq('phone', phone).catch(() => {});
      await client.sendMessage(message.from,
        `feito, pausado por ${diasPausa} dias\n\ncobrança congelada, sem mensagem proativa\nseus dados ficam intactos\n\nquando voltar, é só mandar print de novo`
      );
      console.log(`[Pausa] ${phone} pausou por ${diasPausa} dias até ${pausadoAte}`);
      return;
    }

    // ── Resposta à pausa com dias (sem o comando prefix) ──────────────────────
    if (getUserContext(phone)?.awaitingPauseDays && /^(30|60|90)$/.test(text.trim())) {
      userContext.set(phone, { ...(getUserContext(phone) || {}), awaitingPauseDays: false });
      const diasPausa = parseInt(text.trim(), 10);
      const pausadoAte = new Date(Date.now() + diasPausa * 24 * 60 * 60 * 1000).toISOString();
      const supabase = getSupabase();
      await supabase.from('users').update({ paused_until: pausadoAte }).eq('phone', phone).catch(() => {});
      await client.sendMessage(message.from,
        `feito, pausado por ${diasPausa} dias\n\ncobrança congelada, sem mensagem proativa\nseus dados ficam intactos\n\nquando voltar, é só mandar print de novo`
      );
      return;
    }

    // ── Comando /dados (LGPD) ─────────────────────────────────────────────────
    if (cmd === 'dados' || cmd === '/dados') {
      const supabase = getSupabase();
      const { data: userData } = await supabase.from('users').select('phone, plan, plan_expires_at, created_at').eq('phone', phone).maybeSingle();
      const { count: msgCount } = await supabase.from('api_requests').select('*', { count: 'exact', head: true }).eq('phone', phone).catch(() => ({ count: 0 }));
      await client.sendMessage(message.from,
        `dados que tenho de você:\n\n` +
        `telefone: ${userData?.phone || phone}\n` +
        `plano: ${userData?.plan || 'free'}\n` +
        `membro desde: ${userData?.created_at ? new Date(userData.created_at).toLocaleDateString('pt-BR') : 'desconhecido'}\n` +
        `análises registradas: ${msgCount || 0}\n\n` +
        `pra apagar tudo, manda *apagar*\n` +
        `seus dados ficam guardados por 30 dias após a exclusão`
      );
      return;
    }

    // ── Comando /apagar (LGPD) ────────────────────────────────────────────────
    if (cmd === 'apagar' || cmd === '/apagar') {
      const ctx = getUserContext(phone) || {};
      if (!ctx.awaitingDeleteConfirm) {
        userContext.set(phone, { ...ctx, awaitingDeleteConfirm: true });
        await client.sendMessage(message.from,
          `isso vai apagar todos os seus dados do MandaAssim\n\ntem certeza? responde *confirmar apagar* pra confirmar\n\nsse mudar de ideia, manda qualquer outra coisa`
        );
        return;
      }
    }

    if (getUserContext(phone)?.awaitingDeleteConfirm && text.toLowerCase() === 'confirmar apagar') {
      userContext.set(phone, { ...(getUserContext(phone) || {}), awaitingDeleteConfirm: false });
      const supabase = getSupabase();
      // Soft delete — anonimiza dados, mantém registro por 30 dias
      await supabase.from('users').update({ plan: 'deleted', wa_chat_id: null }).eq('phone', phone).catch(() => {});
      await client.sendMessage(message.from,
        `feito, seus dados foram marcados para exclusão\n\nremovidos em até 30 dias\n\nse precisar voltar antes disso, é só mandar mensagem`
      );
      console.log(`[LGPD] ${phone} solicitou exclusão de dados`);
      return;
    }

    // ── Comando cobrança (suporte) ────────────────────────────────────────────
    if (cmd === 'cobrança' || cmd === 'cobranca' || cmd === '/cobranca') {
      await client.sendMessage(message.from,
        `beleza, me conta o que tá rolando com a cobrança\n\ndescreve aqui e eu te ajudo ou escalo pra suporte humano em até 12h`
      );
      return;
    }

    // ── Comando mesa (comunidade D+90) ────────────────────────────────────────
    if (cmd === 'mesa' || cmd === '/mesa') {
      await client.sendMessage(message.from,
        `boa, anotei\n\nassim que a mesa tiver pronta, você é um dos primeiros que vou chamar`
      );
      return;
    }

    // ── NPS response ──────────────────────────────────────────────────────────
    const supabaseForNPS = getSupabase();
    let userForNPS = null;
    try {
      const { data: _npsData } = await supabaseForNPS.from('users').select('awaiting_nps').eq('phone', phone).maybeSingle();
      userForNPS = _npsData;
    } catch (_) {}
    if (userForNPS?.awaiting_nps && /^([0-9]|10)$/.test(text.trim())) {
      const npsScore = parseInt(text.trim(), 10);
      try { await supabaseForNPS.from('users').update({ awaiting_nps: false }).eq('phone', phone); } catch (_) {}
      try { await supabaseForNPS.from('nps_responses').insert({ phone, score: npsScore }); } catch (_) {}
      console.log(`[NPS] ${phone} respondeu ${npsScore}`);

      if (npsScore >= 9) {
        // Promotor: convite imediato
        const refCode = await ensureReferralCode(phone).catch(() => generateReferralCode(phone));
        await client.sendMessage(message.from, getReferralInviteMessage(refCode));
      } else if (npsScore >= 7) {
        // Passivo: convite em 24h via followup (reutiliza mesma msg)
        const refCode = await ensureReferralCode(phone).catch(() => generateReferralCode(phone));
        const refMsg = getReferralInviteMessage(refCode);
        setTimeout(() => client.sendMessage(message.from, refMsg).catch(() => {}), 24 * 60 * 60 * 1000);
      } else {
        // Detrator: pedido de feedback
        await client.sendMessage(message.from, getFeedbackRequestMessage());
      }
      return;
    }

    // ── Resposta ao Ato 1 (escolha 1-4 de persona) ── desativado no V2 ────────
    if (!ONBOARDING_V2 && process.env.ENABLE_ACT_01_HOOK_DIAGNOSTICO === 'true') {
      const choice = parseUserChoice(text);
      if (choice) {
        const act01 = getActById('act_01_hook_diagnostico');
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
            if (act01?.onResponse) await act01.onResponse(ctx, text);
            // Confirmação curta + convite — sem cair no analisador
            const acks = {
              '1': `Entendido\n\nVoltou pro jogo depois de um tempo fora — tem contexto específico nisso\n\nManda a conversa ou descreve o que tá rolando`,
              '2': `Entendido\n\nConversas que não engrenam — geralmente tem a ver com timing e leitura de sinal\n\nManda o print ou descreve a situação`,
              '3': `Entendido\n\nConversa rolando agora — vamos direto ao ponto\n\nManda o print ou me conta o que aconteceu`,
              '4': `Entendido\n\nManda o print ou descreve o que tá rolando — eu leio e te devolvo as opções`,
            };
            await client.sendMessage(message.from, acks[choice] || acks['4']);
            return;
          }
        }
      }
    }

    // ── Comandos de Mindset Opt-In ────────────────────────────────────────────
    if (isMindsetCapsulesEnabled(phone)) {
      if (/^(ativar mindset|mindset ativar)$/i.test(cmd)) {
        const trialForMindset = await getTrialInfo(phone);
        if (!trialForMindset.isPro) {
          await message.reply(`Cápsulas de mindset são exclusivas do *Parceiro Pro* 🔥\n\nDigita *pro* pra liberar.`);
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
          await message.reply(`Cápsulas de mindset são exclusivas do *Parceiro Pro* 🔥\n\nDigita *pro* pra liberar.`);
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
  const isTesting = TESTING_PHONES.includes(phone);

  if (!isTesting && !trial.isPremium) {
    // Verifica limite ANTES de incrementar (corrige bug de contagem antecipada)
    const limitCheck = await canUseFeature(phone, trial.planKey, 'messages');
    if (!limitCheck.allowed) {
      console.log(`[Limite] ${phone} (${trial.planKey}) esgotou mensagens hoje.`);
      scheduleLimitExhausted3(phone).catch(() => {});

      const ctx = getUserContext(phone);
      const conversaQuente = ctx?.lastRequestAt && (Date.now() - ctx.lastRequestAt) < 5 * 60 * 1000;

      // Win-back: ex-wingman na janela de 2-15 dias
      if (trial.expiredAt && await verificarWinback(phone, trial.expiredAt)) {
        await client.sendMessage(message.from,
          `Deu ${FREE_DAILY_LIMIT} por hoje. Como você já assinou antes, tem uma oferta de volta:\n\n` +
          `*voltar* — R$19,90 no primeiro mês`
        );
      } else if (conversaQuente) {
        await client.sendMessage(message.from, `Bateu o limite de hoje — e logo agora que a conversa tá rolando.\n\nSe não dá pra esperar amanhã:\n\n*mensal* — R$29,90\n*anual* — R$299`);
      } else {
        await client.sendMessage(message.from, limitCheck.upsellMessage || LIMITE_FREE_ESGOTADO);
      }
      return;
    }
  }

  // Incrementa uso após verificação (sem double-count em msgs bloqueadas)
  // Números de teste não contam no analytics
  const todayCount = isTesting ? 0 : await incrementFeatureUsage(phone, 'messages');
  if (!isTesting) incrementDailyCount(phone).catch(() => {});

  // Trial countdown desativado — sem mensagens proativas não solicitadas

  // scheduleLimitDrop3 desativado — sem msg proativa

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

    // ── Detecta link/URL no texto — pode ser spam externo ou conteúdo não-conversa ──
    const URL_IN_TEXT = /https?:\/\/[^\s]{10,}/i;
    if (URL_IN_TEXT.test(text)) {
      await message.reply('isso é a conversa com ela ou outra coisa?\n\nme dá 1 linha de contexto que eu entro em ação');
      return;
    }

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
              await enviarResposta(message, sugestoes, 'print_analysis', phone);
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
              await enviarResposta(message, sugestoes, 'profile_opener', phone);
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
              `Olhar seu próprio perfil é do *Parceiro Pro* 🔍\n\nVocê manda print do seu Tinder/Bumble. Eu olho foto por foto, leio sua bio, e te falo na lata o que tá funcionando e o que tira match.\n\nPra liberar: digita *pro*`
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
              `Análise de Perfil é do *Parceiro Pro* 🔍\n\nDigita *pro* pra liberar.`
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

    // ── Diagnóstico Ato 2 → 2.5 (espelhamento dinâmico) ── desativado no V2 ──
    if (!ONBOARDING_V2) {
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
    } // end if (!ONBOARDING_V2) — diagnóstico Ato 2 → 2.5

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

    // ── Resposta à pergunta de contexto (1/2/3) — V2 ─────────────────────────
    if (ONBOARDING_V2 && getUserContext(phone)?.awaitingContextQuestion && /^[123]$/.test(text.trim())) {
      const choice = text.trim();
      const personas = { '1': 'voltou_pro_mercado', '2': 'nos_apps_sem_conversao', '3': 'conversa_ativa' };
      const persona = personas[choice];
      const ctx = userContext.get(phone) || {};
      userContext.set(phone, { ...ctx, awaitingContextQuestion: false, userPersona: persona });
      logJourneyEvent(phone, 'context_question_answered', { persona }).catch(() => {});
      const acks = {
        '1': `Captado\n\nVoltou pro jogo depois de um tempo, já levo isso em conta nas próximas`,
        '2': `Captado\n\nApps sem converter, dá pra ver onde tá quebrando`,
        '3': `Captado\n\nConversa ativa, foco total na jogada certa`,
      };
      await client.sendMessage(message.from, acks[choice]);
      return;
    }

    // ── Detecção de crise — protocolo CVV (prioridade absoluta) ─────────────
    if (CRISIS_PATTERN.test(text)) {
      await client.sendMessage(message.from,
        `espera um segundo\n\n` +
        `o que você escreveu me preocupou\n\n` +
        `se você tiver passando por um momento muito pesado, o CVV atende 24h, pelo 188 ou no cvv.org.br\n` +
        `são psicólogos voluntários, de graça, sem julgamento\n\n` +
        `se quiser me contar mais sobre o que tá rolando, eu tô aqui`
      );
      console.log(`[CRISE] Sinal detectado para ${phone}`);
      return;
    }

    // ── Detecção de golpe/phishing — aviso de segurança ─────────────────────
    if (SCAM_PATTERN.test(text)) {
      await client.sendMessage(message.from,
        `⚠️ *Alerta de golpe*\n\n` +
        `Pelo que você descreveu, isso tem todos os sinais de golpe de clonagem de WhatsApp ou engenharia social.\n\n` +
        `*NÃO escaneia* QR code que alguém te mandou por mensagem — esse QR dá acesso ao seu WhatsApp e eles mandam Pix nos seus contatos fingindo ser você.\n` +
        `*NÃO manda foto de documento* pra desconhecido.\n` +
        `*NÃO faz Pix urgente* sem ligar pra pessoa (não mandar mensagem — ligar).\n\n` +
        `Se quiser confirmar: liga pro número que você já tinha da pessoa — não mande mensagem, ligue.\n\n` +
        `Quer ajuda com uma resposta pra encerrar o contato?`
      );
      console.log(`[GOLPE] Sinal de scam detectado para ${phone}`);
      return;
    }

    // ── Detecção de objeção de preço — M17 ───────────────────────────────────
    if (PRICE_OBJECTION_PATTERN.test(text)) {
      const trialObjecao = await getTrialInfo(phone);
      if (!trialObjecao.isPremium) {
        await client.sendMessage(message.from,
          `entendo\n\n` +
          `deixa eu te falar como eu penso isso\n\n` +
          `R$79,90 é menos que um happy hour de quinta com dois chopes\n` +
          `é menos que metade de uma sessão de psicólogo\n` +
          `e é o que faz a diferença entre você travar no "oi tudo bem" e marcar um encontro\n\n` +
          `se for o dinheiro mesmo, vai no *mensal* de R$29,90 que já te ajuda muito\n` +
          `se for desconfiança, manda mais um print que eu te mostro de novo o que essa parada faz`
        );
        return;
      }
    }

    // ── Opt-out de lembretes de pré-date ─────────────────────────────────────
    if (/^parar( lembretes?)?$/i.test(text.trim())) {
      await cancelPredateReminders(phone);
      await message.reply('Lembretes cancelados ✅\n\nSe precisar de algo, é só mandar aqui.');
      return;
    }

    // ── Follow-up de gancho de upgrade ───────────────────────────────────────
    {
      const hookCtx = getUserContext(phone);
      if (HOOK_TRIGGER_PATTERN.test(text.trim()) && hookCtx?.lastHook && (Date.now() - hookCtx.lastHook.sentAt) < 10 * 60 * 1000) {
        const { situation } = hookCtx.lastHook;
        const updCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...updCtx, lastHook: null });
        await deliverHookFollowUp(message, phone, situation);
        return;
      }
    }

    // Filtra saudações puras — welcome_back para usuário recorrente
    if (isSaudacao(text)) {
      await message.reply(
        `Você voltou\n\n` +
        `Tem uma mensagem que faz ela parar\n` +
        `o que tá fazendo só pra responder você\n\n` +
        `Manda o print que eu te mostro qual é`
      );
      return;
    }

    // Agradecimento / fim de papo com o bot — responde curto, NÃO analisa como situação
    if (isAgradecimento(text)) {
      const acks = [
        'tamo junto 🤙 qualquer coisa chama',
        'de nada mano, manda quando precisar',
        'tmj, é só voltar quando ela responder',
        'fechou, tô por aqui',
      ];
      await message.reply(acks[Math.floor(Math.random() * acks.length)]);
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
      await client.sendMessage(message.from, `bora`);
      await new Promise(r => setTimeout(r, 600));
      await client.sendMessage(message.from, INTERVIEW_QUESTIONS[0]);
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
      await client.sendMessage(message.from, `bora te preparar`);
      await new Promise(r => setTimeout(r, 600));
      await client.sendMessage(message.from, INTERVIEW_QUESTIONS_PREDATE[0]);
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
      await client.sendMessage(message.from, `bora`);
      await new Promise(r => setTimeout(r, 600));
      await client.sendMessage(message.from, INTERVIEW_QUESTIONS_DEBRIEF[0]);
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
        await client.sendMessage(message.from, `bora`);
        await new Promise(r => setTimeout(r, 600));
        await client.sendMessage(message.from, INTERVIEW_QUESTIONS_DEBRIEF[0]);
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
          fireRetentionHook(message.from, todayCount, trial);
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
    const personaExtra = getPersonaContext(ctx?.userPersona);

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

    // V2: espelhamento de 1 frase na primeira análise (corre em paralelo)
    const isFirstAnalysisV2 = ONBOARDING_V2 && !getUserContext(phone)?.lastRequest;
    const mirroringPromiseV2 = isFirstAnalysisV2
      ? generateFirstMirroringV2(phone, text).catch(() => null)
      : null;

    const stopTyping3 = await startTyping(message);
    try {
      const result = await analisarTextoComClaude(text, toneHint, girlContext + reconquistaExtra + personaExtra, phone);
      stopTyping3();
      saveUserContext(phone, text, 'text');
      if (recentSuccess) {
        const updCtx = userContext.get(phone) || {};
        userContext.set(phone, { ...updCtx, recentSuccess: false });
      }

      // Se é 1ª análise V2: envia frase de espelhamento antes das 3 opções
      if (mirroringPromiseV2) {
        const mirroringRaw = await mirroringPromiseV2;
        // Garante UMA linha — modelo às vezes ignora instrução e gera lista
        const mirroringMsg = mirroringRaw
          ? mirroringRaw.split('\n').map(l => l.trim()).find(l => l.length > 0) || null
          : null;
        if (mirroringMsg) {
          await client.sendMessage(message.from, mirroringMsg);
          await new Promise(r => setTimeout(r, readingDelay(mirroringMsg)));
        }
        logJourneyEvent(phone, 'first_analysis_done', {}).catch(() => {});
      }

      await enviarResposta(message, result.text, result.intent, phone);
      storeUpgradeHookContext(phone, text);
      await upsellSonnetFree(message, result.sonnetInfo, trial);
      await contadorRestante(message, trial, todayCount);
      await upsellPicoPremium(message, trial, todayCount);
      fireRetentionHook(message.from, todayCount, trial);

      // Ato 12 — última chamada nos últimos 30min do trial (fire-and-forget)
      if (trial.inTrial && trial.trialHoursLeft < 0.5) {
        getAct12Message(phone, trial.trialHoursLeft).then(msgs => {
          if (msgs?.length) sendWithDelay(message.from, msgs, { phone, intent: 'act_12_ultima_chamada' }).catch(() => {});
        }).catch(() => {});
      }

      // fireContextQuestion desativado — sem msg proativa
      // tryReactiveNarrative desativado — sem msg proativa
      // fdsOnAnalysis desativado — sem msg proativa
    } catch (err) {
      stopTyping3();
      console.error('[OpenRouter] Erro ao analisar texto:', err.message);
      await message.reply('Não consegui processar. Tenta de novo.');
    }

  } else if (message.type === 'image') {
    stopEarlyTyping();
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
        await enviarResposta(message, sugestoes, 'story_analysis', phone);
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
                `Olhar seu próprio perfil é do *Parceiro Pro* 🔍\n\nVocê manda print do seu Tinder/Bumble. Eu olho foto por foto, leio a bio, e te falo na lata o que tá funcionando e o que tira match.\n\nDigita *pro* 👇`
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
                `Análise de Perfil é do *Parceiro Pro* 🔍\n\nDigita *pro* pra liberar.`
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

          const isFirstPrintV2 = ONBOARDING_V2 && !getUserContext(phone)?.lastRequest;
          if (!isFirstPrintV2) await message.reply('Lendo a conversa... ⏳');
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

            // V2: mirroring antes dos resultados na 1ª análise
            if (isFirstPrintV2) {
              const mirrorOpener = 'Lendo o que ela quis dizer';
              await client.sendMessage(message.from, mirrorOpener);
              await new Promise(r => setTimeout(r, readingDelay(mirrorOpener)));
              logJourneyEvent(phone, 'first_analysis_done', {}).catch(() => {});
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

            // fireContextQuestion desativado — sem msg proativa
            // tryReactiveNarrative desativado — sem msg proativa
            // fdsOnAnalysis desativado — sem msg proativa

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
    stopEarlyTyping();

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
        await message.reply('meu transcritor travou aqui. resume em 1 linha:\n\n- o que ela disse\n- como ela tava (animada, fria, testando)\n\nem 30 segundos te devolvo as 3 jogadas');
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
      const ctxAudio = userContext.get(phone) || {};
      if (ctxAudio?.recentSuccess) {
        userContext.set(phone, { ...ctxAudio, recentSuccess: false });
      }
      await enviarResposta(message, result.text, result.intent, phone);
      storeUpgradeHookContext(phone, transcricao);
      await upsellSonnetFree(message, result.sonnetInfo, trial);
      await contadorRestante(message, trial, todayCount);
      await upsellPicoPremium(message, trial, todayCount);
      // tryReactiveNarrative desativado — sem msg proativa
    } catch (err) {
      stopTypingAudio();
      console.error('[Áudio] Erro:', err.message);
      await message.reply('meu transcritor travou aqui. resume em 1 linha:\n\n- o que ela disse\n- como ela tava (animada, fria, testando)\n\nem 30 segundos te devolvo as 3 jogadas');
    }

  } else {
    await message.reply(`manda o *print* da conversa, cola o que ela escreveu, ou descreve em texto — eu leio e te devolvo as 3 jogadas`);
  }

  } catch (err) {
    console.error('[Handler] Erro não capturado:', err.message, err.stack);
    try { await message.reply('travei aqui. manda de novo em 1 minuto'); } catch (_) {}
  }
}

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
const { execSync } = require('child_process');
const chromeLockPath = require('path').join(__dirname, '.wwebjs_auth/session-mandaassim-bot/SingletonLock');
try { fs.unlinkSync(chromeLockPath); console.log('[Boot] Lock do Chrome removido.'); } catch (_) {}

// Mata processo anterior que esteja segurando a porta (evita EADDRINUSE no restart)
try { execSync(`fuser -k ${PORT}/tcp`, { stdio: 'ignore' }); console.log(`[Boot] Porta ${PORT} liberada.`); } catch (_) {}

const webhookApp = createWebhookApp(client, null);
const server = webhookApp.listen(PORT, () => {
  console.log(`[Webhook] Servidor rodando na porta ${PORT}`);
});

// Graceful shutdown — libera porta quando PM2 para o processo
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));

let _portRetries = 0;
const PORT_MAX_RETRIES = 5;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    _portRetries++;
    if (_portRetries >= PORT_MAX_RETRIES) {
      console.error(`[Webhook] Porta ${PORT} ainda em uso após ${PORT_MAX_RETRIES} tentativas — encerrando para PM2 reiniciar limpo.`);
      process.exit(1);
    }
    const waitMs = _portRetries * 2000;
    console.error(`[Webhook] Porta ${PORT} em uso — tentativa ${_portRetries}/${PORT_MAX_RETRIES}, aguardando ${waitMs / 1000}s...`);
    setTimeout(() => server.listen(PORT), waitMs);
  } else {
    console.error('[Webhook] Erro no servidor:', err.message);
    process.exit(1);
  }
});

client.on('ready', () => {
  console.log('[Bot] Conectado e pronto para receber mensagens!');

  // Recarrega sessões persistidas pra sobreviver a restart/deploy (fire-and-forget)
  userContext.hydrate();

  // Intercepta sendMessage globalmente para sanitizar ** → * e ponto final
  const _origSend = client.sendMessage.bind(client);
  client.sendMessage = (chatId, content, opts) => {
    const clean = typeof content === 'string' ? sanitizeOutput(content) : content;
    return _origSend(chatId, clean, opts);
  };

  // Engine narrativa reativa — registra client para sender.js (sempre ativo)
  startNarrativeEngine(client);

  // Workers proativos desligados por padrão — mensagens só saem quando usuário inicia
  // Reativar com PROACTIVE_MESSAGES_ENABLED=true se necessário
  if (process.env.PROACTIVE_MESSAGES_ENABLED === 'true') {
    startWorker(client);
    startMindsetWorker(client);
    startNarrativeWorker(client);
    console.log('[Bot] Workers proativos ATIVOS');
  } else {
    console.log('[Bot] Workers proativos DESLIGADOS — modo reativo');
  }
  setTimeout(verificarExpiracoes, 15000);
  setInterval(verificarExpiracoes, 6 * 60 * 60 * 1000);

  // Watchdog de conexão — detecta "estado zumbi" (PM2 diz online, mas o WhatsApp
  // Web caiu por dentro e as mensagens nem chegam). Reinicia limpo via PM2 antes
  // que mensagens se percam em silêncio. Conservador: só age depois de ter visto
  // CONNECTED ao menos 1x (garante que getState é confiável aqui) e só após ~4 min
  // desconectado de verdade (2 checagens ruins seguidas).
  let wppFailCount = 0;
  let wppEverConnected = false;
  setInterval(async () => {
    let state = null;
    try { state = await client.getState(); } catch (_) { state = null; }
    if (state === 'CONNECTED') { wppEverConnected = true; wppFailCount = 0; return; }
    if (!wppEverConnected) return; // getState pode não ser confiável — não age sem ter confirmado CONNECTED
    wppFailCount++;
    console.warn(`[Watchdog] WhatsApp não conectado (estado: ${state}) — checagem ${wppFailCount}/2`);
    if (wppFailCount >= 2) {
      console.error('[Watchdog] desconexão persistente — encerrando para PM2 reiniciar limpo');
      process.exit(1);
    }
  }, 2 * 60 * 1000);
});

client.initialize();
