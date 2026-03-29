const express = require('express');
const crypto = require('crypto');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const payment = new Payment(mpClient);

const CONFIRMACAO_PREMIUM =
  `✅ *Pagamento confirmado!*\n\n` +
  `Bem-vindo ao *MandaAssim Premium* 🚀\n\n` +
  `Você agora tem mensagens *ilimitadas*. Manda o próximo print ou descreve a situação!`;

/**
 * Valida a assinatura do webhook enviada pelo Mercado Pago.
 * Retorna true se válida (ou se o secret não estiver configurado).
 */
function validarAssinatura(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true; // sem secret configurado, aceita tudo (só em dev)

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!xSignature || !xRequestId) return false;

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
function createWebhookApp(waClient, supabase) {
  const app = express();
  app.use(express.json());

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

      // Busca o pagamento no banco pelo external_ref
      const { data: paymentRow } = await supabase
        .from('payments')
        .select('phone, status')
        .eq('external_ref', externalRef)
        .maybeSingle();

      if (!paymentRow) {
        console.warn(`[Webhook] Nenhum pagamento encontrado para external_ref: ${externalRef}`);
        return;
      }

      // Idempotência: evita processar duas vezes
      if (paymentRow.status === 'approved') {
        console.log(`[Webhook] Pagamento ${externalRef} já processado — ignorando.`);
        return;
      }

      const phone = paymentRow.phone;

      // Atualiza pagamento e usuário no banco
      await Promise.all([
        supabase
          .from('payments')
          .update({ status: 'approved', mp_payment_id: paymentId, updated_at: new Date().toISOString() })
          .eq('external_ref', externalRef),
        supabase
          .from('users')
          .update({ plan: 'premium' })
          .eq('phone', phone),
      ]);

      console.log(`[Webhook] ✅ Usuário ${phone} promovido para Premium!`);

      // Notifica o usuário no WhatsApp
      await waClient.sendMessage(`${phone}@c.us`, CONFIRMACAO_PREMIUM);

    } catch (err) {
      console.error('[Webhook] Erro ao processar notificação:', err.message);
    }
  });

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

module.exports = { createWebhookApp };
