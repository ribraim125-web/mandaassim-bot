require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;
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
  `👉 Escolhe seu plano:\n\n` +
  `📅 *Mensal* — R$29,90/mês → digita *mensal*\n` +
  `📆 *Anual* — R$299/ano _(economiza R$60)_ → digita *anual*`;

const TRANSICAO_SOFT_LIMIT =
  `Seus 3 dias ilimitados acabaram.\n\n` +
  `Por mais 2 dias você ainda tem *10 mensagens por dia* antes do limite cair pra 3.\n\n` +
  `Digita *status* pra ver quanto te sobra hoje.\n\n` +
  `Quer continuar ilimitado? ${OPCOES_PREMIUM}`;

const LIMITE_TRIAL_ENDED_MESSAGE =
  `Acabou por hoje. Volta amanhã com mais *${POST_TRIAL_LIMIT}* — ou continua agora 👇\n\n` +
  `${OPCOES_PREMIUM}`;

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

VOCABULÁRIO PROIBIDO EXTRA:
- "sumo primeiro" → "saio de cena", "desapareço primeiro"
- Nunca use "sumo" conjugado de forma estranha
- "vibe" → pode usar com moderação
- Nunca: "conexão", "processo", "jornada", "incrível", "genuíno"
- Nunca comece resposta com "Nossa", "Cara que", "Poxa"

EXEMPLOS DO QUE NÃO FAZER vs FAZER:
❌ "Queria te ver em pessoa, tomar um café contigo. Quando você está livre?"
✅ "bora tomar um café? tenho uma coisa pra te contar pessoalmente kkkk"

❌ "Não cabe no chat essa conversa"
✅ "não dá pra falar isso aqui, me liga" ou "melhor pessoalmente essa conversa"

❌ "Gostaria de saber quando você está disponível"
✅ "quando você tá livre essa semana?"

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

FORMATO DE SAÍDA — sempre uma mensagem só, sem introdução:

Para análise de conversa:
📍 _[diagnóstico em uma linha: tom dela agora + o que está sinalizando]_

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

TAMANHO DAS RESPOSTAS:
- Cada opção: máximo 12 palavras
- Mensagens curtas convertem mais — menos é mais
- Se a dela foi curta, a sua também é curta
- Se a dela foi longa e emotiva, pode ser levemente maior mas ainda contida

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

