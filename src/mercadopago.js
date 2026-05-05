const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

const PRECO_PREMIUM = 29.90;
const PRECO_PRO     = 79.90;

/**
 * Determina plano e dias de validade com base no valor pago.
 * Centralizado aqui para webhook e index.js usarem a mesma lógica.
 *
 * Planos: 'parceiro' | 'parceiro_pro'
 */
function determinarPlano(amount) {
  if (amount <= 9.99)                    return { plan: 'parceiro',     days: 1   }; // 24h
  if (Math.abs(amount - PRECO_PRO) < 2) return { plan: 'parceiro_pro', days: 30  }; // Pro mensal
  if (amount >= 100)                     return { plan: 'parceiro',     days: 365 }; // anual
  return                                        { plan: 'parceiro',     days: 30  }; // mensal básico
}

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
async function criarCobrancaPix(phone, amount = PRECO_PREMIUM) {
  const supabase = getSupabase();
  const payment = getPayment();
  const externalRef = `${phone}_${Date.now()}`;

  const { error: insertError } = await supabase.from('payments').insert({
    phone,
    external_ref: externalRef,
    status: 'pending',
    amount,
  });
  if (insertError) console.error('[Pix] Erro ao salvar pagamento no banco:', insertError.message);

  const result = await payment.create({
    body: {
      transaction_amount: amount,
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

module.exports = { criarCobrancaPix, determinarPlano, PRECO_PRO };
