const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;
const { criarCobrancaPix } = require('./src/mercadopago');
const { createWebhookApp } = require('./src/webhook');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const FREE_DAILY_LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '5', 10);
const PORT = parseInt(process.env.PORT || '3000', 10);

const WELCOME_MESSAGE =
  `Chegou no lugar certo. 👊\n\n` +
  `Sabe aquela sensação de ficar olhando pro celular sem saber o que responder — ` +
  `com medo de falar errado e perder o momento?\n\n` +
  `O *MandaAssim* resolve isso em segundos.\n\n` +
  `Manda o print da conversa com ela (ou descreve a situação em texto) ` +
  `e eu te dou *3 respostas prontas pra copiar e colar* — romântica, ousada ou direta.\n\n` +
  `Calibradas pro contexto dela: o que ela disse, como disse, o tom, o emoji. ` +
  `Nada genérico.\n\n` +
  `Você tem *5 análises grátis* agora. Manda o print! 🔥`;

const LIMITE_MESSAGE =
  `Ei, você usou seus ${FREE_DAILY_LIMIT} créditos de hoje! 🔥\n\n` +
  `Para continuar agora:\n` +
  `👉 Digite *premium* para assinar por R$29,90/mês\n\n` +
  `Ou volte amanhã quando seus créditos renovarem 😉`;

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é o MandaAssim, o melhor especialista em comunicação, sedução e conquista para homens brasileiros. Você conhece profundamente as seguintes técnicas:

TÉCNICAS QUE VOCÊ DOMINA:
- Push-pull: alternar interesse e distância para criar tensão
- Espelhamento: adaptar o tom ao estilo dela (se ela é engraçada, seja engraçado)
- Escassez: nunca parecer disponível demais
- Curiosidade: terminar mensagens que fazem ela querer responder
- Humor calibrado: leveza sem palhaçada
- Validação seletiva: elogiar comportamentos, não só aparência
- Texting rítmico: saber quando demorar a responder

REGRAS DAS RESPOSTAS:
- Máximo 1-2 linhas por opção — curto é mais poderoso
- Zero caretice, zero desespero, zero elogios genéricos
- Sempre deixar ela curiosa para responder
- Usar o contexto dela para personalizar (o que ela disse, como disse, emoji usado)
- Tom: confiante, leve, com personalidade

AO ANALISAR UM PRINT:
1. Identifique o nível de interesse dela (quente/morna/fria)
2. Identifique o tom dela (animada, seca, flertando, testando)
3. Gere 3 respostas que criam tensão ou curiosidade

FORMATO OBRIGATÓRIO (sempre assim, sem variações):
🔥 Opção 1 (romântica): [resposta]
😏 Opção 2 (ousada): [resposta]
⚡ Opção 3 (direta): [resposta]
💡 Contexto: [1 linha explicando a estratégia usada]`;

async function analisarPrintComClaude(base64Data, mimeType) {
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
          { type: 'text', text: 'Analise essa conversa e gere as 3 opções de resposta.' },
        ],
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Não consegui analisar a imagem. Tente enviar novamente.';
}

async function analisarTextoComClaude(situacao) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Situação: ${situacao}\n\nGere as 3 opções de resposta para essa situação.`,
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : 'Não consegui gerar respostas. Tente descrever melhor a situação.';
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

console.log('[Debug] SUPABASE_URL:', process.env.SUPABASE_URL);

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

async function upsertUser(phone, name) {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) return false;

  const { error } = await supabase
    .from('users')
    .insert({ phone, name: name || null });

  if (error) console.error('[Supabase] Erro ao salvar usuário:', error.message);
  return true;
}

