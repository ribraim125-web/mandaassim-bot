const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');
const { determinarPlano } = require('./mercadopago');
const { trackSubscriptionEvent } = require('./lib/subscriptionTracking');
const { logJourneyEvent } = require('./narrative/journeyEvents');

// Rate limiting simples (sem dependência externa)
const requestHits = new Map(); // ip+scope -> { count, resetAt }

function makeRateLimit(maxPerMin) {
  return function (scope) {
    return function (req, res, next) {
      const ip = req.ip || req.connection.remoteAddress;
      const key = `${scope}:${ip}`;
      const now = Date.now();
      const entry = requestHits.get(key) || { count: 0, resetAt: now + 60000 };
      if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
      entry.count++;
      requestHits.set(key, entry);
      if (entry.count > maxPerMin) return res.status(429).send('Too Many Requests');
      next();
    };
  };
}

const webhookRateLimit = makeRateLimit(60)('webhook');
const adminRateLimit = makeRateLimit(20)('admin');

// Limpa o Map de rate limit a cada 1h para evitar memory leak
setInterval(() => requestHits.clear(), 60 * 60 * 1000);

// Validação de ADMIN_KEY com timing-safe (evita timing attacks)
function validarAdminKey(req) {
  const key = process.env.ADMIN_KEY;
  const provided = req.headers['x-admin-key'];
  if (!key || !provided) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key));
  } catch {
    return false; // Buffers de tamanhos diferentes
  }
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

function getPayment() {
  const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  return new Payment(mpClient);
}

const CONFIRMACAO_PARCEIRO =
  `✅ *Parceiro ativado!* 🚀\n\n` +
  `Mensagens ilimitadas liberadas. Manda o próximo print ou descreve a situação.`;

const CONFIRMACAO_PRO =
  `✅ *Parceiro Pro ativado!* 🔥\n\n` +
  `Você agora tem acesso a tudo:\n` +
  `• Mensagens ilimitadas\n` +
  `• Análise de print de conversa (ilimitada)\n` +
  `• *Analisar Perfil Dela* — gero a primeira mensagem certa com base no que está no perfil (30/dia)\n` +
  `• *Auditar Meu Perfil* — análise foto a foto + bio + top 3 mudanças (30/dia)\n\n` +
  `Testa agora: manda um print do perfil dela no Tinder ou Bumble 👇`;

const CONFIRMACAO_24H =
  `✅ *24h ativado!*\n\n` +
  `Acesso *ilimitado pelas próximas 24 horas* 🚀\n\n` +
  `Aproveita — manda o print agora!\n\n` +
  `_Se quiser continuar depois, digita *mensal* ou *anual*_`;

/**
 * Valida a assinatura do webhook enviada pelo Mercado Pago.
 * Retorna true se válida (ou se o secret não estiver configurado).
 */