FOCO EXCLUSIVO:
Você existe APENAS para ajudar homens a conquistar mulheres — gerar mensagens, analisar conversas, sugerir abordagens, chamar para sair, reconquistar, quebrar o gelo, responder ela.
Se o usuário pedir qualquer coisa fora desse escopo (receitas, código, matemática, notícias, política, saúde, trabalho, etc.), responda EXATAMENTE assim, sem variação:
"Só entendo de conquista 😏 Me manda o print da conversa ou descreve a situação com ela."
Não explique, não se desculpe, não tente ajudar de outro jeito. Só redireciona.`;

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

async function enviarResposta(message, sugestoes) {
  const diagnostico = extrairDiagnostico(sugestoes);
  const opcoes = parsearOpcoes(sugestoes);

  if (diagnostico) {
    await client.sendMessage(message.from, `📍 _${diagnostico}_`);
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

async function analisarPrintComClaude(base64Data, mimeType, instrucaoExtra = '', contextoExtra = '') {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';
  const instrucao = instrucaoExtra || `${prefixo}Analise essa conversa e gere as 3 opções de resposta.`;
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64Data },
          },
          { type: 'text', text: instrucao },
        ],
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Não consegui analisar a imagem. Tente enviar novamente.';
}

async function analisarTextoComClaude(situacao, contextoExtra = '') {
  const prefixo = contextoExtra ? `${contextoExtra}\n\n` : '';
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `${prefixo}Situação: ${situacao}\n\nGere as 3 opções de resposta para essa situação.`,
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Não consegui gerar respostas. Tente descrever melhor a situação.';
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

function getMensagemEspera() {
  return MENSAGENS_ESPERA[Math.floor(Math.random() * MENSAGENS_ESPERA.length)];
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
      `Hoje é seu *último dia* de acesso ilimitado.\n\n` +
      `Se quiser continuar tendo isso todo dia 👇\n\n` +
      OPCOES_PREMIUM
    );
    return;
  }

  // Soft limit (dias 4-5): 2 mensagens restantes
  if (trial.inSoftLimit) {
    const remaining = SOFT_LIMIT - todayCount;
    if (remaining === 2) {
      await client.sendMessage(message.from,
        `Só *${remaining} mensagens* sobrando hoje.\n\n` +
        `Se não quiser travar no meio da conversa 👇\n\n` +
        OPCOES_PREMIUM
      );
    }
    return;
  }

  // Pós-trial (dia 6+): última mensagem do dia
  if (!trial.inTrial && !trial.inSoftLimit) {
    const remaining = POST_TRIAL_LIMIT - todayCount;
    if (remaining === 1) {
      await client.sendMessage(message.from,
        `Última mensagem do dia no plano grátis.\n\n` +
        `Pra não parar agora 👇\n\n` +
        OPCOES_PREMIUM
      );
    }
  }
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
          `Escolhe seu plano 👇\n\n` +
          `📅 *Mensal* — R$29,90/mês\n` +
          `👉 Responde *mensal*\n\n` +
          `📆 *Anual* — R$299/ano _(economiza R$59!)_\n` +
          `👉 Responde *anual*`
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
            const days = amount >= 100 ? 365 : 30;
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + days);
            await Promise.all([
              supabase.from('users').update({ plan: 'premium', plan_expires_at: expiresAt.toISOString(), renewal_notified: false, winback_unlock_at: null }).eq('phone', phone),
              supabase.from('payments').update({ status: 'approved' }).eq('mp_payment_id', pagamento.mp_payment_id),
            ]);
            console.log(`[Paguei] ✅ Premium ativado via consulta MP para ${phone}`);
            await message.reply('✅ *Pagamento confirmado!*\n\nBem-vindo ao *MandaAssim Premium* 🚀\n\nVocê agora tem mensagens *ilimitadas*. Manda o próximo print ou descreve a situação!');
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
          `Como você já foi Premium, tenho uma oferta especial:\n\n` +
          `🔥 *R$19,90* no primeiro mês de volta _(era R$29,90)_\n\n` +
          `👉 Digita *voltar* pra aproveitar`
        );
      } else if (conversaQuente) {
        await message.reply(
          `Você estava indo bem com ela 🔥\n\n` +
          `Seus créditos de hoje acabaram — e perder o ritmo agora seria um erro.\n\n` +
          OPCOES_PREMIUM
        );
      } else if (trial.inSoftLimit) {
        await message.reply(
          `Suas ${SOFT_LIMIT} análises de hoje acabaram 😅\n\n` +
          `${OPCOES_PREMIUM}\n\n` +
          `Ou volta amanhã — você terá *${POST_TRIAL_LIMIT} análises* disponíveis 🔄`
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

    // Pedido de outra/mais — reutiliza contexto anterior
    if (isPedindoOutra(text)) {
      const ctx = getUserContext(phone);
      if (!ctx?.lastRequest) {
        await message.reply('Me manda a situação primeiro, aí eu gero quantas variações quiser 😎');
        return;
      }
      await message.reply(getMensagemEspera());
      try {
        const sugestoes = ctx.lastType === 'image'
          ? await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype)
          : await analisarTextoComClaude(ctx.lastRequest + '\n\n(Gere 3 variações COMPLETAMENTE DIFERENTES das anteriores. Mude os ângulos, metáforas e abordagens.)');
        await enviarResposta(message, sugestoes);
      } catch (err) {
        console.error('[Claude] Erro ao gerar variações:', err.message);
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
      await message.reply(getMensagemEspera());
      try {
        const sugestoes = ctx.lastType === 'image'
          ? await analisarPrintComClaude(ctx.lastRequest.data, ctx.lastRequest.mimetype, `Analise essa conversa e gere 3 opções com tom "${text.trim()}". Seja fiel ao estilo pedido.`)
          : await analisarTextoComClaude(`Situação: ${ctx.lastRequest}\n\nGere 3 opções com tom "${text.trim()}". Adapte completamente o estilo.`);
        saveUserContext(phone, ctx.lastRequest, ctx.lastType);
        await enviarResposta(message, sugestoes);
      } catch (err) {
        console.error('[Claude] Erro ao ajustar tom:', err.message);
        await message.reply('Deu ruim aqui, tenta de novo 😅');
      }
      return;
    }

    // Análise normal
    const ctx = getUserContext(phone);
    const toneHint = ctx?.tonePreference ? `\nPreferência do usuário: ele tende a preferir tom "${ctx.tonePreference}" — leve isso em conta sem ignorar as outras opções.` : '';

    await message.reply(getMensagemEspera());
    try {
      const sugestoes = await analisarTextoComClaude(text, toneHint);
      saveUserContext(phone, text, 'text');
      await enviarResposta(message, sugestoes);
      await contadorRestante(message, trial, todayCount);
      await upsellPicoPremium(message, trial, todayCount);
    } catch (err) {
      console.error('[Claude] Erro ao analisar texto:', err.message);
      await message.reply('Deu ruim aqui, tenta de novo 😅');
    }

  } else if (message.type === 'image') {
    console.log(`[Imagem] ${phone} enviou um print.`);
    const media = await message.downloadMedia();
    if (!media) {
      await message.reply('Não consegui baixar a imagem, manda de novo');
      return;
    }
    const ctxImg = getUserContext(phone);
    const toneHintImg = ctxImg?.tonePreference ? `\nPreferência do usuário: ele tende a preferir tom "${ctxImg.tonePreference}".` : '';

    await message.reply(getMensagemEspera());
    try {
      const sugestoes = await analisarPrintComClaude(media.data, media.mimetype, '', toneHintImg);
      saveUserContext(phone, media, 'image');
      await enviarResposta(message, sugestoes);
      await contadorRestante(message, trial, todayCount);
      await upsellPicoPremium(message, trial, todayCount);
    } catch (err) {
      console.error('[Claude] Erro ao analisar imagem:', err.message);
      await message.reply('Não consegui ler esse print, tenta mandar de novo');
    }

  } else {
    await message.reply(`Só processo texto e print por enquanto. Descreve a situação ou manda o print da conversa 📲`);
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

const webhookApp = createWebhookApp(client);
webhookApp.listen(PORT, () => {
  console.log(`[Webhook] Servidor rodando na porta ${PORT}`);
});

client.on('ready', () => {
  console.log('[Bot] Conectado e pronto para receber mensagens!');
  startWorker(client);
  // Verifica expirações 15s após iniciar e depois a cada 6 horas
  setTimeout(verificarExpiracoes, 15000);
  setInterval(verificarExpiracoes, 6 * 60 * 60 * 1000);
});

client.initialize();