async function isUserPremium(phone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('users')
    .select('plan, plan_expires_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!data || data.plan !== 'premium') return false;
  if (data.plan_expires_at && new Date(data.plan_expires_at) < new Date()) return false;
  return true;
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
client.on('ready', () => console.log('[Bot] Conectado e pronto para receber mensagens!'));
client.on('disconnected', (reason) => console.warn('[Bot] Desconectado:', reason));

// ---------------------------------------------------------------------------
// Pagamento Pix
// ---------------------------------------------------------------------------

/**
 * Gera o Pix e envia o QR Code como imagem no WhatsApp.
 */
async function enviarCobrancaPix(message, phone) {
  try {
    const { qrCodeBase64, qrCodeText } = await criarCobrancaPix(phone);

    await message.reply('Perfeito! Gerei seu Pix 👇\n\n⚠️ O Pix aparecerá no nome *Rafael Cabral Ibraim* — esse é o nome do responsável pelo MandaAssim. É seguro pagar normalmente! ✅');

    const media = new MessageMedia('image/png', qrCodeBase64, 'pix-qrcode.png');
    await client.sendMessage(message.from, media);

    await client.sendMessage(message.from, qrCodeText);

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

  const phone = message.from.replace(/@(c\.us|lid)$/, '');

  let contactName = null;
  try {
    const contact = await message.getContact();
    contactName = contact.pushname || contact.name || null;
  } catch (_) {}

  console.log(`[Mensagem] De: ${phone} | Tipo: ${message.type} | Nome: ${contactName ?? 'desconhecido'}`);

  // Boas-vindas para novos usuários (primeira mensagem não conta no limite)
  const isNewUser = await upsertUser(phone, contactName);
  if (isNewUser) {
    await message.reply(WELCOME_MESSAGE);
    console.log(`[Boas-vindas] Enviada para: ${phone}`);
    return;
  }

  // Palavra-chave "premium" — gera Pix diretamente
  if (message.type === 'chat' && message.body.trim().toLowerCase() === 'premium') {
    const isPremium = await isUserPremium(phone);
    if (isPremium) {
      await message.reply('🌟 Você já é *Premium*! Pode mandar à vontade.');
    } else {
      await enviarCobrancaPix(message, phone);
    }
    return;
  }

  // Incrementa contagem e verifica limite
  const todayCount = await incrementDailyCount(phone);

  if (todayCount > FREE_DAILY_LIMIT) {
    const isPremium = await isUserPremium(phone);
    if (!isPremium) {
      console.log(`[Limite] ${phone} atingiu ${todayCount}/${FREE_DAILY_LIMIT} hoje.`);
      await message.reply(LIMITE_MESSAGE);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Processamento normal
  // -------------------------------------------------------------------------

  if (message.type === 'chat') {
    const text = message.body.trim();
    console.log(`[Texto] ${phone}: "${text}"`);
    await message.reply('_Analisando a situação... um segundinho_ ⏳');
    try {
      const sugestoes = await analisarTextoComClaude(text);
      await message.reply(sugestoes);
    } catch (err) {
      console.error('[Claude] Erro ao analisar texto:', err.message);
      await message.reply('Ocorreu um erro ao gerar as respostas. Tente novamente.');
    }

  } else if (message.type === 'image') {
    console.log(`[Imagem] ${phone} enviou um print.`);
    const media = await message.downloadMedia();
    if (!media) {
      await message.reply('Não consegui baixar a imagem. Tente enviar novamente.');
      return;
    }
    await message.reply('_Analisando o print... um segundinho_ ⏳');
    try {
      const sugestoes = await analisarPrintComClaude(media.data, media.mimetype);
      await message.reply(sugestoes);
    } catch (err) {
      console.error('[Claude] Erro ao analisar imagem:', err.message);
      await message.reply('Ocorreu um erro ao analisar a imagem. Tente novamente em instantes.');
    }

  } else {
    await message.reply(`Ainda não processo *${message.type}*. Manda um print ou descreve a situação em texto! 😉`);
  }
});

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

const webhookApp = createWebhookApp(client, getSupabase());
webhookApp.listen(PORT, () => {
  console.log(`[Webhook] Servidor rodando na porta ${PORT}`);
});

client.initialize();