function validarAssinatura(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // sem secret configurado, aceita tudo (só em dev)

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  // Se não veio assinatura, deixa passar (MP envia pings e notificações sem header)
  if (!xSignature || !xRequestId) return true;

  const dataId = req.body?.data?.id ?? '';
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${xSignature.split(',').find(p => p.startsWith('ts='))?.split('=')[1] ?? ''};`;

  const ts = xSignature.split(',').find(p => p.startsWith('ts='))?.split('=')[1];
  const v1 = xSignature.split(',').find(p => p.startsWith('v1='))?.split('=')[1];
  if (!ts || !v1) return false;

  const toSign = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', secret).update(toSign).digest('hex');
  return hash === v1;
}

/**
 * Cria o app Express com a rota de webhook.
 * @param {import('whatsapp-web.js').Client} waClient
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
function createWebhookApp(waClient) {
  const app = express();
  app.use(express.json({ limit: '100kb' })); // rejeita payloads gigantes
  app.use(webhookRateLimit);

  app.post('/webhook/mercadopago', async (req, res) => {
    // Responde 200 imediatamente — o MP requer resposta rápida
    res.sendStatus(200);

    try {
      if (!validarAssinatura(req)) {
        console.warn('[Webhook] Assinatura inválida — ignorando.');
        return;
      }

      const { type, data } = req.body;

      if (type !== 'payment' || !data?.id) return;

      const paymentId = String(data.id);
      console.log(`[Webhook] Notificação recebida — payment_id: ${paymentId}`);

      // Busca os detalhes do pagamento no MP
      const payment = getPayment();
      const result = await payment.get({ id: paymentId });

      if (result.status !== 'approved') {
        console.log(`[Webhook] Status ${result.status} — nenhuma ação.`);
        return;
      }

      const externalRef = result.external_reference;
      if (!externalRef) {
        console.warn('[Webhook] Pagamento aprovado sem external_reference.');
        return;
      }

      // Determina plano e validade com base no valor pago
      const amount = result.transaction_amount ?? 0;
      const { plan: newPlan, days } = determinarPlano(amount);
      const confirmacaoMsg =
        days === 1                    ? CONFIRMACAO_24H :
        newPlan === 'parceiro_pro'    ? CONFIRMACAO_PRO :
        CONFIRMACAO_PARCEIRO;

      const supabase = getSupabase();

      // Busca o pagamento no banco pelo external_ref
      const { data: paymentRow } = await supabase
        .from('payments')
        .select('phone, status')
        .eq('external_ref', externalRef)
        .maybeSingle();

      // Extrai o telefone do external_ref (formato: phone_timestamp)
      const phoneFromRef = externalRef.split('_')[0];

      if (!paymentRow) {
        console.warn(`[Webhook] Sem registro no banco para ${externalRef} — ativando pelo external_ref`);
        const { data: userRowFallback } = await supabase
          .from('users')
          .select('wa_chat_id, plan, plan_expires_at')
          .eq('phone', phoneFromRef)
          .maybeSingle();
        // Acumula: se ainda tem plano pago ativo, soma a partir da data atual de expiração
        const isPaidFallback = ['parceiro', 'parceiro_pro', 'wingman', 'wingman_pro'].includes(userRowFallback?.plan);
        const baseDate = (isPaidFallback && userRowFallback?.plan_expires_at && new Date(userRowFallback.plan_expires_at) > new Date())
          ? new Date(userRowFallback.plan_expires_at)
          : new Date();
        const expiresAt = new Date(baseDate);
        if (days === 1) expiresAt.setHours(expiresAt.getHours() + 24);
        else expiresAt.setDate(expiresAt.getDate() + days);
        const expiresAtIso = expiresAt.toISOString();
        // Ativa direto pelo telefone extraído do external_ref
        await supabase
          .from('users')
          .update({ plan: newPlan, plan_expires_at: expiresAtIso, renewal_notified: false, winback_unlock_at: null })
          .eq('phone', phoneFromRef);
        console.log(`[Webhook] ✅ Usuário ${phoneFromRef} promovido para ${newPlan} (sem registro, ${days}d)!`);
        trackSubscriptionEvent({
          phone: phoneFromRef,
          eventType: 'plan_activated',
          planTo: newPlan,
          amountBrl: amount,
          metadata: { mp_payment_id: paymentId, days },
        });
        const upgradeEvent = newPlan === 'parceiro_pro' ? 'upgraded_pro' : 'upgraded_parceiro';
        logJourneyEvent(phoneFromRef, upgradeEvent, { plan: newPlan, amount }).catch(() => {});
        const subscribeEvent = newPlan === 'parceiro_pro' ? 'subscribed_parceiro_pro' : 'subscribed_parceiro';
        logJourneyEvent(phoneFromRef, subscribeEvent, { plan: newPlan, amount }, false).catch(() => {});
        const chatIdFallback = userRowFallback?.wa_chat_id || `${phoneFromRef}@c.us`;
        try {
          await waClient.sendMessage(chatIdFallback, confirmacaoMsg);
        } catch (e) {
          console.warn(`[Webhook] Não conseguiu notificar ${phoneFromRef} no WhatsApp:`, e.message);
        }
        return;
      }

      // Idempotência: evita processar duas vezes
      if (paymentRow.status === 'approved') {
        console.log(`[Webhook] Pagamento ${externalRef} já processado — ignorando.`);
        return;
      }

      const phone = paymentRow.phone;

      // Busca wa_chat_id e expiração atual do usuário
      const { data: userRow } = await supabase
        .from('users')
        .select('wa_chat_id, plan, plan_expires_at')
        .eq('phone', phone)
        .maybeSingle();

      // Acumula: se ainda tem plano pago ativo, soma a partir da data atual de expiração
      const isPaid = ['parceiro', 'parceiro_pro', 'wingman', 'wingman_pro'].includes(userRow?.plan);
      const baseDate = (isPaid && userRow?.plan_expires_at && new Date(userRow.plan_expires_at) > new Date())
        ? new Date(userRow.plan_expires_at)
        : new Date();
      const expiresAt = new Date(baseDate);
      if (days === 1) expiresAt.setHours(expiresAt.getHours() + 24);
      else expiresAt.setDate(expiresAt.getDate() + days);
      const expiresAtIso = expiresAt.toISOString();

      // Busca plano anterior para tracking
      const planAnterior = userRow?.plan || 'free';

      // Atualiza pagamento e usuário no banco
      await Promise.all([
        supabase
          .from('payments')
          .update({ status: 'approved', mp_payment_id: paymentId, updated_at: new Date().toISOString() })
          .eq('external_ref', externalRef),
        supabase
          .from('users')
          .update({ plan: newPlan, plan_expires_at: expiresAtIso, renewal_notified: false, winback_unlock_at: null })
          .eq('phone', phone),
      ]);

      console.log(`[Webhook] ✅ Usuário ${phone} promovido para ${newPlan} (${days}d)!`);

      // Tracking de conversão
      trackSubscriptionEvent({
        phone,
        eventType: 'plan_activated',
        planFrom: planAnterior,
        planTo: newPlan,
        amountBrl: amount,
        metadata: { mp_payment_id: paymentId, days, external_ref: externalRef },
      });
      const upgradeEvt = newPlan === 'parceiro_pro' ? 'upgraded_pro' : 'upgraded_parceiro';
      logJourneyEvent(phone, upgradeEvt, { plan: newPlan, plan_from: planAnterior, amount }).catch(() => {});
      const subscribeEvt = newPlan === 'parceiro_pro' ? 'subscribed_parceiro_pro' : 'subscribed_parceiro';
      logJourneyEvent(phone, subscribeEvt, { plan: newPlan, amount }, false).catch(() => {});

      // Notifica o usuário no WhatsApp usando o chat ID real (salvo quando o usuário mandou a primeira mensagem)
      const chatId = userRow?.wa_chat_id || `${phone}@c.us`;
      try {
        await waClient.sendMessage(chatId, confirmacaoMsg);
      } catch (e) {
        console.warn(`[Webhook] Não conseguiu notificar ${phone} no WhatsApp:`, e.message);
      }

    } catch (err) {
      console.error('[Webhook] Erro ao processar notificação:', err.message);
    }
  });

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Endpoint de diagnóstico — checa status de um usuário no banco
  // GET /admin/user/:phone  (ex: /admin/user/5561986115458)
  app.get('/admin/user/:phone', adminRateLimit, async (req, res) => {
    if (!validarAdminKey(req)) {
      return res.status(401).json({ error: 'não autorizado' });
    }
    const phone = req.params.phone;
    if (!/^\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'phone inválido' });
    const supabase = getSupabase();
    const { data: user } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
    const { data: payments } = await supabase.from('payments').select('*').eq('phone', phone).order('created_at', { ascending: false });
    res.json({ user, payments });
  });

  // Ativa Pro manualmente (para testes e soft-launch)
  // POST /admin/pro  body: { phone }  header: x-admin-key
  app.post('/admin/pro', async (req, res) => {
    if (!validarAdminKey(req)) return res.status(401).json({ error: 'não autorizado' });
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone obrigatório' });

    const supabase = getSupabase();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { data: userRow, error } = await supabase
      .from('users')
      .update({ plan: 'parceiro_pro', plan_expires_at: expiresAt.toISOString(), renewal_notified: false })
      .eq('phone', phone)
      .select('wa_chat_id, plan')
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    trackSubscriptionEvent({
      phone,
      eventType: 'plan_activated',
      planFrom: userRow?.plan || 'unknown',
      planTo: 'parceiro_pro',
      triggerCtx: 'manual',
      metadata: { activated_by: 'admin', expires_at: expiresAt.toISOString() },
    });

    console.log(`[Admin] ✅ Parceiro Pro ativado manualmente para ${phone}`);

    const chatId = userRow?.wa_chat_id || `${phone}@c.us`;
    try {
      await waClient.sendMessage(chatId, CONFIRMACAO_PRO);
    } catch (e) {
      console.warn('[Admin] Não conseguiu notificar no WhatsApp:', e.message);
    }

    res.json({ ok: true, phone, expires_at: expiresAt.toISOString() });
  });

  // Ativa premium manualmente
  // POST /admin/premium  body: { phone, key }
  app.post('/admin/premium', async (req, res) => {
    if (!validarAdminKey(req)) {
      return res.status(401).json({ error: 'não autorizado' });
    }
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone obrigatório' });

    const supabase = getSupabase();
    const { data: userRow, error } = await supabase
      .from('users')
      .update({ plan: 'parceiro', plan_expires_at: null })
      .eq('phone', phone)
      .select('wa_chat_id')
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    console.log(`[Admin] ✅ Parceiro ativado manualmente para ${phone}`);

    const chatId = userRow?.wa_chat_id || `${phone}@c.us`;
    try {
      await waClient.sendMessage(chatId, CONFIRMACAO_PARCEIRO);
    } catch (e) {
      console.warn('[Admin] Não conseguiu notificar no WhatsApp:', e.message);
    }

    res.json({ ok: true, phone });
  });

  // Dashboard admin
  // Números do admin excluídos das métricas
  const ADMIN_PHONES = (process.env.ADMIN_PHONES || '').split(',').filter(Boolean);

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
  });

  // Stats para o dashboard
  app.get('/admin/api/stats', async (req, res) => {
    if (!validarAdminKey(req)) {
      return res.status(401).json({ error: 'não autorizado' });
    }

    const supabase = getSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const trialCutoff = new Date(); trialCutoff.setDate(trialCutoff.getDate() - 3);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    // Busca todos os usuários e filtra admin no JS
    const { data: allUsersRaw } = await supabase.from('users').select('phone, plan, plan_expires_at, created_at');
    const usersData = (allUsersRaw ?? []).filter(u => !ADMIN_PHONES.includes(u.phone));

    const PAID_PLANS = ['parceiro', 'parceiro_pro', 'wingman', 'wingman_pro', 'premium', 'pro']; // legados incluídos
    const now = new Date();
    const totalUsers = usersData.length;
    const premium = usersData.filter(u => ['parceiro','wingman','premium'].includes(u.plan) && (!u.plan_expires_at || new Date(u.plan_expires_at) > now)).length;
    const pro     = usersData.filter(u => ['parceiro_pro','wingman_pro','pro'].includes(u.plan) && (!u.plan_expires_at || new Date(u.plan_expires_at) > now)).length;
    const trial = usersData.filter(u => !PAID_PLANS.includes(u.plan) && new Date(u.created_at) >= trialCutoff).length;
    const free  = usersData.filter(u => !PAID_PLANS.includes(u.plan) && new Date(u.created_at) < trialCutoff).length;
    const newToday = usersData.filter(u => new Date(u.created_at) >= todayStart).length;
    const newWeek = usersData.filter(u => new Date(u.created_at) >= weekAgo).length;

    const { data: msgsData } = await supabase.from('daily_message_counts').select('phone, message_count').eq('count_date', today);
    const { data: msgsWeekData } = await supabase.from('daily_message_counts').select('phone, message_count, count_date').gte('count_date', weekAgo.toISOString().slice(0, 10));
    const { data: msgsTotalData } = await supabase.from('daily_message_counts').select('phone, message_count');

    const filterAdmin = (arr) => (arr ?? []).filter(r => !ADMIN_PHONES.includes(r.phone));
    const sum = (arr) => filterAdmin(arr).reduce((s, r) => s + (r.message_count || 0), 0);
    const msgsToday = sum(msgsData);
    const msgsWeek = sum(msgsWeekData);
    const msgsTotal = sum(msgsTotalData);
    const activeToday = new Set(filterAdmin(msgsData).map(r => r.phone)).size;

    // Métricas avançadas
    const churnCount = usersData.filter(u =>
      PAID_PLANS.includes(u.plan) && u.plan_expires_at && new Date(u.plan_expires_at) <= now
    ).length;
    const freePostTrial = usersData.filter(u =>
      !PAID_PLANS.includes(u.plan) && new Date(u.created_at) < trialCutoff
    ).length;
    const totalPaid = premium + pro;
    const conversionRate = (totalPaid + freePostTrial) > 0
      ? +((totalPaid / (totalPaid + freePostTrial)) * 100).toFixed(1) : 0;
    const churnRate = (totalPaid + churnCount) > 0
      ? +((churnCount / (totalPaid + churnCount)) * 100).toFixed(1) : 0;
    const avgMsgsPerUserDay = activeToday > 0 ? +(msgsToday / activeToday).toFixed(1) : 0;
    const avgMsgsPerUser = totalUsers > 0 ? +(msgsTotal / totalUsers).toFixed(1) : 0;
    const mrr = +(premium * 29.9 + pro * 79.9).toFixed(2);

    // Gráfico últimos 7 dias
    const dailyMap = {};
    for (const r of filterAdmin(msgsWeekData)) {
      if (!dailyMap[r.count_date]) dailyMap[r.count_date] = { msgs: 0, users: new Set() };
      dailyMap[r.count_date].msgs += r.message_count;
      dailyMap[r.count_date].users.add(r.phone);
    }
    const chart7days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      chart7days.push({ date: key, msgs: dailyMap[key]?.msgs || 0, users: dailyMap[key]?.users.size || 0 });
    }

    // Top 5 usuários mais ativos hoje
    const todayRanking = filterAdmin(msgsData)
      .sort((a, b) => b.message_count - a.message_count)
      .slice(0, 5)
      .map(r => ({ phone: r.phone, count: r.message_count }));

    res.json({
      totalUsers, premium, pro, trial, free, newToday, newWeek,
      activeToday, msgsToday, msgsWeek, msgsTotal,
      churnCount, churnRate, conversionRate,
      avgMsgsPerUserDay, avgMsgsPerUser, mrr,
      arr: +(mrr * 12).toFixed(2),
      chart7days, todayRanking,
    });
  });

  // Lista de usuários para o dashboard
  app.get('/admin/api/users', async (req, res) => {
    if (!validarAdminKey(req)) {
      return res.status(401).json({ error: 'não autorizado' });
    }

    const supabase = getSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const trialCutoff = new Date(); trialCutoff.setDate(trialCutoff.getDate() - 3);

    const { data: users } = await supabase
      .from('users')
      .select('phone, plan, plan_expires_at, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    const { data: msgsToday } = await supabase
      .from('daily_message_counts')
      .select('phone, message_count')
      .eq('count_date', today);

    const { data: msgsTotal } = await supabase
      .from('daily_message_counts')
      .select('phone, message_count');

    const todayMap = Object.fromEntries((msgsToday ?? []).map(r => [r.phone, r.message_count]));
    const totalMap = {};
    for (const r of msgsTotal ?? []) {
      totalMap[r.phone] = (totalMap[r.phone] || 0) + r.message_count;
    }

    const result = (users ?? [])
      .filter(u => !ADMIN_PHONES.includes(u.phone))
      .map(u => ({
        ...u,
        is_trial: !['parceiro','parceiro_pro','wingman','wingman_pro','premium','pro'].includes(u.plan) && new Date(u.created_at) >= trialCutoff,
        msgs_today: todayMap[u.phone] || 0,
        msgs_total: totalMap[u.phone] || 0,
      }));

    res.json(result);
  });

  return app;
}

module.exports = { createWebhookApp };
