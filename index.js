require('dotenv').config();

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
  `👋 Oi! Sou o MandaAssim, seu assistente de conquista!\n\n` +
  `📸 Manda um print da conversa\n` +
  `✍️ Ou descreve a situação\n\n` +
  `Te dou 3 respostas prontas na hora! 🔥`;

const LIMITE_MESSAGE =
  `Ei, você usou seus ${FREE_DAILY_LIMIT} créditos de hoje! 🔥\n\n` +
  `Para continuar agora:\n` +
  `👉 Digite *premium* para assinar por R$29,90/mês\n\n` +
  `Ou volte amanhã quando seus créditos renovarem 😉`;

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é o MandaAssim, um especialista em sedução e comunicação para homens brasileiros.

Sua missão é analisar situações com mulheres e gerar 3 respostas prontas para copiar e colar — respostas que realmente funcionam.

PERFIL DAS RESPOSTAS:
- Soam como um homem brasileiro confiante, carismático e com personalidade
- Nunca são robóticas, genéricas ou formais demais
- São curtas e diretas (máximo 2 frases cada)
- Têm alto potencial de gerar resposta positiva dela
- Usam linguagem natural do cotidiano brasileiro

REGRAS:
- Opção engraçada: leveza, bom humor, pode provocar levemente sem ser ofensivo
- Opção charmosa: envolvente, cria tensão sutil, faz ela querer mais
- Opção direta: seguro de si, vai ao ponto, demonstra interesse sem implorar
- NUNCA use clichês como "você é incrível" ou frases desesperadas
- Adapte o tom ao contexto: se ela foi fria, responda com indiferença elegante; se foi calorosa, corresponda com calor

FORMATO OBRIGATÓRIO (sempre assim, sem variações):
🔥 Opção 1 (engraçada): [resposta pronta]

😏 Opção 2 (charmosa): [resposta pronta]

⚡ Opção 3 (direta): [resposta pronta]`;

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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Verifica se o usuário é novo e salva no banco.
 * Retorna true se for a primeira mensagem do usuário.
 */
async function upsertUser(phone, name) {
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

/**
 * Retorna true se o usuário tem plano premium ativo.
 */
async function isUserPremium(phone) {
  const { data } = await supabase
    .from('users')
    .select('plan, plan_expires_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!data || data.plan !== 'premium') return false;
  if (data.plan_expires_at && new Date(data.plan_expires_at) < new Date()) return false;
  return true;
}

/**
 * Incrementa o contador diário de mensagens. Retorna o total de hoje.
 */
async function incrementDailyCount(phone) {
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

    await message.reply('Perfeito! Gerei seu Pix 👇');

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

const webhookApp = createWebhookApp(client, supabase);
webhookApp.listen(PORT, () => {
  console.log(`[Webhook] Servidor rodando na porta ${PORT}`);
});

client.initialize();
