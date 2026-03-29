const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

const PRECO_PREMIUM = 29.90;

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

function getPayment() {
  const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  return new Payment(mpClient);
}

/**
 * Gera uma cobrança Pix para o usuário e salva no banco.
 * @param {string} phone - número do usuário (sem @c.us)
 * @returns {{ qrCodeBase64: string, qrCodeText: string, paymentId: string }}
 */
async function criarCobrancaPix(phone) {
  const supabase = getSupabase();
  const payment = getPayment();
  const externalRef = `${phone}_${Date.now()}`;

  await supabase.from('payments').insert({
    phone,
    external_ref: externalRef,
    status: 'pending',
    amount: PRECO_PREMIUM,
  });

  const result = await payment.create({
    body: {
      transaction_amount: PRECO_PREMIUM,
      description: 'MandaAssim Premium',
      payment_method_id: 'pix',
      external_reference: externalRef,
      notification_url: `${process.env.WEBHOOK_BASE_URL}/webhook/mercadopago`,
      payer: {
        email: 'pagador@mandaassim.com',
        first_name: 'Usuario',
        last_name: 'MandaAssim',
      },
    },
  });

  const mpPaymentId = String(result.id);
  const transactionData = result.point_of_interaction?.transaction_data;

  if (!transactionData?.qr_code_base64) {
    throw new Error('Mercado Pago não retornou o QR Code. Tente novamente.');
  }

  await supabase
    .from('payments')
    .update({ mp_payment_id: mpPaymentId })
    .eq('external_ref', externalRef);

  console.log(`[Pix] Cobrança criada — ID: ${mpPaymentId} | Usuário: ${phone}`);

  return {
    qrCodeBase64: transactionData.qr_code_base64,
    qrCodeText: transactionData.qr_code,
    paymentId: mpPaymentId,
  };
}

module.exports = { criarCobrancaPix };
